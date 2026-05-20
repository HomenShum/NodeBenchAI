import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const QA_HISTORY_PATH = path.join(ROOT, "public", "dogfood", "qa-results.json");
const LEDGER_JSON_PATH = path.join(ROOT, "public", "dogfood", "qa-generation-ledger.json");
const LEDGER_MD_PATH = path.join(ROOT, "public", "dogfood", "qa-generation-ledger.md");
const GENERATIONS_DIR = path.join(ROOT, "public", "dogfood", "generations");
const GENERATION_INDEX_JSON_PATH = path.join(GENERATIONS_DIR, "index.json");
const GENERATION_INDEX_MD_PATH = path.join(GENERATIONS_DIR, "index.md");
const LARGE_VIDEO_COPY_LIMIT_BYTES = 25 * 1024 * 1024;

const OPTIONAL_ARTIFACTS = [
  "public/dogfood/manifest.json",
  "public/dogfood/walkthrough.json",
  "public/dogfood/walkthrough.mp4",
  "public/dogfood/frames.json",
  "public/dogfood/scribe.json",
  ".tmp/dogfood-gemini-qa/video-qa.json",
  ".tmp/dogfood-gemini-qa/screens-qa.json",
  ".tmp/dogfood-gemini-qa/agentic-results.json",
  ".tmp/dogfood-gemini-qa/qa-loop-context.json",
  ".tmp/dogfood-gemini-qa/agentic-session.webm",
];

const GEMINI_ARTIFACTS = [
  ".tmp/dogfood-gemini-qa/video-qa.json",
  ".tmp/dogfood-gemini-qa/screens-qa.json",
  ".tmp/dogfood-gemini-qa/agentic-results.json",
  ".tmp/dogfood-gemini-qa/qa-loop-context.json",
  ".tmp/dogfood-gemini-qa/rubric-scorecard.json",
  ".tmp/dogfood-gemini-qa/static-analysis.json",
  ".tmp/dogfood-gemini-qa/design-opportunities.json",
  ".tmp/dogfood-gemini-qa/design-screens.json",
  ".tmp/dogfood-gemini-qa/discovered-routes.json",
  ".tmp/dogfood-gemini-qa/discovered-routes.diff.json",
  ".tmp/dogfood-gemini-qa/video-qa.png",
  ".tmp/dogfood-gemini-qa/screens-qa.png",
];

