import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  resolveWorkspaceIdByPhoneNumberId,
  recordInboundMessage,
  applyMessageStatusByMetaId,
} from "./modules/conversations/conversations.ingest";

interface MetaWebhookStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  timestamp?: string;
}

interface MetaWebhookMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: {
    body?: string;
  };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  timestamp?: string;
}

interface MetaWebhookLeadField {
  name?: string;
  values?: string[];
}

interface MetaWebhookLeadgen {
  leadgen_id?: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
  field_data?: MetaWebhookLeadField[];
}

interface MetaWebhookChangeValue {
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  statuses?: MetaWebhookStatus[];
  messages?: MetaWebhookMessage[];
  leadgen_id?: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
  field_data?: MetaWebhookLeadField[];
}

interface MetaWebhookChange {
  field?: string;
  value?: MetaWebhookChangeValue;
}

interface MetaWebhookEntry {
  id?: string;
  changes?: MetaWebhookChange[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

export interface SummarizedWhatsAppWebhookEvent {
  kind: "whatsapp";
  object: string;
  entryId: string | null;
  field: string;
  displayPhoneNumber: string | null;
  phoneNumberId: string | null;
  messageStatuses: Array<{
    id: string | null;
    status: string | null;
    recipientId: string | null;
    timestamp: string | null;
  }>;
  inboundMessages: Array<{
    id: string | null;
    from: string | null;
    type: string | null;
    body: string | null;
    interactiveId: string | null;
    interactiveTitle: string | null;
    timestamp: string | null;
  }>;
}

export interface SummarizedLeadWebhookEvent {
  kind: "leadgen";
  object: string;
  entryId: string | null;
  field: string;
  pageId: string | null;
  adId: string | null;
  adgroupId: string | null;
  leadgenId: string | null;
  createdTime: number | null;
  fieldData: Array<{
    name: string | null;
    values: string[];
  }>;
}

export type SummarizedMetaWebhookEvent = SummarizedWhatsAppWebhookEvent | SummarizedLeadWebhookEvent;

export function summarizeMetaWebhookPayload(payload: unknown): SummarizedMetaWebhookEvent[] {
  const typed = payload as MetaWebhookPayload;
  const entries = typed.entry ?? [];

  return entries.flatMap((entry) =>
    (entry.changes ?? []).map((change) => {
      if (change.field === "leadgen") {
        return {
          kind: "leadgen" as const,
          object: typed.object ?? "unknown",
          entryId: entry.id ?? null,
          field: change.field ?? "leadgen",
          pageId: change.value?.page_id ?? null,
          adId: change.value?.ad_id ?? null,
          adgroupId: change.value?.adgroup_id ?? null,
          leadgenId: change.value?.leadgen_id ?? null,
          createdTime: change.value?.created_time ?? null,
          fieldData: (change.value?.field_data ?? []).map((field) => ({
            name: field.name ?? null,
            values: field.values ?? [],
          })),
        };
      }

      return {
        kind: "whatsapp" as const,
        object: typed.object ?? "unknown",
        entryId: entry.id ?? null,
        field: change.field ?? "unknown",
        displayPhoneNumber: change.value?.metadata?.display_phone_number ?? null,
        phoneNumberId: change.value?.metadata?.phone_number_id ?? null,
        messageStatuses: (change.value?.statuses ?? []).map((status) => ({
          id: status.id ?? null,
          status: status.status ?? null,
          recipientId: status.recipient_id ?? null,
          timestamp: status.timestamp ?? null,
        })),
        inboundMessages: (change.value?.messages ?? []).map((message) => ({
          id: message.id ?? null,
          from: message.from ?? null,
          type: message.type ?? null,
          body: message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? message.text?.body ?? null,
          interactiveId: message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? null,
          interactiveTitle: message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null,
          timestamp: message.timestamp ?? null,
        })),
      };
    }),
  );
}

/**
 * Persistent, idempotent webhook claim. Returns true the first time an event is
 * seen and false on any redelivery — surviving restarts/redeploys, unlike the old
 * in-memory Set (which also baked Date.now() into its key and so never matched).
 *
 * The fingerprint is a content hash of the summarized event: Meta redelivers the
 * exact same payload, so a retry hashes identically, while genuinely new events
 * (different message/lead ids) hash differently. The `fingerprint @unique`
 * constraint makes the claim atomic across concurrent webhook deliveries.
 */
export async function claimWebhookEvent(event: any): Promise<boolean> {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");

  try {
    await prisma.processedWebhookEvent.create({
      data: { fingerprint, eventType: event?.kind ?? "unknown" },
    });
    return true;
  } catch (error) {
    // Unique-violation => we've already processed this exact event.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }
    // Any other DB error: fail OPEN (process the event). Every downstream write
    // is independently idempotent (inbound by metaMessageId, leads by metaLeadId,
    // statuses by id), so reprocessing is safe and beats silently dropping.
    console.error("[webhook] dedup claim failed; processing anyway", error);
    return true;
  }
}

/** Persist a received webhook event for the admin observability feed. Best-effort. */
async function captureWebhookEvent(
  workspaceId: string,
  eventType: string,
  event: unknown
): Promise<void> {
  try {
    await prisma.metaWebhookEvent.create({
      data: {
        workspaceId,
        eventType,
        payload: event as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[webhook] failed to capture MetaWebhookEvent", error);
  }
}

export async function persistWhatsAppWebhookEvent(
  event: SummarizedWhatsAppWebhookEvent
): Promise<void> {
  const workspaceId = await resolveWorkspaceIdByPhoneNumberId(event.phoneNumberId, prisma);
  if (!workspaceId) {
    console.warn(
      `[webhook] No workspace for phone_number_id=${event.phoneNumberId}; dropping event`
    );
    return;
  }

  // Observability: capture the event so /ops/webhook-events has data.
  await captureWebhookEvent(workspaceId, "whatsapp", event);

  // Inbound customer messages -> conversation timeline.
  for (const message of event.inboundMessages) {
    if (!message.from) continue;
    await recordInboundMessage(
      workspaceId,
      {
        from: message.from,
        body: message.body,
        type: message.type,
        metaMessageId: message.id,
        timestamp: message.timestamp,
      },
      prisma
    );
  }

  // Delivery receipts -> campaign recipient + conversation message status.
  for (const status of event.messageStatuses) {
    if (!status.id || !status.status) continue;
    await applyMessageStatusByMetaId(workspaceId, status.id, status.status, prisma);
  }
}

function leadFieldValue(
  fields: SummarizedLeadWebhookEvent["fieldData"],
  ...names: string[]
): string | null {
  for (const name of names) {
    const match = fields.find((f) => (f.name ?? "").toLowerCase() === name.toLowerCase());
    if (match && match.values.length > 0) return match.values[0];
  }
  return null;
}

export async function persistLeadgenWebhookEvent(
  event: SummarizedLeadWebhookEvent
): Promise<void> {
  // Resolve the workspace from a configured page/ad/form mapping.
  const mapping = await prisma.metaLeadSourceMapping.findFirst({
    where: {
      OR: [
        event.pageId ? { pageId: event.pageId } : undefined,
        event.adId ? { adId: event.adId } : undefined,
      ].filter(Boolean) as Prisma.MetaLeadSourceMappingWhereInput[],
    },
    select: { workspaceId: true, label: true },
  });

  if (!mapping) {
    console.warn(
      `[webhook] No lead-source mapping for page=${event.pageId} ad=${event.adId}; dropping leadgen`
    );
    return;
  }

  // Observability: capture the event so /ops/webhook-events has data.
  await captureWebhookEvent(mapping.workspaceId, "leadgen", event);

  const fullName =
    leadFieldValue(event.fieldData, "full_name", "name") ?? "Unknown lead";
  const phone = leadFieldValue(event.fieldData, "phone_number", "phone") ?? "";
  const email = leadFieldValue(event.fieldData, "email") ?? "";

  try {
    await prisma.lead.create({
      data: {
        workspaceId: mapping.workspaceId,
        metaLeadId: event.leadgenId ?? undefined,
        fullName,
        phone,
        email,
        status: "new",
        source: "meta_ads",
        sourceLabel: mapping.label,
      },
    });
  } catch (error) {
    // Unique violation on metaLeadId => already ingested; ignore.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }
}
