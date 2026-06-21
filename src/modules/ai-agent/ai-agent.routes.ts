import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import { updateAiAgentSchema, generateReplySchema } from "./ai-agent.schemas";
import { getAiAgent, upsertAiAgent, generateAiReply, testAiAgent } from "./ai-agent.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN]);

router.get("/", requireSession, async (req, res, next) => {
  try {
    const agent = await getAiAgent(req.workspaceContext.workspaceId, prisma);
    res.json({ data: agent });
  } catch (error) {
    next(error);
  }
});

router.patch("/", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = updateAiAgentSchema.parse(req.body);
    const agent = await upsertAiAgent(req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: agent });
  } catch (error) {
    next(error);
  }
});

router.post("/generate-reply", requireSession, async (req, res, next) => {
  try {
    const payload = generateReplySchema.parse(req.body);
    const result = await generateAiReply(req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/test", requireSession, async (req, res, next) => {
  try {
    const { message } = req.body as { message: string };
    if (!message) {
      res.status(400).json({ message: "message is required" });
      return;
    }
    const result = await testAiAgent(req.workspaceContext.workspaceId, message, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
