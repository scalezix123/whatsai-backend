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
