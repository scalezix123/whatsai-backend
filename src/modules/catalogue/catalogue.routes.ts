import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import { createProductSchema, updateProductSchema } from "./catalogue.schemas";
import { listProducts, createProduct, updateProduct, deleteProduct, sendProductCard } from "./catalogue.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]);

router.get("/", requireSession, async (req, res, next) => {
  try {
    const products = await listProducts(req.workspaceContext.workspaceId, prisma);
    res.json({ data: products });
  } catch (error) { next(error); }
});

router.post("/", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = createProductSchema.parse(req.body);
    const product = await createProduct(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: product });
  } catch (error) { next(error); }
});

router.patch("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = updateProductSchema.parse(req.body);
    const product = await updateProduct(String(req.params.id), req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: product });
  } catch (error) { next(error); }
});

router.delete("/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    await deleteProduct(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post("/:id/send-card", requireSession, async (req, res, next) => {
  try {
    const { to } = req.body as { to: string };
    const result = await sendProductCard(req.workspaceContext.workspaceId, String(req.params.id), to, prisma);
    res.json({ data: result });
  } catch (error) { next(error); }
});

export default router;
