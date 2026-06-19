import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requireSession, requireRole } from "../../middleware";
import { updateUserRoleSchema } from "./admin.schemas";
import {
  getAllUsers,
  updateUserRoleAdmin,
  deleteUserAdmin,
  getAllPartners,
} from "./admin.service";
import { logAuditEvent } from "../../utils";

const router = Router();

// Administrator-only management surface (defense-in-depth: middleware here AND a
// service-layer role check inside admin.service).
const adminOnly = requireRole([UserRole.ADMIN]);

router.get("/users", requireSession, adminOnly, async (_req, res, next) => {
  try {
    const users = await getAllUsers();
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id/role", requireSession, adminOnly, async (req, res, next) => {
  try {
    const payload = updateUserRoleSchema.parse(req.body);
    const user = await updateUserRoleAdmin(req.params.id, payload);
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: "user.role_changed",
      summary: `Role of user ${req.params.id} changed to ${payload.role}`,
      payload: { targetUserId: req.params.id, role: payload.role },
    });
    res.json({ data: user });
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", requireSession, adminOnly, async (req, res, next) => {
  try {
    const result = await deleteUserAdmin(req.params.id);
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: "user.deleted",
      summary: `User ${req.params.id} deleted`,
      payload: { targetUserId: req.params.id },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/partners", requireSession, adminOnly, async (_req, res, next) => {
  try {
    const partners = await getAllPartners();
    res.json({ data: partners });
  } catch (error) {
    next(error);
  }
});

export default router;
