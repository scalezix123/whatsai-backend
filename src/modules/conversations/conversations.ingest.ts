import { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../contacts/contacts.service";

/**
 * Shared conversation/message ingestion used by BOTH the inbound webhook handler
 * (src/metaWebhook.ts) and the campaign dispatch engine. Keeping it in one place
 * means inbound and outbound messages land in the same conversation timeline and
 * delivery-status updates resolve consistently by `metaMessageId`.
 */

const OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"];

/** WhatsApp webhook `from` is a bare MSISDN (no +). Normalize to our stored form. */
export function toPhoneKey(raw: string): string {
  const withPlus = raw.startsWith("+") ? raw : `+${raw}`;
  return normalizePhone(withPlus);
}

export function isOptOutKeyword(body: string | null | undefined): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.includes(normalized);
}

/** Map a phone_number_id (from the webhook metadata) to the owning workspace. */
export async function resolveWorkspaceIdByPhoneNumberId(
  phoneNumberId: string | null,
  db: PrismaClient
): Promise<string | null> {
  if (!phoneNumberId) return null;
  const connection = await db.whatsAppConnection.findFirst({
    where: { phone_number_id: phoneNumberId },
    select: { workspaceId: true },
  });
  return connection?.workspaceId ?? null;
}

/** Find an existing conversation for a phone, or create one (linking a contact if present). */
export async function findOrCreateConversation(
  workspaceId: string,
  phone: string,
  db: PrismaClient
) {
  const existing = await db.conversation.findFirst({ where: { workspaceId, phone } });
  if (existing) return existing;

  const contact = await db.contact.findFirst({ where: { workspaceId, phone } });

  return db.conversation.create({
    data: {
      workspaceId,
      phone,
      contactId: contact?.id ?? null,
      displayName: contact?.name ?? phone,
      status: "open",
      source: "whatsapp_inbound",
    },
  });
}

function previewOf(body: string): string {
  return body.length > 140 ? `${body.slice(0, 137)}...` : body;
}

interface InboundMessageInput {
  from: string;
  body: string | null;
  type: string | null;
  metaMessageId: string | null;
  timestamp: string | null;
}

/**
 * Persist an inbound WhatsApp message: upsert its conversation, append the
 * message (idempotent by metaMessageId), bump unread/preview, refresh the
 * contact's lastMessageAt, and honor STOP/UNSUBSCRIBE opt-out keywords.
 */
export async function recordInboundMessage(
  workspaceId: string,
  input: InboundMessageInput,
  db: PrismaClient
) {
  const phone = toPhoneKey(input.from);
  const conversation = await findOrCreateConversation(workspaceId, phone, db);

  // Idempotency: don't double-insert the same Meta message id.
  if (input.metaMessageId) {
    const dup = await db.conversationMessage.findFirst({
      where: { conversationId: conversation.id, metaMessageId: input.metaMessageId },
      select: { id: true },
    });
    if (dup) return { conversation, message: null, deduped: true };
  }

  const body = input.body ?? "";
  const sentAt = input.timestamp ? new Date(Number(input.timestamp) * 1000) : new Date();

  const message = await db.conversationMessage.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      metaMessageId: input.metaMessageId ?? null,
      direction: "inbound",
      messageType: input.type ?? "text",
      body,
      status: "received",
      sentAt,
    },
  });

  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessagePreview: previewOf(body),
      lastMessageAt: sentAt,
      unreadCount: { increment: 1 },
      status: "open",
    },
  });

  // Keep the contact's recency fresh; honor opt-out keywords (Stage 2 consent).
  if (conversation.contactId) {
    await db.contact.update({
      where: { id: conversation.contactId },
      data: {
        lastMessageAt: sentAt,
        ...(isOptOutKeyword(body)
          ? { optInStatus: "opt_out", optedOutAt: new Date(), optOutSource: "keyword" }
          : {}),
      },
    });
  }

  return { conversation, message, deduped: false };
}

interface OutboundMessageInput {
  contactId: string | null;
  phone: string;
  body: string;
  messageType: string;
  metaMessageId: string | null;
}

/**
 * Record an outbound message (e.g. a campaign template send) into the contact's
 * conversation timeline so delivery-status webhooks can update it by metaMessageId.
 */
export async function recordOutboundMessage(
  workspaceId: string,
  input: OutboundMessageInput,
  db: PrismaClient
) {
  const phone = normalizePhone(input.phone);
  const conversation = await findOrCreateConversation(workspaceId, phone, db);

  const message = await db.conversationMessage.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      metaMessageId: input.metaMessageId ?? null,
      direction: "outbound",
      messageType: input.messageType,
      body: input.body,
      status: "sent",
      sentAt: new Date(),
    },
  });

  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessagePreview: previewOf(input.body), lastMessageAt: new Date() },
  });

  return { conversation, message };
}

// Meta delivery status -> our RecipientStatus enum (queued|sent|delivered|failed).
function toRecipientStatus(metaStatus: string): "sent" | "delivered" | "failed" | null {
  switch (metaStatus) {
    case "sent":
      return "sent";
    case "delivered":
    case "read":
      return "delivered";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/**
 * Apply a Meta message-status update (sent/delivered/read/failed) to both the
 * campaign recipient and the conversation message that carry this metaMessageId.
 * This is the webhook half of the campaign delivery loop.
 */
export async function applyMessageStatusByMetaId(
  workspaceId: string,
  metaMessageId: string,
  metaStatus: string,
  db: PrismaClient
) {
  // Conversation message: store the raw Meta status string.
  const msgUpdate = await db.conversationMessage.updateMany({
    where: { workspaceId, metaMessageId },
    data: { status: metaStatus },
  });

  // Campaign recipient: map to the RecipientStatus enum.
  const mapped = toRecipientStatus(metaStatus);
  let recipientUpdate = { count: 0 };
  if (mapped) {
    recipientUpdate = await db.campaignRecipient.updateMany({
      where: { workspaceId, metaMessageId },
      data: {
        status: mapped,
        ...(mapped === "failed" ? { error: "Reported failed by Meta webhook" } : {}),
      },
    });
  }

  return { messagesUpdated: msgUpdate.count, recipientsUpdated: recipientUpdate.count };
}
