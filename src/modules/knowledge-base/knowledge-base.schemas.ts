import { z } from "zod";

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(["url", "text", "faq"]),
  content: z.string().min(1).max(100000),
});

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(100000).optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
