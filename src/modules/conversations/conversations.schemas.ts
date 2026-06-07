import { z } from "zod";

export const listConversationsSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["open", "closed", "archived"]).optional(),
  assignedTo: z.string().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "lastMessage"]).default("updatedAt"),
});

export const getConversationSchema = z.object({
  id: z.string(),
});

export const updateConversationSchema = z.object({
  status: z.enum(["open", "closed", "archived"]).optional(),
  assignedTo: z.string().optional(),
  subject: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const addMessageSchema = z.object({
  body: z.string().min(1),
  messageType: z.enum(["text", "image", "file", "template"]).default("text"),
  mediaUrl: z.string().optional(),
  mediaType: z.enum(["image", "video", "audio", "document"]).optional(),
  templateId: z.string().optional(),
  templateParams: z.record(z.string()).optional(),
});

export const assignConversationSchema = z.object({
  userId: z.string(),
});

export const addNoteSchema = z.object({
  content: z.string().min(1),
});

export type ListConversationsInput = z.infer<typeof listConversationsSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type AddMessageInput = z.infer<typeof addMessageSchema>;
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
