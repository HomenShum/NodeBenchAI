import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NODEKIT_RUN_GENESIS_HASH,
  buildNodeKitRunEvent,
} from "../../backend/convex/domains/operations/taskManager/nodeKitRunEvents";
import { buildCanonicalNodeKitRunExport } from "../../backend/convex/domains/operations/taskManager/nodeKitRunExport";
import {
  ACTIVEGRAPH_CORPUS_SCHEMA,
  loadActiveGraphCorpus,
  runActiveGraphCorpus,
} from "../nodekit/runActiveGraphCorpus.mjs";

async function writeCorpus(count = 20) {
  const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-corpus-"));
  const inputs = join(root, "inputs");
  mkdirSync(inputs);
  const exports = [];
  for (let index = 0; index < count; index += 1) {
    const runId = `run-corpus-${index}`;
    const started = await buildNodeKitRunEvent({
      runId,
      sequence: 0,
      eventType: "run.started",
      recordedAt: 100 + index * 10,
      payload: {
        workflowName: `Corpus workflow ${index}`,
        sessionType: "agent",
        sessionStartedAt: 100 + index * 10,
      },
      previousHash: NODEKIT_RUN_GENESIS_HASH,
    });
    const completed = await buildNodeKitRunEvent({
      runId,
      sequence: 1,
      eventType: "run.completed",
      recordedAt: 101 + index * 10,
      payload: { status: "completed" },
      previousHash: started.contentHash,
    });
    const document = await buildCanonicalNodeKitRunExport({
      sessionId: `session-${index}`,
      traceId: `trace-${index}`,
      events: [started, completed],
    });
    const inputFile = `inputs/export-${index}.json`;
    writeFileSync(join(root, inputFile), JSON.stringify(document));
    exports.push({
      label: `scenario-${String(index).padStart(2, "0")}`,
      inputFile,
      workflowClass: "scenario",
      terminalStatus: "completed",
    });
  }
  const manifestPath = join(root, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: ACTIVEGRAPH_CORPUS_SCHEMA,
      collectedAt: "2026-07-29T20:00:00.000Z",
      source: {
        kind: "nodebench-production",
        gatewayFunction: "exportNodeKitRun",
        authorization: "gateway-injected-owner",
      },
      exports,
    }),
  );
  return { root, manifestPath };
}

describe("ActiveGraph owner-export corpus", () => {
  it("runs the exact bounded 20-export corpus and rejects adoption when replay adds no explanation", async () => {
    const { root, manifestPath } = await writeCorpus();
    const evidenceRoot = join(root, "evidence");
    const report = await runActiveGraphCorpus({
      manifestPath,
      evidenceRoot,
      sandboxImage: `sha256:${"a".repeat(64)}`,
      imageAttestationPath: join(root, "unused-attestation.json"),
      baselineIterations: 2,
      canaryRunner: async ({ runDirectoryName }: any) => {
        const runDirectory = join(evidenceRoot, runDirectoryName);
        mkdirSync(runDirectory, { recursive: true });
        return {
          runDirectory,
          report: {
            verdict: "pass",
            persisted_reload_parity: true,
          },
        };
      },
    });

    expect(report.corpusSize).toBe(20);
    expect(report.allPersistenceReloadParity).toBe(true);
    expect(report.materialExplanatoryValueObserved).toBe(false);
    expect(report.stopConditions).toContain("no_material_explanatory_value");
    expect(report.adoptionVerdict).toBe("reject");
    expect(report.reportHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed for an undersized corpus or duplicate export", async () => {
    const undersized = await writeCorpus(19);
    expect(() => loadActiveGraphCorpus(undersized.manifestPath)).toThrow(
      /corpus_size_invalid/,
    );

    const duplicated = await writeCorpus();
    const manifest = JSON.parse(readFileSync(duplicated.manifestPath, "utf8"));
    manifest.exports[19].inputFile = manifest.exports[0].inputFile;
    writeFileSync(duplicated.manifestPath, JSON.stringify(manifest));
    expect(() => loadActiveGraphCorpus(duplicated.manifestPath)).toThrow(
      /corpus_duplicate/,
    );
  });

  it("rejects an input path that escapes the authorized corpus directory", async () => {
    const { manifestPath } = await writeCorpus();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.exports[0].inputFile = "../outside.json";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => loadActiveGraphCorpus(manifestPath)).toThrow(/path_escape/);
  });
});
