import { z } from "zod";

export const createAgentProfileSchema = z.object({
  userId: z.string().min(1),
  teamId: z.string().optional(),
  skills: z.array(z.string()).optional(),
  maxConcurrentChats: z.number().int().min(1).max(100).optional(),
});

export const updateAgentProfileSchema = z.object({
  teamId: z.string().nullable().optional(),
  status: z.enum(["online", "offline", "away", "busy"]).optional(),
  skills: z.array(z.string()).optional(),
  maxConcurrentChats: z.number().int().min(1).max(100).optional(),
});

export const listAgentsSchema = z.object({
  status: z.enum(["online", "offline", "away", "busy"]).optional(),
  teamId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateAgentProfileInput = z.infer<typeof createAgentProfileSchema>;
export type UpdateAgentProfileInput = z.infer<typeof updateAgentProfileSchema>;
export type ListAgentsInput = z.infer<typeof listAgentsSchema>;
