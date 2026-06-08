import { PrismaClient } from "@prisma/client";
import type {
  CreateContactInput,
  UpdateContactInput,
  ListContactsInput,
  CreateTagInput,
  ListTagsInput,
  CreateAttributeInput,
  SetAttributeValueInput,
  StartContactImportInput,
  ListImportBatchesInput,
  MarkContactOptInInput,
  MarkContactOptOutInput,
  BulkUpdateOptInInput,
} from "./contacts.schemas";

// ============================================================================
// CONTACT CRUD OPERATIONS
// ============================================================================

/**
 * Strip formatting (spaces, dashes, parentheses) so that "+1 (555) 123-4567"
 * and "+15551234567" are treated as the same number for storage and dedup.
 * Used by create, update and CSV import so all paths agree.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

export async function createContact(
  workspaceId: string,
  input: CreateContactInput,
  db: PrismaClient
) {
  const phone = normalizePhone(input.phone);

  // Check for duplicates
  const existing = await db.contact.findFirst({
    where: { workspaceId, phone },
  });

  if (existing) {
    throw new Error("Contact with this phone number already exists");
  }

  return await db.contact.create({
    data: {
      workspaceId,
      name: input.name,
      phone,
      email: input.email,
      optInStatus: input.optInStatus || "unknown",
    },
  });
}

export async function listContacts(
  workspaceId: string,
  filters: ListContactsInput,
  db: PrismaClient
) {
  const where: any = { workspaceId };

  // Search by name, phone or email
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  // Filter by tags
  if (filters.tags?.length) {
    where.tags = {
      some: {
        tag: { in: filters.tags },
      },
    };
  }

  // Filter by opt-in status
  if (filters.optInStatus) {
    where.optInStatus = filters.optInStatus;
  }

  const orderBy: any = {};
  switch (filters.sortBy) {
    case "name":
      orderBy.name = "asc";
      break;
    case "lastMessage":
      orderBy.lastMessageAt = "desc";
      break;
    case "createdAt":
    default:
      orderBy.createdAt = "desc";
  }

  const [total, contacts] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      include: { tags: true },
      orderBy,
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return {
    total,
    contacts,
    page: filters.page,
    limit: filters.limit,
    pageCount: Math.ceil(total / filters.limit),
  };
}

export async function getContact(id: string, workspaceId: string, db: PrismaClient) {
  const contact = await db.contact.findUnique({
    where: { id },
    include: {
      tags: true,
      attributes: {
        include: { attribute: true },
      },
    },
  });

  if (!contact || contact.workspaceId !== workspaceId) {
    throw new Error("Contact not found");
  }

  return contact;
}

export async function updateContact(
  id: string,
  workspaceId: string,
  input: UpdateContactInput,
  db: PrismaClient
) {
  const contact = await db.contact.findUnique({
    where: { id },
  });

  if (!contact || contact.workspaceId !== workspaceId) {
    throw new Error("Contact not found");
  }

  const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;

  // Check for duplicate phone if phone is being changed
  if (normalizedPhone && normalizedPhone !== contact.phone) {
    const duplicate = await db.contact.findFirst({
      where: {
        workspaceId,
        phone: normalizedPhone,
        NOT: { id },
      },
    });

    if (duplicate) {
      throw new Error("Phone number already in use");
    }
  }

  return await db.contact.update({
    where: { id },
    data: {
      name: input.name,
      phone: normalizedPhone,
      email: input.email,
      optInStatus: input.optInStatus,
    },
    include: { tags: true },
  });
}

export async function deleteContact(id: string, workspaceId: string, db: PrismaClient) {
  const contact = await db.contact.findUnique({
    where: { id },
  });

  if (!contact || contact.workspaceId !== workspaceId) {
    throw new Error("Contact not found");
  }

  return await db.contact.delete({ where: { id } });
}

// ============================================================================
// TAG MANAGEMENT
// ============================================================================

export async function createTag(
  workspaceId: string,
  input: CreateTagInput,
  db: PrismaClient
) {
  try {
    return await db.tagDefinition.create({
      data: {
        workspaceId,
        name: input.name,
        color: input.color,
      },
    });
  } catch (error: any) {
    if (error.code === "P2002") {
      throw new Error("Tag already exists");
    }
    throw error;
  }
}

export async function listTags(
  workspaceId: string,
  filters: ListTagsInput,
  db: PrismaClient
) {
  const [total, tags] = await Promise.all([
    db.tagDefinition.count({ where: { workspaceId } }),
    db.tagDefinition.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, tags, page: filters.page, limit: filters.limit };
}

export async function assignTagToContact(
  contactId: string,
  workspaceId: string,
  tagName: string,
  db: PrismaClient
) {
  const [contact, tagDef] = await Promise.all([
    db.contact.findFirst({ where: { id: contactId, workspaceId } }),
    db.tagDefinition.findFirst({ where: { workspaceId, name: tagName } }),
  ]);

  if (!contact) throw new Error("Contact not found");
  if (!tagDef) throw new Error("Tag not found");

  // Also create legacy ContactTag entry for backwards compatibility
  return await db.contactTag.upsert({
    where: { contactId_tag: { contactId, tag: tagName } },
    create: { contactId, tag: tagName, workspaceId },
    update: {},
  });
}

export async function removeTagFromContact(
  contactId: string,
  workspaceId: string,
  tagName: string,
  db: PrismaClient
) {
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId },
  });

  if (!contact) throw new Error("Contact not found");

  return await db.contactTag.delete({
    where: { contactId_tag: { contactId, tag: tagName } },
  });
}

// ============================================================================
// ATTRIBUTE MANAGEMENT
// ============================================================================

export async function createAttributeDefinition(
  workspaceId: string,
  input: CreateAttributeInput,
  db: PrismaClient
) {
  try {
    return await db.attributeDefinition.create({
      data: {
        workspaceId,
        name: input.name,
        type: input.type,
        defaultValue: input.defaultValue,
        isRequired: input.isRequired,
      },
    });
  } catch (error: any) {
    if (error.code === "P2002") {
      throw new Error("Attribute already exists");
    }
    throw error;
  }
}

export async function setContactAttribute(
  contactId: string,
  workspaceId: string,
  attributeName: string,
  value: string,
  db: PrismaClient
) {
  const [contact, attrDef] = await Promise.all([
    db.contact.findFirst({ where: { id: contactId, workspaceId } }),
    db.attributeDefinition.findFirst({ where: { workspaceId, name: attributeName } }),
  ]);

  if (!contact) throw new Error("Contact not found");
  if (!attrDef) throw new Error("Attribute not found");

  return await db.contactAttributeValue.upsert({
    where: { contactId_attributeId: { contactId, attributeId: attrDef.id } },
    create: { contactId, attributeId: attrDef.id, value },
    update: { value },
  });
}

// ============================================================================
// CONSENT MANAGEMENT
// ============================================================================

export async function markContactOptIn(
  contactId: string,
  workspaceId: string,
  db: PrismaClient
) {
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId },
  });

  if (!contact) throw new Error("Contact not found");

  return await db.contact.update({
    where: { id: contactId },
    data: {
      optInStatus: "opt_in",
      optedInAt: new Date(),
      optedOutAt: null,
    },
  });
}

export async function markContactOptOut(
  contactId: string,
  workspaceId: string,
  reason: string | undefined,
  db: PrismaClient
) {
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId },
  });

  if (!contact) throw new Error("Contact not found");

  return await db.contact.update({
    where: { id: contactId },
    data: {
      optInStatus: "opt_out",
      optedOutAt: new Date(),
      optOutSource: reason,
    },
  });
}

export async function bulkUpdateOptInStatus(
  workspaceId: string,
  input: BulkUpdateOptInInput,
  db: PrismaClient
) {
  const now = new Date();
  const updateData = {
    optInStatus: input.optInStatus,
    ...(input.optInStatus === "opt_in" && { optedInAt: now, optedOutAt: null }),
    ...(input.optInStatus === "opt_out" && { optedOutAt: now }),
  };

  const result = await db.contact.updateMany({
    where: {
      workspaceId,
      id: { in: input.contactIds },
    },
    data: updateData,
  });

  return {
    updated: result.count,
    total: input.contactIds.length,
  };
}

export async function canSendBroadcastToContact(
  contactId: string,
  db: PrismaClient
): Promise<boolean> {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { optInStatus: true },
  });

  return contact?.optInStatus === "opt_in";
}

// ============================================================================
// CSV IMPORT
// ============================================================================

export async function startContactImport(
  workspaceId: string,
  fileName: string,
  rows: any[],
  columnMapping: Record<string, string>,
  skipDuplicates: boolean,
  db: PrismaClient
) {
  // Create import batch
  const batch = await db.contactImportBatch.create({
    data: {
      workspaceId,
      fileName,
      totalRows: rows.length,
      status: "processing",
    },
  });

  // Process rows asynchronously (non-blocking)
  processImportRowsAsync(batch.id, rows, columnMapping, skipDuplicates, workspaceId, db);

  return batch;
}

async function processImportRowsAsync(
  batchId: string,
  rows: any[],
  columnMapping: Record<string, string>,
  skipDuplicates: boolean,
  workspaceId: string,
  db: PrismaClient
) {
  let successCount = 0;
  let errorCount = 0;

  // columnMapping is { csvColumn: field } (e.g. { "Full Name": "name" }).
  // Invert it to { field: csvColumn } so we can read row[csvColumn] per field.
  const fieldToColumn: Record<string, string> = {};
  for (const [csvColumn, field] of Object.entries(columnMapping)) {
    fieldToColumn[field] = csvColumn;
  }

  for (let i = 0; i < rows.length; i++) {
    try {
      const row = rows[i];
      const name = row[fieldToColumn["name"]]?.toString()?.trim();
      const phone = row[fieldToColumn["phone"]]?.toString()?.trim();
      const email = row[fieldToColumn["email"]]?.toString()?.trim();

      // Validate required fields
      if (!name) throw new Error("Name is required");
      if (!phone) throw new Error("Phone is required");

      // Normalize phone (remove spaces, dashes, etc.) — same rule as create/update
      const normalizedPhone = normalizePhone(phone);

      // Check for duplicates
      const existing = await db.contact.findFirst({
        where: { workspaceId, phone: normalizedPhone },
      });

      if (existing) {
        if (skipDuplicates) {
          continue;
        } else {
          throw new Error("Duplicate phone number");
        }
      }

      // Create contact
      await db.contact.create({
        data: {
          workspaceId,
          name,
          phone: normalizedPhone,
          email: email || undefined,
        },
      });

      successCount++;
    } catch (error) {
      errorCount++;
      const row = rows[i];
      await db.contactImportError.create({
        data: {
          batchId,
          rowNumber: i + 2,
          phone: row[fieldToColumn["phone"]]?.toString(),
          name: row[fieldToColumn["name"]]?.toString(),
          reason: (error as Error).message,
        },
      });
    }
  }

  // Update batch status
  await db.contactImportBatch.update({
    where: { id: batchId },
    data: {
      successCount,
      errorCount,
      status: "completed",
      completedAt: new Date(),
    },
  });
}

export async function listImportBatches(
  workspaceId: string,
  filters: ListImportBatchesInput,
  db: PrismaClient
) {
  const where: any = { workspaceId };

  if (filters.status) {
    where.status = filters.status;
  }

  const [total, batches] = await Promise.all([
    db.contactImportBatch.count({ where }),
    db.contactImportBatch.findMany({
      where,
      include: { errors: true },
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, batches, page: filters.page, limit: filters.limit };
}

export async function getImportBatch(batchId: string, workspaceId: string, db: PrismaClient) {
  const batch = await db.contactImportBatch.findUnique({
    where: { id: batchId },
    include: { errors: true },
  });

  if (!batch || batch.workspaceId !== workspaceId) {
    throw new Error("Import batch not found");
  }

  return batch;
}

export async function downloadImportErrors(
  batchId: string,
  workspaceId: string,
  db: PrismaClient
) {
  const batch = await db.contactImportBatch.findUnique({
    where: { id: batchId },
    include: { errors: true },
  });

  if (!batch || batch.workspaceId !== workspaceId) {
    throw new Error("Import batch not found");
  }

  // Format as CSV
  let csv = "Row Number,Phone,Name,Reason\n";
  for (const error of batch.errors) {
    csv += `${error.rowNumber},"${error.phone || ""}","${error.name || ""}","${error.reason}"\n`;
  }

  return csv;
}

// Backward compatibility stubs
export async function uploadSampleContacts() {
  throw new Error("uploadSampleContacts is deprecated. Use createContact instead.");
}
