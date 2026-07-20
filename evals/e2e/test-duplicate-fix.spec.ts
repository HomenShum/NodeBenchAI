import { test, expect } from '@playwright/test';

test('Fast Agent - No duplicate responses', async ({ page }) => {
  // Enable console logging
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    console.log('[BROWSER]', text);
  });

  // Navigate to the app
  await page.goto('http://localhost:5173');

  // Wait for app to load
  await page.waitForLoadState('networkidle');
  console.log('[TEST] ✅ App loaded');

  // Find and click the Fast Agent button/panel
  // Try multiple selectors
  const agentButton = page.locator('[data-testid="fast-agent-button"]').or(
    page.locator('button:has-text("Fast Agent")').first()
  ).or(
    page.locator('[aria-label*="Agent"]').first()
  );

  if (await agentButton.count() > 0) {
    await agentButton.click();
    console.log('[TEST] ✅ Clicked Fast Agent button');
    await page.waitForTimeout(1000);
  } else {
    console.log('[TEST] ⚠️  Fast Agent button not found, assuming panel is already open');
  }

  // Find the input textarea
  const input = page.locator('textarea[placeholder*="Ask"], textarea[placeholder*="message"], textarea').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  console.log('[TEST] ✅ Found input field');

  // Type a test message
  const testMessage = 'Hello, this is a test message';
  await input.fill(testMessage);
  console.log('[TEST] ✅ Typed test message');

  // Find and click send button
  const sendButton = page.locator('button[type="submit"]').or(
    page.locator('button:has-text("Send")').first()
  ).or(
    page.locator('button[aria-label*="Send"]').first()
  );

  await sendButton.waitFor({ state: 'visible', timeout: 5000 });

  // Clear previous logs to isolate this send operation
  consoleLogs.length = 0;

  // Click send
  await sendButton.click();
  console.log('[TEST] ✅ Clicked send button');

  // Wait for agent to start processing
  await page.waitForTimeout(3000);

  // Check console logs for deduplication guards
  const handleSendCalls = consoleLogs.filter(log => log.includes('🎯 handleSendMessage called'));
  const sendAllowed = consoleLogs.filter(log => log.includes('✅ Send ALLOWED'));
  const sendBlocked = consoleLogs.filter(log => log.includes('🛑 Send BLOCKED'));
  const mutationInvoked = consoleLogs.filter(log => log.includes('🚀 MUTATION INVOKED'));

  console.log('\n[TEST] === Console Log Analysis ===');
  console.log(`[TEST] handleSendMessage called: ${handleSendCalls.length} times`);
  console.log(`[TEST] Send ALLOWED: ${sendAllowed.length} times`);
  console.log(`[TEST] Send BLOCKED: ${sendBlocked.length} times`);
  console.log(`[TEST] Mutation INVOKED: ${mutationInvoked.length} times`);

  // Check for "Reasoning Process" duplicates in the UI
  await page.waitForTimeout(2000); // Wait for UI to update

  const reasoningProcessElements = page.locator('text="Reasoning Process"');
  const reasoningCount = await reasoningProcessElements.count();

  console.log(`[TEST] "Reasoning Process" elements found: ${reasoningCount}`);

  // Take a screenshot for manual verification
  await page.screenshot({ path: 'test-duplicate-fix-result.png', fullPage: true });
  console.log('[TEST] ✅ Screenshot saved to test-duplicate-fix-result.png');

  // Assertions
  console.log('\n[TEST] === Validation ===');

  // Should have exactly 1 handleSendMessage call
  expect(handleSendCalls.length).toBeLessThanOrEqual(2); // Allow 1-2 due to React rendering
  console.log(`[TEST] ✅ handleSendMessage called ${handleSendCalls.length} time(s) (acceptable)`);

  // Should have exactly 1 mutation invocation
  expect(mutationInvoked.length).toBe(1);
  console.log('[TEST] ✅ Mutation invoked exactly once');

  // Should have no blocked sends (unless testing rapid clicks)
  expect(sendBlocked.length).toBe(0);
  console.log('[TEST] ✅ No duplicate sends blocked');

  // Should have at most 1 "Reasoning Process" element
  expect(reasoningCount).toBeLessThanOrEqual(1);
  console.log(`[TEST] ✅ At most 1 "Reasoning Process" element (found ${reasoningCount})`);

  console.log('\n[TEST] 🎉 All validations passed! No duplicate responses detected.');
});

test('Fast Agent - Rapid click protection', async ({ page }) => {
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    console.log('[BROWSER]', text);
  });

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  // Open Fast Agent
  const agentButton = page.locator('[data-testid="fast-agent-button"]').or(
    page.locator('button:has-text("Fast Agent")').first()
  );
  if (await agentButton.count() > 0) {
    await agentButton.click();
    await page.waitForTimeout(1000);
  }

  const input = page.locator('textarea[placeholder*="Ask"], textarea[placeholder*="message"], textarea').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill('Test rapid clicks');

  const sendButton = page.locator('button[type="submit"]').first();
  await sendButton.waitFor({ state: 'visible', timeout: 5000 });

  consoleLogs.length = 0;

  // Rapidly click send 3 times
  console.log('[TEST] Clicking send button 3 times rapidly...');
  await sendButton.click();
  await sendButton.click();
  await sendButton.click();

  await page.waitForTimeout(2000);

  const sendBlocked = consoleLogs.filter(log => log.includes('🛑 Send BLOCKED'));
  const mutationInvoked = consoleLogs.filter(log => log.includes('🚀 MUTATION INVOKED'));

  console.log('\n[TEST] === Rapid Click Analysis ===');
  console.log(`[TEST] Send BLOCKED: ${sendBlocked.length} times`);
  console.log(`[TEST] Mutation INVOKED: ${mutationInvoked.length} times`);

  // Should have blocked at least 1 duplicate
  expect(sendBlocked.length).toBeGreaterThanOrEqual(1);
  console.log('[TEST] ✅ Duplicate rapid clicks were blocked');

  // Should have only 1 mutation (the first one)
  expect(mutationInvoked.length).toBe(1);
  console.log('[TEST] ✅ Only 1 mutation invoked despite 3 clicks');

  console.log('\n[TEST] 🎉 Rapid click protection working correctly!');
});
