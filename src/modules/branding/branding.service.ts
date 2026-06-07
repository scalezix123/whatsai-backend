import { prisma } from "../../prisma";

const SHORT_LINKS: Record<string, string> = {
  "join-group": "https://chat.whatsapp.com/example-group-id",
};

export async function resolveShortLink(
  code: string,
  ipAddress: string | undefined,
  userAgent: string | undefined,
  contactId?: string,
  workspaceId?: string,
) {
  const targetUrl = SHORT_LINKS[code];
  if (!targetUrl) {
    throw new Error("Link not found.");
  }

  if (workspaceId) {
    prisma.linkClick
      .create({
        data: {
          workspaceId,
          contactId: contactId || null,
          linkCode: code,
          originalUrl: targetUrl,
          ipAddress,
          userAgent,
        },
      })
      .catch((err) => console.error("Failed to log link click", err));
  }

  return targetUrl;
}

export async function getBrandingByRef(ref: string) {
  const partner = await prisma.partner.findFirst({
    where: {
      OR: [{ referralCode: ref }, { id: ref }],
      status: "approved",
    },
    select: {
      brandName: true,
      logoUrl: true,
      primaryColor: true,
      supportEmail: true,
    },
  });

  if (!partner) {
    throw new Error("Branding not found.");
  }

  return partner;
}
