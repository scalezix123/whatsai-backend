import { PrismaClient, CampaignStatus } from "@prisma/client";
import { COST_PER_MESSAGE } from "../../sharedTypes";
import { dispatchCampaign, getWalletBalance, createNextRecurrence } from "./campaigns.service";
import { logOperationalEvent } from "../../utils";

// ============================================================================
// Scheduled-campaign worker
// ----------------------------------------------------------------------------
// Bull/Redis dispatch isn't reliably available in this environment, so due
// `scheduled` campaigns are fired by an in-process polling loop instead. Each
// tick is a single indexed query; dispatch reuses the exact same path as the
// manual /launch endpoint.
// ============================================================================

/**
 * Find every campaign whose send time has arrived and dispatch it. Each campaign
 * is claimed atomically (scheduled -> sending via a guarded updateMany) so a slow
 * tick, a second tick, or a second server instance can never double-send.
 */
export async function dispatchDueCampaigns(
  db: PrismaClient,
  now: Date = new Date()
): Promise<{ dispatched: string[]; skipped: string[] }> {
  const due = await db.campaign.findMany({
    where: { status: CampaignStatus.scheduled, scheduledFor: { lte: now } },
    select: { id: true, workspaceId: true, name: true },
  });

  const dispatched: string[] = [];
  const skipped: string[] = [];

  for (const campaign of due) {
    // Don't fire a campaign the workspace can't pay for; leave it `scheduled` so
    // it auto-sends once topped up. Uses console (not the DB log) to avoid
    // writing a row every tick while a workspace stays under-funded.
    const queuedCount = await db.campaignRecipient.count({
      where: { campaignId: campaign.id, status: "queued" },
    });
    const estimated = Number((queuedCount * COST_PER_MESSAGE).toFixed(2));
    const balance = await getWalletBalance(campaign.workspaceId, db);
    if (balance < estimated) {
      console.warn(
        `[scheduler] skipping campaign ${campaign.id} (${campaign.name}): insufficient balance ${balance} < ${estimated}`
      );
      skipped.push(campaign.id);
      continue;
    }

    // Atomic claim. If another worker/tick already took it, count is 0 -> skip.
    const claim = await db.campaign.updateMany({
      where: { id: campaign.id, status: CampaignStatus.scheduled },
      data: { status: CampaignStatus.sending, launchedAt: now },
    });
    if (claim.count !== 1) {
      skipped.push(campaign.id);
      continue;
    }

    try {
      await dispatchCampaign(campaign.workspaceId, campaign.id, db);
      dispatched.push(campaign.id);
      await logOperationalEvent({
        workspaceId: campaign.workspaceId,
        level: "info",
        eventType: "campaign.scheduled_dispatch",
        summary: `Scheduled campaign "${campaign.name}" dispatched`,
        payload: { campaignId: campaign.id },
      });

      // If this campaign recurs, schedule its next occurrence as a fresh
      // campaign. Failure here must not fail the dispatch that already happened.
      try {
        const nextId = await createNextRecurrence(campaign.workspaceId, campaign.id, db);
        if (nextId) {
          await logOperationalEvent({
            workspaceId: campaign.workspaceId,
            level: "info",
            eventType: "campaign.recurrence_scheduled",
            summary: `Recurring campaign "${campaign.name}" scheduled next run`,
            payload: { campaignId: campaign.id, nextCampaignId: nextId },
          });
        }
      } catch (recErr) {
        console.error(`[scheduler] failed to schedule recurrence for ${campaign.id}`, recErr);
      }
    } catch (error) {
      // CampaignStatus has no `failed` value. The campaign is already claimed to
      // `sending`, which the sweep never re-scans, so it won't loop or spam — it
      // stays visibly mid-send for an admin to inspect/retry. Just record why.
      await logOperationalEvent({
        workspaceId: campaign.workspaceId,
        level: "error",
        eventType: "campaign.scheduled_dispatch_failed",
        summary: `Scheduled campaign "${campaign.name}" failed to dispatch: ${(error as Error).message}`,
        payload: { campaignId: campaign.id },
      });
      skipped.push(campaign.id);
    }
  }

  return { dispatched, skipped };
}

// ----------------------------------------------------------------------------
// Polling loop lifecycle
// ----------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Start the polling loop. Idempotent (a second call is a no-op while running).
 * Disable entirely with CAMPAIGN_SCHEDULER_ENABLED=false; tune cadence with
 * CAMPAIGN_SCHEDULER_INTERVAL_MS (default 60s). Returns the stop function.
 */
export function startCampaignScheduler(
  db: PrismaClient,
  intervalMs = Number(process.env.CAMPAIGN_SCHEDULER_INTERVAL_MS || 60000)
): () => void {
  if (process.env.CAMPAIGN_SCHEDULER_ENABLED === "false") {
    console.log("[scheduler] campaign scheduler disabled via CAMPAIGN_SCHEDULER_ENABLED=false");
    return () => {};
  }
  if (timer) return stopCampaignScheduler;

  const tick = async () => {
    if (running) return; // never overlap two passes
    running = true;
    try {
      const { dispatched } = await dispatchDueCampaigns(db);
      if (dispatched.length > 0) {
        console.log(
          `[scheduler] dispatched ${dispatched.length} scheduled campaign(s): ${dispatched.join(", ")}`
        );
      }
    } catch (error) {
      console.error("[scheduler] tick failed", error);
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, intervalMs);
  // Don't keep the event loop alive just for the scheduler.
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[scheduler] campaign scheduler started (every ${intervalMs}ms)`);
  void tick(); // fire one pass immediately on boot
  return stopCampaignScheduler;
}

export function stopCampaignScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
