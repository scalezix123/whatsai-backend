import { Router } from "express";
import { prisma } from "../../prisma";
import { getConnectionHealthSchema, testSendSchema } from "./whatsapp.schemas";
import {
  getConnectionHealth,
  testSendMessage,
  type WorkspaceContext,
} from "./whatsapp.service";

const router = Router();

router.get("/health", async (req, res, next) => {
  try {
    const workspaceContext = req.workspaceContext as WorkspaceContext;
    if (!workspaceContext?.workspaceId) {
      throw new Error("Workspace context required");
    }

    const health = await getConnectionHealth(
      workspaceContext.workspaceId,
      prisma
    );
    res.json({ data: health });
  } catch (error) {
    next(error);
  }
});

router.post("/test-send", async (req, res, next) => {
  try {
    const workspaceContext = req.workspaceContext as WorkspaceContext;
    if (!workspaceContext?.workspaceId) {
      throw new Error("Workspace context required");
    }

    const payload = testSendSchema.parse(req.body);
    const result = await testSendMessage(payload, workspaceContext, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
