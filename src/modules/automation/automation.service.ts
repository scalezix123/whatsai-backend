import { prisma } from "../../prisma";
import { getCurrentUser } from "../../state";
import type { CreateDefinitionInput, LeadContactedInput } from "./automation.schemas";
import { processFlowRun as engineProcessFlowRun, startFlowForLead } from "../../flowEngine";
import { logOperationalEvent } from "../../utils";

export async function getAutomationDefinitions() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const definitions = await prisma.automationFlowDefinition.findMany({
    where: { workspaceId: user.workspaceId },
    orderBy: { updatedAt: "desc" },
  });

  return definitions;
}

export async function createOrUpdateAutomationDefinition(
  input: CreateDefinitionInput,
) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  if (!input.name?.trim()) {
    throw new Error("Flow name is required.");
  }

  let definition;
  if (input.id) {
    definition = await prisma.automationFlowDefinition.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(),
        description: input.description,
        nodes: input.nodes || [],
        edges: input.edges || [],
        isActive: input.is_active ?? true,
      },
    });
  } else {
    definition = await prisma.automationFlowDefinition.create({
      data: {
        workspaceId: user.workspaceId,
        name: input.name.trim(),
        description: input.description,
        nodes: input.nodes || [],
        edges: input.edges || [],
        isActive: input.is_active ?? true,
      },
    });
  }

  return definition;
}

export async function processAutomationFlows(cronSecret?: string) {
  const isCronAuthorized =
    cronSecret && cronSecret === process.env.CRON_SECRET;

  const user = await getCurrentUser(prisma);

  if (!user && !isCronAuthorized) {
    throw new Error(
      "Authorization or CRON_SECRET is required to process automation flows.",
    );
  }

  const workspaceId = user?.workspaceId;
  if (!workspaceId && !isCronAuthorized) {
    return { ok: true, message: "No workspace context." };
  }

  const where: Record<string, unknown> = {
    status: "active",
    scheduledAt: { lte: new Date() },
  };
  if (workspaceId) where.workspaceId = workspaceId;

  const dueFlows = await prisma.automationFlowRun.findMany({ where });

  if (!dueFlows || dueFlows.length === 0) {
    return { ok: true, message: "No due automation flows to process." };
  }

  let processed = 0;
  let failed = 0;

  for (const flowRun of dueFlows) {
    try {
      await engineProcessFlowRun({
        id: flowRun.id,
        workspaceId: flowRun.workspaceId,
        leadId: flowRun.leadId,
        conversationId: flowRun.conversationId,
        flowDefinitionId: flowRun.flowDefinitionId,
        currentNodeId: flowRun.currentNodeId,
        status: flowRun.status as "active" | "completed" | "failed" | "paused",
        retryCount: flowRun.retryCount,
        scheduledAt: flowRun.scheduledAt,
      });
      processed++;
    } catch (error) {
      failed++;
      console.error(`Failed to process flow run ${flowRun.id}:`, error);
      await logOperationalEvent({
        workspaceId: flowRun.workspaceId,
        eventType: "flow.run_failed",
        level: "error",
        summary: `Flow run ${flowRun.id} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        payload: { flowRunId: flowRun.id },
      });
    }
  }

  return {
    ok: true,
    message: `Processed ${processed} flow(s), ${failed} failed.`,
  };
}

export async function processReminders() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const staleHours = 24;
  const staleThreshold = new Date(Date.now() - staleHours * 60 * 60 * 1000);

  const staleConversations = await prisma.conversation.findMany({
    where: {
      workspaceId: user.workspaceId,
      status: "open",
      lastMessageAt: { lt: staleThreshold },
      assignedTo: { not: null },
    },
    take: 50,
  });

  let remindersSent = 0;
  for (const conv of staleConversations) {
    const hoursSinceLastMessage = Math.round(
      (Date.now() - conv.lastMessageAt.getTime()) / (60 * 60 * 1000)
    );
    await prisma.conversationEvent.create({
      data: {
        workspaceId: user.workspaceId,
        conversationId: conv.id,
        eventType: "reminder",
        summary: `No reply for ${hoursSinceLastMessage}h. Conversation assigned to ${conv.assignedTo}.`,
        actorName: "System",
      },
    });
    remindersSent++;
  }

  return {
    ok: true,
    message: `Created ${remindersSent} reminder event(s) for stale conversations.`,
  };
}

export async function processLeadContacted(input: LeadContactedInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      conversationId: true,
      source: true,
      workspaceId: true,
    },
  });

  if (!lead) {
    throw new Error("Lead not found.");
  }

  try {
    const flowRun = await startFlowForLead(lead.workspaceId, lead.id);
    if (flowRun) {
      await logOperationalEvent({
        workspaceId: lead.workspaceId,
        eventType: "flow.started",
        level: "info",
        summary: `Flow started for lead ${lead.fullName} (${lead.id})`,
        payload: { leadId: lead.id, flowRunId: flowRun.id },
      });
    }
  } catch (error) {
    console.error(`Failed to start flow for lead ${lead.id}:`, error);
  }

  return {
    ok: true,
    message: "Lead contact automation processed.",
    lead,
  };
}

export async function deleteAutomationDefinition(id: string) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const definition = await prisma.automationFlowDefinition.findFirst({
    where: { id, workspaceId: user.workspaceId },
  });
  if (!definition) throw new Error("Flow definition not found");

  await prisma.automationFlowRun.deleteMany({ where: { flowDefinitionId: id } });
  return prisma.automationFlowDefinition.delete({ where: { id } });
}
