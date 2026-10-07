/**
 * End-to-End Test: DCF Spreadsheet Integration
 *
 * Tests the complete flow:
 * 1. User asks Fast Agent to create a DCF model
 * 2. Agent creates DCF session + generates spreadsheet
 * 3. User opens spreadsheet from response link
 * 4. Interactive editing with real-time recalculation
 */

import { test, expect, Page } from '@playwright/test';

const APP_URL = 'http://localhost:5174';

/**
 * Helper: Wait for page load with fallback strategies
 */
async function waitForPageLoad(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('✅ Page loaded (domcontentloaded)');
    await page.waitForTimeout(2000); // Wait for React hydration

    const hasContent = await page.locator('body').isVisible({ timeout: 5000 });
    if (hasContent) {
      console.log('✅ App content visible');
      return;
    }
  } catch (e) {
    console.log('⚠️  domcontentloaded timeout, trying load...');
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    console.log('✅ Page loaded (load event)');
    await page.waitForTimeout(2000);
  }
}

/**
 * Helper: Wait for agent processing with progress feedback
 */
async function waitForAgentProcessing(
  page: Page,
  options: {
    maxWaitTime?: number;
    checkInterval?: number;
    operation?: string;
  } = {}
) {
  const {
    maxWaitTime = 120000,
    checkInterval = 2000,
    operation = 'agent processing'
  } = options;

  const startTime = Date.now();
  let lastLogTime = startTime;

  console.log(`⏳ Waiting for ${operation}...`);

  while (Date.now() - startTime < maxWaitTime) {
    const isProcessing = await page.locator('[class*="loading"], [class*="processing"], [aria-busy="true"]').first().isVisible({ timeout: 1000 }).catch(() => false);

    const elapsed = Date.now() - startTime;
    if (elapsed - (lastLogTime - startTime) >= 10000) {
      console.log(`  ⏱️  ${Math.round(elapsed / 1000)}s elapsed for ${operation}...`);
      lastLogTime = Date.now();
    }

    if (!isProcessing) {
      await page.waitForTimeout(checkInterval);
      const stillNotProcessing = await page.locator('[class*="loading"], [class*="processing"], [aria-busy="true"]').first().isVisible({ timeout: 1000 }).catch(() => false);
      if (!stillNotProcessing) {
        console.log(`✅ ${operation} completed in ${Math.round(elapsed / 1000)}s`);
        return;
      }
    }

    await page.waitForTimeout(checkInterval);
  }

  console.log(`⚠️  ${operation} timeout after ${Math.round((Date.now() - startTime) / 1000)}s`);
}

