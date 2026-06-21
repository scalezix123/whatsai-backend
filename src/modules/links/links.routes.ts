import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { createTrackedLinkSchema } from "./links.schemas";
import {
  createTrackedLink,
  listTrackedLinks,
  getLinkAnalytics,
} from "./links.service";
import { logAuditEvent } from "../../utils";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const result = await listTrackedLinks(req.workspaceContext.workspaceId, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createTrackedLinkSchema.parse(req.body);
    const result = await createTrackedLink(req.workspaceContext.workspaceId, payload, prisma);
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: "link.created",
      summary: `Tracked link "${result.code}" -> ${result.originalUrl}`,
      payload: { linkId: result.id, code: result.code },
    });
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/analytics", requireSession, async (req, res, next) => {
  try {
    const result = await getLinkAnalytics(req.workspaceContext.workspaceId, String(req.params.id), prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
