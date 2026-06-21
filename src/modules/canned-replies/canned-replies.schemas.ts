import { z } from "zod";

export const createCannedReplySchema = z.object({
  title: z.string().min(1).max(200),
  shortcut: z.string().max(50).optional(),
  body: z.string().min(1).max(5000),
  category: z.string().max(100).optional(),
  isPublic: z.boolean().optional(),
});

export const updateCannedReplySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  shortcut: z.string().max(50).optional(),
  body: z.string().min(1).max(5000).optional(),
  category: z.string().max(100).optional(),
  isPublic: z.boolean().optional(),
});

export const listCannedRepliesSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateCannedReplyInput = z.infer<typeof createCannedReplySchema>;
export type UpdateCannedReplyInput = z.infer<typeof updateCannedReplySchema>;
export type ListCannedRepliesInput = z.infer<typeof listCannedRepliesSchema>;
