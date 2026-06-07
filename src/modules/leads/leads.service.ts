import { PrismaClient } from "@prisma/client";
import type {
  ListLeadsInput,
  UpdateLeadStatusInput,
  AddLeadNoteInput,
  CreateLeadInput,
} from "./leads.schemas";

export async function listLeads(
  workspaceId: string,
  filters: ListLeadsInput,
  db: PrismaClient
) {
  const where: any = { workspaceId };

  if (filters.search) {
    where.OR = [
      { contact: { name: { contains: filters.search, mode: "insensitive" } } },
      { contact: { phone: { contains: filters.search } } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.source) {
    where.source = filters.source;
  }

  if (filters.assignedTo) {
    where.assignedTo = filters.assignedTo;
  }

  const orderBy: any = {};
  switch (filters.sortBy) {
    case "createdAt":
      orderBy.createdAt = "desc";
      break;
    case "value":
      orderBy.value = "desc";
      break;
    case "updatedAt":
    default:
      orderBy.updatedAt = "desc";
  }

  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      include: { contact: true, assignedUser: true },
      orderBy,
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, leads, page: filters.page, limit: filters.limit };
}

export async function getLead(id: string, workspaceId: string, db: PrismaClient) {
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      contact: true,
      assignedUser: true,
      notes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!lead || lead.workspaceId !== workspaceId) {
    throw new Error("Lead not found");
  }

  return lead;
}

export async function createLead(
  workspaceId: string,
  input: CreateLeadInput,
  db: PrismaClient
) {
  const contact = await db.contact.findFirst({
    where: { id: input.contactId, workspaceId },
  });

  if (!contact) {
    throw new Error("Contact not found");
  }

  return await db.lead.create({
    data: {
      workspaceId,
      contactId: input.contactId,
      source: input.source,
      status: "new",
      value: input.value,
      description: input.description,
      metadata: input.metadata,
    },
    include: { contact: true },
  });
}

export async function updateLeadStatus(
  id: string,
  workspaceId: string,
  input: UpdateLeadStatusInput,
  db: PrismaClient
) {
  const lead = await db.lead.findUnique({
    where: { id },
  });

  if (!lead || lead.workspaceId !== workspaceId) {
    throw new Error("Lead not found");
  }

  return await db.lead.update({
    where: { id },
    data: {
      status: input.status,
      reason: input.reason,
    },
    include: { contact: true, assignedUser: true },
  });
}

export async function addLeadNote(
  leadId: string,
  workspaceId: string,
  input: AddLeadNoteInput,
  db: PrismaClient
) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
  });

  if (!lead || lead.workspaceId !== workspaceId) {
    throw new Error("Lead not found");
  }

  return await db.leadNote.create({
    data: {
      leadId,
      content: input.content,
      type: input.type,
    },
  });
}

export async function assignLead(
  id: string,
  workspaceId: string,
  userId: string,
  db: PrismaClient
) {
  const lead = await db.lead.findUnique({
    where: { id },
  });

  if (!lead || lead.workspaceId !== workspaceId) {
    throw new Error("Lead not found");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.workspaceId !== workspaceId) {
    throw new Error("User not found");
  }

  return await db.lead.update({
    where: { id },
    data: { assignedTo: userId },
    include: { contact: true, assignedUser: true },
  });
}

export async function getLeadsByContact(
  contactId: string,
  workspaceId: string,
  db: PrismaClient
) {
  return await db.lead.findMany({
    where: { contactId, workspaceId },
    include: { assignedUser: true },
    orderBy: { createdAt: "desc" },
  });
}
