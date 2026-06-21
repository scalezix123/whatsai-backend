import { z } from "zod";

export const createPaymentLinkSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("INR"),
  description: z.string().max(500),
  contactId: z.string().optional(),
  conversationId: z.string().optional(),
  templateName: z.string().optional(),
});

export const updatePaymentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  keyId: z.string().optional(),
  keySecret: z.string().optional(),
  webhookSecret: z.string().optional(),
});

export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;
export type UpdatePaymentConfigInput = z.infer<typeof updatePaymentConfigSchema>;
