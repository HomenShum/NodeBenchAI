/**
 * Entity Adaptive Profile - Full Page Screenshots
 *
 * Captures entity profile pages with complete adaptive enrichment data:
 * - Executive Summary
 * - Timeline
 * - Network & Relationships
 * - Circle of Influence
 * - Dynamic Sections
 */

import { test, expect } from '@playwright/test';

test.describe('Entity Adaptive Profile Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('captures Sam Altman full adaptive profile', async ({ page }) => {
    // Navigate to Sam Altman entity profile
    await page.goto('/#entity/Sam%20Altman');
    await page.waitForLoadState('networkidle');

    // Wait for content to stabilize
    await page.waitForTimeout(2000);

    // Click on ALL collapsed sections to expand them (look for chevron-down icons)
    // These are the collapsible sections with expandable content
    const allSectionButtons = page.locator('button').filter({ hasText: /(INVESTMENT|EDUCATION|STATEMENTS|VENTURES|PORTFOLIO|SOURCES|KEY FACTS|EXECUTIVE|TIMELINE|NETWORK)/i });
    const count = await allSectionButtons.count();
    console.log(`Found ${count} collapsible sections`);

    for (let i = 0; i < count; i++) {
      try {
        const btn = allSectionButtons.nth(i);
        // Check if this section is collapsed (has chevron-down visible)
        await btn.click();
        await page.waitForTimeout(300);
      } catch (e) {
        console.log(`Could not click section ${i}`);
      }
    }

    // Wait for any animations
    await page.waitForTimeout(500);

    // Scroll through the entire page to ensure all content is loaded
    await page.evaluate(async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const scrollHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      for (let y = 0; y < scrollHeight; y += viewportHeight / 2) {
        window.scrollTo(0, y);
        await delay(100);
      }
      window.scrollTo(0, 0);
    });

    await page.waitForTimeout(500);

    // Take full page screenshot with all sections expanded
    await page.screenshot({
      path: 'tests/screenshots/adaptive-sam-altman-fullpage.png',
      fullPage: true,
    });

    // Also take a viewport-sized screenshot
    await page.screenshot({
      path: 'tests/screenshots/adaptive-sam-altman-viewport.png',
      fullPage: false,
    });
  });

  test('captures entity hover popover from Research Hub', async ({ page }) => {
    // Navigate to research hub where entity links appear in digest
    await page.goto('/#research');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for any clickable entity-like buttons or links
    // Entity links typically have specific styling or data attributes
    const entityLinks = page.locator('[data-entity-type], .entity-link, button:has-text("Anthropic"), button:has-text("OpenAI"), button:has-text("Sam Altman")');

    const linkCount = await entityLinks.count();
    console.log(`Found ${linkCount} potential entity links`);

    if (linkCount > 0) {
      const firstLink = entityLinks.first();

      // Hover to trigger popover
      await firstLink.hover();
      await page.waitForTimeout(500); // Wait for 300ms delay + render

      // Look for popover content
      const popover = page.locator('[role="tooltip"], [data-radix-popper-content-wrapper], .popover, .hover-card');
      if (await popover.count() > 0) {
        await page.screenshot({
          path: 'tests/screenshots/entity-hover-popover-visible.png',
          fullPage: false,
        });
      } else {
        // Just screenshot the hover state
        await page.screenshot({
          path: 'tests/screenshots/entity-hover-state.png',
          fullPage: false,
        });
      }
    } else {
      console.log('No entity links found on page');
      await page.screenshot({
        path: 'tests/screenshots/research-hub-no-entities.png',
        fullPage: false,
      });
    }
  });

  test('captures Anthropic company profile with full enrichment', async ({ page }) => {
    await page.goto('/#entity/Anthropic');
    await page.waitForLoadState('networkidle');

    // Wait for content
    await page.waitForSelector('text=KEY FACTS', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Full page screenshot
    await page.screenshot({
      path: 'tests/screenshots/adaptive-anthropic-fullpage.png',
      fullPage: true,
    });
  });

  test('captures OpenAI company profile with full enrichment', async ({ page }) => {
    await page.goto('/#entity/OpenAI');
    await page.waitForLoadState('networkidle');

    // Wait for content
    await page.waitForSelector('text=KEY FACTS', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Full page screenshot
    await page.screenshot({
      path: 'tests/screenshots/adaptive-openai-fullpage.png',
      fullPage: true,
    });
  });

  test('captures Dario Amodei person profile', async ({ page }) => {
    await page.goto('/#entity/Dario%20Amodei');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('text=KEY FACTS', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'tests/screenshots/adaptive-dario-amodei-fullpage.png',
      fullPage: true,
    });
  });
});
