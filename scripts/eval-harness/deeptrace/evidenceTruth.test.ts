import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import {
  captureBaseline, evaluateCandidate, loadBaselineSnapshot,
  replayRunLog, runOptimizerSession,
} from "./optimizerRunner";
import propose from "./nodebench-proposer";
import { DEFAULT_OPTIMIZER_CONFIG, type BaselineSnapshot } from "./optimizerTypes";

// Only lifecycle/command I/O is isolated. The evaluator, session, proposer,
// serializers, replay and native paired CLI all execute their real code.
const io = vi.hoisted(() => ({
  changedFiles: [] as string[], compileFails: false, testFails: false,
  commands: [] as string[], logPaths: new Map<string, string>(), outputDir: "",
}));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execSync: vi.fn((command: string) => {
    io.commands.push(command);
    if (command.startsWith("git diff")) return io.changedFiles.join("\n");
    if (command === "git rev-parse HEAD") return "test-commit\n";
    if (command.startsWith("git worktree") || command.startsWith("git -C")) return "";
    if (command.includes("--noEmit")) {
      if (io.compileFails) throw new Error("Scenario compile failure");
      return "";
    }
    if (command.includes("--reporter=json")) {
      if (io.testFails) throw new Error("Scenario test failure");
      return "";
    }
    throw new Error(`Unexpected lifecycle command: ${command}`);
  }) };
});
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual,
    writeFileSync: vi.fn((file: fs.PathOrFileDescriptor, data: string, ...args: unknown[]) => {
      const name = String(file);
      if (name.replaceAll("\\", "/").includes("/deeptrace/run-logs/")) {
        const redirected = path.join(io.outputDir, path.basename(name));
        io.logPaths.set(name, redirected);
        actual.writeFileSync(redirected, data);
        return;
      }
      return Reflect.apply(actual.writeFileSync, actual, [file, data, ...args]);
    }),
    existsSync: vi.fn((file: fs.PathLike) => actual.existsSync(io.logPaths.get(String(file)) ?? file)),
    readFileSync: vi.fn((file: fs.PathOrFileDescriptor, ...args: unknown[]) =>
      Reflect.apply(actual.readFileSync, actual, [io.logPaths.get(String(file)) ?? file, ...args])),
  };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const outputDir = fs.mkdtempSync(path.join(tmpdir(), "deeptrace-evidence-truth-"));
const baselinePath = path.join(here, "baseline-snapshots/canary-baseline.remeasured.json");
const baseline = () => loadBaselineSnapshot(baselinePath);
const idealThroughput = { taskCompletionRate: 1, timeToFirstDraftMs: 0, humanEditDistance: 0, wallClockMs: 0, toolCallCount: 0 };
const idealQuality = { factualPrecision: 1, relationshipPrecision: 1, evidenceLinkage: 1, receiptCompleteness: 1, falseConfidenceRate: 0, canaryRelativeUplift: 1 };
const config = (maxIterations: number) => ({ ...DEFAULT_OPTIMIZER_CONFIG, maxIterations, maxSessionSeconds: 60 });

beforeEach(() => {
  io.changedFiles = []; io.compileFails = false; io.testFails = false;
  io.commands = []; io.outputDir = outputDir;
});

