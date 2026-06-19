import { compileSegmentFilter } from "../modules/segments/segments.filter";
import type { SegmentFilter } from "../modules/segments/segments.schemas";

const WS = "ws_1";

describe("compileSegmentFilter", () => {
  it("matches everyone in the workspace when there are no conditions", () => {
    expect(compileSegmentFilter(WS, { match: "all", conditions: [] })).toEqual({
      workspaceId: WS,
    });
    expect(compileSegmentFilter(WS, undefined)).toEqual({ workspaceId: WS });
  });

  it("ANDs conditions when match is 'all'", () => {
    const filter: SegmentFilter = {
      match: "all",
      conditions: [
        { field: "optInStatus", op: "eq", value: "opt_in" },
        { field: "tag", op: "hasAny", value: ["vip"] },
      ],
    };
    const where = compileSegmentFilter(WS, filter);
    expect(where.workspaceId).toBe(WS);
    expect(where.AND).toEqual([
      { optInStatus: "opt_in" },
      { tags: { some: { tag: { in: ["vip"] } } } },
    ]);
    expect(where.OR).toBeUndefined();
  });

  it("ORs conditions when match is 'any'", () => {
    const where = compileSegmentFilter(WS, {
      match: "any",
      conditions: [
        { field: "name", op: "contains", value: "jo" },
        { field: "email", op: "contains", value: "gmail" },
      ],
    });
    expect(where.OR).toEqual([
      { name: { contains: "jo", mode: "insensitive" } },
      { email: { contains: "gmail", mode: "insensitive" } },
    ]);
  });

  it("compiles tag hasAll into one some-clause per tag", () => {
    const where = compileSegmentFilter(WS, {
      match: "all",
      conditions: [{ field: "tag", op: "hasAll", value: ["a", "b"] }],
    });
    expect(where.AND).toEqual([
      { AND: [{ tags: { some: { tag: "a" } } }, { tags: { some: { tag: "b" } } }] },
    ]);
  });

  it("compiles tag hasNone into a none-clause", () => {
    const where = compileSegmentFilter(WS, {
      match: "all",
      conditions: [{ field: "tag", op: "hasNone", value: ["spam"] }],
    });
    expect(where.AND).toEqual([{ tags: { none: { tag: { in: ["spam"] } } } }]);
  });

  it("compiles date before/after/between", () => {
    const before = compileSegmentFilter(WS, {
      match: "all",
      conditions: [{ field: "createdAt", op: "before", value: "2026-01-01" }],
    });
    expect((before.AND as any[])[0].createdAt.lt).toEqual(new Date("2026-01-01"));

    const between = compileSegmentFilter(WS, {
      match: "all",
      conditions: [{ field: "lastMessageAt", op: "between", value: ["2026-01-01", "2026-02-01"] }],
    });
    const clause = (between.AND as any[])[0].lastMessageAt;
    expect(clause.gte).toEqual(new Date("2026-01-01"));
    expect(clause.lte).toEqual(new Date("2026-02-01"));
  });

  it("compiles attribute eq/exists/missing", () => {
    const eq = compileSegmentFilter(WS, {
      match: "all",
      conditions: [{ field: "attribute", key: "city", op: "eq", value: "Mumbai" }],
    });
    expect((eq.AND as any[])[0]).toEqual({
      attributes: { some: { attribute: { name: "city" }, value: "Mumbai" } },
    });

    const exists = compileSegmentFilter(WS, {
      match: "all",
      conditions: [{ field: "attribute", key: "city", op: "exists" }],
    });
    expect((exists.AND as any[])[0]).toEqual({
      attributes: { some: { attribute: { name: "city" } } },
    });

    const missing = compileSegmentFilter(WS, {
      match: "all",
      conditions: [{ field: "attribute", key: "city", op: "missing" }],
    });
    expect((missing.AND as any[])[0]).toEqual({
      attributes: { none: { attribute: { name: "city" } } },
    });
  });
});
