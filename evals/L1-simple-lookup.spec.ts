import { test, expect, Page } from "@playwright/test";

/**
 * Level 1: Simple Lookup Tests
 *
 * Updated for new Home Hub UI with Fast Agent Panel.
 * These tests verify UI functionality without requiring actual LLM responses.
 *
 * Complexity: Basic
 * Goal: Verify Fast Agent Panel opens and accepts input correctly
 */

const BASE_URL = "http://localhost:5173";

test.describe("L1 - Simple Lookup", () => {
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

  test("Fast Agent Panel opens from home page", async () => {
    // Wait for the page to be fully loaded - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Verify the Fast Agent toggle button exists using getByRole
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });

    // Click to open panel
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Verify panel opened - should show "New Chat" header
    const newChatButton = page.getByRole('button', { name: /New Chat/i });
    await expect(newChatButton).toBeVisible({ timeout: 5000 });

    console.log('✅ L1 Fast Agent Panel opened successfully');
  });

  test("Fast Agent Panel has input field and send button", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Open panel
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Verify input field exists using role
    const inputField = page.getByRole('textbox', { name: /Ask anything/i });
    await expect(inputField).toBeVisible({ timeout: 5000 });

    // Verify send button exists (may be disabled initially)
    const sendButton = page.getByRole('button', { name: /Send message/i });
    await expect(sendButton).toBeVisible({ timeout: 5000 });

    console.log('✅ L1 Input field and send button verified');
  });

  test("Fast Agent Panel accepts input text", async () => {
    // Wait for page to load - use getByRole for heading
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 15000 });

    // Open panel
    const fastAgentButton = page.getByRole('button', { name: /Toggle Fast Agent Panel|Fast Agent/i });
    await expect(fastAgentButton).toBeVisible({ timeout: 10000 });
    await fastAgentButton.click();
    await page.waitForTimeout(500);

    // Fill input
    const inputField = page.getByRole('textbox', { name: /Ask anything/i });
    await expect(inputField).toBeVisible({ timeout: 5000 });
    await inputField.fill("What is OpenAI?");

    // Verify input has the text
    await expect(inputField).toHaveValue("What is OpenAI?");

    // Verify send button is now enabled (not disabled)
    const sendButton = page.getByRole('button', { name: /Send message/i });
    await expect(sendButton).not.toBeDisabled({ timeout: 3000 });

    console.log('✅ L1 Input accepts text and enables send button');
  });
});