describe("Engineer reviews proposals without mistaking predictions for measured improvement", () => {
  it("keeps the actual first NodeBench proposal diagnostic even when its score passes every guard", async () => {
    const original = baseline();
    const proposal = (await propose(repo, original, 0))!;
    const result = evaluateCandidate(proposal.candidateId, original, repo, proposal.throughput, proposal.quality, ["company_direction"]);
    expect(proposal.rationale).toMatch(/^Simulated strategy:/);
    expect(result).toMatchObject({ changedFiles: [], compileSuccess: null, testSuccess: null,
      verdict: "proposal-only", evidenceStatus: "unverified", releaseEligible: false });
    expect(result.score.guardsPass).toBe(true);
    expect(result.score.throughputScore).toBeCloseTo(0.9142852452029799, 14);
    expect(io.commands.some((c) => c.includes("--noEmit") || c.includes("--reporter=json"))).toBe(false);
  });

  it("does not grant authority to forged measurement flags or perfect self-reported metrics", () => {
    const result = evaluateCandidate("forged", baseline(), repo,
      { ...idealThroughput, measured: true } as typeof idealThroughput,
      { ...idealQuality, evidenceStatus: "measured", releaseEligible: true, provenance: "trusted harness" } as typeof idealQuality, []);
    expect(result).toMatchObject({ verdict: "proposal-only", evidenceStatus: "unverified", releaseEligible: false });
    expect(result.score).toMatchObject({ throughputScore: 1, guardsPass: true });
    expect(result.score.qualityMetrics).toEqual(idealQuality);
  });

  it("preserves the accepted baseline through 128 improving, plateauing and regressing predictions", async () => {
    const original = baseline();
    const before = structuredClone(original);
    const seen: BaselineSnapshot[] = [];
    const log = await runOptimizerSession(original, config(128), async (_worktree, accepted, i) => {
      seen.push(structuredClone(accepted));
      return { candidateId: `sustained-${i}`, throughput: { ...idealThroughput, taskCompletionRate: [1, 0.6, 0.1][i % 3] }, quality: idealQuality };
    });
    expect(log.candidates).toHaveLength(128);
    expect(seen.every((s) => JSON.stringify(s) === JSON.stringify(before))).toBe(true);
    expect(log.baseline).toEqual(before);
    expect(original).toEqual(before);
    expect(log.promotedCandidateId).toBeNull();
    expect(log.candidates.every((c) => c.verdict === "proposal-only")).toBe(true);
    const replay = replayRunLog(log.sessionId)!;
    expect(replay.log).toEqual(log);
    expect(replay.summary).toContain("Verified promotions: 0");
  });

  it("isolates retained nested aliases across awaits, concurrent sessions and a shared caller baseline", async () => {
    const original = baseline();
    const before = structuredClone(original);
    const retained: BaselineSnapshot[] = [];
    const logs = await Promise.all(Array.from({ length: 4 }, (_, session) =>
      runOptimizerSession(original, config(12), async (_worktree, accepted, i) => {
        expect(accepted).toEqual(before);
        retained.push(accepted);
        accepted.baselineId = "forged-baseline";
        accepted.throughputMetrics.taskCompletionRate = 0;
        accepted.qualityMetrics.factualPrecision = 0;
        await Promise.resolve();
        return { candidateId: `burst-${session}-${i}`, throughput: idealThroughput, quality: idealQuality };
      })));
    retained.forEach((b) => { b.qualityMetrics.evidenceLinkage = 0; });
    expect(original).toEqual(before);
    for (const log of logs) {
      expect(log.baseline).toEqual(before);
      expect(log.promotedCandidateId).toBeNull();
      expect(log.candidates).toHaveLength(12);
      expect(replayRunLog(log.sessionId)!.log.baseline).toEqual(before);
    }
  });

  it("keeps supplied baseline metrics unverified and strips a forged import certificate", () => {
    const file = path.join(outputDir, "forged-baseline.json");
    fs.writeFileSync(file, JSON.stringify({ ...baseline(), evidenceStatus: "measured", releaseEligible: true }));
    expect(loadBaselineSnapshot(file)).toMatchObject({ evidenceStatus: "unverified" });
    expect(loadBaselineSnapshot(file)).not.toHaveProperty("releaseEligible");
    expect(captureBaseline(idealThroughput, idealQuality)).toMatchObject({ evidenceStatus: "unverified" });
  });

  it("rejects malformed metrics and denominator-breaking inputs before a diagnostic can become nonfinite", () => {
    const invalidThroughput = [undefined, {}, { ...idealThroughput, wallClockMs: NaN },
      { ...idealThroughput, toolCallCount: Infinity }, { ...idealThroughput, timeToFirstDraftMs: -60000 },
      { ...idealThroughput, humanEditDistance: -500 }, { ...idealThroughput, wallClockMs: -120000 },
      { ...idealThroughput, toolCallCount: -50 }, { ...idealThroughput, taskCompletionRate: 2 }];
    for (const invalid of invalidThroughput) {
      expect(() => evaluateCandidate("malformed", baseline(), repo, invalid as typeof idealThroughput, idealQuality, [])).toThrow(/Expected/);
      const badBaseline = { ...baseline(), throughputMetrics: invalid } as BaselineSnapshot;
      expect(() => evaluateCandidate("malformed-baseline", badBaseline, repo, idealThroughput, idealQuality, [])).toThrow(/Expected/);
    }
    for (const invalid of [undefined, {}, { ...idealQuality, canaryRelativeUplift: Infinity }, { ...idealQuality, factualPrecision: -1 }]) {
      expect(() => evaluateCandidate("malformed", baseline(), repo, idealThroughput, invalid as typeof idealQuality, [])).toThrow(/Expected/);
      expect(() => evaluateCandidate("malformed-baseline", { ...baseline(), qualityMetrics: invalid } as BaselineSnapshot, repo, idealThroughput, idealQuality, [])).toThrow(/Expected/);
    }
    const extreme = evaluateCandidate("large-finite", baseline(), repo,
      { ...idealThroughput, wallClockMs: Number.MAX_VALUE }, { ...idealQuality, canaryRelativeUplift: Number.MAX_VALUE }, []);
    expect(Number.isFinite(extreme.score.throughputScore)).toBe(true);
    expect(extreme).toMatchObject({ releaseEligible: false });
  });

  it("reports failed checks and skipped successors honestly when candidate code is broken", () => {
    io.changedFiles = ["scripts/eval-harness/deeptrace/candidate.ts"];
    io.compileFails = true;
    const compile = evaluateCandidate("bad-compile", baseline(), repo, idealThroughput, idealQuality, []);
    expect(compile).toMatchObject({ verdict: "discarded", compileSuccess: false, testSuccess: null, releaseEligible: false });
    io.compileFails = false; io.testFails = true;
    const test = evaluateCandidate("bad-test", baseline(), repo, idealThroughput, idealQuality, []);
    expect(test).toMatchObject({ verdict: "discarded", compileSuccess: true, testSuccess: false, releaseEligible: false });
    expect(test.rejectionReason).toContain("Scenario test failure");
    io.testFails = false;
    expect(evaluateCandidate("checks-pass", baseline(), repo, idealThroughput, idealQuality, [])).toMatchObject({
      verdict: "proposal-only", compileSuccess: true, testSuccess: true, releaseEligible: false,
    });
    io.changedFiles = ["package.json"];
    expect(evaluateCandidate("disallowed", baseline(), repo, idealThroughput, idealQuality, [])).toMatchObject({
      verdict: "discarded", compileSuccess: null, testSuccess: null, releaseEligible: false,
    });
  });

  it("fails a malformed session without adopting its proposal or persisting a success log", async () => {
    const original = baseline();
    const before = structuredClone(original);
    const previousWrites = io.logPaths.size;
    await expect(runOptimizerSession(original, config(3), async () => ({ candidateId: "invalid-session", throughput: { ...idealThroughput, wallClockMs: NaN }, quality: idealQuality }))).rejects.toThrow(/Expected/);
    expect(original).toEqual(before);
    expect(io.logPaths.size).toBe(previousWrites);
    expect(io.commands.some((command) => command.startsWith("git worktree remove"))).toBe(true);
  });

  it("qualifies legacy recorded promotions while preserving the original raw log bytes", () => {
    const file = path.join(here, "run-logs/opt-5c965554.json");
    const hash = () => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const before = hash();
    const replay = replayRunLog("opt-5c965554")!;
    expect(replay.log.candidates.some((c) => c.verdict === "promoted")).toBe(true);
    expect(replay.summary).toContain("Recorded promotions (legacy, unverified):");
    expect(replay.summary).toContain("Verified promotions: 0");
    expect(replay.summary).toContain("RECORDED PROMOTION (legacy, unverified)");
    expect(hash()).toBe(before);
  });
});

