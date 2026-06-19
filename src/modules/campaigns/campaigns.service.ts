import { PrismaClient, Prisma, CampaignStatus } from "@prisma/client";
import type {
  CreateCampaignInput,
  ListCampaignsInput,
  RecipientInput,
  RetargetInput,
  RecurrenceInput,
} from "./campaigns.schemas";
import { COST_PER_MESSAGE } from "../../sharedTypes";
import { extractVariables, validateTemplateParameters } from "../templates/templates.utils";
import { recordOutboundMessage } from "../conversations/conversations.ingest";
import { getActiveMetaAuthorization } from "../../utils";
import { sendMetaTemplateMessage } from "../../meta";
import { FEATURES } from "../../features";
import { enqueueCampaignDispatch } from "../../queue";
import { resolveSegmentContactIds } from "../segments/segments.service";

/**
 * Run a campaign's dispatch. With USE_CAMPAIGN_QUEUE on, hand it to the Bull
 * worker (retries/backoff); otherwise — or if enqueue fails, e.g. Redis is
 * down — dispatch inline so a send never silently disappears.
 */
async function dispatchOrEnqueue(
  workspaceId: string,
  campaignId: string,
  db: PrismaClient
): Promise<void> {
  if (FEATURES.USE_CAMPAIGN_QUEUE) {
    try {
      await enqueueCampaignDispatch({ workspaceId, campaignId });
      return;
    } catch (error) {
      console.error("[campaign] enqueue failed; dispatching inline", error);
    }
  }
  await dispatchCampaign(workspaceId, campaignId, db);
}

// ============================================================================
// Helpers
// ============================================================================

