import { Router } from "express";
import { createContactSchema } from "./contacts.schemas";
import { createContact, uploadSampleContacts } from "./contacts.service";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const payload = createContactSchema.parse(req.body);
    const result = await createContact(payload);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/upload-sample", async (_req, res, next) => {
  try {
    const result = await uploadSampleContacts();
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
