import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

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

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeWriteTextFile(filePath, contents, encoding = "utf8") {
  await mkdir(path.dirname(filePath), { recursive: true });

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    try {
      await writeFile(tempPath, contents, encoding);
      await rm(filePath, { force: true }).catch(() => {});
      await rename(tempPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      await rm(tempPath, { force: true }).catch(() => {});
      await sleep(200 * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`Failed to write ${filePath}`);
}

async function installOverlay(page) {
  await page.addStyleTag({
    content: `
      #__nodebench_scribe_overlay {
        position: fixed;
        bottom: 16px;
        left: 16px;
        z-index: 2147483647;
        background: rgba(0,0,0,0.66);
        border: 1px solid rgba(255,255,255,0.18);
        color: rgba(255,255,255,0.92);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial;
        font-size: 12px;
        padding: 10px 12px;
        border-radius: 12px;
        backdrop-filter: blur(10px);
        max-width: 64ch;
        box-shadow: 0 16px 60px rgba(0,0,0,0.35);
      }
      #__nodebench_scribe_overlay strong { font-weight: 650; color: white; }
      #__nodebench_scribe_overlay .sub { opacity: 0.9; margin-top: 2px; }
    `,
  });

  await page.evaluate(() => {
    document.getElementById("__nodebench_scribe_overlay")?.remove();
    const el = document.createElement("div");
    el.id = "__nodebench_scribe_overlay";
    el.innerHTML = `<strong>Dogfood How-to</strong><div class="sub">Initializing...</div>`;
    document.documentElement.appendChild(el);
  });
}

async function setOverlay(page, title, sub) {
  await page.evaluate(
    ({ title, sub }) => {
      const el = document.getElementById("__nodebench_scribe_overlay");
      if (!el) return;
      el.innerHTML = `<strong>${title}</strong><div class="sub">${sub}</div>`;
    },
    { title, sub },
  );
}

export async function setDogfoodLocalStorage(page) {
  await page.addInitScript(() => {
    localStorage.setItem("nodebench-onboarded", "1");
    localStorage.setItem(
      "nodebench-theme",
      JSON.stringify({
        mode: "dark",
        accentColor: "electric-blue",
        density: "comfortable",
        fontFamily: "Manrope Studio",
        backgroundPattern: "spotlight",
        reducedMotion: false,
      }),
    );
    localStorage.setItem("theme", "dark");
    localStorage.setItem("nodebench:redesign:theme", "dark");
  });
}

// These public guest observations are shared by Scribe and the video recorder.
// An entry being ready does not certify the action suggested by that entry.
export const PUBLIC_DOGFOOD_STEPS = [
  { kind: "route", path: "/?surface=home", name: "Home", description: "Home entry: the guest workspace and empty composer are ready." },
  { kind: "route", path: "/?surface=chat", name: "Chat", description: "Chat entry: the guest workspace is ready. No question is submitted." },
  { kind: "route", path: "/?surface=reports", name: "Reports", readyTitle: "Saved research", description: "Reports entry: Saved research instructions are visible. No saved report is reopened." },
  { kind: "route", path: "/?surface=inbox", name: "Inbox", readyTitle: "Attention review", description: "Inbox entry: Attention review context is visible." },
  { kind: "route", path: "/?surface=me", name: "Me", readyTitle: "Account controls", description: "Me entry: Account controls context is visible. No account action is taken." },
  { kind: "interaction", path: "/?surface=home", name: "Interaction: Home to Chat", status: "NOT_RUN", cause: "This guest capture does not submit live research. An email-backed account and a live answer have not been exercised.", description: "NOT_RUN: live question submission and its answer. The image shows only the ready Home entry." },
  { kind: "interaction", path: "/?surface=home", name: "Interaction: Composer preparation", action: "prepare", description: "Composer preparation: the question is filled and Run research is enabled. The button is not clicked; no answer is claimed." },
  { kind: "interaction", name: "Interaction: Theme toggle", action: "theme", description: "Theme interaction: switch from dark to light and capture the observed light workspace." },
  { kind: "interaction", path: "/?surface=reports", name: "Interaction: Reports to Chat", readyTitle: "Saved research", status: "NOT_RUN", cause: "The guest Reports entry shows Saved research instructions. No saved report is selected or opened in Chat.", description: "NOT_RUN: reopen a saved report in Chat. The image shows only the Saved research entry instructions." },
];

export async function waitForAppReady(page, readyTitle) {
  const workspace = page.getByTestId("one-surface-workspace");
  await workspace.waitFor({ state: "visible", timeout: 20_000 });
  const ready = readyTitle
    ? page.getByTestId("chat-launch-context").locator("strong").filter({ hasText: new RegExp(`^${readyTitle}$`) })
    : page.getByRole("heading", { name: "What do you need to know?", exact: true });
  await ready.waitFor({ state: "visible", timeout: 20_000 });
  // A fresh guest profile must stay a guest; the header's sign-in button is not an auth wall.
  await page.getByRole("button", { name: /^sign in$/i }).waitFor({ state: "visible", timeout: 20_000 });
  const composer = page.locator("textarea:visible");
  if (await composer.count() !== 1) throw new Error("Required capture control missing or ambiguous: composer textarea");
  await page.getByRole("button", { name: /^run research$/i }).waitFor({ state: "visible", timeout: 20_000 });
  const theme = await page.locator("[data-redesign-theme]").getAttribute("data-redesign-theme");
  if (theme !== "dark" && theme !== "light") throw new Error(`Required capture state missing: data-redesign-theme (${theme})`);
  return { theme, observedUrl: page.url(), observedState: readyTitle ?? "Empty guest workspace" };
}

export async function prepareComposer(page) {
  const observation = await waitForAppReady(page);
  const question = "What changed, why does it matter, and what should I do next?";
  const composer = page.locator("textarea:visible");
  await composer.fill(question);
  if (await composer.inputValue() !== question || !await page.getByRole("button", { name: /^run research$/i }).isEnabled()) {
    throw new Error("Required capture state missing: filled composer and enabled Run research");
  }
  return { ...observation, observedState: "Question filled; Run research enabled; not submitted" };
}

export async function observePublicStep(page, step) {
  if (step.path) await page.goto(step.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  let observation;
  if (step.action === "prepare") {
    observation = await prepareComposer(page);
  } else if (step.action === "theme") {
    const before = await page.locator("[data-redesign-theme]").getAttribute("data-redesign-theme");
    if (before !== "dark") throw new Error(`Theme capture expected dark before toggle, observed ${before}`);
    await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-redesign-theme]")?.getAttribute("data-redesign-theme") === "light");
    observation = { theme: "light", observedUrl: page.url(), observedState: "Switched from dark to light; prepared question remains unsubmitted" };
  } else {
    observation = await waitForAppReady(page, step.readyTitle);
  }
  return { ...observation, status: step.status ?? "CAPTURED", ...(step.cause ? { cause: step.cause } : {}) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseURL = args.get("baseURL") ?? "http://127.0.0.1:5173";
  const showOverlay = (args.get("overlay") ?? process.env.DOGFOOD_OVERLAY ?? "0") === "1";
  const settleMs = Number(args.get("settleMs") ?? 1000);
  const headless = (args.get("headless") ?? "true") !== "false";
  const outRoot = path.resolve(process.cwd(), "public", "dogfood", "scribe");
  const manifestOut = path.resolve(process.cwd(), "public", "dogfood", "scribe.json");
  await rm(manifestOut, { force: true });
  await rm(path.resolve(process.cwd(), "public", "dogfood", "scribe.md"), { force: true });
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  const capturedAtIso = new Date().toISOString();
  const userDataDir = path.resolve(process.cwd(), ".tmp", "dogfood-scribe-userdata");
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });

  const steps = PUBLIC_DOGFOOD_STEPS;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1440, height: 900 },
    baseURL,
    serviceWorkers: "block",
  });

  const page = await context.newPage();
  const publishedSteps = [];
  try {
    await setDogfoodLocalStorage(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await page.waitForTimeout(500);

    for (const [idx, step] of steps.entries()) {
      const stepNum = idx + 1;
      const title = `${stepNum}. ${step.name}`;
      const observation = await observePublicStep(page, step);
      await page.waitForTimeout(settleMs);
      if (showOverlay) {
        await installOverlay(page);
        await setOverlay(page, `${step.name}: ${observation.status}`, step.description);
      }

      const fileBase = `${String(stepNum).padStart(2, "0")}-${slugify(step.name) || "step"}.png`;
      const absPath = path.join(outRoot, fileBase);
      await page.screenshot({ path: absPath, fullPage: false });

      publishedSteps.push({
        index: stepNum,
        kind: step.kind,
        name: step.name,
        path: step.path ?? "(interaction)",
        title,
        description: step.description,
        ...observation,
        image: `/dogfood/scribe/${fileBase}`,
      });
    }
  } finally {
    await context.close();
  }

  const manifest = {
    capturedAtIso,
    baseURL,
    captureScope: "public-guest-read-only",
    steps: publishedSteps,
  };

  await safeWriteTextFile(manifestOut, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const mdLines = [
    `# NodeBench Dogfood Walkthrough`,
    ``,
    `Captured: ${capturedAtIso}`,
    ``,
    `Public guest observations only. CAPTURED means the described state was observed; NOT_RUN actions were not performed. This is not a live research or saved-report completion certificate.`,
    ``,
  ];
  for (const s of publishedSteps) {
    mdLines.push(`## ${s.title}`);
    mdLines.push(s.description);
    mdLines.push(`Status: ${s.status}${s.cause ? ` — ${s.cause}` : ""}. Observed theme: ${s.theme}.`);
    mdLines.push(``);
    mdLines.push(`![${s.title}](${s.image})`);
    mdLines.push(``);
  }
  const mdOut = path.resolve(process.cwd(), "public", "dogfood", "scribe.md");
  await safeWriteTextFile(mdOut, mdLines.join("\n"), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote Scribe artifact:\n- public/dogfood/scribe.json\n- public/dogfood/scribe.md\n- public/dogfood/scribe/*.png`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
