import { z } from "zod";

// OAuth exchange
export const metaExchangeSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});
export type MetaExchangeInput = z.infer<typeof metaExchangeSchema>;

// Send template message
export const metaSendTemplateSchema = z.object({
  to: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().min(1),
  bodyParameters: z.array(z.string()).optional(),
});
export type MetaSendTemplateInput = z.infer<typeof metaSendTemplateSchema>;

// Send campaign (batch template send)
export const metaSendCampaignSchema = z.object({
  templateId: z.string().min(1),
  contactIds: z.array(z.string()).min(1),
  bodyParameters: z.array(z.string()).optional(),
});
export type MetaSendCampaignInput = z.infer<typeof metaSendCampaignSchema>;

// Send reply (text message)
export const metaReplySchema = z.object({
  conversationId: z.string().uuid(),
  to: z.string().min(1),
  body: z.string().min(1).max(4096),
});
export type MetaReplyInput = z.infer<typeof metaReplySchema>;

// Lead source mapping
export const metaLeadSourceMappingSchema = z.object({
  label: z.string().default(""),
  pageId: z.string().optional().default(""),
  adId: z.string().optional().default(""),
  formId: z.string().optional().default(""),
});
export type MetaLeadSourceMappingInput = z.infer<typeof metaLeadSourceMappingSchema>;
