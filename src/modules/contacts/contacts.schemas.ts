import { z } from "zod";

// Basic schemas
export const createContactSchema = z.object({
  name: z.string().min(1, "Name required"),
  phone: z.string().min(10, "Phone must be at least 10 digits"),
  email: z.string().email().optional(),
  tags: z.array(z.string()).default([]),
  optInStatus: z.enum(["opt_in", "opt_out", "unknown"]).default("unknown").optional(),
});

export const updateContactSchema = createContactSchema.partial();

// Query params arrive as strings; coerce numbers and accept tags as a single
// value or repeated key (?tags=a&tags=b).
const queryStringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

export const listContactsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  tags: queryStringArray,
  optInStatus: z.enum(["opt_in", "opt_out", "unknown"]).optional(),
  sortBy: z.enum(["createdAt", "name", "lastMessage"]).default("createdAt"),
});

// Tag management schemas
export const createTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
});

export const listTagsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

// Attribute management schemas
export const createAttributeSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "date", "boolean", "json"]).default("string"),
  defaultValue: z.string().optional(),
  isRequired: z.boolean().default(false),
});

export const setAttributeValueSchema = z.object({
  contactId: z.string(),
  attributeName: z.string(),
  value: z.string(),
});

// CSV Import schemas
export const startContactImportSchema = z.object({
  columnMapping: z.record(z.string()), // { "Name": "name", "Phone": "phone", ... }
  skipDuplicates: z.boolean().default(true),
  overwriteExisting: z.boolean().default(false),
});

export const listImportBatchesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
});

export const getImportBatchSchema = z.object({
  batchId: z.string(),
});

// Consent management schemas
export const markContactOptInSchema = z.object({
  contactId: z.string(),
});

export const markContactOptOutSchema = z.object({
  contactId: z.string(),
  reason: z.string().optional(),
});

export const bulkUpdateOptInSchema = z.object({
  contactIds: z.array(z.string()),
  optInStatus: z.enum(["opt_in", "opt_out"]),
});

// Type exports
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListContactsInput = z.infer<typeof listContactsSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type ListTagsInput = z.infer<typeof listTagsSchema>;
export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;
export type SetAttributeValueInput = z.infer<typeof setAttributeValueSchema>;
export type StartContactImportInput = z.infer<typeof startContactImportSchema>;
export type ListImportBatchesInput = z.infer<typeof listImportBatchesSchema>;
export type MarkContactOptInInput = z.infer<typeof markContactOptInSchema>;
export type MarkContactOptOutInput = z.infer<typeof markContactOptOutSchema>;
export type BulkUpdateOptInInput = z.infer<typeof bulkUpdateOptInSchema>;
