import { Router } from "express";
import { resolveShortLink, getBrandingByRef } from "./branding.service";

const router = Router();

router.get("/t/:code", async (req, res, next) => {
  try {
    const { code } = req.params;
    const contactId = typeof req.query.cid === "string" ? req.query.cid : undefined;
    const workspaceId = typeof req.query.wid === "string" ? req.query.wid : undefined;

    const targetUrl = await resolveShortLink(
      code,
      req.ip,
      req.get("User-Agent"),
      contactId,
      workspaceId,
    );

    res.redirect(targetUrl);
  } catch (error) {
    next(error);
  }
});

router.get("/branding/:ref", async (req, res, next) => {
  try {
    const { ref } = req.params;
    const branding = await getBrandingByRef(ref);
    res.json({ data: branding });
  } catch (error) {
    next(error);
  }
});

export default router;
