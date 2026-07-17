/**
 * UI contract runner — executes every surface contract in
 * docs/design/ui-contract/surfaces/*.contract.json against the live DOM.
 *
 * Agent-native QA: the surface DECLARES its invariants (anchors, computed
 * geometry, theme wiring, deep-link-forced state copy) as data; this one
 * generic spec verifies all of them per theme x viewport. Adding a surface
 * means adding a manifest, not writing a new spec. Vision QA (Gemini loop,
 * screenshot review) stays for taste; everything objective lives here,
 * deterministically.
 *
 * Pattern: manifest + audit (guidance over enforcement) — the same shape as
 * src/design/designSystem.ts, moved to runtime.
 * Prior art:
 *   - docs/design/UI_CONTRACT.md + manifest.schema.json (evidence layer)
 *   - agents.md / MCP progressive discovery — machine-readable affordances
 *   - Storybook play functions / ARIA AX-tree — declared, executable UI intent
 * Case studies encoded here: the 2026-07-16 70px mobile collapse (geometry)
 * and the 2026-07-17 mislabeled dark captures (theme.storageKey — the capture
 * spec and this runner read the SAME key the shell reads).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { installVercelPreviewBypass } from "./helpers/vercelPreview";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = join(SPEC_DIR, "..", "..", "docs", "design", "ui-contract", "surfaces");

interface SurfaceContract {
  schema: string;
  surface: string;
  route: string;
  theme: { storageKey: string; attribute: string; values: Array<"light" | "dark"> };
  viewports: Array<{ name: string; width: number; height: number }>;
  anchors?: Array<{
    why: string;
    testId?: string;
    selector?: string;
    role?: string;
    name?: string;
    presence?: "visible";
    count?: number;
  }>;
  geometry?: Array<{
    why: string;
    selector: string;
    viewport: string;
    gridTracks?: number;
    minWidthPx?: number;
  }>;
  states?: Array<{
    name: string;
    why: string;
    url: string;
    viewport?: string;
    expectText?: string;
    forbidText?: string;
    expectTestId?: string;
    forbidTestId?: string;
    expectUrlPattern?: string;
  }>;
}

function loadContracts(): SurfaceContract[] {
  return readdirSync(CONTRACTS_DIR)
    .filter((f) => f.endsWith(".contract.json"))
    .map((f) => JSON.parse(readFileSync(join(CONTRACTS_DIR, f), "utf8")) as SurfaceContract);
}

async function applyTheme(page: Page, contract: SurfaceContract, theme: "light" | "dark") {
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [contract.theme.storageKey, theme] as const,
  );
}

const contracts = loadContracts();

for (const contract of contracts) {
  test.describe(`ui-contract › ${contract.surface}`, () => {
    test.setTimeout(60_000);

    for (const theme of contract.theme.values) {
      for (const viewport of contract.viewports) {
        test(`${theme} · ${viewport.name}: anchors + geometry + theme attribute`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await installVercelPreviewBypass(page, BASE_URL);
          // First load establishes origin so localStorage is writable; the
          // reload lets the shell's initial-state reader pick the theme up.
          await page.goto(`${BASE_URL}${contract.route}`, { waitUntil: "domcontentloaded" });
          await applyTheme(page, contract, theme);
          await page.goto(`${BASE_URL}${contract.route}`, { waitUntil: "domcontentloaded" });

          // Theme wiring: the attribute the stylesheet keys on must reflect
          // the stored value — this is the invariant whose absence let every
          // pre-2026-07-17 "dark" capture ship as a light render.
          await expect(
            page.locator(`[${contract.theme.attribute}="${theme}"]`).first(),
          ).toBeAttached({ timeout: 30_000 });

          for (const anchor of contract.anchors ?? []) {
            const locator = anchor.testId
              ? page.getByTestId(anchor.testId)
              : anchor.role
                ? page.getByRole(anchor.role as Parameters<Page["getByRole"]>[0], { name: anchor.name })
                : page.locator(anchor.selector!);
            if (anchor.count !== undefined) {
              await expect(locator, anchor.why).toHaveCount(anchor.count, { timeout: 30_000 });
            }
            if (anchor.presence === "visible") {
              await expect(locator.first(), anchor.why).toBeVisible({ timeout: 30_000 });
            }
          }

          for (const rule of (contract.geometry ?? []).filter((g) => g.viewport === viewport.name)) {
            const measured = await page.evaluate((selector) => {
              const el = document.querySelector<HTMLElement>(selector);
              if (!el) return null;
              return {
                gridTemplateColumns: getComputedStyle(el).gridTemplateColumns,
                width: el.getBoundingClientRect().width,
              };
            }, rule.selector);
            expect(measured, `${rule.why} — ${rule.selector} must exist`).not.toBeNull();
            if (rule.gridTracks !== undefined) {
              const tracks = measured!.gridTemplateColumns.trim().split(/\s+/).length;
              expect(tracks, `${rule.why} — got "${measured!.gridTemplateColumns}"`).toBe(rule.gridTracks);
            }
            if (rule.minWidthPx !== undefined) {
              expect(measured!.width, rule.why).toBeGreaterThan(rule.minWidthPx);
            }
          }
        });
      }
    }

    for (const state of contract.states ?? []) {
      test(`state › ${state.name}: copy agrees with reality`, async ({ page }) => {
        const viewport = state.viewport
          ? contract.viewports.find((v) => v.name === state.viewport)
          : undefined;
        if (viewport) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
        }
        await installVercelPreviewBypass(page, BASE_URL);
        await page.goto(`${BASE_URL}${state.url}`, { waitUntil: "domcontentloaded" });
        if (state.expectUrlPattern) {
          await expect(page, state.why).toHaveURL(new RegExp(state.expectUrlPattern), {
            timeout: 30_000,
          });
        }
        if (state.expectText) {
          await expect(page.getByText(state.expectText).first(), state.why).toBeVisible({
            timeout: 30_000,
          });
        }
        if (state.expectTestId) {
          await expect(page.getByTestId(state.expectTestId).first(), state.why).toBeVisible({
            timeout: 30_000,
          });
        }
        if (state.forbidText) {
          await expect(page.getByText(state.forbidText), state.why).toHaveCount(0);
        }
        if (state.forbidTestId) {
          await expect(page.getByTestId(state.forbidTestId), state.why).toHaveCount(0);
        }
      });
    }
  });
}
