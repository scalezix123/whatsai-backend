import { prisma } from "../../prisma";
import { getCurrentUser } from "../../state";
import { listAllUsers, updateUserRole, deleteUser, listAllPartners } from "../../admin";
import type { UpdateUserRoleInput } from "./admin.schemas";
import { UserRole } from "@prisma/client";

async function requireAdmin() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }
  if (user.role !== UserRole.ADMIN) {
    throw new Error("Only administrators can access this resource.");
  }
  return user;
}

export async function getAllUsers() {
  await requireAdmin();
  const users = await listAllUsers(prisma);
  return users;
}

export async function updateUserRoleAdmin(userId: string, input: UpdateUserRoleInput) {
  await requireAdmin();
  const user = await updateUserRole(prisma, userId, input.role);
  return user;
}

export async function deleteUserAdmin(userId: string) {
  await requireAdmin();
  await deleteUser(prisma, userId);
  return { message: "User deleted successfully." };
}

export async function getAllPartners() {
  await requireAdmin();
  const partners = await listAllPartners(prisma);
  return partners;
}
