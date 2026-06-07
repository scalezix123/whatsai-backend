import { prisma } from "../../prisma";
import { getCurrentUser } from "../../state";
import { hashPassword } from "../../auth";
import type {
  ApplyPartnerInput,
  PublicApplyInput,
  CommissionInput,
  PayoutRequestInput,
  BrandingInput,
} from "./partners.schemas";

export async function applyPartner(input: ApplyPartnerInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const application = await prisma.partnerApplication.create({
    data: {
      userId: user.id,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      companyName: input.companyName,
      partnerType: input.partnerType,
      message: input.message,
      status: "pending",
    },
  });

  return application;
}

export async function publicApplyPartner(input: PublicApplyInput) {
  const passwordHash = await hashPassword(input.password);

  const application = await prisma.partnerApplication.create({
    data: {
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      companyName: input.companyName,
      partnerType: input.partnerType,
      message: input.message,
      status: "pending",
      passwordHash,
    },
  });

  return application;
}

export async function getPartners() {
  const partners = await prisma.partner.findMany({
    where: { status: "approved" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      brandName: true,
      companyName: true,
      referralCode: true,
      commissionRate: true,
      status: true,
    },
  });

  return partners;
}

export async function getPartnerDashboard() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  if (user.role !== "PARTNER") {
    throw new Error("Only partners can access this dashboard.");
  }

  const partner = await prisma.partner.findUnique({
    where: { userId: user.id },
  });

  if (!partner) {
    throw new Error("Partner profile not found.");
  }

  return partner;
}

export async function getPartner(partnerId: string) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: {
      id: true,
      brandName: true,
      logoUrl: true,
      primaryColor: true,
      supportEmail: true,
      commissionRate: true,
      referralCode: true,
      status: true,
    },
  });

  if (!partner) {
    throw new Error("Partner not found.");
  }

  return partner;
}

export async function approvePartner(partnerId: string) {
  const partner = await prisma.partner.update({
    where: { id: partnerId },
    data: { status: "approved" },
  });

  return partner;
}

export async function rejectPartner(partnerId: string) {
  const partner = await prisma.partner.update({
    where: { id: partnerId },
    data: { status: "rejected" },
  });

  return partner;
}

export async function updateCommission(
  partnerId: string,
  input: CommissionInput,
) {
  const partner = await prisma.partner.update({
    where: { id: partnerId },
    data: { commissionRate: input.commissionRate },
  });

  return partner;
}

export async function getReferrals() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  if (user.role !== "PARTNER") {
    throw new Error("Only partners can view referrals.");
  }

  const partner = await prisma.partner.findUnique({
    where: { userId: user.id },
  });

  if (!partner) {
    throw new Error("Partner not found.");
  }

  const referrals = await prisma.partnerReferral.findMany({
    where: { partnerId: partner.id },
    orderBy: { createdAt: "desc" },
  });

  return referrals;
}

export async function createReferral(userId: string) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const partner = await prisma.partner.findUnique({
    where: { userId: user.id },
  });

  if (!partner) {
    throw new Error("Partner not found.");
  }

  const referral = await prisma.partnerReferral.create({
    data: {
      partnerId: partner.id,
      referredUserId: userId,
    },
  });

  return referral;
}

export async function getPayouts() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const partner = await prisma.partner.findUnique({
    where: { userId: user.id },
  });

  if (!partner) {
    throw new Error("Partner not found.");
  }

  const payouts = await prisma.partnerPayout.findMany({
    where: { partnerId: partner.id },
    orderBy: { createdAt: "desc" },
  });

  return payouts;
}

export async function requestPayout(input: PayoutRequestInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  const partner = await prisma.partner.findUnique({
    where: { userId: user.id },
  });

  if (!partner) {
    throw new Error("Partner not found.");
  }

  const request = await prisma.partnerPayoutRequest.create({
    data: {
      partnerId: partner.id,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      paymentDetails: input.paymentDetails,
      status: "pending",
    },
  });

  return request;
}

export async function processPayout(payoutId: string) {
  const payout = await prisma.partnerPayoutRequest.update({
    where: { id: payoutId },
    data: { status: "processed", processedAt: new Date() },
  });

  return payout;
}

export async function updateBranding(input: BrandingInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  if (user.role !== "PARTNER") {
    throw new Error("Only partners can update branding.");
  }

  const partner = await prisma.partner.findUnique({
    where: { userId: user.id },
  });

  if (!partner) {
    throw new Error("Partner profile not found.");
  }

  const updated = await prisma.partner.update({
    where: { id: partner.id },
    data: {
      brandName: input.brandName ?? undefined,
      logoUrl: input.logoUrl ?? undefined,
      primaryColor: input.primaryColor ?? undefined,
      supportEmail: input.supportEmail ?? undefined,
    },
  });

  return updated;
}
