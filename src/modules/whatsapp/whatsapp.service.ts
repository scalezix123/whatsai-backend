import { prisma } from "../../prisma";
import type { ConnectWhatsAppInput, TestSendInput } from "./whatsapp.schemas";
import { connectWhatsAppSchema } from "./whatsapp.schemas";
import { ConnectionStatus } from "@prisma/client";
import { buildAppState, getCurrentUser } from "../../state";
import { getActiveMetaAuthorization } from "../../utils";

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

export async function getConnectionHealth() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { workspaceId: user.workspaceId },
  });

  if (!connection) {
    return { status: "not_connected", message: "WhatsApp not configured" };
  }

  const auth = await prisma.metaAuthorization.findUnique({
    where: { workspaceId: user.workspaceId },
  });

  const isTokenExpired = auth?.expiresAt && new Date(auth.expiresAt) < new Date();
  const isTokenExpiring =
    auth?.expiresAt && new Date(auth.expiresAt) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  return {
    status: connection.status,
    phoneNumberId: connection.phone_number_id,
    displayPhoneNumber: connection.display_phone_number,
    businessName: connection.business_name,
    tokenExpired: isTokenExpired,
    tokenExpiring: isTokenExpiring,
    tokenExpiresAt: auth?.expiresAt,
    verificationStatus: connection.business_verification_status,
    accountReviewStatus: connection.account_review_status,
    obaStatus: connection.oba_status,
  };
}

export async function sendTestMessage(input: TestSendInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { workspaceId: user.workspaceId },
  });

  if (!connection || !connection.phone_number_id) {
    throw new Error("WhatsApp not configured. Connect WhatsApp first.");
  }

  const auth = await getActiveMetaAuthorization(user.workspaceId);
  if (!auth) {
    throw new Error("Meta authorization expired. Reconnect WhatsApp.");
  }

  // TODO: Implement actual Meta API call to send message
  // For now, just log and return simulated response
  console.log(
    `[TEST] Would send ${input.messageType} message to ${input.to} via Meta API`
  );

  await prisma.operationalLog.create({
    data: {
      workspaceId: user.workspaceId,
      eventType: "test_send",
      level: "info",
      summary: `Test ${input.messageType} message sent to ${input.to}`,
      payload: {
        to: input.to,
        messageType: input.messageType,
        body: input.body,
        templateName: input.templateName,
      },
    },
  });

  return {
    success: true,
    messageId: `test_msg_${Date.now()}`,
    to: input.to,
    status: "pending",
    message: "Test message queued for sending",
  };
}
