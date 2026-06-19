import { z } from "zod";

export const createTrackedLinkSchema = z.object({
  originalUrl: z.string().url("A valid destination URL is required"),
  title: z.string().optional(),
  // Optional custom slug; auto-generated when omitted. Lowercased, url-safe.
  code: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, "Code may contain only letters, numbers, - and _")
    .min(3)
    .max(40)
    .optional(),
  campaignId: z.string().optional(),
});

export type CreateTrackedLinkInput = z.infer<typeof createTrackedLinkSchema>;
