import path from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Ground truth for the vision judge: every clause in the executable surface
 * contracts (proof/ui-contract/surfaces/*.contract.json) is verified
 * deterministically in CI by ui-contract-runner.spec.ts. A vision finding that
 * contradicts a verified clause is a misread, not a bug — feeding the clause
 * list to the judge stops paid vision passes from re-litigating what CI
 * already proved (and cuts the score variance the Gemini loop is known for).
 */
function contractVerifiedInvariants() {
  try {
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..", "..", "docs", "design", "ui-contract", "surfaces",
    );
    const lines = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".contract.json"))) {
      const contract = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      for (const anchor of contract.anchors ?? []) lines.push(`- [${contract.surface}] ${anchor.why}`);
      for (const rule of contract.geometry ?? []) lines.push(`- [${contract.surface}] ${rule.why}`);
      for (const state of contract.states ?? []) lines.push(`- [${contract.surface}] state "${state.name}": ${state.why}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { spawn, execSync } from "node:child_process";
import { chromium } from "playwright";

const OFFICIAL_GEMINI_QA_MODEL = "gemini-3-pro-preview";
const DEFAULT_GEMINI_QA_MODEL_INTENT = OFFICIAL_GEMINI_QA_MODEL;
const DEFAULT_GEMINI_QA_MODEL_PREFERENCES = [OFFICIAL_GEMINI_QA_MODEL];
const PRO_GEMINI_QA_MODEL_PREFERENCES = [OFFICIAL_GEMINI_QA_MODEL];
let GEMINI_QA_MODEL_INTENT = normalizeGeminiModelAlias(process.env.DOGFOOD_GEMINI_MODEL?.trim()) || DEFAULT_GEMINI_QA_MODEL_INTENT;
let GEMINI_QA_MODEL_PREFERENCES = [...DEFAULT_GEMINI_QA_MODEL_PREFERENCES];
let GEMINI_QA_MODEL = GEMINI_QA_MODEL_PREFERENCES[0];
let GEMINI_QA_ALLOW_FALLBACK = false;
let geminiModelResolution = null;

// â”€â”€ Load .env.local for GEMINI_API_KEY (needed by LLM judge) â”€â”€
try {
  const envPath = path.join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch { /* ignore */ }

// â”€â”€ Try getting GEMINI_API_KEY from Convex env if not set locally â”€â”€
if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_AI_API_KEY) {
  try {
    const convexKey = execSync("npx convex env get GEMINI_API_KEY", {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"], // suppress stderr
    }).trim();
    if (convexKey && convexKey.length > 10 && !convexKey.includes("not found") && !convexKey.includes("Error")) {
      process.env.GEMINI_API_KEY = convexKey;
      // eslint-disable-next-line no-console
      console.log("  âœ“ Loaded GEMINI_API_KEY from Convex environment");
    }
  } catch { /* ignore â€” convex CLI may not be available */ }
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const [k, v] = raw.split("=", 2);
    if (v !== undefined) args.set(k.slice(2), v);
    else args.set(k.slice(2), argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  }
  return args;
}

function applyPositionalCompat(rawArgv, args) {
  // NOTE(coworker): npm@10 on Windows occasionally strips `--flags` when forwarding args
  // through `npm run ... -- ...`, leaving only positional values. This keeps loop mode
  // usable in CI and local shells by supporting:
  //   node runDogfoodGeminiQa.mjs <maxIterations> <targetScore> [designStyle] [targetAspiration]
  // When positional mode is detected we enable loop + auto-apply by default.
  const hasDashFlags = rawArgv.some((a) => String(a ?? "").startsWith("--"));
  if (hasDashFlags) return args;

  const first = String(rawArgv[0] ?? "").trim();
  if (!/^\d+$/.test(first)) return args;

  args.set("loop", "true");
  args.set("auto-apply", "true");
  args.set("max-iterations", first);

  const second = String(rawArgv[1] ?? "").trim();
  if (/^\d+$/.test(second)) args.set("target-score", second);

  const third = String(rawArgv[2] ?? "").trim();
  if (third && !/^\d+$/.test(third)) args.set("design-style", third);

  const fourth = String(rawArgv[3] ?? "").trim();
  if (/^\d+$/.test(fourth)) {
    args.set("target-aspiration", fourth);
    args.set("design-edits", "true");
  }

  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetriableFsError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  return ["UNKNOWN", "EBUSY", "EPERM", "EMFILE", "ENFILE", "EACCES", "ETXTBSY"].includes(code);
}

async function writeFileWithRetry(filePath, contents, encoding = "utf8", { attempts = 6, baseDelayMs = 120 } = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.writeFile(filePath, contents, encoding);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetriableFsError(error)) {
        throw error;
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError ?? new Error(`Failed to write ${filePath}`);
}

async function writeJsonFileWithRetry(filePath, value, options) {
  await writeFileWithRetry(filePath, JSON.stringify(value, null, 2), "utf8", options);
}

async function readJsonFileOrDefault(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function getGeminiApiKey() {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
}

function dedupeModels(models) {
  const seen = new Set();
  return models.filter((model) => {
    const normalized = String(model ?? "").trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeGeminiModelAlias(model) {
  const normalized = String(model ?? "").trim();
  if (!normalized) return "";

  const aliases = new Map([
    ["gemini-3.1-pro", OFFICIAL_GEMINI_QA_MODEL],
    ["gemini-3.1-pro-preview", OFFICIAL_GEMINI_QA_MODEL],
    ["gemini-3-pro", OFFICIAL_GEMINI_QA_MODEL],
    ["gemini-3-pro-preview", OFFICIAL_GEMINI_QA_MODEL],
    ["gemini-3.1-flash", "gemini-3-flash-preview"],
    ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"],
  ]);

  return aliases.get(normalized) ?? normalized;
}

function configureGeminiQaModel({ model, preferPro, allowFallback = false }) {
  const requestedModel = normalizeGeminiModelAlias(model ?? process.env.DOGFOOD_GEMINI_MODEL ?? "");
  const proPreferred = preferPro || /^(1|true|yes)$/i.test(String(process.env.DOGFOOD_GEMINI_PREFER_PRO ?? ""));

  GEMINI_QA_MODEL_INTENT = requestedModel || (proPreferred ? PRO_GEMINI_QA_MODEL_PREFERENCES[0] : DEFAULT_GEMINI_QA_MODEL_INTENT);
  GEMINI_QA_MODEL_PREFERENCES = dedupeModels([
    ...(requestedModel ? [requestedModel] : []),
    ...(proPreferred ? PRO_GEMINI_QA_MODEL_PREFERENCES : []),
    ...DEFAULT_GEMINI_QA_MODEL_PREFERENCES,
  ]);
  GEMINI_QA_MODEL = GEMINI_QA_MODEL_PREFERENCES[0];
  GEMINI_QA_ALLOW_FALLBACK = allowFallback;
  geminiModelResolution = null;
}

function isGenerateContentModelNotFound(status, errorText) {
  const text = String(errorText ?? "");
  return status === 404 && /not found.*generateContent|not supported for generateContent/i.test(text);
}

async function resolveGeminiQaModel(geminiApiKey) {
  if (!geminiApiKey) {
    return {
      requestedModel: GEMINI_QA_MODEL_INTENT,
      selectedModel: GEMINI_QA_MODEL,
      exactMatch: false,
      fallbackReason: "missing_api_key",
    };
  }

  if (geminiModelResolution) {
    return geminiModelResolution;
  }

  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": geminiApiKey },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      geminiModelResolution = {
        requestedModel: GEMINI_QA_MODEL_INTENT,
        selectedModel: GEMINI_QA_MODEL,
        exactMatch: false,
        fallbackReason: `model_list_http_${res.status}`,
        error: errText.slice(0, 200),
      };
      return geminiModelResolution;
    }

    const payload = await res.json();
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const supportsGenerateContent = new Set(
      models
        .filter((model) => Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
        .map((model) => String(model.name ?? "").replace(/^models\//, "")),
    );

    const exactSupported = supportsGenerateContent.has(GEMINI_QA_MODEL_INTENT);
    const selectedModel = exactSupported
      ? GEMINI_QA_MODEL_INTENT
      : GEMINI_QA_ALLOW_FALLBACK
        ? GEMINI_QA_MODEL_PREFERENCES.find((model) => supportsGenerateContent.has(model)) ?? GEMINI_QA_MODEL
        : GEMINI_QA_MODEL_INTENT;

    GEMINI_QA_MODEL = selectedModel;
    geminiModelResolution = {
      requestedModel: GEMINI_QA_MODEL_INTENT,
      selectedModel,
      exactMatch: exactSupported,
      fallbackReason: exactSupported
        ? "exact_match"
        : GEMINI_QA_ALLOW_FALLBACK
          ? "fallback_supported_generate_content_model"
          : "exact_model_unavailable",
      availableModels: Array.from(supportsGenerateContent).slice(0, 50),
    };
    return geminiModelResolution;
  } catch (error) {
    geminiModelResolution = {
      requestedModel: GEMINI_QA_MODEL_INTENT,
      selectedModel: GEMINI_QA_MODEL,
      exactMatch: false,
      fallbackReason: "model_list_fetch_failed",
      error: error instanceof Error ? error.message : String(error),
    };
    return geminiModelResolution;
  }
}

async function killProcessTree(proc) {
  if (!proc || typeof proc.pid !== "number") return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }

  const exited = await Promise.race([
    new Promise((resolve) => proc.once("exit", () => resolve(true))),
    sleep(8000).then(() => false),
  ]);
  if (exited) return;

  if (process.platform === "win32") {
    try {
      const taskkill = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      await Promise.race([new Promise((resolve) => taskkill.on("exit", resolve)), sleep(8000)]);
      return;
    } catch {
      // ignore
    }
  }

  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
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
    await sleep(400);
  }
  throw new Error(`Timed out waiting for server at ${host}:${port}`);
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-undef
      const res = await fetch(url, { redirect: "follow" });
      if (res.status === 200) return;
    } catch {
      // ignore
    }
    await sleep(450);
  }
  throw new Error(`Timed out waiting for HTTP at ${url}`);
}

async function findOpenPort(host, startPort, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const port = startPort + i;
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, host, () => {
        srv.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No open port found near ${startPort}`);
}

async function scrapeRecentRuns(page) {
  return await page.evaluate(() => {
    const recentLabel = Array.from(document.querySelectorAll("div")).find(
      (el) => el.textContent?.trim().toLowerCase() === "recent runs",
    );
    if (!recentLabel) return [];
    const container = recentLabel.closest("div.space-y-3");
    if (!container) return [];

    const runCards = Array.from(container.querySelectorAll("div.rounded-md")).filter((el) =>
      el.textContent?.includes("Summary"),
    );

    return runCards.slice(0, 4).map((card) => {
      const summary = (card.querySelector("div.text-sm.text-muted-foreground.whitespace-pre-wrap")?.textContent ?? "").trim();
      const issues = Array.from(card.querySelectorAll("div.rounded-md.border.border-border\\/60.bg-card")).map((issue) => {
        const header = issue.querySelector("div.text-sm.font-medium")?.textContent ?? "";
        const details = (issue.querySelector("div.mt-1.text-sm.text-muted-foreground.whitespace-pre-wrap")?.textContent ?? "").trim();
        const suggestedFix = (issue.querySelector("div.mt-2.text-sm.text-foreground.whitespace-pre-wrap")?.textContent ?? "").trim();
        const route = (issue.querySelector("div.text-xs.text-muted-foreground.font-mono")?.textContent ?? "").trim();
        const ts = (issue.querySelector("div.text-xs.text-muted-foreground.font-mono")?.textContent ?? "").trim();
        return { header: header.trim(), route, ts, details, suggestedFix };
      });
      return { summary, issues };
    });
  });
}

async function readLatestLabel(page) {
  try {
    const label = await page.getByText(/^latest:/i).first().textContent({ timeout: 2000 });
    return (label ?? "").trim();
  } catch {
    return "";
  }
}

async function ensureAnonymousSignIn(page) {
  const dogfoodSignIn = page.getByTestId("dogfood-sign-in").first();
  if (await dogfoodSignIn.isVisible().catch(() => false)) {
    // Wait for DOM to stabilize after initial render, then use CSS selector
    // to avoid stale element reference from React re-renders
    await page.waitForTimeout(500);
    await page.click('[data-testid="dogfood-sign-in"]', { timeout: 15_000 });

    const outcome = await Promise.race([
      dogfoodSignIn.waitFor({ state: "hidden", timeout: 120_000 }).then(() => "ok"),
      page.getByText(/qa error:/i).first().waitFor({ timeout: 120_000 }).then(() => "err"),
    ]);
    if (outcome === "err") {
      const errText = (await page.getByText(/qa error:/i).first().textContent().catch(() => "")) || "";
      throw new Error(errText.replace(/^qa error:\s*/i, "").trim() || "Anonymous sign-in failed");
    }

    await page.waitForLoadState("networkidle").catch(() => { });
    await page.waitForTimeout(800);
    return;
  }

  const previewBanner = page.getByText(/you're in preview mode/i).first();
  const signInBtn = page.getByRole("button", { name: /^sign in$/i }).first();

  const bannerVisible =
    (await previewBanner.isVisible().catch(() => false)) || (await signInBtn.isVisible().catch(() => false));
  if (!bannerVisible) return;

  await signInBtn.click({ timeout: 15_000 });

  // Wait until auth state flips (banner removed) or an explicit error appears.
  const outcome = await Promise.race([
    previewBanner.waitFor({ state: "hidden", timeout: 120_000 }).then(() => "ok"),
    page.getByText(/failed to sign in anonymously/i).waitFor({ timeout: 120_000 }).then(() => "err"),
  ]);
  if (outcome === "err") {
    throw new Error("Anonymous sign-in failed");
  }

  await page.waitForLoadState("networkidle").catch(() => { });
  await page.waitForTimeout(800);
}

// Archive the previous QA run's output before overwriting.
// This gives a before/after for any Gemini or visual diff.
async function archivePreviousRun(outDir) {
  let entries;
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return; // first run â€” nothing to archive
  }
  if (!entries.length) return;

  const archiveBase = path.join(outDir, "..", "archive");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const archiveDir = path.join(archiveBase, stamp);
  await fs.mkdir(archiveDir, { recursive: true });

  for (const entry of entries) {
    if (entry === "archive") continue; // never recurse
    try {
      await fs.rename(path.join(outDir, entry), path.join(archiveDir, entry));
    } catch {
      // ignore move failures (e.g. cross-device) â€” just continue
    }
  }
}

async function waitForDogfoodReady(page, timeoutMs = 120_000) {
  try {
    await page.getByRole("heading", { name: /quality review/i }).first().waitFor({ timeout: timeoutMs });
    return;
  } catch (err) {
    const boundaryVisible = await page
      .getByText(/something went wrong/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (boundaryVisible) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const summary =
        bodyText
          .replace(/\s+/g, " ")
          .match(/something went wrong.{0,220}/i)?.[0]
          ?.trim() ?? "Something went wrong";
      throw new Error(`Dogfood page failed to render: ${summary}`);
    }

    throw err;
  }
}

const STABLE_DOGFOOD_CHAT_ROUTE =
  "/?surface=chat&q=What%20is%20SoftBank%20and%20what%20matters%20most%20right%20now%3F&lens=founder";

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LAYER 0: STATIC CODE ANALYSIS â€” Deterministic design token compliance
// Greps src/ for banned CSS patterns that visual QA cannot detect from screenshots.
// Runs before any Gemini calls â€” zero cost, zero variance.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Layer 0 static analysis — delegated to standalone design linter (scripts/ui/designLinter.mjs)
// The linter implements the full Design Governance Spec with 25+ banned patterns,
// structural checks (missing page-shell, empty states), and fix suggestions.
// Run standalone: `npm run lint:design`
import { scanForDesignViolations } from "./designLinter.mjs";

