import { Router } from "express";
import { retryFailedSendSchema } from "./ops.schemas";
import { retryFailedSend } from "./ops.service";

const router = Router();

router.post("/retry-failed-send", async (req, res, next) => {
  try {
    const payload = retryFailedSendSchema.parse(req.body);
    const result = await retryFailedSend(payload);
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

export default router;
