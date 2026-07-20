# E2E Testing with Agent Browser CLI

Automated end-to-end testing for the analytics integration using Playwright and Agent Browser CLI.

## Quick Start

### Install Dependencies
```bash
npm install
npx playwright install chromium
```

### Run Tests
```bash
# Run all tests (headless)
npm run test:e2e

# Run tests with UI (recommended for development)
npm run test:e2e:ui

# Run tests in headed mode (see browser)
npm run test:e2e:headed

# Debug specific test
npm run test:e2e:debug

# View test report
npm run test:e2e:report
```

## Test Suites

### Analytics Dashboards Integration (`analytics-dashboards.spec.ts`)

**Coverage:**
- ✅ HITL Analytics Dashboard routing and rendering
- ✅ Component Metrics Dashboard routing and rendering
- ✅ Recommendation Feedback Dashboard routing and rendering
- ✅ Navigation flow between all dashboards
- ✅ Console error detection
- ✅ Lazy loading performance validation

**Skipped (Requires Auth):**
- ⚠️ Persona tracking end-to-end flows
- ⚠️ Security audit logging validation

### Current Status

**Implemented:** 6 automated tests for unauthenticated flows
**Pending:** 3 tests requiring authentication setup

## Test Structure

```
tests/
├── e2e/
│   └── analytics-dashboards.spec.ts    # Main dashboard tests
├── screenshots/                         # Visual regression artifacts
└── README.md                            # This file
```

## Writing New Tests

Example test using Playwright:

```typescript
test('My Feature Test', async ({ page }) => {
  // Navigate
  await page.goto('http://localhost:3000/#my-route');

  // Verify
  const title = await page.locator('h1').first();
  await expect(title).toContainText('Expected Title');

  // Take screenshot
  await page.screenshot({ path: 'tests/screenshots/my-feature.png' });
});
```

## Performance Thresholds

- Dashboard lazy load: < 3 seconds
- Page navigation: < 2 seconds
- Console errors: 0 critical errors

## CI/CD Integration

Add to your CI workflow:

```yaml
- name: Run E2E Tests
  run: npm run test:e2e

- name: Upload test artifacts
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Debugging

### View Test Trace
```bash
npx playwright show-trace test-results/path-to-trace.zip
```

### Run Single Test
```bash
npx playwright test --grep "HITL Analytics"
```

### Update Snapshots
```bash
npx playwright test --update-snapshots
```

## Authentication Setup (TODO)

To enable auth-required tests:

1. Create test user credentials in `.env.test`:
   ```
   TEST_USER_EMAIL=test@example.com
   TEST_USER_PASSWORD=testpassword123
   ```

2. Add login helper in `tests/helpers/auth.ts`

3. Update `beforeEach` hook to login when needed

4. Remove `.skip` from auth-required tests

## Agent Browser CLI Integration

The Agent Browser CLI provides:
- 95% first-try task completion (vs 75-80% for traditional tools)
- Deterministic element references (@e1, @e2)
- Snapshot-based navigation

**Example usage:**
```typescript
// Traditional Playwright (flaky)
await page.click('button:has-text("Submit")');

// Agent Browser approach (reliable)
const snapshot = await page.snapshot();
// Returns: @e1 = Submit button
await page.click('@e1');
```

## Resources

- [Playwright Docs](https://playwright.dev/)
- [Agent Browser CLI GitHub](https://github.com/vercel-labs/agent-browser)
- [Vercel Blog - Tool Reduction Research](https://vercel.com/blog/we-removed-80...)

---

**Last Updated:** 2026-01-22
**Test Coverage:** Analytics Dashboards (100% unauthenticated flows)
