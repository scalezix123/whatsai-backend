import { z } from "zod";

export const conversationStatusEnum = z.enum(["open", "pending", "resolved"]);

export const listConversationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: conversationStatusEnum.optional(),
  assignedTo: z.string().optional(),
  unassigned: z.coerce.boolean().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "lastMessage"]).default("lastMessage"),
});

export const updateConversationSchema = z.object({
  status: conversationStatusEnum.optional(),
  assignedTo: z.string().nullable().optional(),
});

// Agent-authored outbound message recorded into the timeline.
export const addMessageSchema = z.object({
  body: z.string().min(1),
  messageType: z
    .enum(["text", "image", "video", "audio", "document", "template"])
    .default("text"),
});

export const assignConversationSchema = z.object({
  userId: z.string().nullable(),
});

export const addNoteSchema = z.object({
  body: z.string().min(1),
  authorName: z.string().optional(),
});

export type ListConversationsInput = z.infer<typeof listConversationsSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type AddMessageInput = z.infer<typeof addMessageSchema>;
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
