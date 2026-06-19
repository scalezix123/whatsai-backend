import { PrismaClient, Prisma } from "@prisma/client";
import type {
  ListOperationalLogsInput,
  ListFailedSendsInput,
  ListWebhookEventsInput,
  RetryFailedSendInput,
} from "./ops.schemas";

export async function listOperationalLogs(
  workspaceId: string,
  filters: ListOperationalLogsInput,
  db: PrismaClient
) {
  const where: Prisma.OperationalLogWhereInput = { workspaceId };
  if (filters.eventType) where.eventType = { startsWith: filters.eventType };
  if (filters.level) where.level = filters.level;
  if (filters.search) where.summary = { contains: filters.search, mode: "insensitive" };

  const [total, logs] = await Promise.all([
    db.operationalLog.count({ where }),
    db.operationalLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, logs, page: filters.page, limit: filters.limit };
}

export async function listFailedSends(
  workspaceId: string,
  filters: ListFailedSendsInput,
  db: PrismaClient
) {
  const where: Prisma.FailedSendLogWhereInput = { workspaceId };
  if (filters.status) where.status = filters.status;
  if (filters.channel) where.channel = filters.channel;

  const [total, logs] = await Promise.all([
    db.failedSendLog.count({ where }),
    db.failedSendLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, logs, page: filters.page, limit: filters.limit };
}

export async function listWebhookEvents(
  workspaceId: string,
  filters: ListWebhookEventsInput,
  db: PrismaClient
) {
  const where: Prisma.MetaWebhookEventWhereInput = { workspaceId };
  if (filters.eventType) where.eventType = { startsWith: filters.eventType };

  const [total, events] = await Promise.all([
    db.metaWebhookEvent.count({ where }),
    db.metaWebhookEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, events, page: filters.page, limit: filters.limit };
}

export async function retryFailedSend(
  workspaceId: string,
  input: RetryFailedSendInput,
  db: PrismaClient
) {
  const failedLog = await db.failedSendLog.findFirst({
    where: { workspaceId, id: input.failedSendLogId },
  });
  if (!failedLog) {
    throw new Error("Failed send log not found for this workspace.");
  }

  const connection = await db.whatsAppConnection.findFirst({
    where: { workspaceId },
    select: { phone_number_id: true },
  });
  if (!connection?.phone_number_id) {
    throw new Error("No connected Meta phone number was found for this workspace.");
  }

  await db.failedSendLog.update({
    where: { id: failedLog.id },
    data: {
      retryCount: (failedLog.retryCount ?? 0) + 1,
      lastAttemptAt: new Date(),
      status: "resolved",
      resolvedAt: new Date(),
    },
  });

  return { ok: true, message: "Failed send retried successfully." };
}
