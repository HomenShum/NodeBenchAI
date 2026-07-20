import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const PRODUCT_ANON_SESSION_KEY = "nodebench:product-anon-session";
export const NOTEBOOK_ENTITY_SLUG = "softbank";
export const NOTEBOOK_ENTITY_NAME = "SoftBank";
export const NOTEBOOK_IDENTITY_REDESIGN_DISABLE_KEY =
  "nodebench.notebookIdentityRedesignDisabled";

export async function resetProductState(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  });
}

export function loadConvexUrl() {
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL;
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  const envFile = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
  const match = envFile.match(/VITE_CONVEX_URL="?([^"\n]+)"?/);
  if (match?.[1]) return match[1];
  throw new Error("VITE_CONVEX_URL is not configured for notebook E2E.");
}

export function makeConvexClient() {
  return new ConvexHttpClient(loadConvexUrl());
}

export async function seedNotebookEntity(anonymousSessionId: string, blockValues: string[]) {
  const client = makeConvexClient();
  await client.mutation("domains/product/entities:ensureEntity", {
    anonymousSessionId,
    slug: NOTEBOOK_ENTITY_SLUG,
    name: NOTEBOOK_ENTITY_NAME,
  });

  for (const [index, value] of blockValues.entries()) {
    await client.mutation("domains/product/blocks:appendBlock", {
      anonymousSessionId,
      entitySlug: NOTEBOOK_ENTITY_SLUG,
      kind: index === 0 ? "heading_2" : "text",
      content: [{ type: "text", value }],
      authorKind: "user",
      authorId: anonymousSessionId,
    });
  }
}

export async function seedEntityNoteDocument(anonymousSessionId: string, markdown: string) {
  const client = makeConvexClient();
  const workspace = await client.query("domains/product/entities:getEntityWorkspace", {
    anonymousSessionId,
    entitySlug: NOTEBOOK_ENTITY_SLUG,
  });
  if (!workspace?.entity?._id) {
    throw new Error(`Entity ${NOTEBOOK_ENTITY_SLUG} is not available for note seeding.`);
  }

  await client.mutation("domains/product/documents:saveEntityNoteDocument", {
    anonymousSessionId,
    entityId: workspace.entity._id,
    title: `${NOTEBOOK_ENTITY_NAME} notebook`,
    markdown,
    plainText: markdown.replace(/[#*\[\]]/g, "").trim(),
    blocks: [],
  });
}

export async function createEntityWorkspaceShare(
  anonymousSessionId: string,
  access: "view" | "edit",
) {
  const client = makeConvexClient();
  const result = await client.mutation("domains/product/shares:ensureEntityWorkspaceShare", {
    anonymousSessionId,
    entitySlug: NOTEBOOK_ENTITY_SLUG,
    access,
  });
  return result?.token as string;
}

export async function revokeEntityWorkspaceShare(
  anonymousSessionId: string,
  access: "view" | "edit",
) {
  const client = makeConvexClient();
  await client.mutation("domains/product/shares:revokeEntityWorkspaceShare", {
    anonymousSessionId,
    entitySlug: NOTEBOOK_ENTITY_SLUG,
    access,
  });
}

export async function primeSharedProductSession(
  context: BrowserContext,
  sharedSessionId: string,
  options?: { entitySlug?: string; entityViewMode?: "classic" | "notebook" | "live" },
) {
  await context.addInitScript(
    ([storageKey, sessionId, entitySlug, entityViewMode]) => {
      window.localStorage.setItem(storageKey, sessionId);
      window.sessionStorage.setItem(storageKey, sessionId);
      if (entitySlug && entityViewMode) {
        window.localStorage.setItem(`nodebench.entityViewMode:${entitySlug}`, entityViewMode);
      }
    },
    [
      PRODUCT_ANON_SESSION_KEY,
      sharedSessionId,
      options?.entitySlug ?? null,
      options?.entityViewMode ?? null,
    ],
  );
}

export async function pageWait(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

async function gotoProductPath(page: Page, path: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 0 && message.includes("ERR_ABORTED")) {
        await page.waitForTimeout(750);
        continue;
      }
      throw error;
    }
  }
}

export async function exhaustNotebookPagination(page: Page, reportRegion: Locator) {
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const loadMore = reportRegion.getByRole("button", { name: /Load \d+ more/i }).first();
    if (!(await loadMore.isVisible().catch(() => false))) {
      return;
    }
    await loadMore.click();
    await pageWait(page, 800);
  }
}

async function waitForReportRegionReady(reportRegion: Locator) {
  const loadingStatus = reportRegion.getByRole("status").filter({ hasText: /loading/i }).first();
  await expect
    .poll(async () => await loadingStatus.isVisible().catch(() => false), {
      timeout: 30_000,
      message: "expected the report region to finish loading",
    })
    .toBe(false);
}

