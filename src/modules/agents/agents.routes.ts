import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import { createAgentProfileSchema, updateAgentProfileSchema, listAgentsSchema } from "./agents.schemas";
import {
  listAgents,
  getAgentProfile,
  createAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
} from "./agents.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]);

router.get("/", requireSession, async (req, res, next) => {
  try {
    const filters = listAgentsSchema.parse(req.query);
    const result = await listAgents(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const profile = await getAgentProfile(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: profile });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = createAgentProfileSchema.parse(req.body);
    const profile = await createAgentProfile(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: profile });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = updateAgentProfileSchema.parse(req.body);
    const profile = await updateAgentProfile(String(req.params.id), req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: profile });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    await deleteAgentProfile(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
