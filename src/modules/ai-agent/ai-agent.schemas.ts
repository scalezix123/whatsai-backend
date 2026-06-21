import { z } from "zod";

export const updateAiAgentSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["anthropic", "openai"]).optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  systemPrompt: z.string().max(10000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  fallbackMessage: z.string().max(1000).optional(),
  escalationTriggers: z.array(z.string()).optional(),
  allowedTopics: z.array(z.string()).optional(),
  restrictedTopics: z.array(z.string()).optional(),
});

export const generateReplySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(5000),
});

export type UpdateAiAgentInput = z.infer<typeof updateAiAgentSchema>;
export type GenerateReplyInput = z.infer<typeof generateReplySchema>;
