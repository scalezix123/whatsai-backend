import type { Prisma } from "@prisma/client";
import type { SegmentCondition, SegmentFilter } from "./segments.schemas";

// ============================================================================
// Filter engine: SegmentFilter -> Prisma.ContactWhereInput
// ----------------------------------------------------------------------------
// Pure, DB-free, and unit-tested. The workspace scope is added by the caller;
// this only translates the rule object. An empty condition list matches every
// contact in the workspace (a useful "everyone" segment).
// ============================================================================

function compileCondition(c: SegmentCondition): Prisma.ContactWhereInput {
  switch (c.field) {
    case "tag": {
      if (c.op === "hasAny") return { tags: { some: { tag: { in: c.value } } } };
      if (c.op === "hasNone") return { tags: { none: { tag: { in: c.value } } } };
      // hasAll: contact must carry every listed tag.
      return { AND: c.value.map((tag) => ({ tags: { some: { tag } } })) };
    }

    case "optInStatus": {
      if (c.op === "in") {
        const list = Array.isArray(c.value) ? c.value : [c.value];
        return { optInStatus: { in: list } };
      }
      const single = Array.isArray(c.value) ? c.value[0] : c.value;
      return { optInStatus: single };
    }

    case "name":
    case "email":
    case "phone": {
      const value = c.value as string;
      if (c.op === "eq") return { [c.field]: value } as Prisma.ContactWhereInput;
      // contains: phone is case-sensitive (digits); name/email case-insensitive.
      return c.field === "phone"
        ? { phone: { contains: value } }
        : ({ [c.field]: { contains: value, mode: "insensitive" } } as Prisma.ContactWhereInput);
    }

    case "createdAt":
    case "lastMessageAt": {
      if (c.op === "exists") return { [c.field]: { not: null } } as Prisma.ContactWhereInput;
      if (c.op === "missing") return { [c.field]: null } as Prisma.ContactWhereInput;
      if (c.op === "between") {
        const [from, to] = c.value as [string, string];
        return { [c.field]: { gte: new Date(from), lte: new Date(to) } } as Prisma.ContactWhereInput;
      }
      const date = new Date(c.value as string);
      const cmp = c.op === "before" ? { lt: date } : { gt: date };
      return { [c.field]: cmp } as Prisma.ContactWhereInput;
    }

    case "attribute": {
      const base = { attribute: { name: c.key } };
      if (c.op === "missing") return { attributes: { none: base } };
      if (c.op === "exists") return { attributes: { some: base } };
      if (c.op === "contains") {
        return { attributes: { some: { ...base, value: { contains: c.value ?? "", mode: "insensitive" } } } };
      }
      // eq
      return { attributes: { some: { ...base, value: c.value ?? "" } } };
    }
  }
}

/**
 * Compile a saved or ad-hoc segment filter into a Prisma where-clause scoped to
 * the workspace. `match: "all"` ANDs the conditions; `"any"` ORs them.
 */
export function compileSegmentFilter(
  workspaceId: string,
  filter: SegmentFilter | null | undefined
): Prisma.ContactWhereInput {
  const conditions = filter?.conditions ?? [];
  if (conditions.length === 0) return { workspaceId };

  const compiled = conditions.map(compileCondition);
  const combinator: Prisma.ContactWhereInput =
    (filter?.match ?? "all") === "any" ? { OR: compiled } : { AND: compiled };

  return { workspaceId, ...combinator };
}
