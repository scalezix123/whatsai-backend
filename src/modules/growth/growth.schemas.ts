import { z } from "zod";

export const createWhatsAppLinkSchema = z.object({
  phone: z.string().min(10),
  message: z.string().max(1000).optional(),
  title: z.string().max(200).optional(),
});

export type CreateWhatsAppLinkInput = z.infer<typeof createWhatsAppLinkSchema>;
