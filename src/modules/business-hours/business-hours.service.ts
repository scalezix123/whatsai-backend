import { PrismaClient } from "@prisma/client";
import type { UpsertBusinessHoursInput } from "./business-hours.schemas";

export async function getBusinessHours(workspaceId: string, prisma: PrismaClient) {
  return prisma.businessHours.findMany({
    where: { workspaceId },
    orderBy: { dayOfWeek: "asc" },
  });
}

export async function upsertBusinessHours(
  workspaceId: string,
  input: UpsertBusinessHoursInput,
  prisma: PrismaClient
) {
  return prisma.businessHours.upsert({
    where: { workspaceId_dayOfWeek: { workspaceId, dayOfWeek: input.dayOfWeek } },
    create: {
      workspaceId,
      dayOfWeek: input.dayOfWeek,
      openTime: input.openTime,
      closeTime: input.closeTime,
      isClosed: input.isClosed ?? false,
      timezone: input.timezone ?? "Asia/Kolkata",
      welcomeMessage: input.welcomeMessage,
      offHoursMessage: input.offHoursMessage,
    },
    update: {
      openTime: input.openTime,
      closeTime: input.closeTime,
      isClosed: input.isClosed ?? false,
      timezone: input.timezone,
      welcomeMessage: input.welcomeMessage,
      offHoursMessage: input.offHoursMessage,
    },
  });
}

export async function bulkUpsertBusinessHours(
  workspaceId: string,
  entries: UpsertBusinessHoursInput[],
  prisma: PrismaClient
) {
  const results = [];
  for (const entry of entries) {
    const result = await upsertBusinessHours(workspaceId, entry, prisma);
    results.push(result);
  }
  return results;
}

export async function isWithinBusinessHours(workspaceId: string, prisma: PrismaClient): Promise<boolean> {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();

  const hours = await prisma.businessHours.findFirst({
    where: { workspaceId, dayOfWeek },
  });

  if (!hours || hours.isClosed) return false;

  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentTime = `${String(utcHours).padStart(2, "0")}:${String(utcMinutes).padStart(2, "0")}`;

  return currentTime >= hours.openTime && currentTime <= hours.closeTime;
}

export async function getOffHoursMessage(workspaceId: string, prisma: PrismaClient): Promise<string | null> {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();

  const hours = await prisma.businessHours.findFirst({
    where: { workspaceId, dayOfWeek },
  });

  if (!hours || hours.isClosed) {
    const defaultHours = await prisma.businessHours.findFirst({
      where: { workspaceId },
      orderBy: { dayOfWeek: "asc" },
    });
    return defaultHours?.offHoursMessage ?? null;
  }

  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentTime = `${String(utcHours).padStart(2, "0")}:${String(utcMinutes).padStart(2, "0")}`;

  if (currentTime < hours.openTime || currentTime > hours.closeTime) {
    return hours.offHoursMessage;
  }

  return null;
}