export async function openEntityClassicPage(
  page: Page,
  entitySlug = NOTEBOOK_ENTITY_SLUG,
  entityName = NOTEBOOK_ENTITY_NAME,
  shareToken?: string,
  options?: {
    forceClassicFallback?: boolean;
  },
) {
  if (options?.forceClassicFallback) {
    await page.addInitScript(
      ([storageKey, slug]) => {
        window.localStorage.setItem(storageKey, "1");
        window.localStorage.setItem(`nodebench.entityViewMode:${slug}`, "classic");
      },
      [NOTEBOOK_IDENTITY_REDESIGN_DISABLE_KEY, entitySlug],
    );
  }
  const entityPath = shareToken
    ? `/entity/${entitySlug}?share=${encodeURIComponent(shareToken)}`
    : `/entity/${entitySlug}`;
  await gotoProductPath(page, entityPath);

  await expect(page).toHaveURL(new RegExp(`/entity/${entitySlug}`), { timeout: 30_000 });
  if (shareToken) {
    await expect(page).toHaveURL(new RegExp(`share=${encodeURIComponent(shareToken)}`), {
      timeout: 30_000,
    });
  }
  await expect(page.locator("h1").filter({ hasText: new RegExp(entityName, "i") })).toBeVisible({
    timeout: 30_000,
  });

  const reportRegion = page.getByRole("region", { name: "Reports" });
  await expect(reportRegion).toBeVisible({ timeout: 30_000 });
  await waitForReportRegionReady(reportRegion);

  const classicButton = reportRegion.getByRole("button", { name: /^Classic$/ });
  if (await classicButton.isVisible().catch(() => false)) {
    await classicButton.click();
  }

  const notesSection = page.getByTestId("entity-working-notes");
  const workspaceRail = page.getByTestId("entity-workspace-rail");
  const noteEditorShell = page.getByTestId("entity-note-editor-shell");
  await expect(notesSection).toBeVisible({ timeout: 30_000 });
  await expect(workspaceRail).toBeVisible({ timeout: 30_000 });
  await expect(noteEditorShell).toBeVisible({ timeout: 30_000 });

  return { reportRegion, notesSection, workspaceRail, noteEditorShell };
}

export async function openEntityLiveNotebook(
  page: Page,
  entitySlug = NOTEBOOK_ENTITY_SLUG,
  minimumBlockCount = 4,
  entityName = NOTEBOOK_ENTITY_NAME,
  shareToken?: string,
) {
  const entityPath = shareToken
    ? `/entity/${entitySlug}?share=${encodeURIComponent(shareToken)}`
    : `/entity/${entitySlug}`;
  await gotoProductPath(page, entityPath);

  await expect(page).toHaveURL(new RegExp(`/entity/${entitySlug}`), { timeout: 30_000 });
  if (shareToken) {
    await expect(page).toHaveURL(new RegExp(`share=${encodeURIComponent(shareToken)}`), {
      timeout: 30_000,
    });
  }
  await expect(page.locator("h1").filter({ hasText: new RegExp(entityName, "i") })).toBeVisible({
    timeout: 30_000,
  });

  const reportRegion = page.getByRole("region", { name: "Reports" });
  await expect(reportRegion).toBeVisible({ timeout: 30_000 });
  await waitForReportRegionReady(reportRegion);

  const liveButton = reportRegion.getByRole("button", { name: /Live/ });
  const notebook = reportRegion.getByTestId("entity-live-notebook");
  await expect
    .poll(
      async () =>
        (await notebook.isVisible().catch(() => false)) ||
        (await liveButton.isVisible().catch(() => false)),
      {
        timeout: 30_000,
        message: "expected the live notebook surface or toggle to appear",
      },
    )
    .toBe(true);
  if (!(await notebook.isVisible().catch(() => false)) && (await liveButton.isVisible().catch(() => false))) {
    await expect(liveButton).toBeEnabled({ timeout: 30_000 });
    await liveButton.click();
  }
  await expect(notebook).toBeVisible({ timeout: 30_000 });
  await exhaustNotebookPagination(page, reportRegion);
  const blocks = reportRegion.getByTestId("notebook-block");
  await expect
    .poll(async () => await blocks.count(), {
      timeout: 20_000,
      message: "expected live notebook blocks to render",
    })
    .toBeGreaterThan(minimumBlockCount - 1);

  return { reportRegion, notebook, blocks };
}

export async function focusNotebookBlock(page: Page, reportRegion: Locator, index: number) {
  const block = reportRegion.getByTestId("notebook-block").nth(index);
  await block.scrollIntoViewIfNeeded();
  await block.locator('[role="textbox"]').first().click();
  await expect(block).toHaveAttribute("data-block-focused", "true", { timeout: 10_000 });
  const editorSurface = block
    .locator('.ProseMirror[contenteditable="true"], [contenteditable="true"]')
    .first();
  await expect(editorSurface).toBeVisible({ timeout: 10_000 });
  await editorSurface.click();
  return { block, editorSurface };
}

export async function appendToNotebookBlock(
  page: Page,
  reportRegion: Locator,
  index: number,
  marker: string,
) {
  const { editorSurface } = await focusNotebookBlock(page, reportRegion, index);
  await pageWait(page, 150);
  await editorSurface.pressSequentially(marker, { delay: 10 });
  await pageWait(page, 150);
}
