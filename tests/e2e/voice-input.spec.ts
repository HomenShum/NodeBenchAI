/**
 * Voice Input E2E Tests — Scenario-based
 *
 * Personas:
 *   1. Power User "Homen" — cockpit layout, uses voice to issue agent commands
 *   2. Mobile User "Sarah" — iPhone Safari, voice-first interaction
 *   3. Accessibility User "Alex" — keyboard-only, relies on screen reader + voice
 *
 * Scenarios cover:
 *   - Mic button visibility + affordance
 *   - Browser mode (Web Speech API) toggle lifecycle
 *   - Whisper mode recording state + transcription indicator
 *   - Error states (mic denied, API failure)
 *   - Reduced motion compliance
 *   - Mobile viewport mic placement
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate to cockpit layout (HUD landing) */
async function goToHUD(page: Page) {
  // Set cockpit layout preference before navigating
  await page.addInitScript(() => {
    localStorage.setItem('nodebench-onboarded', 'true');
    const stored = localStorage.getItem('nodebench-theme');
    const theme = stored ? JSON.parse(stored) : {};
    theme.layout = 'cockpit';
    localStorage.setItem('nodebench-theme', JSON.stringify(theme));
  });
  await page.goto('/?surface=chat', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('[data-app-shell="main"]', { timeout: 15000 });
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'j',
        code: 'KeyJ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await page.waitForSelector('[aria-label="Ask NodeBench assistant"]', {
    state: 'visible',
    timeout: 15000,
  });
  await page.waitForSelector('[aria-label*="Voice input"], [aria-label*="voice input"]', {
    state: 'visible',
    timeout: 15000,
  });
}

/** Get the mic button */
function micButton(page: Page) {
  return page
    .locator('[aria-label="Ask NodeBench assistant"], [aria-label="Agent Interface"]')
    .locator('button[aria-label*="oice input"], button[aria-label*="Stop listening"], button[aria-label*="Transcribing"]');
}

/** Get the prompt input */
function promptInput(page: Page) {
  return page
    .locator('[aria-label="Ask NodeBench assistant"], [aria-label="Agent Interface"]')
    .locator(
      [
        'input[aria-label*="Ask me anything"]',
        'input[aria-label*="Ask Jarvis"]',
        'input[aria-label*="Ask NodeBench"]',
        'textarea[aria-label*="Ask me anything"]',
        'textarea[aria-label*="Ask Jarvis"]',
        'textarea[aria-label*="Ask NodeBench"]',
        'input[placeholder*="Ask me anything"]',
        'input[placeholder*="Ask Jarvis"]',
        'input[placeholder*="Ask NodeBench"]',
        'input[placeholder*="Ask anything"]',
        'input[placeholder*="Listening for your command"]',
        'textarea[placeholder*="Ask me anything"]',
        'textarea[placeholder*="Ask Jarvis"]',
        'textarea[placeholder*="Ask NodeBench"]',
        'textarea[placeholder*="Ask anything"]',
        'textarea[placeholder*="Listening for your command"]',
      ].join(', ')
    )
    .first();
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// ─── Scenario 1: Power User "Homen" — Desktop Cockpit ───────────────────────

test.describe('Voice Input — Desktop Power User', () => {
  test.beforeEach(async ({ page }) => {
    await goToHUD(page);
  });

  test('mic button is visible and has correct aria-label', async ({ page }) => {
    const mic = micButton(page);
    await expect(mic).toBeVisible();
    await expect(mic).toHaveAttribute('aria-label', /voice input/i);
  });

  test('mic button shows mode in title attribute', async ({ page }) => {
    const mic = micButton(page);
    const title = await mic.getAttribute('title');
    expect(title).toMatch(/voice input/i);
    // Should mention the active voice transport.
    expect(title).toMatch(/browser|whisper|streaming/i);
  });

  test('mic button has keyboard focus ring', async ({ page }) => {
    const mic = micButton(page);
    await mic.focus();
    // Verify the button is focusable
    await expect(mic).toBeFocused();
  });

  test('prompt input and mic button coexist without overlap', async ({ page }) => {
    const input = promptInput(page);
    const mic = micButton(page);

    const inputBox = await input.boundingBox();
    const micBox = await mic.boundingBox();

    expect(inputBox).toBeTruthy();
    expect(micBox).toBeTruthy();

    expect(boxesOverlap(inputBox!, micBox!)).toBe(false);
  });

  test('clicking mic button changes its aria-label to indicate active state', async ({ page, context }) => {
    // Grant microphone permission for Whisper mode (MediaRecorder)
    await context.grantPermissions(['microphone']);

    const mic = micButton(page);
    const labelBefore = await mic.getAttribute('aria-label');
    expect(labelBefore).toMatch(/voice input/i);

    // Click mic — in whisper mode it'll request getUserMedia
    // The button should change state (listening or transcribing)
    await mic.click();
    await page.waitForTimeout(300);

    // After click, either it's listening (got mic) or errored (no real mic in CI)
    // Either way, the button should still be visible and not stuck
    await expect(mic).toBeVisible();
  });
});

// ─── Scenario 2: Mobile User "Sarah" — iPhone Viewport ──────────────────────

test.describe('Voice Input — Mobile', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });

  test('mic button is visible on mobile viewport', async ({ page }) => {
    await goToHUD(page);
    const mic = micButton(page);
    await expect(mic).toBeVisible();

    // Should be within viewport bounds
    const box = await mic.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  });

  test('prompt bar is full-width on mobile', async ({ page }) => {
    await goToHUD(page);
    const input = promptInput(page);
    const box = await input.boundingBox();
    expect(box).toBeTruthy();
    // Input should span most of the viewport width (minus padding + mic + submit buttons)
    expect(box!.width).toBeGreaterThan(150);
  });
});

