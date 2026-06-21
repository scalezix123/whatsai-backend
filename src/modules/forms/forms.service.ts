import { PrismaClient } from "@prisma/client";
import type { CreateFormInput } from "./forms.schemas";

export async function listForms(workspaceId: string, prisma: PrismaClient) {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "WhatsAppForm" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC`,
    workspaceId
  );
}

export async function createForm(workspaceId: string, input: CreateFormInput, prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WhatsAppForm" ("id", "workspaceId", "name", "description", "fields", "submitAction", "submitConfig", "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, NOW(), NOW())`,
    workspaceId, input.name, input.description || null, JSON.stringify(input.fields), input.submitAction || "create_contact", JSON.stringify(input.submitConfig || {})
  );
  const forms = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "WhatsAppForm" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    workspaceId
  );
  return forms[0];
}

export async function getForm(id: string, workspaceId: string, prisma: PrismaClient) {
  const forms = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "WhatsAppForm" WHERE "id" = $1 AND "workspaceId" = $2`,
    id, workspaceId
  );
  if (!forms?.[0]) throw new Error("Form not found");
  return forms[0];
}

export async function submitForm(id: string, workspaceId: string, data: Record<string, unknown>, prisma: PrismaClient) {
  const form = await getForm(id, workspaceId, prisma);

  await prisma.$executeRawUnsafe(
    `INSERT INTO "FormSubmission" ("id", "workspaceId", "formId", "data", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    workspaceId, id, JSON.stringify(data)
  );

  if (form.submitAction === "create_contact" && data.phone) {
    const existing = await prisma.contact.findFirst({ where: { workspaceId, phone: String(data.phone) } });
    if (!existing) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Contact" ("id", "workspaceId", "name", "phone", "email", "optInStatus", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, 'opt_in', NOW(), NOW())`,
        workspaceId, data.name || data.phone, data.phone, data.email || null
      );
    }
  }

  if (form.submitAction === "add_tag" && data.phone) {
    const contact = await prisma.contact.findFirst({ where: { workspaceId, phone: String(data.phone) } });
    if (contact) {
      const tag = (form.submitConfig as any)?.tag || "form_submitted";
      await prisma.contactTag.upsert({
        where: { contactId_tag: { contactId: contact.id, tag } },
        update: {},
        create: { workspaceId, contactId: contact.id, tag },
      });
    }
  }

  return { success: true };
}

export async function getFormSubmissions(id: string, workspaceId: string, prisma: PrismaClient) {
  await getForm(id, workspaceId, prisma);
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "FormSubmission" WHERE "formId" = $1 ORDER BY "createdAt" DESC LIMIT 100`,
    id
  );
}

export async function deleteForm(id: string, workspaceId: string, prisma: PrismaClient) {
  await getForm(id, workspaceId, prisma);
  await prisma.$executeRawUnsafe(`DELETE FROM "FormSubmission" WHERE "formId" = $1`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "WhatsAppForm" WHERE "id" = $1 AND "workspaceId" = $2`, id, workspaceId);
}
