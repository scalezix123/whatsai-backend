import { Router } from "express";
import { requireSession } from "../../middleware";
import { connectWhatsAppSchema, testSendSchema } from "./whatsapp.schemas";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getConnectionHealth,
  sendTestMessage,
} from "./whatsapp.service";

const router = Router();

router.get("/health", requireSession, async (req, res, next) => {
  try {
    const health = await getConnectionHealth();
    res.json({ data: health });
  } catch (error) {
    next(error);
  }
});

router.post("/test-send", requireSession, async (req, res, next) => {
  try {
    const payload = testSendSchema.parse(req.body);
    const result = await sendTestMessage(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/connect", requireSession, async (req, res, next) => {
  try {
    const payload = connectWhatsAppSchema.parse(req.body);
    const result = await connectWhatsApp(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/disconnect", requireSession, async (req, res, next) => {
  try {
    const result = await disconnectWhatsApp();
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
