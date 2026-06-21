import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { handleAbandonedCartEvent, getAbandonedCartStats } from "./commerce.service";

const router = Router();

router.post("/abandoned-cart", requireSession, async (req, res, next) => {
  try {
    const result = await handleAbandonedCartEvent(req.workspaceContext.workspaceId, req.body, prisma);
    res.json({ data: result });
  } catch (error) { next(error); }
});

router.get("/abandoned-cart/stats", requireSession, async (req, res, next) => {
  try {
    const stats = await getAbandonedCartStats(req.workspaceContext.workspaceId, prisma);
    res.json({ data: stats });
  } catch (error) { next(error); }
});

export default router;
