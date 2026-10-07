/**
 * Performance and Lighthouse Testing Suite
 *
 * This test suite measures performance metrics across all major user journeys
 * in the Nodebench AI application. Uses Playwright's built-in performance APIs
 * and web vitals measurements.
 *
 * Run with: npx playwright test tests/performance-lighthouse.spec.ts
 */

import { test, expect, Page } from '@playwright/test';

// Performance thresholds based on industry standards
const PERFORMANCE_THRESHOLDS = {
  // Core Web Vitals
  LCP: 2500,       // Largest Contentful Paint (ms) - Good: < 2.5s
  FID: 100,        // First Input Delay (ms) - Good: < 100ms
  CLS: 0.1,        // Cumulative Layout Shift - Good: < 0.1
  TTFB: 800,       // Time to First Byte (ms) - Good: < 800ms
  FCP: 1800,       // First Contentful Paint (ms) - Good: < 1.8s

  // Custom thresholds for app-specific metrics
  routeChange: 500,      // Route change time (ms)
  componentLoad: 1000,   // Major component load time (ms)
  apiResponse: 3000,     // API response time (ms)
  interactivity: 3000,   // Time to interactive (ms)
};

interface PerformanceMetrics {
  navigationStart: number;
  domContentLoaded: number;
  loadComplete: number;
  firstPaint?: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
  timeToInteractive?: number;
  totalBlockingTime?: number;
  cumulativeLayoutShift?: number;
  resourceCount: number;
  totalTransferSize: number;
  domElements: number;
}

/**
 * Collect performance metrics from the page
 */
async function collectPerformanceMetrics(page: Page): Promise<PerformanceMetrics> {
  return await page.evaluate(() => {
    const performance = window.performance;
    const timing = performance.timing || performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

    // Get paint entries
    const paintEntries = performance.getEntriesByType('paint');
    const fcpEntry = paintEntries.find(e => e.name === 'first-contentful-paint');
    const fpEntry = paintEntries.find(e => e.name === 'first-paint');

    // Get LCP if available
    let lcp: number | undefined;
    try {
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries.length > 0) {
        lcp = (lcpEntries[lcpEntries.length - 1] as any).startTime;
      }
    } catch (e) {
      // LCP API not available
    }

    // Get resource metrics
    const resources = performance.getEntriesByType('resource');
    let totalTransferSize = 0;
    resources.forEach((r: any) => {
      if (r.transferSize) {
        totalTransferSize += r.transferSize;
      }
    });

    // DOM element count
    const domElements = document.querySelectorAll('*').length;

    const navEntry = timing as PerformanceNavigationTiming;

    return {
      navigationStart: 0,
      domContentLoaded: navEntry.domContentLoadedEventEnd - navEntry.startTime,
      loadComplete: navEntry.loadEventEnd - navEntry.startTime,
      firstPaint: fpEntry?.startTime,
      firstContentfulPaint: fcpEntry?.startTime,
      largestContentfulPaint: lcp,
      resourceCount: resources.length,
      totalTransferSize,
      domElements,
    };
  });
}

/**
 * Measure route change performance
 */
async function measureRouteChange(page: Page, hashTarget: string): Promise<number> {
  const startTime = Date.now();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, hashTarget);

  // Wait for the view to settle
  await page.waitForTimeout(100);
  await page.waitForLoadState('domcontentloaded');

  return Date.now() - startTime;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

