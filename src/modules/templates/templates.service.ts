import { PrismaClient } from "@prisma/client";
import type { CreateTemplateInput, UpdateTemplateInput, ListTemplatesInput } from "./templates.schemas";

export async function createTemplate(
  workspaceId: string,
  input: CreateTemplateInput,
  db: PrismaClient
) {
  return await db.messageTemplate.create({
    data: {
      workspaceId,
      name: input.name,
      category: input.category,
      language: input.language,
      headerType: input.headerType,
      headerText: input.headerText,
      bodyText: input.bodyText,
      footerText: input.footerText,
      status: "DRAFT",
      buttons: input.buttons || [],
    },
  });
}

export async function listTemplates(
  workspaceId: string,
  filters: ListTemplatesInput,
  db: PrismaClient
) {
  const where: any = { workspaceId };

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { bodyText: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  const [total, templates] = await Promise.all([
    db.messageTemplate.count({ where }),
    db.messageTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, templates, page: filters.page, limit: filters.limit };
}

export async function getTemplate(id: string, workspaceId: string, db: PrismaClient) {
  const template = await db.messageTemplate.findUnique({
    where: { id },
  });

  if (!template || template.workspaceId !== workspaceId) {
    throw new Error("Template not found");
  }

  return template;
}

export async function updateTemplate(
  id: string,
  workspaceId: string,
  input: UpdateTemplateInput,
  db: PrismaClient
) {
  const template = await db.messageTemplate.findUnique({
    where: { id },
  });

  if (!template || template.workspaceId !== workspaceId) {
    throw new Error("Template not found");
  }

  return await db.messageTemplate.update({
    where: { id },
    data: {
      name: input.name,
      category: input.category,
      language: input.language,
      headerType: input.headerType,
      headerText: input.headerText,
      bodyText: input.bodyText,
      footerText: input.footerText,
      buttons: input.buttons,
    },
  });
}

export async function deleteTemplate(id: string, workspaceId: string, db: PrismaClient) {
  const template = await db.messageTemplate.findUnique({
    where: { id },
  });

  if (!template || template.workspaceId !== workspaceId) {
    throw new Error("Template not found");
  }

  return await db.messageTemplate.delete({ where: { id } });
}

export async function submitTemplateForApproval(
  id: string,
  workspaceId: string,
  db: PrismaClient
) {
  const template = await getTemplate(id, workspaceId, db);

  if (template.status !== "DRAFT") {
    throw new Error("Only draft templates can be submitted");
  }

  return await db.messageTemplate.update({
    where: { id },
    data: { status: "SUBMITTED" },
  });
}

export async function syncTemplatesWithMeta(
  workspaceId: string,
  db: PrismaClient
) {
  const templates = await db.messageTemplate.findMany({
    where: { workspaceId },
  });

  // TODO: Call Meta API to sync template statuses
  // For now, just return count of templates
  return { synced: templates.length, templates };
}
