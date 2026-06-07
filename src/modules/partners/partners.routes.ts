import { Router } from "express";
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

// POST /partners/apply
router.post("/apply", async (req, res, next) => {
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
router.get("/", async (req, res, next) => {
  try {
    const partners = await getPartners();
    res.json({ data: partners });
  } catch (error) {
    next(error);
  }
});

// GET /partners/dashboard
router.get("/dashboard", async (req, res, next) => {
  try {
    const dashboard = await getPartnerDashboard();
    res.json({ data: dashboard });
  } catch (error) {
    next(error);
  }
});

// GET /partners/:id
router.get("/:id", async (req, res, next) => {
  try {
    const partner = await getPartner(req.params.id);
    res.json({ data: partner });
  } catch (error) {
    next(error);
  }
});

// POST /partners/:id/approve
router.post("/:id/approve", async (req, res, next) => {
  try {
    const result = await approvePartner(req.params.id);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /partners/:id/reject
router.post("/:id/reject", async (req, res, next) => {
  try {
    const result = await rejectPartner(req.params.id);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /partners/:id/commission
router.patch("/:id/commission", async (req, res, next) => {
  try {
    const payload = commissionSchema.parse(req.body);
    const result = await updateCommission(req.params.id, payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /partners/referrals (list)
router.get("/referrals/list", async (req, res, next) => {
  try {
    const referrals = await getReferrals();
    res.json({ data: referrals });
  } catch (error) {
    next(error);
  }
});

// POST /partners/referrals
router.post("/referrals/create", async (req, res, next) => {
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
router.get("/payouts/list", async (req, res, next) => {
  try {
    const payouts = await getPayouts();
    res.json({ data: payouts });
  } catch (error) {
    next(error);
  }
});

// POST /partners/payouts/request
router.post("/payouts/request", async (req, res, next) => {
  try {
    const payload = payoutRequestSchema.parse(req.body);
    const result = await requestPayout(payload);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /partners/payouts/:id/process
router.post("/payouts/:id/process", async (req, res, next) => {
  try {
    const result = await processPayout(req.params.id);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /partners/branding
router.patch("/branding", async (req, res, next) => {
  try {
    const payload = brandingSchema.parse(req.body);
    const result = await updateBranding(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
