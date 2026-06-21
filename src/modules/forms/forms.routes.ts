import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { createFormSchema } from "./forms.schemas";
import { listForms, createForm, getForm, submitForm, getFormSubmissions, deleteForm } from "./forms.service";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const forms = await listForms(req.workspaceContext.workspaceId, prisma);
    res.json({ data: forms });
  } catch (error) { next(error); }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createFormSchema.parse(req.body);
    const form = await createForm(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: form });
  } catch (error) { next(error); }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const form = await getForm(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: form });
  } catch (error) { next(error); }
});

router.post("/:id/submit", requireSession, async (req, res, next) => {
  try {
    const result = await submitForm(String(req.params.id), req.workspaceContext.workspaceId, req.body, prisma);
    res.json({ data: result });
  } catch (error) { next(error); }
});

router.get("/:id/submissions", requireSession, async (req, res, next) => {
  try {
    const subs = await getFormSubmissions(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: subs });
  } catch (error) { next(error); }
});

router.delete("/:id", requireSession, async (req, res, next) => {
  try {
    await deleteForm(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
