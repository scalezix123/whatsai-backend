import { PrismaClient, Prisma } from "@prisma/client";
import type {
  CreateSegmentInput,
  UpdateSegmentInput,
  SegmentFilter,
} from "./segments.schemas";
import { compileSegmentFilter } from "./segments.filter";

// ============================================================================
// Segment CRUD + audience resolution
// ============================================================================

export async function createSegment(
  workspaceId: string,
  input: CreateSegmentInput,
  db: PrismaClient
) {
  const existing = await db.segment.findFirst({
    where: { workspaceId, name: input.name },
    select: { id: true },
  });
  if (existing) throw new Error(`Segment "${input.name}" already exists`);

  return db.segment.create({
    data: {
      workspaceId,
      name: input.name,
      description: input.description ?? null,
      filters: input.filters as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function listSegments(workspaceId: string, db: PrismaClient) {
  const segments = await db.segment.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });

  // Attach a live contact count per segment (one indexed count each).
  const withCounts = await Promise.all(
    segments.map(async (s) => ({
      ...s,
      contactCount: await db.contact.count({
        where: compileSegmentFilter(workspaceId, s.filters as unknown as SegmentFilter),
      }),
    }))
  );
  return { total: withCounts.length, segments: withCounts };
}

export async function getSegment(workspaceId: string, id: string, db: PrismaClient) {
  const segment = await db.segment.findFirst({ where: { id, workspaceId } });
  if (!segment) throw new Error("Segment not found");
  return segment;
}

export async function updateSegment(
  workspaceId: string,
  id: string,
  input: UpdateSegmentInput,
  db: PrismaClient
) {
  await getSegment(workspaceId, id, db); // ownership check

  if (input.name) {
    const clash = await db.segment.findFirst({
      where: { workspaceId, name: input.name, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw new Error(`Segment "${input.name}" already exists`);
  }

  const data: Prisma.SegmentUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.filters !== undefined) data.filters = input.filters as unknown as Prisma.InputJsonValue;

  return db.segment.update({ where: { id }, data });
}

export async function deleteSegment(workspaceId: string, id: string, db: PrismaClient) {
  await getSegment(workspaceId, id, db);
  await db.segment.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Preview an audience: total matching contacts plus a small sample. Accepts an
 * ad-hoc filter (builder live preview) or resolves a saved segment by id.
 */
export async function previewSegment(
  workspaceId: string,
  opts: { id?: string; filters?: SegmentFilter; sampleSize: number },
  db: PrismaClient
) {
  let filters = opts.filters;
  if (!filters && opts.id) {
    const segment = await getSegment(workspaceId, opts.id, db);
    filters = segment.filters as unknown as SegmentFilter;
  }
  const where = compileSegmentFilter(workspaceId, filters);
  const [total, sample] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      take: opts.sampleSize,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, phone: true, optInStatus: true },
    }),
  ]);
  return { total, sample };
}

/**
 * Resolve a saved segment to the contact ids it currently matches. Used by the
 * campaign engine to build a recipient list from an audience. `eligibleOnly`
 * drops opted-out contacts so a broadcast never violates consent.
 */
export async function resolveSegmentContactIds(
  workspaceId: string,
  segmentId: string,
  db: PrismaClient,
  eligibleOnly = true
): Promise<string[]> {
  const segment = await getSegment(workspaceId, segmentId, db);
  const where = compileSegmentFilter(
    workspaceId,
    segment.filters as unknown as SegmentFilter
  );
  if (eligibleOnly) {
    where.optInStatus = { not: "opt_out" };
  }
  const contacts = await db.contact.findMany({ where, select: { id: true } });
  return contacts.map((c) => c.id);
}
