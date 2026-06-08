import { z } from "zod";

// Meta-supported categories that map to the MessageTemplateCategory enum
export const templateCategoryEnum = z.enum(["marketing", "utility", "authentication"]);
export const templateStatusEnum = z.enum(["draft", "pending", "approved", "rejected"]);
export const headerTypeEnum = z.enum(["none", "text", "image", "video", "document"]);

const buttonSchema = z.object({
  type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
  text: z.string().min(1).max(25),
  url: z.string().url().optional(),
  phoneNumber: z.string().optional(),
});

export const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "Name must be lowercase letters, numbers and underscores only"),
  category: templateCategoryEnum.default("marketing"),
  language: z.string().default("en"),
  body: z.string().min(1).max(1024),
  headerType: headerTypeEnum.default("none"),
  headerText: z.string().max(60).optional(),
  footerText: z.string().max(60).optional(),
  buttons: z.array(buttonSchema).max(10).optional(),
  exampleValues: z.record(z.string()).optional(),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const listTemplatesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  category: templateCategoryEnum.optional(),
  status: templateStatusEnum.optional(),
});

export const syncTemplatesSchema = z.object({
  force: z.boolean().default(false),
});

// Parameter mapping validation / preview payloads
export const validateParametersSchema = z.object({
  // values keyed by placeholder token, e.g. { "{{1}}": "Alice", "{{2}}": "Acme" }
  parameters: z.record(z.string()),
});

export const previewTemplateSchema = z.object({
  parameters: z.record(z.string()).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema>;
export type ValidateParametersInput = z.infer<typeof validateParametersSchema>;
export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;
