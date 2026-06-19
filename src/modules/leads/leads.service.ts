import { PrismaClient, Prisma } from "@prisma/client";
import type {
  ListLeadsInput,
  CreateLeadInput,
  UpdateLeadStatusInput,
  AddLeadNoteInput,
} from "./leads.schemas";

export async function listLeads(
  workspaceId: string,
  filters: ListLeadsInput,
  db: PrismaClient
) {
  const where: Prisma.LeadWhereInput = { workspaceId };

  if (filters.search) {
    where.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search } },
      { email: { contains: filters.search, mode: "insensitive" } },
      { contact: { name: { contains: filters.search, mode: "insensitive" } } },
    ];
  }
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.assignedTo) where.assignedTo = filters.assignedTo;

  const orderBy: Prisma.LeadOrderByWithRelationInput =
    filters.sortBy === "createdAt" ? { createdAt: "desc" } : { updatedAt: "desc" };

  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      include: { contact: true },
      orderBy,
      take: filters.limit,
      skip: (filters.page - 1) * filters.limit,
    }),
  ]);

  return { total, leads, page: filters.page, limit: filters.limit };
}

export async function getLead(id: string, workspaceId: string, db: PrismaClient) {
  const lead = await db.lead.findFirst({
    where: { id, workspaceId },
    include: { contact: true, conversation: true },
  });
  if (!lead) throw new Error("Lead not found");
  return lead;
}

export async function createLead(
  workspaceId: string,
  input: CreateLeadInput,
  db: PrismaClient
) {
  let fullName = input.fullName;
  let phone = input.phone;
  let email = input.email;
  let contactId = input.contactId;

  if (contactId) {
    const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId } });
    if (!contact) throw new Error("Contact not found");
    fullName = fullName ?? contact.name;
    phone = phone ?? contact.phone;
    email = email ?? contact.email ?? undefined;
  }

  if (!fullName || !phone) {
    throw new Error("Provide a contactId, or both fullName and phone");
  }

  return db.lead.create({
    data: {
      workspaceId,
      contactId: contactId ?? null,
      conversationId: input.conversationId ?? null,
      fullName,
      phone,
      email: email ?? "",
      status: "new",
      source: input.source,
      sourceLabel: input.sourceLabel ?? "",
      notes: input.notes ?? "",
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
  const lead = await db.lead.findFirst({ where: { id, workspaceId } });
  if (!lead) throw new Error("Lead not found");

  // Optional note is appended to the running notes log with a status marker.
  const notes = input.note
    ? appendNote(lead.notes, `[status → ${input.status}] ${input.note}`)
    : lead.notes;

  return db.lead.update({
    where: { id },
    data: { status: input.status, notes },
    include: { contact: true },
  });
}

/**
 * Lead has a single `notes` text field (no separate note model), so notes are
 * kept as a timestamped, newline-separated log.
 */
function appendNote(existing: string, entry: string, authorName?: string): string {
  const stamp = new Date().toISOString();
  const author = authorName ? ` ${authorName}` : "";
  const line = `[${stamp}${author}] ${entry}`;
  return existing ? `${existing}\n${line}` : line;
}

export async function addLeadNote(
  leadId: string,
  workspaceId: string,
  input: AddLeadNoteInput,
  db: PrismaClient
) {
  const lead = await db.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) throw new Error("Lead not found");

  return db.lead.update({
    where: { id: leadId },
    data: { notes: appendNote(lead.notes, input.content, input.authorName) },
    include: { contact: true },
  });
}

export async function assignLead(
  id: string,
  workspaceId: string,
  userId: string | null,
  db: PrismaClient
) {
  const lead = await db.lead.findFirst({ where: { id, workspaceId } });
  if (!lead) throw new Error("Lead not found");

  if (userId) {
    const user = await db.user.findFirst({ where: { id: userId, workspaceId } });
    if (!user) throw new Error("User not found");
  }

  return db.lead.update({
    where: { id },
    data: { assignedTo: userId },
    include: { contact: true },
  });
}

export async function getLeadsByContact(
  contactId: string,
  workspaceId: string,
  db: PrismaClient
) {
  return db.lead.findMany({
    where: { contactId, workspaceId },
    orderBy: { createdAt: "desc" },
  });
}
