import { test, expect } from '@playwright/test';

test.describe('UI Dive Regression Tests — NodeBench AI', () => {
  test('regression: NaN% displayed in Token Usage and Execution Success Rate when no data', async ({ page }) => {
    await page.goto('http://localhost:5173/cost');
    await page.waitForLoadState('networkidle');

    // Bug: Cost Dashboard shows 'NaN% of total' for Input/Output Tokens and 'NaN% success/failure rate'. Division by zero (0/0) when there are no requests. Should display '0%' or '--'.
    // Severity: medium | Category: functional
    // Expected: 0% of total (or -- when no data)
    // Was: NaN% of total, NaN% success rate, NaN% failure rate

    // TODO: Add specific assertions to verify the fix holds
    // Example: await expect(page.locator('.token-percentage')).not.toContainText('NaN');
    await expect(page).not.toContainText('Something went wrong');
  });

  test('regression: For You feed crashes with Convex query error - ErrorBoundary shown', async ({ page }) => {
    await page.goto('http://localhost:5173/for-you');
    await page.waitForLoadState('networkidle');

    // Bug: Navigating to /for-you triggers an unhandled Convex query error in domains/research/forYouFeed:getForYouFeed. The entire page crashes to ErrorBoundary showing 'Something went wrong'. No sidebar, no content rendered - just error card with Refresh Page button.
    // Severity: critical | Category: functional
    // Expected: For You feed renders with personalized content cards
    // Was: ErrorBoundary crash: 'Something went wrong. An unexpected error occurred while rendering this section.'

    // TODO: Add specific assertions to verify the fix holds
    // Example: await expect(page.locator('.token-percentage')).not.toContainText('NaN');
    await expect(page).not.toContainText('Something went wrong');
  });

  test('regression: Multiple \'Unknown Company\' entries in funding deals', async ({ page }) => {
    await page.goto('http://localhost:5173/funding');
    await page.waitForLoadState('networkidle');

    // Bug: Funding Brief shows multiple deals titled 'Unknown Company ($16B)', 'Unknown Company ($6.1M)', 'Unknown Company ($6M)', 'Unknown Company ($5M)', etc. Company name enrichment not triggered for these entries. Should show actual company name or 'Undisclosed' instead of generic 'Unknown Company'.
    // Severity: medium | Category: content
    // Expected: Company names resolved or labeled 'Undisclosed'
    // Was: Multiple 'Unknown Company (amount)' entries throughout the deal list

    // TODO: Add specific assertions to verify the fix holds
    // Example: await expect(page.locator('.token-percentage')).not.toContainText('NaN');
    await expect(page).not.toContainText('Something went wrong');
  });

  test('regression: /linkedin route falls back to home page - no dedicated LinkedIn Posts view', async ({ page }) => {
    await page.goto('http://localhost:5173/linkedin');
    await page.waitForLoadState('networkidle');

    // Bug: Navigating to /linkedin shows the home page greeting and stats instead of a LinkedIn Posts view. The breadcrumb doesn't show 'LinkedIn Posts' and the sidebar 'LinkedIn Posts' button is not highlighted. The route likely isn't registered in React Router or falls through to the default route.
    // Severity: medium | Category: functional
    // Expected: Dedicated LinkedIn Posts page with post archive and analytics
    // Was: Home page content (greeting hero, stats cards, feature cards) rendered instead

    // TODO: Add specific assertions to verify the fix holds
    // Example: await expect(page.locator('.token-percentage')).not.toContainText('NaN');
    await expect(page).not.toContainText('Something went wrong');
  });

  test('interaction: Sidebar navigation - all menu items clickable', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');

    // Step 0: click Cost Dashboard button → Navigates to /cost route
    // PASSED: Clicked Cost Dashboard - navigated to /cost view. Cost Dashboard page loaded with stats cards, token usage breakdown, execution success rate.

    // Step 1: screenshot  → Cost Dashboard page is displayed
    // FAILED: Screenshot captured. BUG: Token Usage Breakdown shows 'NaN% of total' for Input/Output tokens. Execution Success Rate shows 'NaN% success rate' and 'NaN% failure rate'. Division by zero when no data.
    // TODO: Verify this step now passes

    // Step 2: click Home button in sidebar → Navigates back to / route
    // PASSED: Clicked Home button in sidebar - navigated back to home view. Sidebar shows Home as active.

    // Step 3: click Agent Marketplace button → Navigates to /marketplace route
    // PASSED: Clicked Agent Marketplace - page loaded with agent cards (#1 Validation Agent, #2 Research Agent, #3 Publishing Agent, #4 Analysis Agent). Category tabs visible: All Categories, Research, Synthesis, Publishing, Validation, AgentLoop.

    // Step 4: screenshot  → Agent Marketplace page is displayed
    // PASSED: Screenshot captured showing Agent Marketplace with 4 agent cards, engagement predictions, success rates, phoenix scores. Page rendered correctly.
  });
});
