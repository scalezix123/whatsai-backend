import { prisma } from "../../prisma";
import type { ConnectWhatsAppInput } from "./whatsapp.schemas";
import { connectWhatsAppSchema } from "./whatsapp.schemas";
import { ConnectionStatus } from "@prisma/client";
import { buildAppState, getCurrentUser } from "../../state";

export async function connectWhatsApp(input: ConnectWhatsAppInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const payload = connectWhatsAppSchema.parse(input);

  const existing = await prisma.whatsAppConnection.findFirst({
    where: { workspaceId: user.workspaceId },
    orderBy: { updatedAt: "desc" },
  });

  if (existing) {
    await prisma.whatsAppConnection.update({
      where: { id: existing.id },
      data: {
        business_portfolio: payload.businessPortfolio,
        business_name: payload.businessName,
        display_phone_number: payload.phoneNumber,
        status: ConnectionStatus.connected,
      },
    });
  } else {
    await prisma.whatsAppConnection.create({
      data: {
        workspaceId: user.workspaceId,
        business_portfolio: payload.businessPortfolio,
        business_name: payload.businessName,
        display_phone_number: payload.phoneNumber,
        status: ConnectionStatus.connected,
      },
    });
  }

  const freshUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const data = await buildAppState(prisma, freshUser);
  return data;
}

export async function disconnectWhatsApp() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  await prisma.whatsAppConnection.updateMany({
    where: { workspaceId: user.workspaceId },
    data: { status: ConnectionStatus.disconnected },
  });

  const freshUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const data = await buildAppState(prisma, freshUser);
  return data;
}
