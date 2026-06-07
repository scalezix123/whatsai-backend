import { Router } from "express";
import { signUpSchema } from "./auth.schemas";
import {
  signUpUser,
  signOutUser,
} from "./auth.service";

const router = Router();

// Auth-scoped routes (mounted at /auth)
router.post("/signup", async (req, res, next) => {
  try {
    const payload = signUpSchema.parse(req.body);
    const data = await signUpUser(payload);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/signout", async (_req, res, next) => {
  try {
    const data = await signOutUser();
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
