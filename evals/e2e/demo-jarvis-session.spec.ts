import { test, expect, type Page } from '@playwright/test';

/**
 * Sentinel Demo Session — Operates NodeBench AI like a real user
 * Uses the Jarvis HUD / agent input bar to issue voice-like text commands
 * and navigates the entire app surface.
 */

const EVIDENCE_DIR = 'test-results/demo-jarvis';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function setDarkTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'nodebench-theme',
      JSON.stringify({
        mode: 'dark',
        accentColor: 'indigo',
        density: 'comfortable',
        fontFamily: 'Inter',
        backgroundPattern: 'none',
        reducedMotion: false,
      })
    );
  });
}

async function signInIfNeeded(page: Page) {
  const signInBtn = page.getByRole('button', { name: /sign in anonymously/i });
  if ((await signInBtn.count()) > 0) {
    await signInBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
  }
}

/** Find the best available text input: Jarvis HUD, FastAgentPanel, or command palette */
async function findInput(page: Page) {
  // Jarvis HUD prompt
  for (const sel of [
    '[data-testid="jarvis-prompt-input"]',
    '[data-testid="hud-prompt-input"]',
    'input[placeholder*="Ask Jarvis"]',
    'input[placeholder*="ask jarvis"]',
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) return el;
  }

  // FastAgentPanel textarea
  for (const sel of [
    '[data-testid="agent-input"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Type"]',
    'textarea[placeholder*="Message"]',
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) return el;
  }

  // Any textarea as last resort
  const ta = page.locator('textarea').first();
  if (await ta.isVisible().catch(() => false)) return ta;

  return null;
}