describe("Engineer exports explicitly simulated paired diagnostics", () => {
  const cli = (name: string, simulate: boolean) => {
    const out = path.join(outputDir, name);
    const result = spawnSync(process.execPath, ["--experimental-strip-types", path.join(here, "paired-benchmark-runner.ts"),
      "--outDir", out, ...(simulate ? ["--simulate"] : [])], { cwd: repo, encoding: "utf8", timeout: 30000 });
    fs.writeFileSync(path.join(outputDir, `${name}.stdout.txt`), result.stdout ?? "");
    fs.writeFileSync(path.join(outputDir, `${name}.stderr.txt`), result.stderr ?? "");
    fs.writeFileSync(path.join(outputDir, `${name}.status.json`), JSON.stringify({ status: result.status, error: result.error?.message }));
    return { out, result };
  };

  it("refuses a default measured-looking run before creating any output directory", () => {
    const { out, result } = cli("default-refused", false);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--simulate");
    expect(fs.existsSync(out)).toBe(false);
  });

  it("labels all 37 standalone artifacts and preserves numeric diagnostics without release eligibility", () => {
    const { out, result } = cli("explicit-simulation", true);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SIMULATION");
    expect(result.stdout).toContain("Release eligible: false");
    const suite = path.join(out, fs.readdirSync(out)[0]);
    const files = fs.readdirSync(suite, { recursive: true }).map(String).filter((f) => /\.(json|md)$/.test(f));
    expect(files).toHaveLength(37);
    for (const file of files) {
      const raw = fs.readFileSync(path.join(suite, file), "utf8");
      if (file.endsWith(".json")) expect(JSON.parse(raw), file).toMatchObject({ evidenceStatus: "simulation", releaseEligible: false });
      else { expect(raw, file).toContain("SIMULATION"); expect(raw, file).toContain("Release eligible: false"); }
    }
    const summary = JSON.parse(fs.readFileSync(path.join(suite, "paired-summary.json"), "utf8"));
    expect(summary).not.toHaveProperty("releaseGuards");
    expect(summary.simulationDiagnostics.relativeUplift).toBeCloseTo(0.8134, 4);
    expect(Object.values(summary.simulationDiagnostics.thresholdChecks).every((v) => v === true)).toBe(true);
  });
});
