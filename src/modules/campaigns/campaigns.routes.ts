import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { createCampaignSchema, listCampaignsSchema } from "./campaigns.schemas";
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  launchCampaign,
  retryCampaign,
  getCampaignAnalytics,
} from "./campaigns.service";
import { dispatchDueCampaigns } from "./campaigns.scheduler";
import { logAuditEvent } from "../../utils";

const router = Router();

const adminOnly = requireRole([UserRole.ADMIN]);

// Manually run the scheduled-campaign sweep now (the in-process loop does this
// every minute on its own). Admin-only; used by ops and the E2E suite to avoid
// waiting for a tick.
router.post("/dispatch-due", requireSession, adminOnly, async (_req, res, next) => {
  try {
    const result = await dispatchDueCampaigns(prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createCampaignSchema.parse(req.body);
    const result = await createCampaign(req.workspaceContext.workspaceId, payload, prisma);
    const recipientCount = result.stats?.total ?? 0;
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: payload.sendNow ? "campaign.sent" : "campaign.created",
      summary: `Campaign "${payload.name}" ${payload.sendNow ? "sent" : "created"} (${recipientCount} recipients)`,
      payload: { campaignId: result.id, recipients: recipientCount },
    });
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/", requireSession, async (req, res, next) => {
  try {
    const filters = listCampaignsSchema.parse(req.query);
    const result = await listCampaigns(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const result = await getCampaign(req.workspaceContext.workspaceId, req.params.id, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/analytics", requireSession, async (req, res, next) => {
  try {
    const result = await getCampaignAnalytics(
      req.workspaceContext.workspaceId,
      req.params.id,
      prisma
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/launch", requireSession, async (req, res, next) => {
  try {
    const result = await launchCampaign(req.workspaceContext.workspaceId, req.params.id, prisma);
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: "campaign.launched",
      summary: `Campaign ${req.params.id} launched`,
      payload: { campaignId: req.params.id },
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/retry", requireSession, async (req, res, next) => {
  try {
    const result = await retryCampaign(req.workspaceContext.workspaceId, req.params.id, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
