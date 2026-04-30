import net from "node:net";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { cp, rm, rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const requireFromScript = createRequire(import.meta.url);
const DEFAULT_DOGFOOD_CONVEX_URL = "https://agile-caribou-964.convex.cloud";

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function removePathRobustly(targetPath) {
  if (!existsSync(targetPath)) return;

  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return;
    } catch (error) {
      if (attempt === attempts - 1) {
        const quarantinePath = `${targetPath}.stale-${Date.now()}`;
        try {
          await rename(targetPath, quarantinePath);
          await rm(quarantinePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
          return;
        } catch {
          throw error;
        }
      }
      await sleep(300 * (attempt + 1));
    }
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
    // Ensure we don't leave a stray `cmd.exe` / preview server running.
    try {
      const taskkill = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      await Promise.race([
        new Promise((resolve) => taskkill.on("exit", resolve)),
        sleep(8000),
      ]);
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
  throw new Error(`Timed out waiting for dev server at ${host}:${port}`);
}

async function isPortOpen(host, port) {
  return await new Promise((resolve) => {
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
}

async function waitForHttpOk(url, timeoutMs) {
  return await waitForHttpReady(url, timeoutMs);
}

function getPreviewAssetProbePaths(distDir, maxAssets = 8) {
  const indexPath = path.join(distDir, "index.html");
  if (!existsSync(indexPath)) return [];

  const html = readFileSync(indexPath, "utf8");
  const assetRefs = new Set();
  const assetRefRegex = /<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g;

  for (const match of html.matchAll(assetRefRegex)) {
    const ref = match[1];
    if (!ref?.startsWith("/assets/")) continue;
    assetRefs.add(ref);
    if (assetRefs.size >= maxAssets) break;
  }

  return Array.from(assetRefs);
}

async function waitForHttpReady(url, timeoutMs, options = {}) {
  const { assetPaths = [] } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Node 18+ has fetch; Node 23 is used in this repo.
      // eslint-disable-next-line no-undef
      const res = await fetch(url, { redirect: "follow" });
      if (res.status === 200) {
        if (assetPaths.length === 0) return;

        const assetStatuses = await Promise.all(
          assetPaths.map(async (assetPath) => {
            try {
              // eslint-disable-next-line no-undef
              const assetRes = await fetch(new URL(assetPath, url), { redirect: "follow" });
              return assetRes.status === 200;
            } catch {
              return false;
            }
          }),
        );

        if (assetStatuses.every(Boolean)) return;
      }
    } catch {
      // ignore
    }
    await sleep(450);
  }
  throw new Error(`Timed out waiting for HTTP at ${url}`);
}

async function waitForAppRoutesReady(baseURL, timeoutMs, routes = ["/", "/?surface=home", "/?surface=chat", "/?surface=reports"]) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const checks = await Promise.all(
        routes.map(async (routePath) => {
          // eslint-disable-next-line no-undef
          const res = await fetch(new URL(routePath, baseURL), { redirect: "follow" });
          if (res.status !== 200) return false;
          const html = await res.text();
          return html.includes('id="root"') || html.includes("id='root'");
        }),
      );
      if (checks.every(Boolean)) return;
    } catch {
      // ignore
    }
    await sleep(450);
  }
  throw new Error(`Timed out waiting for app shell routes at ${baseURL}`);
}

async function syncDogfoodArtifactsToDist(repoRoot, distDir) {
  const publicDogfoodDir = path.join(repoRoot, "public", "dogfood");
  const distDogfoodDir = path.join(distDir, "dogfood");
  if (!existsSync(distDir) || !existsSync(publicDogfoodDir)) return false;

  await removePathRobustly(distDogfoodDir);
  await cp(publicDogfoodDir, distDogfoodDir, { recursive: true, force: true });
  return true;
}

async function runShellCommand(command, { cwd = process.cwd(), env = {} } = {}) {
  const child = spawn(command, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: true,
    windowsHide: true,
  });

  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(Number(code ?? 0)));
  });
}

async function runPlaywrightLaneWithRetry({
  label,
  command,
  cwd,
  env,
  baseURL,
  assetPaths = [],
  retries = 1,
}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await waitForHttpReady(baseURL, 60_000, { assetPaths });
    await waitForAppRoutesReady(baseURL, 60_000);
    const code = await runShellCommand(command, { cwd, env });
    if (code === 0) return;
    if (attempt === retries) {
      throw new Error(`${label} exited with code ${code}`);
    }
    // eslint-disable-next-line no-console
    console.warn(`Retrying ${label} after failure (${attempt + 1}/${retries + 1})...`);
    await sleep(1500);
  }
}

