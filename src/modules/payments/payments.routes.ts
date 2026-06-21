import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import { createPaymentLinkSchema, updatePaymentConfigSchema } from "./payments.schemas";
import { getPaymentConfig, upsertPaymentConfig, createPaymentLink, getPaymentLinks, getPaymentTransactions, handlePaymentWebhook } from "./payments.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN]);

router.get("/config", requireSession, async (req, res, next) => {
  try {
    const config = await getPaymentConfig(req.workspaceContext.workspaceId, prisma);
    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

router.patch("/config", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = updatePaymentConfigSchema.parse(req.body);
    const config = await upsertPaymentConfig(req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

router.post("/create-link", requireSession, async (req, res, next) => {
  try {
    const payload = createPaymentLinkSchema.parse(req.body);
    const link = await createPaymentLink(req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: link });
  } catch (error) {
    next(error);
  }
});

router.get("/links", requireSession, async (req, res, next) => {
  try {
    const links = await getPaymentLinks(req.workspaceContext.workspaceId, prisma);
    res.json({ data: links });
  } catch (error) {
    next(error);
  }
});

router.get("/transactions", requireSession, async (req, res, next) => {
  try {
    const transactions = await getPaymentTransactions(req.workspaceContext.workspaceId, prisma);
    res.json({ data: transactions });
  } catch (error) {
    next(error);
  }
});

router.post("/webhook", async (req, res, next) => {
  try {
    const workspaceId = req.headers["x-workspace-id"] as string;
    if (!workspaceId) {
      res.status(400).json({ message: "Missing workspace ID" });
      return;
    }
    await handlePaymentWebhook(workspaceId, req.body, prisma);
    res.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});

export default router;