/** Current wallet balance = balanceAfter of the most recent transaction. */
export async function getWalletBalance(workspaceId: string, db: PrismaClient): Promise<number> {
  const last = await db.walletTransaction.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

/** Merge campaign-level defaults with per-recipient overrides. */
function resolveParameters(
  defaults: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined
): Record<string, string> {
  return { ...(defaults ?? {}), ...(overrides ?? {}) };
}

/** Convert a placeholder->value map into the ordered body-parameter array Meta expects. */
function orderedBodyParams(
  template: { body: string; headerType?: string | null; headerText?: string | null; buttons?: unknown },
  parameters: Record<string, string>
): string[] {
  return extractVariables(template).map((token) => parameters[token] ?? "");
}

interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Deliver one template message. If a live WhatsApp connection + Meta auth exist,
 * this calls the real Graph API; otherwise (dev/test with no WABA) it simulates a
 * successful send so the engine can be exercised without a provider.
 */
async function deliverMessage(opts: {
  workspaceId: string;
  template: { name: string; language: string; body: string; headerType?: string | null; headerText?: string | null; buttons?: unknown };
  to: string;
  parameters: Record<string, string>;
  db: PrismaClient;
}): Promise<DeliveryResult> {
  const { workspaceId, template, to, parameters, db } = opts;
  try {
    const [auth, connection] = await Promise.all([
      getActiveMetaAuthorization(workspaceId),
      db.whatsAppConnection.findFirst({ where: { workspaceId } }),
    ]);

    // No provider configured -> simulate (development / automated tests).
    if (!auth?.accessToken || !connection?.phone_number_id) {
      return {
        success: true,
        messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      };
    }

    const res: any = await sendMetaTemplateMessage({
      accessToken: auth.accessToken,
      phoneNumberId: connection.phone_number_id,
      to,
      templateName: template.name,
      languageCode: template.language,
      bodyParameters: orderedBodyParams(template, parameters),
    });
    return { success: true, messageId: res?.messages?.[0]?.id };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

function recipientStats(recipients: { status: string }[]) {
  const stats = { total: recipients.length, queued: 0, sent: 0, delivered: 0, failed: 0 };
  for (const r of recipients) {
    if (r.status in stats) (stats as any)[r.status]++;
  }
  return stats;
}

// ============================================================================
// Audience resolution
// ============================================================================

/** Contact ids that clicked a tracked link attributed to a source campaign. */
async function clickedContactIds(
  workspaceId: string,
  campaignId: string,
  db: PrismaClient
): Promise<Set<string>> {
  const links = await db.trackedLink.findMany({
    where: { workspaceId, campaignId },
    select: { code: true },
  });
  if (links.length === 0) return new Set();
  const clicks = await db.linkClick.findMany({
    where: { workspaceId, linkCode: { in: links.map((l) => l.code) }, contactId: { not: null } },
    select: { contactId: true },
    distinct: ["contactId"],
  });
  return new Set(clicks.map((c) => c.contactId as string));
}

/** Build the recipient list from whichever single audience source was supplied. */
async function resolveAudience(
  workspaceId: string,
  input: Pick<CreateCampaignInput, "recipients" | "segmentId" | "retarget">,
  db: PrismaClient
): Promise<{ recipients: RecipientInput[]; segmentId: string | null; sourceCampaignId: string | null }> {
  if (input.recipients?.length) {
    return { recipients: input.recipients, segmentId: null, sourceCampaignId: null };
  }

  if (input.segmentId) {
    const ids = await resolveSegmentContactIds(workspaceId, input.segmentId, db);
    if (ids.length === 0) throw new Error("Segment matches no eligible contacts");
    return {
      recipients: ids.map((contactId) => ({ contactId })),
      segmentId: input.segmentId,
      sourceCampaignId: null,
    };
  }

  // Retarget a previous campaign's recipients.
  const rt = input.retarget as RetargetInput;
  const source = await db.campaign.findFirst({
    where: { id: rt.fromCampaignId, workspaceId },
    select: { id: true },
  });
  if (!source) throw new Error("Source campaign not found");

  const where: Prisma.CampaignRecipientWhereInput = { campaignId: rt.fromCampaignId };
  if (rt.statuses?.length) where.status = { in: rt.statuses as any };
  let recips = await db.campaignRecipient.findMany({ where, select: { contactId: true }, distinct: ["contactId"] });
  let ids = recips.map((r) => r.contactId);

  if (rt.clicked !== undefined) {
    const clicked = await clickedContactIds(workspaceId, rt.fromCampaignId, db);
    ids = ids.filter((id) => (rt.clicked ? clicked.has(id) : !clicked.has(id)));
  }
  if (ids.length === 0) throw new Error("Retarget rule matches no contacts");

  return {
    recipients: ids.map((contactId) => ({ contactId })),
    segmentId: null,
    sourceCampaignId: rt.fromCampaignId,
  };
}

// ============================================================================
// Create
// ============================================================================

export async function createCampaign(
  workspaceId: string,
  input: CreateCampaignInput,
  db: PrismaClient
) {
  const template = await db.messageTemplate.findFirst({
    where: { id: input.templateId, workspaceId },
  });
  if (!template) {
    throw new Error("Template not found");
  }
  // Real WhatsApp only sends approved templates.
  if (template.status !== "approved") {
    throw new Error(`Template must be approved before sending (current status: ${template.status})`);
  }

  // Resolve the audience (explicit recipients, a saved segment, or a retarget
  // rule) into a concrete recipient list before any validation/billing.
  const { recipients, segmentId, sourceCampaignId } = await resolveAudience(
    workspaceId,
    input,
    db
  );

  // Load and verify all recipient contacts belong to the workspace.
  const contactIds = recipients.map((r) => r.contactId);
  const contacts = await db.contact.findMany({
    where: { workspaceId, id: { in: contactIds } },
  });
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const unknown = contactIds.filter((id) => !contactById.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown contacts: ${unknown.join(", ")}`);
  }

  // Consent gate (Stage 2 integration): never send to opted-out contacts.
  const optedOut = contacts.filter((c) => c.optInStatus === "opt_out").map((c) => c.id);
  if (optedOut.length > 0) {
    throw new Error(`Cannot send to opted-out contacts: ${optedOut.join(", ")}`);
  }

  // *** Parameter mapping validation wired into the send path. ***
  // Validate each recipient's resolved parameters against the template variables.
  const invalid: Array<{ contactId: string; missing: string[]; unexpected: string[]; nonSequential: boolean }> = [];
  const resolvedByContact = new Map<string, Record<string, string>>();
  for (const r of recipients) {
    const resolved = resolveParameters(input.parameters, r.parameters);
    resolvedByContact.set(r.contactId, resolved);
    const result = validateTemplateParameters(template, resolved);
    if (!result.valid) {
      invalid.push({
        contactId: r.contactId,
        missing: result.missing,
        unexpected: result.unexpected,
        nonSequential: result.nonSequential,
      });
    }
  }
  if (invalid.length > 0) {
    const err: any = new Error(
      `Template parameter validation failed for ${invalid.length} recipient(s)`
    );
    err.details = invalid;
    throw err;
  }

  const estimatedCost = Number((recipients.length * COST_PER_MESSAGE).toFixed(2));

  const willSendNow = input.sendNow === true;
  if (willSendNow) {
    const balance = await getWalletBalance(workspaceId, db);
    if (balance < estimatedCost) {
      throw new Error(
        `Insufficient wallet balance: need ${estimatedCost}, have ${balance}`
      );
    }
  }

  const status: CampaignStatus = willSendNow
    ? CampaignStatus.sending
    : input.scheduledFor
      ? CampaignStatus.scheduled
      : CampaignStatus.draft;

  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      templateId: template.id,
      name: input.name,
      status,
      estimatedCost,
      spent: 0,
      parameters: (input.parameters ?? {}) as Prisma.InputJsonValue,
      scheduledFor: input.scheduledFor,
      segmentId,
      sourceCampaignId,
      recurrence: (input.recurrence ?? undefined) as Prisma.InputJsonValue | undefined,
      launchedAt: willSendNow ? new Date() : null,
      recipients: {
        create: recipients.map((r) => ({
          workspaceId,
          contactId: r.contactId,
          status: "queued",
          cost: COST_PER_MESSAGE,
          parameters: (resolvedByContact.get(r.contactId) ?? {}) as Prisma.InputJsonValue,
        })),
      },
    },
  });

  if (willSendNow) {
    await dispatchOrEnqueue(workspaceId, campaign.id, db);
  }

  return getCampaign(workspaceId, campaign.id, db);
}

// ============================================================================
// Dispatch engine
// ============================================================================

/**
 * Send all queued recipients of a campaign. Runs in-process (queue-ready): the
 * production path would enqueue this on the Bull `campaign-dispatch` queue, but
 * the logic is identical. Only debits the wallet for messages sent in this pass,
 * so retries never double-charge.
 */
export async function dispatchCampaign(
  workspaceId: string,
  campaignId: string,
  db: PrismaClient
) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true },
  });
  if (!campaign) throw new Error("Campaign not found");

  const queued = await db.campaignRecipient.findMany({
    where: { campaignId, status: "queued" },
    include: { contact: true },
  });

  if (campaign.status !== CampaignStatus.sending) {
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.sending, launchedAt: campaign.launchedAt ?? new Date() },
    });
  }

  let sentCount = 0;
  for (const recipient of queued) {
    const parameters = (recipient.parameters ?? {}) as Record<string, string>;
    const result = await deliverMessage({
      workspaceId,
      template: campaign.template,
      to: recipient.contact.phone,
      parameters,
      db,
    });

    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: result.success ? "sent" : "failed",
        attempts: { increment: 1 },
        metaMessageId: result.messageId ?? null,
        error: result.success ? null : result.error ?? "Unknown send error",
        sentAt: result.success ? new Date() : null,
      },
    });

    // Mirror the send into the contact's conversation timeline so the inbox is
    // complete and delivery-status webhooks can update it by metaMessageId.
    if (result.success) {
      sentCount++;
      try {
        await recordOutboundMessage(
          workspaceId,
          {
            contactId: recipient.contactId,
            phone: recipient.contact.phone,
            body: campaign.template.body,
            messageType: "template",
            metaMessageId: result.messageId ?? null,
          },
          db
        );
      } catch (err) {
        console.error("[campaign] failed to record outbound message", err);
      }
    }
  }

  // Debit wallet for messages actually sent in this pass.
  if (sentCount > 0) {
    const spend = Number((sentCount * COST_PER_MESSAGE).toFixed(2));
    const balance = await getWalletBalance(workspaceId, db);
    await db.walletTransaction.create({
      data: {
        workspaceId,
        type: "debit",
        amount: -spend,
        description: `${campaign.name} (${sentCount} msgs)`,
        referenceType: "campaign_send",
        referenceId: campaign.id,
        balanceAfter: Number((balance - spend).toFixed(2)),
      },
    });
    await db.campaign.update({
      where: { id: campaignId },
      data: { spent: { increment: spend } },
    });
  }

  // Mark the dispatch pass complete.
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.delivered },
  });

  return getCampaign(workspaceId, campaignId, db);
}

/** Launch a draft or scheduled campaign now. */
export async function launchCampaign(workspaceId: string, campaignId: string, db: PrismaClient) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status !== CampaignStatus.draft && campaign.status !== CampaignStatus.scheduled) {
    throw new Error(`Only draft or scheduled campaigns can be launched (status: ${campaign.status})`);
  }

  const queuedCount = await db.campaignRecipient.count({ where: { campaignId, status: "queued" } });
  const estimated = Number((queuedCount * COST_PER_MESSAGE).toFixed(2));
  const balance = await getWalletBalance(workspaceId, db);
  if (balance < estimated) {
    throw new Error(`Insufficient wallet balance: need ${estimated}, have ${balance}`);
  }

  await dispatchOrEnqueue(workspaceId, campaignId, db);
  return getCampaign(workspaceId, campaignId, db);
}

/** Re-queue and re-send only the failed recipients of a campaign. */
export async function retryCampaign(workspaceId: string, campaignId: string, db: PrismaClient) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw new Error("Campaign not found");

  const failed = await db.campaignRecipient.updateMany({
    where: { campaignId, status: "failed" },
    data: { status: "queued", error: null },
  });
  if (failed.count === 0) {
    throw new Error("No failed recipients to retry");
  }

  await dispatchOrEnqueue(workspaceId, campaignId, db);
  return getCampaign(workspaceId, campaignId, db);
}

// ============================================================================
// Read
// ============================================================================

export async function listCampaigns(
  workspaceId: string,
  filters: ListCampaignsInput,
  db: PrismaClient
) {
  const where: Prisma.CampaignWhereInput = { workspaceId };
  if (filters.status) where.status = filters.status as CampaignStatus;

  const [total, campaigns] = await Promise.all([
    db.campaign.count({ where }),
    db.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
      include: {
        template: { select: { id: true, name: true, status: true } },
        _count: { select: { recipients: true } },
      },
    }),
  ]);

  return { total, campaigns, page: filters.page, limit: filters.limit };
}

export async function getCampaign(workspaceId: string, campaignId: string, db: PrismaClient) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      template: { select: { id: true, name: true, status: true, category: true } },
      recipients: {
        include: { contact: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!campaign) throw new Error("Campaign not found");

  return { ...campaign, stats: recipientStats(campaign.recipients) };
}

// ============================================================================
// Recurrence
// ============================================================================

/**
 * Next occurrence strictly after `now`, or null once `until` has passed. Walks
 * forward by the recurrence interval so a clone is never created already-due.
 */
export function computeNextRun(
  base: Date,
  rec: RecurrenceInput,
  now: Date = new Date()
): Date | null {
  const advance = (d: Date): Date => {
    const next = new Date(d);
    if (rec.freq === "daily") next.setDate(next.getDate() + rec.interval);
    else if (rec.freq === "weekly") next.setDate(next.getDate() + rec.interval * 7);
    else next.setMonth(next.getMonth() + rec.interval); // monthly
    return next;
  };

  let next = advance(base);
  let guard = 0;
  while (next <= now && guard++ < 1000) next = advance(next);
  if (rec.until && next > rec.until) return null;
  return next;
}

/**
 * After a recurring campaign dispatches, schedule its next run as a fresh
 * campaign. Segment audiences are re-resolved (so new contacts are included);
 * other audiences clone the concrete recipient set. Returns the new campaign id,
 * or null when the recurrence has ended.
 */
export async function createNextRecurrence(
  workspaceId: string,
  campaignId: string,
  db: PrismaClient
): Promise<string | null> {
  const c = await db.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!c || !c.recurrence) return null;

  const rec = c.recurrence as unknown as RecurrenceInput;
  const next = computeNextRun(c.scheduledFor ?? c.createdAt, rec);
  if (!next) return null;

  const base = {
    name: c.name,
    templateId: c.templateId,
    parameters: (c.parameters ?? {}) as Record<string, string>,
    scheduledFor: next,
    recurrence: rec,
    sendNow: false as const,
  };

  let input: CreateCampaignInput;
  if (c.segmentId) {
    input = { ...base, segmentId: c.segmentId } as CreateCampaignInput;
  } else {
    const recs = await db.campaignRecipient.findMany({
      where: { campaignId },
      select: { contactId: true, parameters: true },
    });
    input = {
      ...base,
      recipients: recs.map((r) => ({
        contactId: r.contactId,
        parameters: (r.parameters ?? undefined) as Record<string, string> | undefined,
      })),
    } as CreateCampaignInput;
  }

  const created = await createCampaign(workspaceId, input, db);
  return created.id;
}

// ============================================================================
// Analytics
// ============================================================================

/**
 * Campaign performance: the delivery funnel, derived rates, click attribution
 * from tracked links, and a per-day send timeline.
 */
export async function getCampaignAnalytics(
  workspaceId: string,
  campaignId: string,
  db: PrismaClient
) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    select: { id: true, name: true, status: true, spent: true, estimatedCost: true, launchedAt: true },
  });
  if (!campaign) throw new Error("Campaign not found");

  const grouped = await db.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const funnel = { total: 0, queued: 0, sent: 0, delivered: 0, failed: 0 };
  for (const g of grouped) {
    const n = g._count._all;
    funnel.total += n;
    if (g.status in funnel) (funnel as any)[g.status] = n;
  }
  const reached = funnel.sent + funnel.delivered;
  const rate = (n: number) => (funnel.total ? Number((n / funnel.total).toFixed(4)) : 0);

  // Click attribution via tracked links tied to this campaign.
  const links = await db.trackedLink.findMany({
    where: { workspaceId, campaignId },
    select: { code: true },
  });
  let totalClicks = 0;
  let uniqueClicks = 0;
  if (links.length > 0) {
    const clicks = await db.linkClick.findMany({
      where: { workspaceId, linkCode: { in: links.map((l) => l.code) } },
      select: { contactId: true, ipAddress: true },
    });
    totalClicks = clicks.length;
    uniqueClicks = new Set(clicks.map((c) => c.contactId ?? c.ipAddress ?? "anon")).size;
  }

  // Per-day send timeline.
  const sent = await db.campaignRecipient.findMany({
    where: { campaignId, sentAt: { not: null } },
    select: { sentAt: true },
  });
  const byDay: Record<string, number> = {};
  for (const r of sent) {
    const day = (r.sentAt as Date).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  return {
    campaign,
    funnel,
    rates: {
      deliveryRate: rate(funnel.delivered),
      sentRate: rate(reached),
      failureRate: rate(funnel.failed),
      clickThroughRate: reached ? Number((uniqueClicks / reached).toFixed(4)) : 0,
    },
    clicks: { total: totalClicks, unique: uniqueClicks, linkCount: links.length },
    timeline: Object.entries(byDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
