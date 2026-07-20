#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC_DIR = path.join(ROOT, "apps", "web", "src");

const FILE_IGNORE = [
  /node_modules/,
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /\.stories\./,
  /__tests__/,
  /\.d\.ts$/,
];

const REQUIRED_SCREEN_ATTRS = [
  "data-screen-id",
  "data-screen-title",
  "data-screen-path",
  "data-screen-state",
];

const STATIC_AGENT_ID_RE = /^[a-z0-9-]+(?::[a-z0-9-]+)+$/;

function isRouteView(relPath) {
  return /views\/.*(View|Page)\.tsx$/i.test(relPath) && !/components\/.*\/views\//i.test(relPath);
}

function isExportProxyFile(content) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"));
  return lines.length > 0 && lines.every((line) => line.startsWith("export "));
}

function getLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function addViolation(list, file, line, severity, category, label, detail) {
  list.push({ file, line, severity, category, label, detail });
}

function getInteractiveElementViolations(content, relPath) {
  const violations = [];
  const tagRegex = /<(button|a|input|textarea|select)\b[\s\S]*?>/g;
  let match;

  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1];
    const snippet = match[0];
    if (!snippet.includes("data-agent-id")) continue;
    const line = getLineNumber(content, match.index);

    if (!snippet.includes("data-agent-action")) {
      addViolation(
        violations,
        relPath,
        line,
        "high",
        "action-metadata",
        `${tag} with data-agent-id is missing data-agent-action`,
        snippet.trim(),
      );
    }

    if (!snippet.includes("data-agent-label")) {
      addViolation(
        violations,
        relPath,
        line,
        "high",
        "action-metadata",
        `${tag} with data-agent-id is missing data-agent-label`,
        snippet.trim(),
      );
    }

    const staticIdMatch = snippet.match(/data-agent-id\s*=\s*["']([^"']+)["']/);
    if (staticIdMatch && !STATIC_AGENT_ID_RE.test(staticIdMatch[1])) {
      addViolation(
        violations,
        relPath,
        line,
        "high",
        "naming",
        `Static data-agent-id does not follow naming convention: ${staticIdMatch[1]}`,
        "Use lowercase colon-separated kebab-case segments, for example chrome:action:settings",
      );
    }
  }

  return violations;
}

function getScreenRootViolations(content, relPath) {
  const violations = [];
  if (!content.includes("data-main-content")) return violations;

  for (const attr of REQUIRED_SCREEN_ATTRS) {
    if (!content.includes(attr)) {
      addViolation(
        violations,
        relPath,
        1,
        "high",
        "screen-root",
        `Screen root is missing required attribute ${attr}`,
        "Wrap the screen in AgentScreen or add the full screen root contract.",
      );
    }
  }

  return violations;
}

function getAsyncStateViolations(content, relPath) {
  const violations = [];
  if (!isRouteView(relPath)) return violations;

  const hasLoading = /ViewSkeleton|Skeleton|isLoading|loading|Suspense|data-screen-state=["']loading["']/i.test(content);
  const hasEmpty = /EmptyState|empty.?state|no.?data|no.?items|no.?results|variant=["']empty["']/i.test(content);

  if (!hasLoading) {
    addViolation(
      violations,
      relPath,
      1,
      "medium",
      "async-state",
      "Route view may be missing a loading state marker",
      "Add a loading path or ViewSkeleton/SignatureOrb loading state.",
    );
  }

  if (!hasEmpty) {
    addViolation(
      violations,
      relPath,
      1,
      "medium",
      "async-state",
      "Route view may be missing an empty state marker",
      "Add explicit empty-state handling for zero-data cases.",
    );
  }

  return violations;
}

function getModalViolations(content, relPath) {
  const violations = [];
  const isModalLikeFile = /(Modal|Dialog|Drawer)\.(tsx|jsx)$/i.test(relPath);
  if (!isModalLikeFile) return violations;

  const hasModalSemantics = /DialogOverlay|role=["']dialog["']|aria-modal=["']true["']|aria-label=/.test(content);
  if (!hasModalSemantics) {
    addViolation(
      violations,
      relPath,
      1,
      "high",
      "modal-semantics",
      "Modal-like component is missing dialog semantics",
      "Use role=\"dialog\", aria-modal, DialogOverlay, or a stable aria-label on the active root.",
    );
  }

  return violations;
}

async function scanFile(fullPath) {
  const relPath = path.relative(ROOT, fullPath).replace(/\\/g, "/");
  if (FILE_IGNORE.some((pattern) => pattern.test(relPath))) return [];
  const content = await fs.readFile(fullPath, "utf8");
  if (isExportProxyFile(content)) return [];

  return [
    ...getScreenRootViolations(content, relPath),
    ...getInteractiveElementViolations(content, relPath),
    ...getAsyncStateViolations(content, relPath),
    ...getModalViolations(content, relPath),
  ];
}

async function walk(dir, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", "__tests__"].includes(entry.name)) continue;
      await walk(fullPath, acc);
      continue;
    }
    if (!/\.(tsx|jsx)$/.test(entry.name)) continue;
    acc.push(...(await scanFile(fullPath)));
  }
  return acc;
}

function printSummary(violations) {
  const high = violations.filter((v) => v.severity === "high");
  const medium = violations.filter((v) => v.severity === "medium");

  console.log("\nAgent Native UI Linter\n");
  console.log(`Files scanned: src/`);
  console.log(`Violations: ${violations.length} (high=${high.length}, medium=${medium.length})\n`);

  for (const violation of violations.slice(0, 60)) {
    console.log(`${violation.severity.toUpperCase()} ${violation.file}:${violation.line} ${violation.label}`);
    if (violation.detail) console.log(`  ${violation.detail}`);
  }

  if (violations.length > 60) {
    console.log(`\n... ${violations.length - 60} more`);
  }
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const violations = await walk(SRC_DIR);

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ total: violations.length, violations }, null, 2) + "\n");
  } else {
    printSummary(violations);
  }

  const highCount = violations.filter((v) => v.severity === "high").length;
  process.exit(highCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
