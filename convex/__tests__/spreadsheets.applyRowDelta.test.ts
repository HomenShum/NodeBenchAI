/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const convexModules = import.meta.glob("../**/*.{ts,js}");

let convexTest: any;
let convexTestAvailable = false;
try {
  const mod = await import(/* @vite-ignore */ "convex-test");
  convexTest = mod.convexTest;
  convexTestAvailable = typeof convexTest === "function";
} catch {
  convexTestAvailable = false;
}

describe.skipIf(!convexTestAvailable)("spreadsheets.applyRowDelta", () => {
  it("applies an ordered row delta, stores explicit blanks, and writes an audit event", async () => {
    const t = convexTest(schema, convexModules);
    const userId = await t.run(async (ctx: any) =>
      ctx.db.insert("users", {
        name: "Spreadsheet Smoke User",
      }),
    );
    const authed = t.withIdentity({ subject: userId });

    const sheetId = await authed.mutation(api.domains.integrations.spreadsheets.createSheet, {
      name: "row-delta-smoke",
    });
    const sheet = await authed.query(api.domains.integrations.spreadsheets.getSheet, { sheetId });

    const result = await authed.mutation(api.domains.integrations.spreadsheets.applyRowDelta, {
      sheetId,
      row: 0,
      expectedUpdatedAt: sheet.updatedAt,
      source: "vitest-row-delta",
      threadId: "thread-row-delta",
      runId: "run-row-delta",
      operations: [
        { op: "insert", index: 0, value: "Revenue" },
        { op: "insert", index: 1, value: 42 },
        { op: "insert", index: 1, value: null },
        { op: "set", index: 2, value: 43 },
      ],
    });

    expect(result.before).toEqual([]);
    expect(result.after).toEqual(["Revenue", null, 43]);
    expect(result.applied).toBe(4);
    expect(result.errors).toBe(0);

    const cells = await authed.query(api.domains.integrations.spreadsheets.getRange, {
      sheetId,
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 2,
    });
    expect(cells.map((cell: any) => ({ col: cell.col, value: cell.value, type: cell.type }))).toEqual([
      { col: 0, value: "Revenue", type: "text" },
      { col: 1, value: "", type: "blank" },
      { col: 2, value: "43", type: "number" },
    ]);

    const events = await t.run(async (ctx: any) =>
      ctx.db
        .query("spreadsheetEvents")
        .withIndex("by_spreadsheet", (q: any) => q.eq("spreadsheetId", sheetId))
        .collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0].operation).toBe("row_delta");
    expect(events[0].payload.after).toEqual(["Revenue", null, 43]);
  });
});
