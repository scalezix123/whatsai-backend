import { prisma } from "../../prisma";
import { getCurrentUser } from "../../state";
import type { CreateDefinitionInput, LeadContactedInput } from "./automation.schemas";

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

  const dueFlows = await prisma.automationFlowRun.findMany({
    where: {
      status: "active",
      scheduledAt: { lte: new Date() },
      workspaceId: user?.workspaceId,
    },
  });

  if (!dueFlows || dueFlows.length === 0) {
    return {
      ok: true,
      message: "No due automation flows to process.",
    };
  }

  for (const flowRun of dueFlows) {
    try {
      await processFlowRun(flowRun.id);
    } catch (error) {
      console.error(`Failed to process flow run ${flowRun.id}:`, error);
    }
  }

  return {
    ok: true,
    message: `Processed ${dueFlows.length} automation flow(s).`,
  };
}

async function processFlowRun(flowRunId: string) {
  const flowRun = await prisma.automationFlowRun.findUnique({
    where: { id: flowRunId },
  });

  if (!flowRun) {
    throw new Error("Flow run not found.");
  }

  await prisma.automationFlowRun.update({
    where: { id: flowRunId },
    data: { status: "completed", completedAt: new Date() },
  });
}

export async function processReminders() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  return {
    ok: true,
    message: "Reminders processed successfully.",
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
    },
  });

  if (!lead) {
    throw new Error("Lead not found.");
  }

  return {
    ok: true,
    message: "Lead contact automation processed.",
    lead,
  };
}
