import { test, expect, Page } from "@playwright/test";

/**
 * Level 3: Deep Research Tests
 *
 * Updated for new Home Hub UI with Fast Agent Panel.
 * These tests verify navigation and advanced UI features without requiring actual LLM responses.
 *
 * Complexity: Complex
 * Goal: Verify Research Hub, Workspace, and advanced panel features
 */

const BASE_URL = "http://localhost:5173";

test.describe("L3 - Deep Research", () => {
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

  test("Research Hub button is clickable", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Find Research Hub button using getByRole
    const researchHubButton = page.getByRole('button', { name: /Research Hub/i }).first();
    await expect(researchHubButton).toBeVisible({ timeout: 10000 });

    // Click it
    await researchHubButton.click();
    await page.waitForTimeout(1000);

    // Page should navigate or show research UI
    const hasResearchContent = await page.locator('text=/research|dossier|brief/i').isVisible({ timeout: 5000 }).catch(() => false);
    const urlChanged = page.url() !== BASE_URL;

    expect(hasResearchContent || urlChanged).toBeTruthy();
    console.log('✅ L3 Research Hub navigation works');
  });

  test("Workspace button navigates to workspace", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Find My Workspace button using getByRole
    const workspaceButton = page.getByRole('button', { name: /My Workspace/i });
    await expect(workspaceButton).toBeVisible({ timeout: 10000 });

    // Click it
    await workspaceButton.click();
    await page.waitForTimeout(1000);

    // Should show workspace content or navigate
    const hasWorkspaceContent = await page.locator('text=/document|workspace|file/i').isVisible({ timeout: 5000 }).catch(() => false);
    const urlChanged = page.url() !== BASE_URL;

    expect(hasWorkspaceContent || urlChanged).toBeTruthy();
    console.log('✅ L3 Workspace navigation works');
  });

  test("New Document button works", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Find New Document button using getByRole
    const newDocButton = page.getByRole('button', { name: /New Document/i });
    await expect(newDocButton).toBeVisible({ timeout: 10000 });

    // Click it
    await newDocButton.click();
    await page.waitForTimeout(1000);

    // Should show document creation or navigate to workspace
    const hasDocContent = await page.locator('text=/document|editor|untitled/i').isVisible({ timeout: 5000 }).catch(() => false);
    const urlChanged = page.url() !== BASE_URL;

    expect(hasDocContent || urlChanged).toBeTruthy();
    console.log('✅ L3 New Document button works');
  });

  test("Fast Agent Panel shows file attachment option", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Open Fast Agent Panel
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Verify file attachment button exists
    const attachButton = page.getByRole('button', { name: /Attach file/i });
    await expect(attachButton).toBeVisible({ timeout: 5000 });

    console.log('✅ L3 File attachment option verified');
  });

  test("Fast Agent Panel shows skills and settings buttons", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Open Fast Agent Panel
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Verify skills button exists
    const skillsButton = page.getByRole('button', { name: /Skills/i });
    await expect(skillsButton).toBeVisible({ timeout: 5000 });

    // Verify Live mode button exists (use exact match to avoid matching "Live Dossiers")
    const liveButton = page.getByRole('button', { name: 'Live', exact: true });
    await expect(liveButton).toBeVisible({ timeout: 5000 });

    console.log('✅ L3 Skills and Live buttons verified');
  });
});
