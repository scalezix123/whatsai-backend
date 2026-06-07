import { PrismaClient } from "@prisma/client";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  role: string;
}

export async function getConnectionHealth(
  workspaceId: string,
  db: PrismaClient
) {
  const connection = await db.whatsAppConnection.findFirst({
    where: { workspaceId },
  });

  if (!connection) {
    return {
      status: "not_connected",
      phoneNumberId: null,
      displayPhoneNumber: null,
      businessName: null,
      tokenExpired: null,
      tokenExpiresAt: null,
    };
  }

  const auth = await db.metaAuthorization.findUnique({
    where: { workspaceId },
  });

  const isTokenExpired =
    auth?.expiresAt && new Date(auth.expiresAt) < new Date();

  return {
    status: connection.status,
    phoneNumberId: connection.phone_number_id,
    displayPhoneNumber: connection.display_phone_number,
    businessName: connection.business_name,
    tokenExpired: isTokenExpired,
    tokenExpiresAt: auth?.expiresAt,
    verificationStatus: connection.business_verification_status,
    accountReviewStatus: connection.account_review_status,
    obaStatus: connection.oba_status,
  };
}

export async function testSendMessage(
  input: {
    to: string;
    messageType: "text" | "template";
    body?: string;
    templateName?: string;
    language?: string;
  },
  workspaceContext: WorkspaceContext,
  db: PrismaClient
) {
  // TODO: Implement in Stage 1
  console.log("[WhatsApp Service] Test send not yet implemented", input);
  
  return {
    status: "pending",
    message: "Test send processor not yet implemented",
    messageId: null,
  };
}
