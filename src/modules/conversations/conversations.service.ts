import { PrismaClient, Prisma } from "@prisma/client";
import type {
  ListConversationsInput,
  UpdateConversationInput,
  AddMessageInput,
  AssignConversationInput,
  AddNoteInput,
} from "./conversations.schemas";
import { broadcastToWorkspace } from "../realtime";

export async function listConversations(
  workspaceId: string,
  filters: ListConversationsInput,
  db: PrismaClient
) {
  const where: Prisma.ConversationWhereInput = { workspaceId };

  if (filters.search) {
    where.OR = [
      { displayName: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search } },
      { contact: { name: { contains: filters.search, mode: "insensitive" } } },
    ];
  }
  if (filters.status) where.status = filters.status;
  if (filters.assignedTo) where.assignedTo = filters.assignedTo;
  if (filters.unassigned) where.assignedTo = null;

  const orderBy: Prisma.ConversationOrderByWithRelationInput =
    filters.sortBy === "createdAt"
      ? { createdAt: "desc" }
      : filters.sortBy === "updatedAt"
        ? { updatedAt: "desc" }
        : { lastMessageAt: "desc" };

  const [total, conversations] = await Promise.all([
    db.conversation.count({ where }),
    db.conversation.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, phone: true, optInStatus: true } },
        messages: { take: 1, orderBy: { sentAt: "desc" } },
      },
      orderBy,
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, conversations, page: filters.page, limit: filters.limit };
}

export async function getConversation(id: string, workspaceId: string, db: PrismaClient) {
  const conversation = await db.conversation.findFirst({
    where: { id, workspaceId },
    include: {
      contact: true,
      messages: { orderBy: { sentAt: "asc" }, take: 200 },
      notes: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!conversation) throw new Error("Conversation not found");
  return conversation;
}

async function ensureConversation(id: string, workspaceId: string, db: PrismaClient) {
  const conversation = await db.conversation.findFirst({ where: { id, workspaceId } });
  if (!conversation) throw new Error("Conversation not found");
  return conversation;
}

export async function updateConversation(
  id: string,
  workspaceId: string,
  input: UpdateConversationInput,
  db: PrismaClient
) {
  const conversation = await ensureConversation(id, workspaceId, db);

  if (input.assignedTo) {
    const user = await db.user.findFirst({ where: { id: input.assignedTo, workspaceId } });
    if (!user) throw new Error("User not found");
  }

  const updated = await db.conversation.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
    },
    include: { contact: true },
  });

  if (input.status !== undefined && input.status !== conversation.status) {
    await db.conversationEvent.create({
      data: {
        workspaceId,
        conversationId: id,
        eventType: "status_changed",
        summary: `Status changed to ${input.status}`,
      },
    });
  }

  broadcastToWorkspace(workspaceId, "conversation_updated", {
    conversationId: id,
    status: updated.status,
    assignedTo: updated.assignedTo,
  });

  return updated;
}

/** Record an agent-authored outbound message into the conversation timeline. */
export async function addMessage(
  conversationId: string,
  workspaceId: string,
  input: AddMessageInput,
  db: PrismaClient
) {
  await ensureConversation(conversationId, workspaceId, db);

  const message = await db.conversationMessage.create({
    data: {
      workspaceId,
      conversationId,
      direction: "outbound",
      messageType: input.messageType,
      body: input.body,
      status: "sent",
      sentAt: new Date(),
    },
  });

  await db.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessagePreview: input.body.length > 140 ? `${input.body.slice(0, 137)}...` : input.body,
      lastMessageAt: new Date(),
    },
  });

  broadcastToWorkspace(workspaceId, "new_message", {
    conversationId,
    message: {
      id: message.id,
      body: message.body,
      direction: "Outbound",
      sentAt: message.sentAt.toISOString(),
    },
  });

  return message;
}

export async function assignConversation(
  id: string,
  workspaceId: string,
  input: AssignConversationInput,
  db: PrismaClient
) {
  await ensureConversation(id, workspaceId, db);

  if (input.userId) {
    const user = await db.user.findFirst({ where: { id: input.userId, workspaceId } });
    if (!user) throw new Error("User not found");
  }

  const updated = await db.conversation.update({
    where: { id },
    data: { assignedTo: input.userId },
    include: { contact: true },
  });

  await db.conversationEvent.create({
    data: {
      workspaceId,
      conversationId: id,
      eventType: "assignment_changed",
      summary: input.userId ? `Assigned to ${input.userId}` : "Unassigned",
    },
  });

  return updated;
}

export async function addNote(
  conversationId: string,
  workspaceId: string,
  input: AddNoteInput,
  db: PrismaClient
) {
  await ensureConversation(conversationId, workspaceId, db);

  return db.conversationNote.create({
    data: {
      workspaceId,
      conversationId,
      body: input.body,
      authorName: input.authorName ?? "",
    },
  });
}

export async function markConversationAsRead(
  id: string,
  workspaceId: string,
  db: PrismaClient
) {
  await ensureConversation(id, workspaceId, db);
  return db.conversation.update({ where: { id }, data: { unreadCount: 0 } });
}
