import { Router } from "express";
import { requireSession, requireRole } from "../../middleware";
import { UserRole } from "@prisma/client";
import {
  applyPartnerSchema,
  publicApplySchema,
  commissionSchema,
  payoutRequestSchema,
  brandingSchema,
} from "./partners.schemas";
import {
  applyPartner,
  publicApplyPartner,
  getPartners,
  getPartnerDashboard,
  getPartner,
  approvePartner,
  rejectPartner,
  updateCommission,
  getReferrals,
  createReferral,
  getPayouts,
  requestPayout,
  processPayout,
  updateBranding,
} from "./partners.service";

const router = Router();
const adminOnly = requireRole([UserRole.OWNER, UserRole.ADMIN]);

// POST /partners/apply
router.post("/apply", requireSession, async (req, res, next) => {
  try {
    const payload = applyPartnerSchema.parse(req.body);
    const result = await applyPartner(payload);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /partners/public-apply
router.post("/public-apply", async (req, res, next) => {
  try {
    const payload = publicApplySchema.parse(req.body);
    const result = await publicApplyPartner(payload);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /partners
router.get("/", requireSession, async (req, res, next) => {
  try {
    const partners = await getPartners();
    res.json({ data: partners });
  } catch (error) {
    next(error);
  }
});

// GET /partners/dashboard
router.get("/dashboard", requireSession, async (req, res, next) => {
  try {
    const dashboard = await getPartnerDashboard();
    res.json({ data: dashboard });
  } catch (error) {
    next(error);
  }
});

// GET /partners/:id
router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const partner = await getPartner(String(req.params.id));
    res.json({ data: partner });
  } catch (error) {
    next(error);
  }
});

// POST /partners/:id/approve
router.post("/:id/approve", requireSession, adminOnly, async (req, res, next) => {
  try {
    const result = await approvePartner(String(req.params.id));
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /partners/:id/reject
router.post("/:id/reject", requireSession, adminOnly, async (req, res, next) => {
  try {
    const result = await rejectPartner(String(req.params.id));
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /partners/:id/commission
router.patch("/:id/commission", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = commissionSchema.parse(req.body);
    const result = await updateCommission(String(req.params.id), payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /partners/referrals (list)
router.get("/referrals/list", requireSession, async (req, res, next) => {
  try {
    const referrals = await getReferrals();
    res.json({ data: referrals });
  } catch (error) {
    next(error);
  }
});

// POST /partners/referrals
router.post("/referrals/create", requireSession, async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) throw new Error("User ID required");
    const result = await createReferral(userId);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /partners/payouts
router.get("/payouts/list", requireSession, async (req, res, next) => {
  try {
    const payouts = await getPayouts();
    res.json({ data: payouts });
  } catch (error) {
    next(error);
  }
});

// POST /partners/payouts/request
router.post("/payouts/request", requireSession, async (req, res, next) => {
  try {
    const payload = payoutRequestSchema.parse(req.body);
    const result = await requestPayout(payload);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /partners/payouts/:id/process
router.post("/payouts/:id/process", requireSession, adminOnly, async (req, res, next) => {
  try {
    const result = await processPayout(String(req.params.id));
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /partners/branding
router.patch("/branding", requireSession, async (req, res, next) => {
  try {
    const payload = brandingSchema.parse(req.body);
    const result = await updateBranding(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