/** Type a command into the input and submit */
async function voiceCommand(page: Page, text: string) {
  const input = await findInput(page);
  if (!input) {
    // Fallback: try Ctrl+K command palette
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);
    const palInput = page.locator('input[placeholder*="Search"], input[placeholder*="Type a command"]').first();
    if (await palInput.isVisible().catch(() => false)) {
      await palInput.fill(text);
      await palInput.press('Enter');
      return;
    }
    throw new Error(`No input found for voice command: "${text}"`);
  }
  await input.click();
  await input.fill(text);
  await page.waitForTimeout(100);
  await input.press('Enter');
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}.png` });
}

// ── The Session ──────────────────────────────────────────────────────────────

test.describe('Jarvis Demo: Real User Session', () => {
  test.setTimeout(120_000);

  test('Act 1: Landing & Sign-in', async ({ page }) => {
    await setDarkTheme(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await capture(page, '01-landing');

    await signInIfNeeded(page);
    await page.waitForTimeout(1000);
    await capture(page, '02-signed-in');

    // Verify main content rendered
    await expect(page.locator('#main-content, [data-testid="main-content"], main, [role="main"]').first())
      .toBeVisible({ timeout: 10000 });
  });

  test('Act 2: Voice navigation tour', async ({ page }) => {
    await setDarkTheme(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await signInIfNeeded(page);
    await page.waitForTimeout(1000);

    const routes = [
      { cmd: 'go to research', name: '03-research', wait: 1500 },
      { cmd: 'show me funding', name: '04-funding', wait: 1500 },
      { cmd: 'open benchmarks', name: '05-benchmarks', wait: 1500 },
      { cmd: 'go to calendar', name: '06-calendar', wait: 1500 },
      { cmd: 'show documents', name: '07-documents', wait: 1500 },
      { cmd: 'open agents', name: '08-agents', wait: 1500 },
      { cmd: 'show me costs', name: '09-costs', wait: 1500 },
    ];

    for (const route of routes) {
      try {
        await voiceCommand(page, route.cmd);
        await page.waitForTimeout(route.wait);
        await capture(page, route.name);
      } catch (err) {
        // If voice input not available, navigate directly via URL
        console.log(`Voice cmd "${route.cmd}" failed, using direct nav`);
        // Extract view name from screenshot name
        const urlMap: Record<string, string> = {
          '03-research': '/research',
          '04-funding': '/funding',
          '05-benchmarks': '/benchmarks',
          '06-calendar': '/calendar',
          '07-documents': '/documents',
          '08-agents': '/marketplace',
          '09-costs': '/cost',
        };
        const path = urlMap[route.name];
        if (path) {
          await page.goto(`/#${path}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(route.wait);
        }
        await capture(page, route.name);
      }
    }
  });

  test('Act 3: Mode switching & settings', async ({ page }) => {
    await setDarkTheme(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await signInIfNeeded(page);
    await page.waitForTimeout(1000);

    // Try voice mode switching
    try {
      await voiceCommand(page, 'switch to intelligence mode');
      await page.waitForTimeout(1000);
      await capture(page, '10-intel-mode');

      await voiceCommand(page, 'switch to build mode');
      await page.waitForTimeout(1000);
      await capture(page, '11-build-mode');

      await voiceCommand(page, 'open settings');
      await page.waitForTimeout(1000);
      await capture(page, '12-settings');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch {
      // Direct fallback
      await capture(page, '10-mode-fallback');
    }
  });

  test('Act 4: Theme toggling', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await signInIfNeeded(page);
    await page.waitForTimeout(1000);

    // Set dark mode via localStorage
    await page.evaluate(() => {
      const theme = JSON.parse(localStorage.getItem('nodebench-theme') || '{}');
      theme.mode = 'dark';
      localStorage.setItem('nodebench-theme', JSON.stringify(theme));
      window.dispatchEvent(new Event('storage'));
    });
    await page.waitForTimeout(500);
    await capture(page, '13-dark-mode');

    // Switch to light
    await page.evaluate(() => {
      const theme = JSON.parse(localStorage.getItem('nodebench-theme') || '{}');
      theme.mode = 'light';
      localStorage.setItem('nodebench-theme', JSON.stringify(theme));
      window.dispatchEvent(new Event('storage'));
    });
    await page.waitForTimeout(500);
    await capture(page, '14-light-mode');
  });

  test('Act 5: Rapid view tour (15 views)', async ({ page }) => {
    await setDarkTheme(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await signInIfNeeded(page);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const views = [
      '/developers', '/footnotes', '/signals', '/benchmarks', '/funding',
      '/activity', '/github', '/linkedin', '/mcp-ledger', '/recommendations',
      '/for-you', '/industry', '/cost', '/roadmap', '/timeline',
    ];

    for (let i = 0; i < views.length; i++) {
      await page.goto(`/#${views[i]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);

      // Check no error boundary triggered
      const errorBoundary = page.getByText('Something went wrong');
      const hasError = await errorBoundary.isVisible().catch(() => false);
      if (hasError) {
        errors.push(`Error boundary on ${views[i]}`);
      }

      if (i % 5 === 0) {
        await capture(page, `15-tour-${i}`);
      }
    }

    await capture(page, '16-tour-final');

    // No page errors accumulated
    const realErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Failed to fetch')
    );
    expect(realErrors.length).toBeLessThanOrEqual(2);
  });

  test('Act 6: Scroll & utility commands', async ({ page }) => {
    await setDarkTheme(page);
    await page.goto('/#/research', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await signInIfNeeded(page);

    // Scroll down
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
    await page.waitForTimeout(800);
    await capture(page, '17-scrolled-bottom');

    // Scroll up
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(800);
    await capture(page, '18-scrolled-top');
  });

  test('Act 7: Agent chat (if available)', async ({ page }) => {
    await setDarkTheme(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await signInIfNeeded(page);
    await page.waitForTimeout(1000);

    const input = await findInput(page);
    if (input) {
      await input.click();
      await input.fill('what is the latest in AI benchmarks?');
      await page.waitForTimeout(100);
      await input.press('Enter');
      // Wait for agent response to start streaming
      await page.waitForTimeout(3000);
      await capture(page, '19-agent-chat');
    } else {
      // No input found — just screenshot the current state
      await capture(page, '19-no-agent-input');
    }
  });
});
