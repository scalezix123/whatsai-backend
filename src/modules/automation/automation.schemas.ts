import { z } from "zod";

export const getDefinitionsSchema = z.object({});

export const createDefinitionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Flow name required"),
  description: z.string().optional(),
  nodes: z.array(z.any()).default([]),
  edges: z.array(z.any()).default([]),
  is_active: z.boolean().default(true),
});

export const processFlowsSchema = z.object({});

export const processRemindersSchema = z.object({});

export const leadContactedSchema = z.object({
  leadId: z.string().uuid("Invalid lead ID"),
});

export type CreateDefinitionInput = z.infer<typeof createDefinitionSchema>;
export type LeadContactedInput = z.infer<typeof leadContactedSchema>;
