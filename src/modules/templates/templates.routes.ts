import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import {
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesSchema,
  validateParametersSchema,
  previewTemplateSchema,
} from "./templates.schemas";
import {
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  submitTemplateForApproval,
  syncTemplatesWithMeta,
  getTemplateVariables,
  validateParameters,
  previewTemplate,
} from "./templates.service";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const filters = listTemplatesSchema.parse(req.query);
    const result = await listTemplates(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createTemplateSchema.parse(req.body);
    const template = await createTemplate(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: template });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const template = await getTemplate(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: template });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, async (req, res, next) => {
  try {
    const payload = updateTemplateSchema.parse(req.body);
    const template = await updateTemplate(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.json({ data: template });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, async (req, res, next) => {
  try {
    await deleteTemplate(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// --- Variable extraction & parameter mapping (Stage 3) ---

router.get("/:id/variables", requireSession, async (req, res, next) => {
  try {
    const result = await getTemplateVariables(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      prisma
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/validate", requireSession, async (req, res, next) => {
  try {
    const { parameters } = validateParametersSchema.parse(req.body);
    const result = await validateParameters(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      parameters,
      prisma
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/preview", requireSession, async (req, res, next) => {
  try {
    const { parameters } = previewTemplateSchema.parse(req.body);
    const result = await previewTemplate(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      parameters,
      prisma
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// --- Approval workflow & Meta sync ---

router.post("/:id/submit", requireSession, async (req, res, next) => {
  try {
    const template = await submitTemplateForApproval(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      prisma
    );
    res.json({ data: template });
  } catch (error) {
    next(error);
  }
});

router.post("/sync/meta", requireSession, async (req, res, next) => {
  try {
    const result = await syncTemplatesWithMeta(req.workspaceContext.workspaceId, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
