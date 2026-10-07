import { test, expect } from '@playwright/test';

// ============================================================
// Dark Mode Visual Audit — Screenshots of every major screen
// Forces dark mode, navigates all routes, captures screenshots
// ============================================================

const ANON_SIGN_IN = 'button:has-text("Sign in anonymously")';

// All known routes in the app
const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/research', name: 'research-hub' },
  { path: '/research/overview', name: 'research-overview' },
  { path: '/research/signals', name: 'research-signals' },
  { path: '/research/briefing', name: 'research-briefing' },
  { path: '/research/deals', name: 'research-deals' },
  { path: '/research/changelog', name: 'research-changelog' },
  { path: '/documents', name: 'documents' },
  { path: '/spreadsheets', name: 'spreadsheets' },
  { path: '/calendar', name: 'calendar' },
  { path: '/agents', name: 'agents' },
  { path: '/roadmap', name: 'roadmap' },
  { path: '/timeline', name: 'timeline' },
  { path: '/developers', name: 'developers' },
  { path: '/footnotes', name: 'footnotes' },
  { path: '/signals', name: 'signals' },
  { path: '/benchmarks', name: 'benchmarks' },
  { path: '/funding', name: 'funding' },
  { path: '/activity', name: 'activity' },
  { path: '/analytics-hitl', name: 'analytics-hitl' },
  { path: '/analytics-components', name: 'analytics-components' },
  { path: '/analytics-recommendations', name: 'analytics-recommendations' },
  { path: '/cost', name: 'cost-dashboard' },
  { path: '/industry', name: 'industry-updates' },
  { path: '/for-you', name: 'for-you-feed' },
  { path: '/recommendations', name: 'document-recommendations' },
  { path: '/marketplace', name: 'agent-marketplace' },
  { path: '/github', name: 'github-explorer' },
  { path: '/pr-suggestions', name: 'pr-suggestions' },
  { path: '/linkedin', name: 'linkedin-posts' },
  { path: '/mcp-ledger', name: 'mcp-ledger' },
  { path: '/dogfood', name: 'dogfood' },
  { path: '/public', name: 'public-docs' },
];

async function navigateWithinApp(page, targetPath: string) {
  if (targetPath === '/') {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  } else {
    await page.evaluate((path) => {
      history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, targetPath);
  }
  await page.waitForSelector('#main-content', { state: 'visible', timeout: 60000 });
  await page.waitForTimeout(900);
}

test.describe('Dark Mode Visual Audit', () => {
  test.beforeEach(async ({ page }) => {
    // Force dark mode BEFORE navigating
    await page.addInitScript(() => {
      localStorage.setItem('nodebench-theme', JSON.stringify({
        mode: 'dark',
        accentColor: 'indigo',
        density: 'comfortable',
        fontFamily: 'Inter',
        backgroundPattern: 'none',
        reducedMotion: false,
      }));
      localStorage.setItem('theme', 'dark');
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Sign in anonymously
    const anonBtn = page.locator(ANON_SIGN_IN);
    if (await anonBtn.count() > 0) {
      await anonBtn.click();
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle');
    }

    // Verify dark mode is actually applied
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(isDark).toBe(true);
  });

  // Screenshot every route
  for (const route of ROUTES) {
    test(`screenshot: ${route.name} (${route.path})`, async ({ page }) => {
      await navigateWithinApp(page, route.path);
      await page.waitForTimeout(600); // Let animations settle

      await page.screenshot({
        path: `test-results/dark-mode/${route.name}.png`,
        fullPage: true,
      });
    });
  }

  // Settings modal tabs
  test('screenshot: settings modal (all tabs)', async ({ page }) => {
    const settingsBtn = page.locator('button[title="Profile"], button[title="Settings"], [aria-label="Settings"]');
    if (await settingsBtn.count() === 0) { test.skip(); return; }

    await settingsBtn.first().click();
    await page.waitForTimeout(500);

    const tabs = ['profile', 'account', 'preferences', 'usage', 'integrations', 'billing', 'reminders', 'channels'];
    for (const tab of tabs) {
      const tabBtn = page.locator(`button:has-text("${tab.charAt(0).toUpperCase() + tab.slice(1)}")`).first();
      if (await tabBtn.count() > 0) {
        await tabBtn.click({ force: true });
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `test-results/dark-mode/settings-${tab}.png`,
          fullPage: false,
        });
      }
    }
  });

  // Command palette
  test('screenshot: command palette', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `test-results/dark-mode/command-palette.png`,
      fullPage: false,
    });
  });

  // Collect all dark mode issues
  test('audit: check for hardcoded light colors in dark mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Check for elements with hardcoded white/light backgrounds in dark mode
    const issues = await page.evaluate(() => {
      const problems: string[] = [];
      const allElements = document.querySelectorAll('*');

      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const color = style.color;
        const tag = el.tagName.toLowerCase();
        const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0, 80) : '';
        const testId = el.getAttribute('data-testid') || '';

        // Skip invisible elements
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        // Skip tiny elements
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;

        // Parse rgb values
        const parseBg = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const parseColor = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

        if (parseBg) {
          const [r, g, b] = [+parseBg[1], +parseBg[2], +parseBg[3]];
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b);

          // Hardcoded bright white backgrounds in dark mode (>240 luminance)
          if (luminance > 240 && rect.width > 50 && rect.height > 20) {
            problems.push(`BRIGHT_BG: ${tag}[${testId || cls.slice(0,40)}] bg=${bg} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
          }
        }

        if (parseColor) {
          const [r, g, b] = [+parseColor[1], +parseColor[2], +parseColor[3]];
          const textLuminance = (0.299 * r + 0.587 * g + 0.114 * b);

          // Very dark text on dark background (text luminance < 50)
          if (textLuminance < 50 && el.textContent && el.textContent.trim().length > 0) {
            // Check parent bg
            let parent = el.parentElement;
            let parentBg = 'transparent';
            while (parent) {
              const pStyle = window.getComputedStyle(parent);
              if (pStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && pStyle.backgroundColor !== 'transparent') {
                parentBg = pStyle.backgroundColor;
                break;
              }
              parent = parent.parentElement;
            }
            const pParse = parentBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (pParse) {
              const parentLum = (0.299 * +pParse[1] + 0.587 * +pParse[2] + 0.114 * +pParse[3]);
              if (parentLum < 50) {
                const preview = (el.textContent || '').trim().slice(0, 30);
                problems.push(`LOW_CONTRAST: ${tag}[${testId || cls.slice(0,40)}] text="${preview}" color=${color} on parentBg=${parentBg}`);
              }
            }
          }
        }
      }

      return problems.slice(0, 100); // Cap at 100 issues
    });

    console.log(`Found ${issues.length} dark mode issues on home page:`);
    for (const issue of issues) {
      console.log(`  ${issue}`);
    }
  });
});
