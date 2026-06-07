import { Router } from "express";
import { createCampaignSchema } from "./campaigns.schemas";
import { createCampaign } from "./campaigns.service";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const payload = createCampaignSchema.parse(req.body);
    const result = await createCampaign(payload);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
