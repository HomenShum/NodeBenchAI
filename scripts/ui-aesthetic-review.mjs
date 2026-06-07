#!/usr/bin/env node
/**
 * ScratchNode aesthetic review wrapper.
 *
 * Provides the stable entrypoint referenced by automation runbooks while
 * delegating capture and scoring to the existing ScratchNode video recorder
 * and Gemini judge scripts. Recording is read-only: it navigates, scrolls,
 * and expands visible trace UI without sending chat, publishing data, or
 * mutating the live event.
 *
 * Usage:
 *   node scripts/ui-aesthetic-review.mjs [--url <public-room-url>] [--surface mobile|desktop|both]
 *   node scripts/ui-aesthetic-review.mjs --video <path.webm> [--surface mobile|desktop]
 *   node scripts/ui-aesthetic-review.mjs --judge skip
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const DEFAULT_URL = "https://scratchnode.live/e/ai-infra-summit-2026";
const DEFAULT_OUT = ".tmp/scratchnode-aesthetic-review";
const RECORDER = "scripts/ui/recordScratchnodeChatDemo.mjs";
const JUDGE = "scripts/ui/judgeScratchnodeChatVideo.mjs";

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const [key, inlineValue] = raw.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args.set(key, argv[++i]);
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

function usage() {
  return `ScratchNode aesthetic review

Options:
  --url <url>          Public ScratchNode room URL to record. Default: ${DEFAULT_URL}
  --out <dir>          Output directory. Default: ${DEFAULT_OUT}
  --surface <name>     mobile, desktop, or both. Default: mobile
  --video <path>       Judge an existing .webm instead of recording.
  --judge <mode>       require, auto, or skip. Default: require
  --model <name>       Gemini model passed to the judge. Default: gemini-2.5-flash
  --report <path>      JSON summary path. Default: <out>/aesthetic-review-summary.json
  --help               Show this help.
`;
}

function resolveRepoPath(p) {
  return path.resolve(ROOT, p);
}

function assertScriptExists(relativePath) {
  const abs = resolveRepoPath(relativePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing required script: ${relativePath}`);
  }
  return abs;
}

function hasGeminiKey() {
  if (process.env.GEMINI_API_KEY) return true;
  const envPath = resolveRepoPath(".env.local");
  if (!fs.existsSync(envPath)) return false;
  const text = fs.readFileSync(envPath, "utf8");
  return /^GEMINI_API_KEY=.+$/m.test(text);
}

function runNode(relativePath, args, label) {
  const script = assertScriptExists(relativePath);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const error = new Error(`${label} failed with exit code ${result.status}`);
    error.exitCode = result.status;
    error.stdout = result.stdout ?? "";
    error.stderr = result.stderr ?? "";
    error.label = label;
    throw error;
  }
  return result.stdout ?? "";
}

function parseJsonObject(output, label) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`${label} did not print a JSON object`);
  }
  return JSON.parse(output.slice(start, end + 1));
}

function normalizeSurface(value) {
  const surface = String(value || "mobile").toLowerCase();
  if (!["mobile", "desktop", "both"].includes(surface)) {
    throw new Error(`Invalid --surface "${value}". Expected mobile, desktop, or both.`);
  }
  return surface;
}

function normalizeJudgeMode(value) {
  const mode = String(value || "require").toLowerCase();
  if (!["require", "auto", "skip"].includes(mode)) {
    throw new Error(`Invalid --judge "${value}". Expected require, auto, or skip.`);
  }
  return mode;
}

function videoCandidates({ videoArg, recordJson, surface }) {
  if (videoArg) {
    const abs = path.resolve(ROOT, videoArg);
    if (!fs.existsSync(abs)) {
      throw new Error(`--video path does not exist: ${abs}`);
    }
    const inferredSurface = surface === "both" ? "mobile" : surface;
    return [{ surface: inferredSurface, path: abs }];
  }

  const results = recordJson?.results ?? {};
  const wanted = surface === "both" ? ["desktop", "mobile"] : [surface];
  return wanted.map((name) => {
    const videoPath = results[name]?.path;
    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error(`Recorder did not produce ${name} video at ${videoPath || "(missing path)"}`);
    }
    return { surface: name, path: path.resolve(ROOT, videoPath) };
  });
}

function passJudge(judgeJson) {
  const readiness = Number(judgeJson.readiness_score ?? 0);
  const verdict = String(judgeJson.verdict ?? "");
  return readiness >= 70 && verdict !== "needs_work";
}

function writeSummary(summary, reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return reportPath;
}

export function classifyAestheticReviewFailure(error) {
  const text = [
    error?.message,
    error?.stderr,
    error?.stdout,
  ]
    .filter(Boolean)
    .join("\n");

  if (/ERR_NETWORK_ACCESS_DENIED/i.test(text)) {
    return {
      code: "network_access_denied",
      stage: "record",
      detail: "Sandbox denied outbound navigation while loading the public ScratchNode room.",
    };
  }

  if (/GEMINI_API_KEY/i.test(text)) {
    return {
      code: "missing_gemini_key",
      stage: "judge-config",
      detail: "Gemini judging was required, but no GEMINI_API_KEY was available.",
    };
  }

  if (/Recorder did not produce .* video/i.test(text)) {
    return {
      code: "missing_video_output",
      stage: "record",
      detail: "The recorder completed without producing the expected video artifact.",
    };
  }

  if (/judge failed with exit code/i.test(text)) {
    return {
      code: "judge_failed",
      stage: "judge",
      detail: "The Gemini judge process failed before returning a JSON verdict.",
    };
  }

  if (/recorder failed with exit code/i.test(text)) {
    return {
      code: "record_failed",
      stage: "record",
      detail: "The capture step failed before producing a recordable video artifact.",
    };
  }

  return {
    code: "unexpected_failure",
    stage: "wrapper",
    detail: error?.message ?? String(error),
  };
}

export function buildFailureSummary(baseSummary, error) {
  const failure = classifyAestheticReviewFailure(error);
  return {
    ...baseSummary,
    passed: false,
    videos: Array.isArray(baseSummary?.videos) ? baseSummary.videos : [],
    record: baseSummary?.record ?? null,
    judges: Array.isArray(baseSummary?.judges) ? baseSummary.judges : [],
    failure: {
      ...failure,
      label: error?.label ?? null,
      exitCode: Number.isFinite(error?.exitCode) ? error.exitCode : null,
      message: error?.message ?? String(error),
    },
    stderr: error?.stderr || null,
    stdout: error?.stdout || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("help")) {
    console.log(usage());
    return;
  }

  const surface = normalizeSurface(args.get("surface"));
  const judgeMode = normalizeJudgeMode(args.get("judge"));
  const model = args.get("model") || "gemini-2.5-flash";
  const videoArg = args.get("video") || "";
  const outDir = path.resolve(ROOT, args.get("out") || DEFAULT_OUT);
  const reportPath = path.resolve(ROOT, args.get("report") || path.join(outDir, "aesthetic-review-summary.json"));
  const url = args.get("url") || DEFAULT_URL;
  const summary = {
    passed: true,
    url: videoArg ? null : url,
    outDir,
    reportPath,
    surface,
    judgeMode,
    model: judgeMode === "skip" ? null : model,
    videos: [],
    record: null,
    judges: [],
  };

  try {
    assertScriptExists(RECORDER);
    assertScriptExists(JUDGE);

    if (judgeMode === "require" && !hasGeminiKey()) {
      throw new Error("GEMINI_API_KEY not found in env or .env.local; use --judge skip for capture-only smoke.");
    }

    let recordJson = null;
    if (!videoArg) {
      fs.mkdirSync(outDir, { recursive: true });
      const recordOut = runNode(RECORDER, ["--url", url, "--out", outDir], "ScratchNode recorder");
      recordJson = parseJsonObject(recordOut, "ScratchNode recorder");
      summary.record = recordJson;
    }

    const videos = videoCandidates({ videoArg, recordJson, surface });
    summary.videos = videos;

    const shouldJudge = judgeMode === "require" || (judgeMode === "auto" && hasGeminiKey());
    if (!shouldJudge) {
      summary.judgeSkipped = judgeMode === "skip" ? "requested" : "GEMINI_API_KEY not available";
      writeSummary(summary, reportPath);
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    for (const video of videos) {
      const judgeOut = runNode(
        JUDGE,
        ["--video", video.path, "--surface", video.surface, "--model", model],
        `ScratchNode ${video.surface} judge`,
      );
      const judgeJson = parseJsonObject(judgeOut, `ScratchNode ${video.surface} judge`);
      const passed = passJudge(judgeJson);
      summary.judges.push({ surface: video.surface, passed, ...judgeJson });
      if (!passed) summary.passed = false;
    }

    writeSummary(summary, reportPath);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.passed) process.exit(2);
  } catch (error) {
    const failureSummary = buildFailureSummary(summary, error);
    writeSummary(failureSummary, reportPath);
    console.log(JSON.stringify(failureSummary, null, 2));
    throw error;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(`AESTHETIC_REVIEW_FAILED: ${error?.message ?? error}`);
    process.exit(1);
  });
}
