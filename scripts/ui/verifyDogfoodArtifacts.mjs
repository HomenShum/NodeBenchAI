import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

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

async function assertFileExists(filePath, { minBytes = 1 } = {}) {
  const st = await fs.stat(filePath).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`Missing file: ${filePath}`);
  if (st.size < minBytes) throw new Error(`File too small (${st.size}B < ${minBytes}B): ${filePath}`);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function stripLeadingSlash(p) {
  return typeof p === "string" ? p.replace(/^\/+/, "") : "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requireGemini = (args.get("requireGemini") ?? "false") === "true";
  const requireGeneration = (args.get("requireGeneration") ?? "false") === "true";

  const repoRoot = process.cwd();
  const dogfoodDir = path.join(repoRoot, "public", "dogfood");

  const manifestPath = path.join(dogfoodDir, "manifest.json");
  const framesPath = path.join(dogfoodDir, "frames.json");
  const scribePath = path.join(dogfoodDir, "scribe.json");
  const walkthroughPath = path.join(dogfoodDir, "walkthrough.json");

  await assertFileExists(manifestPath, { minBytes: 50 });
  await assertFileExists(framesPath, { minBytes: 50 });
  await assertFileExists(scribePath, { minBytes: 50 });
  await assertFileExists(walkthroughPath, { minBytes: 50 });

  const manifest = await readJson(manifestPath);
  const frames = await readJson(framesPath);
  const scribe = await readJson(scribePath);
  const walkthrough = await readJson(walkthroughPath);

  const minimums = {
    screenshots: 3,
    frames: 8,
    scribeSteps: 8,
    chapters: 8,
  };

  if (!Array.isArray(manifest.items) || manifest.items.length < minimums.screenshots) {
    throw new Error(`manifest.json has insufficient items: ${manifest.items?.length ?? 0}`);
  }
  if (!Array.isArray(frames.items) || frames.items.length < minimums.frames) {
    throw new Error(`frames.json has insufficient items: ${frames.items?.length ?? 0}`);
  }
  if (!Array.isArray(scribe.steps) || scribe.steps.length < minimums.scribeSteps) {
    throw new Error(`scribe.json has insufficient steps: ${scribe.steps?.length ?? 0}`);
  }
  if (!Array.isArray(walkthrough.chapters) || walkthrough.chapters.length < minimums.chapters) {
    throw new Error(`walkthrough.json has insufficient chapters: ${walkthrough.chapters?.length ?? 0}`);
  }

  const screenshotsDir = path.join(dogfoodDir, "screenshots");
  for (const it of manifest.items) {
    const file = it?.file;
    if (!file) continue;
    await assertFileExists(path.join(screenshotsDir, file), { minBytes: 2_000 });
  }

  const framesDir = path.join(dogfoodDir, "frames");
  for (const it of frames.items) {
    const file = it?.file;
    if (!file) continue;
    await assertFileExists(path.join(framesDir, file), { minBytes: 2_000 });
  }

  const scribeDir = path.join(dogfoodDir, "scribe");
  for (const step of scribe.steps) {
    const image = stripLeadingSlash(step?.image);
    if (!image) continue;
    if (!image.startsWith("dogfood/scribe/")) continue;
    await assertFileExists(path.join(repoRoot, "public", image), { minBytes: 2_000 });
  }

  const videoRel = stripLeadingSlash(walkthrough.videoPath ?? frames.videoPath ?? "");
  const mp4 = path.join(dogfoodDir, "walkthrough.mp4");
  const webm = path.join(dogfoodDir, "walkthrough.webm");
  if (videoRel) {
    await assertFileExists(path.join(repoRoot, "public", videoRel), { minBytes: 50_000 });
  } else if (existsSync(mp4)) {
    await assertFileExists(mp4, { minBytes: 50_000 });
  } else if (existsSync(webm)) {
    await assertFileExists(webm, { minBytes: 50_000 });
  } else {
    throw new Error("No walkthrough video found in public/dogfood (expected walkthrough.mp4 or walkthrough.webm)");
  }

  if (requireGemini) {
    const outDir = path.join(repoRoot, ".tmp", "dogfood-gemini-qa");
    const videoQaPath = path.join(outDir, "video-qa.json");
    const screensQaPath = path.join(outDir, "screens-qa.json");
    await assertFileExists(videoQaPath, { minBytes: 5 });
    await assertFileExists(screensQaPath, { minBytes: 5 });
    const videoQa = await readJson(videoQaPath);
    const screensQa = await readJson(screensQaPath);

    if (!Array.isArray(videoQa) || videoQa.length < 1) throw new Error("Gemini video QA output is empty.");
    if (!Array.isArray(screensQa) || screensQa.length < 1) throw new Error("Gemini screenshot QA output is empty.");

    const summary = videoQa[0]?.summary ?? "";
    if (typeof summary !== "string" || summary.trim().length < 10) {
      throw new Error("Gemini video QA summary missing/too short.");
    }
  }

  if (requireGeneration) {
    const generationsDir = path.join(dogfoodDir, "generations");
    const indexPath = path.join(generationsDir, "index.json");
    const ledgerPath = path.join(dogfoodDir, "qa-generation-ledger.json");
    await assertFileExists(indexPath, { minBytes: 50 });
    await assertFileExists(ledgerPath, { minBytes: 50 });

    const index = await readJson(indexPath);
    const ledger = await readJson(ledgerPath);
    if (!Array.isArray(index.runs) || index.runs.length < 1) {
      throw new Error("Generation archive index has no runs.");
    }
    const latest = index.runs[0];
    if (!latest?.archivePath) {
      throw new Error("Latest generation archive is missing archivePath.");
    }
    const archiveDir = path.join(repoRoot, latest.archivePath);
    await assertFileExists(path.join(archiveDir, "summary.json"), { minBytes: 50 });
    await assertFileExists(path.join(archiveDir, "summary.md"), { minBytes: 50 });

    const summary = await readJson(path.join(archiveDir, "summary.json"));
    const evidence = summary?.evidence ?? {};
    const stateEvidence = evidence.stateEvidence ?? {};
    const copiedScreenshots = Array.isArray(evidence.screenshots) ? evidence.screenshots.filter((copy) => copy.copied).length : 0;
    const copiedFrames = Array.isArray(evidence.frames) ? evidence.frames.filter((copy) => copy.copied).length : 0;
    const copiedVideos = Array.isArray(evidence.videos) ? evidence.videos.filter((copy) => copy.copied).length : 0;
    const copiedGemini = Array.isArray(evidence.gemini) ? evidence.gemini.filter((copy) => copy.copied).length : 0;
    if (copiedScreenshots < minimums.screenshots) {
      throw new Error(`Generation archive has insufficient screenshots: ${copiedScreenshots}`);
    }
    if (copiedFrames < minimums.frames) {
      throw new Error(`Generation archive has insufficient frames: ${copiedFrames}`);
    }
    if (copiedVideos < 1) {
      throw new Error("Generation archive has no retained walkthrough video.");
    }
    if (requireGemini && copiedGemini < 2) {
      throw new Error(`Generation archive has insufficient Gemini artifacts: ${copiedGemini}`);
    }
    for (const state of ["before", "during", "after"]) {
      const count = Number(stateEvidence?.[state]?.count ?? 0);
      if (!Number.isFinite(count) || count < 1) {
        throw new Error(`Generation archive is missing ${state} state evidence.`);
      }
    }
    if (ledger?.generationArchive?.runId && ledger.generationArchive.runId !== latest.runId) {
      throw new Error("Generation ledger and archive index disagree on the latest run id.");
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `OK: dogfood artifacts valid (screenshots=${manifest.items.length}, frames=${frames.items.length}, scribe=${scribe.steps.length}, chapters=${walkthrough.chapters.length})`,
  );
}

await main();