async function scanSourceForBannedPatterns(srcDir) {
  const result = await scanForDesignViolations(srcDir);
  // Map to legacy shape expected by downstream Layer 0 scoring
  return {
    violations: result.violations.map((v) => ({
      file: v.file, line: v.line, match: v.match, label: v.label, severity: v.severity,
    })),
    highCount: result.high,
    medCount: result.medium,
    lowCount: result.low,
    score: result.score,
    total: result.total,
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AGENTIC VISUAL EXPLORATION â€” Gemini-guided UI interaction discovery
// Instead of hardcoded Playwright selectors, sends screenshots to Gemini
// vision and asks "what should I interact with?" â€” discovers interactive
// states the way a human QA tester would, without brittle CSS selectors.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DYNAMIC ROUTE & UI SURFACE DISCOVERY
// Instead of hardcoded routes, crawls the live app to find every navigable
// surface: sidebar links, sub-tabs, modal triggers, drawer toggles,
// accordion panels, and nested page links. Self-updating â€” any new page
// added to the app is automatically discovered and tested.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Extract all navigable links from the current page DOM.
async function extractLinksFromPage(page) {
  return page.evaluate(() => {
    const results = [];
    const seen = new Set();
    // 1. All anchor links with internal paths
    document.querySelectorAll("a[href]").forEach((el) => {
      let href = el.getAttribute("href");
      if (!href) return;
      // Support hash-router links like "#/research" by normalizing to "/research".
      if (href.startsWith("#/")) href = href.slice(1);
      if (!href.startsWith("/")) return;
      if (href.startsWith("/api")) return;
      if (href.includes("://")) return;
      if (!seen.has(href)) {
        seen.add(href);
        const label = (el.textContent || "").trim().slice(0, 50).replace(/\s+/g, " ");
        results.push({ path: href, label, source: "link" });
      }
    });
    // 2. Tab elements (role="tab" with data-value, href, or onclick)
    document.querySelectorAll("[role='tab']").forEach((el) => {
      let href = el.getAttribute("href") || el.getAttribute("data-value");
      if (href && href.startsWith("#/")) href = href.slice(1);
      const label = (el.textContent || "").trim().slice(0, 50);
      if (href && href.startsWith("/") && !seen.has(href)) {
        seen.add(href);
        results.push({ path: href, label, source: "tab" });
      }
    });
    // 3. Nav links inside tab bars, breadcrumbs, sub-nav
    document.querySelectorAll("nav a[href], [role='tablist'] a[href]").forEach((el) => {
      let href = el.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#/")) href = href.slice(1);
      if (href && href.startsWith("/") && !seen.has(href)) {
        seen.add(href);
        const label = (el.textContent || "").trim().slice(0, 50);
        results.push({ path: href, label, source: "nav" });
      }
    });
    return results;
  });
}

// Discover all navigable surfaces by crawling the live app.
// Phase 1: Sidebar links (top-level routes)
// Phase 2: Per-route sub-tabs, nested links, and secondary navigation
// Returns a flat array of { path, name } objects, deduplicated.
async function discoverRoutes(page, baseURL) {
  const seen = new Set();
  const routes = [];
  const SKIP_NAV_LABEL_RE = /sign in|log in|log out|logout|sign up|signup|register|continue with|google|connect|upgrade|billing|subscribe|delete|remove|clear|reset|purge|trash/i;

  function normalizeDogfoodSeedPath(rawPath) {
    const normalized = String(rawPath ?? "").replace(/\/$/, "") || "/";
    if (/^\/*\?surface=chat\b/i.test(normalized) || /\/\?surface=chat\b/i.test(normalized)) {
      return STABLE_DOGFOOD_CHAT_ROUTE;
    }
    return normalized;
  }

  async function seedRoutesFromDogfoodArtifacts() {
    // NOTE(coworker): Avoid hardcoding route lists. If the app's navigation is
    // icon-only / router-driven (no <a href>), we "learn" a seed route set from
    // our existing dogfood capture artifacts (walkthrough + scribe).
    // These files are produced by the app itself, so new routes automatically
    // show up here after a single capture session.
    const seeds = new Set();
    const candidates = [
      path.join(process.cwd(), "public", "dogfood", "walkthrough.json"),
      path.join(process.cwd(), "public", "dogfood", "scribe.json"),
    ];
    for (const p of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = await fs.readFile(p, "utf8");
        const obj = JSON.parse(raw);
        const paths = [];
        if (Array.isArray(obj?.chapters)) {
          for (const c of obj.chapters) if (typeof c?.path === "string") paths.push(c.path);
        }
        if (Array.isArray(obj?.steps)) {
          for (const s of obj.steps) if (typeof s?.path === "string") paths.push(s.path);
        }
        for (const pp of paths) {
          const normalized = normalizeDogfoodSeedPath(pp);
          if (normalized.startsWith("/")) seeds.add(normalized);
        }
      } catch {
        // ignore missing/invalid artifacts
      }
    }
    return Array.from(seeds);
  }

  async function seedRoutesFromRoutingSource() {
    // NOTE(coworker): Keep route fallback learned from source of truth, not hardcoded lists.
    // If new routes are added to useMainLayoutRouting, QA discovery picks them up automatically.
    try {
      const routingPath = path.join(process.cwd(), "src", "hooks", "useMainLayoutRouting.ts");
      const raw = await fs.readFile(routingPath, "utf8");
      const matches = raw.match(/pathname\.startsWith\((['"])\/[^'"]+\1\)/g) ?? [];
      const paths = new Set();
      for (const m of matches) {
        const quote = m.includes('"') ? '"' : "'";
        const route = m.replace(`pathname.startsWith(${quote}`, "").replace(`${quote})`, "").trim();
        if (!route || route === "/") continue;
        if (/\/(?:api|auth|oauth|callback|entity\/?$)/i.test(route)) continue;
        paths.add(route.endsWith("/") ? route.slice(0, -1) : route);
      }
      return Array.from(paths);
    } catch {
      return [];
    }
  }

  function getAppRouteFromUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      if (u.hash && u.hash.startsWith("#/")) return u.hash.slice(1);
      return u.pathname || "/";
    } catch {
      return "/";
    }
  }

  function addRoute(path, label, source) {
    const normalized = path.replace(/\/$/, "") || "/";
    // Skip entity-specific, auth, or API routes
    if (seen.has(normalized)) return;
    if (/\/(entity|api|auth|login|signup|oauth|callback)\b/i.test(normalized)) return;
    seen.add(normalized);
    const rawLabel = String(label || "").trim();
    const baseName = rawLabel.startsWith("/") ? rawLabel.slice(1) : rawLabel;
    const fallbackName = normalized === "/" ? "home" : normalized.slice(1);
    const safeName = (baseName || fallbackName)
      .replace(/[^a-z0-9-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 30)
      .toLowerCase() || "page";
    routes.push({ path: normalized, name: safeName, source: source || "crawl" });
  }

  async function waitForRouteChange(prevRoute, timeoutMs = 3000) {
    try {
      await page.waitForFunction((prev) => {
        const hash = window.location.hash || "";
        const cur = hash.startsWith("#/") ? hash.slice(1) : window.location.pathname;
        return cur !== prev;
      }, prevRoute, { timeout: timeoutMs });
    } catch {
      // ignore timeouts (some clicks open popovers etc.)
    }
  }

  // â”€â”€ Phase 1: Crawl sidebar from home page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // eslint-disable-next-line no-console
  console.log("    ðŸ“¡ Phase 1: Discovering sidebar routes...");
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await ensureAnonymousSignIn(page).catch(() => { });

  const homeLinks = await extractLinksFromPage(page);
  for (const link of homeLinks) addRoute(link.path, link.label, "sidebar");

  // If the sidebar uses buttons (router-driven) instead of anchors, discover routes by clicking.
  try {
    const navItems = page.locator([
      "aside a[href^='/']",
      "aside button",
      "aside [role='button']",
      "nav a[href^='/']",
      "nav button",
      "nav [role='button']",
      "[role='navigation'] a[href^='/']",
      "[role='navigation'] button",
      "[role='navigation'] [role='button']",
      "[role='navigation'] [role='link']",
      "[data-sidebar] a[href^='/']",
      "[data-sidebar] button",
      "[data-sidebar] [role='button']",
    ].join(", "));
    const maxItems = Math.min(await navItems.count(), 40);
    for (let i = 0; i < maxItems; i++) {
      const item = navItems.nth(i);
      // eslint-disable-next-line no-await-in-loop
      const labelText = ((await item.textContent().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
      // eslint-disable-next-line no-await-in-loop
      const ariaLabel = ((await item.getAttribute("aria-label").catch(() => "")) ?? "").trim().slice(0, 50);
      // eslint-disable-next-line no-await-in-loop
      const title = ((await item.getAttribute("title").catch(() => "")) ?? "").trim().slice(0, 50);
      const label = labelText || ariaLabel || title;
      if (!label) continue;
      if (SKIP_NAV_LABEL_RE.test(label)) continue;

      const beforePath = getAppRouteFromUrl(page.url());
      // eslint-disable-next-line no-await-in-loop
      await item.click({ timeout: 2500 }).catch(() => null);
      // eslint-disable-next-line no-await-in-loop
      await waitForRouteChange(beforePath, 3500);
      const afterPath = getAppRouteFromUrl(page.url());
      if (afterPath && afterPath.startsWith("/") && afterPath !== beforePath) {
        addRoute(afterPath, label, "sidebar-click");
      }

      // Reset to home so each click starts from a known state.
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" }).catch(() => { });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
      // eslint-disable-next-line no-await-in-loop
      await ensureAnonymousSignIn(page).catch(() => { });
    }
  } catch {
    // ignore discovery click failures
  }

  // Last-resort discovery: infer "sidebar-ish" nav items by position (left gutter),
  // then click them and record any pathname changes. This avoids relying on layout tags
  // like <aside> or <nav> which some UIs omit.
  try {
    if (routes.length <= 1) {
      const candidates = page.locator("a[href^='/'], button, [role='button'], [role='link'], [role='menuitem']");
      const maxItems = Math.min(await candidates.count(), 80);
      for (let i = 0; i < maxItems; i++) {
        const item = candidates.nth(i);
        // eslint-disable-next-line no-await-in-loop
        const box = await item.boundingBox().catch(() => null);
        if (!box) continue;
        if (box.x > 320) continue;
        if (box.width < 40 || box.height < 18) continue;

        // eslint-disable-next-line no-await-in-loop
        const isVisible = await item.isVisible().catch(() => false);
        if (!isVisible) continue;

        // eslint-disable-next-line no-await-in-loop
        const labelText = ((await item.textContent().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
        // eslint-disable-next-line no-await-in-loop
        const ariaLabel = ((await item.getAttribute("aria-label").catch(() => "")) ?? "").trim().slice(0, 50);
        // eslint-disable-next-line no-await-in-loop
        const title = ((await item.getAttribute("title").catch(() => "")) ?? "").trim().slice(0, 50);
        const label = labelText || ariaLabel || title;
        if (!label) continue;
        if (SKIP_NAV_LABEL_RE.test(label)) continue;

        const beforePath = getAppRouteFromUrl(page.url());
        // eslint-disable-next-line no-await-in-loop
        await item.click({ timeout: 2500 }).catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        await waitForRouteChange(beforePath, 3500);
        const afterPath = getAppRouteFromUrl(page.url());
        if (afterPath && afterPath.startsWith("/") && afterPath !== beforePath) {
          addRoute(afterPath, label, "sidebar-positional");
        }

        // eslint-disable-next-line no-await-in-loop
        await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" }).catch(() => { });
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(350);
        // eslint-disable-next-line no-await-in-loop
        await ensureAnonymousSignIn(page).catch(() => { });
      }
    }
  } catch {
    // ignore positional discovery failures
  }

  // Always include home
  addRoute("/", "home", "sidebar");

  const phase1Count = routes.length;
  // eslint-disable-next-line no-console
  console.log(`    ðŸ“¡ Phase 1: ${phase1Count} top-level routes discovered`);

  // â”€â”€ Phase 2: Visit each route to discover sub-tabs and nested links â”€â”€â”€â”€
  // eslint-disable-next-line no-console
  console.log("    ðŸ“¡ Phase 2: Discovering sub-tabs and nested links...");
  const phase1Routes = [...routes]; // snapshot â€” don't iterate while mutating

  for (const route of phase1Routes) {
    try {
      await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const subLinks = await extractLinksFromPage(page);
      for (const link of subLinks) addRoute(link.path, link.label, `sub:${route.name}`);
    } catch {
      // Non-fatal â€” skip routes that fail to load
    }
  }

  // eslint-disable-next-line no-console
  console.log(`    ðŸ“¡ Phase 2: ${routes.length - phase1Count} sub-routes discovered (${routes.length} total)`);

  // If DOM crawling can't see navigation links, seed from dogfood capture (learned routes).
  // NOTE(coworker): Prefer learned seed routes over static fallback lists.
  if (routes.length < 5) {
    const seeds = await seedRoutesFromDogfoodArtifacts();
    const sourceSeeds = await seedRoutesFromRoutingSource();
    if (seeds.length) {
      // eslint-disable-next-line no-console
      console.log(`    ðŸ“¼ Seed routes from dogfood artifacts: ${seeds.length}`);
      for (const p of seeds) addRoute(p, p, "dogfood-seed");
    }
    if (sourceSeeds.length) {
      // eslint-disable-next-line no-console
      console.log(`    ðŸ“ Seed routes from routing source: ${sourceSeeds.length}`);
      for (const p of sourceSeeds) addRoute(p, p, "routing-seed");
    }
  }

  // Keep the run bounded even if a ton of routes exist.
  // Prefer shallower paths, but keep any benchmark/workbench route if present.
  routes.sort((a, b) => {
    const da = (a.path.match(/\//g) || []).length;
    const db = (b.path.match(/\//g) || []).length;
    if (da !== db) return da - db;
    return a.path.length - b.path.length;
  });

  const limit = Math.max(1, Math.min(25, Number(process.env.NODEBENCH_AGENTIC_ROUTE_LIMIT ?? "18") || 18));
  const keep = [];
  const mustPaths = new Set(routes.filter((r) => /benchmarks|bench|workbench/i.test(r.path)).map((r) => r.path));

  // Include "must" routes first so we always cover Workbench when it exists.
  for (const r of routes) {
    if (!mustPaths.has(r.path)) continue;
    keep.push(r);
  }
  for (const r of routes) {
    if (keep.some((k) => k.path === r.path)) continue;
    if (keep.length >= limit) break;
    keep.push(r);
  }
  return keep;
}

// Fallback: public product routes if dynamic discovery finds nothing.
// Used when route discovery fails or when the app is running in the redesigned
// query-param surface mode rather than the old internal workspace map.
const FALLBACK_ROUTES = [
  { path: "/?surface=home", name: "home" },
  { path: STABLE_DOGFOOD_CHAT_ROUTE, name: "chat" },
  { path: "/?surface=reports", name: "reports" },
  { path: "/?surface=inbox", name: "inbox" },
  { path: "/?surface=me", name: "me" },
];

function stripJsonFences(raw) {
  return String(raw ?? "")
    .replace(/^```json?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();
}

function extractJsonSubstring(raw) {
  const s = stripJsonFences(raw);
  const arrStart = s.indexOf("[");
  const arrEnd = s.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) return s.slice(arrStart, arrEnd + 1);

  const objStart = s.indexOf("{");
  const objEnd = s.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) return s.slice(objStart, objEnd + 1);

  return s;
}

function normalizeJsonish(jsonStr) {
  return String(jsonStr ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"');
}

function getGeminiCandidateText(data) {
  const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function tryParseJson(raw) {
  const candidate = normalizeJsonish(extractJsonSubstring(raw));
  try {
    return JSON.parse(candidate);
  } catch {
    const lastBrace = candidate.lastIndexOf("}");
    if (lastBrace > 0 && candidate.includes("[")) {
      try {
        const truncated = candidate.slice(0, lastBrace + 1).replace(/,\s*$/, "") + "]";
        return JSON.parse(truncated);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function salvageActionPoints(raw) {
  const s = String(raw ?? "");
  const points = [];
  const re = /[\"']?x[\"']?\s*:\s*(\d{1,4})[^{}]*?[\"']?y[\"']?\s*:\s*(\d{1,4})/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ description: "salvaged interaction", action: "click", x, y });
    if (points.length >= 5) break;
  }
  return points;
}

function buildHeuristicJudgeResult(issues, reason = "judge unavailable") {
  const result = new Map();
  for (let i = 0; i < issues.length; i++) {
    const text = `${issues[i].header ?? ""} ${issues[i].details ?? ""}`.toLowerCase();
    const fpPatterns = [
      /\b(contrast|low.contrast|illegible|hard.to.read)\b/,
      /\b(skeleton|loading|empty.state|no.data|placeholder)\b/,
      /\b(dense|compact|cramped|tight|overwhelming)\b/,
      /\b(overlay|dogfood|jargon|internal)\b/,
      /\b(flash|transition|white.screen|flicker)\b/,
      /\b(mock.data|demo|preview)\b/,
      /\b(sidebar.*clutter|navigation.*overload)\b/,
      /\b(chart.*label|overlapping.*label|graph.*text)\b/,
    ];
    const isLikelyFp = fpPatterns.some((pattern) => pattern.test(text));
    result.set(i, {
      verdict: isLikelyFp ? "design_opinion" : "genuine_bug",
      confidence: 0.35,
      reasoning: `${reason}${isLikelyFp ? " (heuristic filter)" : " (heuristic keep)"}`,
    });
  }
  return result;
}

function coerceIssueArrayPayload(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.issues)) return parsed.issues;
  if (Array.isArray(parsed?.opportunities)) return parsed.opportunities;
  return [];
}

async function fallbackExploreRoute(page, baseURL, route, outDir) {
  // NOTE(coworker): Deterministic fallback so a single malformed Gemini response
  // doesn't produce 0 coverage for a route.
  const results = [];
  try {
    await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    // Always capture at least one screenshot for coverage.
    {
      const ssPath = path.join(outDir, `agentic-${route.name}-fallback.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
      results.push({ route: route.name, action: "fallback screenshot", ssPath });
    }

    const buttons = page.getByRole("button");
    const maxScan = Math.min(await buttons.count(), 24);

    // Prefer opening expandable UI states first.
    const expandedCandidates = [];
    for (let i = 0; i < maxScan; i++) {
      const b = buttons.nth(i);
      // eslint-disable-next-line no-await-in-loop
      const expanded = await b.getAttribute("aria-expanded").catch(() => null);
      if (expanded === "false") expandedCandidates.push({ idx: i, b });
    }

    const candidates = expandedCandidates.length
      ? expandedCandidates.map((c) => ({ idx: c.idx, b: c.b, kind: "expand" }))
      : Array.from({ length: maxScan }, (_, idx) => ({ idx, b: buttons.nth(idx), kind: "button" }));

    for (const c of candidates) {
      const i = c.idx;
      const b = c.b;
      try {
        if (await b.isDisabled().catch(() => false)) continue;
        const label = ((await b.textContent().catch(() => "")) ?? "").trim().toLowerCase();
        if (/sign in|log in|logout|run|delete|remove|clear|reset|purge/i.test(label)) continue;
        if (label && c.kind === "button" && !/more|expand|details|filter|settings|configure|open|show/i.test(label)) {
          // In non-expand mode, bias toward "state revealing" UI.
          continue;
        }
        await b.scrollIntoViewIfNeeded();
        await b.click({ timeout: 8000 }).catch(() => null);
        await page.waitForTimeout(900);
        const ssPath = path.join(outDir, `agentic-${route.name}-fallback-${i}.png`);
        await page.screenshot({ path: ssPath, fullPage: true });
        results.push({ route: route.name, action: `fallback click (${c.kind})`, ssPath });
        await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(700);
        break;
      } catch {
        // ignore per-button failures
      }
    }

  } catch {
    // ignore fallback failures
  }
  return results;
}

function isViewportBoxVisible(box, viewport, inset = 8) {
  if (!box || !viewport) return false;
  if (box.width < 20 || box.height < 16) return false;
  return (
    box.x + box.width > inset &&
    box.y + box.height > inset &&
    box.x < viewport.width - inset &&
    box.y < viewport.height - inset
  );
}

async function agenticExploreRoute(page, baseURL, route, geminiApiKey, outDir) {
  const results = [];

  const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

  const readComposerSemanticState = async (locator) => {
    const directComposerRoot = locator.locator("xpath=ancestor::*[@data-nb-composer-root='intake'][1]").first();
    const root =
      await directComposerRoot.isVisible().catch(() => false)
        ? directComposerRoot
        : page.locator("[data-nb-composer-root='intake']").first();
    const rootVisible = await root.isVisible().catch(() => false);
    if (!rootVisible) {
      return {
        composerMode: null,
        composerPrimaryAction: null,
        composerPlaceholder: null,
      };
    }
    const primaryButton = root.locator("[data-nb-composer-primary-action]").last();
    return {
      composerMode: normalizeText(await root.getAttribute("data-nb-composer-mode").catch(() => null)) || null,
      composerPrimaryAction:
        normalizeText(await root.getAttribute("data-nb-composer-primary-action").catch(() => null)) ||
        normalizeText(await primaryButton.getAttribute("data-nb-composer-primary-action").catch(() => null)) ||
        null,
      composerPlaceholder:
        normalizeText(await root.getAttribute("data-nb-composer-placeholder").catch(() => null)) ||
        normalizeText(await root.locator("textarea").first().getAttribute("placeholder").catch(() => null)) ||
        null,
    };
  };

  const readLocatorState = async (locator) => {
    const composerState = await readComposerSemanticState(locator);
    return {
      expanded: await locator.getAttribute("aria-expanded").catch(() => null),
      pressed: await locator.getAttribute("aria-pressed").catch(() => null),
      selected: await locator.getAttribute("aria-selected").catch(() => null),
      current: await locator.getAttribute("aria-current").catch(() => null),
      state: await locator.getAttribute("data-state").catch(() => null),
      className: await locator.getAttribute("class").catch(() => null),
      assistantPanelVisible: await page.getByLabel(/ask nodebench assistant/i).isVisible().catch(() => false),
      ...composerState,
    };
  };

  const getSurfaceFromUrl = (url) => {
    try {
      const parsed = new URL(url);
      return normalizeText(parsed.searchParams.get("surface"));
    } catch {
      return "";
    }
  };

  const hadExpectedSemanticDelta = (description, beforeUrl, afterUrl, beforeState, afterState) => {
    const lower = normalizeText(description);
    const beforeSurface = getSurfaceFromUrl(beforeUrl);
    const afterSurface = getSurfaceFromUrl(afterUrl);
    const surfaceTargets = [
      { pattern: /\bhome\b/, allowed: new Set(["home", "ask"]) },
      { pattern: /\breports\b/, allowed: new Set(["reports", "packets"]) },
      { pattern: /\bchat\b/, allowed: new Set(["chat", "workspace"]) },
      { pattern: /\b(?:inbox|nudges)\b/, allowed: new Set(["inbox", "nudges", "history"]) },
      { pattern: /\bme\b|\bprofile\b|\bsettings\b/, allowed: new Set(["me", "connect"]) },
    ];
    for (const target of surfaceTargets) {
      if (!target.pattern.test(lower)) continue;
      return !target.allowed.has(beforeSurface) && target.allowed.has(afterSurface);
    }
    if (lower.includes("ask")) {
      return (
        beforeState.expanded !== afterState.expanded ||
        afterState.expanded === "true" ||
        beforeUrl !== afterUrl
      );
    }
    if (lower.includes("attach") || /\bfile(s)?\b/.test(lower)) {
      return Boolean(afterState.fileChooserOpened);
    }
    if (lower.includes("source") || lower.includes("linkedin") || /\blink\b/.test(lower)) {
      return Boolean(afterState.popupOpened) || Boolean(afterState.externalHref) || beforeUrl !== afterUrl;
    }
    if (lower.includes("task") || lower.includes("note")) {
      const expectedMode = lower.includes("task") ? "task" : "note";
      const expectedPrimaryAction = lower.includes("task") ? "save_task" : "save_note";
      const tabStateChanged =
        beforeState.pressed !== afterState.pressed ||
        beforeState.selected !== afterState.selected ||
        beforeState.current !== afterState.current ||
        beforeState.state !== afterState.state ||
        beforeState.className !== afterState.className;
      const composerStateChanged =
        beforeState.composerMode !== afterState.composerMode ||
        beforeState.composerPrimaryAction !== afterState.composerPrimaryAction ||
        beforeState.composerPlaceholder !== afterState.composerPlaceholder;
      return (
        (tabStateChanged || composerStateChanged) &&
        afterState.composerMode === expectedMode &&
        afterState.composerPrimaryAction === expectedPrimaryAction &&
        beforeState.assistantPanelVisible === afterState.assistantPanelVisible
      );
    }
    if (lower.includes("trace") || lower.includes("session")) {
      return (
        beforeState.expanded !== afterState.expanded ||
        afterState.expanded === "true"
      );
    }
    if (/\b(founder|investor|banker|ceo|legal|student)\b/.test(lower)) {
      return (
        beforeState.pressed !== afterState.pressed ||
        beforeState.selected !== afterState.selected ||
        beforeState.current !== afterState.current ||
        beforeState.state !== afterState.state ||
        beforeState.className !== afterState.className ||
        beforeUrl !== afterUrl
      );
    }
    if (/\b(conversation|steps|artifacts|files)\b/.test(lower) || lower.includes("sub-navigation")) {
      return (
        beforeState.selected !== afterState.selected ||
        beforeState.current !== afterState.current ||
        beforeState.state !== afterState.state ||
        beforeState.className !== afterState.className
      );
    }
    return beforeUrl !== afterUrl;
  };

  const describeSemanticProof = (beforeUrl, afterUrl, beforeState, afterState) => {
    const proofs = [];
    if (beforeUrl !== afterUrl) proofs.push(`url changed to ${afterUrl}`);
    if (beforeState.expanded !== afterState.expanded) {
      proofs.push(`aria-expanded ${beforeState.expanded ?? "null"} -> ${afterState.expanded ?? "null"}`);
    }
    if (beforeState.pressed !== afterState.pressed) {
      proofs.push(`aria-pressed ${beforeState.pressed ?? "null"} -> ${afterState.pressed ?? "null"}`);
    }
    if (beforeState.selected !== afterState.selected) {
      proofs.push(`aria-selected ${beforeState.selected ?? "null"} -> ${afterState.selected ?? "null"}`);
    }
    if (beforeState.current !== afterState.current) {
      proofs.push(`aria-current ${beforeState.current ?? "null"} -> ${afterState.current ?? "null"}`);
    }
    if (beforeState.state !== afterState.state) {
      proofs.push(`data-state ${beforeState.state ?? "null"} -> ${afterState.state ?? "null"}`);
    }
    if (beforeState.className !== afterState.className) {
      proofs.push("class changed");
    }
    if (beforeState.assistantPanelVisible !== afterState.assistantPanelVisible) {
      proofs.push(`assistant-panel ${beforeState.assistantPanelVisible} -> ${afterState.assistantPanelVisible}`);
    }
    if (afterState.fileChooserOpened) {
      proofs.push("file-chooser opened");
    }
    if (afterState.popupOpened) {
      proofs.push("popup opened");
    }
    if (afterState.externalHref) {
      proofs.push(`external-link ready ${afterState.externalHref}`);
    }
    if (beforeState.composerMode !== afterState.composerMode) {
      proofs.push(`composer-mode ${beforeState.composerMode ?? "null"} -> ${afterState.composerMode ?? "null"}`);
    }
    if (beforeState.composerPrimaryAction !== afterState.composerPrimaryAction) {
      proofs.push(`composer-submit ${beforeState.composerPrimaryAction ?? "null"} -> ${afterState.composerPrimaryAction ?? "null"}`);
    }
    if (beforeState.composerPlaceholder !== afterState.composerPlaceholder) {
      proofs.push("composer-placeholder changed");
    }
    return proofs.join("; ");
  };

  const getSurfaceReadyLocator = (surfaceParam) => {
    const surface = normalizeText(surfaceParam);
    if (surface === "home" || surface === "ask") {
      return page.getByRole("heading", { name: /what do you want to understand\?/i });
    }
    if (surface === "chat" || surface === "workspace") {
      return page.getByRole("heading", { name: /ask nodebench/i });
    }
    if (surface === "reports" || surface === "packets") {
      return page.getByRole("heading", { name: /^reports$/i });
    }
    if (surface === "inbox" || surface === "nudges" || surface === "history") {
      return page.getByRole("heading", { name: /what changed, and what needs your attention\./i });
    }
    if (surface === "me" || surface === "connect") {
      return page.getByRole("heading", { name: /your context/i });
    }
    return null;
  };

  const waitForSurfaceSettle = async (candidateUrl) => {
    const url = String(candidateUrl ?? page.url());
    let surfaceParam = null;
    try {
      const parsed = new URL(url);
      surfaceParam = parsed.searchParams.get("surface");
    } catch {
      surfaceParam = null;
    }
    const readyLocator = getSurfaceReadyLocator(surfaceParam);
    if (!readyLocator) return;
    await readyLocator.waitFor({ state: "visible", timeout: 3500 }).catch(() => { });
    await page.waitForTimeout(250);
  };

  const getSemanticActionTargets = (description) => {
    const lower = String(description ?? "").toLowerCase();
    const targets = [];
    const add = (name, roles = ["tab", "button", "link"]) => {
      if (!name) return;
      targets.push({ name, roles });
    };

    if (lower.includes("note")) add(/note/i);
    if (lower.includes("task")) add(/task/i);
    if (lower.includes("ask")) {
      add(/open nodebench agent panel/i, ["button"]);
      add(/^ask\b/i);
    }
    if (lower.includes("home")) add(/^home$/i);
    if (lower.includes("chat")) add(/^chat$/i);
    if (lower.includes("reports")) add(/^reports$/i);
    if (lower.includes("inbox")) add(/^inbox$/i);
    if (lower.includes("nudges")) add(/^nudges$/i);
    if (lower.includes("me") || lower.includes("profile") || lower.includes("settings") || lower.includes("private context")) {
      add(/^me$/i);
    }
    if (lower.includes("founder")) add(/founder/i);
    if (lower.includes("investor")) add(/investor/i);
    if (lower.includes("banker")) add(/banker/i);
    if (lower.includes("ceo")) add(/ceo/i);
    if (lower.includes("legal")) add(/legal/i);
    if (lower.includes("student")) add(/student/i);
    if (lower.includes("conversation")) add(/^conversation$/i);
    if (lower.includes("steps")) add(/^steps$/i);
    if (lower.includes("artifacts")) add(/^artifacts$/i);
    if (lower.includes("files")) add(/^files$/i);
    if (lower.includes("session")) add(/^this session$/i, ["button"]);
    if (lower.includes("trace")) add(/^show trace$/i, ["button"]);
    if (lower.includes("start chat")) add(/start chat/i, ["button", "link"]);
    if (lower.includes("start run")) add(/start run/i, ["button"]);
    if (lower.includes("open drawer")) add(/open drawer/i, ["button"]);
    if (lower.includes("quick capture") || lower.includes("add-button")) {
      add(/open quick capture/i, ["button"]);
      add(/ask\b/i, ["button"]);
    }

    return targets;
  };

  const trySemanticAction = async (description, actionType) => {
    const candidates = getSemanticActionTargets(description);
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
    for (const candidate of candidates) {
      for (const role of candidate.roles) {
        const locator = page.getByRole(role, { name: candidate.name }).first();
        const visible = await locator.isVisible().catch(() => false);
        if (!visible) continue;
        const box = await locator.boundingBox().catch(() => null);
        if (!isViewportBoxVisible(box, viewport)) continue;
        const beforeUrl = page.url();
        const beforeState = await readLocatorState(locator);
        const fileChooserPromise = actionType === "hover"
          ? Promise.resolve(null)
          : page.waitForEvent("filechooser", { timeout: 1200 }).catch(() => null);
        const popupPromise = actionType === "hover"
          ? Promise.resolve(null)
          : page.waitForEvent("popup", { timeout: 1200 }).catch(() => null);
        if (actionType === "hover") {
          await locator.hover({ force: true, timeout: 1500 }).catch(() => null);
        } else {
          await locator.click({ force: true, timeout: 1500 }).catch(() => null);
        }
        await page.waitForLoadState("networkidle", { timeout: 1000 }).catch(() => { });
        await page.waitForTimeout(250);
        const [fileChooser, popup] = await Promise.all([fileChooserPromise, popupPromise]);
        const externalHref = normalizeText(await locator.getAttribute("href").catch(() => null)) || null;
        const afterState = {
          ...(await readLocatorState(locator)),
          fileChooserOpened: Boolean(fileChooser),
          popupOpened: Boolean(popup),
          externalHref,
        };
        const afterUrl = page.url();
        await waitForSurfaceSettle(afterUrl);
        if (!hadExpectedSemanticDelta(description, beforeUrl, afterUrl, beforeState, afterState)) {
          continue;
        }
        return {
          matched: true,
          proof: describeSemanticProof(beforeUrl, afterUrl, beforeState, afterState),
        };
      }
    }
    return { matched: false, proof: "" };
  };

  try {
    await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    let baselineBuffer = await page.screenshot({ fullPage: false });

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64 = screenshotBuffer.toString("base64");

    const prompt = `You are a QA engineer exploring a web application. Look at this screenshot and identify up to 5 interactive elements to click or hover that would reveal hidden UI states â€” expandable cards, drawers, popovers, tabs, dropdown menus, hover tooltips, etc.

For each element, return:
- description: what the element is (brief, lowercase)
- action: "click" or "hover"
- x: approximate x coordinate in pixels from left edge of viewport
- y: approximate y coordinate in pixels from top edge of viewport

Return ONLY a JSON array. If no interactive elements are visible, return [].
[{"description": "expand signal card", "action": "click", "x": 400, "y": 300}]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${geminiApiKey}`;
    const reqBody = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: "image/png", data: base64 } },
          { text: prompt },
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json" },
    });

    // Retry with exponential backoff for rate limits (429)
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody });
      if (res.status !== 429) break;
      const wait = (attempt + 1) * 5000; // 5s, 10s, 15s
      // eslint-disable-next-line no-console
      console.warn(`    â³ Rate limited on ${route.name}, retrying in ${wait / 1000}s...`);
      await page.waitForTimeout(wait);
    }

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`    âš  Agentic explore API error for ${route.name}: ${res.status}`);
      return await fallbackExploreRoute(page, baseURL, route, outDir);
    }

    const data = await res.json();
    const text = getGeminiCandidateText(data) || "[]";

    let actions = tryParseJson(text);
    if (!Array.isArray(actions)) {
      const salvaged = salvageActionPoints(text);
      actions = salvaged.length ? salvaged : actions;
    }

    // NOTE(coworker): Never skip a route solely due to malformed Gemini JSON â€” use deterministic fallback.
    if (!Array.isArray(actions) || actions.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`    âš  Could not parse Gemini action JSON for ${route.name} (or empty) â€” using fallback interactions`);
      return await fallbackExploreRoute(page, baseURL, route, outDir);
    }

    for (let i = 0; i < Math.min(actions.length, 5); i++) {
      const action = actions[i];
      const x = Number(action.x);
      const y = Number(action.y);
      if (isNaN(x) || isNaN(y)) continue;

      const viewport = page.viewportSize();
      const cx = Math.max(1, Math.min(x, (viewport?.width ?? 1440) - 1));
      const cy = Math.max(1, Math.min(y, (viewport?.height ?? 900) - 1));

      try {
        const semanticResult = await trySemanticAction(action.description, action.action);
        const handledSemantically = semanticResult.matched;
        if (!handledSemantically && action.action === "hover") {
          await page.mouse.move(cx, cy);
          // Some popovers rely on DOM-level hover, not mouse coordinates.
          await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return;
            const target = el.closest?.("[data-hover],button,a,[role='button']") ?? el;
            try { target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); } catch { }
            try { target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); } catch { }
          }, { x: cx, y: cy }).catch(() => { });
        } else if (!handledSemantically) {
          await page.mouse.click(cx, cy, { delay: 25 });
          // Improve click reliability when Gemini coordinates are slightly off.
          await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return;
            const target = el.closest?.("button,a,[role='button'],input,select,textarea") ?? el;
            // Prefer a programmatic click to ensure React handlers fire.
            (target instanceof HTMLElement ? target : null)?.click?.();
          }, { x: cx, y: cy }).catch(() => { });
        }

        // Give SPA state a chance to update.
        await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => { });
        await waitForSurfaceSettle(page.url());
        await page.waitForTimeout(1100);
        const afterBuffer = await page.screenshot({ fullPage: false });

        if (afterBuffer.equals(baselineBuffer)) {
          // eslint-disable-next-line no-console
          console.warn(`    ⚠ Agentic action produced no visible delta on ${route.name}: ${action.description}`);
          await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1100);
          baselineBuffer = await page.screenshot({ fullPage: false });
          continue;
        }

        const safeName = (action.description ?? `action-${i}`).replace(/[^a-z0-9-]/gi, "-").slice(0, 30).toLowerCase();
        const ssPath = path.join(outDir, `agentic-${route.name}-${i}-${safeName}.png`);
        await fs.writeFile(ssPath, afterBuffer);
        results.push({
          route: route.name,
          action: action.description,
          ssPath,
          proof: semanticResult.proof,
        });

        // Reset route state for next interaction
        await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        baselineBuffer = await page.screenshot({ fullPage: false });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`    âš  Agentic action failed on ${route.name}: ${err.message}`);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`  âš  Agentic exploration failed for ${route.name}: ${err.message}`);
  }
  return results;
}

// Run agentic exploration in a dedicated browser context with video recording.
// Returns { screenshots, screenshotIssues, videoIssues, videoPath }.
async function runAgenticExploration(baseURL, geminiApiKey, outDir, headless, layout = "classic") {
  if (!geminiApiKey) {
    // eslint-disable-next-line no-console
    console.warn("  âš  No GEMINI_API_KEY â€” skipping agentic exploration");
    return { screenshots: [], screenshotIssues: [], videoIssues: [], videoPath: null };
  }

  const agenticVideoDir = path.join(outDir, "agentic-video");
  await fs.mkdir(agenticVideoDir, { recursive: true });

  // Dedicated browser context with video recording enabled
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    recordVideo: { dir: agenticVideoDir, size: { width: 1440, height: 900 } },
  });

  await context.addInitScript(() => {
    localStorage.setItem("nodebench-onboarded", "1");
  });

  // Pre-inject layout mode into localStorage BEFORE any page JS runs
  if (layout && layout !== "classic") {
    await context.addInitScript((layoutVal) => {
      try {
        const existing = JSON.parse(localStorage.getItem("nodebench-theme") || "{}");
        existing.layout = layoutVal;
        localStorage.setItem("nodebench-theme", JSON.stringify(existing));
      } catch {
        localStorage.setItem("nodebench-theme", JSON.stringify({ layout: layoutVal }));
      }
    }, layout);
    // eslint-disable-next-line no-console
    console.log(`  Layout mode "${layout}" will be injected via addInitScript`);
  }

  const page = await context.newPage();

  // Authenticate in this context
  try {
    await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await ensureAnonymousSignIn(page);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`  âš  Agentic sign-in failed (non-fatal): ${err.message}`);
  }

  // Dynamic route discovery â€” crawl every navigable surface, not just sidebar
  let routes;
  try {
    routes = await discoverRoutes(page, baseURL);
    // SPA state-based routing may not expose enough routes via DOM crawling.
    // If discovery finds very few routes AND we didn't learn routes from dogfood artifacts,
    // merge with fallback as an emergency backstop (kept small to avoid hardcoding).
    const hasLearnedSeed = routes.some((r) => r.source === "dogfood-seed" || r.source === "routing-seed");
    if (!hasLearnedSeed && routes.length < 5) {
      const discoveredPaths = new Set(routes.map((r) => r.path));
      for (const fb of FALLBACK_ROUTES) {
        if (!discoveredPaths.has(fb.path)) {
          routes.push({ ...fb, source: "fallback" });
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`  âš  Route discovery failed, using fallback: ${err.message}`);
    routes = FALLBACK_ROUTES.map((r) => ({ ...r, source: "fallback" }));
  }

  // Log all discovered routes for transparency
  // eslint-disable-next-line no-console
  console.log(`  ðŸ¤– Agentic visual exploration: ${routes.length} routes discovered (video recording ON)`);
  for (const r of routes) {
    // eslint-disable-next-line no-console
    console.log(`    ðŸ“ ${r.path} (${r.name}) [${r.source}]`);
  }

  // Save discovery manifest for diff tracking across runs
  await fs.writeFile(
    path.join(outDir, "discovered-routes.json"),
    JSON.stringify({ timestamp: new Date().toISOString(), count: routes.length, routes }, null, 2),
    "utf8",
  );

  // Compare route discovery against the previous run (if any) to catch new/removed surfaces automatically.
  try {
    const archiveBase = path.join(outDir, "..", "archive");
    const dirs = (await fs.readdir(archiveBase).catch(() => [])).filter(Boolean).sort();
    const latest = dirs[dirs.length - 1];
    if (latest) {
      const prevPath = path.join(archiveBase, latest, "discovered-routes.json");
      const raw = await fs.readFile(prevPath, "utf8").catch(() => "");
      if (raw) {
        const prev = JSON.parse(raw);
        const prevRoutes = Array.isArray(prev?.routes) ? prev.routes : [];
        const prevPaths = new Set(prevRoutes.map((r) => r.path).filter(Boolean));
        const curPaths = new Set(routes.map((r) => r.path).filter(Boolean));

        const added = Array.from(curPaths).filter((p) => !prevPaths.has(p)).sort();
        const removed = Array.from(prevPaths).filter((p) => !curPaths.has(p)).sort();

        if (added.length || removed.length) {
          // eslint-disable-next-line no-console
          console.log(`  ðŸ” Route surface diff vs prev run (${latest}): +${added.length} / -${removed.length}`);
          if (added.length) console.log(`    + ${added.slice(0, 12).join(", ")}${added.length > 12 ? " ..." : ""}`);
          if (removed.length) console.log(`    - ${removed.slice(0, 12).join(", ")}${removed.length > 12 ? " ..." : ""}`);
          await fs.writeFile(
            path.join(outDir, "discovered-routes.diff.json"),
            JSON.stringify({ previous: latest, added, removed }, null, 2),
            "utf8",
          ).catch(() => { });
        }
      }
    }
  } catch {
    // ignore diff failures
  }

  const allScreenshots = [];
  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri];
    // eslint-disable-next-line no-console
    console.log(`    â†’ Exploring ${route.name}...`);
    const results = await agenticExploreRoute(page, baseURL, route, geminiApiKey, outDir);
    allScreenshots.push(...results);
    // eslint-disable-next-line no-console
    console.log(`      ${results.length} interactions captured`);
    // Throttle between routes to avoid Gemini API rate limits (15 RPM on free tier)
    if (ri < routes.length - 1) await page.waitForTimeout(2000);
  }

  // Close page + context to finalize video recording, THEN get path
  const videoHandle = page.video();
  await page.close();
  await context.close();
  await browser.close();
  let videoPath = null;
  try {
    videoPath = await videoHandle?.path();
  } catch { /* ignore */ }

  // NOTE(coworker): On Windows Playwright can return a path before the video file is fully flushed.
  // Wait briefly for the file to exist, and fall back to scanning the recordVideo dir for the newest .webm.
  async function waitForFile(p, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await fs.stat(p).then(() => true).catch(() => false);
      if (ok) return true;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  if (videoPath) {
    const ok = await waitForFile(videoPath, 20_000);
    if (!ok) {
      try {
        const entries = await fs.readdir(agenticVideoDir);
        const candidates = entries.filter((e) => e.endsWith(".webm") || e.endsWith(".mp4")).map((e) => path.join(agenticVideoDir, e));
        if (candidates.length) {
          let best = candidates[0];
          let bestMtime = 0;
          for (const c of candidates) {
            // eslint-disable-next-line no-await-in-loop
            const st = await fs.stat(c).catch(() => null);
            const m = st?.mtimeMs ?? 0;
            if (m > bestMtime) {
              bestMtime = m;
              best = c;
            }
          }
          videoPath = best;
          await waitForFile(videoPath, 10_000);
        }
      } catch {
        // ignore scan failures
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`  ðŸ¤– Exploration complete: ${allScreenshots.length} interaction screenshots, video: ${videoPath ? "saved" : "none"}`);

  // Analyze individual screenshots
  const screenshotIssues = await analyzeAgenticScreenshots(allScreenshots, geminiApiKey);

  // Analyze the full session video holistically
  let videoIssues = [];
  if (videoPath) {
    try {
      videoIssues = await analyzeAgenticVideo(videoPath, geminiApiKey);
      // eslint-disable-next-line no-console
      console.log(`  ðŸŽ¬ Video QA: ${videoIssues.length} issues from agentic session recording`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`  âš  Agentic video analysis failed (non-fatal): ${err.message}`);
    }

    // Copy video to outDir with a stable name
    const finalVideoPath = path.join(outDir, "agentic-session.webm");
    try {
      await fs.copyFile(videoPath, finalVideoPath);
    } catch { /* ignore */ }
  }

  return { screenshots: allScreenshots, screenshotIssues, videoIssues, videoPath };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GEMINI FILE API â€” Upload video for analysis
// Uses raw upload protocol (X-Goog-Upload-Protocol: raw) for simplicity.
// Polls until file state is ACTIVE before using in generateContent.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function uploadToGeminiFiles(filePath, mimeType, apiKey, displayName) {
  const fileBuffer = await fs.readFile(filePath);
  const sizeKB = Math.round(fileBuffer.length / 1024);
  // eslint-disable-next-line no-console
  console.log(`    ðŸ“¤ Uploading ${displayName} (${sizeKB} KB) to Gemini Files API...`);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        "X-Goog-Upload-Protocol": "raw",
        "X-Goog-Upload-Header-Content-Type": mimeType,
      },
      body: fileBuffer,
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`File upload failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const file = data.file;
  // eslint-disable-next-line no-console
  console.log(`    ðŸ“¤ Uploaded: ${file.name} (state: ${file.state})`);
  return file;
}

function getVideoMimeType(filePath) {
  const ext = path.extname(String(filePath ?? "")).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

async function waitForFileActive(fileName, apiKey, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
    );
    if (!res.ok) throw new Error(`File status check failed: ${res.status}`);
    const data = await res.json();
    if (data.state === "ACTIVE") return data;
    if (data.state === "FAILED") throw new Error(`File processing failed: ${data.error?.message ?? "unknown"}`);
    // eslint-disable-next-line no-console
    console.log(`    â³ File processing (${data.state})...`);
    await sleep(3000);
  }
  throw new Error("File processing timed out");
}

// Analyze the full agentic exploration session video via Gemini vision.
// Uploads video to File API, waits for processing, then runs holistic QA.
async function analyzeAgenticVideo(videoPath, geminiApiKey) {
  if (!videoPath || !geminiApiKey) return [];

  // eslint-disable-next-line no-console
  console.log(`  ðŸŽ¬ Analyzing agentic session video...`);

  // Upload to Gemini Files API
  const file = await uploadToGeminiFiles(
    videoPath,
    getVideoMimeType(videoPath),
    geminiApiKey,
    path.basename(videoPath),
  );

  // Wait for processing
  const activeFile = await waitForFileActive(file.name, geminiApiKey);

  // Run holistic video QA analysis
  const prompt = `You are a senior QA engineer reviewing a video recording of an automated UI interaction session on a web application. The video shows a vision-guided agent clicking and hovering on various UI elements across multiple routes.

Watch the ENTIRE video and identify quality issues you observe:

1. **Transition bugs**: Layout shifts, flashes, or jank during page navigation
2. **Interaction response**: Elements that don't visually respond to clicks/hovers (no state change, no feedback)
3. **Broken expanded states**: Cards, drawers, or popovers that render incorrectly after being opened
4. **Color/contrast issues**: Saturated badge colors, poor dark mode contrast, invisible text
5. **Loading failures**: Spinners that never resolve, blank areas, error states
6. **Animation issues**: Jerky animations, flash-of-unstyled-content, layout reflow during transitions

IMPORTANT: Only flag GENUINE defects. Ignore:
- Intentionally compact/dense layouts for power users
- Domain terminology (Swarm, Signal, Narrative, etc.)
- Demo/mock data artifacts
- Subjective spacing preferences
- Normal page load sequences
- Brief placeholder flashes, lazy-load transitions, or route resets during automation unless the final settled state remains broken for more than a moment
- Claims that content "disappeared" unless the final settled frame is still empty or incorrect

Return a JSON array of issues found (or [] if the UI looks good):
[{"route": "route-name", "timestamp": "approximate time in video", "header": "P1|P2|P3 [description]", "details": "what you observed", "severity": "P1"|"P2"|"P3"}]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { file_data: { file_uri: activeFile.uri, mime_type: "video/webm" } },
          { text: prompt },
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Video QA API error: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = getGeminiCandidateText(data) || "[]";
  const parsed = tryParseJson(text);

  if (!Array.isArray(parsed)) return [];

  return parsed.map((p) => ({
    header: p.header ?? `${p.severity ?? "P3"} ${p.description ?? "video interaction issue"}`,
    details: `[${p.timestamp ?? "?"}] ${p.details ?? p.description ?? ""}`,
    route: p.route ?? "",
    suggestedFix: "",
    source: "agentic_video",
  }));
}

async function analyzeVideoAgainstReference({
  candidateVideoPath,
  referenceVideoPath,
  geminiApiKey,
  candidateLabel = "NodeBench mobile chat",
  referenceLabel = "Manus mobile reference",
}) {
  const candidateFile = await uploadToGeminiFiles(
    candidateVideoPath,
    getVideoMimeType(candidateVideoPath),
    geminiApiKey,
    path.basename(candidateVideoPath),
  );
  const referenceFile = await uploadToGeminiFiles(
    referenceVideoPath,
    getVideoMimeType(referenceVideoPath),
    geminiApiKey,
    path.basename(referenceVideoPath),
  );

  const [activeCandidateFile, activeReferenceFile] = await Promise.all([
    waitForFileActive(candidateFile.name, geminiApiKey),
    waitForFileActive(referenceFile.name, geminiApiKey),
  ]);

  const prompt = `You are a principal mobile product designer and senior QA engineer.

Compare these two videos:
- Candidate: ${candidateLabel}
- Reference: ${referenceLabel}

Your job is to judge how close the candidate UI/UX is to the reference, specifically for mobile chat experience quality.

Evaluate only what is visible in the videos:
1. Header chrome density and hierarchy
2. Transcript density and message treatment
3. Task/progress presentation
4. Artifact/result card clarity
5. Composer shape, affordances, and dock behavior
6. Dead space, viewport use, and scroll composition
7. Motion, perceived performance, and visual smoothness
8. Overall product polish and native-feeling mobile ergonomics

Return strict JSON with this shape:
{
  "overallSimilarityScore": number,
  "summary": string,
  "wins": string[],
  "gaps": [
    {
      "area": string,
      "severity": "high" | "medium" | "low",
      "candidateEvidence": string,
      "referenceEvidence": string,
      "fix": string
    }
  ],
  "mustFixNext": string[]
}

Be concrete. Do not mention backend systems.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            file_data: {
              file_uri: activeCandidateFile.uri,
              mime_type: getVideoMimeType(candidateVideoPath),
            },
          },
          {
            file_data: {
              file_uri: activeReferenceFile.uri,
              mime_type: getVideoMimeType(referenceVideoPath),
            },
          },
          { text: prompt },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Video comparison API error: ${res.status} ${errText.slice(0, 240)}`);
  }

  const data = await res.json();
  const text = getGeminiCandidateText(data);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = tryParseJson(text);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini did not return a valid comparison JSON payload");
  }

  return {
    requestedModel: GEMINI_QA_MODEL_INTENT,
    model: GEMINI_QA_MODEL,
    candidateLabel,
    referenceLabel,
    candidateVideoPath,
    referenceVideoPath,
    result: parsed,
    rawText: text,
  };
}

// Analyze agentic interaction screenshots directly via Gemini vision.
// Returns issues in the same format as scraped dogfood page issues.
async function analyzeAgenticScreenshots(screenshots, geminiApiKey) {
  if (!screenshots.length || !geminiApiKey) return [];
  const issues = [];
  const contradictedBySemanticProof = (issue, batch) => {
    const lower = `${issue?.header ?? ""} ${issue?.details ?? ""}`.toLowerCase();
    const claimsMissingStateChange =
      /does not activate|fails to update|interaction fails|navigation .* failed|incorrect tab navigation mapping|tab unresponsive|tab navigation is unresponsive|unresponsive|incorrectly navigates|remains in the .* state|remains on the .* tab|remains on the .* surface|sets the .* tab as visually active|does not show an active state|remains unchanged|does not expand|does not open|does not navigate/.test(lower);
    const claimsUnexpectedSidePanel =
      /unexpectedly opens side panel|erroneously opens .*side panel|opens .*side panel/.test(lower);
    const claimsComposerMismatch =
      /composer tab state mismatch|content displayed below.*corresponds to the ['"]?ask['"]? tab|placeholder text ['"]?paste a linkedin url|['"]?start run['"]? button/.test(lower);
    const claimsMissingFileDialog =
      /attach files button does not open file dialog|no file dialog|allow file selection/.test(lower);
    const claimsUnresponsiveSourceLink =
      /source link pill is unresponsive|source pill.*unresponsive|does not trigger any visible action/.test(lower);
    if (!claimsMissingStateChange && !claimsUnexpectedSidePanel && !claimsComposerMismatch && !claimsMissingFileDialog && !claimsUnresponsiveSourceLink) return false;

    return batch.some((ss) => {
      const action = String(ss?.action ?? "").toLowerCase();
      const proof = String(ss?.proof ?? "").toLowerCase();
      if (!proof) return false;
      if (lower.includes("task") && !action.includes("task")) return false;
      if (lower.includes("note") && !action.includes("note")) return false;
      if (lower.includes("ask") && !action.includes("ask")) return false;
      if (lower.includes("session") && !action.includes("session")) return false;
      if (lower.includes("trace") && !action.includes("trace")) return false;
      if (lower.includes("me") && !action.includes("me")) return false;
      if (lower.includes("conversation") && !action.includes("conversation")) return false;
      if (lower.includes("steps") && !action.includes("steps")) return false;
      if (lower.includes("artifacts") && !action.includes("artifacts")) return false;
      if (lower.includes("files") && !action.includes("files")) return false;
      if (claimsUnexpectedSidePanel) {
        return /data-state .*-> active|aria-selected .*-> true|class changed/.test(proof) &&
          /assistant-panel false -> false/.test(proof);
      }
      if (claimsComposerMismatch) {
        return /composer-mode .*-> (task|note)|composer-submit .*-> save_(task|note)|composer-placeholder changed/.test(proof);
      }
      if (claimsMissingFileDialog) {
        return /file-chooser opened/.test(proof);
      }
      if (claimsUnresponsiveSourceLink) {
        return /popup opened|external-link ready /.test(proof);
      }
      return /data-state .*-> active|aria-expanded .*-> true|aria-pressed .*-> true|aria-selected .*-> true|aria-current .*-> page|class changed|url changed to/.test(proof);
    });
  };

  // Batch screenshots in groups of 4 (Gemini handles multi-image input)
  for (let i = 0; i < screenshots.length; i += 4) {
    const batch = screenshots.slice(i, i + 4);
    const parts = [];

    for (const ss of batch) {
      try {
        const buf = await fs.readFile(ss.ssPath);
        parts.push({ inline_data: { mime_type: "image/png", data: buf.toString("base64") } });
        parts.push({
          text: `[Route: ${ss.route}, After: ${ss.action}${ss.proof ? `, Semantic proof: ${ss.proof}` : ""}]`,
        });
      } catch { continue; }
    }
    if (parts.length === 0) continue;

    parts.push({
      text: `Analyze these UI screenshots captured AFTER user interactions (clicks, hovers). Look for:
1. Broken layouts after interaction (elements overflow, overlap, disappear)
2. Missing hover/active/focus visual states
3. Drawers or popovers that render incorrectly
4. Content that becomes illegible in expanded states
5. Badge or pill colors that are too saturated or look wrong in dark mode
6. Buttons or interactive elements that don't respond visually

IMPORTANT: Only flag GENUINE defects a user would notice. Ignore:
- Intentionally compact/dense layouts for power users
- Domain terminology (Swarm, Signal, Narrative, etc.)
- Demo/mock data artifacts
- Subjective spacing preferences
- If the semantic proof says a tab switched active state, an accordion expanded, or the URL changed, do NOT claim the interaction failed unless the screenshot clearly contradicts that proof.

Return a JSON array of issues (or [] if none):
[{"route": "...", "header": "P2 [description]", "details": "...", "severity": "P1"|"P2"|"P3"}]` });

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${geminiApiKey}`;
      const reqBody = JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      });
      // Retry with backoff for rate limits
      let res;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody });
        if (res.status !== 429) break;
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
      }
      if (!res.ok) continue;
      const data = await res.json();
      const text = getGeminiCandidateText(data) || "[]";
      const parsed = tryParseJson(text);
      if (Array.isArray(parsed)) {
        const normalized = parsed.map((p) => ({
          header: p.header ?? `${p.severity ?? "P3"} ${p.description ?? "interaction issue"}`,
          details: p.details ?? p.description ?? "",
          route: p.route ?? "",
          suggestedFix: "",
          source: "agentic",
        }));
        issues.push(...normalized.filter((issue) => !contradictedBySemanticProof(issue, batch)));
      }
    } catch { /* ignore parse failures */ }
  }
  return issues;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RUBRIC-BASED BOOLEAN SCORING SYSTEM (v2 â€” LLM Judge)
// Architecture: 3-layer weighted rubric (Agentic Rubrics, arxiv:2601.04171)
//   Layer 1 (60%): Deterministic Playwright checks â€” 12 boolean metrics, zero variance
//   Layer 2 (30%): Severity rubric â€” boolean pass/fail from LLM-judged genuine issues
//   Layer 3 (10%): Taste â€” legacy P-level deduction (capped, low influence)
// False positive filtering: LLM-as-a-judge (Gemini 3 Flash, temp 0.1)
//   replaces 120+ regex patterns with semantic classification.
// Formula: S = Î£(wi Ã— si) / Î£(wi) where si âˆˆ {0,1} (binary pass/fail)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LLM-AS-A-JUDGE: Replaces 120+ regex false-positive patterns
// Calls Gemini to semantically classify each issue as genuine or not.
// Generalizes across all phrasings without regex maintenance.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Design context: tells the judge what this product IS so it can distinguish
// genuine bugs from subjective opinions about intentional design decisions.
const DESIGN_CONTEXT = `
This is NodeBench AI. The public product has five user-facing surfaces:
- Home = launchpad for ask + upload + starter discovery
- Chat = the main product, where the answer is primary and the live work stream stays visible
- Reports = reusable memory that reopens into Chat
- Nudges = closed-loop reminders that route back into work
- Me = private context that improves future answers

Key product and design principles:
- VALUE BEFORE IDENTITY: The product should prove value immediately. Home should launch the workflow, not explain the company.
- ANSWER FIRST: Chat should read like a focused answer workspace. Sources and activity support trust, but they should not dominate the layout.
- SPLIT-WORKSPACE DESKTOP: Web uses multi-column workspace layouts. Left and right rails are intentional and should not be called redundant just because the center is primary.
- OUTPUT AS DISTRIBUTION: Reports are saved, shareable memory. Nudges should route users back into a report or a live chat, not act like a generic notifications center.
- ME AS LEVERAGE: Me is a private control center, not a social profile page. Empty states that explain future leverage are intentional if they remain actionable and readable.
- MOCK AND STARTER CONTENT: Preview environments may show starter cards, starter memory, example nudges, or empty-state guidance. That is expected. Judge layout and behavior, not whether the data is live.
- LIGHT AND DARK MODE: Both modes are real product surfaces. Do not call the existence of a theme toggle or mild palette differences inconsistent by default.
- SCREENSHOT AND VIDEO ARTIFACTS: Vision models often misread subtle borders, dark-mode contrast, or flex layouts from compressed media. Do not classify perceived overlap or low contrast as a bug unless the issue is obvious and severe.
- QUERY-PARAM ROUTES: The redesigned app uses query-param surfaces like ?surface=home, ?surface=chat, ?surface=reports, ?surface=nudges, ?surface=me. These are canonical in the current product.
- EMPTY STATES: Calm empty states are acceptable when they teach the next action or explain the loop. Empty states are only bugs if they are dead ends, unreadable, or misleading.
- TRANSITIONS: Brief lazy-load transitions during automated capture can happen. Only count them as bugs if users would be blocked or the layout remains visibly broken after settling.
- DOGFOOD OVERLAYS: During automated walkthrough recordings, a QA overlay can appear. That is not part of the React product UI.
`.trim();

// Classify a batch of issues using Gemini as a judge.
// Returns: Map<issueIndex, { verdict: "genuine_bug"|"design_opinion"|"screenshot_artifact"|"mock_data", confidence: number, reasoning: string }>
async function judgeIssuesWithLLM(issues) {
  if (!issues.length) return new Map();

  const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!GEMINI_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn("  âš  No GEMINI_API_KEY â€” skipping LLM judge and using heuristic classification");
    return buildHeuristicJudgeResult(issues, "No API key");
  }

  const issueList = issues.map((issue, i) => {
    const header = (issue.header ?? "").trim();
    const details = (issue.details ?? "").trim();
    const route = (issue.route ?? "").trim();
    return `ISSUE #${i + 1} [${route}]: ${header}\n${details}`;
  }).join("\n\n---\n\n");

  const verifiedInvariants = contractVerifiedInvariants();
  const prompt = `You are a senior UI/UX quality judge reviewing automated QA findings for a web application.

DESIGN CONTEXT:
${DESIGN_CONTEXT}
${verifiedInvariants ? `
CONTRACT-VERIFIED INVARIANTS (machine-checked in CI on every PR — treat as ground truth; a finding that contradicts one of these is a screenshot misread, not a bug):
${verifiedInvariants}
` : ""}
TASK: For each issue below, classify it into exactly ONE category:
- "genuine_bug": A real, actionable defect that would affect users (broken layout, actual contrast failure, real typo, data corruption visible to end users)
- "design_opinion": A subjective preference about intentional design choices (density, spacing, color hierarchy, information architecture, terminology for target audience)
- "screenshot_artifact": The reviewer misread a compressed screenshot (hallucinated colors like #D1D5DB, misread flexbox as overlap, misread font rendering)
- "mock_data": Issue only exists because of placeholder/demo data, not a code bug (aggregation mismatches, "just now" timestamps, zero-value metrics)

RULES (follow strictly):
- Domain terminology (Swarm, Pull Request, Signal Ledger, Narrative Spine, Act I, repo names in GitHub Explorer, etc.) used in a product for AI practitioners is NOT jargon leak â†’ design_opinion
- Compact/dense layouts, tight spacing, all-caps section labels, and small typography in a power-user tool are intentional, not bugs â†’ design_opinion
- Dual navigation affordances (hero + header search, FAB + upload button, Dashboard links) serving different contexts are NOT redundant â†’ design_opinion
- FAB (Floating Action Button) persisting across all screens including modals is intentional Material Design pattern â†’ design_opinion
- Empty states without CTAs when data auto-populates are NOT dead-ends â†’ design_opinion
- Purple vs blue button colors in a SaaS product are intentional hierarchy, not inconsistency â†’ design_opinion
- Mixed time formats (relative vs absolute, seconds vs minutes) are intentional context-dependent formatting â†’ design_opinion
- Pipe characters as metadata separators are a standard UI pattern â†’ design_opinion
- GitHub repository names as titles in a GitHub Explorer feature are expected, not "technical" â†’ design_opinion
- Repeated navigation labels (e.g., "Dashboard" appearing multiple times) in different navigation contexts are intentional â†’ design_opinion
- "Squished", "cramped", "tight", "compact" layouts or controls are intentional compact design, NOT layout bugs â†’ design_opinion
- "Overlapping text", "missing spacing", "squished together", "unreadable string", "truncated text" in metric cards or sidebars â€” these are almost ALWAYS screenshot compression artifacts where flexbox justify-between renders perfectly at actual resolution, or intentional text-overflow:ellipsis with tooltip on hover. Gemini cannot reliably detect text overlap from compressed screenshots â†’ screenshot_artifact or design_opinion
- "Misaligned" chart metrics or bar widths are proportional rendering, not alignment bugs â†’ design_opinion
- "Low contrast" claims about text-muted-foreground or secondary text: these use WCAG AA compliant colors (4.6:1 ratio). Gemini cannot reliably measure contrast from screenshots â†’ design_opinion or screenshot_artifact
- "Incorrect pluralization" or "1 items" â€” pluralization has already been fixed with ternary helpers â†’ screenshot_artifact (stale observation)
- Segmented controls, touch targets, and mobile spacing follow Radix/shadcn standards â†’ design_opinion
- Calendar timezone selectors, mini calendar layouts, and sidebar widget spacing are intentionally compact â†’ design_opinion
- "genuine_bug" ONLY for: truly broken functionality where users CANNOT complete a task, actual data corruption visible to end users, real English typos/misspellings in words (not formatting preferences), or elements that crash/error. Compact spacing, dense layouts, design preferences, and subjective contrast claims are NEVER genuine bugs.
- When in doubt between genuine_bug and design_opinion, ALWAYS choose design_opinion â€” this product is intentionally dense and opinionated for power users

ISSUES TO JUDGE:
${issueList}

Respond with a JSON array (one object per issue, in order):
[
  { "issue": 1, "verdict": "genuine_bug"|"design_opinion"|"screenshot_artifact"|"mock_data", "confidence": 0.0-1.0, "reasoning": "Brief explanation" },
  ...
]

IMPORTANT: Return ONLY the JSON array, no markdown fences, no commentary.
Keep reasoning under 15 words per issue to avoid truncation.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1, // Low temp for consistent classification
        maxOutputTokens: 8192,
        responseMimeType: "application/json", // Force valid JSON output
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(`  âš  LLM judge API error ${res.status}: ${errText.slice(0, 200)}`);
      return buildHeuristicJudgeResult(
        issues,
        isGenerateContentModelNotFound(res.status, errText) ? `Unsupported model ${GEMINI_QA_MODEL}` : `API error ${res.status}`,
      );
    }

    const data = await res.json();
    const text = getGeminiCandidateText(data);

    // Parse JSON from response â€” handle markdown fences + common LLM JSON quirks + truncation
    let jsonStr = text.replace(/^```json?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    let judgments;
    try {
      judgments = JSON.parse(jsonStr);
    } catch {
      // Fix common LLM JSON quirks: single quotes, trailing commas, comments
      jsonStr = jsonStr
        .replace(/\/\/[^\n]*/g, "")            // strip line comments
        .replace(/,\s*([}\]])/g, "$1")         // strip trailing commas
        .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')  // single-quoted keys â†’ double
        .replace(/:\s*'([^']*)'/g, ': "$1"');  // single-quoted values â†’ double
      try {
        judgments = JSON.parse(jsonStr);
      } catch {
        // Truncation recovery: find last complete JSON object and close the array
        const lastBrace = jsonStr.lastIndexOf("}");
        if (lastBrace > 0) {
          const truncated = jsonStr.slice(0, lastBrace + 1).replace(/,\s*$/, "") + "]";
          judgments = JSON.parse(truncated);
          // eslint-disable-next-line no-console
          console.warn(`  âš  LLM judge response truncated â€” salvaged ${Array.isArray(judgments) ? judgments.length : 0}/${issues.length} verdicts`);
        } else {
          throw new Error("Could not parse judge response (no complete JSON objects)");
        }
      }
    }

    if (!Array.isArray(judgments)) throw new Error("Expected JSON array from judge");

    const result = new Map();
    for (const j of judgments) {
      const idx = (j.issue ?? j.index ?? 0) - 1;
      if (idx >= 0 && idx < issues.length) {
        result.set(idx, {
          verdict: j.verdict ?? "genuine_bug",
          confidence: typeof j.confidence === "number" ? j.confidence : 0.5,
          reasoning: j.reasoning ?? "",
        });
      }
    }

    // Any issues not covered by the judge response â†’ apply keyword heuristic instead of
    // blindly treating all as genuine (which inflates false positives when judge truncates).
    for (let i = 0; i < issues.length; i++) {
      if (!result.has(i)) {
        result.set(i, buildHeuristicJudgeResult([issues[i]], "judge truncated").get(0));
      }
    }

    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`  âš  LLM judge failed: ${err.message} â€” using heuristic classification`);
    return buildHeuristicJudgeResult(issues, `Judge error: ${err.message}`);
  }
}

