import { z } from "zod";

export const getConnectionHealthSchema = z.object({});

export const testSendSchema = z.object({
  to: z.string().min(1, "Phone number required"),
  messageType: z.enum(["text", "template"]),
  body: z.string().optional(),
  templateName: z.string().optional(),
  language: z.string().optional().default("en"),
});

export type TestSendInput = z.infer<typeof testSendSchema>;
