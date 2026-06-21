import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { createWhatsAppLinkSchema } from "./growth.schemas";
import { createWhatsAppLink, getWhatsAppLinks, generateQRCode } from "./growth.service";

const router = Router();

router.get("/links", requireSession, async (req, res, next) => {
  try {
    const links = await getWhatsAppLinks(req.workspaceContext.workspaceId, prisma);
    res.json({ data: links });
  } catch (error) { next(error); }
});

router.post("/links", requireSession, async (req, res, next) => {
  try {
    const payload = createWhatsAppLinkSchema.parse(req.body);
    const link = await createWhatsAppLink(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: link });
  } catch (error) { next(error); }
});

router.get("/links/:id/qr", requireSession, async (req, res, next) => {
  try {
    const qr = await generateQRCode(req.workspaceContext.workspaceId, String(req.params.id), prisma);
    res.json({ data: qr });
  } catch (error) { next(error); }
});

export default router;
