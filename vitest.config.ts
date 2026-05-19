import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const toPosix = (p: string) => p.replace(/\\/g, "/");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@features", replacement: toPosix(path.resolve(__dirname, "./src/features")) },
      { find: "@shared", replacement: toPosix(path.resolve(__dirname, "./src/shared")) },
      { find: /^@\//, replacement: `${toPosix(path.resolve(__dirname, "./src"))}/` },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Playwright tests live under `tests/` and should run via Playwright, not Vitest.
    exclude: [
      ...configDefaults.exclude,
      "tests/**",
      ".tmp/**",
      ".nodebench-ref/**",
      ".overstory/**",
      ".claude/worktrees/**",
      ".worktrees/**",
    ],
  },
});
