import { prisma } from "./prisma";
import { sendMetaTemplateMessage, sendMetaInteractiveMessage } from "./meta";
import { broadcastToWorkspace } from "./modules/realtime";
import { evaluateAssignmentRules } from "./modules/assignment-rules/assignment-rules.service";

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
  context?: Record<string, unknown>;
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

      case "assign_agent": {
        await handleAssignAgent(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
        break;
      }

      case "handoff_to_human": {
        await handleHandoffToHuman(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
        break;
      }

      case "send_text": {
        await handleSendText(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
        break;
      }

      case "api_request": {
        await handleApiRequest(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
        break;
      }

      case "update_lead": {
        await handleUpdateLead(flowRun, node.data);
        nextNodeId = findNextNodeId(node.id, edges);
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
        data: { status: "completed", completedAt: new Date() },
      });
      broadcastToWorkspace(flowRun.workspaceId, "flow_completed", {
        flowRunId: flowRun.id,
        flowDefinitionId: flowRun.flowDefinitionId,
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
      broadcastToWorkspace(flowRun.workspaceId, "flow_failed", {
        flowRunId: flowRun.id,
        flowDefinitionId: flowRun.flowDefinitionId,
        error: error instanceof Error ? error.message : "Unknown error",
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

async function handleAssignAgent(flowRun: FlowRun, config: any) {
  const lead = await prisma.lead.findUnique({
    where: { id: flowRun.leadId },
    select: { contactId: true },
  });

  if (config.targetTeamId) {
    await prisma.lead.update({
      where: { id: flowRun.leadId },
      data: { assignedTo: config.targetTeamId },
    });
  }

  if (flowRun.conversationId) {
    const assignment = await evaluateAssignmentRules(
      flowRun.workspaceId,
      "inbound",
      { tags: [], source: "automation" },
      prisma
    );
    if (assignment?.targetId) {
      await prisma.conversation.update({
        where: { id: flowRun.conversationId },
        data: { assignedTo: assignment.targetId },
      });
      await prisma.conversationEvent.create({
        data: {
          workspaceId: flowRun.workspaceId,
          conversationId: flowRun.conversationId,
          eventType: "assignment_changed",
          summary: `Auto-assigned by flow to ${assignment.targetId}`,
        },
      });
    }
  }
}

async function handleHandoffToHuman(flowRun: FlowRun, config: any) {
  if (flowRun.conversationId) {
    await prisma.conversation.update({
      where: { id: flowRun.conversationId },
      data: {
        status: "open",
        assignedTo: null,
      },
    });

    await prisma.conversationEvent.create({
      data: {
        workspaceId: flowRun.workspaceId,
        conversationId: flowRun.conversationId,
        eventType: "handoff",
        summary: config.handoffMessage || "Bot handed off conversation to human agent",
      },
    });

    broadcastToWorkspace(flowRun.workspaceId, "handoff", {
      conversationId: flowRun.conversationId,
      message: config.handoffMessage || "Conversation handed off to human agent",
    });
  }

  if (config.pauseBot) {
    await prisma.automationFlowRun.update({
      where: { id: flowRun.id },
      data: { status: "paused" },
    });
  }
}

async function handleSendText(flowRun: FlowRun, config: any) {
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
  if (!lead.phone?.trim()) throw new Error(`Lead ${flowRun.leadId} has no phone number.`);

  const messageBody = (config.body || "").replace("{{contact.name}}", lead.fullName);

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${connection.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: lead.phone,
        type: "text",
        text: { body: messageBody },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send text message: ${error}`);
  }
}

async function handleApiRequest(flowRun: FlowRun, config: any) {
  const url = config.url;
  if (!url) throw new Error("API request node requires a URL");

  const method = (config.method || "GET").toUpperCase();
  const headers = (config.headers || {}) as Record<string, string>;
  const body = config.body ? JSON.stringify(config.body) : undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`API request failed (${response.status}): ${errorText}`);
    }

    const responseData = await response.json().catch(() => null);

    if (config.responseMapping && responseData) {
      const context = (flowRun.context as Record<string, unknown>) || {};
      for (const [key, path] of Object.entries(config.responseMapping as Record<string, string>)) {
        const value = path.split(".").reduce((obj: any, k) => obj?.[k], responseData);
        if (value !== undefined) {
          context[key] = value;
        }
      }
      await prisma.automationFlowRun.update({
        where: { id: flowRun.id },
        data: { context: context as any },
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function handleUpdateLead(flowRun: FlowRun, config: any) {
  const updateData: Record<string, unknown> = {};
  if (config.status) updateData.status = config.status;
  if (config.assignedTo) updateData.assignedTo = config.assignedTo;
  if (config.notes) updateData.notes = config.notes;

  if (Object.keys(updateData).length > 0) {
    await prisma.lead.update({
      where: { id: flowRun.leadId },
      data: updateData,
    });
    broadcastToWorkspace(flowRun.workspaceId, "lead_updated", {
      leadId: flowRun.leadId,
      ...updateData,
    });
  }
}
