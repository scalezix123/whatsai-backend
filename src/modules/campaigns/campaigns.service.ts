import { PrismaClient, Prisma, CampaignStatus } from "@prisma/client";
import type { CreateCampaignInput, ListCampaignsInput } from "./campaigns.schemas";
import { COST_PER_MESSAGE } from "../../sharedTypes";
import { extractVariables, validateTemplateParameters } from "../templates/templates.utils";
import { getActiveMetaAuthorization } from "../../utils";
import { sendMetaTemplateMessage } from "../../meta";

// ============================================================================
// Helpers
// ============================================================================

/** Current wallet balance = balanceAfter of the most recent transaction. */
async function getWalletBalance(workspaceId: string, db: PrismaClient): Promise<number> {
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

  // Load and verify all recipient contacts belong to the workspace.
  const contactIds = input.recipients.map((r) => r.contactId);
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
  for (const r of input.recipients) {
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

  const estimatedCost = Number((input.recipients.length * COST_PER_MESSAGE).toFixed(2));

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
      launchedAt: willSendNow ? new Date() : null,
      recipients: {
        create: input.recipients.map((r) => ({
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
    await dispatchCampaign(workspaceId, campaign.id, db);
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

    if (result.success) sentCount++;
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

  return dispatchCampaign(workspaceId, campaignId, db);
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

  return dispatchCampaign(workspaceId, campaignId, db);
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
