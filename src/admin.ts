import { PrismaClient, UserRole } from "@prisma/client";

export async function listAllUsers(prisma: PrismaClient) {
  return prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      onboardingComplete: true,
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateUserRole(prisma: PrismaClient, userId: string, role: UserRole) {
  return prisma.user.update({
    where: { id: userId },
    data: { role },
  });
}

export async function deleteUser(prisma: PrismaClient, userId: string) {
  // We might want to be careful with deletion in a real SaaS,
  // potentially deactivated or soft-delete instead.
  return prisma.user.delete({
    where: { id: userId },
  });
}

export async function listAllPartners(prisma: PrismaClient) {
  return prisma.partner.findMany({
    include: {
      workspace: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
