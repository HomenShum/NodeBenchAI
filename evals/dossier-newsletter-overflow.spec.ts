import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Dossier Newsletter Overflow Check', () => {
  test('should not have horizontal overflow in Wall Street view', async ({ page }) => {
    const filePath = 'file:///' + path.resolve('src/components/views/dossier-newsletter.html').replace(/\\/g, '/');

    await page.goto(filePath);
    await page.waitForTimeout(1000);

    // Take screenshot
    await page.screenshot({ path: 'test-results/overflow-wsj.png', fullPage: true });

    // Check for horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    // Get dimensions
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));

    console.log('WSJ Dimensions:', dimensions);

    // Find elements causing overflow
    const overflowElements = await page.evaluate(() => {
      const elements: any[] = [];
      const viewportWidth = document.documentElement.clientWidth;

      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > viewportWidth + 5 || rect.width > viewportWidth + 5) { // 5px tolerance
          elements.push({
            tag: el.tagName,
            class: (el as HTMLElement).className,
            id: (el as HTMLElement).id,
            width: Math.round(rect.width),
            right: Math.round(rect.right),
            overflow: Math.round(rect.right - viewportWidth)
          });
        }
      });

      return elements.slice(0, 10);
    });

    if (overflowElements.length > 0) {
      console.log('\nElements causing overflow in WSJ view:');
      overflowElements.forEach((el, i) => {
        console.log(`${i + 1}. <${el.tag}> class="${el.class}" id="${el.id}"`);
        console.log(`   Width: ${el.width}px, Right: ${el.right}px, Overflow: ${el.overflow}px`);
      });
    }

    expect(hasOverflow, `Horizontal overflow detected: ${dimensions.overflow}px`).toBe(false);
  });

  test('should not have horizontal overflow in Daily Prophet view', async ({ page }) => {
    const filePath = 'file:///' + path.resolve('src/components/views/dossier-newsletter.html').replace(/\\/g, '/');

    await page.goto(filePath);
    await page.waitForTimeout(500);

    // Switch to Daily Prophet
    await page.click('.switcher-tab:nth-child(2)');
    await page.waitForTimeout(1000);

    // Take screenshot
    await page.screenshot({ path: 'test-results/overflow-dp.png', fullPage: true });

    // Check for horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));

    console.log('Daily Prophet Dimensions:', dimensions);

    // Find elements causing overflow
    const overflowElements = await page.evaluate(() => {
      const elements: any[] = [];
      const viewportWidth = document.documentElement.clientWidth;

      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > viewportWidth + 5 || rect.width > viewportWidth + 5) {
          elements.push({
            tag: el.tagName,
            class: (el as HTMLElement).className,
            id: (el as HTMLElement).id,
            width: Math.round(rect.width),
            right: Math.round(rect.right),
            overflow: Math.round(rect.right - viewportWidth)
          });
        }
      });

      return elements.slice(0, 10);
    });

    if (overflowElements.length > 0) {
      console.log('\nElements causing overflow in Daily Prophet view:');
      overflowElements.forEach((el, i) => {
        console.log(`${i + 1}. <${el.tag}> class="${el.class}" id="${el.id}"`);
        console.log(`   Width: ${el.width}px, Right: ${el.right}px, Overflow: ${el.overflow}px`);
      });
    }

    expect(hasOverflow, `Horizontal overflow detected: ${dimensions.overflow}px`).toBe(false);
  });

  test('mode switcher toggles between interactive and print layouts', async ({ page }) => {
    const filePath = 'file:///' + path.resolve('src/components/views/dossier-newsletter.html').replace(/\\/g, '/');

    await page.goto(filePath);
    await page.waitForTimeout(500);

    const body = page.locator('body');
    await expect(body).toHaveClass(/mode-interactive/);

    // In interactive mode, source pills (including "+N more") should be visible
    const pillsContainer = page.locator('#wall-street-view .deal-card .source-pills').first();
    await expect(pillsContainer).toBeVisible();

    const pillCountInteractive = await pillsContainer.locator('.source-pill').count();
    expect(pillCountInteractive).toBeGreaterThanOrEqual(3);

    const morePill = pillsContainer.locator('.source-pill--more');
    await expect(morePill).toBeVisible();

    // Switch to print-only mode
    await page.click('.mode-tab[data-mode="print"]');
    await page.waitForTimeout(300);
    await expect(body).toHaveClass(/mode-print/);

    // In print mode, "+N more" pill should be hidden, but primary pills remain
    await expect(morePill).toBeHidden();

    const pillCountPrint = await pillsContainer.locator('.source-pill').count();
    expect(pillCountPrint).toBeGreaterThanOrEqual(1);
  });

  test('sources popover appears on hover and displays all sources', async ({ page }) => {
    const filePath = 'file:///' + path.resolve('src/components/views/dossier-newsletter.html').replace(/\\/g, '/');

    await page.goto(filePath);
    await page.waitForTimeout(500);

    // Ensure we're in interactive mode
    const body = page.locator('body');
    await expect(body).toHaveClass(/mode-interactive/);

    // Find the "+2 more" pill wrapper for OutcomesAI in WSJ view
    const morePillWrapper = page.locator('#wall-street-view .deal-card .source-pill-wrapper').first();
    const morePill = morePillWrapper.locator('.source-pill--more');
    await expect(morePill).toBeVisible();

    // Popover should be hidden initially
    const popover = morePillWrapper.locator('.sources-popover');
    await expect(popover).toHaveCSS('opacity', '0');

    // Hover over the "+2 more" pill
    await morePill.hover();
    await page.waitForTimeout(300);

    // Popover should now be visible
    await expect(popover).toHaveCSS('opacity', '1');

    // Check popover title
    const popoverTitle = popover.locator('.sources-popover-title');
    await expect(popoverTitle).toContainText('OutcomesAI');

    // Check that all 5 sources are displayed
    const sourceItems = popover.locator('.sources-popover-item');
    const sourceCount = await sourceItems.count();
    expect(sourceCount).toBe(5);

    // Verify source types are displayed
    const sourceTypes = popover.locator('.sources-popover-type');
    await expect(sourceTypes.first()).toBeVisible();

    // Move mouse away to hide popover
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);

    // Popover should be hidden again
    await expect(popover).toHaveCSS('opacity', '0');

    // Test Daily Prophet popover
    await page.click('.switcher-tab:has-text("Daily Prophet Edition")');
    await page.waitForTimeout(300);

    const morePillWrapperDP = page.locator('#daily-prophet-view .dispatch-card .source-pill-wrapper').first();
    const morePillDP = morePillWrapperDP.locator('.source-pill--more');
    await expect(morePillDP).toBeVisible();

    const popoverDP = morePillWrapperDP.locator('.sources-popover');

    // Hover to show popover
    await morePillDP.hover();
    await page.waitForTimeout(300);
    await expect(popoverDP).toHaveCSS('opacity', '1');

    const popoverTitleDP = popoverDP.locator('.sources-popover-title');
    await expect(popoverTitleDP).toContainText('OutcomesAI');
  });

  test('sources popover works in print mode', async ({ page }) => {
    const filePath = 'file:///' + path.resolve('src/components/views/dossier-newsletter.html').replace(/\\/g, '/');

    await page.goto(filePath);
    await page.waitForTimeout(500);

    // Switch to print mode
    await page.click('.mode-tab[data-mode="print"]');
    await page.waitForTimeout(300);

    const body = page.locator('body');
    await expect(body).toHaveClass(/mode-print/);

    // In print mode, "+N more" pill should be hidden
    const morePill = page.locator('#wall-street-view .deal-card .source-pill--more').first();
    await expect(morePill).toBeHidden();
  });


});

