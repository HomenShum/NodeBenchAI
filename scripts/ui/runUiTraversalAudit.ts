import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { VIEW_REGISTRY } from "../../apps/web/src/lib/registry/viewRegistry.ts";

type RouteTarget = {
  id: string;
  title: string;
  path: string;
};

type TraversalTarget = {
  traverseId: string;
  key: string;
  label: string;
  kind: string;
  tagName: string;
  role: string;
  type: string;
  href: string | null;
  targetAttr: string | null;
  disabled: boolean;
  readOnly: boolean;
};

type TraversalAction = {
  label: string;
  kind: string;
  outcome: "interacted" | "skipped-risky" | "stale" | "failed";
  detail?: string;
};

type ScopeReport = {
  name: string;
  discovered: number;
  traversed: number;
  skippedRisky: number;
  failures: TraversalAction[];
  timedOut?: boolean;
};

type RouteReport = {
  id: string;
  title: string;
  path: string;
  ok: boolean;
  scopes: ScopeReport[];
  error?: string;
};

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const [key, value] = raw.split("=", 2);
    if (value !== undefined) {
      args.set(key.slice(2), value);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key.slice(2), next);
      i += 1;
    } else {
      args.set(key.slice(2), "true");
    }
  }
  return args;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function waitForPort(host: string, port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.setTimeout(1200, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(350);
  }
  throw new Error(`Timed out waiting for server on ${host}:${port}`);
}