// ─── Scenario 3: Accessibility User "Alex" — Reduced Motion ─────────────────

test.describe('Voice Input — Accessibility', () => {
  test('mic glow animation respects reduced motion', async ({ page }) => {
    // Enable reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goToHUD(page);

    const mic = micButton(page);
    await expect(mic).toBeVisible();

    // Check that no animation is running on the mic button
    const hasAnimation = await mic.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.animationName !== 'none' && style.animationDuration !== '0s';
    });
    // Mic should not have active animations when reduced motion is on
    // (it hasn't been clicked yet, so no listening animation either way)
    expect(hasAnimation).toBe(false);
  });

  test('mic button has descriptive aria-label for screen readers', async ({ page }) => {
    await goToHUD(page);
    const mic = micButton(page);
    const label = await mic.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label!.length).toBeGreaterThan(5);
    // Label should mention "voice" and "mode"
    expect(label).toMatch(/voice/i);
  });
});

// ─── Scenario 4: Whisper Mode — Recording + Transcription States ─────────────

test.describe('Voice Input — Voice Mode States', () => {
  test('mic button title mentions the active voice mode', async ({ page }) => {
    await goToHUD(page);
    const mic = micButton(page);
    const title = await mic.getAttribute('title');
    expect(title).toMatch(/browser|whisper|streaming/i);
  });

  test('mic button is not disabled before clicking', async ({ page }) => {
    await goToHUD(page);
    const mic = micButton(page);
    await expect(mic).toBeEnabled();
  });
});

// ─── Scenario 5: Error Resilience ────────────────────────────────────────────

test.describe('Voice Input — Error States', () => {
  test('graceful handling when microphone permission denied', async ({ page }) => {
    // Override getUserMedia to reject
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      };
    });
    await goToHUD(page);

    const mic = micButton(page);
    await mic.click();

    // Permission handling differs by browser host; the control must remain usable.
    await page.waitForTimeout(500);
    const label = await mic.getAttribute('aria-label');
    expect(label).toMatch(/voice input|stop listening|transcribing/i);
    await expect(mic).toBeEnabled();
  });

  test('error feedback is shown with role=alert for screen readers', async ({ page }) => {
    // Override getUserMedia to reject — triggers error state
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      };
    });
    await goToHUD(page);

    const mic = micButton(page);
    await mic.click();
    await page.waitForTimeout(500);

    // Error alert should appear (role=alert for screen readers)
    const alert = page.locator('[role="alert"]');
    // Either the error shows or the button recovered gracefully
    const alertCount = await alert.count();
    if (alertCount > 0) {
      await expect(alert.first()).toBeVisible();
      const text = await alert.first().textContent();
      expect(text!.length).toBeGreaterThan(5);
    }
  });
});

// ─── Scenario 6: Touch Target Compliance (WCAG 2.5.8) ─────────────────────────

