import { PrismaClient } from "@prisma/client";
import type { CreateAssignmentRuleInput, UpdateAssignmentRuleInput } from "./assignment-rules.schemas";

export async function listAssignmentRules(workspaceId: string, prisma: PrismaClient) {
  return prisma.assignmentRule.findMany({
    where: { workspaceId },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
}

export async function getAssignmentRule(id: string, workspaceId: string, prisma: PrismaClient) {
  const rule = await prisma.assignmentRule.findFirst({ where: { id, workspaceId } });
  if (!rule) throw new Error("Assignment rule not found");
  return rule;
}

export async function createAssignmentRule(workspaceId: string, input: CreateAssignmentRuleInput, prisma: PrismaClient) {
  return prisma.assignmentRule.create({
    data: {
      workspaceId,
      name: input.name,
      triggerType: input.triggerType,
      conditions: input.conditions ?? {},
      action: input.action,
      priority: input.priority ?? 0,
      enabled: input.enabled ?? true,
    },
  });
}

export async function updateAssignmentRule(id: string, workspaceId: string, input: UpdateAssignmentRuleInput, prisma: PrismaClient) {
  const rule = await prisma.assignmentRule.findFirst({ where: { id, workspaceId } });
  if (!rule) throw new Error("Assignment rule not found");
  return prisma.assignmentRule.update({ where: { id }, data: input });
}

export async function deleteAssignmentRule(id: string, workspaceId: string, prisma: PrismaClient) {
  const rule = await prisma.assignmentRule.findFirst({ where: { id, workspaceId } });
  if (!rule) throw new Error("Assignment rule not found");
  return prisma.assignmentRule.delete({ where: { id } });
}

let roundRobinIndex = 0;

export async function evaluateAssignmentRules(
  workspaceId: string,
  triggerType: string,
  context: { tags?: string[]; source?: string; skills?: string[] },
  prisma: PrismaClient
): Promise<{ type: string; targetId: string | null } | null> {
  const rules = await prisma.assignmentRule.findMany({
    where: { workspaceId, enabled: true, triggerType },
    orderBy: { priority: "desc" },
  });

  for (const rule of rules) {
    const conditions = rule.conditions as Record<string, unknown>;
    let matches = true;

    if (conditions.tags && Array.isArray(conditions.tags) && conditions.tags.length > 0) {
      if (!context.tags?.some((t) => (conditions.tags as string[]).includes(t))) {
        matches = false;
      }
    }
    if (conditions.sources && Array.isArray(conditions.sources) && conditions.sources.length > 0) {
      if (!context.source || !(conditions.sources as string[]).includes(context.source)) {
        matches = false;
      }
    }
    if (conditions.skills && Array.isArray(conditions.skills) && conditions.skills.length > 0) {
      if (!context.skills?.some((s) => (conditions.skills as string[]).includes(s))) {
        matches = false;
      }
    }

    if (matches) {
      const action = rule.action as { type: string; targetId?: string };
      if (action.type === "round_robin") {
        const agents = await prisma.agentProfile.findMany({
          where: { workspaceId, status: "online" },
        });
        if (agents.length > 0) {
          const agent = agents[roundRobinIndex % agents.length];
          roundRobinIndex = (roundRobinIndex + 1) % agents.length;
          return { type: "agent", targetId: agent.userId };
        }
      }
      return { type: action.type, targetId: action.targetId ?? null };
    }
  }

  return null;
}
