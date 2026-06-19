import { z } from "zod";

export const leadStatusEnum = z.enum(["new", "contacted", "qualified", "won", "lost"]);
export const leadSourceEnum = z.enum([
  "meta_ads",
  "whatsapp_inbound",
  "campaign",
  "manual",
  "organic",
]);

export const listLeadsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: leadStatusEnum.optional(),
  source: leadSourceEnum.optional(),
  assignedTo: z.string().optional(),
  sortBy: z.enum(["createdAt", "updatedAt"]).default("updatedAt"),
});

// A lead can be created from an existing contact (fullName/phone derived) or
// from explicit identity fields.
export const createLeadSchema = z
  .object({
    contactId: z.string().optional(),
    fullName: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
    source: leadSourceEnum.default("manual"),
    sourceLabel: z.string().optional(),
    notes: z.string().optional(),
    conversationId: z.string().optional(),
  })
  .refine((v) => !!v.contactId || (!!v.fullName && !!v.phone), {
    message: "Provide a contactId, or both fullName and phone",
  });

export const updateLeadStatusSchema = z.object({
  status: leadStatusEnum,
  note: z.string().optional(),
});

export const addLeadNoteSchema = z.object({
  content: z.string().min(1),
  authorName: z.string().optional(),
});

export const assignLeadSchema = z.object({
  userId: z.string().nullable(),
});

export type ListLeadsInput = z.infer<typeof listLeadsSchema>;
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;
export type AddLeadNoteInput = z.infer<typeof addLeadNoteSchema>;
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;
