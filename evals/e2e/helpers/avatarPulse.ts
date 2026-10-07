import { expect, type Page } from "@playwright/test";

export interface AvatarPulseMetric {
  label: string;
  value: string;
  trend: string;
}

export async function readAvatarPulseMetrics(
  page: Page,
): Promise<AvatarPulseMetric[]> {
  return page.locator(".nb-avm-pulse").evaluateAll((tiles) =>
    tiles.map((tile) => ({
      label: tile.querySelector(".nb-avm-pulse-l")?.textContent?.trim() ?? "",
      value: tile.querySelector(".nb-avm-pulse-v")?.textContent?.trim() ?? "",
      trend: tile.querySelector(".nb-avm-pulse-t")?.textContent?.trim() ?? "",
    })),
  );
}

function expectPercent(value: string, label: string): void {
  expect(value, `${label} renders as an integer percentage`).toMatch(/^\d+%$/);
  const numericValue = Number.parseInt(value, 10);
  expect(numericValue, `${label} is at least 0%`).toBeGreaterThanOrEqual(0);
  expect(numericValue, `${label} does not exceed 100%`).toBeLessThanOrEqual(
    100,
  );
}

/**
 * Convex metrics replace the kit seed as soon as live aggregates are ready.
 * Assert the semantic shape of either honest state instead of pinning this
 * release gate to one deployment's numeric snapshot.
 */
export function expectAvatarPulseContract(metrics: AvatarPulseMetric[]): void {
  expect(
    metrics,
    "Today's pulse keeps exactly three named metrics",
  ).toHaveLength(3);
  expect(
    metrics.map(({ label }) => label),
    "pulse metric order and meaning",
  ).toEqual(["Memory hits", "Searches saved", "Sources fresh"]);
  expect(
    metrics.map(({ value }) => value).every(Boolean),
    "all pulse values are nonempty",
  ).toBe(true);
  expect(
    metrics.map(({ trend }) => trend).every(Boolean),
    "all pulse trends are nonempty",
  ).toBe(true);

  const memoryHits = metrics[0]!;
  const searchesSaved = metrics[1]!;
  const sourcesFresh = metrics[2]!;
  expectPercent(memoryHits.value, memoryHits.label);

  expect(searchesSaved.value, "search count is a non-negative integer").toMatch(
    /^\d+$/,
  );
  expect(
    Number.parseInt(searchesSaved.value, 10),
    "search count is non-negative",
  ).toBeGreaterThanOrEqual(0);

  expectPercent(sourcesFresh.value, sourcesFresh.label);
}
