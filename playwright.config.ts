import { defineConfig, devices } from "@playwright/test";

const htmlReporterOutputFolder = process.env.PLAYWRIGHT_HTML_OUTPUT_FOLDER;
const jsonReporterOutputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
const baseURL = process.env.BASE_URL || "http://localhost:5173";
const nonemptyBypassSecret =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

const reporter = [
  ...(htmlReporterOutputFolder === "off"
    ? []
    : [
        [
          "html",
          { outputFolder: htmlReporterOutputFolder || "playwright-report" },
        ] as const,
      ]),
  ["list"] as const,
  ...(jsonReporterOutputFile === "off"
    ? []
    : [
        [
          "json",
          { outputFile: jsonReporterOutputFile || "test-results.json" },
        ] as const,
      ]),
];

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30 * 1000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter,
  use: {
    baseURL,
    // Playwright traces include request metadata. Never persist a trace while
    // the protected-preview secret is attached to origin-scoped requests.
    trace: nonemptyBypassSecret ? "off" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  // NOTE: Tests expect dev server to be running manually
  // Run `npm run dev` in a separate terminal before running tests
});
