import { Router } from "express";
import { topUpSchema } from "./wallet.schemas";
import { topUpWallet } from "./wallet.service";

const router = Router();

router.post("/top-up", async (req, res, next) => {
  try {
    const payload = topUpSchema.parse(req.body);
    const result = await topUpWallet(payload);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
