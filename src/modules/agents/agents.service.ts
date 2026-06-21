import { PrismaClient } from "@prisma/client";
import type { CreateAgentProfileInput, UpdateAgentProfileInput, ListAgentsInput } from "./agents.schemas";

export async function listAgents(workspaceId: string, filters: ListAgentsInput, prisma: PrismaClient) {
  const where: Record<string, unknown> = { workspaceId };
  if (filters.status) where.status = filters.status;
  if (filters.teamId) where.teamId = filters.teamId;
  if (filters.search) {
    where.user = { name: { contains: filters.search, mode: "insensitive" } };
  }

  const [agents, total] = await Promise.all([
    prisma.agentProfile.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: { lastActiveAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.agentProfile.count({ where }),
  ]);

  return { agents, total, page: filters.page, limit: filters.limit };
}

export async function getAgentProfile(id: string, workspaceId: string, prisma: PrismaClient) {
  const profile = await prisma.agentProfile.findFirst({
    where: { id, workspaceId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      team: { select: { id: true, name: true } },
    },
  });
  if (!profile) throw new Error("Agent profile not found");
  return profile;
}

export async function getAgentProfileByUserId(userId: string, workspaceId: string, prisma: PrismaClient) {
  return prisma.agentProfile.findFirst({
    where: { userId, workspaceId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      team: { select: { id: true, name: true } },
    },
  });
}

export async function createAgentProfile(workspaceId: string, input: CreateAgentProfileInput, prisma: PrismaClient) {
  const existing = await prisma.agentProfile.findFirst({ where: { userId: input.userId, workspaceId } });
  if (existing) throw new Error("Agent profile already exists for this user");

  return prisma.agentProfile.create({
    data: {
      workspaceId,
      userId: input.userId,
      teamId: input.teamId,
      skills: input.skills ?? [],
      maxConcurrentChats: input.maxConcurrentChats ?? 10,
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      team: { select: { id: true, name: true } },
    },
  });
}

export async function updateAgentProfile(id: string, workspaceId: string, input: UpdateAgentProfileInput, prisma: PrismaClient) {
  const profile = await prisma.agentProfile.findFirst({ where: { id, workspaceId } });
  if (!profile) throw new Error("Agent profile not found");

  return prisma.agentProfile.update({
    where: { id },
    data: input,
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      team: { select: { id: true, name: true } },
    },
  });
}

export async function deleteAgentProfile(id: string, workspaceId: string, prisma: PrismaClient) {
  const profile = await prisma.agentProfile.findFirst({ where: { id, workspaceId } });
  if (!profile) throw new Error("Agent profile not found");
  return prisma.agentProfile.delete({ where: { id } });
}

export async function updateAgentStatus(userId: string, workspaceId: string, status: string, prisma: PrismaClient) {
  return prisma.agentProfile.updateMany({
    where: { userId, workspaceId },
    data: { status, lastActiveAt: new Date() },
  });
}