async function waitForHttpOk(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.status === 200) return;
    } catch {
      // ignore
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for HTTP readiness at ${url}`);
}

async function appendProgress(logPath: string, message: string) {
  await appendFile(logPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

async function findOpenPort(host: string, startPort: number, tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    const port = startPort + i;
    const ok = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, host, () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`Unable to find open port near ${startPort}`);
}

async function runShellCommand(command: string, cwd: string) {
  const child = spawn(command, {
    cwd,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
    env: { ...process.env },
  });

  return await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(Number(code ?? 0)));
  });
}

async function killProcessTree(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }

  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    sleep(7000).then(() => false),
  ]);
  if (exited) return;

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    await Promise.race([
      new Promise((resolve) => killer.once("exit", resolve)),
      sleep(7000),
    ]);
    return;
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
}

function pickRoutePath(pathName: string, aliases?: string[]) {
  if (!pathName.startsWith("/internal/")) return pathName;
  const publicAlias = (aliases ?? []).find((alias) => !alias.startsWith("/internal/"));
  return publicAlias ?? pathName;
}

function buildRoutes(): RouteTarget[] {
  const baseRoutes = VIEW_REGISTRY
    .filter((entry) => !entry.dynamic && entry.group !== "legacy")
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      path: pickRoutePath(entry.path, entry.aliases),
    }));

  const supplemented: RouteTarget[] = [
    ...baseRoutes,
    { id: "research-overview", title: "Research Overview", path: "/research/overview" },
    { id: "research-signals", title: "Research Signals", path: "/research/signals" },
    { id: "research-briefing", title: "Research Briefing", path: "/research/briefing" },
    { id: "research-deals", title: "Research Deals", path: "/research/deals" },
    { id: "research-changelog", title: "Research Changelog", path: "/research/changelog" },
  ];

  const deduped = new Map<string, RouteTarget>();
  for (const route of supplemented) {
    if (!deduped.has(route.path)) {
      deduped.set(route.path, route);
    }
  }
  return [...deduped.values()];
}

async function setTraversalTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "nodebench-theme",
      JSON.stringify({
        mode: "dark",
        accentColor: "electric-blue",
        density: "comfortable",
        fontFamily: "Manrope Studio",
        backgroundPattern: "spotlight",
        reducedMotion: true,
      }),
    );
    localStorage.setItem("theme", "dark");
  });
}

async function installTraversalHelpers(page: Page) {
  await page.addInitScript({
    content: `
      window.__nodebenchCollectTargets = (selectors, excludeGlobalNav) => {
        window.__nodebenchTraverseSequence = window.__nodebenchTraverseSequence || 0;
        const isVisible = (element) => {
          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || element.getClientRects().length === 0) return false;
          if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
          return true;
        };

        const roots = selectors
          .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
          .filter((node, index, arr) => arr.indexOf(node) === index)
          .filter((node) => isVisible(node));

        const modalRoots = Array.from(
          document.querySelectorAll("[role='dialog'], [aria-modal='true'], [aria-label='AI Chat Panel'], [aria-label='Agent Interface']"),
        ).filter((node) => isVisible(node));

        if (selectors.length > 0 && roots.length === 0 && modalRoots.length === 0) {
          return [];
        }

        const scopeRoots =
          modalRoots.length > 0
            ? [modalRoots[modalRoots.length - 1]]
            : roots.length > 0
              ? roots
              : [document.body];
        const interactiveSelector = [
          "button",
          "a[href]",
          "input",
          "textarea",
          "select",
          "[role='button']",
          "[role='tab']",
          "[role='switch']",
          "[role='checkbox']",
          "[role='radio']",
          "[contenteditable='true']",
          "[aria-haspopup='dialog']",
        ].join(", ");

        const results = [];

        for (const root of scopeRoots) {
          const elements = Array.from(root.querySelectorAll(interactiveSelector));
          for (const element of elements) {
            if (!isVisible(element)) continue;
            if (element.closest("[aria-hidden='true']")) continue;
            if (element.classList.contains("sr-only") || element.closest(".sr-only")) continue;
            if (
              excludeGlobalNav &&
              element.closest(
                "nav, header, [role='navigation'], [aria-label='Mode navigation'], [aria-label='Sub-view navigation'], [aria-label='Command bar']",
              )
            ) {
              continue;
            }

            const parts = [];
            let current = element;
            let depth = 0;
            while (current && depth < 5) {
              const parent = current.parentElement;
              const tag = current.tagName.toLowerCase();
              if (!parent) {
                parts.unshift(tag);
                break;
              }
              const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
              const index = siblings.indexOf(current) + 1;
              parts.unshift(tag + ":nth-of-type(" + index + ")");
              current = parent;
              depth += 1;
            }

            const ariaLabel = element.getAttribute("aria-label");
            const title = element.getAttribute("title");
            const placeholder = element.getAttribute("placeholder");
            const value = typeof element.value === "string" ? element.value : "";
            const text = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
            const label = (ariaLabel || title || placeholder || value || text || element.tagName.toLowerCase()).trim();
            if (!label) continue;
            if (/^skip to /i.test(label)) continue;
            const tagName = element.tagName.toLowerCase();
            const role = element.getAttribute("role") || "";
            const type = element.getAttribute("type") || "";
            const traverseId = "nb-traverse-" + window.__nodebenchTraverseSequence++;
            element.setAttribute("data-nb-traverse-id", traverseId);

            results.push({
              traverseId,
              key: [tagName, role, type, label, parts.join(" > ")].join("|"),
              label,
              kind: role || tagName,
              tagName,
              role,
              type,
              href: element.getAttribute("href"),
              targetAttr: element.getAttribute("target"),
              disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
              readOnly: element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true",
            });
          }
        }

        return results;
      };
    `,
  });
}

async function signInIfPrompted(page: Page) {
  const signInButton = page.getByRole("button", { name: /sign in anonymously|sign in/i }).first();
  if (await signInButton.count()) {
    await signInButton.click();
    await page.waitForLoadState("domcontentloaded");
  }
}

async function waitForAppReady(page: Page) {
  await page.waitForSelector("#main-content", { state: "visible", timeout: 60_000 });
  await page.waitForTimeout(250);
}

async function navigateWithinApp(page: Page, targetPath: string) {
  const current = new URL(page.url());
  if (current.pathname === targetPath) {
    await waitForAppReady(page);
    return;
  }

  if (targetPath === "/") {
    await page.goto(new URL("/", current.origin).toString(), { waitUntil: "domcontentloaded" });
  } else {
    await page.evaluate((pathValue) => {
      history.pushState({}, "", pathValue);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    }, targetPath);
  }

  await waitForAppReady(page);
  await page.waitForTimeout(350);
}

async function closeTransientUi(page: Page) {
  const closePatterns = [
    page.getByTestId("close-settings"),
    page.getByRole("button", { name: /close|dismiss|done|cancel|hide/i }).first(),
    page.locator('[aria-label="Close panel"]').first(),
    page.locator('[aria-label="Close keyboard shortcuts"]').first(),
  ];

  for (const locator of closePatterns) {
    if (await locator.count()) {
      try {
        await locator.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(250);
        return true;
      } catch {
        // ignore
      }
    }
  }

  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  } catch {
    // ignore
  }

  const stillOpen = await page.locator('[role="dialog"], [aria-label="AI Chat Panel"]').count();
  return stillOpen === 0;
}

async function openSettings(page: Page) {
  const candidates = [
    page.getByTestId("open-settings"),
    page.locator('[aria-label="Settings"]').first(),
    page.locator('button[title="Settings"], button[title="Profile"]').first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.click({ force: true, timeout: 3000 });
      const panel = page.locator('[role="dialog"], [aria-label*="Settings" i]').first();
      try {
        await panel.waitFor({ state: "visible", timeout: 4000 });
        await page.waitForTimeout(250);
        return true;
      } catch {
        await page.waitForTimeout(250);
      }
    }
  }
  return false;
}

async function openCommandPalette(page: Page) {
  const triggerCandidates = [
    page.getByTestId("open-command-palette").first(),
    page.getByRole("button", { name: /command palette|search commands|open commands/i }).first(),
    page.locator('[aria-label*="command palette" i]').first(),
  ];

  for (const trigger of triggerCandidates) {
    if (await trigger.count()) {
      await trigger.click({ force: true, timeout: 3000 });
      try {
        await page
          .locator('#command-palette-input, [placeholder*="Search commands" i], [aria-label="Command palette"]')
          .first()
          .waitFor({ state: "visible", timeout: 5000 });
        await page.waitForTimeout(200);
        return true;
      } catch {
        await closeTransientUi(page);
      }
    }
  }

  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform));
  await page.keyboard.press(isMac ? "Meta+K" : "Control+K");
  try {
    await page
      .locator('#command-palette-input, [placeholder*="Search commands" i], [aria-label="Command palette"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(200);
    return true;
  } catch {
    return false;
  }
}

async function openAgentPanel(page: Page) {
  const candidates = [
    page.getByRole("button", { name: /assistant/i }).first(),
    page.locator('[aria-label*="Open agent panel" i]').first(),
    page.locator('[aria-label*="Open AI Agent" i]').first(),
    page.locator('[data-testid="open-agent"]').first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.click({ force: true, timeout: 3000 });
      const panel = page.locator('[aria-label="AI Chat Panel"], [aria-label="Agent Interface"]').first();
      try {
        await panel.waitFor({ state: "visible", timeout: 5000 });
        await page.waitForTimeout(250);
        return true;
      } catch {
        await page.waitForTimeout(250);
      }
    }
  }
  return false;
}

async function collectTargets(page: Page, selectors: string[], excludeGlobalNav = false) {
  return await page.evaluate(
    ({ selectors: activeSelectors, excludeGlobalNav: shouldExcludeGlobalNav }) =>
      (window as typeof window & {
        __nodebenchCollectTargets?: (selectors: string[], excludeGlobalNav: boolean) => TraversalTarget[];
      }).__nodebenchCollectTargets?.(activeSelectors, shouldExcludeGlobalNav) ?? [],
    { selectors, excludeGlobalNav },
  );
}

function isRiskyTarget(target: TraversalTarget) {
  const riskyLabel = /delete|remove|revoke|purge|destroy|erase|drop|sign out|logout|publish|post to|cleanup|deploy|submit response|send message|run gemini|run .*benchmark|billing|checkout|pay/i;
  const externalHref = target.href && /^(https?:|mailto:|tel:)/i.test(target.href);
  const fileUpload = target.tagName === "input" && target.type === "file";
  return riskyLabel.test(target.label) || externalHref || target.targetAttr === "_blank" || fileUpload;
}

async function interactWithTarget(page: Page, target: TraversalTarget) {
  const locator = page.locator(`[data-nb-traverse-id="${target.traverseId}"]`).first();
  if (!(await locator.count())) {
    return { outcome: "stale" as const, detail: "Element detached before interaction" };
  }

  try {
    if (target.disabled) {
      return { outcome: "stale" as const, detail: "Element is disabled" };
    }

    if (target.tagName === "input" || target.tagName === "textarea" || target.tagName === "select" || target.tagName === "div" && target.role === "textbox") {
      await locator.click({ timeout: 4000 });
      await page.waitForTimeout(120);

      if (!target.readOnly && (target.tagName === "input" || target.tagName === "textarea")) {
        if (target.type && ["checkbox", "radio", "file", "submit", "button"].includes(target.type)) {
          await locator.click({ timeout: 4000 });
        } else {
          await locator.fill("dogfood traversal", { timeout: 4000 });
          await page.waitForTimeout(120);
          await locator.evaluate((element) => {
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
              element.value = "";
              element.dispatchEvent(new Event("input", { bubbles: true }));
              element.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
        }
      } else if (target.tagName === "select") {
        await locator.press("ArrowDown");
      }
    } else {
      try {
        await locator.click({ timeout: 4000, force: target.role === "tab" });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (/detached before interaction|element was detached/i.test(detail)) {
          return { outcome: "stale" as const, detail };
        }
        if (/intercepts pointer events|outside of the viewport/i.test(detail)) {
          await locator.click({ timeout: 4000, force: true });
        } else {
          throw error;
        }
      }
    }

    await page.waitForTimeout(220);
    return { outcome: "interacted" as const };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/detached before interaction|element was detached/i.test(detail)) {
      return { outcome: "stale" as const, detail };
    }
    return {
      outcome: "failed" as const,
      detail,
    };
  }
}

async function traverseScope(
  page: Page,
  routePath: string,
  scopeName: string,
  selectors: string[],
  excludeGlobalNav = false,
  logPath?: string,
) {
  const maxScopeLoops = parseInteger(process.env.NODEBENCH_UI_TRAVERSE_MAX_LOOPS, 240);
  const scopeTimeoutMs = parseInteger(process.env.NODEBENCH_UI_TRAVERSE_SCOPE_TIMEOUT_MS, 45_000);
  const seen = new Set<string>();
  const failures: TraversalAction[] = [];
  let discovered = 0;
  let traversed = 0;
  let skippedRisky = 0;
  let timedOut = false;
  const startedAt = Date.now();

  for (let loop = 0; loop < maxScopeLoops; loop += 1) {
    if (Date.now() - startedAt > scopeTimeoutMs) {
      timedOut = true;
      failures.push({
        label: scopeName,
        kind: "scope",
        outcome: "failed",
        detail: `Timed out after ${scopeTimeoutMs}ms`,
      });
      break;
    }

    const targets = await collectTargets(page, selectors, excludeGlobalNav);
    discovered = Math.max(discovered, targets.length);
    const pending = targets.find((target) => !seen.has(target.key));

    if (logPath && loop % 10 === 0) {
      await appendProgress(
        logPath,
        `scope=${scopeName} route=${routePath} loop=${loop} discovered=${targets.length} pending=${pending?.label ?? "none"}`,
      );
    }

    if (!pending) {
      const closed = await closeTransientUi(page);
      if (closed) break;
      continue;
    }

    seen.add(pending.key);

    if (isRiskyTarget(pending)) {
      skippedRisky += 1;
      continue;
    }

    const result = await interactWithTarget(page, pending);
    if (result.outcome === "interacted") {
      traversed += 1;
    } else if (result.outcome === "failed") {
      failures.push({
        label: pending.label,
        kind: pending.kind,
        outcome: "failed",
        detail: result.detail,
      });
    }

    const currentPath = new URL(page.url()).pathname;
    if (currentPath !== routePath && !currentPath.startsWith(routePath === "/" ? "/internal" : routePath)) {
      await navigateWithinApp(page, routePath);
    }
  }

  return { name: scopeName, discovered, traversed, skippedRisky, failures, timedOut } satisfies ScopeReport;
}

function formatMarkdown(report: { baseURL: string; routes: RouteReport[]; generatedAtIso: string }) {
  const lines = [
    "# UI Traversal Audit",
    "",
    `Generated: ${report.generatedAtIso}`,
    `Base URL: ${report.baseURL}`,
    "",
  ];

  for (const route of report.routes) {
    lines.push(`## ${route.title} (${route.path})`);
    lines.push(route.ok ? "Status: passed" : `Status: failed${route.error ? ` — ${route.error}` : ""}`);
    for (const scope of route.scopes) {
      lines.push(
        `- ${scope.name}: discovered=${scope.discovered}, traversed=${scope.traversed}, skippedRisky=${scope.skippedRisky}, failures=${scope.failures.length}`,
      );
      for (const failure of scope.failures.slice(0, 5)) {
        lines.push(`- failure: ${failure.label} — ${failure.detail}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const host = args.get("host") ?? "127.0.0.1";
  const requestedPort = parseInteger(args.get("port"), 4173);
  const headless = (args.get("headless") ?? "true") !== "false";
  const baseURLArg = args.get("baseURL");
  const routeFilter = args.get("route");
  const routeIdFilter = args.get("routeId");
  const routeStart = parseInteger(args.get("routeStart"), 0);
  const routeCount = parseInteger(args.get("routeCount"), Number.POSITIVE_INFINITY);
  const maxScopeLoops = parseInteger(args.get("maxScopeLoops"), 240);
  const scopeTimeoutMs = parseInteger(args.get("scopeTimeoutMs"), 45_000);
  process.env.NODEBENCH_UI_TRAVERSE_MAX_LOOPS = String(maxScopeLoops);
  process.env.NODEBENCH_UI_TRAVERSE_SCOPE_TIMEOUT_MS = String(scopeTimeoutMs);
  const port = baseURLArg ? requestedPort : await findOpenPort(host, requestedPort);
  const baseURL = baseURLArg ?? `http://${host}:${port}`;
  const outputDir = path.resolve(repoRoot, ".tmp", "ui-traversal");
  const reportPath = path.join(outputDir, "report.json");
  const markdownPath = path.join(outputDir, "report.md");
  const progressPath = path.join(outputDir, "progress.log");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(progressPath, "", "utf8");

  const routes = buildRoutes()
    .filter((route) => (routeFilter ? route.path.includes(routeFilter) : true))
    .filter((route) => (routeIdFilter ? route.id.includes(routeIdFilter) : true))
    .slice(routeStart, Number.isFinite(routeCount) ? routeStart + routeCount : undefined);

  if (routes.length === 0) {
    throw new Error("No routes matched the provided filters.");
  }
  await appendProgress(progressPath, `starting traversal baseURL=${baseURL} routes=${routes.length}`);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const nodeCmd = process.execPath;
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

  let server: ChildProcess | undefined;
  if (!baseURLArg) {
    // Clean stale dist/dogfood from prior interrupted runs to prevent ENOTEMPTY
    const staleDogfood = path.join(repoRoot, "dist", "dogfood");
    try { rmSync(staleDogfood, { recursive: true, force: true }); } catch { /* ignore */ }
    const buildCode = await runShellCommand(`${npmCmd} run build`, repoRoot);
    if (buildCode !== 0) {
      throw new Error(`Build failed with exit code ${buildCode}`);
    }

    server = spawn(nodeCmd, [viteBin, "preview", "--host", host, "--port", String(port), "--strictPort"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });
    server.stdout?.on("data", (chunk) => process.stdout.write(String(chunk)));
    server.stderr?.on("data", (chunk) => process.stderr.write(String(chunk)));

    await waitForPort(host, port, 240_000);
    await waitForHttpOk(baseURL, 240_000);
  }

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await setTraversalTheme(page);
    await installTraversalHelpers(page);
    await appendProgress(progressPath, "navigating to base URL");
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await appendProgress(progressPath, "sign-in check");
    await signInIfPrompted(page);
    await appendProgress(progressPath, "waiting for app ready");
    await waitForAppReady(page);

    const routeReports: RouteReport[] = [];
    for (const [index, route] of routes.entries()) {
      const scopes: ScopeReport[] = [];
      const routeReport: RouteReport = {
        id: route.id,
        title: route.title,
        path: route.path,
        ok: true,
        scopes,
      };

      try {
        // eslint-disable-next-line no-console
        console.log(`[ui-traverse] route ${index + 1}/${routes.length}: ${route.path}`);
        const routeStartedAt = Date.now();
        await appendProgress(progressPath, `route-start index=${index + 1} path=${route.path}`);
        await navigateWithinApp(page, route.path);
        scopes.push(await traverseScope(page, route.path, "main-content", ["#main-content"], true, progressPath));
        await appendProgress(progressPath, `route-finish path=${route.path} elapsedMs=${Date.now() - routeStartedAt}`);
        // eslint-disable-next-line no-console
        console.log(
          `[ui-traverse] complete ${route.path} in ${Date.now() - routeStartedAt}ms ` +
            `(discovered=${scopes[0]?.discovered ?? 0}, traversed=${scopes[0]?.traversed ?? 0}, failures=${scopes[0]?.failures.length ?? 0})`,
        );
      } catch (error) {
        routeReport.ok = false;
        routeReport.error = error instanceof Error ? error.message : String(error);
        await appendProgress(progressPath, `route-error path=${route.path} error=${routeReport.error}`);
        // eslint-disable-next-line no-console
        console.error(`[ui-traverse] failed ${route.path}: ${routeReport.error}`);
      }

      routeReports.push(routeReport);
    }

    await navigateWithinApp(page, "/");
    await appendProgress(progressPath, "checking global settings");

    if (await openSettings(page)) {
      const scope = await traverseScope(
        page,
        "/",
        "global-settings",
        ['[role="dialog"]', '[aria-label="Settings"]'],
        false,
        progressPath,
      );
      routeReports.push({
        id: "global-settings",
        title: "Global Settings",
        path: "/",
        ok: scope.failures.length === 0,
        scopes: [scope],
      });
      await closeTransientUi(page);
    }

    await navigateWithinApp(page, "/");
    await appendProgress(progressPath, "checking command palette");
    if (await openCommandPalette(page)) {
      const scope = await traverseScope(page, "/", "command-palette", ['[role="dialog"]'], false, progressPath);
      routeReports.push({
        id: "command-palette",
        title: "Command Palette",
        path: "/",
        ok: scope.failures.length === 0,
        scopes: [scope],
      });
      await closeTransientUi(page);
    }

    await navigateWithinApp(page, "/agents");
    await appendProgress(progressPath, "checking agent panel");
    if (await openAgentPanel(page)) {
      const scope = await traverseScope(
        page,
        "/agents",
        "agent-panel",
        ['[aria-label="AI Chat Panel"]', '[aria-label="Agent Interface"]', '[role="dialog"]'],
        false,
        progressPath,
      );
      routeReports.push({
        id: "agent-panel",
        title: "Agent Panel",
        path: "/agents",
        ok: scope.failures.length === 0,
        scopes: [scope],
      });
      await closeTransientUi(page);
    }

    const report = {
      generatedAtIso: new Date().toISOString(),
      baseURL,
      routeCount: routeReports.length,
      routes: routeReports,
    };

    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    await writeFile(markdownPath, formatMarkdown(report), "utf8");
    await appendProgress(progressPath, `report-written failures=${routeReports.filter((route) => !route.ok || route.scopes.some((scope) => scope.failures.length > 0)).length}`);

    const routeFailures = routeReports.filter(
      (route) => !route.ok || route.scopes.some((scope) => scope.failures.length > 0),
    );

    // eslint-disable-next-line no-console
    console.log(`UI traversal report written to ${reportPath}`);
    // eslint-disable-next-line no-console
    console.log(`Markdown summary written to ${markdownPath}`);
    // eslint-disable-next-line no-console
    console.log(`Traversed ${routeReports.length} screens/scopes. Failures: ${routeFailures.length}`);

    if (routeFailures.length > 0) {
      const failureSummary = routeFailures
        .map((route) => {
          const scopeFailures = route.scopes.flatMap((scope) =>
            scope.failures.map((failure) => `${scope.name}: ${failure.label} — ${failure.detail}`),
          );
          return `${route.path}: ${route.error ?? scopeFailures[0] ?? "unknown failure"}`;
        })
        .join("\n");
      throw new Error(`Traversal found failures:\n${failureSummary}`);
    }
  } finally {
    await appendProgress(progressPath, "closing browser");
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await killProcessTree(server);
    await appendProgress(progressPath, "shutdown complete");
  }
}

await main();
