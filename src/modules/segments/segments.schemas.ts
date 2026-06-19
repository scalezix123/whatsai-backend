import { z } from "zod";

// ============================================================================
// Segment filter rule language
// ----------------------------------------------------------------------------
// A segment is a set of conditions over Contact fields. The filter engine
// (segments.filter.ts) compiles this into a Prisma Contact where-clause, so a
// segment always reflects live contact data rather than a frozen member list.
// ============================================================================

const tagCondition = z.object({
  field: z.literal("tag"),
  op: z.enum(["hasAny", "hasAll", "hasNone"]),
  value: z.array(z.string().min(1)).min(1),
});

const optInCondition = z.object({
  field: z.literal("optInStatus"),
  op: z.enum(["eq", "in"]),
  value: z.union([z.string(), z.array(z.string().min(1)).min(1)]),
});

const textCondition = z.object({
  field: z.enum(["name", "email", "phone"]),
  op: z.enum(["contains", "eq"]),
  value: z.string().min(1),
});

const dateCondition = z.object({
  field: z.enum(["createdAt", "lastMessageAt"]),
  op: z.enum(["before", "after", "between", "exists", "missing"]),
  // ISO date for before/after; [from, to] for between; omitted for exists/missing.
  value: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(),
});

const attributeCondition = z.object({
  field: z.literal("attribute"),
  key: z.string().min(1), // attribute definition name
  op: z.enum(["eq", "contains", "exists", "missing"]),
  value: z.string().optional(),
});

export const conditionSchema = z.discriminatedUnion("field", [
  tagCondition,
  optInCondition,
  textCondition,
  dateCondition,
  attributeCondition,
]);

export const segmentFilterSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(conditionSchema).default([]),
});

export const createSegmentSchema = z.object({
  name: z.string().min(1, "Segment name required"),
  description: z.string().optional(),
  filters: segmentFilterSchema,
});

export const updateSegmentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  filters: segmentFilterSchema.optional(),
});

export const previewSegmentSchema = z.object({
  // Preview an unsaved filter, or pass nothing to preview a saved segment by id.
  filters: segmentFilterSchema.optional(),
  sampleSize: z.coerce.number().int().min(0).max(50).default(10),
});

export type SegmentCondition = z.infer<typeof conditionSchema>;
export type SegmentFilter = z.infer<typeof segmentFilterSchema>;
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;
export type PreviewSegmentInput = z.infer<typeof previewSegmentSchema>;
