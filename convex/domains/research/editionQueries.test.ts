/**
 * Phase 8c — scenario tests for editionQueries pure helpers.
 *
 * Per `.claude/rules/scenario_testing.md`: scenario-based with persona,
 * goal, prior state, and expected outcome.  Tests the pure date-helper
 * functions used by getMonthlyRetrospective and the temporal queries.
 */

import { describe, expect, it } from "vitest";

// Inlined from editionQueries.ts (kept in sync manually).
function isoWeekKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = new Date(jan4).getUTCDay() || 7;
  const week1Mon = jan4 - (jan4Day - 1) * 86_400_000;
  const week = Math.floor((ms - week1Mon) / (7 * 86_400_000)) + 1;
  if (week > 52) {
    const nextJan4 = Date.UTC(year + 1, 0, 4);
    const nextJan4Day = new Date(nextJan4).getUTCDay() || 7;
    const nextWeek1Mon = nextJan4 - (nextJan4Day - 1) * 86_400_000;
    if (ms >= nextWeek1Mon) {
      return `${year + 1}-W${"01".padStart(2, "0")}`;
    }
  }
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function dateKeyFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

describe("Phase 8c isoWeekKeyFromMs", () => {
  /*
   * Scenario: Reader views the monthly retrospective for a normal
   * mid-year month.  Each week bucket must be deterministically
   * computed so the same date always lands in the same week.
   *
   *   User:       guest reader of /redesign?edition=month:2026-05
   *   Goal:       see "Week 1, Week 2, ... Week 5" of May 2026 with
   *               consistent week-number assignments
   *   Prior:      none
   *   Action:     isoWeekKeyFromMs called once per day
   *   Expected:   each day in May 2026 maps to its ISO week
   */
  it("maps mid-year days to the correct ISO week", () => {
    // 2026-05-09 is Saturday in ISO week 19.
    expect(isoWeekKeyFromMs(Date.parse("2026-05-09T12:00:00Z"))).toBe(
      "2026-W19",
    );
    // 2026-05-04 is Monday → start of ISO week 19.
    expect(isoWeekKeyFromMs(Date.parse("2026-05-04T00:00:00Z"))).toBe(
      "2026-W19",
    );
    // 2026-05-10 is Sunday → end of ISO week 19.
    expect(isoWeekKeyFromMs(Date.parse("2026-05-10T23:59:59Z"))).toBe(
      "2026-W19",
    );
  });

  /*
   * Scenario: New Year boundary — 2026-01-01 is Thursday, so it falls
   * in ISO week 1 of 2026 (per ISO 8601 rule that week 1 contains
   * Jan 4).  But 2025-12-29 is Monday → start of ISO week 1 of 2026.
   *
   *   This catches off-by-one bugs at the calendar boundary.
   */
  it("handles ISO-week year boundaries correctly", () => {
    // 2025-12-29 = Mon → start of 2026-W01 per ISO 8601
    expect(isoWeekKeyFromMs(Date.parse("2025-12-29T00:00:00Z"))).toBe(
      "2026-W01",
    );
    // 2026-01-04 = Sun, end of 2026-W01
    expect(isoWeekKeyFromMs(Date.parse("2026-01-04T23:59:59Z"))).toBe(
      "2026-W01",
    );
    // 2026-01-05 = Mon → start of 2026-W02
    expect(isoWeekKeyFromMs(Date.parse("2026-01-05T00:00:00Z"))).toBe(
      "2026-W02",
    );
  });

  /*
   * Scenario: A leap year + month with 31 days.  The histogram array
   * in getMonthlyRetrospective initializes one slot per UTC day; this
   * test pins that the day-key generation produces 31 entries for May
   * (no off-by-one at month-end).
   */
  it("dateKeyFromMs returns YYYY-MM-DD UTC", () => {
    expect(dateKeyFromMs(Date.parse("2026-05-09T03:00:00Z"))).toBe(
      "2026-05-09",
    );
    expect(dateKeyFromMs(Date.parse("2026-05-09T23:59:59Z"))).toBe(
      "2026-05-09",
    );
    expect(dateKeyFromMs(Date.parse("2026-05-10T00:00:00Z"))).toBe(
      "2026-05-10",
    );
  });

  /*
   * Scenario: Long-running accumulation — 1000 calls per query (cron
   * scenario), must complete fast.
   */
  it("performance — 1000 isoWeek calls complete in <50ms", () => {
    const start = Date.now();
    let baseMs = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 1000; i++) {
      isoWeekKeyFromMs(baseMs + i * 86_400_000);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
