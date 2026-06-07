import { prisma } from "../../prisma";
import type { CreateCampaignInput } from "./campaigns.schemas";
import { buildAppState, getCurrentUser } from "../../state";
import { COST_PER_MESSAGE } from "../../sharedTypes";
import { CampaignStatus } from "@prisma/client";

export async function createCampaign(input: CreateCampaignInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const currentState = await buildAppState(prisma, user);
  const estimatedCost = Number(
    (input.contactIds.length * COST_PER_MESSAGE).toFixed(2),
  );

  if (input.sendNow && currentState.walletBalance < estimatedCost) {
    throw new Error("Insufficient wallet balance for this campaign.");
  }

  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: user.workspaceId,
      id: { in: input.contactIds },
    },
  });

  if (contacts.length !== input.contactIds.length) {
    throw new Error("One or more contacts were not found.");
  }

  const template = await prisma.messageTemplate.findFirst({
    where: {
      workspaceId: user.workspaceId,
      id: input.templateId,
    },
  });

  if (!template) {
    throw new Error("Template not found.");
  }

  const campaign = await prisma.campaign.create({
    data: {
      workspaceId: user.workspaceId,
      templateId: template.id,
      name: input.name,
      status: input.sendNow ? CampaignStatus.sending : CampaignStatus.draft,
      estimatedCost,
      spent: input.sendNow ? estimatedCost : 0,
      launchedAt: input.sendNow ? new Date() : null,
      recipients: {
        create: contacts.map((contact) => ({
          workspaceId: user.workspaceId,
          contactId: contact.id,
          status: input.sendNow ? "sent" : "queued",
          cost: COST_PER_MESSAGE,
        })),
      },
    },
  });

  if (input.sendNow) {
    await prisma.walletTransaction.create({
      data: {
        workspaceId: user.workspaceId,
        type: "debit",
        amount: -estimatedCost,
        description: `${input.name} (${input.contactIds.length} msgs)`,
        referenceType: "campaign_send",
        referenceId: campaign.id,
        balanceAfter: currentState.walletBalance - estimatedCost,
      },
    });
  }

  const freshUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const data = await buildAppState(prisma, freshUser);
  return {
    data,
    ok: true,
    message: input.sendNow
      ? "Campaign launched successfully."
      : "Draft saved successfully.",
  };
}
