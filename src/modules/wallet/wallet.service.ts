import { prisma } from "../../prisma";
import type { TopUpInput } from "./wallet.schemas";
import { buildAppState, getCurrentUser } from "../../state";

export async function topUpWallet(input: TopUpInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const currentState = await buildAppState(prisma, user);
  const nextBalance = currentState.walletBalance + input.amount;

  await prisma.walletTransaction.create({
    data: {
      workspaceId: user.workspaceId,
      type: "credit",
      amount: input.amount,
      description: input.source || "Wallet Recharge",
      referenceType: "manual_topup",
      balanceAfter: nextBalance,
    },
  });

  const freshUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const data = await buildAppState(prisma, freshUser);
  return {
    data,
    ok: true,
    message: "Balance added successfully.",
  };
}
