import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { PUBLIC_DOGFOOD_STEPS, observePublicStep, setDogfoodLocalStorage, waitForAppReady } from "./captureDogfoodScribe.mjs";

const execFileAsync = promisify(execFile);

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

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

function msToSec(ms) {
  return Math.round(ms) / 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
          const fs = await import("node:fs/promises");
          await fs.rename(targetPath, quarantinePath);
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

async function maybeTranscodeToMp4(inputPath, outputPath) {
  let ffmpegPath;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const mod = await import("ffmpeg-static");
    ffmpegPath = mod.default || mod;
  } catch {
    return { ok: false, reason: "ffmpeg-static not installed" };
  }
  if (!ffmpegPath) return { ok: false, reason: "ffmpeg binary missing" };

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  return { ok: true };
}

async function uploadToVercelBlob(filePath, options) {
  const token = options.token;
  if (!token) throw new Error("Missing BLOB_READ_WRITE_TOKEN/DOGFOOD_BLOB_TOKEN");

  // eslint-disable-next-line import/no-extraneous-dependencies
  const { put } = await import("@vercel/blob");
  const fs = await import("node:fs");

  const blob = await put(options.name, fs.createReadStream(filePath), {
    access: "public",
    token,
    addRandomSuffix: true,
    contentType: "video/mp4",
  });

  return blob.url;
}

async function installOverlay(page) {
  await page.addStyleTag({
    content: `
      #__nodebench_dogfood_overlay {
        position: fixed;
        top: 12px;
        left: 12px;
        z-index: 2147483647;
        background: rgba(0,0,0,0.62);
        border: 1px solid rgba(255,255,255,0.18);
        color: rgba(255,255,255,0.92);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial;
        font-size: 12px;
        padding: 8px 10px;
        border-radius: 10px;
        backdrop-filter: blur(10px);
        max-width: 52ch;
        box-shadow: 0 16px 60px rgba(0,0,0,0.35);
      }
      #__nodebench_dogfood_overlay strong { font-weight: 650; color: white; }
      #__nodebench_dogfood_overlay .sub { opacity: 0.9; margin-top: 2px; }
      @media (prefers-reduced-motion: reduce) {
        #__nodebench_dogfood_overlay { transition: none !important; }
      }
    `,
  });

  await page.evaluate(() => {
    document.getElementById("__nodebench_dogfood_overlay")?.remove();
    const el = document.createElement("div");
    el.id = "__nodebench_dogfood_overlay";
    el.innerHTML = `<strong>Dogfood Walkthrough</strong><div class="sub">Initializing...</div>`;
    document.documentElement.appendChild(el);
  });
}

