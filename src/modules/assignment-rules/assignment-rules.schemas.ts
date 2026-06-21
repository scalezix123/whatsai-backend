import { z } from "zod";

export const createAssignmentRuleSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum(["inbound", "campaign_reply", "manual"]),
  conditions: z.object({
    tags: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  }).optional(),
  action: z.object({
    type: z.enum(["team", "agent", "round_robin"]),
    targetId: z.string().optional(),
  }),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

export const updateAssignmentRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  triggerType: z.enum(["inbound", "campaign_reply", "manual"]).optional(),
  conditions: z.object({
    tags: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  }).optional(),
  action: z.object({
    type: z.enum(["team", "agent", "round_robin"]),
    targetId: z.string().optional(),
  }).optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

export type CreateAssignmentRuleInput = z.infer<typeof createAssignmentRuleSchema>;
export type UpdateAssignmentRuleInput = z.infer<typeof updateAssignmentRuleSchema>;
