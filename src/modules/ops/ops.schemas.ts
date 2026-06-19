import { z } from "zod";

export const listOperationalLogsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Prefix match, so `eventType=audit` returns every `audit.*` event.
  eventType: z.string().optional(),
  level: z.enum(["info", "warning", "error"]).optional(),
  search: z.string().optional(),
});

export const listFailedSendsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["failed", "resolved"]).optional(),
  channel: z.string().optional(),
});

export const listWebhookEventsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  eventType: z.string().optional(),
});

export const retryFailedSendSchema = z.object({
  // IDs are cuids, not uuids.
  failedSendLogId: z.string().min(1, "failedSendLogId required"),
});

export type ListOperationalLogsInput = z.infer<typeof listOperationalLogsSchema>;
export type ListFailedSendsInput = z.infer<typeof listFailedSendsSchema>;
export type ListWebhookEventsInput = z.infer<typeof listWebhookEventsSchema>;
export type RetryFailedSendInput = z.infer<typeof retryFailedSendSchema>;
