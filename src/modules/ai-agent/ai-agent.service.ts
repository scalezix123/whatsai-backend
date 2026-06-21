import { PrismaClient } from "@prisma/client";
import type { UpdateAiAgentInput, GenerateReplyInput } from "./ai-agent.schemas";

export async function getAiAgent(workspaceId: string, prisma: PrismaClient) {
  const agent = await prisma.aiAgent.findUnique({ where: { workspaceId } });
  if (!agent) return null;
  const { apiKey, ...safeAgent } = agent;
  return { ...safeAgent, hasApiKey: Boolean(apiKey) };
}

export async function upsertAiAgent(workspaceId: string, input: UpdateAiAgentInput, prisma: PrismaClient) {
  const existing = await prisma.aiAgent.findUnique({ where: { workspaceId } });

  const updateData: Record<string, unknown> = {};
  if (input.enabled !== undefined) updateData.enabled = input.enabled;
  if (input.provider) updateData.provider = input.provider;
  if (input.model) updateData.model = input.model;
  if (input.apiKey) updateData.apiKey = input.apiKey;
  if (input.systemPrompt) updateData.systemPrompt = input.systemPrompt;
  if (input.temperature !== undefined) updateData.temperature = input.temperature;
  if (input.maxTokens) updateData.maxTokens = input.maxTokens;
  if (input.fallbackMessage) updateData.fallbackMessage = input.fallbackMessage;
  if (input.escalationTriggers) updateData.escalationTriggers = input.escalationTriggers;
  if (input.allowedTopics) updateData.allowedTopics = input.allowedTopics;
  if (input.restrictedTopics) updateData.restrictedTopics = input.restrictedTopics;

  if (existing) {
    return prisma.aiAgent.update({ where: { workspaceId }, data: updateData });
  }

  return prisma.aiAgent.create({
    data: {
      workspaceId,
      apiKey: input.apiKey || "",
      ...updateData,
    },
  });
}

function shouldEscalate(message: string, triggers: string[]): boolean {
  const lower = message.toLowerCase();
  return triggers.some((trigger) => lower.includes(trigger.toLowerCase()));
}

function buildConversationContext(messages: Array<{ direction: string; body: string }>): string {
  return messages.slice(-10).map((m) =>
    `${m.direction === "inbound" ? "Customer" : "Agent"}: ${m.body}`
  ).join("\n");
}

export async function generateAiReply(
  workspaceId: string,
  input: GenerateReplyInput,
  prisma: PrismaClient
): Promise<{ reply: string; escalated: boolean }> {
  const agent = await prisma.aiAgent.findUnique({ where: { workspaceId } });
  if (!agent || !agent.enabled) {
    return { reply: "AI agent is not enabled. Let me connect you with a human.", escalated: true };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId },
    include: {
      messages: { orderBy: { sentAt: "asc" }, take: 20 },
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const triggers = (agent.escalationTriggers as string[]) || [];
  if (shouldEscalate(input.message, triggers)) {
    return { reply: agent.fallbackMessage, escalated: true };
  }

  const context = buildConversationContext(
    conversation.messages.map((m) => ({ direction: m.direction, body: m.body }))
  );

  const knowledgeDocs = await prisma.knowledgeDocument.findMany({
    where: { workspaceId, status: "indexed" },
  });

  let knowledgeContext = "";
  for (const doc of knowledgeDocs) {
    const chunks = (doc.chunks as string[]) || [];
    const relevantChunks = chunks.filter((chunk) =>
      chunk.toLowerCase().includes(input.message.toLowerCase().split(" ").slice(0, 3).join(" "))
    );
    if (relevantChunks.length > 0) {
      knowledgeContext += `\n\nFrom ${doc.title}:\n${relevantChunks.slice(0, 3).join("\n")}`;
    }
  }

  const systemPrompt = agent.systemPrompt +
    (knowledgeContext ? `\n\nRelevant knowledge base:\n${knowledgeContext}` : "");

  let reply: string;

  if (agent.provider === "anthropic") {
    reply = await callAnthropic(agent.apiKey, agent.model, systemPrompt, context, input.message, agent.maxTokens, agent.temperature);
  } else {
    reply = await callOpenAI(agent.apiKey, agent.model, systemPrompt, context, input.message, agent.maxTokens, agent.temperature);
  }

  return { reply, escalated: false };
}

async function callAnthropic(
  apiKey: string, model: string, systemPrompt: string,
  context: string, userMessage: string, maxTokens: number, temperature: number
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        ...(context ? [{ role: "user", content: `Previous conversation:\n${context}` }] : []),
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "I'm sorry, I couldn't generate a response.";
}

async function callOpenAI(
  apiKey: string, model: string, systemPrompt: string,
  context: string, userMessage: string, maxTokens: number, temperature: number
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        ...(context ? [{ role: "user", content: `Previous conversation:\n${context}` }] : []),
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "I'm sorry, I couldn't generate a response.";
}

export async function testAiAgent(
  workspaceId: string,
  message: string,
  prisma: PrismaClient
): Promise<{ reply: string; escalated: boolean }> {
  const agent = await prisma.aiAgent.findUnique({ where: { workspaceId } });
  if (!agent || !agent.enabled) {
    return { reply: "AI agent is not enabled.", escalated: true };
  }

  const triggers = (agent.escalationTriggers as string[]) || [];
  if (shouldEscalate(message, triggers)) {
    return { reply: agent.fallbackMessage, escalated: true };
  }

  let reply: string;
  if (agent.provider === "anthropic") {
    reply = await callAnthropic(agent.apiKey, agent.model, agent.systemPrompt, "", message, agent.maxTokens, agent.temperature);
  } else {
    reply = await callOpenAI(agent.apiKey, agent.model, agent.systemPrompt, "", message, agent.maxTokens, agent.temperature);
  }

  return { reply, escalated: false };
}
