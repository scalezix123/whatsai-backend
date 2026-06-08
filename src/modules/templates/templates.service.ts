import { PrismaClient, Prisma } from "@prisma/client";
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  ListTemplatesInput,
} from "./templates.schemas";
import {
  extractVariables,
  validateTemplateParameters,
  renderTemplatePreview,
} from "./templates.utils";

/**
 * Build the persisted shape for an update: only sets keys the caller provided.
 */
function buildTemplateData(input: UpdateTemplateInput) {
  const data: Prisma.MessageTemplateUncheckedUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.category !== undefined) data.category = input.category;
  if (input.language !== undefined) data.language = input.language;
  if (input.body !== undefined) data.body = input.body;
  if (input.headerType !== undefined) data.headerType = input.headerType;
  if (input.headerText !== undefined) data.headerText = input.headerText;
  if (input.footerText !== undefined) data.footerText = input.footerText;
  if (input.buttons !== undefined) data.buttons = input.buttons as Prisma.InputJsonValue;
  if (input.exampleValues !== undefined)
    data.exampleValues = input.exampleValues as Prisma.InputJsonValue;

  return data;
}

export async function createTemplate(
  workspaceId: string,
  input: CreateTemplateInput,
  db: PrismaClient
) {
  const variables = extractVariables({
    body: input.body,
    headerType: input.headerType,
    headerText: input.headerText,
    buttons: input.buttons,
  });

  return db.messageTemplate.create({
    data: {
      workspaceId,
      name: input.name,
      category: input.category,
      language: input.language,
      body: input.body,
      headerType: input.headerType,
      headerText: input.headerText,
      footerText: input.footerText,
      buttons: (input.buttons ?? []) as Prisma.InputJsonValue,
      exampleValues: (input.exampleValues ?? {}) as Prisma.InputJsonValue,
      variables: variables as Prisma.InputJsonValue,
      variableCount: variables.length,
      status: "draft",
    },
  });
}

export async function listTemplates(
  workspaceId: string,
  filters: ListTemplatesInput,
  db: PrismaClient
) {
  const where: Prisma.MessageTemplateWhereInput = { workspaceId };

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { body: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.category) where.category = filters.category;
  if (filters.status) where.status = filters.status;

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
  const template = await db.messageTemplate.findFirst({
    where: { id, workspaceId },
  });

  if (!template) {
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
  const existing = await getTemplate(id, workspaceId, db);

  if (existing.status === "pending") {
    throw new Error("Cannot edit a template that is pending Meta approval");
  }

  const data = buildTemplateData(input);

  // Re-derive variables from the merged content whenever any text field changes.
  if (
    input.body !== undefined ||
    input.headerType !== undefined ||
    input.headerText !== undefined ||
    input.buttons !== undefined
  ) {
    const variables = extractVariables({
      body: input.body ?? existing.body,
      headerType: input.headerType ?? existing.headerType,
      headerText: input.headerText ?? existing.headerText,
      buttons: input.buttons ?? existing.buttons,
    });
    data.variables = variables as Prisma.InputJsonValue;
    data.variableCount = variables.length;
  }

  // Editing a rejected template returns it to draft so it can be resubmitted.
  if (existing.status === "rejected") {
    data.status = "draft";
    data.rejectionReason = null;
  }

  return db.messageTemplate.update({ where: { id }, data });
}

export async function deleteTemplate(id: string, workspaceId: string, db: PrismaClient) {
  await getTemplate(id, workspaceId, db);
  return db.messageTemplate.delete({ where: { id } });
}

/**
 * Return the placeholders a template uses, with any stored example values.
 */
export async function getTemplateVariables(id: string, workspaceId: string, db: PrismaClient) {
  const template = await getTemplate(id, workspaceId, db);
  const variables = extractVariables(template);
  const examples = (template.exampleValues ?? {}) as Record<string, string>;

  return {
    variables,
    variableCount: variables.length,
    examples,
  };
}

/**
 * Validate a parameter map before a campaign send. Returns the structured result
 * so the caller (route or campaign engine) can react.
 */
export async function validateParameters(
  id: string,
  workspaceId: string,
  parameters: Record<string, string>,
  db: PrismaClient
) {
  const template = await getTemplate(id, workspaceId, db);
  return validateTemplateParameters(template, parameters);
}

/**
 * Render a filled-in preview. Falls back to stored example values when the
 * caller doesn't pass parameters.
 */
export async function previewTemplate(
  id: string,
  workspaceId: string,
  parameters: Record<string, string> | undefined,
  db: PrismaClient
) {
  const template = await getTemplate(id, workspaceId, db);
  const values =
    parameters && Object.keys(parameters).length > 0
      ? parameters
      : ((template.exampleValues ?? {}) as Record<string, string>);

  return renderTemplatePreview(template, values);
}

export async function submitTemplateForApproval(
  id: string,
  workspaceId: string,
  db: PrismaClient
) {
  const template = await getTemplate(id, workspaceId, db);

  if (template.status !== "draft" && template.status !== "rejected") {
    throw new Error("Only draft or rejected templates can be submitted");
  }

  // Guard: every placeholder must have an example value before submission,
  // matching Meta's requirement that templates ship sample content.
  const variables = extractVariables(template);
  const examples = (template.exampleValues ?? {}) as Record<string, string>;
  const missingExamples = variables.filter((token) => !examples[token]);
  if (missingExamples.length > 0) {
    throw new Error(
      `Provide example values for all variables before submitting: ${missingExamples.join(", ")}`
    );
  }

  // TODO (Stage 3 follow-up): POST to Meta's message_templates endpoint here and
  // store the returned id. For now we move to "pending" and let the sync job
  // reconcile the real status.
  return db.messageTemplate.update({
    where: { id },
    data: { status: "pending", rejectionReason: null },
  });
}

/**
 * Sync local template statuses with Meta. Currently a stub that records the sync
 * time; wire the real Graph API call in when credentials are available.
 */
export async function syncTemplatesWithMeta(workspaceId: string, db: PrismaClient) {
  const templates = await db.messageTemplate.findMany({ where: { workspaceId } });

  await db.messageTemplate.updateMany({
    where: { workspaceId },
    data: { syncedAt: new Date() },
  });

  return {
    synced: templates.length,
    syncedAt: new Date().toISOString(),
    note: "Meta Graph API sync not yet wired; statuses unchanged.",
  };
}
