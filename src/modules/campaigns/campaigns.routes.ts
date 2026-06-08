import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { createCampaignSchema, listCampaignsSchema } from "./campaigns.schemas";
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  launchCampaign,
  retryCampaign,
} from "./campaigns.service";

const router = Router();

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createCampaignSchema.parse(req.body);
    const result = await createCampaign(req.workspaceContext.workspaceId, payload, prisma);
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

router.post("/:id/launch", requireSession, async (req, res, next) => {
  try {
    const result = await launchCampaign(req.workspaceContext.workspaceId, req.params.id, prisma);
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
