import { PrismaClient } from "@prisma/client";

export async function handleAbandonedCartEvent(
  workspaceId: string,
  data: { phone: string; productName: string; productUrl: string; cartValue: number },
  prisma: PrismaClient
) {
  const contact = await prisma.contact.findFirst({ where: { workspaceId, phone: data.phone } });

  if (contact) {
    await prisma.contactTag.upsert({
      where: { contactId_tag: { contactId: contact.id, tag: "abandoned_cart" } },
      update: {},
      create: { workspaceId, contactId: contact.id, tag: "abandoned_cart" },
    });

    await prisma.contactAttributeValue.upsert({
      where: { contactId_attributeId: { contactId: contact.id, attributeId: "cart_value" } },
      update: { value: String(data.cartValue) },
      create: {
        contactId: contact.id,
        attributeId: "cart_value",
        value: String(data.cartValue),
      },
    }).catch(() => {});
  }

  return { tracked: true, contactId: contact?.id ?? null };
}

export async function getAbandonedCartStats(workspaceId: string, prisma: PrismaClient) {
  const cartContacts = await prisma.contactTag.findMany({
    where: { workspaceId, tag: "abandoned_cart" },
    include: { contact: { select: { id: true, name: true, phone: true } } },
  });

  return {
    total: cartContacts.length,
    contacts: cartContacts.map((ct) => ct.contact),
  };
}
