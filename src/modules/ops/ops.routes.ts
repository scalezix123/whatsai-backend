import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import {
  listOperationalLogsSchema,
  listFailedSendsSchema,
  listWebhookEventsSchema,
  retryFailedSendSchema,
} from "./ops.schemas";
import {
  listOperationalLogs,
  listFailedSends,
  listWebhookEvents,
  retryFailedSend,
} from "./ops.service";

const router = Router();

// Observability is administrator-only.
const adminOnly = requireRole([UserRole.ADMIN]);

router.get("/logs", requireSession, adminOnly, async (req, res, next) => {
  try {
    const filters = listOperationalLogsSchema.parse(req.query);
    const result = await listOperationalLogs(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/failed-sends", requireSession, adminOnly, async (req, res, next) => {
  try {
    const filters = listFailedSendsSchema.parse(req.query);
    const result = await listFailedSends(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/webhook-events", requireSession, adminOnly, async (req, res, next) => {
  try {
    const filters = listWebhookEventsSchema.parse(req.query);
    const result = await listWebhookEvents(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/retry-failed-send", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = retryFailedSendSchema.parse(req.body);
    const result = await retryFailedSend(req.workspaceContext.workspaceId, payload, prisma);
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

export default router;
