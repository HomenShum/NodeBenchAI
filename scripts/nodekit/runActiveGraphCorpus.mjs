import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import {
  assertCanonicalNodeKitRunExport,
  runActiveGraphCanaryFromExport,
} from "./runActiveGraphCanary.mjs";

export const ACTIVEGRAPH_CORPUS_SCHEMA =
  "nodebench.activegraph.owner-export-corpus/v1";
export const ACTIVEGRAPH_CORPUS_REPORT_SCHEMA =
  "nodebench.activegraph.owner-export-corpus-report/v1";
export const ACTIVEGRAPH_CORPUS_MIN_EXPORTS = 20;
export const ACTIVEGRAPH_CORPUS_MAX_EXPORTS = 24;

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_EXPORT_BYTES = 64 * 1024 * 1024;
const DEFAULT_BASELINE_ITERATIONS = 20;

export class ActiveGraphCorpusError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ActiveGraphCorpusError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ActiveGraphCorpusError(code, message);
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("manifest_invalid", `${label} must be an object.`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(
      "manifest_invalid",
      `${label} keys differ: expected ${wanted.join(", ")}; got ${actual.join(", ")}.`,
    );
  }
}

function boundedRegularFile(path, maxBytes, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail("file_unavailable", `${label} is unavailable.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("file_invalid", `${label} must be a regular non-symlink file.`);
  }
  if (stat.size <= 0 || stat.size > maxBytes) {
    fail("file_size_invalid", `${label} exceeds its byte bound.`);
  }
  return readFileSync(path);
}

function resolveCorpusFile(manifestDirectory, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 240 ||
    isAbsolute(relativePath)
  ) {
    fail("manifest_invalid", `${label} must be a bounded relative path.`);
  }
  const candidate = resolve(manifestDirectory, relativePath);
  const rel = relative(manifestDirectory, candidate);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  ) {
    fail("path_escape", `${label} escapes the corpus directory.`);
  }
  const realDirectory = realpathSync(manifestDirectory);
  const realCandidate = realpathSync(candidate);
  const realRelative = relative(realDirectory, realCandidate);
  if (
    !realRelative ||
    realRelative === ".." ||
    realRelative.startsWith("../") ||
    realRelative.startsWith("..\\") ||
    isAbsolute(realRelative)
  ) {
    fail("path_escape", `${label} resolves outside the corpus directory.`);
  }
  return realCandidate;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseManifest(manifestPath) {
  const resolvedManifest = resolve(manifestPath);
  const bytes = boundedRegularFile(
    resolvedManifest,
    MAX_MANIFEST_BYTES,
    "corpus manifest",
  );
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("manifest_invalid", "Corpus manifest must be valid JSON.");
  }
  assertObject(manifest, "corpus manifest");
  exactKeys(
    manifest,
    ["schemaVersion", "collectedAt", "source", "exports"],
    "corpus manifest",
  );
  if (manifest.schemaVersion !== ACTIVEGRAPH_CORPUS_SCHEMA) {
    fail("manifest_schema_mismatch", "Unsupported corpus manifest schema.");
  }
  if (
    typeof manifest.collectedAt !== "string" ||
    Number.isNaN(Date.parse(manifest.collectedAt))
  ) {
    fail("manifest_invalid", "collectedAt must be an RFC 3339 timestamp.");
  }
  assertObject(manifest.source, "corpus source");
  exactKeys(
    manifest.source,
    ["kind", "gatewayFunction", "authorization"],
    "corpus source",
  );
  if (
    manifest.source.kind !== "nodebench-production" ||
    manifest.source.gatewayFunction !== "exportNodeKitRun" ||
    manifest.source.authorization !== "gateway-injected-owner"
  ) {
    fail(
      "authorization_unproven",
      "Corpus source must name the owner-injected production export boundary.",
    );
  }
  if (
    !Array.isArray(manifest.exports) ||
    manifest.exports.length < ACTIVEGRAPH_CORPUS_MIN_EXPORTS ||
    manifest.exports.length > ACTIVEGRAPH_CORPUS_MAX_EXPORTS
  ) {
    fail(
      "corpus_size_invalid",
      `Corpus must contain ${ACTIVEGRAPH_CORPUS_MIN_EXPORTS}-${ACTIVEGRAPH_CORPUS_MAX_EXPORTS} exports.`,
    );
  }
  return { manifest, resolvedManifest };
}

export function loadActiveGraphCorpus(manifestPath) {
  const { manifest, resolvedManifest } = parseManifest(manifestPath);
  const manifestDirectory = dirname(resolvedManifest);
  const labels = new Set();
  const exportHashes = new Set();
  const runIds = new Set();
  let totalBytes = 0;
  const entries = manifest.exports.map((entry, index) => {
    assertObject(entry, `exports[${index}]`);
    exactKeys(
      entry,
      ["label", "inputFile", "workflowClass", "terminalStatus"],
      `exports[${index}]`,
    );
    if (
      typeof entry.label !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(entry.label) ||
      labels.has(entry.label)
    ) {
      fail(
        "manifest_invalid",
        `exports[${index}].label is invalid or duplicated.`,
      );
    }
    labels.add(entry.label);
    if (
      typeof entry.workflowClass !== "string" ||
      entry.workflowClass.length === 0 ||
      entry.workflowClass.length > 120
    ) {
      fail("manifest_invalid", `exports[${index}].workflowClass is invalid.`);
    }
    if (!["completed", "error"].includes(entry.terminalStatus)) {
      fail("manifest_invalid", `exports[${index}].terminalStatus is invalid.`);
    }
    const exportPath = resolveCorpusFile(
      manifestDirectory,
      entry.inputFile,
      `exports[${index}].inputFile`,
    );
    const bytes = boundedRegularFile(exportPath, MAX_EXPORT_BYTES, entry.label);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_EXPORT_BYTES) {
      fail("corpus_too_large", "Corpus exceeds its aggregate byte bound.");
    }
    let document;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("export_invalid", `${entry.label} is not valid JSON.`);
    }
    assertCanonicalNodeKitRunExport(document);
    if (document.trace.status !== entry.terminalStatus) {
      fail(
        "manifest_export_mismatch",
        `${entry.label} terminal status differs from its canonical export.`,
      );
    }
    if (
      exportHashes.has(document.hashes.exportHash) ||
      runIds.has(document.runId)
    ) {
      fail(
        "corpus_duplicate",
        `${entry.label} duplicates a run or export hash.`,
      );
    }
    exportHashes.add(document.hashes.exportHash);
    runIds.add(document.runId);
    return Object.freeze({
      ...entry,
      exportPath,
      document,
    });
  });
  return Object.freeze({
    collectedAt: manifest.collectedAt,
    source: Object.freeze({ ...manifest.source }),
    manifestPath: resolvedManifest,
    entries: Object.freeze(entries),
  });
}

function hasMaterialExplanation(report) {
  const explanatoryKeys = [
    "causal_paths",
    "diff",
    "findings",
    "graph_explanation",
    "topology",
    "why",
  ];
  return explanatoryKeys.some((key) => Object.hasOwn(report, key));
}

export async function runActiveGraphCorpus({
  manifestPath,
  evidenceRoot,
  sandboxImage,
  imageAttestationPath,
  sandboxExecutable = "docker",
  baselineIterations = DEFAULT_BASELINE_ITERATIONS,
  canaryRunner = runActiveGraphCanaryFromExport,
  sourceEnvironment = process.env,
}) {
  if (
    !Number.isSafeInteger(baselineIterations) ||
    baselineIterations < 1 ||
    baselineIterations > 100
  ) {
    fail("baseline_iterations_invalid", "baselineIterations must be 1-100.");
  }
  const corpus = loadActiveGraphCorpus(manifestPath);
  const resolvedEvidenceRoot = resolve(evidenceRoot);
  mkdirSync(resolvedEvidenceRoot, { recursive: true });
  const runs = [];

  for (const [index, entry] of corpus.entries.entries()) {
    const baselineSamples = [];
    for (let sample = 0; sample < baselineIterations; sample += 1) {
      const started = performance.now();
      assertCanonicalNodeKitRunExport(entry.document);
      baselineSamples.push(performance.now() - started);
    }
    const canaryStarted = performance.now();
    const result = await canaryRunner({
      exportPath: entry.exportPath,
      evidenceRoot: resolvedEvidenceRoot,
      runDirectoryName: `${String(index + 1).padStart(2, "0")}-${entry.label}`,
      sandboxExecutable,
      sandboxImage,
      imageAttestationPath,
      sourceEnvironment,
    });
    const canaryMs = performance.now() - canaryStarted;
    if (
      result.report?.verdict !== "pass" ||
      result.report?.persisted_reload_parity !== true
    ) {
      fail("canary_parity_failed", `${entry.label} failed replay parity.`);
    }
    runs.push({
      label: entry.label,
      workflowClass: entry.workflowClass,
      terminalStatus: entry.terminalStatus,
      runId: entry.document.runId,
      exportHash: entry.document.hashes.exportHash,
      chainHead: entry.document.hashes.chainHead,
      eventCount: entry.document.events.length,
      eventTypes: [
        ...new Set(entry.document.events.map((event) => event.eventType)),
      ],
      baselineValidationMedianMs: median(baselineSamples),
      activeGraphCanaryMs: canaryMs,
      persistedReloadParity: true,
      materialExplanationObserved: hasMaterialExplanation(result.report),
      evidenceDirectory: relative(resolvedEvidenceRoot, result.runDirectory),
    });
  }

  const baselineMedianMs = median(
    runs.map((run) => run.baselineValidationMedianMs),
  );
  const activeGraphMedianMs = median(
    runs.map((run) => run.activeGraphCanaryMs),
  );
  const latencyRatio =
    baselineMedianMs === 0 ? null : activeGraphMedianMs / baselineMedianMs;
  const allParity = runs.every((run) => run.persistedReloadParity);
  const materialExplanationObserved = runs.some(
    (run) => run.materialExplanationObserved,
  );
  const latencyWithinThreshold = latencyRatio !== null && latencyRatio <= 2;
  const stopConditions = [
    ...(allParity ? [] : ["persistence_reload_parity_failed"]),
    ...(latencyWithinThreshold ? [] : ["median_latency_exceeded_2x"]),
    ...(materialExplanationObserved ? [] : ["no_material_explanatory_value"]),
  ];
  const reportBody = {
    schemaVersion: ACTIVEGRAPH_CORPUS_REPORT_SCHEMA,
    collectedAt: corpus.collectedAt,
    evaluatedAt: new Date().toISOString(),
    source: corpus.source,
    corpusSize: runs.length,
    allExportsComplete: true,
    allPersistenceReloadParity: allParity,
    baselineValidationMedianMs: baselineMedianMs,
    activeGraphCanaryMedianMs: activeGraphMedianMs,
    latencyRatio,
    latencyThreshold: 2,
    materialExplanatoryValueObserved: materialExplanationObserved,
    stopConditions,
    adoptionVerdict:
      stopConditions.length === 0 ? "eligible-for-adr" : "reject",
    authority:
      "offline evaluation evidence only; cannot answer, approve, mutate, schedule, or replace NodeBench state",
    limitations: [
      "Gateway-injected ownership is enforced by NodeBench, not cryptographically signed into each exported file.",
      "The baseline is canonical NodeKit validation; it does not include an alternative graph database.",
      "A reject verdict closes this adoption experiment but does not delete the offline canary.",
    ],
    runs,
  };
  const report = {
    ...reportBody,
    reportHash: sha256(canonicalJson(reportBody)),
  };
  writeFileSync(
    resolve(resolvedEvidenceRoot, "corpus-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return Object.freeze(report);
}

function parseCliArgs(argv) {
  const result = {};
  const allowed = new Set([
    "manifest",
    "evidence-root",
    "sandbox-image",
    "image-attestation",
    "docker",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("cli_args_invalid", "CLI arguments must be --key value pairs.");
    }
    const name = key.slice(2);
    if (!allowed.has(name) || name in result) {
      fail("cli_args_invalid", `Unknown or duplicate CLI argument: --${name}.`);
    }
    result[name] = value;
  }
  for (const required of [
    "manifest",
    "evidence-root",
    "sandbox-image",
    "image-attestation",
  ]) {
    if (!result[required]) {
      fail("cli_args_invalid", `--${required} is required.`);
    }
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const report = await runActiveGraphCorpus({
      manifestPath: args.manifest,
      evidenceRoot: args["evidence-root"],
      sandboxImage: args["sandbox-image"],
      imageAttestationPath: args["image-attestation"],
      sandboxExecutable: args.docker ?? "docker",
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