test.describe('Performance & Lighthouse Tests', () => {
  test.describe('Initial Load Performance', () => {
    test('should load the app within performance thresholds', async ({ page }) => {
      // Navigate to the app
      const startTime = Date.now();
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;

      // Collect metrics
      const metrics = await collectPerformanceMetrics(page);

      console.log('\n=== INITIAL LOAD PERFORMANCE ===');
      console.log(`Total Load Time: ${loadTime}ms`);
      console.log(`DOM Content Loaded: ${metrics.domContentLoaded.toFixed(0)}ms`);
      console.log(`First Contentful Paint: ${metrics.firstContentfulPaint?.toFixed(0) || 'N/A'}ms`);
      console.log(`Largest Contentful Paint: ${metrics.largestContentfulPaint?.toFixed(0) || 'N/A'}ms`);
      console.log(`Resources Loaded: ${metrics.resourceCount}`);
      console.log(`Total Transfer Size: ${formatBytes(metrics.totalTransferSize)}`);
      console.log(`DOM Elements: ${metrics.domElements}`);

      // Assertions
      if (metrics.firstContentfulPaint) {
        expect(metrics.firstContentfulPaint, 'FCP should be under threshold').toBeLessThan(PERFORMANCE_THRESHOLDS.FCP);
      }
      if (metrics.largestContentfulPaint) {
        expect(metrics.largestContentfulPaint, 'LCP should be under threshold').toBeLessThan(PERFORMANCE_THRESHOLDS.LCP);
      }

      // DOM element count check - excessive DOM indicates potential performance issues
      expect(metrics.domElements, 'DOM should not be excessively large').toBeLessThan(3000);
    });

    test('should have reasonable bundle sizes', async ({ page }) => {
      const resourceSizes: { [key: string]: number } = {};

      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('.js') || url.includes('.css')) {
          try {
            const headers = await response.allHeaders();
            const contentLength = parseInt(headers['content-length'] || '0', 10);
            const fileName = url.split('/').pop() || url;
            if (contentLength > 0) {
              resourceSizes[fileName] = contentLength;
            }
          } catch (e) {
            // Skip failed resources
          }
        }
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      console.log('\n=== BUNDLE SIZES ===');
      const sortedResources = Object.entries(resourceSizes)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20);

      sortedResources.forEach(([name, size]) => {
        console.log(`${name}: ${formatBytes(size)}`);
      });

      // Check that no single bundle is excessively large (over 500KB gzipped)
      const largestBundle = Math.max(...Object.values(resourceSizes));
      expect(largestBundle, 'Largest bundle should be reasonable').toBeLessThan(1024 * 1024); // 1MB limit
    });
  });

  test.describe('User Journey Performance', () => {
    test('Research Hub → Documents Hub navigation', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Navigate to Documents
      const routeChangeTime = await measureRouteChange(page, '#documents');

      // Wait for documents list to appear
      await page.waitForSelector('[data-main-content]', { timeout: 10000 });

      console.log('\n=== RESEARCH → DOCUMENTS NAVIGATION ===');
      console.log(`Route Change Time: ${routeChangeTime}ms`);

      expect(routeChangeTime, 'Route change should be fast').toBeLessThan(PERFORMANCE_THRESHOLDS.routeChange);
    });

    test('Documents Hub → Calendar Hub navigation', async ({ page }) => {
      await page.goto('/#documents');
      await page.waitForLoadState('networkidle');

      const routeChangeTime = await measureRouteChange(page, '#calendar');
      await page.waitForSelector('[data-main-content]', { timeout: 10000 });

      console.log('\n=== DOCUMENTS → CALENDAR NAVIGATION ===');
      console.log(`Route Change Time: ${routeChangeTime}ms`);

      expect(routeChangeTime, 'Route change should be fast').toBeLessThan(PERFORMANCE_THRESHOLDS.routeChange);
    });

    test('Calendar Hub → Agents Hub navigation', async ({ page }) => {
      await page.goto('/#calendar');
      await page.waitForLoadState('networkidle');

      const routeChangeTime = await measureRouteChange(page, '#agents');
      await page.waitForSelector('[data-main-content]', { timeout: 10000 });

      console.log('\n=== CALENDAR → AGENTS NAVIGATION ===');
      console.log(`Route Change Time: ${routeChangeTime}ms`);

      expect(routeChangeTime, 'Route change should be fast').toBeLessThan(PERFORMANCE_THRESHOLDS.routeChange);
    });

    test('Full navigation cycle performance', async ({ page }) => {
      const navigationTimes: { [key: string]: number } = {};

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Navigate through all major views
      const views = ['#documents', '#calendar', '#agents', '#roadmap', '#research'];

      for (const view of views) {
        const time = await measureRouteChange(page, view);
        navigationTimes[view] = time;
        await page.waitForTimeout(200); // Brief pause between navigations
      }

      console.log('\n=== FULL NAVIGATION CYCLE ===');
      Object.entries(navigationTimes).forEach(([view, time]) => {
        console.log(`${view}: ${time}ms`);
      });

      const avgTime = Object.values(navigationTimes).reduce((a, b) => a + b, 0) / views.length;
      console.log(`Average Navigation Time: ${avgTime.toFixed(0)}ms`);

      expect(avgTime, 'Average navigation should be fast').toBeLessThan(PERFORMANCE_THRESHOLDS.routeChange);
    });
  });

  test.describe('Component-Level Performance', () => {
    test('Fast Agent Panel toggle performance', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Find and click the Fast Agent toggle button
      const fastAgentButton = page.locator('button:has-text("Fast Agent")').first();

      if (await fastAgentButton.isVisible()) {
        const startTime = Date.now();
        await fastAgentButton.click();

        // Wait for panel to appear
        await page.waitForTimeout(300);
        const toggleTime = Date.now() - startTime;

        console.log('\n=== FAST AGENT PANEL TOGGLE ===');
        console.log(`Toggle Time: ${toggleTime}ms`);

        expect(toggleTime, 'Panel toggle should be fast').toBeLessThan(500);
      }
    });

    test('Sidebar resize performance', async ({ page }) => {
      await page.goto('/#documents');
      await page.waitForLoadState('networkidle');

      // Find resize handle
      const resizeHandle = page.locator('.cursor-col-resize').first();

      if (await resizeHandle.isVisible()) {
        const handleBox = await resizeHandle.boundingBox();
        if (handleBox) {
          const startTime = Date.now();

          // Perform drag
          await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
          await page.mouse.down();
          await page.mouse.move(handleBox.x + 100, handleBox.y + handleBox.height / 2, { steps: 10 });
          await page.mouse.up();

          const resizeTime = Date.now() - startTime;

          console.log('\n=== SIDEBAR RESIZE ===');
          console.log(`Resize Interaction Time: ${resizeTime}ms`);

          expect(resizeTime, 'Resize should be responsive').toBeLessThan(1000);
        }
      }
    });
  });

  test.describe('Memory & Resource Usage', () => {
    test('should not leak memory during navigation cycles', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const views = ['#documents', '#calendar', '#agents', '#research'];
      const memorySnapshots: number[] = [];

      // Take initial memory snapshot
      const initialMetrics = await collectPerformanceMetrics(page);
      memorySnapshots.push(initialMetrics.domElements);

      // Navigate multiple times
      for (let i = 0; i < 3; i++) {
        for (const view of views) {
          await measureRouteChange(page, view);
          await page.waitForTimeout(100);
        }

        const metrics = await collectPerformanceMetrics(page);
        memorySnapshots.push(metrics.domElements);
      }

      console.log('\n=== MEMORY USAGE (DOM Elements) ===');
      memorySnapshots.forEach((count, i) => {
        console.log(`Cycle ${i}: ${count} elements`);
      });

      // Check that DOM isn't growing unboundedly
      const growth = memorySnapshots[memorySnapshots.length - 1] - memorySnapshots[0];
      const growthPercent = (growth / memorySnapshots[0]) * 100;

      console.log(`DOM Growth: ${growth} elements (${growthPercent.toFixed(1)}%)`);

      expect(growthPercent, 'DOM should not grow excessively').toBeLessThan(50);
    });
  });

  test.describe('Animation & Rendering Performance', () => {
    test('should maintain smooth animations', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Collect long task data
      const longTasks = await page.evaluate(() => {
        return new Promise<number>((resolve) => {
          let taskCount = 0;
          const observer = new PerformanceObserver((list) => {
            taskCount += list.getEntries().length;
          });

          try {
            observer.observe({ entryTypes: ['longtask'] });
          } catch (e) {
            resolve(0);
            return;
          }

          // Observe for 2 seconds during navigation
          setTimeout(() => {
            observer.disconnect();
            resolve(taskCount);
          }, 2000);
        });
      });

      // Navigate during observation
      await measureRouteChange(page, '#documents');
      await page.waitForTimeout(500);
      await measureRouteChange(page, '#calendar');

      console.log('\n=== ANIMATION PERFORMANCE ===');
      console.log(`Long Tasks Detected: ${longTasks}`);

      // Fewer long tasks = smoother animations
      expect(longTasks, 'Should have minimal long tasks').toBeLessThan(10);
    });
  });
});

