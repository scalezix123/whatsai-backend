import { z } from "zod";

// A recipient may carry its own parameter overrides for personalization.
export const recipientInputSchema = z.object({
  contactId: z.string().min(1),
  parameters: z.record(z.string()).optional(),
});

// Retarget the recipients of a previous campaign, filtered by how they engaged.
export const retargetSchema = z.object({
  fromCampaignId: z.string().min(1),
  // Recipient delivery statuses to include (e.g. ["delivered"], ["failed"]).
  statuses: z.array(z.enum(["queued", "sent", "delivered", "failed"])).optional(),
  // Further restrict to contacts who did (true) / did not (false) click a
  // tracked link attributed to the source campaign.
  clicked: z.boolean().optional(),
});

// Recurring schedule: each run clones a fresh campaign for the next occurrence.
export const recurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  interval: z.coerce.number().int().min(1).default(1),
  until: z.coerce.date().optional(),
});

export const createCampaignSchema = z
  .object({
    name: z.string().min(1, "Campaign name required"),
    templateId: z.string().min(1, "Template ID required"),
    // Shared template parameter values applied to every recipient unless the
    // recipient supplies its own override.
    parameters: z.record(z.string()).optional(),
    // Exactly one audience source: explicit recipients, a saved segment, or a
    // retarget rule over a previous campaign.
    recipients: z.array(recipientInputSchema).optional(),
    segmentId: z.string().min(1).optional(),
    retarget: retargetSchema.optional(),
    scheduledFor: z.coerce.date().optional(),
    recurrence: recurrenceSchema.optional(),
    sendNow: z.boolean().default(false),
  })
  .refine(
    (v) =>
      [v.recipients?.length ? 1 : 0, v.segmentId ? 1 : 0, v.retarget ? 1 : 0].reduce(
        (a, b) => a + b,
        0
      ) === 1,
    { message: "Provide exactly one audience source: recipients, segmentId, or retarget" }
  )
  .refine((v) => !(v.recurrence && !v.scheduledFor), {
    message: "A recurring campaign needs a scheduledFor start time",
  });

export const listCampaignsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["draft", "scheduled", "sending", "delivered"]).optional(),
});

export type RecipientInput = z.infer<typeof recipientInputSchema>;
export type RetargetInput = z.infer<typeof retargetSchema>;
export type RecurrenceInput = z.infer<typeof recurrenceSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
