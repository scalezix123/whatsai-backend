import { PrismaClient } from "@prisma/client";
import type { CreatePaymentLinkInput, UpdatePaymentConfigInput } from "./payments.schemas";

export async function getPaymentConfig(workspaceId: string, prisma: PrismaClient) {
  const config = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "PaymentGatewayConfig" WHERE "workspaceId" = $1 LIMIT 1`,
    workspaceId
  );
  return config?.[0] ?? null;
}

export async function upsertPaymentConfig(workspaceId: string, input: UpdatePaymentConfigInput, prisma: PrismaClient) {
  const existing = await getPaymentConfig(workspaceId, prisma);

  const data: Record<string, unknown> = { workspaceId };
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.keyId) data.keyId = input.keyId;
  if (input.keySecret) data.keySecret = input.keySecret;
  if (input.webhookSecret) data.webhookSecret = input.webhookSecret;

  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE "PaymentGatewayConfig" SET "enabled" = $2, "keyId" = $3, "keySecret" = $4, "webhookSecret" = $5, "updatedAt" = NOW() WHERE "workspaceId" = $1`,
      workspaceId, data.enabled ?? existing.enabled, data.keyId ?? existing.keyId, data.keySecret ?? existing.keySecret, data.webhookSecret ?? existing.webhookSecret
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PaymentGatewayConfig" ("id", "workspaceId", "enabled", "keyId", "keySecret", "webhookSecret", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())`,
      workspaceId, data.enabled ?? false, data.keyId ?? "", data.keySecret ?? "", data.webhookSecret ?? ""
    );
  }

  return getPaymentConfig(workspaceId, prisma);
}

export async function createPaymentLink(workspaceId: string, input: CreatePaymentLinkInput, prisma: PrismaClient) {
  const config = await getPaymentConfig(workspaceId, prisma);
  if (!config?.enabled || !config.keyId || !config.keySecret) {
    throw new Error("Razorpay is not configured. Please set up your Razorpay credentials first.");
  }

  const amountInPaise = Math.round(input.amount * 100);

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountInPaise,
      currency: input.currency,
      description: input.description,
      callback_url: `${process.env.APP_URL || "http://localhost:3001"}/payments/webhook`,
      callback_method: "get",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Razorpay API error: ${error}`);
  }

  const paymentLink = await response.json();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PaymentLink" ("id", "workspaceId", "razorpayLinkId", "shortUrl", "amount", "currency", "description", "contactId", "conversationId", "status", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), NOW())`,
    workspaceId, paymentLink.id, paymentLink.short_url, input.amount, input.currency, input.description, input.contactId || null, input.conversationId || null
  );

  return paymentLink;
}

export async function getPaymentLinks(workspaceId: string, prisma: PrismaClient) {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "PaymentLink" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
    workspaceId
  );
}

export async function getPaymentTransactions(workspaceId: string, prisma: PrismaClient) {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "PaymentTransaction" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
    workspaceId
  );
}

export async function handlePaymentWebhook(workspaceId: string, payload: any, prisma: PrismaClient) {
  const event = payload.event;
  const payment = payload.payload?.payment?.entity;

  if (!payment) return;

  if (event === "payment.captured" || event === "payment.authorized") {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PaymentTransaction" ("id", "workspaceId", "razorpayPaymentId", "amount", "currency", "status", "method", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, 'completed', $5, NOW())`,
      workspaceId, payment.id, payment.amount / 100, payment.currency, payment.method
    );
  } else if (event === "payment.failed") {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PaymentTransaction" ("id", "workspaceId", "razorpayPaymentId", "amount", "currency", "status", "method", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, 'failed', $5, NOW())`,
      workspaceId, payment.id, payment.amount / 100, payment.currency, payment.method
    );
  }
}
