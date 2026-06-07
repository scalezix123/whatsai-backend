import { PrismaClient } from "@prisma/client";
import type {
  ListConversationsInput,
  UpdateConversationInput,
  AddMessageInput,
  AssignConversationInput,
  AddNoteInput,
} from "./conversations.schemas";

export async function listConversations(
  workspaceId: string,
  filters: ListConversationsInput,
  db: PrismaClient
) {
  const where: any = { workspaceId };

  if (filters.search) {
    where.OR = [
      { subject: { contains: filters.search, mode: "insensitive" } },
      { contact: { name: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.assignedTo) {
    where.assignedTo = filters.assignedTo;
  }

  const orderBy: any = {};
  switch (filters.sortBy) {
    case "createdAt":
      orderBy.createdAt = "desc";
      break;
    case "lastMessage":
      orderBy.updatedAt = "desc";
      break;
    case "updatedAt":
    default:
      orderBy.updatedAt = "desc";
  }

  const [total, conversations] = await Promise.all([
    db.conversation.count({ where }),
    db.conversation.findMany({
      where,
      include: {
        contact: true,
        assignedUser: true,
        messages: { take: 1, orderBy: { createdAt: "desc" } },
      },
      orderBy,
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, conversations, page: filters.page, limit: filters.limit };
}

export async function getConversation(id: string, workspaceId: string, db: PrismaClient) {
  const conversation = await db.conversation.findUnique({
    where: { id },
    include: {
      contact: true,
      assignedUser: true,
      messages: { orderBy: { createdAt: "asc" }, take: 50 },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!conversation || conversation.workspaceId !== workspaceId) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

export async function updateConversation(
  id: string,
  workspaceId: string,
  input: UpdateConversationInput,
  db: PrismaClient
) {
  const conversation = await db.conversation.findUnique({
    where: { id },
  });

  if (!conversation || conversation.workspaceId !== workspaceId) {
    throw new Error("Conversation not found");
  }

  return await db.conversation.update({
    where: { id },
    data: {
      status: input.status,
      assignedTo: input.assignedTo,
      subject: input.subject,
      tags: input.tags,
    },
    include: { contact: true, assignedUser: true },
  });
}

export async function addMessage(
  conversationId: string,
  workspaceId: string,
  input: AddMessageInput,
  db: PrismaClient
) {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation || conversation.workspaceId !== workspaceId) {
    throw new Error("Conversation not found");
  }

  return await db.conversationMessage.create({
    data: {
      conversationId,
      body: input.body,
      messageType: input.messageType,
      mediaUrl: input.mediaUrl,
      mediaType: input.mediaType,
      templateId: input.templateId,
      templateParams: input.templateParams,
      isFromUser: true,
    },
  });
}

export async function assignConversation(
  id: string,
  workspaceId: string,
  input: AssignConversationInput,
  db: PrismaClient
) {
  const conversation = await db.conversation.findUnique({
    where: { id },
  });

  if (!conversation || conversation.workspaceId !== workspaceId) {
    throw new Error("Conversation not found");
  }

  return await db.conversation.update({
    where: { id },
    data: { assignedTo: input.userId },
    include: { contact: true, assignedUser: true },
  });
}

export async function addNote(
  conversationId: string,
  workspaceId: string,
  input: AddNoteInput,
  db: PrismaClient
) {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation || conversation.workspaceId !== workspaceId) {
    throw new Error("Conversation not found");
  }

  return await db.conversationNote.create({
    data: {
      conversationId,
      content: input.content,
    },
  });
}

export async function markConversationAsRead(
  id: string,
  workspaceId: string,
  db: PrismaClient
) {
  const conversation = await db.conversation.findUnique({
    where: { id },
  });

  if (!conversation || conversation.workspaceId !== workspaceId) {
    throw new Error("Conversation not found");
  }

  return await db.conversation.update({
    where: { id },
    data: { unreadCount: 0 },
  });
}
