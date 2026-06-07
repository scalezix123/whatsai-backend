import { z } from "zod";

export const shortLinkSchema = z.object({
  code: z.string().min(1),
  contactId: z.string().optional(),
  workspaceId: z.string().optional(),
});

export const brandingQuerySchema = z.object({
  ref: z.string().min(1),
});

export type ShortLinkInput = z.infer<typeof shortLinkSchema>;