async function runNodeScriptWithRetry({
  label,
  command,
  cwd,
  baseURL,
  assetPaths = [],
  retries = 1,
}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await waitForHttpReady(baseURL, 60_000, { assetPaths });
    await waitForAppRoutesReady(baseURL, 60_000);
    const code = await runShellCommand(command, { cwd });
    if (code === 0) return;
    if (attempt === retries) {
      throw new Error(`${label} exited with code ${code}`);
    }
    // eslint-disable-next-line no-console
    console.warn(`Retrying ${label} after failure (${attempt + 1}/${retries + 1})...`);
    await sleep(1500);
  }
}

async function findOpenPort(host, startPort, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const port = startPort + i;
    // Probe by attempting to listen; if it binds, it's free.
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

function spawnViteServer({ mode, host, port, repoRoot, nodeCmd, viteBin }) {
  const args =
    mode === "dev"
      ? [viteBin, "--host", host, "--port", String(port), "--strictPort"]
      : [viteBin, "preview", "--host", host, "--port", String(port), "--strictPort"];
  const proc = spawn(nodeCmd, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
    shell: false,
  });
  let output = "";
  proc.stdout.on("data", (buf) => {
    const text = String(buf);
    output += text;
    process.stdout.write(text);
  });
  proc.stderr.on("data", (buf) => {
    const text = String(buf);
    output += text;
    process.stderr.write(text);
  });
  proc.on("error", (err) => {
    console.error("Failed to start server:", err);
  });
  return {
    proc,
    getOutput: () => output,
  };
}

function canResolvePackage(packageName, searchPaths) {
  try {
    requireFromScript.resolve(`${packageName}/package.json`, { paths: searchPaths });
    return true;
  } catch {
    return false;
  }
}

