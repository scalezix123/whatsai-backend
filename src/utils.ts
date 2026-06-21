import { prisma } from "./prisma";

export async function logOperationalEvent(params: {
  workspaceId: string;
  eventType: string;
  level: "info" | "warning" | "error";
  summary: string;
  payload?: any;
}): Promise<void> {
  console.log(`[${params.level.toUpperCase()}] ${params.eventType}: ${params.summary}`, params.payload);
  // Persist to the OperationalLog table. Never let logging break the caller.
  try {
    await prisma.operationalLog.create({
      data: {
        workspaceId: params.workspaceId,
        eventType: params.eventType,
        level: params.level,
        summary: params.summary,
        payload: (params.payload ?? {}) as any,
      },
    });
  } catch (error) {
    console.error("Failed to persist operational log", error);
  }
}

/**
 * Audit log = an OperationalLog with an `audit.<action>` event type and the
 * acting user recorded in the payload. Surfaced via GET /ops/logs?eventType=audit.
 */
export async function logAuditEvent(params: {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  summary: string;
  payload?: any;
}): Promise<void> {
  await logOperationalEvent({
    workspaceId: params.workspaceId,
    eventType: `audit.${params.action}`,
    level: "info",
    summary: params.summary,
    payload: { ...(params.payload ?? {}), actorId: params.actorId ?? null },
  });
}

export async function logFailedSend(params: {
  workspaceId: string;
  channel: string;
  targetType?: string;
  targetId?: string;
  destination: string;
  messageBody?: string;
  templateName?: string;
  errorMessage?: string;
  payload?: any;
}): Promise<void> {
  console.log(`Failed send logged: ${params.channel} to ${params.destination}`);
  try {
    await prisma.failedSendLog.create({
      data: {
        workspaceId: params.workspaceId,
        channel: params.channel,
        targetType: params.targetType ?? "workspace",
        targetId: params.targetId ?? null,
        destination: params.destination,
        templateName: params.templateName ?? null,
        messageBody: params.messageBody ?? null,
        errorMessage: params.errorMessage ?? "Unknown error",
        payload: (params.payload ?? {}) as any,
      },
    });
  } catch (error) {
    console.error("Failed to persist failed send log", error);
  }
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
        ruleType: ruleType as any,
        enabled: true,
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
  try {
    await prisma.automationEvent.create({
      data: {
        workspaceId: params.workspaceId,
        ruleType: params.ruleType as any,
        conversationId: params.conversationId || null,
        status: params.status,
        summary: params.summary,
      },
    });
  } catch (error) {
    console.error("Failed to log automation event:", error);
  }
}