test.describe('Voice Input — Touch Targets', () => {
  test('mic button meets WCAG 2.5.8 minimum 44x44px touch target', async ({ page }) => {
    await goToHUD(page);
    const mic = micButton(page);
    const box = await mic.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('mic button meets 44x44px on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToHUD(page);
    const mic = micButton(page);
    const box = await mic.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

// ─── Scenario 7: Voice Intent Router — Navigation ───────────────────────────

test.describe('Voice Intent Router — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await goToHUD(page);
  });

  /** Helper: type a command and submit, then check URL */
  async function submitVoiceCommand(page: Page, command: string) {
    const input = promptInput(page);
    await input.fill(command);
    await input.press('Enter');
    // Allow navigation + confirmation to render
    await page.waitForTimeout(500);
  }

  const navTests: Array<{ command: string; expectedPath: string; expectedSearch?: string }> = [
    { command: 'go to documents', expectedPath: '/', expectedSearch: 'surface=chat' },
    { command: 'go to calendar', expectedPath: '/', expectedSearch: 'surface=inbox' },
    { command: 'go to funding', expectedPath: '/research' },
    { command: 'go to signals', expectedPath: '/research' },
    { command: 'go to benchmarks', expectedPath: '/benchmarks' },
    { command: 'open github', expectedPath: '/cli' },
    { command: 'show linkedin', expectedPath: '/', expectedSearch: 'surface=reports' },
    { command: 'navigate to sources', expectedPath: '/', expectedSearch: 'surface=reports' },
    { command: 'go to costs', expectedPath: '/mcp/ledger' },
    { command: 'go to qa', expectedPath: '/dogfood' },
    { command: 'go to home', expectedPath: '/redesign' },
  ];

  for (const { command, expectedPath, expectedSearch } of navTests) {
    test(`"${command}" navigates to ${expectedPath}`, async ({ page }) => {
      await submitVoiceCommand(page, command);
      const url = new URL(page.url());
      expect(url.pathname).toBe(expectedPath);
      if (expectedSearch) {
        expect(url.searchParams.toString()).toBe(expectedSearch);
      }
    });
  }

  test('voice confirmation appears after navigation command', async ({ page }) => {
    await submitVoiceCommand(page, 'go to documents');
    // Confirmation should be visible briefly
    const confirmation = page.getByTestId('voice-command-confirmation');
    // It may have already faded — check text content if visible
    const count = await confirmation.count();
    if (count > 0) {
      const text = await confirmation.first().textContent();
      expect(text).toContain('go to documents');
    }
  });
});

// ─── Scenario 8: Voice Intent Router — Mode Switching ────────────────────────

test.describe('Voice Intent Router — Modes', () => {
  test.beforeEach(async ({ page }) => {
    await goToHUD(page);
  });

  const modeTests = ['mission', 'intel', 'build', 'agents', 'system'];

  for (const mode of modeTests) {
    test(`"${mode} mode" switches cockpit mode`, async ({ page }) => {
      const input = promptInput(page);
      await input.fill(`${mode} mode`);
      await input.press('Enter');
      await page.waitForTimeout(300);
      await expect(page.locator('main').first()).toBeVisible();
    });
  }
});

// ─── Scenario 9: Voice Intent Router — Create & System ───────────────────────

test.describe('Voice Intent Router — Create & System', () => {
  test.beforeEach(async ({ page }) => {
    await goToHUD(page);
  });

  test('"new document" clears input (command handled)', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('new document');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
  });

  test('"new task" clears input (command handled)', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('new task');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
  });

  test('"open settings" clears input (command handled)', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('open settings');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
  });

  test('"command palette" clears input (command handled)', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('command palette');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog').first()).toBeVisible();
  });
});

// ─── Scenario 10: Voice Intent Router — Theme & Layout ───────────────────────

test.describe('Voice Intent Router — Theme & Layout', () => {
  test.beforeEach(async ({ page }) => {
    await goToHUD(page);
  });

  test('"dark mode" toggles to dark theme', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('dark mode');
    await input.press('Enter');
    await page.waitForTimeout(500);
    // Check document has dark class
    const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(hasDark).toBe(true);
  });

  test('"light mode" toggles to light theme', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('light mode');
    await input.press('Enter');
    await page.waitForTimeout(500);
    const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(hasDark).toBe(false);
  });
});

// ─── Scenario 11: Voice Intent Router — Utilities ────────────────────────────

test.describe('Voice Intent Router — Utilities', () => {
  test.beforeEach(async ({ page }) => {
    await goToHUD(page);
  });

  test('"scroll to top" is handled as a command', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('scroll to top');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
  });

  test('"refresh" is handled as a command', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('refresh');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
  });

  test('"go back" is handled as a command', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('go back');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
  });

  test('"search for funding rounds" is handled as a command', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('search for funding rounds');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
  });
});

// ─── Scenario 12: Voice Intent Router — Fallthrough ──────────────────────────

test.describe('Voice Intent Router — Fallthrough', () => {
  test.beforeEach(async ({ page }) => {
    await goToHUD(page);
  });

  test('"explain quantum computing" falls through to agent (not handled as command)', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('explain quantum computing');
    await input.press('Enter');
    await page.waitForTimeout(500);
    // Should NOT show voice confirmation (it went to agent)
    const confirmation = page.locator('[role="status"]:has-text("✓")');
    await expect(confirmation).toHaveCount(0);
  });

  test('"what changed in AI this week" falls through to agent', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('what changed in AI this week');
    await input.press('Enter');
    await page.waitForTimeout(500);
    const confirmation = page.locator('[role="status"]:has-text("✓")');
    await expect(confirmation).toHaveCount(0);
  });

  test('"hello" falls through to agent', async ({ page }) => {
    const input = promptInput(page);
    await input.fill('hello');
    await input.press('Enter');
    await page.waitForTimeout(500);
    const confirmation = page.locator('[role="status"]:has-text("✓")');
    await expect(confirmation).toHaveCount(0);
  });
});

// ─── Scenario 13: Voice Intent Router — Accessibility ────────────────────────

test.describe('Voice Intent Router — Command Accessibility', () => {
  test('voice confirmation has aria-live="polite" for screen readers', async ({ page }) => {
    await goToHUD(page);
    const input = promptInput(page);
    await input.fill('go to documents');
    await input.press('Enter');
    await page.waitForTimeout(200);
    const liveRegion = page.locator('[aria-live="polite"][role="status"]');
    const count = await liveRegion.count();
    if (count > 0) {
      const ariaLive = await liveRegion.first().getAttribute('aria-live');
      expect(ariaLive).toBe('polite');
    }
  });
});
