import { PrismaClient } from "@prisma/client";

export async function sendMetaCapiEvent(
  workspaceId: string,
  data: { eventName: string; pixelId: string; capiToken: string; userData: Record<string, unknown>; customData?: Record<string, unknown> },
  prisma: PrismaClient
) {
  const response = await fetch(`https://graph.facebook.com/v21.0/${data.pixelId}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.capiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: [{
        event_name: data.eventName,
        event_time: Math.floor(Date.now() / 1000),
        user_data: data.userData,
        custom_data: data.customData || {},
      }],
    }),
  });

  const result = await response.json();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "MetaCapiEvent" ("id", "workspaceId", "eventName", "pixelId", "status", "response", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
    workspaceId, data.eventName, data.pixelId, response.ok ? "success" : "failed", JSON.stringify(result)
  );

  return { success: response.ok, result };
}

export async function getCapiEvents(workspaceId: string, prisma: PrismaClient) {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "MetaCapiEvent" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
    workspaceId
  );
}
