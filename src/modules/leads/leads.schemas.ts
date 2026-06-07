import { z } from "zod";

export const listLeadsSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
  source: z.enum(["meta_ads", "whatsapp", "campaign"]).optional(),
  assignedTo: z.string().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "value"]).default("updatedAt"),
});

export const getLeadSchema = z.object({
  id: z.string(),
});

export const updateLeadStatusSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "won", "lost"]),
  reason: z.string().optional(),
});

export const addLeadNoteSchema = z.object({
  content: z.string().min(1),
  type: z.enum(["note", "activity", "follow_up"]).default("note"),
});

export const createLeadSchema = z.object({
  contactId: z.string(),
  source: z.enum(["meta_ads", "whatsapp", "campaign"]),
  value: z.number().optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export type ListLeadsInput = z.infer<typeof listLeadsSchema>;
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;
export type AddLeadNoteInput = z.infer<typeof addLeadNoteSchema>;
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
