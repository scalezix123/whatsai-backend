import { prisma } from "./prisma";
import { sendMetaTemplateMessage, sendMetaInteractiveMessage } from "./meta";

export type FlowStepType = "wait" | "tag" | "send_message" | "send_interactive" | "condition";

export interface FlowStep {
  type: FlowStepType;
  config: Record<string, any>;
}

export interface FlowRun {
  id: string;
  workspaceId: string;
  leadId: string;
  conversationId?: string | null;
  flowDefinitionId?: string | null;
  currentNodeId?: string | null;
  status: "active" | "completed" | "failed" | "paused";
  retryCount: number;
  scheduledAt: Date | string;
}

export interface FlowNode {
  id: string;
  type: string;
  data: any;
}

export interface FlowEdge {
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface FlowDefinition {
  id: string;
  workspaceId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export async function startFlowForLead(
  workspaceId: string,
  leadId: string,
) {
  // Find the active "Meta Lead" flow definition
  const definition = await prisma.automationFlowDefinition.findFirst({
    where: {
      workspaceId: workspaceId,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!definition) {
    console.error("No active flow definition found for Meta Lead trigger.");
    return;
  }

  // Find the trigger node
  const nodes = definition.nodes as any[];
  const triggerNode = nodes.find((n: any) => n.type === "trigger" || n.type === "lead_trigger");
  const firstNodeId = triggerNode?.id;

  const flowRun = await prisma.automationFlowRun.create({
    data: {
      workspaceId: workspaceId,
      leadId: leadId,
      flowDefinitionId: definition.id,
      currentNodeId: firstNodeId,
      status: "active",
      scheduledAt: new Date(),
    },
    select: { id: true },
  });

  return flowRun;
}

export async function processFlowRun(
  flowRun: FlowRun,
) {
  if (!flowRun.flowDefinitionId || !flowRun.currentNodeId) {
    await prisma.automationFlowRun.update({
      where: { id: flowRun.id },
      data: { status: "failed" },
    });
    return;
  }

  const definition = await prisma.automationFlowDefinition.findUnique({
    where: { id: flowRun.flowDefinitionId },
  });

  if (!definition) {
    await prisma.automationFlowRun.update({
      where: { id: flowRun.id },
      data: { status: "failed" },
    });
    return;
  }

  const nodes = definition.nodes as unknown as FlowNode[];
  const edges = definition.edges as unknown as FlowEdge[];
  const node = nodes.find((n) => n.id === flowRun.currentNodeId);

  if (!node) {
    await prisma.automationFlowRun.update({
      where: { id: flowRun.id },
      data: { status: "completed" },
    });
    return;
  }

  try {
    let nextNodeId: string | null = null;
    let delayHours = 0;

    switch (node.type) {
      case "trigger":
      case "lead_trigger":
        nextNodeId = findNextNodeId(node.id, edges);
        break;

      case "tag":
        await handleTagStep(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
        break;

      case "wait":
        delayHours = (node.data as any)?.hours ?? 1;
        nextNodeId = findNextNodeId(node.id, edges);
        break;

      case "send_message":
        await handleFlowMessageSend(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
        break;

      case "send_interactive":
        await handleFlowInteractiveSend(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
        break;

      case "condition": {
        const result = await evaluateCondition(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges, result ? "true" : "false");
        break;
      }
    }

    if (nextNodeId) {
      await prisma.automationFlowRun.update({
        where: { id: flowRun.id },
        data: {
          currentNodeId: nextNodeId,
          scheduledAt: new Date(Date.now() + delayHours * 60 * 60 * 1000),
          retryCount: 0,
        },
      });
    } else {
      await prisma.automationFlowRun.update({
        where: { id: flowRun.id },
        data: { status: "completed" },
      });
    }
  } catch (error) {
    console.error(`Flow node ${flowRun.currentNodeId} failed`, error);
    if ((flowRun.retryCount ?? 0) < 3) {
      await prisma.automationFlowRun.update({
        where: { id: flowRun.id },
        data: {
          retryCount: (flowRun.retryCount ?? 0) + 1,
          scheduledAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
    } else {
      await prisma.automationFlowRun.update({
        where: { id: flowRun.id },
        data: { status: "failed" },
      });
    }
  }
}

function findNextNodeId(nodeId: string, edges: FlowEdge[], sourceHandle?: string): string | null {
  const edge = edges.find((e) => e.source === nodeId && (!sourceHandle || e.sourceHandle === sourceHandle));
  return edge ? edge.target : null;
}

async function handleTagStep(flowRun: FlowRun, data: any) {
  const lead = await prisma.lead.findUnique({
    where: { id: flowRun.leadId },
    select: { contactId: true },
  });

  if (lead?.contactId) {
    await prisma.contactTag.upsert({
      where: {
        contactId_tag: {
          contactId: lead.contactId,
          tag: data.tag,
        },
      },
      update: { workspaceId: flowRun.workspaceId },
      create: {
        workspaceId: flowRun.workspaceId,
        contactId: lead.contactId,
        tag: data.tag,
      },
    });
  }
}

async function evaluateCondition(flowRun: FlowRun, data: any): Promise<boolean> {
  if (data.type === "has_tag") {
    const lead = await prisma.lead.findUnique({
      where: { id: flowRun.leadId },
      select: { contactId: true },
    });

    if (lead?.contactId) {
      const tag = await prisma.contactTag.findUnique({
        where: {
          contactId_tag: {
            contactId: lead.contactId,
            tag: data.tag,
          },
        },
      });
      return !!tag;
    }
  }
  return false;
}

async function handleFlowMessageSend(flowRun: FlowRun, config: any) {
  const [connection, auth, lead] = await Promise.all([
    prisma.whatsAppConnection.findFirst({
      where: { workspaceId: flowRun.workspaceId },
      select: { phone_number_id: true },
    }),
    prisma.metaAuthorization.findUnique({
      where: { workspaceId: flowRun.workspaceId },
      select: { accessToken: true },
    }),
    prisma.lead.findUnique({
      where: { id: flowRun.leadId },
      select: { phone: true, fullName: true },
    }),
  ]);

  if (!connection || !auth || !lead) throw new Error("Missing flow prerequisites.");
  if (!lead.phone?.trim()) throw new Error(`Lead ${flowRun.leadId} has no phone number; cannot send template.`);

  await sendMetaTemplateMessage({
    accessToken: auth.accessToken,
    phoneNumberId: connection.phone_number_id!,
    to: lead.phone,
    templateName: config.templateName,
    languageCode: config.languageCode || "en",
    bodyParameters: [lead.fullName],
  });
}

async function handleFlowInteractiveSend(flowRun: FlowRun, config: any) {
  const [connection, auth, lead] = await Promise.all([
    prisma.whatsAppConnection.findFirst({
      where: { workspaceId: flowRun.workspaceId },
      select: { phone_number_id: true },
    }),
    prisma.metaAuthorization.findUnique({
      where: { workspaceId: flowRun.workspaceId },
      select: { accessToken: true },
    }),
    prisma.lead.findUnique({
      where: { id: flowRun.leadId },
      select: { phone: true },
    }),
  ]);

  if (!connection || !auth || !lead) throw new Error("Missing flow prerequisites.");
  if (!lead.phone?.trim()) throw new Error(`Lead ${flowRun.leadId} has no phone number; cannot send interactive message.`);

  await sendMetaInteractiveMessage({
    accessToken: auth.accessToken,
    phoneNumberId: connection.phone_number_id!,
    to: lead.phone,
    type: "button",
    body: config.body,
    buttons: config.buttons,
  });
}
