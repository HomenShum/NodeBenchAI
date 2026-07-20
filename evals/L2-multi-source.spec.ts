import { test, expect, Page } from "@playwright/test";

/**
 * Level 2: Multi-Source Verification Tests
 *
 * Updated for new Home Hub UI with Fast Agent Panel.
 * These tests verify navigation and UI features without requiring actual LLM responses.
 *
 * Complexity: Medium
 * Goal: Verify multi-panel navigation and workspace features
 */

const BASE_URL = "http://localhost:5173";

test.describe("L2 - Multi-Source Verification", () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    // Extra wait for any lazy-loaded components
    await page.waitForTimeout(1000);
  });

  test.afterEach(async () => {
    await page.close();
  });

  test("Home page shows navigation menu", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Verify navigation elements exist using getByRole
    const homeButton = page.getByRole('button', { name: /Home.*Research.*Live Dossiers/i });
    const workspaceButton = page.getByRole('button', { name: /My Workspace/i });
    const dossiersButton = page.getByRole('button', { name: /Saved Dossiers/i });

    await expect(homeButton).toBeVisible({ timeout: 10000 });
    await expect(workspaceButton).toBeVisible({ timeout: 5000 });
    await expect(dossiersButton).toBeVisible({ timeout: 5000 });

    console.log('✅ L2 Navigation menu verified');
  });

  test("Fast Agent Panel shows model selector", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Open Fast Agent Panel
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Verify model selector exists (Claude Haiku is the default)
    const modelSelector = page.getByRole('button', { name: /Claude Haiku/i });
    await expect(modelSelector).toBeVisible({ timeout: 5000 });

    console.log('✅ L2 Model selector verified');
  });

  test("Fast Agent Panel shows tabs", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Open Fast Agent Panel
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Verify tabs exist using getByRole
    const threadTab = page.getByRole('button', { name: /^Thread$/i });
    const artifactsTab = page.getByRole('button', { name: /^Artifacts$/i });
    const tasksTab = page.getByRole('button', { name: /^Tasks$/i });
    const briefTab = page.getByRole('button', { name: /^Brief$/i });
    const editsTab = page.getByRole('button', { name: /^Edits$/i });

    await expect(threadTab).toBeVisible({ timeout: 5000 });
    await expect(artifactsTab).toBeVisible({ timeout: 5000 });
    await expect(tasksTab).toBeVisible({ timeout: 5000 });
    await expect(briefTab).toBeVisible({ timeout: 5000 });
    await expect(editsTab).toBeVisible({ timeout: 5000 });

    console.log('✅ L2 Panel tabs verified');
  });

  test("Fast Agent Panel can be closed", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Open Fast Agent Panel
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Verify panel is open - look for close button
    const closeButton = page.getByRole('button', { name: /Close panel/i });
    await expect(closeButton).toBeVisible({ timeout: 5000 });

    // Close panel
    await closeButton.click();
    await page.waitForTimeout(500);

    // Verify panel is closed (close button should not be visible)
    await expect(closeButton).not.toBeVisible({ timeout: 3000 });

    console.log('✅ L2 Panel close functionality verified');
  });
});
