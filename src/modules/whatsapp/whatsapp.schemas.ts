import { z } from "zod";

export const getConnectionHealthSchema = z.object({});

export const testSendSchema = z.object({
  to: z.string().min(1, "Phone number required"),
  messageType: z.enum(["text", "template"]),
  body: z.string().optional(),
  templateName: z.string().optional(),
  language: z.string().optional().default("en"),
});

export const connectWhatsAppSchema = z.object({
  businessPortfolio: z.string().min(1),
  wabaName: z.string().min(4),
  phoneNumber: z.string().min(10).max(15),
  businessName: z.string().min(1),
});

export type ConnectWhatsAppInput = z.infer<typeof connectWhatsAppSchema>;

export type TestSendInput = z.infer<typeof testSendSchema>;