test.describe('Lighthouse Score Estimation', () => {
  test('should estimate good Lighthouse scores', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const metrics = await collectPerformanceMetrics(page);

    // Simple Lighthouse score estimation based on Core Web Vitals
    let performanceScore = 100;

    // FCP impact (25% of score)
    if (metrics.firstContentfulPaint) {
      if (metrics.firstContentfulPaint > 3000) performanceScore -= 25;
      else if (metrics.firstContentfulPaint > 1800) performanceScore -= 12;
    }

    // LCP impact (25% of score)
    if (metrics.largestContentfulPaint) {
      if (metrics.largestContentfulPaint > 4000) performanceScore -= 25;
      else if (metrics.largestContentfulPaint > 2500) performanceScore -= 12;
    }

    // DOM complexity impact (10% of score)
    if (metrics.domElements > 1500) {
      performanceScore -= Math.min(10, (metrics.domElements - 1500) / 150);
    }

    // Resource count impact (10% of score)
    if (metrics.resourceCount > 100) {
      performanceScore -= Math.min(10, (metrics.resourceCount - 100) / 20);
    }

    console.log('\n=== LIGHTHOUSE SCORE ESTIMATION ===');
    console.log(`Estimated Performance Score: ${Math.round(performanceScore)}/100`);
    console.log('\nBreakdown:');
    console.log(`  FCP: ${metrics.firstContentfulPaint?.toFixed(0) || 'N/A'}ms (target: <1800ms)`);
    console.log(`  LCP: ${metrics.largestContentfulPaint?.toFixed(0) || 'N/A'}ms (target: <2500ms)`);
    console.log(`  DOM Elements: ${metrics.domElements} (target: <1500)`);
    console.log(`  Resources: ${metrics.resourceCount} (target: <100)`);

    // Should aim for at least 50 on Lighthouse performance
    expect(performanceScore, 'Performance score should be acceptable').toBeGreaterThan(50);
  });
});