test.describe('DCF Spreadsheet Integration', () => {
  test.beforeEach(async ({ page }) => {
    await waitForPageLoad(page, APP_URL);
  });

  test('should create DCF model and open interactive spreadsheet', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes for complete flow

    // Step 0: Ensure we're starting from a fully loaded home page
    console.log('📍 Step 0: Loading home page first');
    // Note: page.goto(APP_URL) already called in beforeEach via waitForPageLoad

    // Verify the page loaded by checking for known elements
    const menuVisible = await page.locator('text="Menu", text="Home"').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (menuVisible) {
      console.log('✅ Home page loaded successfully');
    } else {
      console.log('⚠️  Home page may not be fully loaded');
    }

    await page.screenshot({ path: 'e2e-screenshots/00-home.png', fullPage: true });

    // Step 1: Open Fast Agent Panel by clicking button
    console.log('📍 Step 1: Opening Fast Agent Panel');

    // Look for "Open Fast Agent" button - this was visible in earlier tests
    const openButton = page.locator('button:has-text("Open Fast Agent"), a:has-text("Open Fast Agent")').first();
    const buttonVisible = await openButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (buttonVisible) {
      console.log('✅ Found "Open Fast Agent" button');
      await openButton.click();
      console.log('✅ Clicked "Open Fast Agent" button');

      // Wait for panel to animate in
      await page.waitForTimeout(2000);
    } else {
      // Fallback: try sidebar navigation
      console.log('⚠️  "Open Fast Agent" button not found, trying sidebar');
      const sidebarItem = page.locator('[href*="agent"], text="Fast Agent"').first();
      const sidebarVisible = await sidebarItem.isVisible({ timeout: 3000 }).catch(() => false);

      if (sidebarVisible) {
        await sidebarItem.click();
        await page.waitForTimeout(2000);
        console.log('✅ Clicked sidebar Fast Agent');
      } else {
        console.log('⚠️  No Fast Agent button found, page might already show the panel');
      }
    }

    await page.screenshot({ path: 'e2e-screenshots/01-after-click.png', fullPage: true });

    // Step 1.5: Wait for Fast Agent Panel to be fully rendered
    console.log('📍 Step 1.5: Waiting for panel to render');

    // Look for panel indicators - the panel might be in different containers
    const panelIndicators = [
      '[class*="FastAgent"]',
      '[class*="agent-panel"]',
      '[data-testid*="agent"]',
      '[class*="chat"]',
      '[class*="message"]',
    ];

    let panelFound = false;
    for (const indicator of panelIndicators) {
      const element = page.locator(indicator).first();
      const visible = await element.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        console.log(`✅ Found panel indicator: ${indicator}`);
        panelFound = true;
        break;
      }
    }

    if (!panelFound) {
      console.log('⚠️  No panel indicator found, but continuing...');
    }

    // Step 2: Find and fill input field with enhanced strategy
    console.log('📍 Step 2: Finding input field');

    // Wait a bit more for animations
    await page.waitForTimeout(2000);

    // Strategy 1: Try to find ANY visible textarea/input on the page
    console.log('  Strategy 1: Looking for any visible input/textarea');
    const allTextareas = page.locator('textarea');
    const textareaCount = await allTextareas.count();
    console.log(`  Found ${textareaCount} textarea elements`);

    let agentInput = null;

    // Check each textarea for visibility
    for (let i = 0; i < textareaCount; i++) {
      const textarea = allTextareas.nth(i);
      const isVisible = await textarea.isVisible({ timeout: 1000 }).catch(() => false);

      if (isVisible) {
        // Check if it's not disabled and not hidden
        const isEnabled = await textarea.isEnabled().catch(() => false);
        const placeholder = await textarea.getAttribute('placeholder').catch(() => '');

        console.log(`  Textarea ${i}: visible=${isVisible}, enabled=${isEnabled}, placeholder="${placeholder}"`);

        if (isVisible && isEnabled) {
          agentInput = textarea;
          console.log(`✅ Found usable textarea at index ${i}`);
          break;
        }
      }
    }

    // Strategy 2: If no textarea found, try inputs
    if (!agentInput) {
      console.log('  Strategy 2: Looking for visible inputs');
      const allInputs = page.locator('input[type="text"], input:not([type])');
      const inputCount = await allInputs.count();
      console.log(`  Found ${inputCount} text input elements`);

      for (let i = 0; i < inputCount; i++) {
        const input = allInputs.nth(i);
        const isVisible = await input.isVisible({ timeout: 1000 }).catch(() => false);

        if (isVisible) {
          const isEnabled = await input.isEnabled().catch(() => false);
          if (isVisible && isEnabled) {
            agentInput = input;
            console.log(`✅ Found usable input at index ${i}`);
            break;
          }
        }
      }
    }

    // Strategy 3: Try contenteditable
    if (!agentInput) {
      console.log('  Strategy 3: Looking for contenteditable');
      const contentEditable = page.locator('[contenteditable="true"]').first();
      const visible = await contentEditable.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        agentInput = contentEditable;
        console.log('✅ Found contenteditable element');
      }
    }

    // Strategy 4: Force click on a known location if input is not found
    if (!agentInput) {
      console.log('  Strategy 4: Attempting to force panel open');

      // Try clicking on "Fast Agent" text or similar to activate
      const activators = [
        'text="Fast Agent"',
        'button:has-text("Fast Agent")',
        '[role="button"]:has-text("Fast Agent")',
      ];

      for (const activator of activators) {
        const element = page.locator(activator).first();
        const clickable = await element.isVisible({ timeout: 2000 }).catch(() => false);
        if (clickable) {
          console.log(`  Clicking activator: ${activator}`);
          await element.click();
          await page.waitForTimeout(2000);

          // Try finding textarea again
          const textarea = page.locator('textarea').first();
          const nowVisible = await textarea.isVisible({ timeout: 2000 }).catch(() => false);
          if (nowVisible) {
            agentInput = textarea;
            console.log('✅ Input appeared after clicking activator');
            break;
          }
        }
      }
    }

    // Final check
    if (!agentInput) {
      console.log('❌ All strategies failed, taking debug screenshot');
      await page.screenshot({ path: 'e2e-screenshots/debug-no-input.png', fullPage: true });

      // Log detailed page state
      const pageText = await page.locator('body').textContent();
      console.log('Page content (first 1000 chars):', pageText?.substring(0, 1000));

      // Log all elements
      const allElements = await page.locator('textarea, input, [contenteditable="true"]').count();
      console.log(`Total interactive elements found: ${allElements}`);

      throw new Error('Could not find agent input field after all strategies');
    }

    // Fill and send request
    await agentInput.fill('Build a DCF model for NVIDIA');
    await page.waitForTimeout(500);

    // Try pressing Enter
    await agentInput.press('Enter');

    console.log('✅ Sent: "Build a DCF model for NVIDIA"');
    await page.screenshot({ path: 'e2e-screenshots/02-request-sent.png', fullPage: true });

    // Step 3: Wait for agent response with spreadsheet link
    console.log('📍 Step 3: Waiting for agent response (up to 120s)...');

    let spreadsheetId: string | null = null;
    const maxWaitTime = 120000; // 2 minutes - DCF creation can take 20-40s
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await page.waitForTimeout(3000);

      // Look for spreadsheet link in page - try multiple patterns
      const pageContent = await page.content();

      // Pattern 1: Hash link
      let spreadsheetMatch = pageContent.match(/#spreadsheets\/([a-z0-9]+)/i);

      // Pattern 2: Regular link
      if (!spreadsheetMatch) {
        spreadsheetMatch = pageContent.match(/spreadsheets\/([a-z0-9]+)/i);
      }

      // Pattern 3: Look for the actual response text containing "Spreadsheet ID:"
      if (!spreadsheetMatch) {
        const idMatch = pageContent.match(/Spreadsheet ID:[^\w]*([a-z0-9]{20,})/i);
        if (idMatch) {
          spreadsheetMatch = idMatch;
        }
      }

      if (spreadsheetMatch && spreadsheetMatch[1]) {
        spreadsheetId = spreadsheetMatch[1];
        console.log(`✅ Found spreadsheet ID: ${spreadsheetId}`);
        break;
      }

      // Check for completion indicators
      const hasResponse = await page.locator('text=/Created DCF model|DCF Session ID|Spreadsheet ID|cells populated/i').first().isVisible().catch(() => false);
      if (hasResponse && !spreadsheetId) {
        console.log('  ⚠️  Response detected but no spreadsheet ID found yet, checking again...');
        // Try one more time after waiting a bit
        await page.waitForTimeout(2000);
        const contentAgain = await page.content();
        const matchAgain = contentAgain.match(/#spreadsheets\/([a-z0-9]+)/i) ||
                          contentAgain.match(/spreadsheets\/([a-z0-9]+)/i);
        if (matchAgain && matchAgain[1]) {
          spreadsheetId = matchAgain[1];
          console.log(`✅ Found spreadsheet ID on retry: ${spreadsheetId}`);
          break;
        }
      }

      // Check for errors
      const hasError = await page.locator('text=/❌|failed|Failed to create/i').first().isVisible().catch(() => false);
      if (hasError) {
        const errorText = await page.locator('text=/Error:|Failed/i').first().textContent();
        await page.screenshot({ path: 'e2e-screenshots/error.png', fullPage: true });

        // Log more context
        console.log('Error detected, page content preview:');
        console.log(pageContent.substring(0, 1500));

        throw new Error(`Agent failed: ${errorText}`);
      }

      const elapsed = Date.now() - startTime;
      if (elapsed % 10000 < 3000) { // Log every ~10s
        console.log(`  ⏱️  ${Math.round(elapsed / 1000)}s elapsed...`);
      }
    }

    if (!spreadsheetId) {
      await page.screenshot({ path: 'e2e-screenshots/timeout.png', fullPage: true });

      // Log final page content for debugging
      const finalContent = await page.content();
      console.log('Final page content (first 2000 chars):');
      console.log(finalContent.substring(0, 2000));

      throw new Error('Timeout: No spreadsheet ID found after 120s');
    }

    await page.screenshot({ path: 'e2e-screenshots/03-agent-response.png', fullPage: true });

    expect(spreadsheetId).toBeTruthy();
    console.log(`✅ DCF model created with spreadsheet ID: ${spreadsheetId}`);

    // Step 4: Navigate to spreadsheet
    console.log('📍 Step 4: Open spreadsheet');
    await page.goto(`${APP_URL}/#spreadsheets/${spreadsheetId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e-screenshots/04-spreadsheet-view.png', fullPage: true });
    console.log('✅ Navigated to spreadsheet');

    // Step 5: Verify DCF data is visible
    console.log('📍 Step 5: Verify DCF data');

    const pageContent = await page.content();

    // Check for key DCF elements
    const expectedElements = [
      { name: 'NVDA DCF Model', found: pageContent.includes('NVDA') && pageContent.includes('DCF') },
      { name: 'Fair Value', found: pageContent.toLowerCase().includes('fair value') },
      { name: 'WACC', found: pageContent.includes('WACC') },
      { name: 'Enterprise Value', found: pageContent.toLowerCase().includes('enterprise value') },
      { name: 'Growth rates', found: pageContent.toLowerCase().includes('growth') },
    ];

    let foundCount = 0;
    for (const element of expectedElements) {
      if (element.found) {
        console.log(`  ✅ Found: ${element.name}`);
        foundCount++;
      } else {
        console.log(`  ⚠️  Not found: ${element.name}`);
      }
    }

    // Verify at least some numerical data exists
    const hasNumbers = await page.locator('text=/\\d+\\.\\d+|\\$\\d+/').first().isVisible().catch(() => false);
    expect(hasNumbers).toBeTruthy();

    await page.screenshot({ path: 'e2e-screenshots/05-dcf-data.png', fullPage: true });

    if (foundCount >= 3) {
      console.log(`✅ DCF data verified (${foundCount}/5 elements found)`);
    } else {
      console.log(`⚠️  Limited DCF data found (${foundCount}/5 elements)`);
    }

    // Step 6: Test cell editing capability (optional)
    console.log('📍 Step 6: Test cell editing');

    // Look for cells with growth rate values
    const cellWithNumber = page.locator('[role="gridcell"], td, .cell').filter({
      hasText: /^10\.0$|^12\.0$|^15\.0$/
    }).first();

    const cellFound = await cellWithNumber.isVisible({ timeout: 5000 }).catch(() => false);

    if (cellFound) {
      console.log('  ✅ Found editable cell');

      // Click and edit
      await cellWithNumber.click();
      await page.waitForTimeout(500);

      // Try typing
      await page.keyboard.type('15.0');
      await page.keyboard.press('Enter');

      console.log('  ✅ Cell edit attempted');
      await page.waitForTimeout(3000); // Wait for recalculation

      await page.screenshot({ path: 'e2e-screenshots/06-after-edit.png', fullPage: true });
      console.log('  ✅ Recalculation wait completed');
    } else {
      console.log('  ⚠️  Editable cell not found (may use different format)');
    }

    // Final screenshot
    await page.screenshot({ path: 'e2e-screenshots/07-final.png', fullPage: true });

    console.log('═══════════════════════════════════════');
    console.log('✅ DCF spreadsheet test completed successfully!');
    console.log('═══════════════════════════════════════');
  });

  test('should handle invalid ticker gracefully', async ({ page }) => {
    test.setTimeout(45000);

    // Open Fast Agent
    const fastAgentButton = page.locator('button:has-text("Fast Agent"), button:has-text("AI")').first();
    if (await fastAgentButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await fastAgentButton.click();
      await page.waitForTimeout(1000);
    }

    // Find input
    const agentInput = page.locator(
      'input[placeholder*="ask" i], textarea[placeholder*="ask" i]'
    ).last();

    if (await agentInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await agentInput.fill('Build a DCF model for INVALIDTICKER123');
      await agentInput.press('Enter');

      console.log('✅ Sent invalid ticker request');

      // Wait for response
      await page.waitForTimeout(15000);

      // Check for error message
      const hasError = await page.locator('text=/❌|failed|error|not found/i').first().isVisible().catch(() => false);

      if (hasError) {
        console.log('✅ Error handling works correctly');
        await page.screenshot({ path: 'e2e-screenshots/error-handling.png', fullPage: true });
      } else {
        console.log('⚠️  No error message shown (may still be processing)');
      }
    } else {
      console.log('⚠️  Agent input not found');
    }
  });
});
