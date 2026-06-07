import { Router } from "express";
import { connectWhatsAppSchema } from "./whatsapp.schemas";
import { connectWhatsApp, disconnectWhatsApp } from "./whatsapp.service";

const router = Router();

router.post("/connect", async (req, res, next) => {
  try {
    const payload = connectWhatsAppSchema.parse(req.body);
    const result = await connectWhatsApp(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/disconnect", async (req, res, next) => {
  try {
    const result = await disconnectWhatsApp();
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
