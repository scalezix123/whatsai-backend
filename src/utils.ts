import { prisma } from "./prisma";

export async function logOperationalEvent(params: {
  workspaceId: string;
  eventType: string;
  level: "info" | "warning" | "error";
  summary: string;
  payload?: any;
}): Promise<void> {
  console.log(`[${params.level.toUpperCase()}] ${params.eventType}: ${params.summary}`, params.payload);
  // TODO: Implement persistent logging in Phase 1
}

export async function logFailedSend(params: {
  workspaceId: string;
  channel: string;
  destination: string;
  messageBody?: string;
  templateName?: string;
  payload?: any;
}): Promise<void> {
  console.log(`Failed send logged: ${params.channel} to ${params.destination}`);
  // TODO: Implement persistent failed send logging in Phase 1
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function getActiveMetaAuthorization(
  workspaceId: string,
): Promise<{ accessToken: string } | null> {
  try {
    const auth = await prisma.metaAuthorization.findFirst({
      where: {
        workspaceId,
        status: "active",
      },
      select: { accessToken: true },
    });
    return auth;
  } catch {
    console.error("Failed to get Meta authorization");
    return null;
  }
}

export async function getEnabledAutomationRule(
  workspaceId: string,
  ruleType: string,
) {
  try {
    const rule = await prisma.automationRule.findFirst({
      where: {
        workspaceId,
        ruleType,
        isEnabled: true,
      },
    });
    return rule;
  } catch {
    return null;
  }
}

export async function logAutomationEvent(params: {
  workspaceId: string;
  ruleType: string;
  conversationId?: string;
  status: string;
  summary: string;
}) {
  console.log(`Automation event: ${params.ruleType} - ${params.summary}`);
  // TODO: Implement automation event logging in Phase 1
}
