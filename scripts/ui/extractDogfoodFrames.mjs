import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

let ffmpegPath = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const mod = await import("ffmpeg-static");
  ffmpegPath = mod.default ?? mod;
} catch {
  ffmpegPath = null;
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

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}

async function writeFileWithRetries(filePath, contents, encoding = "utf8", attempts = 6) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await writeFile(filePath, contents, encoding);
      return;
    } catch (error) {
      lastError = error;
      const code = String(error?.code ?? "");
      if (!["UNKNOWN", "EBUSY", "EPERM", "EACCES"].includes(code) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  await rm(path.resolve(repoRoot, "public", "dogfood", "frames.json"), { force: true });

  const walkthroughPath = path.resolve(repoRoot, "public", "dogfood", "walkthrough.json");
  if (!existsSync(walkthroughPath)) {
    throw new Error('Missing public/dogfood/walkthrough.json. Run "npm run dogfood:record:static" first.');
  }

  const walk = JSON.parse(await readFile(walkthroughPath, "utf8"));

  if (!["/dogfood/walkthrough.mp4", "/dogfood/walkthrough.webm"].includes(walk.videoPath)) throw new Error("Walkthrough manifest must reference its actual local static video");
  const input = path.resolve(repoRoot, "public", walk.videoPath.slice(1));
  if (!existsSync(input)) throw new Error(`Missing manifest video: ${input}`);

  const outDir = path.resolve(repoRoot, "public", "dogfood", "frames");
  await mkdir(outDir, { recursive: true });

  const ffmpeg = args.get("ffmpeg") ?? ffmpegPath ?? "ffmpeg";
  const quality = String(args.get("quality") ?? "3");
  const format = String(args.get("format") ?? "jpg").toLowerCase();

  const chapters = Array.isArray(walk?.chapters) ? walk.chapters : [];
  const maxFrames = Math.min(Number(args.get("max") ?? chapters.length), chapters.length);
  const selected = chapters.slice(0, maxFrames);

  const items = [];
  let idx = 0;
  for (const c of selected) {
    const sampleSec = c?.sampleSec;
    if (!Number.isFinite(sampleSec) || sampleSec < 0 || !Number.isFinite(c?.actionStartSec) || sampleSec < c.actionStartSec) {
      throw new Error(`Chapter ${idx + 1} is missing a valid settled sampleSec; navigation start is not a frame sample`);
    }
    const name = String(c?.name ?? `chapter-${idx + 1}`);
    const outFile = `${String(idx + 1).padStart(2, "0")}-${slugify(name)}.${format}`;
    const outPath = path.join(outDir, outFile);

    // Seek the state observed after readiness and settling. No inferred offset.
    await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        `${sampleSec}`,
        "-i",
        input,
        "-frames:v",
        "1",
        "-q:v",
        quality,
        "-vf",
        "scale=1280:-2",
        "-y",
        outPath,
      ],
      { cwd: repoRoot, shell: false },
    );

    items.push({
      index: idx + 1,
      name,
      path: c?.path ?? "",
      startSec: c.startSec,
      sampleSec,
      actionStartSec: c.actionStartSec,
      status: c.status,
      ...(c.cause ? { cause: c.cause } : {}),
      theme: c.theme,
      observedUrl: c.observedUrl,
      observedState: c.observedState,
      file: outFile,
      image: `/dogfood/frames/${encodeURIComponent(outFile)}`,
    });
    idx++;
  }

  const manifest = {
    capturedAtIso: walk.capturedAtIso,
    captureScope: walk.captureScope,
    videoPath: walk.videoPath,
    items,
  };

  const outManifest = path.resolve(repoRoot, "public", "dogfood", "frames.json");
  await writeFileWithRetries(outManifest, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // eslint-disable-next-line no-console
  console.log(`Extracted ${items.length} frames to public/dogfood/frames (manifest: public/dogfood/frames.json)`);
}

await main();