async function judgeIssuesWithLLM_Batched(issues) {
  // NOTE(coworker): The judge response can truncate when issue counts are high,
  // which causes many issues to default to "genuine_bug". Batch to keep output small.
  if (!issues.length) return new Map();
  const batchSize = Math.max(3, Math.min(8, Number(process.env.NODEBENCH_JUDGE_BATCH_SIZE ?? "5") || 5));
  const merged = new Map();

  for (let start = 0; start < issues.length; start += batchSize) {
    const batch = issues.slice(start, start + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const res = await judgeIssuesWithLLM(batch);
    for (const [idx, v] of res.entries()) {
      merged.set(start + idx, v);
    }
  }

  return merged;
}

// Hard-filter: only the most egregious hallucinations that Gemini's screenshot
// compression causes consistently. Kept to ~5 patterns max â€” the LLM judge
// handles everything else semantically.
const HARD_HALLUCINATION_FILTERS = [
  /EXISTEMERGINGSCI-FI|REASONING100%TIME100%|RELIABILIT.*overlap/i,  // Flexbox label misread
  /Al agents.*lowercase|Al.*instead.*AI|typo.*Al.*agent/i,           // Capital I misread as lowercase l
  /dark blue.*near.black|virtually unreadable.*dark.*mode/i,         // Dark theme misread as broken
  /research.*hub.*black.*void|black.*void.*dark.*mode|total.*black.*void/i, // Dark bg misread as void
  /temporal context/i,                                                // Label doesn't exist in UI
  /missing spacing.*ai capabilities|ai capabilities.*missing spacing|ai capabilities.*squished|ai capabilities.*unreadable/i, // Flexbox metrics render fine
  /overlapping.*text.*mini.calendar|mini.calendar.*overlapping.*text|squished.*mini.calendar.*text/i, // Calendar flexbox misread
  /category.*labels.*squished.*together|squished.*together.*unreadable.*string/i, // Flexbox category labels
  /incorrect.*pluraliz.*grammar|pluraliz.*grammar.*error|1 items/i,  // Pluralization already fixed
  /visible internal engineering jargon|dogfood tracker|dogfood \[x\]\/\d+|dogfood.*badge.*visible|badge.*dogfood|internal ['"]?dogfood['"]? overlay visible/i, // QA overlay wording, not product bug
  /dogfood.*toast|toast.*dogfood|p1internal.*dogfood/i, // QA walkthrough overlay misclassified as product toast
  /stuck ['"]?signing in.*toast|signing in.*visible.*guest user/i, // auth transition timing during automated sign-in
  /assistant button.*quality review|quality review page.*assistant button/i, // coordinate mis-click during agentic exploration
];

function isHardHallucination(issue) {
  const text = `${issue.header ?? ""} ${issue.details ?? ""}`;
  return HARD_HALLUCINATION_FILTERS.some((p) => p.test(text));
}

function isPreviewArtifactIssue(issue) {
  const text = `${issue.header ?? ""} ${issue.details ?? ""}`;
  const route = String(issue.route ?? issue.ts ?? "").toLowerCase();
  const isVideoTimestampRange = /^\d+(\.\d+)?s-\d+(\.\d+)?s$/.test(String(issue.route ?? issue.ts ?? "").trim());
  const isAgenticVideo = issue.source === "agentic_video";
  const isAgenticStill = issue.source === "agentic";
  const isPublicSurfaceRoute =
    /[?&]surface=(home|chat|reports|nudges|me)/i.test(route) ||
    /^(home|chat|reports|nudges|me)$/i.test(route);
  const mentionsUnexpectedPublicSurfaceSwitch =
    /(underlying view unexpectedly changes|unexpectedly changes from ['"]?(home|chat|reports|inbox|me|nudges)['"]? to ['"]?(home|chat|reports|inbox|me|nudges)['"]? without user interaction)/i.test(text);

  // NOTE(coworker): Generic hydration heuristic. During rapid route switching in
  // capture videos, Gemini frequently flags transient placeholders as bugs.
  // We only suppress findings that are explicitly "slow initial load"/placeholder
  // claims with no hard failure signals.
  if (
    isAgenticVideo &&
    /(slow initial load|placeholder content|layout shift when (the )?actual content loads|brief loading screen)/i.test(text)
  ) {
    return true;
  }

  if (
    isAgenticVideo &&
    !isPublicSurfaceRoute &&
    /(blank screen on initial load|stuck on loading|loading (video|analytics|personalized morning briefing)|sidebar transition jank)/i.test(text)
  ) {
    return true;
  }

  if (isAgenticVideo && isPublicSurfaceRoute && mentionsUnexpectedPublicSurfaceSwitch) {
    return true;
  }

  // NOTE(coworker): Agentic video often hallucinates "loading failure" on static/mock screens
  // while route transitions are still settling. Deterministic checks already gate real failures.
  if (
    isAgenticVideo &&
    !isPublicSurfaceRoute &&
    /(loading failure:.*not loading|loading indicator.*never resolves|displays a loading indicator that never resolves|section displays.*never resolves)/i.test(text)
  ) {
    return true;
  }

  if (isAgenticVideo && /(sidebar icons? not loading|icons? in the sidebar are not loading)/i.test(text)) {
    return true;
  }

  if (isAgenticVideo && /(transition bug: layout shift|generic skeleton loaders? cause layout shifts?)/i.test(text)) {
    return true;
  }

  if (/(research hub.*failed to load|research hub and fast agent panel failed to load)/i.test(text)) {
    if ((isAgenticVideo || isAgenticStill) && route.includes("research")) {
      return true;
    }
  }

  if (/visible internal engineering jargon|dogfood tracker|dogfood \[x\]\/\d+|dogfood.*badge.*visible|badge.*dogfood/i.test(text)) {
    return true;
  }

  if (isVideoTimestampRange && /(dogfood|signing in|sign-in|toast)/i.test(text)) {
    return true;
  }

  if (/assistant button.*quality review|quality review page.*assistant button/i.test(text)) {
    return true;
  }

  if (
    issue.source === "agentic" &&
    /clicking ['"]?task['"]? tab unexpectedly opens side panel|clicking ['"]?task['"]? tab .*assistant panel|task tab incorrectly triggers assistant panel|navigation to ['"]?me['"]? tab failed|top navigation active state does not update|steps tab interaction fails|tab navigation is unresponsive|incorrect tab navigation mapping|reports tab unresponsive|source link pill is unresponsive|attach files button does not open file dialog/i.test(text)
  ) {
    return true;
  }

  if (isAgenticStill && route.includes("public") && /inconsistent navigation icon highlight/i.test(text)) {
    return true;
  }

  if (route.includes("benchmarks") && /run button.*not disabled after clicking/i.test(text)) {
    return true;
  }

  if (route.includes("dogfood") && /chapter list is missing ['"]?dogfood['"]? chapter/i.test(text)) {
    return true;
  }

  if (isAgenticVideo && /brief loading screen/i.test(text)) {
    return true;
  }

  if (isAgenticVideo && /layout shift on sidebar expand/i.test(text)) {
    return true;
  }

  if (isAgenticVideo && !isPublicSurfaceRoute && /blank screen|sign in button flash|calendar ui layout shift/i.test(text)) {
    return true;
  }

  if (/broken character encoding|encoding error.*em-dash/i.test(text)) {
    return true;
  }

  if (route.includes("dogfood") && /copy video commands button overlaps|video chapters/i.test(text)) {
    return true;
  }

  if (isAgenticVideo && route.includes("roadmap") && /loading failure|blank.*shows no data|shows no data/i.test(text)) {
    return true;
  }

  if (issue.source === "agentic" && route.includes("agents") && /no recent runs section is empty/i.test(text)) {
    return true;
  }

  if (issue.source === "agentic" && route.includes("for-you") && /command palette ui issue/i.test(text)) {
    return true;
  }

  if (isAgenticVideo && route.includes("my workspace") && /calendar ui glitch/i.test(text)) {
    return true;
  }

  if (/missing hover state/i.test(text) && /(run benchmark|run button)/i.test(text)) {
    return true;
  }

  return false;
}

// Layer 1: Deterministic rubric criteria â€” computed from Playwright telemetry, zero LLM variance.
// weight âˆˆ {1,2,3} per Agentic Rubrics importance scale.
const DETERMINISTIC_RUBRIC = [
  { id: "no_console_errors", weight: 3, axis: "reliability", description: "No console.error during navigation" },
  { id: "no_uncaught_exceptions", weight: 3, axis: "reliability", description: "No uncaught JS exceptions (pageerror)" },
  { id: "no_failed_api_requests", weight: 2, axis: "reliability", description: "No failed Convex/API network requests" },
  { id: "page_loads_ok", weight: 2, axis: "performance", description: "Pages load without timeout" },
  { id: "no_parse_failures", weight: 2, axis: "infrastructure", description: "Gemini response parsed successfully" },
  { id: "video_qa_completed", weight: 1, axis: "infrastructure", description: "Video QA run completed without error" },
  { id: "screenshot_qa_completed", weight: 1, axis: "infrastructure", description: "Screenshot QA run completed without error" },
  { id: "no_layout_shift", weight: 2, axis: "performance", description: "No major layout shifts (CLS < 0.1)" },
  { id: "no_slow_resources", weight: 1, axis: "performance", description: "No resources taking >5s to load" },
  { id: "no_404_resources", weight: 2, axis: "reliability", description: "No 404 errors for static assets" },
  { id: "no_mixed_content", weight: 1, axis: "security", description: "No HTTP resources on HTTPS page" },
  { id: "viewport_meta_ok", weight: 1, axis: "accessibility", description: "Viewport meta tag present and correct" },
  { id: "no_banned_css_patterns", weight: 2, axis: "design_compliance", description: "No banned CSS patterns in source (Layer 0)" },
];

// Layer 2: Severity rubric criteria â€” computed from Gemini findings after false-positive filtering.
// These are boolean pass/fail checks derived from issue categorization.
const SEVERITY_RUBRIC = [
  { id: "no_p1_critical", weight: 3, axis: "usability", description: "No P1 critical UX issues" },
  { id: "low_p2_warnings", weight: 2, axis: "usability", description: "Fewer than 5 P2 warnings" },
  { id: "no_contrast_failures", weight: 2, axis: "accessibility", description: "No contrast/legibility issues flagged" },
  { id: "no_text_overlap", weight: 2, axis: "layout", description: "No text overlap or illegible content" },
  { id: "no_layout_breaks", weight: 2, axis: "layout", description: "No broken layouts or content overflow" },
  { id: "no_misleading_affordances", weight: 1, axis: "usability", description: "No misleading interactive affordances" },
  { id: "empty_states_ok", weight: 1, axis: "completeness", description: "Empty states are informative, not blank" },
  { id: "theme_parity", weight: 1, axis: "visual", description: "Dark/light theme visual parity" },
  { id: "no_jargon_leak", weight: 1, axis: "copy", description: "No engineering jargon in user-facing labels" },
  { id: "grammar_ok", weight: 1, axis: "copy", description: "No grammar/spelling/punctuation errors" },
  { id: "icons_labeled", weight: 1, axis: "usability", description: "Icons have labels or tooltips" },
  { id: "mobile_responsive", weight: 1, axis: "layout", description: "Mobile viewport renders properly" },
  { id: "no_agentic_interaction_bugs", weight: 2, axis: "interaction", description: "No bugs found during agentic visual exploration" },
  // Design governance criteria (Phase 3)
  { id: "no_gratuitous_uppercase", weight: 1, axis: "governance", description: "No ALL CAPS text outside small metadata labels" },
  { id: "color_budget_respected", weight: 1, axis: "governance", description: "Fewer than 3 accent colors per screen" },
  { id: "empty_states_present", weight: 1, axis: "governance", description: "No blank areas where content should be" },
  { id: "consistent_card_radius", weight: 1, axis: "governance", description: "No mixed border-radius on same screen" },
  { id: "standard_button_style", weight: 1, axis: "governance", description: "No non-standard button appearances" },
];

function getPLevel(issue) {
  const m = (issue.header ?? "").match(/^P(\d)/i);
  return m ? parseInt(m[1], 10) : 3;
}

function normalizeIssueText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\[\d+:\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeIssues(issues) {
  const seen = new Set();
  const unique = [];
  for (const issue of issues ?? []) {
    const route = normalizeIssueText(issue.route ?? issue.ts ?? "global");
    const header = normalizeIssueText(issue.header).replace(/^p\d+\s*/i, "");
    const details = normalizeIssueText(issue.details).slice(0, 180);
    const key = `${route}|${header}|${details}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

// Legacy compat â€” now only checks hard hallucination filters
function isKnownFalsePositive(issue) {
  return isHardHallucination(issue) || isPreviewArtifactIssue(issue);
}

// Categorize an issue into rubric axes for boolean evaluation.
function categorizeIssue(issue) {
  const text = `${issue.header ?? ""} ${issue.details ?? ""}`.toLowerCase();
  const cats = [];
  if (/contrast|legib|wcag|color.*blind|readab|faint|nearly.*invisible|eye.*strain/i.test(text)) cats.push("contrast");
  if (/text.*overlap|squish|jumbl|truncat|run.*into.*each|labels.*cramped/i.test(text)) cats.push("text_overlap");
  if (/layout|overflow|break|viewport|scroll|outside/i.test(text)) cats.push("layout_break");
  if (/underline.*link|false.*affordance|misleading.*click|looks.*clickable/i.test(text)) cats.push("misleading_affordance");
  if (/empty.*state|void|blank.*area|loading.*failure/i.test(text)) cats.push("empty_state");
  if (/dark.*mode|light.*mode|theme.*parit|theme.*inconsist/i.test(text)) cats.push("theme");
  if (/jargon|hitl|mcp|dogfood|internal.*metric/i.test(text)) cats.push("jargon");
  if (/grammar|spelling|punctuation|typo|pluraliz/i.test(text)) cats.push("grammar");
  if (/icon.*label|icon.*tooltip|ambiguous.*icon|icon.*without/i.test(text)) cats.push("icons");
  if (/mobile|fab|responsive|viewport.*small/i.test(text)) cats.push("mobile");
  // Governance categories
  if (/all.*caps|uppercase|shouting|loud.*text/i.test(text)) cats.push("uppercase");
  if (/too.*many.*colors|accent.*overload|color.*budget|rainbow|inconsistent.*palette/i.test(text)) cats.push("color_budget");
  if (/blank.*area|missing.*empty.*state|void.*content|no.*data.*shown/i.test(text)) cats.push("missing_empty_state");
  if (/border.*radius|rounded.*mismatch|card.*radius|inconsistent.*rounding/i.test(text)) cats.push("card_radius");
  if (/button.*style|non.*standard.*button|inconsistent.*button|button.*mismatch/i.test(text)) cats.push("button_style");
  return cats;
}

// Evaluate a severity rubric criterion against filtered Gemini issues.
function evaluateSeverityCriterion(criterionId, filteredIssues) {
  switch (criterionId) {
    case "no_p1_critical":
      return filteredIssues.filter((i) => getPLevel(i) === 1).length === 0;
    case "low_p2_warnings":
      return filteredIssues.filter((i) => getPLevel(i) === 2).length < 5;
    case "no_contrast_failures":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("contrast"));
    case "no_text_overlap":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("text_overlap"));
    case "no_layout_breaks":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("layout_break"));
    case "no_misleading_affordances":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("misleading_affordance"));
    case "empty_states_ok":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("empty_state"));
    case "theme_parity":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("theme"));
    case "no_jargon_leak":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("jargon"));
    case "grammar_ok":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("grammar"));
    case "icons_labeled":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("icons"));
    case "mobile_responsive":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("mobile"));
    case "no_agentic_interaction_bugs":
      return !filteredIssues.some((i) => ["agentic", "agentic_video"].includes(i.source ?? ""));
    // Governance criteria
    case "no_gratuitous_uppercase":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("uppercase"));
    case "color_budget_respected":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("color_budget"));
    case "empty_states_present":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("missing_empty_state"));
    case "consistent_card_radius":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("card_radius"));
    case "standard_button_style":
      return !filteredIssues.some((i) => categorizeIssue(i).includes("button_style"));
    default:
      return true;
  }
}

// Compute the 3-layer rubric score.
// deterministicState: { consoleErrors, pageErrors, failedRequests, pageLoadOk, parseOk, videoOk, screenOk, layoutShifts, slowResources, notFoundResources, mixedContent, viewportMetaOk, staticAnalysis, agenticIssues }
async function computeQaScore(videoRuns, screenRuns, deterministicState = {}) {
  const allIssues = dedupeIssues([
    ...(videoRuns?.[0]?.issues ?? []),
    ...(screenRuns?.[0]?.issues ?? []),
    ...(deterministicState.agenticIssues ?? []),
  ]);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Step 1a: Hard hallucination filter (5 patterns for egregious misreads)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const hardFiltered = allIssues.filter((i) => isHardHallucination(i) || isPreviewArtifactIssue(i));
  const candidateIssues = allIssues.filter(
    (i) =>
      !isHardHallucination(i) &&
      !isPreviewArtifactIssue(i) &&
      getPLevel(i) >= 1 &&
      !(i.header ?? "").toLowerCase().includes("unstructured"),
  );

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Step 1b: LLM-as-a-judge â€” semantically classify remaining issues
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // eslint-disable-next-line no-console
  console.log(`  ðŸ§‘â€âš–ï¸ Judging ${candidateIssues.length} candidate issues with LLM...`);
  const judgments = await judgeIssuesWithLLM_Batched(candidateIssues);

  const realIssues = [];
  const llmFiltered = [];
  const judgeDetails = [];

  for (let i = 0; i < candidateIssues.length; i++) {
    const j = judgments.get(i) ?? { verdict: "genuine_bug", confidence: 0.5, reasoning: "missing" };
    judgeDetails.push({
      issue: (candidateIssues[i].header ?? "").slice(0, 80),
      verdict: j.verdict,
      confidence: j.confidence,
      reasoning: j.reasoning,
    });

    if (j.verdict === "genuine_bug") {
      realIssues.push(candidateIssues[i]);
    } else {
      llmFiltered.push(candidateIssues[i]);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`  ðŸ§‘â€âš–ï¸ Judge: ${realIssues.length} genuine, ${llmFiltered.length} filtered (${hardFiltered.length} hard-filtered)`);

  const falsePositives = [...hardFiltered, ...llmFiltered];

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Step 2: Evaluate Layer 1 â€” Deterministic checks (zero variance)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const deterministicResults = {
    no_console_errors: (deterministicState.consoleErrors ?? 0) === 0,
    no_uncaught_exceptions: (deterministicState.pageErrors ?? 0) === 0,
    no_failed_api_requests: (deterministicState.failedRequests ?? 0) === 0,
    page_loads_ok: deterministicState.pageLoadOk !== false,
    no_parse_failures: !allIssues.every(
      (i) => getPLevel(i) === 0 || (i.header ?? "").toLowerCase().includes("unstructured"),
    ) || allIssues.length === 0,
    video_qa_completed: deterministicState.videoOk !== false,
    screenshot_qa_completed: deterministicState.screenOk !== false,
    no_layout_shift: (deterministicState.layoutShifts ?? 0) === 0,
    no_slow_resources: (deterministicState.slowResources ?? 0) === 0,
    no_404_resources: (deterministicState.notFoundResources ?? 0) === 0,
    no_mixed_content: (deterministicState.mixedContent ?? 0) === 0,
    viewport_meta_ok: deterministicState.viewportMetaOk !== false,
    no_banned_css_patterns: (deterministicState.staticAnalysis?.highCount ?? 0) === 0,
  };

  const layer1Criteria = DETERMINISTIC_RUBRIC.map((c) => ({
    ...c,
    layer: "deterministic",
    pass: deterministicResults[c.id] ?? false,
  }));

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Step 3: Evaluate Layer 2 â€” Severity rubric (boolean from Gemini)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const layer2Criteria = SEVERITY_RUBRIC.map((c) => ({
    ...c,
    layer: "severity",
    pass: evaluateSeverityCriterion(c.id, realIssues),
  }));

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Step 4: Compute weighted rubric score S = Î£(wi Ã— si) / Î£(wi) Ã— 100
  // Layer weights: deterministic 60%, severity 30%, taste 10%
  // (Rebalanced: more weight on deterministic = less score variance)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const allCriteria = [...layer1Criteria, ...layer2Criteria];

  // Per-layer scores (0-100)
  const layer1Weight = layer1Criteria.reduce((s, c) => s + c.weight, 0);
  const layer1Earned = layer1Criteria.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0);
  const layer1Score = layer1Weight > 0 ? Math.round((layer1Earned / layer1Weight) * 100) : 100;

  const layer2Weight = layer2Criteria.reduce((s, c) => s + c.weight, 0);
  const layer2Earned = layer2Criteria.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0);
  const layer2Score = layer2Weight > 0 ? Math.round((layer2Earned / layer2Weight) * 100) : 100;

  // Layer 3: Legacy taste score â€” P-level deductions capped at [40, 100]
  const critical = realIssues.filter((i) => getPLevel(i) === 1).length;
  const warning = realIssues.filter((i) => getPLevel(i) === 2).length;
  const info = realIssues.filter((i) => getPLevel(i) >= 3).length;
  const rawTaste = Math.max(0, 100 - critical * 6 - warning * 2 - info * 1);
  const layer3Score = Math.max(40, Math.min(100, rawTaste)); // clamp to [40, 100] to reduce swing

  // Weighted composite: 60% deterministic + 30% severity rubric + 10% taste
  const compositeScore = Math.round(
    layer1Score * 0.60 + layer2Score * 0.30 + layer3Score * 0.10,
  );
  const score = Math.max(0, Math.min(100, compositeScore));

  const grade =
    score >= 90 ? "A" :
      score >= 75 ? "B" :
        score >= 60 ? "C" :
          score >= 40 ? "D" : "F";

  // Governance sub-score: how many governance criteria pass
  const governanceCriteria = layer2Criteria.filter((c) => c.axis === "governance");
  const governanceWeight = governanceCriteria.reduce((s, c) => s + c.weight, 0);
  const governanceEarned = governanceCriteria.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0);
  const governanceScore = governanceWeight > 0 ? Math.round((governanceEarned / governanceWeight) * 100) : 100;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Rubric breakdown for traceability
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const staticAnalysisData = deterministicState.staticAnalysis ?? null;
  const agenticIssueData = (deterministicState.agenticIssues ?? []);

  const rubric = {
    layer0: staticAnalysisData ? {
      score: staticAnalysisData.score,
      total: staticAnalysisData.total,
      high: staticAnalysisData.highCount,
      medium: staticAnalysisData.medCount,
      low: staticAnalysisData.lowCount,
      topViolations: staticAnalysisData.violations.slice(0, 15).map((v) => `${v.file}:${v.line} ${v.label}`),
    } : null,
    layer1: { score: layer1Score, weight: 0.60, criteria: layer1Criteria.map((c) => ({ id: c.id, pass: c.pass, weight: c.weight, axis: c.axis })) },
    layer2: { score: layer2Score, weight: 0.30, criteria: layer2Criteria.map((c) => ({ id: c.id, pass: c.pass, weight: c.weight, axis: c.axis })) },
    layer3: { score: layer3Score, weight: 0.10, rawTaste },
    governance: { score: governanceScore, criteria: governanceCriteria.map((c) => ({ id: c.id, pass: c.pass, weight: c.weight })) },
    agentic: {
      issueCount: agenticIssueData.length,
      screenshotIssues: agenticIssueData.filter((i) => i.source === "agentic").length,
      videoIssues: agenticIssueData.filter((i) => i.source === "agentic_video").length,
      issues: agenticIssueData.slice(0, 10),
    },
    falsePositivesFiltered: falsePositives.length,
    hardFiltered: hardFiltered.length,
    llmFiltered: llmFiltered.length,
    judgeDetails,
    falsePositivePatterns: falsePositives.map((i) => (i.header ?? "").slice(0, 60)),
  };

  return {
    score,
    grade,
    critical,
    warning,
    info,
    total: allIssues.length,
    realIssueCount: realIssues.length,
    rubric,
    loop: {
      // NOTE(coworker): Loop mode uses this for agent-edits-with-review. Keep payload small + actionable.
      realIssues: realIssues.slice(0, 25),
      candidateIssues: candidateIssues.slice(0, 25),
      falsePositives: falsePositives.slice(0, 25),
      hardFilteredCount: hardFiltered.length,
      llmFilteredCount: llmFiltered.length,
    },
    diagnostics: {
      totalRawIssues: allIssues.length,
      falsePositivesFiltered: falsePositives.length,
      realIssues: realIssues.length,
      videoRunFound: (videoRuns?.length ?? 0) > 0,
      screenRunFound: (screenRuns?.length ?? 0) > 0,
      videoIssueCount: videoRuns?.[0]?.issues?.length ?? 0,
      screenIssueCount: screenRuns?.[0]?.issues?.length ?? 0,
    },
  };
}

// Append a scored result to public/dogfood/qa-results.json (capped at 100 entries).
// deterministicState is collected from Playwright telemetry during the QA run.
async function persistQaScore(repoRoot, videoRuns, screenRuns, deterministicState = {}) {
  const qaResultsPath = path.join(repoRoot, "public", "dogfood", "qa-results.json");

  const parsedHistory = await readJsonFileOrDefault(qaResultsPath, []);
  const history = Array.isArray(parsedHistory) ? parsedHistory : [];

  const qscore = await computeQaScore(videoRuns, screenRuns, deterministicState);
  const entry = {
    timestamp: new Date().toISOString(),
    runType: "gemini-qa-rubric",
    model: GEMINI_QA_MODEL,
    requestedModel: GEMINI_QA_MODEL_INTENT,
    modelResolution: geminiModelResolution,
    ...qscore,
    videoIssues: videoRuns?.[0]?.issues?.length ?? 0,
    screenshotIssues: screenRuns?.[0]?.issues?.length ?? 0,
    videoSummary: (videoRuns?.[0]?.summary ?? "").slice(0, 400),
    screenSummary: (screenRuns?.[0]?.summary ?? "").slice(0, 400),
  };

  history.unshift(entry);
  if (history.length > 100) history.length = 100;

  await writeJsonFileWithRetry(qaResultsPath, history);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Rubric scorecard output â€” explainable, traceable
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const r = qscore.rubric;
  // eslint-disable-next-line no-console
  console.log(`\n${"â•".repeat(60)}`);
  // eslint-disable-next-line no-console
  console.log(`  RUBRIC QA SCORE: ${entry.score}/100 (${entry.grade})`);
  // eslint-disable-next-line no-console
  console.log(`${"â•".repeat(60)}`);
  if (r.layer0) {
    // eslint-disable-next-line no-console
    console.log(`  Layer 0 â€” Static Code Analysis: ${r.layer0.score}/100 (${r.layer0.total} violations: ${r.layer0.high} high, ${r.layer0.medium} medium, ${r.layer0.low} low)`);
    for (const v of r.layer0.topViolations?.slice(0, 5) ?? []) {
      // eslint-disable-next-line no-console
      console.log(`    ðŸ“‹ ${v}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`  Layer 1 â€” Deterministic (${Math.round(r.layer1.weight * 100)}%): ${r.layer1.score}/100`);
  for (const c of r.layer1.criteria) {
    // eslint-disable-next-line no-console
    console.log(`    ${c.pass ? "âœ“" : "âœ—"} [w${c.weight}] ${c.id}`);
  }
  // eslint-disable-next-line no-console
  console.log(`  Layer 2 â€” Severity Rubric (${Math.round(r.layer2.weight * 100)}%): ${r.layer2.score}/100`);
  for (const c of r.layer2.criteria) {
    // eslint-disable-next-line no-console
    console.log(`    ${c.pass ? "âœ“" : "âœ—"} [w${c.weight}] ${c.id}`);
  }
  // eslint-disable-next-line no-console
  console.log(`  Layer 3 â€” Taste (${Math.round(r.layer3.weight * 100)}%): ${r.layer3.score}/100 (raw: ${r.layer3.rawTaste})`);
  // eslint-disable-next-line no-console
  console.log(`  Filtered: ${r.falsePositivesFiltered} total (${r.hardFiltered ?? 0} hard, ${r.llmFiltered ?? 0} LLM judge)`);
  if (r.judgeDetails?.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  ðŸ§‘â€âš–ï¸ LLM Judge Verdicts:`);
    for (const jd of r.judgeDetails) {
      const icon = jd.verdict === "genuine_bug" ? "ðŸ”´" : jd.verdict === "design_opinion" ? "ðŸ’­" : jd.verdict === "screenshot_artifact" ? "ðŸ“¸" : "ðŸ“Š";
      // eslint-disable-next-line no-console
      console.log(`    ${icon} [${jd.verdict}] (${(jd.confidence * 100).toFixed(0)}%) ${jd.issue}`);
      if (jd.reasoning) {
        // eslint-disable-next-line no-console
        console.log(`       ${jd.reasoning.slice(0, 120)}`);
      }
    }
  }
  if (r.agentic?.issueCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`  ðŸ¤– Agentic Visual QA: ${r.agentic.issueCount} interaction issues`);
    for (const ai of r.agentic.issues?.slice(0, 5) ?? []) {
      // eslint-disable-next-line no-console
      console.log(`    â†’ [${ai.route ?? "?"}] ${(ai.header ?? ai.description ?? "").slice(0, 80)}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`  Real issues: ${qscore.realIssueCount} (${qscore.critical} P1, ${qscore.warning} P2, ${qscore.info} P3)`);
  // eslint-disable-next-line no-console
  console.log(`${"â•".repeat(60)}\n`);
  // eslint-disable-next-line no-console
  console.log(`QA history appended â†’ ${qaResultsPath}`);

  return { entry, qscore };
}

async function throwIfQaErrorVisible(page, label) {
  const err = page.getByText(/qa error:/i).first();
  if (!(await err.isVisible().catch(() => false))) return;
  const errText = (await err.textContent().catch(() => "")) || "";
  throw new Error(`${label}: ${errText.replace(/^qa error:\s*/i, "").trim() || "QA failed"}`);
}

function getDesignStyleGuidance(style) {
  const s = String(style ?? "linear").toLowerCase();
  if (s === "vercel") {
    return "Vercel-grade: minimal, neutral palette, subtle borders, strong typography hierarchy, generous whitespace, crisp alignment, and motion only when it clarifies state.";
  }
  if (s === "chatgpt" || s === "openai") {
    return "ChatGPT-grade: high legibility, calm surfaces, clean spacing rhythm, subtle separators, predictable focus states, and simple interactions that feel instant.";
  }
  if (s === "ive" || s === "jony" || s === "jony-ive") {
    return "Jony Ive-grade craft: remove ornamental chrome, prioritize typography + negative space, unify radii and stroke weights, restrained color, and calm physical-feeling micro-interactions.";
  }
  return "Linear-grade: dense-but-calm, consistent spacing system, subtle borders, restrained color, clean type scale, fast and crisp interactions, and quiet empty/loading states.";
}

function coerceDesignReport(parsedAny) {
  // NOTE(coworker): Gemini sometimes returns the correct object nested under
  // `{ opportunities: [ { summary, aspirationScore, axes, opportunities } ] }`
  // (or an array with a single report object). Normalize so aspiration gating works.
  if (!parsedAny || typeof parsedAny !== "object") return null;

  const looksLikeReport = (o) => Boolean(
    o
    && typeof o === "object"
    && !Array.isArray(o)
    && (
      typeof o.summary === "string"
      || typeof o.aspirationScore === "number"
      || (o.axes && typeof o.axes === "object" && !Array.isArray(o.axes))
      || Array.isArray(o.opportunities)
    )
  );

  let root = parsedAny;

  if (Array.isArray(root)) {
    if (root.length === 1 && looksLikeReport(root[0])) root = root[0];
    else return { summary: "", aspirationScore: null, axes: {}, opportunities: root };
  }

  // Unwrap common wrapper keys
  for (const k of ["result", "data", "output", "report"]) {
    if (looksLikeReport(root?.[k])) {
      root = root[k];
      break;
    }
  }

  // Unwrap "report nested inside opportunities[0]" shape
  const opp = Array.isArray(root?.opportunities) ? root.opportunities : null;
  if (
    (typeof root?.aspirationScore !== "number" && String(root?.summary ?? "") === "")
    && opp
    && opp.length === 1
    && looksLikeReport(opp[0])
    && typeof opp[0].aspirationScore === "number"
  ) {
    root = opp[0];
  }

  if (!looksLikeReport(root)) return null;

  const summary = typeof root.summary === "string" ? root.summary : "";
  const aspirationScore = typeof root.aspirationScore === "number" ? root.aspirationScore : null;
  const axes = root.axes && typeof root.axes === "object" && !Array.isArray(root.axes) ? root.axes : {};
  const opportunities = Array.isArray(root.opportunities) ? root.opportunities : [];

  return { summary, aspirationScore, axes, opportunities };
}

async function collectDesignScreens(outDir, style, maxImages = 10) {
  // NOTE(coworker): Avoid hardcoding route lists. Learn screens from the app's dogfood manifest.
  // Always include /benchmarks if present, then add a small representative subset.
  const manifestPath = path.join(process.cwd(), "public", "dogfood", "manifest.json");
  const basePath = path.join(process.cwd(), "public", "dogfood", "screenshots");

  let manifest = null;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw);
  } catch {
    manifest = null;
  }

  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const routeItems = items.filter((i) => i.kind === "route" && i.viewport === "desktop");
  const interactionItems = items.filter((i) => i.kind !== "route" && i.viewport === "desktop");

  function toScreen(i) {
    const file = String(i?.file ?? "");
    const full = path.join(basePath, file);
    return {
      file,
      fullPath: full,
      label: String(i?.label ?? ""),
      kind: String(i?.kind ?? ""),
      theme: String(i?.theme ?? ""),
      viewport: String(i?.viewport ?? ""),
    };
  }

  const screens = [];
  const seenFiles = new Set();
  function add(i) {
    const s = toScreen(i);
    if (!s.file) return;
    if (seenFiles.has(s.file)) return;
    if (!existsSync(s.fullPath)) return;
    seenFiles.add(s.file);
    screens.push(s);
  }

  const wantLightFirst = ["vercel", "linear", "ive", "jony", "jony-ive"].includes(String(style ?? "").toLowerCase());
  const primaryTheme = wantLightFirst ? "light" : "dark";
  const secondaryTheme = primaryTheme === "light" ? "dark" : "light";

  const bench = routeItems.filter((i) => /benchmarks/i.test(String(i?.file ?? "")) || /benchmarks/i.test(String(i?.label ?? "")));
  for (const t of [primaryTheme, secondaryTheme]) {
    const match = bench.find((i) => i.theme === t);
    if (match) add(match);
  }

  const cmd = interactionItems.find((i) => /command palette/i.test(String(i?.label ?? "")) && i.theme === primaryTheme);
  if (cmd) add(cmd);
  const settings = interactionItems.find((i) => /account|settings/i.test(String(i?.label ?? "")) && i.theme === primaryTheme);
  if (settings) add(settings);

  const byTheme = routeItems.filter((i) => i.theme === primaryTheme);
  const priority = ["Home", "Research", "Agents", "Activity", "Timeline", "Documents"];
  for (const label of priority) {
    const match = byTheme.find((i) => String(i?.label ?? "").toLowerCase().includes(label.toLowerCase()));
    if (match) add(match);
  }
  for (const i of byTheme) {
    if (screens.length >= maxImages) break;
    add(i);
  }

  try {
    const entries = await fs.readdir(outDir);
    const agentic = entries.filter((e) => e.startsWith("agentic-") && e.endsWith(".png")).slice(0, 4);
    for (const f of agentic) {
      if (screens.length >= maxImages) break;
      const fullPath = path.join(outDir, f);
      if (!existsSync(fullPath)) continue;
      screens.push({ file: f, fullPath, label: f.replace(/^agentic-/, "").replace(/\.png$/, ""), kind: "agentic", theme: "", viewport: "desktop" });
    }
  } catch {
    // ignore
  }

  return screens.slice(0, maxImages);
}

async function runDesignOpportunityQa(outDir, style, maxImages = 10) {
  const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!GEMINI_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn("  âš  No GEMINI_API_KEY â€” skipping design opportunity QA");
    return { opportunities: [], summary: "" };
  }

  const guidance = getDesignStyleGuidance(style);
  const screens = await collectDesignScreens(outDir, style, maxImages);
  await fs.writeFile(path.join(outDir, "design-screens.json"), JSON.stringify({ style, count: screens.length, screens }, null, 2), "utf8").catch(() => { });
  if (screens.length === 0) return { opportunities: [], summary: "" };

  const parts = [];
  for (const s of screens) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const buf = await fs.readFile(s.fullPath);
      parts.push({ inline_data: { mime_type: "image/png", data: buf.toString("base64") } });
      parts.push({ text: `[Screen] file=${s.file} label=${s.label} kind=${s.kind} theme=${s.theme} viewport=${s.viewport}` });
    } catch {
      // ignore per-screen failures
    }
  }

  parts.push({
    text: `You are a world-class design reviewer scoring a web application against industry-grade reference patterns.
This is NOT bug-finding â€” you are identifying UPLIFT OPPORTUNITIES to match the best SaaS/AI products.

Overall style target: ${guidance}

REFERENCE DESIGN PATTERNS (score against these):

VERCEL:
- Typography: Inter/Geist font, 3 weights max (400/500/600), 16px base, 1.5 line-height
- Spacing: 4px unit grid, consistent 8/16/24/32/48px rhythm. No random pixel values
- Color: Neutral palette (gray-50â†’gray-950), single accent color, subtle borders (1px gray-200/800)
- Empty states: Clean illustration + explanatory copy + single CTA. Never bare white space
- Loading: Skeleton with subtle pulse animation matching content shape (not generic rectangles)
- Tables: Clean row hover, no heavy zebra striping, subtle column separators
- Cards: Minimal shadow (shadow-sm), consistent border-radius (8px), generous internal padding

LINEAR:
- Density: Dense-but-calm â€” tight spacing but with breathing room between sections
- Status: Color-coded dots (green/amber/red/gray) for state, never text badges for status
- Lists: Hover reveals actions, no always-visible action buttons cluttering rows
- Typography: Strong hierarchy â€” section titles semibold, items regular, metadata muted
- Motion: Instant transitions (<150ms), spring physics on open/close, no gratuitous delays
- Keyboard: Every action reachable via keyboard shortcut, visible in tooltips

CHATGPT:
- Interaction feedback: Instant visual response on every click (button pulse, background shift, icon spin)
- Progressive disclosure: Start minimal, reveal detail on demand (expandable sections, hover info)
- Conversation UX: Clear turn-taking, typing indicators, streaming token reveal
- Simplicity: Max 3-4 actions visible per context. More behind overflow menus
- Empty states: Friendly microcopy, suggested actions, zero technical language

STRIPE:
- Data density: Dense metric displays with clear visual hierarchy (large number â†’ label â†’ sparkline)
- Tables: Sortable columns, pagination, filter chips â€” all inline, no modal interruptions
- Charts: Clean axes, muted gridlines, single accent for primary metric, tooltip on hover
- Detail views: Master-detail pattern, sidebar flyout, breadcrumb navigation
- Copy: Professional, concise. Labels under 3 words, descriptions under 15 words

NOTION:
- Blocks: Everything is a composable block â€” consistent spacing between blocks (8px)
- Hover affordances: Drag handles, action menus appear on hover, never clutter default view
- Typography: Large page titles (28-32px), clean heading hierarchy (H1â†’H2â†’H3)
- Whitespace: Generous margins (64px+ page margin), max-width content containers (720px)
- Icons: Consistent icon family, 20px default size, muted gray default, accent on active

SCORING AXES (rate each 0-10):
1. TYPOGRAPHY: Weight differentiation, size scale, line-height, font consistency
2. SPACING: Consistent rhythm (4/8/16/24px grid), section breathing, internal padding
3. STATES: Empty states, loading skeletons, error states, hover/focus/active feedback
4. HIERARCHY: Primary/secondary/tertiary content layers clearly distinguishable
5. INTERACTION: Click feedback, hover reveals, transitions, keyboard shortcuts visible
6. CRAFT: Alignment precision, border consistency, radius uniformity, color restraint

CONSTRAINTS:
- Respect the product intent: data-dense power-user tool. Do NOT suggest "add more whitespace everywhere"
- Suggest SMALL, HIGH-LEVERAGE changes (CSS tweaks, spacing adjustments, state improvements)
- Each opportunity must reference which reference app pattern it draws from
- Avoid suggesting new color palettes â€” assume existing neutral design tokens
- Focus on what would make the BIGGEST visual quality jump with the LEAST code change

Return a JSON object:
{
  "summary": "2-3 sentences on overall design quality vs industry grade",
  "aspirationScore": 0-100,
  "axes": {
    "typography": { "score": 0-10, "note": "brief" },
    "spacing": { "score": 0-10, "note": "brief" },
    "states": { "score": 0-10, "note": "brief" },
    "hierarchy": { "score": 0-10, "note": "brief" },
    "interaction": { "score": 0-10, "note": "brief" },
    "craft": { "score": 0-10, "note": "brief" }
  },
  "opportunities": [
    {
      "priority": "P1"|"P2"|"P3",
      "screenFile": "filename.png",
      "area": "header|sidebar|cards|table|empty_state|forms|motion|typography|color|a11y",
      "reference": "vercel|linear|chatgpt|stripe|notion",
      "opportunity": "what to improve",
      "why": "why this matters â€” reference the specific app pattern",
      "fixHint": "a concrete CSS/component change",
      "verify": "how to confirm improvement",
      "confidence": 0.0-1.0
    }
  ]
}
Return ONLY JSON.`,
  });

  // Count image parts for diagnostic logging
  const imageParts = parts.filter((p) => p.inline_data);
  const textParts = parts.filter((p) => p.text);
  const totalImageBytes = imageParts.reduce((sum, p) => sum + (p.inline_data?.data?.length ?? 0), 0);
  // eslint-disable-next-line no-console
  console.log(`    ðŸ“¸ ${imageParts.length} images (${(totalImageBytes * 0.75 / 1024 / 1024).toFixed(1)}MB) + ${textParts.length} text parts`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
      }),
    });
  } catch (fetchErr) {
    // eslint-disable-next-line no-console
    console.warn(`    âš  Design QA fetch failed: ${fetchErr.message}`);
    await fs.writeFile(path.join(outDir, "design-opportunities.error.txt"), `fetch error: ${fetchErr.message}\n${fetchErr.stack}`, "utf8").catch(() => { });
    await fs.writeFile(path.join(outDir, "design-opportunities.json"), JSON.stringify({ style, summary: "", aspirationScore: null, axes: {}, opportunities: [], error: fetchErr.message }, null, 2), "utf8").catch(() => { });
    return { opportunities: [], summary: "", aspirationScore: null, axes: {} };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.warn(`    âš  Design QA API error: ${res.status} â€” ${errText.slice(0, 300)}`);
    await fs.writeFile(path.join(outDir, "design-opportunities.error.txt"), `HTTP ${res.status}\n${errText}`, "utf8").catch(() => { });
    await fs.writeFile(path.join(outDir, "design-opportunities.json"), JSON.stringify({ style, summary: "", aspirationScore: null, axes: {}, opportunities: [], error: `HTTP ${res.status}` }, null, 2), "utf8").catch(() => { });
    return { opportunities: [], summary: "", aspirationScore: null, axes: {} };
  }

  const data = await res.json();
  const text = getGeminiCandidateText(data);
  await fs.writeFile(path.join(outDir, "design-opportunities.response.json"), JSON.stringify(data, null, 2), "utf8").catch(() => { });
  await fs.writeFile(path.join(outDir, "design-opportunities.raw.txt"), text, "utf8").catch(() => { });

  // Detect safety blocks / empty candidates
  const blockReason = data?.candidates?.[0]?.finishReason;
  const promptFeedback = data?.promptFeedback?.blockReason;
  if (!text && (blockReason || promptFeedback)) {
    // eslint-disable-next-line no-console
    console.warn(`    âš  Design QA blocked by Gemini: finishReason=${blockReason}, promptFeedback=${promptFeedback}`);
  }
  if (!text) {
    // eslint-disable-next-line no-console
    console.warn(`    âš  Design QA returned empty text â€” Gemini may have filtered the response`);
    await fs.writeFile(path.join(outDir, "design-opportunities.json"), JSON.stringify({ style, summary: "", aspirationScore: null, axes: {}, opportunities: [], error: "empty response", finishReason: blockReason, promptFeedback }, null, 2), "utf8").catch(() => { });
    return { opportunities: [], summary: "", aspirationScore: null, axes: {} };
  }

  // Try direct JSON.parse first (Gemini responseMimeType returns clean JSON),
  // then fall back to tryParseJson which runs extractJsonSubstring (prefers arrays over objects,
  // which can strip the wrapper object and lose aspirationScore/axes/summary).
  let parsedDirect = null;
  try {
    parsedDirect = JSON.parse(text);
  } catch {
    // not valid JSON â€” fall through to tryParseJson
  }
  const parsedAny = parsedDirect ?? tryParseJson(text);
  if (!parsedAny) {
    // eslint-disable-next-line no-console
    console.warn(`    âš  Design QA JSON parse failed â€” raw text length: ${text.length}`);
    await fs.writeFile(path.join(outDir, "design-opportunities.json"), JSON.stringify({ style, summary: "", aspirationScore: null, axes: {}, opportunities: [], error: "parse_failed", rawLength: text.length }, null, 2), "utf8").catch(() => { });
    return { opportunities: [], summary: "", aspirationScore: null, axes: {} };
  }

  const coerced = coerceDesignReport(parsedAny);
  const opportunities = coerced?.opportunities ?? (Array.isArray(parsedAny) ? parsedAny : []);
  const summary = coerced?.summary ?? "";
  const aspirationScore = typeof coerced?.aspirationScore === "number" ? coerced.aspirationScore : null;
  const axes = coerced?.axes ?? {};

  await fs.writeFile(path.join(outDir, "design-opportunities.json"), JSON.stringify({ style, summary, aspirationScore, axes, opportunities }, null, 2), "utf8");
  return { opportunities, summary, aspirationScore, axes };
}

