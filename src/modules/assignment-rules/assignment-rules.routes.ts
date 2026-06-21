import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { createAssignmentRuleSchema, updateAssignmentRuleSchema } from "./assignment-rules.schemas";
import {
  listAssignmentRules,
  getAssignmentRule,
  createAssignmentRule,
  updateAssignmentRule,
  deleteAssignmentRule,
} from "./assignment-rules.service";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const rules = await listAssignmentRules(req.workspaceContext.workspaceId, prisma);
    res.json({ data: rules });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const rule = await getAssignmentRule(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: rule });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createAssignmentRuleSchema.parse(req.body);
    const rule = await createAssignmentRule(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: rule });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, async (req, res, next) => {
  try {
    const payload = updateAssignmentRuleSchema.parse(req.body);
    const rule = await updateAssignmentRule(String(req.params.id), req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: rule });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, async (req, res, next) => {
  try {
    await deleteAssignmentRule(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
