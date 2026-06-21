import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import { createTeamSchema, updateTeamSchema } from "./teams.schemas";
import { listTeams, getTeam, createTeam, updateTeam, deleteTeam } from "./teams.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]);

router.get("/", requireSession, async (req, res, next) => {
  try {
    const teams = await listTeams(req.workspaceContext.workspaceId, prisma);
    res.json({ data: teams });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const team = await getTeam(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: team });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = createTeamSchema.parse(req.body);
    const team = await createTeam(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: team });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = updateTeamSchema.parse(req.body);
    const team = await updateTeam(String(req.params.id), req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: team });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    await deleteTeam(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
