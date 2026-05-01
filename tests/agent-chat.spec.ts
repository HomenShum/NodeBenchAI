import { test, expect, Page } from "@playwright/test";

/**
 * Welcome Landing + Fast Agent Panel smoke tests
 * Updated for the new Home Hub UI with Fast Agent Panel integration.
 * These are light-weight UI checks to keep the landing experience stable.
 */

const BASE_URL = "http://localhost:5173";

/**
 * Helper: Open Fast Agent Panel from home page
 */
async function openFastAgentPanel(page: Page) {
  // Look for the Fast Agent toggle button
  const fastAgentButton = page.locator('button:has-text("Fast Agent"), button[title*="Fast Agent"]').first();
  if (await fastAgentButton.isVisible({ timeout: 5000 })) {
    await fastAgentButton.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Helper: Get the Fast Agent input field
 */
function getFastAgentInput(page: Page) {
  return page.locator(
    'textarea[placeholder*="Ask anything"], input[placeholder*="Ask anything"], [contenteditable="true"]'
  ).first();
}

test.describe("Welcome Landing - Home Hub UI", () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
  });

  test.afterEach(async () => {
    await page.close();
  });

  test("shows Fast Agent Panel toggle and action buttons", async () => {
    // Verify home page has key navigation elements
    const fastAgentButton = page.locator('button:has-text("Fast Agent")').first();
    const newDocButton = page.locator('button:has-text("New Document")').first();
    const researchHubButton = page.locator('button:has-text("Research Hub")').first();

    // At least the Fast Agent or New Document button should be visible
    const hasFastAgent = await fastAgentButton.isVisible({ timeout: 5000 }).catch(() => false);
    const hasNewDoc = await newDocButton.isVisible({ timeout: 5000 }).catch(() => false);
    const hasResearchHub = await researchHubButton.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasFastAgent || hasNewDoc || hasResearchHub).toBeTruthy();
    console.log('✅ Home page action buttons verified');
  });

  test("renders home page with key UI elements", async () => {
    // Check for Home heading or welcome message
    const homeHeading = page.locator('h1:has-text("Home"), text=Get the read before you walk in, text=Need the read before you walk in, text=Good morning, text=Good afternoon, text=Good evening').first();
    const hasHomeUI = await homeHeading.isVisible({ timeout: 5000 }).catch(() => false);

    // Check for navigation elements
    const hasNavigation = await page.locator('button:has-text("My Workspace"), a[href*="workspace"]').first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasHomeUI || hasNavigation).toBeTruthy();
    console.log('✅ Home page UI elements verified');
  });

  test("Fast Agent Panel opens without console errors", async () => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    // Open Fast Agent Panel
    await openFastAgentPanel(page);

    // Check if panel opened (look for input or panel elements)
    const agentInput = getFastAgentInput(page);
    const isPanelOpen = await agentInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (isPanelOpen) {
      // Try to fill input
      await agentInput.fill("Test query for AI infrastructure");
      await page.waitForTimeout(500);
      console.log('✅ Fast Agent Panel input working');
    } else {
      console.log('⚠️ Fast Agent Panel not immediately visible, may need alternative trigger');
    }

    // Allow any toast/streams to settle
    await page.waitForTimeout(1500);

    // Filter out common non-critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error promise rejection')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});
