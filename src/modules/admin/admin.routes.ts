import { Router } from "express";
import { updateUserRoleSchema } from "./admin.schemas";
import {
  getAllUsers,
  updateUserRoleAdmin,
  deleteUserAdmin,
  getAllPartners,
} from "./admin.service";

const router = Router();

router.get("/users", async (_req, res, next) => {
  try {
    const users = await getAllUsers();
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id/role", async (req, res, next) => {
  try {
    const payload = updateUserRoleSchema.parse(req.body);
    const user = await updateUserRoleAdmin(req.params.id, payload);
    res.json({ data: user });
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    const result = await deleteUserAdmin(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/partners", async (_req, res, next) => {
  try {
    const partners = await getAllPartners();
    res.json({ data: partners });
  } catch (error) {
    next(error);
  }
});

export default router;
