import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { createCannedReplySchema, updateCannedReplySchema, listCannedRepliesSchema } from "./canned-replies.schemas";
import { listCannedReplies, getCannedReply, createCannedReply, updateCannedReply, deleteCannedReply } from "./canned-replies.service";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const filters = listCannedRepliesSchema.parse(req.query);
    const result = await listCannedReplies(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const reply = await getCannedReply(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: reply });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createCannedReplySchema.parse(req.body);
    const reply = await createCannedReply(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: reply });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, async (req, res, next) => {
  try {
    const payload = updateCannedReplySchema.parse(req.body);
    const reply = await updateCannedReply(String(req.params.id), req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: reply });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, async (req, res, next) => {
  try {
    await deleteCannedReply(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/resolve/:shortcut", requireSession, async (req, res, next) => {
  try {
    const workspaceId = req.workspaceContext.workspaceId;
    const shortcut = String(req.params.shortcut);
    const reply = await prisma.cannedReply.findFirst({
      where: { workspaceId, shortcut },
    });
    if (!reply) {
      res.status(404).json({ message: "Canned reply not found" });
      return;
    }
    res.json({ data: reply });
  } catch (error) {
    next(error);
  }
});

export default router;
