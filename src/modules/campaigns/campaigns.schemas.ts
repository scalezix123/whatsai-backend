import { z } from "zod";

// A recipient may carry its own parameter overrides for personalization.
export const recipientInputSchema = z.object({
  contactId: z.string().min(1),
  parameters: z.record(z.string()).optional(),
});

export const createCampaignSchema = z.object({
  name: z.string().min(1, "Campaign name required"),
  templateId: z.string().min(1, "Template ID required"),
  // Shared template parameter values applied to every recipient unless the
  // recipient supplies its own override.
  parameters: z.record(z.string()).optional(),
  recipients: z.array(recipientInputSchema).min(1, "At least one recipient required"),
  scheduledFor: z.coerce.date().optional(),
  sendNow: z.boolean().default(false),
});

export const listCampaignsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["draft", "scheduled", "sending", "delivered"]).optional(),
});

export type RecipientInput = z.infer<typeof recipientInputSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
