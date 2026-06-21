import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import { upsertBusinessHoursSchema, bulkUpsertBusinessHoursSchema } from "./business-hours.schemas";
import { getBusinessHours, upsertBusinessHours, bulkUpsertBusinessHours } from "./business-hours.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]);

router.get("/", requireSession, async (req, res, next) => {
  try {
    const hours = await getBusinessHours(req.workspaceContext.workspaceId, prisma);
    res.json({ data: hours });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = upsertBusinessHoursSchema.parse(req.body);
    const hours = await upsertBusinessHours(req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: hours });
  } catch (error) {
    next(error);
  }
});

router.post("/bulk", requireSession, adminOnly, async (req, res, next) => {
  try {
    const entries = bulkUpsertBusinessHoursSchema.parse(req.body);
    const hours = await bulkUpsertBusinessHours(req.workspaceContext.workspaceId, entries, prisma);
    res.json({ data: hours });
  } catch (error) {
    next(error);
  }
});

export default router;
