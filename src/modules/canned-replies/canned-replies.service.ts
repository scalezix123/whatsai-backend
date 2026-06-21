import { PrismaClient } from "@prisma/client";
import type { CreateCannedReplyInput, UpdateCannedReplyInput, ListCannedRepliesInput } from "./canned-replies.schemas";

export async function listCannedReplies(workspaceId: string, filters: ListCannedRepliesInput, prisma: PrismaClient) {
  const where: Record<string, unknown> = { workspaceId };
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" } },
      { body: { contains: filters.search, mode: "insensitive" } },
      { shortcut: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.category) where.category = filters.category;

  const [replies, total] = await Promise.all([
    prisma.cannedReply.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.cannedReply.count({ where }),
  ]);

  return { replies, total, page: filters.page, limit: filters.limit };
}

export async function getCannedReply(id: string, workspaceId: string, prisma: PrismaClient) {
  const reply = await prisma.cannedReply.findFirst({ where: { id, workspaceId } });
  if (!reply) throw new Error("Canned reply not found");
  return reply;
}

export async function createCannedReply(workspaceId: string, input: CreateCannedReplyInput, prisma: PrismaClient) {
  return prisma.cannedReply.create({
    data: {
      workspaceId,
      title: input.title,
      shortcut: input.shortcut,
      body: input.body,
      category: input.category,
      isPublic: input.isPublic ?? true,
    },
  });
}

export async function updateCannedReply(id: string, workspaceId: string, input: UpdateCannedReplyInput, prisma: PrismaClient) {
  const reply = await prisma.cannedReply.findFirst({ where: { id, workspaceId } });
  if (!reply) throw new Error("Canned reply not found");
  return prisma.cannedReply.update({ where: { id }, data: input });
}

export async function deleteCannedReply(id: string, workspaceId: string, prisma: PrismaClient) {
  const reply = await prisma.cannedReply.findFirst({ where: { id, workspaceId } });
  if (!reply) throw new Error("Canned reply not found");
  return prisma.cannedReply.delete({ where: { id } });
}
