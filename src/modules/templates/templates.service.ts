import { PrismaClient, Prisma, TemplateStatus } from "@prisma/client";
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
import { getActiveMetaAuthorization } from "../../utils";
import {
  createMetaMessageTemplate,
  listMetaMessageTemplates,
  mapTemplateLanguageToMetaCode,
  type MetaTemplateComponent,
} from "../../meta";

// ----------------------------------------------------------------------------
// Meta Graph API integration helpers
// ----------------------------------------------------------------------------

type TemplateRecord = {
  name: string;
  language: string;
  category: string;
  body: string;
  headerType?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  buttons?: unknown;
  exampleValues?: unknown;
};

/** Resolve the access token + WABA id needed to talk to the Graph API, or null. */
async function getWabaContext(
  workspaceId: string,
  db: PrismaClient
): Promise<{ accessToken: string; wabaId: string } | null> {
  const [auth, connection] = await Promise.all([
    getActiveMetaAuthorization(workspaceId),
    db.whatsAppConnection.findFirst({ where: { workspaceId } }),
  ]);
  if (auth?.accessToken && connection?.wabaId) {
    return { accessToken: auth.accessToken, wabaId: connection.wabaId };
  }
  return null;
}

/** Ascending unique `{{n}}` placeholders within a single string. */
function placeholdersIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = /\{\{\s*([0-9]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) found.add(`{{${m[1]}}}`);
  return [...found].sort(
    (a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, ""))
  );
}

/** Map a local lowercase template status... from Meta's uppercase status set. */
function mapMetaStatusToLocal(status: string): TemplateStatus {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return TemplateStatus.approved;
    case "REJECTED":
      return TemplateStatus.rejected;
    default:
      // PENDING, IN_APPEAL, PENDING_DELETION, FLAGGED, etc. -> treat as pending.
      return TemplateStatus.pending;
  }
}

function mapButtonToMeta(b: any): Record<string, unknown> {
  const type = String(b?.type ?? "QUICK_REPLY").toUpperCase();
  if (type === "URL") return { type: "URL", text: b.text, url: b.url };
  if (type === "PHONE_NUMBER")
    return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number ?? b.phone };
  return { type: "QUICK_REPLY", text: b.text };
}

/** Build Meta's `components` payload from a local template record. */
function buildMetaComponents(template: TemplateRecord): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = [];
  const examples = (template.exampleValues ?? {}) as Record<string, string>;

  // HEADER (text headers only; media headers need handles we don't store).
  if (template.headerType === "text" && template.headerText) {
    const header: MetaTemplateComponent = {
      type: "HEADER",
      format: "TEXT",
      text: template.headerText,
    };
    const headerVars = placeholdersIn(template.headerText);
    if (headerVars.length > 0) {
      header.example = { header_text: headerVars.map((t) => examples[t] ?? "Sample") };
    }
    components.push(header);
  }

  // BODY (required).
  const body: MetaTemplateComponent = { type: "BODY", text: template.body };
  const bodyVars = placeholdersIn(template.body);
  if (bodyVars.length > 0) {
    body.example = { body_text: [bodyVars.map((t) => examples[t] ?? "Sample")] };
  }
  components.push(body);

  // FOOTER.
  if (template.footerText) {
    components.push({ type: "FOOTER", text: template.footerText });
  }

  // BUTTONS.
  const buttons = Array.isArray(template.buttons) ? (template.buttons as any[]) : [];
  if (buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: buttons.map(mapButtonToMeta) });
  }

  return components;
}

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

  // Live path: submit to Meta's message_templates endpoint and store the id +
  // returned status. Falls back to a simulated "pending" when no WhatsApp
  // Business Account is connected (dev/test), so the workflow stays exercisable.
  const waba = await getWabaContext(workspaceId, db);
  if (waba) {
    let res;
    try {
      res = await createMetaMessageTemplate({
        accessToken: waba.accessToken,
        wabaId: waba.wabaId,
        name: template.name,
        language: mapTemplateLanguageToMetaCode(template.language),
        category: template.category.toUpperCase(),
        components: buildMetaComponents(template),
      });
    } catch (error) {
      const err: any = new Error(
        `Meta template submission failed: ${(error as Error).message}`
      );
      err.statusCode = 502;
      throw err;
    }
    return db.messageTemplate.update({
      where: { id },
      data: {
        status: res.status ? mapMetaStatusToLocal(res.status) : TemplateStatus.pending,
        metaTemplateId: res.id ?? null,
        rejectionReason: null,
        syncedAt: new Date(),
      },
    });
  }

  // No live WABA -> simulate submission so the approval flow can be tested.
  return db.messageTemplate.update({
    where: { id },
    data: { status: "pending", rejectionReason: null },
  });
}

/**
 * Reconcile local template statuses against Meta. Lists the WABA's templates and
 * updates each local row's status / rejection reason / metaTemplateId. Falls back
 * to a no-op (timestamp only) when no WhatsApp Business Account is connected.
 */
export async function syncTemplatesWithMeta(workspaceId: string, db: PrismaClient) {
  const waba = await getWabaContext(workspaceId, db);
  const locals = await db.messageTemplate.findMany({ where: { workspaceId } });

  if (!waba) {
    await db.messageTemplate.updateMany({
      where: { workspaceId },
      data: { syncedAt: new Date() },
    });
    return {
      synced: 0,
      updated: 0,
      syncedAt: new Date().toISOString(),
      note: "No live WhatsApp Business Account connected; statuses unchanged.",
    };
  }

  const remote = await listMetaMessageTemplates({
    accessToken: waba.accessToken,
    wabaId: waba.wabaId,
  });
  const byId = new Map(remote.filter((r) => r.id).map((r) => [r.id, r]));
  const byNameLang = new Map(
    remote.map((r) => [`${r.name}:${(r.language ?? "").toLowerCase()}`, r])
  );
  const byName = new Map(remote.map((r) => [r.name, r]));

  let updated = 0;
  for (const t of locals) {
    const metaLang = mapTemplateLanguageToMetaCode(t.language).toLowerCase();
    const match =
      (t.metaTemplateId ? byId.get(t.metaTemplateId) : undefined) ??
      byNameLang.get(`${t.name}:${metaLang}`) ??
      byName.get(t.name);
    if (!match) continue;

    await db.messageTemplate.update({
      where: { id: t.id },
      data: {
        status: mapMetaStatusToLocal(match.status),
        metaTemplateId: t.metaTemplateId ?? match.id,
        rejectionReason: match.rejected_reason ?? null,
        syncedAt: new Date(),
      },
    });
    updated++;
  }

  return {
    synced: remote.length,
    updated,
    syncedAt: new Date().toISOString(),
  };
}
