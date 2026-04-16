export async function getWorkspaceContextFromRequestAuthHeader(authorizationHeader?: string) {
  const { prisma } = await import("./prisma");
  const session = await prisma.appSession.findUnique({
    where: { id: "primary" },
    select: {
      currentUser: {
        select: {
          id: true,
          workspaceId: true,
        },
      },
    },
  });

  const user = session?.currentUser;
  if (!user?.workspaceId) {
    return null;
  }

  return {
    userId: user.id,
    workspaceId: user.workspaceId,
  };
}
