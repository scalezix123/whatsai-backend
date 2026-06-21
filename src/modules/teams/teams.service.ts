import { PrismaClient } from "@prisma/client";
import type { CreateTeamInput, UpdateTeamInput } from "./teams.schemas";

export async function listTeams(workspaceId: string, prisma: PrismaClient) {
  return prisma.team.findMany({
    where: { workspaceId },
    include: {
      members: {
        select: {
          id: true,
          userId: true,
          status: true,
          currentChats: true,
          totalResolved: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function getTeam(id: string, workspaceId: string, prisma: PrismaClient) {
  const team = await prisma.team.findFirst({
    where: { id, workspaceId },
    include: {
      members: {
        select: {
          id: true,
          userId: true,
          status: true,
          skills: true,
          maxConcurrentChats: true,
          currentChats: true,
          totalResolved: true,
          avgResponseTime: true,
          lastActiveAt: true,
        },
      },
    },
  });
  if (!team) throw new Error("Team not found");
  return team;
}

export async function createTeam(workspaceId: string, input: CreateTeamInput, prisma: PrismaClient) {
  return prisma.team.create({
    data: {
      workspaceId,
      name: input.name,
      description: input.description,
    },
  });
}

export async function updateTeam(id: string, workspaceId: string, input: UpdateTeamInput, prisma: PrismaClient) {
  const team = await prisma.team.findFirst({ where: { id, workspaceId } });
  if (!team) throw new Error("Team not found");
  return prisma.team.update({
    where: { id },
    data: input,
  });
}

export async function deleteTeam(id: string, workspaceId: string, prisma: PrismaClient) {
  const team = await prisma.team.findFirst({ where: { id, workspaceId } });
  if (!team) throw new Error("Team not found");
  await prisma.agentProfile.updateMany({ where: { teamId: id }, data: { teamId: null } });
  return prisma.team.delete({ where: { id } });
}