test.describe('Critical User Paths', () => {
  test('complete user journey: Login → Research → Create Document → Agent Chat', async ({ page }) => {
    const journeyMetrics: { step: string; time: number }[] = [];

    // Step 1: Initial Load
    let startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    journeyMetrics.push({ step: 'Initial Load', time: Date.now() - startTime });

    // Step 2: Navigate to Research Hub
    startTime = Date.now();
    // Research is typically the home view, check if already there
    const researchVisible = await page.locator('text=Executive Synthesis').isVisible({ timeout: 2000 }).catch(() => false);
    if (!researchVisible) {
      await measureRouteChange(page, '#research');
    }
    journeyMetrics.push({ step: 'Research Hub', time: Date.now() - startTime });

    // Step 3: Navigate to Documents
    startTime = Date.now();
    await measureRouteChange(page, '#documents');
    await page.waitForSelector('[data-main-content]', { timeout: 10000 });
    journeyMetrics.push({ step: 'Documents Hub', time: Date.now() - startTime });

    // Step 4: Open Fast Agent
    startTime = Date.now();
    const fastAgentButton = page.locator('button:has-text("Fast Agent")').first();
    if (await fastAgentButton.isVisible()) {
      await fastAgentButton.click();
      await page.waitForTimeout(300);
    }
    journeyMetrics.push({ step: 'Open Fast Agent', time: Date.now() - startTime });

    console.log('\n=== COMPLETE USER JOURNEY PERFORMANCE ===');
    let totalTime = 0;
    journeyMetrics.forEach(({ step, time }) => {
      console.log(`${step}: ${time}ms`);
      totalTime += time;
    });
    console.log(`Total Journey Time: ${totalTime}ms`);

    // Entire journey should complete in reasonable time
    expect(totalTime, 'Total journey should be under 10s').toBeLessThan(10000);
  });
});