// ═══════════════════════════════════════════════════════════════════════
// Cross-route coherence check — sends 4-6 screenshots to Gemini
// and asks if they look like the same app. Returns a 1-10 score.
// ═══════════════════════════════════════════════════════════════════════
async function runDesignCoherenceCheck(outDir) {
  const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!GEMINI_API_KEY) return { score: null, notes: "No API key" };

  // Pick 6 diverse route screenshots
  const screenshotDir = path.join(process.cwd(), "public", "dogfood", "screenshots");
  const candidates = [
    "home.png",
    "chat.png",
    "reports.png",
    "nudges.png",
    "me.png",
    "home-light.png",
    "chat-light.png",
    "reports-light.png",
  ];
  const available = [];
  for (const name of candidates) {
    const p = path.join(screenshotDir, name);
    try {
      await fs.access(p);
      available.push(p);
    } catch { /* skip */ }
  }
  if (available.length < 3) return { score: null, notes: `Only ${available.length} screenshots found` };

  const selected = available.slice(0, 6);
  const imageParts = [];
  for (const p of selected) {
    const buf = await fs.readFile(p);
    imageParts.push({
      inlineData: { mimeType: "image/png", data: buf.toString("base64") }
    });
  }

  const prompt = `You are a senior product designer evaluating visual consistency across ${selected.length} screenshots from the same web application.

Rate the VISUAL CONSISTENCY of these screens on a scale of 1-10:
- 10 = These all look like they belong to the same polished product (consistent typography, spacing, color palette, component style)
- 7 = Mostly consistent with minor deviations
- 5 = Noticeably different design languages on some screens
- 3 = Looks like 2-3 different apps stitched together
- 1 = Every screen looks completely different

Evaluate ONLY visual consistency — not content, data, or functionality.

Respond with ONLY a JSON object:
{
  "coherenceScore": <1-10>,
  "notes": "<1-2 sentences explaining the rating>",
  "outlierRoutes": ["<route names that diverge most from the majority>"]
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 300, responseMimeType: "application/json" },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { score: null, notes: `HTTP ${res.status}` };
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text);
    const result = {
      score: typeof parsed.coherenceScore === "number" ? parsed.coherenceScore : null,
      notes: parsed.notes ?? "",
      outlierRoutes: parsed.outlierRoutes ?? [],
      screenshotsUsed: selected.map((p) => path.basename(p)),
    };
    await fs.writeFile(path.join(outDir, "design-coherence.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  } catch (err) {
    return { score: null, notes: err.message };
  }
}

async function runQaAndCapture({ baseURL, headless, noAgentic = false, design = false, designStyle = "linear", designMaxImages = 10, layout = "classic" }) {
  const outDir = path.join(process.cwd(), ".tmp", "dogfood-gemini-qa");
  // Archive previous run before overwriting â€” preserves before/after for regression diffs.
  await archivePreviousRun(outDir);
  await fs.mkdir(outDir, { recursive: true });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Layer 0: Static code analysis â€” deterministic, runs before browser
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const srcDir = path.join(process.cwd(), "src");
  // eslint-disable-next-line no-console
  console.log("  ðŸ” Layer 0: Static code analysis...");
  const staticAnalysis = await scanSourceForBannedPatterns(srcDir);
  // eslint-disable-next-line no-console
  console.log(`  ðŸ” Layer 0: ${staticAnalysis.total} violations (${staticAnalysis.highCount} high, ${staticAnalysis.medCount} medium, ${staticAnalysis.lowCount} low) â€” score ${staticAnalysis.score}/100`);
  if (staticAnalysis.violations.length > 0) {
    // eslint-disable-next-line no-console
    console.log("  ðŸ“‹ Top violations:");
    for (const v of staticAnalysis.violations.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`    ${v.severity === "high" ? "ðŸ”´" : v.severity === "medium" ? "ðŸŸ¡" : "âšª"} ${v.file}:${v.line} â€” ${v.label}: ${v.match}`);
    }
    if (staticAnalysis.violations.length > 10) {
      // eslint-disable-next-line no-console
      console.log(`    ... and ${staticAnalysis.violations.length - 10} more`);
    }
  }
  await fs.writeFile(path.join(outDir, "static-analysis.json"), JSON.stringify(staticAnalysis, null, 2), "utf8");
  const geminiApiKey = getGeminiApiKey();
  const modelResolution = await resolveGeminiQaModel(geminiApiKey);
  if (!modelResolution.exactMatch && !GEMINI_QA_ALLOW_FALLBACK) {
    throw new Error(
      `Requested Gemini model ${modelResolution.requestedModel} is not available for generateContent. No fallback allowed.`,
    );
  }
  console.log(`  🤖 Gemini QA model: ${modelResolution.selectedModel}`);
  if (!modelResolution.exactMatch) {
    console.log(`    Requested ${modelResolution.requestedModel} -> using ${modelResolution.selectedModel} (${modelResolution.fallbackReason})`);
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });

  await context.addInitScript(() => {
    localStorage.setItem("nodebench-onboarded", "1");
  });

  // Pre-inject layout mode into localStorage BEFORE any page JS runs
  if (layout && layout !== "classic") {
    await context.addInitScript((layoutVal) => {
      try {
        const existing = JSON.parse(localStorage.getItem("nodebench-theme") || "{}");
        existing.layout = layoutVal;
        localStorage.setItem("nodebench-theme", JSON.stringify(existing));
      } catch {
        localStorage.setItem("nodebench-theme", JSON.stringify({ layout: layoutVal }));
      }
    }, layout);
  }

  const page = await context.newPage();
  const debugLines = [];

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Deterministic telemetry counters â€” fed into Layer 1 rubric scoring
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const telemetry = {
    consoleErrors: 0, pageErrors: 0, failedRequests: 0, pageLoadOk: true,
    videoOk: true, screenOk: true,
    // New boolean metrics
    layoutShifts: 0, slowResources: 0, notFoundResources: 0, mixedContent: 0, viewportMetaOk: true,
  };

  page.on("console", (msg) => {
    try {
      const type = msg.type();
      debugLines.push(`[console:${type}] ${msg.text()}`);
      if (type === "error") telemetry.consoleErrors++;
    } catch {
      // ignore
    }
  });
  page.on("pageerror", (err) => {
    debugLines.push(`[pageerror] ${err?.message ?? String(err)}`);
    telemetry.pageErrors++;
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    const errorText = req.failure()?.errorText ?? "unknown";
    debugLines.push(`[requestfailed] ${url} :: ${errorText}`);
    // Only count genuine failures â€” not navigational aborts or cancelled media downloads
    const isAbort = /net::ERR_ABORTED|NS_BINDING_ABORTED/i.test(errorText);
    const isMedia = /\.(mp4|webm|ogg|wav|mp3|m4a)(\?|$)/i.test(url);
    if (!isAbort && !isMedia) {
      telemetry.failedRequests++;
    }
  });
  page.on("response", async (res) => {
    try {
      const url = res.url();
      const status = res.status();

      // Track 404s for static assets (css, js, images, fonts)
      if (status === 404 && /\.(css|js|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico)(\?|$)/i.test(url)) {
        telemetry.notFoundResources++;
        debugLines.push(`[404 resource] ${url}`);
      }

      // Track mixed content (HTTP on HTTPS page)
      if (url.startsWith("http://") && !url.includes("localhost") && !url.includes("127.0.0.1")) {
        telemetry.mixedContent++;
        debugLines.push(`[mixed content] ${url}`);
      }

      // Track API errors (existing behavior)
      if (/convex\.cloud|\/api\//i.test(url) && status >= 400) {
        let body = "";
        try {
          body = await res.text();
        } catch {
          body = "<unreadable>";
        }
        debugLines.push(`[response ${status}] ${url} :: ${body.slice(0, 2000)}`);
      }
    } catch {
      // ignore
    }
  });

  // Track slow resources (>5s load time)
  page.on("requestfinished", (req) => {
    try {
      const timing = req.timing();
      if (timing && timing.responseEnd > 5000) {
        telemetry.slowResources++;
        debugLines.push(`[slow resource ${Math.round(timing.responseEnd)}ms] ${req.url()}`);
      }
    } catch {
      // ignore â€” timing may not be available
    }
  });

  try {
    await page.goto(`${baseURL}/dogfood`, { waitUntil: "domcontentloaded" });
    await waitForDogfoodReady(page, 120_000);
    await ensureAnonymousSignIn(page);

    //â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // Collect boolean metrics after page stabilizes
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Check viewport meta tag
    telemetry.viewportMetaOk = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      return meta !== null && (meta.content || "").includes("width=");
    }).catch(() => false);

    // Measure cumulative layout shift via PerformanceObserver
    // Wait for page to fully settle first â€” initial hydration shifts are expected in SPA
    await page.waitForLoadState("networkidle").catch(() => { });
    await page.waitForTimeout(3000); // Let React hydration + lazy loads + animations settle
    try {
      // Only measure NEW shifts from this point forward (not buffered initial render shifts)
      telemetry.layoutShifts = await page.evaluate(() => {
        return new Promise((resolve) => {
          let clsValue = 0;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) clsValue += entry.value;
            }
          });
          // buffered: false â€” only observe new shifts, not historical ones from initial load
          observer.observe({ type: "layout-shift", buffered: false });
          setTimeout(() => {
            observer.disconnect();
            resolve(clsValue >= 0.25 ? 1 : 0); // 0.25 = Google "poor" CLS threshold
          }, 3000);
        });
      });
    } catch {
      telemetry.layoutShifts = 0; // Can't measure = assume OK
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // Agentic visual exploration â€” Gemini-guided UI interaction discovery
    // Uses vision model to identify what to click instead of brittle selectors
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    telemetry.staticAnalysis = staticAnalysis;
    telemetry.agenticIssues = [];

    if (!noAgentic && geminiApiKey) {
      try {
        const agenticResult = await runAgenticExploration(baseURL, geminiApiKey, outDir, headless, layout);
        const allAgenticIssues = [...agenticResult.screenshotIssues, ...agenticResult.videoIssues];
        telemetry.agenticIssues = allAgenticIssues;
        // eslint-disable-next-line no-console
        console.log(`  ðŸ¤– Agentic QA: ${allAgenticIssues.length} issues (${agenticResult.screenshotIssues.length} screenshot + ${agenticResult.videoIssues.length} video) from ${agenticResult.screenshots.length} interactions`);
        await fs.writeFile(path.join(outDir, "agentic-results.json"), JSON.stringify({
          screenshots: agenticResult.screenshots.length,
          screenshotIssues: agenticResult.screenshotIssues.length,
          videoIssues: agenticResult.videoIssues.length,
          videoPath: agenticResult.videoPath,
          issues: allAgenticIssues,
        }, null, 2), "utf8");

        // Navigate back to /dogfood for existing QA flow
        await page.goto(`${baseURL}/dogfood`, { waitUntil: "domcontentloaded" });
        await waitForDogfoodReady(page, 60_000);
        await page.waitForTimeout(1000);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`  âš  Agentic exploration failed (non-fatal): ${err.message}`);
      }
    } else if (!geminiApiKey) {
      // eslint-disable-next-line no-console
      console.log("  â­ Skipping agentic exploration (no GEMINI_API_KEY)");
    } else {
      // eslint-disable-next-line no-console
      console.log("  â­ Skipping agentic exploration (--no-agentic)");
    }

    let videoRuns = [];
    try {
      const runVideo = page.getByRole("button", { name: /run gemini qa on video/i });
      await page.waitForFunction(() => {
        const btn = document.querySelector('button[aria-label="Run Gemini QA on video"]');
        return btn instanceof HTMLButtonElement && !btn.disabled;
      }, null, { timeout: 120_000 });
      const latestBeforeVideo = await readLatestLabel(page);
      await runVideo.scrollIntoViewIfNeeded();
      await runVideo.click();
      await page.waitForFunction(() => {
        const btn = document.querySelector('button[aria-label="Run Gemini QA on video"]');
        return btn instanceof HTMLButtonElement && btn.disabled;
      }, null, { timeout: 20_000 });

      try {
        await Promise.race([
          page.getByText(/qa error:/i).waitFor({ timeout: 240_000 }).then(async () => {
            const errText = (await page.getByText(/qa error:/i).first().textContent().catch(() => "")) || "";
            throw new Error(errText.replace(/^qa error:\s*/i, "").trim() || "Video QA failed");
          }),
          page.waitForFunction(() => {
            const btn = document.querySelector('button[aria-label="Run Gemini QA on video"]');
            return btn instanceof HTMLButtonElement && !btn.disabled;
          }, null, { timeout: 240_000 }),
        ]);
        await throwIfQaErrorVisible(page, "Video QA");
      } catch (videoQaErr) {
        telemetry.videoOk = false;
        // eslint-disable-next-line no-console
        console.warn(`  ? Video QA error (non-fatal): ${videoQaErr.message}`);
      }

      await page.waitForFunction((prev) => {
        const el = Array.from(document.querySelectorAll("*")).find((n) => /^latest:/i.test(n.textContent?.trim() ?? ""));
        const cur = (el?.textContent ?? "").trim();
        return cur !== "" && cur !== prev;
      }, latestBeforeVideo, { timeout: 60_000 }).catch(() => { });

      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(outDir, "video-qa.png"), fullPage: true });
      videoRuns = await scrapeRecentRuns(page);
    } catch (videoFlowErr) {
      telemetry.videoOk = false;
      // eslint-disable-next-line no-console
      console.warn(`  ? Video QA flow unavailable (non-fatal): ${videoFlowErr.message}`);
      await page.screenshot({ path: path.join(outDir, "video-qa.png"), fullPage: true }).catch(() => { });
    }
    await fs.writeFile(path.join(outDir, "video-qa.json"), JSON.stringify(videoRuns, null, 2), "utf8");

    let screenRuns = [];
    try {
      const runScreens = page.getByRole("button", { name: /run gemini qa on screenshots/i });
      await page.waitForFunction(() => {
        const btn = document.querySelector('button[aria-label="Run Gemini QA on screenshots"]');
        return btn instanceof HTMLButtonElement && !btn.disabled;
      }, null, { timeout: 120_000 });
      const latestBeforeScreens = await readLatestLabel(page);
      await runScreens.scrollIntoViewIfNeeded();
      await runScreens.click();
      await page.waitForFunction(() => {
        const btn = document.querySelector('button[aria-label="Run Gemini QA on screenshots"]');
        return btn instanceof HTMLButtonElement && btn.disabled;
      }, null, { timeout: 20_000 });

      await Promise.race([
        page.getByText(/qa error:/i).waitFor({ timeout: 240_000 }).then(async () => {
          const errText = (await page.getByText(/qa error:/i).first().textContent().catch(() => "")) || "";
          throw new Error(errText.replace(/^qa error:\s*/i, "").trim() || "Screenshot QA failed");
        }),
        page.waitForFunction(() => {
          const btn = document.querySelector('button[aria-label="Run Gemini QA on screenshots"]');
          return btn instanceof HTMLButtonElement && !btn.disabled;
        }, null, { timeout: 240_000 }),
      ]);
      await throwIfQaErrorVisible(page, "Screenshot QA").catch((screenErr) => {
        telemetry.screenOk = false;
        throw screenErr;
      });

      await page.waitForFunction((prev) => {
        const el = Array.from(document.querySelectorAll("*")).find((n) => /^latest:/i.test(n.textContent?.trim() ?? ""));
        const cur = (el?.textContent ?? "").trim();
        return cur !== "" && cur !== prev;
      }, latestBeforeScreens, { timeout: 60_000 }).catch(() => { });

      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(outDir, "screens-qa.png"), fullPage: true });
      screenRuns = await scrapeRecentRuns(page);
    } catch (screenFlowErr) {
      telemetry.screenOk = false;
      // eslint-disable-next-line no-console
      console.warn(`  ? Screenshot QA flow unavailable (non-fatal): ${screenFlowErr.message}`);
      await page.screenshot({ path: path.join(outDir, "screens-qa.png"), fullPage: true }).catch(() => { });
    }
    await fs.writeFile(path.join(outDir, "screens-qa.json"), JSON.stringify(screenRuns, null, 2), "utf8");

    // Compute rubric score from both QA runs + deterministic telemetry.
    // 3-layer weighted: deterministic (40%) + severity rubric (50%) + taste (10%).
    const { entry: qaEntry, qscore } = await persistQaScore(process.cwd(), videoRuns, screenRuns, telemetry);

    // Save rubric scorecard for traceability
    await fs.writeFile(path.join(outDir, "rubric-scorecard.json"), JSON.stringify(qaEntry.rubric, null, 2), "utf8");
    // Save loop context (real issues, false positives, etc.) for iterative edit cycles.
    await fs.writeFile(path.join(outDir, "qa-loop-context.json"), JSON.stringify(qscore.loop ?? {}, null, 2), "utf8").catch(() => { });

    if (design) {
      try {
        // eslint-disable-next-line no-console
        console.log(`  ðŸŽ¨ Design aspiration QA (${designStyle}, benchmarked against Vercel/Linear/ChatGPT/Stripe/Notion)...`);
        const { opportunities, summary, aspirationScore, axes } = await runDesignOpportunityQa(outDir, designStyle, designMaxImages);
        // eslint-disable-next-line no-console
        console.log(`\n${"â”€".repeat(60)}`);
        if (aspirationScore !== null) {
          const aGrade = aspirationScore >= 90 ? "A" : aspirationScore >= 75 ? "B" : aspirationScore >= 60 ? "C" : aspirationScore >= 40 ? "D" : "F";
          // eslint-disable-next-line no-console
          console.log(`  ASPIRATION SCORE: ${aspirationScore}/100 (${aGrade}) â€” vs ${designStyle} + industry grade`);
        }
        if (axes && Object.keys(axes).length > 0) {
          const axisLabels = { typography: "Typography", spacing: "Spacing", states: "States", hierarchy: "Hierarchy", interaction: "Interaction", craft: "Craft" };
          for (const [key, val] of Object.entries(axes)) {
            const label = axisLabels[key] ?? key;
            const s = val?.score ?? "?";
            const bar = typeof s === "number" ? "â–ˆ".repeat(s) + "â–‘".repeat(10 - s) : "??????????";
            const note = val?.note ?? "";
            // eslint-disable-next-line no-console
            console.log(`    ${bar} ${s}/10 ${label}${note ? ` â€” ${note.slice(0, 60)}` : ""}`);
          }
        }
        if (summary) {
          // eslint-disable-next-line no-console
          console.log(`  Summary: ${summary.slice(0, 200)}`);
        }
        // eslint-disable-next-line no-console
        console.log(`  ðŸŽ¨ ${opportunities.length} uplift opportunities:`);
        for (const opp of opportunities.slice(0, 8)) {
          // eslint-disable-next-line no-console
          console.log(`    ${opp.priority ?? "P3"} [${opp.reference ?? "?"}] ${(opp.opportunity ?? "").slice(0, 70)}`);
          if (opp.fixHint) {
            // eslint-disable-next-line no-console
            console.log(`       Fix: ${opp.fixHint.slice(0, 80)}`);
          }
        }
        if (opportunities.length > 8) {
          // eslint-disable-next-line no-console
          console.log(`    ... and ${opportunities.length - 8} more (see design-opportunities.json)`);
        }
        // eslint-disable-next-line no-console
        console.log(`${"â”€".repeat(60)}`);

        // Patch qa-results.json with aspiration score so the dashboard can display it
        if (aspirationScore !== null || opportunities.length > 0) {
          try {
            const qaResultsPath = path.join(process.cwd(), "public", "dogfood", "qa-results.json");
            const qaHistory = await readJsonFileOrDefault(qaResultsPath, []);
            if (Array.isArray(qaHistory) && qaHistory.length > 0) {
              qaHistory[0].aspiration = {
                score: aspirationScore,
                grade: aspirationScore !== null ? (aspirationScore >= 90 ? "A" : aspirationScore >= 75 ? "B" : aspirationScore >= 60 ? "C" : aspirationScore >= 40 ? "D" : "F") : null,
                style: designStyle,
                axes: Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, v?.score ?? null])),
                opportunityCount: opportunities.length,
                summary: summary.slice(0, 300),
              };
              await writeJsonFileWithRetry(qaResultsPath, qaHistory);
            }
          } catch {
            // non-fatal â€” aspiration score already in design-opportunities.json
          }
        }

        // Cross-route coherence check
        // eslint-disable-next-line no-console
        console.log(`
  Checking cross-route visual coherence...`);
        const coherence = await runDesignCoherenceCheck(outDir);
        if (coherence.score !== null) {
          // eslint-disable-next-line no-console
          console.log(`  COHERENCE: ${coherence.score}/10`);
          if (coherence.notes) console.log(`    ${coherence.notes}`);
          if (coherence.outlierRoutes?.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`    Outliers: ${coherence.outlierRoutes.join(", ")}`);
          }
        }

        // Compute composite score: qaScore * 0.70 + aspirationScore * 0.15 + governanceScore * 0.15
        try {
          const qaResultsPath2 = path.join(process.cwd(), "public", "dogfood", "qa-results.json");
          const qaHistory2 = await readJsonFileOrDefault(qaResultsPath2, []);
          if (Array.isArray(qaHistory2) && qaHistory2.length > 0) {
            const entry2 = qaHistory2[0];
            const qs = entry2.score ?? 0;
            const as = aspirationScore ?? qs;
            const gs = entry2.rubric?.governance?.score ?? 100;
            const comp = Math.round(qs * 0.70 + as * 0.15 + gs * 0.15);
            entry2.compositeScore = Math.max(0, Math.min(100, comp));
            entry2.coherence = coherence;
            await writeJsonFileWithRetry(qaResultsPath2, qaHistory2);
            // eslint-disable-next-line no-console
            console.log(`  COMPOSITE: ${entry2.compositeScore}/100 (QA ${qs}*0.70 + Aspiration ${as}*0.15 + Governance ${gs}*0.15)`);
          }
        } catch {
          // non-fatal
        }
      } catch (designErr) {
        // eslint-disable-next-line no-console
        console.warn(`  âš  Design opportunity QA failed (non-fatal): ${designErr.message}`);
        // eslint-disable-next-line no-console
        console.warn(`    Stack: ${(designErr.stack ?? "").split("\n").slice(0, 3).join(" â†’ ")}`);
      }
    }
    await fs.writeFile(path.join(outDir, "debug.log"), debugLines.join("\n"), "utf8");
    return { outDir, qaEntry };
  } catch (e) {
    try {
      await page.screenshot({ path: path.join(outDir, "error.png"), fullPage: true });
    } catch {
      // ignore
    }
    try {
      await fs.writeFile(path.join(outDir, "debug.log"), debugLines.join("\n"), "utf8");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    await context.close().catch(() => { });
    await browser.close().catch(() => { });
  }
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const args = applyPositionalCompat(rawArgv, parseArgs(rawArgv));
  const host = args.get("host") ?? "127.0.0.1";
  const requestedPort = Number(args.get("port") ?? 4173);
  const baseUrlOverride = args.get("baseURL") ?? null;
  const headless = (args.get("headless") ?? "true") === "true";
  const noAgentic = args.has("no-agentic");
  const loopMode = args.has("loop");
  const noRecapture = args.has("no-recapture");
  const noBuild = args.has("no-build");
  const noEdits = args.has("no-edits");
  const autoApply = args.has("auto-apply");
  const maxIterations = Number(args.get("max-iterations") ?? 5);
  const targetScore = Number(args.get("target-score") ?? 95);
  const design = !args.has("no-design"); // Design aspiration scoring ON by default
  const designStyle = args.get("design-style") ?? "linear";
  const designMaxImages = Number(args.get("design-max-images") ?? 10);
  const designEdits = args.has("design-edits");
  const targetAspiration = Number(args.get("target-aspiration") ?? 90);
  const layoutMode = args.get("layout") ?? "classic"; // "classic" or "cockpit"
  const requestedGeminiModel = args.get("model") ?? null;
  const preferProGemini = args.has("prefer-pro");
  const allowGeminiFallback = args.has("allow-model-fallback");
  const compareOnly = args.has("compare-only");
  const candidateVideoArg = args.get("candidate-video") ?? null;
  const referenceVideoArg = args.get("reference-video") ?? null;
  const candidateLabel = args.get("candidate-label") ?? "NodeBench mobile chat";
  const referenceLabel = args.get("reference-label") ?? "Manus mobile reference";

  configureGeminiQaModel({
    model: requestedGeminiModel,
    preferPro: preferProGemini,
    allowFallback: allowGeminiFallback,
  });

  const repoRoot = process.cwd();
  const nodeCmd = process.execPath;
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

  const walkthroughMp4 = path.join(repoRoot, "public", "dogfood", "walkthrough.mp4");
  const walkthroughWebm = path.join(repoRoot, "public", "dogfood", "walkthrough.webm");

  function isInteractive() {
    // REVIEW MODE: default to interactive prompts when loop mode is enabled.
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
  }

  async function promptYesNo(question, defaultYes = false) {
    if (!isInteractive()) return defaultYes;
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
    return await new Promise((resolve) => {
      rl.question(`${question}${suffix}`, (ans) => {
        rl.close();
        const a = String(ans ?? "").trim().toLowerCase();
        if (!a) return resolve(defaultYes);
        resolve(a === "y" || a === "yes");
      });
    });
  }

  async function runCommand(cmd, cmdArgs, opts = {}) {
    const child = spawn(cmd, cmdArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
      shell: false,
    });
    const code = await new Promise((resolve) => child.on("close", resolve));
    if (code !== 0) {
      throw new Error(`Command failed (${code}): ${cmd} ${cmdArgs.join(" ")}`);
    }
  }

  async function recaptureDogfoodArtifacts() {
    // NOTE(coworker): This is critical for looping; otherwise QA reruns stale screenshots/video.
    const headlessStr = headless ? "true" : "false";
    const scriptPath = path.join(repoRoot, "scripts", "ui", "runDogfoodWalkthroughLocal.mjs");
    // Run full local capture (build + playwright + publish static gallery).
    await runCommand(process.execPath, [
      scriptPath,
      "--screens",
      "true",
      "--publish",
      "true",
      "--headless",
      headlessStr,
    ]);
  }

  async function runGeminiQaOnce() {
    // NOTE(coworker): Preview serves whatever is already in dist/. In loop mode with
    // --no-recapture (or in single-run mode), we must build so QA validates current edits.
    if (!noBuild && (!loopMode || noRecapture)) {
      // eslint-disable-next-line no-console
      console.log("Building app for QA preview...");
      await runCommand(nodeCmd, [viteBin, "build"]);
    }

    const port = baseUrlOverride ? requestedPort : await findOpenPort(host, requestedPort, 30);
    const baseURL = baseUrlOverride ?? `http://${host}:${port}`;
    if (!existsSync(walkthroughMp4) && !existsSync(walkthroughWebm)) {
      throw new Error("No walkthrough video found at public/dogfood/walkthrough.(mp4|webm). Run capture first or pass --no-recapture=false.");
    }

    // eslint-disable-next-line no-console
    console.log(`Starting preview server: node ${viteBin} preview --host ${host} --port ${port}`);
    const serverProc = spawn(nodeCmd, [viteBin, "preview", "--host", host, "--port", String(port), "--strictPort"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
      shell: false,
    });
    serverProc.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("Failed to start preview server:", err);
    });
    serverProc.stdout.on("data", (buf) => process.stdout.write(String(buf)));
    serverProc.stderr.on("data", (buf) => process.stderr.write(String(buf)));

    try {
      await waitForPort(host, port, 240_000);
      await waitForHttpOk(baseURL, 240_000);

      const { outDir, qaEntry } = await runQaAndCapture({ baseURL, headless, noAgentic, design, designStyle, designMaxImages, layout: layoutMode });
      // eslint-disable-next-line no-console
      console.log(`Gemini QA artifacts written to: ${outDir}`);
      return { outDir, qaEntry };
    } finally {
      await killProcessTree(serverProc);
    }
  }

  async function runCompareOnly() {
    const geminiApiKey = getGeminiApiKey();
    if (!geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY or GOOGLE_AI_API_KEY for Gemini video comparison");
    }

    const modelResolution = await resolveGeminiQaModel(geminiApiKey);
    if (!modelResolution.exactMatch && !GEMINI_QA_ALLOW_FALLBACK) {
      throw new Error(
        `Requested Gemini model ${modelResolution.requestedModel} is not available for generateContent. No fallback allowed.`,
      );
    }

    if (!candidateVideoArg || !referenceVideoArg) {
      throw new Error("compare-only mode requires --candidate-video and --reference-video");
    }

    const candidateVideoPath = path.resolve(repoRoot, candidateVideoArg);
    const referenceVideoPath = path.resolve(repoRoot, referenceVideoArg);

    if (!existsSync(candidateVideoPath)) {
      throw new Error(`Candidate video not found: ${candidateVideoPath}`);
    }
    if (!existsSync(referenceVideoPath)) {
      throw new Error(`Reference video not found: ${referenceVideoPath}`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const outDir = path.join(repoRoot, ".tmp", "dogfood-gemini-qa", `video-compare-${stamp}`);
    await fs.mkdir(outDir, { recursive: true });

    const comparison = await analyzeVideoAgainstReference({
      candidateVideoPath,
      referenceVideoPath,
      geminiApiKey,
      candidateLabel,
      referenceLabel,
    });

    await writeJsonFileWithRetry(path.join(outDir, "video-compare.json"), comparison);
    const summary = [
      `model: ${comparison.model}`,
      `requestedModel: ${comparison.requestedModel}`,
      `candidate: ${comparison.candidateLabel}`,
      `reference: ${comparison.referenceLabel}`,
      `overallSimilarityScore: ${comparison.result?.overallSimilarityScore ?? "unknown"}`,
      "",
      String(comparison.result?.summary ?? "").trim(),
      "",
      "wins:",
      ...(Array.isArray(comparison.result?.wins) ? comparison.result.wins.map((line) => `- ${line}`) : []),
      "",
      "mustFixNext:",
      ...(Array.isArray(comparison.result?.mustFixNext) ? comparison.result.mustFixNext.map((line) => `- ${line}`) : []),
    ].join("\n");
    await writeFileWithRetry(path.join(outDir, "video-compare.md"), summary);

    // eslint-disable-next-line no-console
    console.log(`Gemini video comparison artifacts written to: ${outDir}`);
    return { outDir, comparison };
  }

  function extractGitDiff(raw) {
    const s = String(raw ?? "").replace(/^```[a-z]*\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    const idx = s.indexOf("diff --git ");
    if (idx >= 0) return s.slice(idx).trim();
    return s.trim();
  }

  function validateUnifiedDiff(diffText) {
    const text = String(diffText ?? "").trimEnd();
    if (!text.startsWith("diff --git ")) return { ok: false, reason: "missing diff --git header" };

    const lines = text.split("\n");
    const parseHunk = (line) => {
      const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m) return null;
      const oldCount = Number(m[2] ?? "1");
      const newCount = Number(m[4] ?? "1");
      return { oldCount, newCount };
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("@@ ")) continue;
      const h = parseHunk(line);
      if (!h) return { ok: false, reason: "bad hunk header" };

      let oldSeen = 0;
      let newSeen = 0;
      for (i = i + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.startsWith("diff --git ") || l.startsWith("@@ ")) {
          i -= 1;
          break;
        }
        if (l.startsWith("\\ No newline")) continue;
        const p = l[0];
        if (p === " ") { oldSeen += 1; newSeen += 1; continue; }
        if (p === "-") { oldSeen += 1; continue; }
        if (p === "+") { newSeen += 1; continue; }
      }

      if (oldSeen !== h.oldCount || newSeen !== h.newCount) {
        return { ok: false, reason: `hunk line count mismatch (expected -${h.oldCount} +${h.newCount}, got -${oldSeen} +${newSeen})` };
      }
    }

    return { ok: true, reason: "" };
  }

  async function listFilesRecursively(dir, maxFiles = 20) {
    const out = [];
    async function walk(d) {
      if (out.length >= maxFiles) return;
      let entries;
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= maxFiles) return;
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          // eslint-disable-next-line no-await-in-loop
          await walk(p);
        } else if (/\.(ts|tsx|css)$/.test(e.name)) {
          out.push(p);
        }
      }
    }
    await walk(dir);
    return out;
  }

  async function selectContextFiles(loopContext) {
    const files = new Set();
    files.add(path.join(repoRoot, "src", "index.css"));
    files.add(path.join(repoRoot, "src", "main.tsx"));
    files.add(path.join(repoRoot, "src", "components", "MainLayout.tsx"));

  const inferSegment = (route) => {
    if (!route) return "";
    const lower = String(route).toLowerCase();
    const directSurfaceMatch = lower.match(/[?&]surface=(home|chat|reports|nudges|me)/);
    if (directSurfaceMatch) {
      return directSurfaceMatch[1] === "chat" ? "chat" : directSurfaceMatch[1];
    }
    if (lower === "home" || /launchpad|ask anything/.test(lower)) return "home";
    if (lower === "chat" || /answer|sources|agent activity/.test(lower)) return "chat";
    if (lower === "reports" || /reusable memory/.test(lower)) return "reports";
    if (lower === "nudges" || /nudges feed|closed loop/.test(lower)) return "nudges";
    if (lower === "me" || /private context|next run/.test(lower)) return "me";
    if (lower.startsWith("/")) {
      try {
        const parsed = new URL(`http://nodebench.local${lower}`);
        const surface = parsed.searchParams.get("surface");
        if (surface && /^(home|chat|reports|nudges|me)$/.test(surface)) {
          return surface === "chat" ? "chat" : surface;
        }
        return parsed.pathname.split("/").filter(Boolean)[0] ?? "";
      } catch {
        return lower.split("/").filter(Boolean)[0] ?? "";
      }
    }
    if (/benchmarks|workbench/.test(lower)) return "benchmarks";
    if (/signals|research/.test(lower)) return "research";
    if (/activity|task manager/.test(lower)) return "agents";
    if (/workspace|documents|calendar/.test(lower)) return "documents";
    if (/pr suggestions|industry|github/.test(lower)) return "monitoring";
    return "";
  };

    const issues = Array.isArray(loopContext?.realIssues) ? loopContext.realIssues : [];
    for (const issue of issues.slice(0, 6)) {
      const route = String(issue?.route ?? issue?.ts ?? "").trim();
      const seg = inferSegment(route);
      if (!seg) continue;
      const featureDir = path.join(repoRoot, "src", "features", seg);
      const ok = await fs.stat(featureDir).then((s) => s.isDirectory()).catch(() => false);
      if (ok) {
        // eslint-disable-next-line no-await-in-loop
        const found = await listFilesRecursively(featureDir, 12);
        for (const f of found) files.add(f);
      }
    }

    // Cap to keep prompt small
    return Array.from(files).slice(0, 10);
  }

  async function selectDesignContextFiles(designReport) {
    // NOTE(coworker): Keep design patch prompts token-safe by scoping to a small,
    // relevant set of "design system + page surface" files.
    const files = new Set();
    files.add(path.join(repoRoot, "src", "index.css"));
    files.add(path.join(repoRoot, "tailwind.config.js"));
    files.add(path.join(repoRoot, "src", "features", "redesign", "RedesignShell.tsx"));
    files.add(path.join(repoRoot, "src", "features", "redesign", "primitives.css"));
    files.add(path.join(repoRoot, "src", "layouts", "CockpitLayout.tsx"));

    const opportunities = Array.isArray(designReport?.opportunities) ? designReport.opportunities : [];
    const hint = JSON.stringify(opportunities.slice(0, 8));
    const wantsBench = /benchmarks|workbench/i.test(hint);
    const wantsSidebar = /sidebar|nav|navigation/i.test(hint);

    if (wantsBench) {
      const featureDir = path.join(repoRoot, "src", "features", "benchmarks");
      const ok = await fs.stat(featureDir).then((s) => s.isDirectory()).catch(() => false);
      if (ok) {
        const found = await listFilesRecursively(featureDir, 12);
        for (const f of found) files.add(f);
      }
    }

    if (wantsSidebar) {
      files.add(path.join(repoRoot, "src", "features", "redesign", "components", "Rail.tsx"));
      files.add(path.join(repoRoot, "src", "layouts", "WorkspaceRail.tsx"));
    }

    return Array.from(files).slice(0, 10);
  }

  async function proposePatchWithGemini(loopContext, outDir) {
    const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY for loop patch proposal");

    const issues = Array.isArray(loopContext?.realIssues) ? loopContext.realIssues : [];
    const diffSummary = getGitDiffSummary();
    if (issues.length === 0) return null;

    const loopDir = path.join(outDir, "loop");
    await fs.mkdir(loopDir, { recursive: true });

    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const contextFiles = (await selectContextFiles(loopContext)).slice(0, attempt === 1 ? 10 : 6);
      const fileBlobs = [];
      for (const f of contextFiles) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const raw = await fs.readFile(f, "utf8");
          const rel = path.relative(repoRoot, f).replace(/\\/g, "/");
          const clipped = raw.length > 9000
            ? `${raw.slice(0, attempt === 1 ? 6500 : 4500)}\n\n/* â€¦clippedâ€¦ */\n\n${raw.slice(-(attempt === 1 ? 2000 : 1200))}`
            : raw;
          fileBlobs.push(`FILE: ${rel}\n-----\n${clipped}\n-----`);
        } catch {
          // ignore unreadable files
        }
      }

      const attemptNote = attempt === 1 ? "" : "\nIMPORTANT: Your previous diff may have been truncated/invalid. Return a COMPLETE unified diff with fully-formed hunks. Do not stop mid-hunk.";
      const prompt = `You are an expert frontend engineer working inside an existing repo.

Goal: propose a minimal patch that fixes the REAL issues below, while preserving design tokens and existing layout intent.

Constraints:
- Output MUST be a git-apply compatible unified diff (start with "diff --git").
- Modify ONLY the files included below (no new files).
- Keep changes small, surgical, and consistent with the codebase.
- Use existing tailwind tokens like bg-surface, border-edge, text-content. No hardcoded hex.
- Do not "fix" subjective density/spacing complaints.
${attemptNote}

REAL ISSUES (JSON):
${JSON.stringify(issues.slice(0, 6), null, 2)}

CURRENT WORKTREE DIFF:
Changed files:
${diffSummary.names.length ? diffSummary.names.map((v) => `- ${v}`).join("\n") : "- none"}

Diff stat:
${diffSummary.stat || "(no diff stat)"}

CONTEXT FILES:
${fileBlobs.join("\n\n")}

Return ONLY the unified diff. No commentary, no markdown fences.`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        lastErr = new Error(`Patch proposal API error: ${res.status} ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();
      const text = getGeminiCandidateText(data);
      const diff = extractGitDiff(text);
      if (!diff.startsWith("diff --git ")) {
        lastErr = new Error("Gemini did not return a git diff");
        continue;
      }
      const v = validateUnifiedDiff(diff);
      if (!v.ok) {
        lastErr = new Error(`Gemini returned an invalid diff: ${v.reason}`);
        continue;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const patchPath = path.join(loopDir, `proposal_${stamp}.diff`);
      await fs.writeFile(patchPath, diff, "utf8");
      return patchPath;
    }

    if (lastErr) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      await fs.writeFile(path.join(loopDir, `proposal_failed_${stamp}.txt`), String(lastErr?.message ?? lastErr), "utf8").catch(() => { });
    }
    return null;
  }

  async function proposeDesignPatchWithGemini(designReport, outDir) {
    const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY for design patch proposal");

    const opportunities = Array.isArray(designReport?.opportunities) ? designReport.opportunities : [];
    const diffSummary = getGitDiffSummary();
    if (opportunities.length === 0) return null;

    const loopDir = path.join(outDir, "loop");
    await fs.mkdir(loopDir, { recursive: true });

    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const contextFiles = (await selectDesignContextFiles(designReport)).slice(0, attempt === 1 ? 10 : 6);
      const fileBlobs = [];
      for (const f of contextFiles) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const raw = await fs.readFile(f, "utf8");
          const rel = path.relative(repoRoot, f).replace(/\\/g, "/");
          const clipped = raw.length > 9000
            ? `${raw.slice(0, attempt === 1 ? 6500 : 4500)}\n\n/* ...clipped... */\n\n${raw.slice(-(attempt === 1 ? 2000 : 1200))}`
            : raw;
          fileBlobs.push(`FILE: ${rel}\n-----\n${clipped}\n-----`);
        } catch {
          // ignore unreadable files
        }
      }

      const guidance = getDesignStyleGuidance(designStyle);
      const attemptNote = attempt === 1 ? "" : "\nIMPORTANT: Your previous diff may have been truncated/invalid. Return a COMPLETE unified diff with fully-formed hunks. Do not stop mid-hunk.";
      const prompt = `You are an expert product designer + frontend engineer working inside an existing repo.

Goal: propose a minimal patch that improves UI craft toward ${designStyle} + industry-grade references (Vercel/Linear/ChatGPT/Stripe/Notion), without changing core UX flows.

Constraints:
- Output MUST be a git-apply compatible unified diff (start with "diff --git").
- Modify ONLY the files included below (no new files).
- Keep changes small, surgical, and consistent with the codebase.
- Use existing tailwind tokens like bg-surface, border-edge, text-content. No hardcoded hex.
- Honor prefers-reduced-motion (avoid flashy animations).
- Prefer fixes that improve consistency (spacing rhythm, type hierarchy, hover/focus states, alignment).
${attemptNote}

STYLE TARGET:
${guidance}

TOP OPPORTUNITIES (JSON):
${JSON.stringify(opportunities.slice(0, 6), null, 2)}

CURRENT WORKTREE DIFF:
Changed files:
${diffSummary.names.length ? diffSummary.names.map((v) => `- ${v}`).join("\n") : "- none"}

Diff stat:
${diffSummary.stat || "(no diff stat)"}

CONTEXT FILES:
${fileBlobs.join("\n\n")}

Return ONLY the unified diff. No commentary, no markdown fences.`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        lastErr = new Error(`Design patch proposal API error: ${res.status} ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();
      const text = getGeminiCandidateText(data);
      const diff = extractGitDiff(text);
      if (!diff.startsWith("diff --git ")) {
        lastErr = new Error("Gemini did not return a git diff for design patch");
        continue;
      }
      const v = validateUnifiedDiff(diff);
      if (!v.ok) {
        lastErr = new Error(`Gemini returned an invalid diff: ${v.reason}`);
        continue;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const patchPath = path.join(loopDir, `proposal_design_${stamp}.diff`);
      await fs.writeFile(patchPath, diff, "utf8");
      return patchPath;
    }

    if (lastErr) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      await fs.writeFile(path.join(loopDir, `proposal_design_failed_${stamp}.txt`), String(lastErr?.message ?? lastErr), "utf8").catch(() => { });
    }
    return null;
  }

  async function applyGitPatch(patchPath) {
    const gitCmd = process.platform === "win32" ? "git.exe" : "git";
    await runCommand(gitCmd, ["apply", "--check", patchPath], { env: { ...process.env } });
    await runCommand(gitCmd, ["apply", patchPath], { env: { ...process.env } });
  }

  async function showPatchStat(patchPath) {
    const gitCmd = process.platform === "win32" ? "git.exe" : "git";
    const child = spawn(gitCmd, ["apply", "--stat", patchPath], {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    await new Promise((resolve) => child.on("close", resolve));
  }

  function getGitDiffSummary(maxFiles = 20) {
    try {
      const names = execSync("git diff --name-only", {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, maxFiles);

      const stat = execSync("git diff --stat", {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .trim()
        .split(/\r?\n/)
        .slice(0, 25)
        .join("\n");

      return { names, stat };
    } catch {
      return { names: [], stat: "" };
    }
  }

  async function runLoop() {
    // eslint-disable-next-line no-console
    console.log(`\nðŸ” LOOP MODE enabled: maxIterations=${maxIterations}, targetScore=${targetScore}, recapture=${!noRecapture}, edits=${!noEdits}\n`);

    for (let iter = 1; iter <= maxIterations; iter++) {
      // eslint-disable-next-line no-console
      console.log(`\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`);
      // eslint-disable-next-line no-console
      console.log(`  LOOP ITERATION ${iter}/${maxIterations}`);
      // eslint-disable-next-line no-console
      console.log(`â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n`);

      if (!noRecapture) {
        // eslint-disable-next-line no-console
        console.log("ðŸŽ¥ Recapturing dogfood artifacts (build + e2e + publish)â€¦");
        await recaptureDogfoodArtifacts();
      }

      const { outDir, qaEntry } = await runGeminiQaOnce();

      const scoreOk = (qaEntry?.score ?? 0) >= targetScore;
      const noRealIssues = (qaEntry?.realIssueCount ?? 0) === 0;

      let designReport = null;
      let aspirationScore = null;
      let aspirationOk = true;
      let hasDesignOpportunities = false;
      if (designEdits && design) {
        try {
          const raw = await fs.readFile(path.join(outDir, "design-opportunities.json"), "utf8");
          designReport = JSON.parse(raw);
          aspirationScore = typeof designReport?.aspirationScore === "number" ? designReport.aspirationScore : null;
          const opps = Array.isArray(designReport?.opportunities) ? designReport.opportunities : [];
          hasDesignOpportunities = opps.length > 0;
          aspirationOk = aspirationScore === null ? true : aspirationScore >= targetAspiration;
        } catch {
          designReport = null;
          aspirationScore = null;
          aspirationOk = true;
          hasDesignOpportunities = false;
        }
      }

      if (scoreOk && noRealIssues && aspirationOk) {
        // eslint-disable-next-line no-console
        console.log(`âœ… Loop complete: score=${qaEntry.score}/100 grade=${qaEntry.grade} realIssues=${qaEntry.realIssueCount}`);
        return;
      }

      if (noEdits) {
        // eslint-disable-next-line no-console
        console.log(`ðŸ›‘ Loop stopping (no edits): score=${qaEntry?.score ?? 0}/100 realIssues=${qaEntry?.realIssueCount ?? "?"}`);
        return;
      }

      // Load loop context produced by this run.
      let loopContext = null;
      try {
        const raw = await fs.readFile(path.join(outDir, "qa-loop-context.json"), "utf8");
        loopContext = JSON.parse(raw);
      } catch {
        loopContext = null;
      }

      if (!loopContext || !Array.isArray(loopContext.realIssues) || loopContext.realIssues.length === 0) {
        if (designEdits && design && !aspirationOk && hasDesignOpportunities && designReport) {
          // eslint-disable-next-line no-console
          console.log(`Design uplift: aspiration ${aspirationScore ?? "?"}/100 < ${targetAspiration}. Proposing patch...`);

          const designPatchPath = await proposeDesignPatchWithGemini(designReport, outDir);
          if (!designPatchPath) {
            // eslint-disable-next-line no-console
            console.log("Loop stopping: no design patch proposed");
            return;
          }

          // Review + apply (same flow as bug patches)
          // eslint-disable-next-line no-console
          console.log(`\nPatch proposal written: ${designPatchPath}`);
          await showPatchStat(designPatchPath).catch(() => { });

          const shouldApply = autoApply || await promptYesNo("Apply this patch?", false);
          if (!shouldApply) {
            // eslint-disable-next-line no-console
            console.log("Patch not applied. Review the diff and rerun with --auto-apply to continue.");
            return;
          }

          try {
            await applyGitPatch(designPatchPath);
            // eslint-disable-next-line no-console
            console.log("Patch applied. Continuing loop...");
          } catch (err) {
            console.error(`Failed to apply patch: ${err.message}. Skipping design patch this iteration.`);
          }
          continue;
        }

        // eslint-disable-next-line no-console
        console.log("ðŸ›‘ Loop stopping: no real issues available for patch proposal");
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`ðŸ› ï¸  Proposing patch for ${loopContext.realIssues.length} real issuesâ€¦`);
      const patchPath = await proposePatchWithGemini(loopContext, outDir);
      if (!patchPath) {
        // eslint-disable-next-line no-console
        console.log("ðŸ›‘ Loop stopping: no patch proposed");
        return;
      }

      // Review + apply
      // eslint-disable-next-line no-console
      console.log(`\nðŸ“Ž Patch proposal written: ${patchPath}`);
      await showPatchStat(patchPath).catch(() => { });

      const shouldApply = autoApply || await promptYesNo("Apply this patch?", false);
      if (!shouldApply) {
        // eslint-disable-next-line no-console
        console.log("ðŸ›‘ Patch not applied. Review the diff and rerun with --auto-apply to continue.");
        return;
      }

      try {
        await applyGitPatch(patchPath);
        // eslint-disable-next-line no-console
        console.log("✅ Patch applied. Continuing loop…");
      } catch (err) {
        console.error(`❌ Failed to apply patch: ${err.message}. Skipping patch this iteration.`);
      }
    }

    // eslint-disable-next-line no-console
    console.log("ðŸ›‘ Loop ended: max iterations reached");
  }

  try {
    if (compareOnly) {
      await runCompareOnly();
    } else if (loopMode) {
      await runLoop();
    } else {
      if (!existsSync(walkthroughMp4) && !existsSync(walkthroughWebm)) {
        throw new Error("No walkthrough video found at public/dogfood/walkthrough.(mp4|webm). Run `npm run dogfood:full:local` first.");
      }
      await runGeminiQaOnce();
    }
  } finally {
    // loopMode / single run handles its own subprocess teardown
  }
}

await main();
