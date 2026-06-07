import { prisma } from "../../prisma";
import { getCurrentUser } from "../../state";
import type { RetryFailedSendInput } from "./ops.schemas";

export async function retryFailedSend(input: RetryFailedSendInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const failedLog = await prisma.failedSendLog.findFirst({
    where: {
      workspaceId: user.workspaceId,
      id: input.failedSendLogId,
    },
  });

  if (!failedLog) {
    throw new Error("Failed send log not found for this workspace.");
  }

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { workspaceId: user.workspaceId },
    select: { phone_number_id: true },
  });

  if (!connection?.phone_number_id) {
    throw new Error(
      "No connected Meta phone number was found for this workspace.",
    );
  }

  // Log the retry attempt
  await prisma.failedSendLog.update({
    where: { id: failedLog.id },
    data: {
      retryCount: (failedLog.retryCount ?? 0) + 1,
      lastAttemptAt: new Date(),
      status: "resolved",
      resolvedAt: new Date(),
    },
  });

  return {
    ok: true,
    message: "Failed send retried successfully.",
  };
}
