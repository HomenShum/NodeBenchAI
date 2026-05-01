/**
 * Regression spec for the Home Memory Pulse.
 *
 * The Home page should not look empty for an anonymous first-time visitor.
 * Public/system intelligence corpus counts can render, while private notes
 * remain excluded from those counters.
 *
 * Defaults to production www.nodebenchai.com. Override with BASE_URL.
 */

import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

test("Home Memory Pulse shows public corpus for anonymous users without leaking private notes", async ({ page }) => {
  await page.goto(`${BASE_URL}/?surface=home`, { waitUntil: "networkidle", timeout: 30_000 });

  const pulse = page.getByTestId("exact-home-pulse-strip");
  await expect(pulse).toBeVisible();
  await expect(pulse).toContainText("Memory pulse");
  await expect(pulse).toContainText("private notes excluded");

  const text = await pulse.innerText();

  expect(text).toContain("entities tracked");
  expect(text).toContain("relationships mapped");
  expect(text).toContain("reports created");
  expect(text).not.toMatch(/\b0\s+entities tracked\b/i);
  expect(text).not.toMatch(/\b0\s+relationships mapped\b/i);
  expect(text).not.toMatch(/\b0\s+reports created\b/i);
});