async function setOverlay(page, title, sub) {
  await page.evaluate(
    ({ title, sub }) => {
      const el = document.getElementById("__nodebench_dogfood_overlay");
      if (!el) return;
      el.innerHTML = `<strong>${title}</strong><div class="sub">${sub}</div>`;
    },
    { title, sub },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseURL = args.get("baseURL") ?? "http://127.0.0.1:5173";
  const outDir = args.get("outDir") ?? path.resolve(process.cwd(), ".tmp", "dogfood-video");
  const publish = args.get("publish") ?? "blob"; // blob | static | none
  const showOverlay = (args.get("overlay") ?? "0") === "1";
  const settleMs = Number(args.get("settleMs") ?? 2000);
  const headless = (args.get("headless") ?? "true") !== "false";
  const manifestOut = path.resolve(process.cwd(), "public", "dogfood", "walkthrough.json");
  await rm(manifestOut, { force: true });

  const stamp = nowStamp();
  await mkdir(outDir, { recursive: true });
  const userDataDir = path.join(outDir, `userdata-${stamp}`);
  await removePathRobustly(userDataDir);
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1440, height: 900 },
    baseURL,
    colorScheme: "dark",
    // Let recorded states settle without transition frames.
    reducedMotion: "reduce",
    recordVideo: {
      dir: outDir,
      size: { width: 1440, height: 900 },
    },
  });

  // Playwright creates its recorder during page initialization. Starting the
  // chapter clock after navigation made extracted frames show earlier states.
  const startedAt = Date.now();
  const page = await context.newPage();
  const chapters = [];
  let video;
  try {
    await setDogfoodLocalStorage(page);
    // Initial load via full navigation — establishes the SPA shell, auth, localStorage
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await page.waitForTimeout(700);

    for (const [idx, step] of PUBLIC_DOGFOOD_STEPS.entries()) {
      const actionStartSec = msToSec(Date.now() - startedAt);
      const observation = await observePublicStep(page, step);
      if (showOverlay) {
        await installOverlay(page);
        await setOverlay(page, `${step.name}: ${observation.status}`, step.description);
      }
      // Readiness is checked before this settling hold. sampleSec is the observed
      // state, not the action start or an arbitrary seek offset added downstream.
      await page.waitForTimeout(settleMs);
      const sampleSec = msToSec(Date.now() - startedAt);
      chapters.push({
        index: idx + 1,
        name: step.name,
        path: step.path ?? "(interaction)",
        description: step.description,
        actionStartSec,
        startSec: sampleSec, // Existing chapter links also seek the settled state.
        sampleSec,
        ...observation,
      });
      await page.waitForTimeout(settleMs);
    }

    const doneMs = Date.now() - startedAt;
    chapters.push({
      index: chapters.length + 1,
      name: "End",
      path: "(end)",
      startSec: msToSec(doneMs),
      actionStartSec: msToSec(doneMs),
      sampleSec: msToSec(doneMs),
      status: "CAPTURED",
      theme: await page.locator("[data-redesign-theme]").getAttribute("data-redesign-theme"),
      observedUrl: page.url(),
      observedState: "Guest capture ended; live research and saved-report reopening remain NOT_RUN",
      description: "Guest capture ended. Live research and saved-report reopening were not performed.",
    });
    if (showOverlay) await setOverlay(page, "Guest capture ended", "Live research and saved-report reopening: NOT_RUN");
    await page.waitForTimeout(700);

    video = page.video();
  } finally {
    await context.close();
    await removePathRobustly(userDataDir);
  }

  if (!video) throw new Error("Video capture not enabled (Playwright recordVideo missing)");
  const webmPath = await video.path();
  const mp4Path = path.join(outDir, `dogfood-walkthrough_${stamp}.mp4`);

  let finalPath = webmPath;
  let mime = "video/webm";

  const transcoded = await maybeTranscodeToMp4(webmPath, mp4Path);
  if (transcoded.ok) {
    finalPath = mp4Path;
    mime = "video/mp4";
  }

  const walkthroughManifest = {
    capturedAtIso: new Date(startedAt).toISOString(),
    baseURL,
    captureScope: "public-guest-read-only",
    mime,
    publish,
    chapters,
    videoUrl: null,
    videoPath: null,
    _localVideoPath: finalPath,
  };

  if (publish === "static") {
    const pubDir = path.resolve(process.cwd(), "public", "dogfood");
    await mkdir(pubDir, { recursive: true });
    const outName = transcoded.ok ? "walkthrough.mp4" : "walkthrough.webm";
    const outPath = path.join(pubDir, outName);
    const fs = await import("node:fs/promises");
    await fs.copyFile(finalPath, outPath);
    walkthroughManifest.videoPath = `/dogfood/${outName}`;
  } else if (publish === "blob") {
    const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.DOGFOOD_BLOB_TOKEN || "";
    const prefix = process.env.DOGFOOD_BLOB_PREFIX || "dogfood";
    const name = `${prefix}/walkthrough_${stamp}.mp4`;
    if (mime !== "video/mp4") {
      throw new Error(
        "Blob publish requires mp4 (install ffmpeg-static). Re-run after: npm i -D ffmpeg-static",
      );
    }
    const url = await uploadToVercelBlob(finalPath, { token, name });
    walkthroughManifest.videoUrl = url;
  }

  await mkdir(path.dirname(manifestOut), { recursive: true });
  await writeFile(manifestOut, JSON.stringify(walkthroughManifest, null, 2) + "\n", "utf8");

  // eslint-disable-next-line no-console
  console.log(
    `Recorded walkthrough (${mime}) and wrote manifest: public/dogfood/walkthrough.json\n` +
      `Local: ${finalPath}` +
      (walkthroughManifest.videoUrl ? `\nBlob: ${walkthroughManifest.videoUrl}` : ""),
  );
}

await main();