async function startViteServerWithRetry({
  mode,
  host,
  initialPort,
  repoRoot,
  nodeCmd,
  viteBin,
  explicitBaseUrl,
}) {
  let currentPort = initialPort;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (mode === "dev") {
      // eslint-disable-next-line no-console
      console.log(`Starting dev server: node ${viteBin} --host ${host} --port ${currentPort}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`Starting preview server: node ${viteBin} preview --host ${host} --port ${currentPort}`);
    }

    const server = spawnViteServer({
      mode,
      host,
      port: currentPort,
      repoRoot,
      nodeCmd,
      viteBin,
    });

    try {
      await waitForPort(host, currentPort, 240_000);
      return {
        serverProc: server.proc,
        port: currentPort,
        baseURL: explicitBaseUrl ?? `http://${host}:${currentPort}`,
      };
    } catch (error) {
      const output = server.getOutput();
      const portInUse = /already in use/i.test(output);
      await killProcessTree(server.proc);

      if (explicitBaseUrl || !portInUse || attempt === 2) {
        throw error;
      }

      currentPort = await findOpenPort(host, currentPort + 1, 30);
      // eslint-disable-next-line no-console
      console.log(`Retrying ${mode} server on port ${currentPort} after port conflict...`);
    }
  }

  throw new Error(`Failed to start ${mode} server`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.get("host") ?? "127.0.0.1";
  const requestedPort = Number(args.get("port") ?? 4317);
  const serverMode = args.get("server") ?? "preview"; // preview | dev
  const explicitBaseUrl = args.get("baseURL") ?? null;
  const initialPort = explicitBaseUrl ? requestedPort : await findOpenPort(host, requestedPort, 30);
  const headless = args.get("headless") ?? "true";
  const scribeOnly = (args.get("scribeOnly") ?? "false") === "true";
  const screens = (args.get("screens") ?? "false") === "true";
  const publish = (args.get("publish") ?? (screens ? "true" : "false")) === "true";
  const scenarios = (args.get("scenarios") ?? (screens ? "true" : "false")) === "true";
  const play = (args.get("play") ?? "false") === "true";
  const routeShards = Math.max(1, Number(args.get("routeShards") ?? process.env.DOGFOOD_ROUTE_SHARDS ?? 1));
  const includeInteractionLane = (args.get("interactions") ?? "true") !== "false";
  const shardMode = (args.get("shardMode") ?? process.env.DOGFOOD_SHARD_MODE ?? "serial").toLowerCase();

  const repoRoot = process.cwd();
  if (!process.env.VITE_CONVEX_URL && !process.env.CONVEX_URL) {
    process.env.VITE_CONVEX_URL = DEFAULT_DOGFOOD_CONVEX_URL;
    process.env.CONVEX_URL = DEFAULT_DOGFOOD_CONVEX_URL;
    // eslint-disable-next-line no-console
    console.warn(`Using ${DEFAULT_DOGFOOD_CONVEX_URL} for local dogfood because no Convex URL env was configured.`);
  } else if (!process.env.VITE_CONVEX_URL && process.env.CONVEX_URL) {
    process.env.VITE_CONVEX_URL = process.env.CONVEX_URL;
  } else if (!process.env.CONVEX_URL && process.env.VITE_CONVEX_URL) {
    process.env.CONVEX_URL = process.env.VITE_CONVEX_URL;
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const nodeCmd = process.execPath;
  const vitePackageJson = requireFromScript.resolve("vite/package.json", { paths: [repoRoot] });
  const viteBin = path.join(path.dirname(vitePackageJson), "bin", "vite.js");
  const distDir = path.join(repoRoot, "dist");
  const screenshotDir = path.join(repoRoot, ".tmp", "dogfood-screenshots", "full-ui-dogfood");
  const staleScribeUserdataDir = path.join(repoRoot, "public", "dogfood", "scribe", "userdata");

  let serverProc;
  let syncBridgeProc;
  let apiHeadlessProc;
  let previewAssetProbePaths = [];
  const syncBridgeHost = "127.0.0.1";
  const syncBridgePort = 3100;
  const apiHeadlessHost = "127.0.0.1";
  const apiHeadlessPort = 8020;
  const apiHeadlessDir = path.join(repoRoot, "apps", "api-headless");

  if (!(await isPortOpen(syncBridgeHost, syncBridgePort))) {
    // eslint-disable-next-line no-console
    console.log(`Starting sync bridge server on ${syncBridgeHost}:${syncBridgePort} for local dogfood...`);
    const voiceCommand = existsSync(path.join(repoRoot, ".env.local"))
      ? `${npmCmd} run dev:voice`
      : `${npxCmd} tsx server/index.ts`;
    syncBridgeProc = spawn(voiceCommand, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
      shell: true,
    });
    syncBridgeProc.stdout.on("data", (buf) => process.stdout.write(String(buf)));
    syncBridgeProc.stderr.on("data", (buf) => process.stderr.write(String(buf)));
    await waitForPort(syncBridgeHost, syncBridgePort, 120_000);
  }

  if (!(await isPortOpen(apiHeadlessHost, apiHeadlessPort))) {
    const canStartApiHeadless = canResolvePackage("helmet", [apiHeadlessDir, repoRoot]);
    if (!canStartApiHeadless) {
      // eslint-disable-next-line no-console
      console.warn("Skipping api-headless local server: package-scoped dependencies are not installed in this worktree.");
    } else {
      // eslint-disable-next-line no-console
      console.log(`Starting api-headless server on ${apiHeadlessHost}:${apiHeadlessPort} for local dogfood...`);
      apiHeadlessProc = spawn(`${npmCmd} run dev`, {
        cwd: apiHeadlessDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, API_PORT: String(apiHeadlessPort) },
        windowsHide: true,
        shell: true,
      });
      apiHeadlessProc.stdout.on("data", (buf) => process.stdout.write(String(buf)));
      apiHeadlessProc.stderr.on("data", (buf) => process.stderr.write(String(buf)));
      await waitForPort(apiHeadlessHost, apiHeadlessPort, 120_000);
    }
  }

  let baseURL;

  if (serverMode === "dev") {
    const started = await startViteServerWithRetry({
      mode: "dev",
      host,
      initialPort,
      repoRoot,
      nodeCmd,
      viteBin,
      explicitBaseUrl,
    });
    serverProc = started.serverProc;
    baseURL = started.baseURL;
  } else {
    // Build + preview server (fast start, production-like behavior).
    await removePathRobustly(staleScribeUserdataDir);
    await removePathRobustly(distDir);
    let buildCode = 1;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      // eslint-disable-next-line no-console
      console.log(`Building: ${npmCmd} run build${attempt > 0 ? ` (retry ${attempt})` : ""}`);
      const build = spawn(`${npmCmd} run build`, {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env },
        shell: true,
      });
      buildCode = await new Promise((resolve) => build.on("exit", resolve));
      if (buildCode === 0) break;

      await removePathRobustly(distDir);
      await sleep(500);
    }

    if (buildCode !== 0) throw new Error(`Build exited with code ${buildCode}`);

    previewAssetProbePaths = getPreviewAssetProbePaths(distDir);

    const started = await startViteServerWithRetry({
      mode: "preview",
      host,
      initialPort,
      repoRoot,
      nodeCmd,
      viteBin,
      explicitBaseUrl,
    });
    serverProc = started.serverProc;
    baseURL = started.baseURL;
  }

  try {
    await waitForHttpReady(baseURL, 240_000, {
      assetPaths: serverMode === "preview" ? previewAssetProbePaths : [],
    });
    await waitForAppRoutesReady(baseURL, 120_000);
    if (screens) {
      // Route-by-route screenshot suite (writes test-results/full-ui-dogfood/*.png)
      // Use BASE_URL so Playwright points at the preview/dev server we just started.
      // eslint-disable-next-line no-console
      console.log(`Running dogfood e2e screenshots (BASE_URL=${baseURL}, routeShards=${routeShards})...`);
      await removePathRobustly(screenshotDir);
      const playwrightCommand = `${npxCmd} playwright test tests/e2e/full-ui-dogfood.spec.ts --project=chromium --workers=1`;
      const routeLaneRuns = [];
      for (let shardIndex = 1; shardIndex <= routeShards; shardIndex += 1) {
        routeLaneRuns.push(async () => {
          await runPlaywrightLaneWithRetry({
            label: `Dogfood route shard ${shardIndex}/${routeShards}`,
            command: playwrightCommand,
            cwd: repoRoot,
            env: {
              BASE_URL: baseURL,
              DOGFOOD_SCREENSHOT_DIR: screenshotDir,
              DOGFOOD_ROUTE_SHARD_INDEX: String(shardIndex),
              DOGFOOD_ROUTE_SHARD_TOTAL: String(routeShards),
              DOGFOOD_INCLUDE_INTERACTIONS: "false",
              DOGFOOD_INCLUDE_ROUTES: "true",
              PLAYWRIGHT_HTML_OUTPUT_FOLDER: "off",
              PLAYWRIGHT_JSON_OUTPUT_FILE: "off",
            },
            baseURL,
            assetPaths: serverMode === "preview" ? previewAssetProbePaths : [],
          });
        });
      }

      if (shardMode === "parallel") {
        await Promise.all(routeLaneRuns.map((run) => run()));
      } else {
        for (const run of routeLaneRuns) {
          await run();
        }
      }

      if (includeInteractionLane) {
        await runPlaywrightLaneWithRetry({
          label: "Dogfood interaction lane",
          command: playwrightCommand,
          cwd: repoRoot,
          env: {
            BASE_URL: baseURL,
            DOGFOOD_SCREENSHOT_DIR: screenshotDir,
            DOGFOOD_ROUTE_SHARD_INDEX: "1",
            DOGFOOD_ROUTE_SHARD_TOTAL: "1",
            DOGFOOD_INCLUDE_INTERACTIONS: "true",
            DOGFOOD_INCLUDE_ROUTES: "false",
            PLAYWRIGHT_HTML_OUTPUT_FOLDER: "off",
            PLAYWRIGHT_JSON_OUTPUT_FILE: "off",
          },
          baseURL,
          assetPaths: serverMode === "preview" ? previewAssetProbePaths : [],
        });
      }

      if (publish) {
        // Publish screenshots to /public so /dogfood can render them.
        // eslint-disable-next-line no-console
        console.log("Publishing screenshot manifest to public/dogfood...");
        const pubCode = await runShellCommand(`${npmCmd} run dogfood:publish`, {
          cwd: repoRoot,
          env: { DOGFOOD_SCREENSHOT_DIR: screenshotDir },
        });
        if (pubCode !== 0) throw new Error(`dogfood:publish exited with code ${pubCode}`);
      }
    }

    await waitForHttpReady(baseURL, 60_000, {
      assetPaths: serverMode === "preview" ? previewAssetProbePaths : [],
    });
    await waitForAppRoutesReady(baseURL, 60_000);

    // Capture Scribe artifact (writes public/dogfood/scribe.*)
    await runNodeScriptWithRetry({
      label: "Dogfood scribe capture",
      command: `node "${path.join("scripts", "ui", "captureDogfoodScribe.mjs")}" --baseURL "${baseURL}" --headless "${headless}"`,
      cwd: repoRoot,
      baseURL,
      assetPaths: serverMode === "preview" ? previewAssetProbePaths : [],
      retries: 1,
    });

    if (!scribeOnly) {
      await waitForHttpReady(baseURL, 60_000, {
        assetPaths: serverMode === "preview" ? previewAssetProbePaths : [],
      });
      await waitForAppRoutesReady(baseURL, 60_000);

      // Record walkthrough (writes public/dogfood/walkthrough.json + video file)
      await runNodeScriptWithRetry({
        label: "Dogfood walkthrough recorder",
        command: `node "${path.join("scripts", "ui", "recordDogfoodWalkthrough.mjs")}" --publish static --baseURL "${baseURL}" --headless "${headless}"`,
        cwd: repoRoot,
        baseURL,
        assetPaths: serverMode === "preview" ? previewAssetProbePaths : [],
        retries: 1,
      });

      // Extract key frames for visual QA (writes public/dogfood/frames.json + frames/*)
      const frames = spawn(`${npmCmd} run dogfood:frames`, {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env },
        shell: true,
      });
      const framesCode = await new Promise((resolve) => frames.on("exit", resolve));
      if (framesCode !== 0) throw new Error(`dogfood:frames exited with code ${framesCode}`);
    }

    if (serverMode !== "dev") {
      const synced = await syncDogfoodArtifactsToDist(repoRoot, distDir);
      if (synced) {
        // eslint-disable-next-line no-console
        console.log("Synced public/dogfood artifacts into dist/dogfood for preview-mode verification.");
      }
    }

    if (scenarios) {
      // Scenario regression suite: validates motion-safety + dogfood artifact ingestion in the UI.
      // eslint-disable-next-line no-console
      console.log(`Running scenario regression suite (BASE_URL=${baseURL})...`);
      const scen = spawn(
        `${npxCmd} playwright test tests/e2e/scenario-regression.spec.ts --project=chromium --workers=1`,
        {
          cwd: repoRoot,
          stdio: "inherit",
          env: {
            ...process.env,
            BASE_URL: baseURL,
            PLAYWRIGHT_HTML_OUTPUT_FOLDER: "off",
            PLAYWRIGHT_JSON_OUTPUT_FILE: "off",
          },
          shell: true,
        },
      );
      const scenCode = await new Promise((resolve) => scen.on("exit", resolve));
      if (scenCode !== 0) throw new Error(`Scenario regression suite exited with code ${scenCode}`);
    }
  } finally {
    await killProcessTree(serverProc);
    await killProcessTree(syncBridgeProc);
    await killProcessTree(apiHeadlessProc);
  }

  // eslint-disable-next-line no-console
  console.log("\nDogfood artifacts recorded. Open:");
  // eslint-disable-next-line no-console
  console.log("  public/dogfood/scribe.md");
  if (!scribeOnly) {
    // eslint-disable-next-line no-console
    console.log("  public/dogfood/walkthrough.mp4");
    // eslint-disable-next-line no-console
    console.log("  (or public/dogfood/walkthrough.webm if mp4 transcoding was unavailable)");
  }
  if (screens) {
    // eslint-disable-next-line no-console
    console.log("  public/dogfood/manifest.json");
  }

  if (play && !scribeOnly) {
    const candidate = path.resolve(repoRoot, "public", "dogfood", "walkthrough.mp4");
    const fallback = path.resolve(repoRoot, "public", "dogfood", "walkthrough.webm");
    const fileToOpen = existsSync(candidate) ? candidate : fallback;
    if (!existsSync(fileToOpen)) return;
    const opener =
      process.platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", fileToOpen] }
        : process.platform === "darwin"
          ? { cmd: "open", args: [fileToOpen] }
          : { cmd: "xdg-open", args: [fileToOpen] };

    const p = spawn(opener.cmd, opener.args, { stdio: "ignore", detached: true, shell: false });
    p.unref();
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