function runGit(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeEntry(entry, indexFromLatest, total) {
  return {
    generation: total - indexFromLatest,
    indexFromLatest,
    timestamp: entry?.timestamp ?? null,
    runType: entry?.runType ?? null,
    model: entry?.model ?? null,
    requestedModel: entry?.requestedModel ?? null,
    selectedModel: entry?.selectedModel ?? entry?.modelResolution?.selectedModel ?? entry?.model ?? null,
    score: toNumber(entry?.score),
    grade: entry?.grade ?? null,
    realIssueCount: toNumber(entry?.realIssueCount),
    critical: toNumber(entry?.critical),
    warning: toNumber(entry?.warning),
    info: toNumber(entry?.info),
    staticScore: toNumber(entry?.rubric?.layer0?.score),
  };
}

function compareEntries(latest, baseline, label) {
  return {
    label,
    baselineGeneration: baseline.generation,
    baselineTimestamp: baseline.timestamp,
    latestGeneration: latest.generation,
    latestTimestamp: latest.timestamp,
    scoreDelta: (latest.score ?? 0) - (baseline.score ?? 0),
    realIssueDelta: (latest.realIssueCount ?? 0) - (baseline.realIssueCount ?? 0),
    criticalDelta: (latest.critical ?? 0) - (baseline.critical ?? 0),
    warningDelta: (latest.warning ?? 0) - (baseline.warning ?? 0),
    infoDelta: (latest.info ?? 0) - (baseline.info ?? 0),
    baseline: {
      score: baseline.score,
      grade: baseline.grade,
      realIssueCount: baseline.realIssueCount,
      critical: baseline.critical,
      warning: baseline.warning,
      info: baseline.info,
    },
    latest: {
      score: latest.score,
      grade: latest.grade,
      realIssueCount: latest.realIssueCount,
      critical: latest.critical,
      warning: latest.warning,
      info: latest.info,
    },
  };
}

function artifactInfo(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    return { path: relativePath, exists: false };
  }
  const stat = statSync(absolutePath);
  return {
    path: relativePath,
    exists: true,
    bytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function timestampSlug(value) {
  const date = value ? new Date(value) : new Date();
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyFileIfExists(relativePath, targetDir, { maxBytes = Infinity, targetName } = {}) {
  const source = path.join(ROOT, relativePath);
  if (!existsSync(source)) {
    return { source: relativePath, copied: false, reason: "missing" };
  }
  const stat = statSync(source);
  if (!stat.isFile()) {
    return { source: relativePath, copied: false, reason: "not_file" };
  }
  if (stat.size > maxBytes) {
    return {
      source: relativePath,
      copied: false,
      reason: "over_size_limit",
      bytes: stat.size,
      maxBytes,
    };
  }
  await ensureDir(targetDir);
  const destination = path.join(targetDir, targetName ?? path.basename(relativePath));
  await fs.copyFile(source, destination);
  return {
    source: relativePath,
    copied: true,
    destination: path.relative(ROOT, destination).replace(/\\/g, "/"),
    bytes: stat.size,
  };
}

async function copyPublicDogfoodFiles(files, sourceSubdir, targetDir) {
  const results = [];
  const seen = new Set();
  for (const file of files) {
    const safeFile = typeof file === "string" ? file : "";
    if (!safeFile || safeFile.includes("..") || path.isAbsolute(safeFile) || seen.has(safeFile)) continue;
    seen.add(safeFile);
    results.push(await copyFileIfExists(`public/dogfood/${sourceSubdir}/${safeFile}`, targetDir));
  }
  return results;
}

async function copyAgenticEvidence(targetDir) {
  const sourceDir = path.join(ROOT, ".tmp", "dogfood-gemini-qa");
  if (!existsSync(sourceDir)) return [];
  const entries = await fs.readdir(sourceDir).catch(() => []);
  const pngs = entries
    .filter((entry) => /^agentic-.*\.png$/i.test(entry))
    .slice(0, 80);
  const results = [];
  for (const entry of pngs) {
    results.push(await copyFileIfExists(`.tmp/dogfood-gemini-qa/${entry}`, targetDir));
  }
  return results;
}

async function archiveCurrentGeneration({ latest, ledger, rawHistory }) {
  const runId = sanitizePathPart(`${timestampSlug(latest.timestamp)}-${ledger.git.head}`);
  const index = await readJson(GENERATION_INDEX_JSON_PATH, { runs: [] });
  const runs = Array.isArray(index?.runs) ? index.runs : [];
  const existing = runs.find((run) => run.runId === runId);
  const sequence = existing?.sequence ?? Math.max(runs.reduce((max, run) => Math.max(max, Number(run.sequence) || 0), 0), rawHistory.length - 1) + 1;
  const archiveName = `gen-${String(sequence).padStart(4, "0")}-${runId}`;
  const archiveDir = path.join(GENERATIONS_DIR, archiveName);

  await ensureDir(archiveDir);
  await ensureDir(path.join(archiveDir, "json"));
  await ensureDir(path.join(archiveDir, "screenshots"));
  await ensureDir(path.join(archiveDir, "frames"));
  await ensureDir(path.join(archiveDir, "scribe"));
  await ensureDir(path.join(archiveDir, "videos"));
  await ensureDir(path.join(archiveDir, "gemini"));
  await ensureDir(path.join(archiveDir, "agentic"));

  const manifest = await readJson(path.join(ROOT, "public", "dogfood", "manifest.json"), {});
  const frames = await readJson(path.join(ROOT, "public", "dogfood", "frames.json"), {});
  const scribe = await readJson(path.join(ROOT, "public", "dogfood", "scribe.json"), {});

  const jsonCopies = [];
  for (const relativePath of [
    "public/dogfood/manifest.json",
    "public/dogfood/frames.json",
    "public/dogfood/scribe.json",
    "public/dogfood/walkthrough.json",
    "public/dogfood/qa-results.json",
  ]) {
    jsonCopies.push(await copyFileIfExists(relativePath, path.join(archiveDir, "json")));
  }

  const geminiCopies = [];
  for (const relativePath of GEMINI_ARTIFACTS) {
    geminiCopies.push(await copyFileIfExists(relativePath, path.join(archiveDir, "gemini")));
  }

  const screenshotCopies = await copyPublicDogfoodFiles(
    Array.isArray(manifest?.items) ? manifest.items.map((item) => item?.file) : [],
    "screenshots",
    path.join(archiveDir, "screenshots"),
  );
  const frameCopies = await copyPublicDogfoodFiles(
    Array.isArray(frames?.items) ? frames.items.map((item) => item?.file) : [],
    "frames",
    path.join(archiveDir, "frames"),
  );
  const scribeCopies = await copyPublicDogfoodFiles(
    Array.isArray(scribe?.steps)
      ? scribe.steps
          .map((step) => String(step?.image ?? "").replace(/^\/?dogfood\/scribe\//, ""))
          .filter(Boolean)
      : [],
    "scribe",
    path.join(archiveDir, "scribe"),
  );

  const videoCopies = [];
  for (const relativePath of [
    "public/dogfood/walkthrough.mp4",
    "public/dogfood/walkthrough.webm",
    "public/dogfood/videos/agentic-session.webm",
    ".tmp/dogfood-gemini-qa/agentic-session.webm",
  ]) {
    videoCopies.push(await copyFileIfExists(relativePath, path.join(archiveDir, "videos"), {
      maxBytes: relativePath.includes(".tmp/") ? LARGE_VIDEO_COPY_LIMIT_BYTES : Infinity,
      targetName: relativePath.includes(".tmp/") ? "agentic-session-current.webm" : undefined,
    }));
  }
  const agenticCopies = await copyAgenticEvidence(path.join(archiveDir, "agentic"));

  const copiedCount = [...jsonCopies, ...geminiCopies, ...screenshotCopies, ...frameCopies, ...scribeCopies, ...videoCopies, ...agenticCopies]
    .filter((copy) => copy.copied).length;
  const stateEvidence = {
    before: {
      label: "Before",
      purpose: "Static route screenshots before interactive playback and judging.",
      count: screenshotCopies.filter((copy) => copy.copied).length,
    },
    during: {
      label: "During",
      purpose: "Walkthrough video, extracted frames, scribe steps, and agentic interaction screenshots.",
      count:
        videoCopies.filter((copy) => copy.copied).length
        + frameCopies.filter((copy) => copy.copied).length
        + scribeCopies.filter((copy) => copy.copied).length
        + agenticCopies.filter((copy) => copy.copied).length,
    },
    after: {
      label: "After",
      purpose: "Gemini screen/video judge outputs and final QA ledger.",
      count: geminiCopies.filter((copy) => copy.copied).length + jsonCopies.filter((copy) => copy.copied).length,
    },
  };

  const generationSummary = {
    runId,
    sequence,
    archiveName,
    archivedAt: new Date().toISOString(),
    archivePath: path.relative(ROOT, archiveDir).replace(/\\/g, "/"),
    latest,
    releaseInterpretation: ledger.releaseInterpretation,
    comparisons: ledger.comparisons,
    currentRun: ledger.currentRun,
    evidence: {
      copiedCount,
      stateEvidence,
      json: jsonCopies,
      gemini: geminiCopies,
      screenshots: screenshotCopies,
      frames: frameCopies,
      scribe: scribeCopies,
      videos: videoCopies,
      agentic: agenticCopies,
    },
    git: ledger.git,
  };

  await fs.writeFile(path.join(archiveDir, "summary.json"), `${JSON.stringify(generationSummary, null, 2)}\n`, "utf8");

  const summaryMd = [
    `# Dogfood Generation ${sequence}`,
    "",
    `Run id: \`${runId}\``,
    "",
    `Archived: ${generationSummary.archivedAt}`,
    "",
    `Score: **${latest.score} / ${latest.grade}**`,
    "",
    `Real issues: **${latest.realIssueCount}** (${latest.critical} critical, ${latest.warning} warning, ${latest.info} info)`,
    "",
    `Release interpretation: **${ledger.releaseInterpretation.latestStatus}** - ${ledger.releaseInterpretation.reason}`,
    "",
    "## Current Real Issues",
    "",
    ledger.currentRun.realIssues.length ? ledger.currentRun.realIssues.map(formatIssue).join("\n") : "No current real issues recorded.",
    "",
    "## Copied Evidence",
    "",
    `Copied evidence files: ${copiedCount}`,
    "",
    table([
      { name: "Before states", count: stateEvidence.before.count },
      { name: "During states", count: stateEvidence.during.count },
      { name: "After states", count: stateEvidence.after.count },
      { name: "JSON manifests", count: jsonCopies.filter((copy) => copy.copied).length },
      { name: "Gemini judge artifacts", count: geminiCopies.filter((copy) => copy.copied).length },
      { name: "Screenshots", count: screenshotCopies.filter((copy) => copy.copied).length },
      { name: "Video frames", count: frameCopies.filter((copy) => copy.copied).length },
      { name: "Scribe images", count: scribeCopies.filter((copy) => copy.copied).length },
      { name: "Videos", count: videoCopies.filter((copy) => copy.copied).length },
      { name: "Agentic screenshots", count: agenticCopies.filter((copy) => copy.copied).length },
    ], [
      { label: "Evidence", value: (row) => row.name },
      { label: "Count", value: (row) => row.count },
    ]),
    "",
  ].join("\n");
  await fs.writeFile(path.join(archiveDir, "summary.md"), summaryMd, "utf8");

  const indexEntry = {
    runId,
    sequence,
    archiveName,
    archivePath: generationSummary.archivePath,
    timestamp: latest.timestamp,
    archivedAt: generationSummary.archivedAt,
    gitHead: ledger.git.head,
    score: latest.score,
    grade: latest.grade,
    realIssueCount: latest.realIssueCount,
    critical: latest.critical,
    warning: latest.warning,
    info: latest.info,
    model: latest.model,
    releaseStatus: ledger.releaseInterpretation.latestStatus,
    copiedCount,
  };

  const nextRuns = [indexEntry, ...runs.filter((run) => run.runId !== runId)]
    .sort((a, b) => Number(b.sequence) - Number(a.sequence));
  const nextIndex = {
    generatedAt: new Date().toISOString(),
    latestRunId: runId,
    latestArchiveName: archiveName,
    retainedRuns: nextRuns.length,
    runs: nextRuns,
  };
  await ensureDir(GENERATIONS_DIR);
  await fs.writeFile(GENERATION_INDEX_JSON_PATH, `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
  await fs.writeFile(GENERATION_INDEX_MD_PATH, [
    "# Dogfood Generation Archive",
    "",
    `Generated: ${nextIndex.generatedAt}`,
    "",
    `Latest archive: \`${archiveName}\``,
    "",
    table(nextRuns.slice(0, 30), [
      { label: "Seq", value: (run) => run.sequence },
      { label: "Timestamp", value: (run) => run.timestamp },
      { label: "Score", value: (run) => run.score },
      { label: "Grade", value: (run) => run.grade },
      { label: "Real Issues", value: (run) => run.realIssueCount },
      { label: "Critical", value: (run) => run.critical },
      { label: "Warning", value: (run) => run.warning },
      { label: "Status", value: (run) => run.releaseStatus },
      { label: "Archive", value: (run) => `\`${run.archivePath}\`` },
    ]),
    "",
  ].join("\n"), "utf8");

  return {
    runId,
    sequence,
    archiveName,
    archivePath: generationSummary.archivePath,
    copiedCount,
    stateEvidence,
  };
}

function table(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row) ?? "")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function formatDelta(value) {
  if (value === null || value === undefined) return "";
  if (value > 0) return `+${value}`;
  return String(value);
}

function formatIssue(issue) {
  const header = issue?.header ?? "Untitled issue";
  const route = issue?.route ? ` (${issue.route})` : "";
  return `- ${header}${route}`;
}

async function main() {
  const rawHistory = await readJson(QA_HISTORY_PATH, []);
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    throw new Error(`No QA history found at ${QA_HISTORY_PATH}`);
  }

  const total = rawHistory.length;
  const generations = rawHistory.map((entry, index) => summarizeEntry(entry, index, total));
  const latest = generations[0];
  const oldest = generations.at(-1);
  const previous = generations[1] ?? latest;
  const tenBack = generations[9] ?? oldest ?? latest;
  const twentyFiveBack = generations[24] ?? oldest ?? latest;
  const best = [...generations]
    .filter((entry) => entry.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.realIssueCount ?? 0) - (b.realIssueCount ?? 0))[0] ?? latest;

  const comparisons = [
    compareEntries(latest, previous, "previous_run"),
    compareEntries(latest, tenBack, "ten_run_window"),
    compareEntries(latest, twentyFiveBack, "twenty_five_run_window"),
    compareEntries(latest, oldest, "oldest_retained_generation"),
    compareEntries(latest, best, "best_retained_generation"),
  ];
  const deltaChainLastTen = generations.slice(0, 10).map((entry, index) => {
    const predecessor = generations[index + 1] ?? entry;
    return compareEntries(entry, predecessor, `gen_${entry.generation}_vs_previous`);
  });

  const qaLoopContext = await readJson(path.join(ROOT, ".tmp", "dogfood-gemini-qa", "qa-loop-context.json"), {});
  const videoQa = await readJson(path.join(ROOT, ".tmp", "dogfood-gemini-qa", "video-qa.json"), []);
  const screenQa = await readJson(path.join(ROOT, ".tmp", "dogfood-gemini-qa", "screens-qa.json"), []);
  const currentRealIssues = Array.isArray(qaLoopContext?.realIssues) ? qaLoopContext.realIssues : [];
  const candidateIssues = Array.isArray(qaLoopContext?.candidateIssues) ? qaLoopContext.candidateIssues : [];

  const dirtyFiles = runGit(["status", "--short"]).split(/\r?\n/).filter(Boolean);
  const ledger = {
    generatedAt: new Date().toISOString(),
    git: {
      branch: runGit(["branch", "--show-current"], "unknown"),
      head: runGit(["rev-parse", "--short", "HEAD"], "unknown"),
      upstream: runGit(["rev-parse", "--short", "@{u}"], "unknown"),
      dirty: dirtyFiles.length > 0,
      dirtyFileCount: dirtyFiles.length,
      dirtyFiles: dirtyFiles.slice(0, 120),
    },
    history: {
      retainedGenerations: total,
      latest,
      oldest,
      best,
      lastTen: generations.slice(0, 10),
      deltaChainLastTen,
    },
    comparisons,
    currentRun: {
      realIssues: currentRealIssues,
      candidateIssueCount: candidateIssues.length,
      videoSummaries: Array.isArray(videoQa) ? videoQa.map((entry) => entry?.summary).filter(Boolean) : [],
      screenSummaries: Array.isArray(screenQa) ? screenQa.map((entry) => entry?.summary).filter(Boolean) : [],
    },
    evidence: {
      artifacts: OPTIONAL_ARTIFACTS.map(artifactInfo),
      hasScreenshots: artifactInfo("public/dogfood/manifest.json").exists,
      hasVideo: artifactInfo("public/dogfood/walkthrough.mp4").exists,
      hasGeminiVideoJudge: artifactInfo(".tmp/dogfood-gemini-qa/video-qa.json").exists,
      hasAgenticVideo: artifactInfo(".tmp/dogfood-gemini-qa/agentic-session.webm").exists,
    },
    releaseInterpretation: {
      latestStatus: latest.realIssueCount === 0 && latest.critical === 0 ? "release-clean" : "release-risk",
      reason:
        latest.realIssueCount === 0 && latest.critical === 0
          ? "Latest retained run has no real issues and no critical issues."
          : `Latest retained run has ${latest.realIssueCount ?? "unknown"} real issue(s), ${latest.critical ?? "unknown"} critical, and ${latest.warning ?? "unknown"} warning(s).`,
    },
  };

  ledger.generationArchive = await archiveCurrentGeneration({ latest, ledger, rawHistory });

  await fs.mkdir(path.dirname(LEDGER_JSON_PATH), { recursive: true });
  await fs.writeFile(LEDGER_JSON_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  const markdown = [
    "# Dogfood QA Generation Ledger",
    "",
    `Generated: ${ledger.generatedAt}`,
    "",
    `Git: \`${ledger.git.branch}\` at \`${ledger.git.head}\` (upstream \`${ledger.git.upstream}\`)`,
    "",
    `Dirty checkout: ${ledger.git.dirty ? `yes (${ledger.git.dirtyFileCount} paths)` : "no"}`,
    "",
    "## Latest Status",
    "",
    `Latest generation: **gen ${latest.generation}**`,
    "",
    `Score: **${latest.score} / ${latest.grade}**`,
    "",
    `Real issues: **${latest.realIssueCount}** (${latest.critical} critical, ${latest.warning} warning, ${latest.info} info)`,
    "",
    `Release interpretation: **${ledger.releaseInterpretation.latestStatus}** - ${ledger.releaseInterpretation.reason}`,
    "",
    "## Retained Archive",
    "",
    `Archive sequence: **${ledger.generationArchive.sequence}**`,
    "",
    `Archive path: \`${ledger.generationArchive.archivePath}\``,
    "",
    `Copied evidence files: **${ledger.generationArchive.copiedCount}**`,
    "",
    "## Generation Comparisons",
    "",
    table(comparisons, [
      { label: "Comparison", value: (row) => row.label },
      { label: "Baseline Gen", value: (row) => row.baselineGeneration },
      { label: "Baseline Score", value: (row) => row.baseline.score },
      { label: "Latest Score", value: (row) => row.latest.score },
      { label: "Score delta", value: (row) => formatDelta(row.scoreDelta) },
      { label: "Issue delta", value: (row) => formatDelta(row.realIssueDelta) },
      { label: "Critical delta", value: (row) => formatDelta(row.criticalDelta) },
      { label: "Warning delta", value: (row) => formatDelta(row.warningDelta) },
    ]),
    "",
    "## Delta Chain",
    "",
    table(deltaChainLastTen, [
      { label: "Run", value: (row) => row.label },
      { label: "Gen", value: (row) => row.latestGeneration },
      { label: "Baseline Gen", value: (row) => row.baselineGeneration },
      { label: "Score", value: (row) => row.latest.score },
      { label: "Score delta", value: (row) => formatDelta(row.scoreDelta) },
      { label: "Issue delta", value: (row) => formatDelta(row.realIssueDelta) },
      { label: "Critical delta", value: (row) => formatDelta(row.criticalDelta) },
      { label: "Warning delta", value: (row) => formatDelta(row.warningDelta) },
    ]),
    "",
    "## Last Ten Generations",
    "",
    table(generations.slice(0, 10), [
      { label: "Gen", value: (row) => row.generation },
      { label: "Timestamp", value: (row) => row.timestamp },
      { label: "Score", value: (row) => row.score },
      { label: "Grade", value: (row) => row.grade },
      { label: "Real Issues", value: (row) => row.realIssueCount },
      { label: "Critical", value: (row) => row.critical },
      { label: "Warning", value: (row) => row.warning },
      { label: "Model", value: (row) => row.model },
    ]),
    "",
    "## Current Real Issues",
    "",
    currentRealIssues.length ? currentRealIssues.map(formatIssue).join("\n") : "No current real issues recorded.",
    "",
    "## Evidence Artifacts",
    "",
    table(ledger.evidence.artifacts, [
      { label: "Artifact", value: (row) => `\`${row.path}\`` },
      { label: "Exists", value: (row) => row.exists ? "yes" : "no" },
      { label: "Bytes", value: (row) => row.bytes ?? "" },
      { label: "Updated", value: (row) => row.updatedAt ?? "" },
    ]),
    "",
    "## Interpretation",
    "",
    "This ledger makes each dogfood run comparable as a retained generation. Use it after `npm run dogfood:verify:strict` or `npm run dogfood:loop` to compare the current run against the previous run, a ten-run window, the oldest retained generation, and the best retained generation.",
    "",
  ].join("\n");

  await fs.writeFile(LEDGER_MD_PATH, markdown, "utf8");
  console.log(`Wrote ${path.relative(ROOT, LEDGER_JSON_PATH)}`);
  console.log(`Wrote ${path.relative(ROOT, LEDGER_MD_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
