import { z } from "zod";

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(512),
  category: z.enum(["MARKETING", "OTP", "TRANSACTIONAL", "AUTHENTICATION"]).default("MARKETING"),
  language: z.string().default("en"),
  headerType: z.enum(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).default("NONE"),
  headerText: z.string().optional(),
  headerUrl: z.string().optional(),
  bodyText: z.string().min(1),
  footerText: z.string().optional(),
  buttons: z
    .array(
      z.object({
        type: z.enum(["TEXT", "PHONE_NUMBER", "URL", "QUICK_REPLY"]),
        text: z.string(),
        phoneNumber: z.string().optional(),
        url: z.string().optional(),
      })
    )
    .optional(),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const listTemplatesSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]).optional(),
});

export const syncTemplatesSchema = z.object({
  force: z.boolean().default(false),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema>;
