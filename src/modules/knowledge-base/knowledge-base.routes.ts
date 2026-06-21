import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import { createDocumentSchema, updateDocumentSchema } from "./knowledge-base.schemas";
import { listDocuments, getDocument, createDocument, updateDocument, deleteDocument, searchKnowledge } from "./knowledge-base.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN]);

router.get("/", requireSession, async (req, res, next) => {
  try {
    const docs = await listDocuments(req.workspaceContext.workspaceId, prisma);
    res.json({ data: docs });
  } catch (error) {
    next(error);
  }
});

router.get("/search", requireSession, async (req, res, next) => {
  try {
    const query = String(req.query.q || "");
    if (!query.trim()) {
      res.json({ data: [] });
      return;
    }
    const results = await searchKnowledge(req.workspaceContext.workspaceId, query, prisma);
    res.json({ data: results });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const doc = await getDocument(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: doc });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = createDocumentSchema.parse(req.body);
    const doc = await createDocument(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: doc });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = updateDocumentSchema.parse(req.body);
    const doc = await updateDocument(String(req.params.id), req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: doc });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    await deleteDocument(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
