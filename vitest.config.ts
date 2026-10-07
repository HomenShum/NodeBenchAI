import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const toPosix = (p: string) => p.replace(/\\/g, "/");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@convex", replacement: toPosix(path.resolve(__dirname, "./backend/convex")) },
      { find: "@features", replacement: toPosix(path.resolve(__dirname, "./apps/web/src/features")) },
      { find: "@shared", replacement: toPosix(path.resolve(__dirname, "./apps/web/src/shared")) },
      { find: /^@\//, replacement: `${toPosix(path.resolve(__dirname, "./apps/web/src"))}/` },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./apps/web/src/test/setup.ts"],
    // Playwright tests live under `tests/` and should run via Playwright, not Vitest.
    exclude: [
      ...configDefaults.exclude,
      "evals/**",
      ".tmp/**",
      ".nodebench-ref/**",
      ".overstory/**",
      ".claude/worktrees/**",
      ".worktrees/**",
    ],
  },
});
