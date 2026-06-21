import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { sendMetaCapiEvent, getCapiEvents } from "./capi.service";

const router = Router();

router.post("/send-event", requireSession, async (req, res, next) => {
  try {
    const result = await sendMetaCapiEvent(req.workspaceContext.workspaceId, req.body, prisma);
    res.json({ data: result });
  } catch (error) { next(error); }
});

router.get("/events", requireSession, async (req, res, next) => {
  try {
    const events = await getCapiEvents(req.workspaceContext.workspaceId, prisma);
    res.json({ data: events });
  } catch (error) { next(error); }
});

export default router;
