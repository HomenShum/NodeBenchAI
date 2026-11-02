import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePolicies } from "./canary-benchmark";
import retiredProposer from "./benchmark-proposer";

const policyFile = fileURLToPath(
  new URL(
    "../../../backend/convex/domains/deepTrace/researchCellPolicy.ts",
    import.meta.url,
  ),
);
const cliFile = fileURLToPath(
  new URL("./canary-benchmark.ts", import.meta.url),
);
const current = readFileSync(policyFile, "utf8");
const directory = mkdtempSync(join(tmpdir(), "nodebench-policy-"));
const ownedFiles: string[] = [];
function sourceFile(source: string, suffix = ".ts") {
  const file = join(directory, "case-" + ownedFiles.length + suffix);
  writeFileSync(file, source, { flag: "wx" });
  ownedFiles.push(file);
  return file;
}
afterAll(() => {
  for (const file of ownedFiles) if (existsSync(file)) unlinkSync(file);
  rmdirSync(directory);
});

const oldKey = 'const key = `${item.label}|${item.href ?? ""}`;';
const newKey = 'const key = JSON.stringify([item.label, item.href ?? ""]);';
const oldPolicy = sourceFile(current.replace(newKey, oldKey));
const candidate = sourceFile(current);

describe("An engineer measures a research-policy repair against frozen cases", () => {
  it("observes the real loss before the repair, fixes it, and preserves every passing assertion", async () => {
    const report = await comparePolicies(oldPolicy, candidate);
    expect(report.verdict).toBe("policy-improved");
    expect(report.counts).toEqual({
      cases: 11,
      checks: 121,
      baselinePassed: 119,
      candidatePassed: 121,
    });
    expect(report.fixed).toEqual([
      "distinct-source-tuples.evidence",
      "sustained-review.evidence",
    ]);
    expect(report.regressions).toEqual([]);
    expect(report.candidateAllChecksPassed).toBe(true);
    expect(report.identity.baseline.sha256).not.toBe(
      report.identity.candidate.sha256,
    );
    expect(report.identity.fixturesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.agentExecuted).toBe(false);
    expect(report.modelExecuted).toBe(false);
    expect(report.releaseEligible).toBe(false);
    expect(report.acceptedBaselineChanged).toBe(false);
    const raw = report.candidate.raw as Array<{
      caseId: string;
      observations: Array<{ merged: { evidenceBundle: unknown[] } }>;
    }>;
    expect(
      raw.find((row) => row.caseId === "archive-burst")!.observations[0].merged
        .evidenceBundle,
    ).toHaveLength(128);
    const sustained = raw.find(
      (row) => row.caseId === "sustained-review",
    )!.observations;
    expect(sustained).toHaveLength(128);
    expect(
      sustained.every((row) => row.merged.evidenceBundle.length === 3),
    ).toBe(true);
  });

  it("does not call identical code an improvement, and detects reintroducing the old source loss", async () => {
    expect((await comparePolicies(candidate, candidate)).verdict).toBe(
      "equivalent",
    );
    const regression = await comparePolicies(candidate, oldPolicy);
    expect(regression.verdict).toBe("regressed");
    expect(regression.regressions).toEqual([
      "distinct-source-tuples.evidence",
      "sustained-review.evidence",
    ]);
  });

  it("ignores a candidate's claimed certificate and detects state that leaks during sustained reviews", async () => {
    const claiming = sourceFile(
      current +
        "\nexport const certificate = { score: 1, measured: true, releaseEligible: true };\n",
    );
    const claimReport = await comparePolicies(candidate, claiming);
    expect(claimReport.verdict).toBe("equivalent");
    expect(claimReport.releaseEligible).toBe(false);
    const leaky = sourceFile(
      "let calls = 0;\n" +
        current.replace(
          "  if (input.operatorRequested) {",
          "  if (++calls > 16) return { trigger: false, reason: null };\n  if (input.operatorRequested) {",
        ),
    );
    const report = await comparePolicies(candidate, leaky);
    expect(report.verdict).toBe("regressed");
    expect(report.regressions).toContain("sustained-review.trigger");
  });

  it("keeps four burst comparisons independent and rejects additional simultaneous admission", async () => {
    const pending = Array.from({ length: 4 }, () =>
      comparePolicies(candidate, candidate),
    );
    await expect(comparePolicies(candidate, candidate)).rejects.toThrow(
      "four policy comparisons",
    );
    const reports = await Promise.all(pending);
    expect(new Set(reports.map((report) => report.runId)).size).toBe(4);
    expect(
      new Set(reports.map((report) => report.identity.fixturesSha256)).size,
    ).toBe(1);
    expect(reports.every((report) => report.verdict === "equivalent")).toBe(
      true,
    );
  });

  it("fails on missing, oversized, changed or dependent source without substituting the host", async () => {
    await expect(
      comparePolicies(candidate, join(directory, "absent.ts")),
    ).rejects.toThrow();
    await expect(
      comparePolicies(candidate, sourceFile(" ".repeat(65537))),
    ).rejects.toThrow("oversized");
    await expect(
      comparePolicies(candidate, sourceFile('import "node:fs";\n' + current)),
    ).rejects.toThrow("no runtime imports");
    const mutable = sourceFile(current);
    const pending = comparePolicies(mutable, candidate);
    writeFileSync(mutable, current + "\n// changed after capture\n");
    await expect(pending).rejects.toThrow("changed during comparison");
  });

  it("reports thrown, malformed and overflowing candidate output as execution failures", async () => {
    await expect(
      comparePolicies(
        candidate,
        sourceFile('throw new Error("stored state unavailable");\n' + current),
      ),
    ).rejects.toThrow("stored state unavailable");
    const malformed = sourceFile(
      current.replace(
        "  if (input.operatorRequested) {",
        "  return null;\n  if (input.operatorRequested) {",
      ),
    );
    await expect(comparePolicies(candidate, malformed)).rejects.toThrow(
      "Policy execution failed",
    );
    const overflow = sourceFile(
      'process.stdout.write("x".repeat(3 * 1024 * 1024));\n' + current,
    );
    await expect(comparePolicies(candidate, overflow)).rejects.toThrow(
      "Policy execution failed",
    );
  });

  it("terminates a nonterminating candidate and releases admission for the next comparison", async () => {
    const started = performance.now();
    await expect(
      comparePolicies(candidate, sourceFile(current + "\nwhile (true) {}\n")),
    ).rejects.toThrow("Policy execution failed");
    expect(performance.now() - started).toBeLessThan(20_000);
    expect((await comparePolicies(candidate, candidate)).verdict).toBe(
      "equivalent",
    );
  }, 25_000);

  it("runs the native CLI, preserves existing receipts, and refuses the retired proposer before writes", async () => {
    const out = join(directory, "cli-report.json");
    ownedFiles.push(out);
    const args = [
      cliFile,
      "--baseline-policy",
      oldPolicy,
      "--candidate-policy",
      candidate,
      "--out",
      out,
    ];
    const stdout = execFileSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(JSON.parse(stdout).verdict).toBe("policy-improved");
    const saved = readFileSync(out, "utf8");
    expect(JSON.parse(saved).identity.candidate.sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(() =>
      execFileSync(process.execPath, args, { stdio: "pipe", timeout: 30_000 }),
    ).toThrow();
    expect(readFileSync(out, "utf8")).toBe(saved);
    await expect(retiredProposer(directory, {} as never, 0)).rejects.toThrow(
      "self-measuring benchmark proposer is retired",
    );
  });
});
