import { prisma } from "../../prisma";
import type { CreateContactInput } from "./contacts.schemas";
import { buildAppState, getCurrentUser } from "../../state";

const SAMPLE_CONTACTS = [
  {
    name: "Kunal Mehta",
    phone: "+91 99887 77665",
    tags: ["CSV", "Shopify"],
  },
  { name: "Neha Kapoor", phone: "+91 90909 80808", tags: ["CSV", "VIP"] },
  {
    name: "Ritesh Jain",
    phone: "+91 93456 78123",
    tags: ["CSV", "Retail"],
  },
];

export async function createContact(input: CreateContactInput) {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  await prisma.contact.create({
    data: {
      workspaceId: user.workspaceId,
      name: input.name,
      phone: input.phone,
      tags: {
        create: input.tags.map((tag) => ({
          workspaceId: user.workspaceId,
          tag,
        })),
      },
    },
  });

  const freshUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const data = await buildAppState(prisma, freshUser);
  return data;
}

export async function uploadSampleContacts() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  for (const sample of SAMPLE_CONTACTS) {
    const exists = await prisma.contact.findFirst({
      where: { workspaceId: user.workspaceId, phone: sample.phone },
    });
    if (exists) {
      continue;
    }
    await prisma.contact.create({
      data: {
        workspaceId: user.workspaceId,
        name: sample.name,
        phone: sample.phone,
        tags: {
          create: sample.tags.map((tag) => ({
            workspaceId: user.workspaceId,
            tag,
          })),
        },
      },
    });
  }

  const freshUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const data = await buildAppState(prisma, freshUser);
  return data;
}
