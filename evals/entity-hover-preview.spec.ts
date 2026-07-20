/**
 * Entity Hover Preview UI Tests
 *
 * Screenshots:
 * 1. Morning Digest with entity links
 * 2. Entity hover preview popover
 * 3. Entity profile page
 */

import { test, expect } from '@playwright/test';

test.describe('Entity Hover Preview UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    // Wait for initial load
    await page.waitForLoadState('networkidle');
  });

  test('captures Morning Digest with entity links', async ({ page }) => {
    // The app should show the research hub / morning digest on landing
    await page.waitForTimeout(2000);

    // Take a screenshot of the landing page
    await page.screenshot({
      path: 'tests/screenshots/01-landing-page.png',
      fullPage: false,
    });

    // Look for the digest area
    const digestSection = page.locator('text=Digest Overview').first();
    if (await digestSection.isVisible()) {
      await page.screenshot({
        path: 'tests/screenshots/02-digest-section.png',
        fullPage: false,
      });
    }
  });

  test('captures entity link hover preview', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for entity links (they have the EntityLink styling)
    const entityLinks = page.locator('button').filter({ has: page.locator('svg') });
    const firstEntityLink = entityLinks.first();

    if (await firstEntityLink.isVisible()) {
      // Hover over the entity link
      await firstEntityLink.hover();

      // Wait for the hover preview to appear (300ms delay + render time)
      await page.waitForTimeout(500);

      // Take a screenshot with the hover preview
      await page.screenshot({
        path: 'tests/screenshots/03-entity-hover-preview.png',
        fullPage: false,
      });
    }
  });

  test('captures entity profile page', async ({ page }) => {
    // Navigate directly to an entity profile page using hash routing
    await page.goto('/#entity/Anthropic');
    await page.waitForLoadState('networkidle');

    // Wait for data to load - look for the hero card or key facts section
    await page.waitForSelector('text=KEY FACTS', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Take a screenshot of the entity profile page
    await page.screenshot({
      path: 'tests/screenshots/04-entity-profile-page.png',
      fullPage: true, // Full page to show all sections
    });
  });

  test('captures entity profile page for FDA approval entity', async ({ page }) => {
    // Navigate to an FDA approval type entity
    await page.goto('/#entity/Moderna%20mRNA-4157');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'tests/screenshots/05-entity-fda-approval.png',
      fullPage: false,
    });
  });

  test('captures entity profile page for funding event', async ({ page }) => {
    // Navigate to a funding event type entity
    await page.goto('/#entity/Series%20D%20Funding');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'tests/screenshots/06-entity-funding-event.png',
      fullPage: false,
    });
  });

  test('captures entity profile page for person (Sam Altman)', async ({ page }) => {
    // Navigate to a person entity - uses seeded data
    await page.goto('/#entity/Sam%20Altman');
    await page.waitForLoadState('networkidle');

    // Wait for data to load
    await page.waitForSelector('text=KEY FACTS', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'tests/screenshots/07-entity-person-sam-altman.png',
      fullPage: true,
    });
  });

  test('captures entity profile page for OpenAI (with funding data)', async ({ page }) => {
    // Navigate to OpenAI - a company with full funding data
    await page.goto('/#entity/OpenAI');
    await page.waitForLoadState('networkidle');

    // Wait for data to load
    await page.waitForSelector('text=KEY FACTS', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'tests/screenshots/08-entity-company-openai.png',
      fullPage: true,
    });
  });
});
