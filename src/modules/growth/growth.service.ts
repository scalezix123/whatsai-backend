import { PrismaClient } from "@prisma/client";
import type { CreateWhatsAppLinkInput } from "./growth.schemas";

export async function createWhatsAppLink(workspaceId: string, input: CreateWhatsAppLinkInput, prisma: PrismaClient) {
  const phone = input.phone.replace(/[^0-9]/g, "");
  const encodedMessage = input.message ? encodeURIComponent(input.message) : "";
  const waUrl = `https://wa.me/${phone}${encodedMessage ? `?text=${encodedMessage}` : ""}`;

  const code = `wa-${Date.now().toString(36)}`;

  await prisma.trackedLink.create({
    data: {
      workspaceId,
      code,
      originalUrl: waUrl,
      title: input.title || `WhatsApp Link ${phone}`,
    },
  });

  return { code, url: waUrl, shortUrl: `/t/${code}` };
}

export async function getWhatsAppLinks(workspaceId: string, prisma: PrismaClient) {
  return prisma.trackedLink.findMany({
    where: { workspaceId, originalUrl: { contains: "wa.me" } },
    orderBy: { createdAt: "desc" },
  });
}

export async function generateQRCode(workspaceId: string, linkId: string, prisma: PrismaClient) {
  const link = await prisma.trackedLink.findFirst({
    where: { id: linkId, workspaceId },
  });
  if (!link) throw new Error("Link not found");
  return { qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(link.originalUrl)}`, url: link.originalUrl };
}
