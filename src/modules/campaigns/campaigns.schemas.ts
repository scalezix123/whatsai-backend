import { z } from "zod";

export const createCampaignSchema = z.object({
  name: z.string().min(1, "Campaign name required"),
  templateId: z.string().min(1, "Template ID required"),
  contactIds: z.array(z.string()).min(1, "At least one contact required"),
  sendNow: z.boolean(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
