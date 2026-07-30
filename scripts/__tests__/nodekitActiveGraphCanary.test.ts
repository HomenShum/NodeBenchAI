import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  assertCanonicalNodeKitRunExport,
  buildOfflineCanaryEnvironment,
  computeActiveGraphBuildInputsHash,
  createActiveGraphImageAttestation,
  imageLabelsForActiveGraphAttestation,
  readNodeBenchCandidateCommit,
  runActiveGraphCanaryFromExport,
} from "../nodekit/runActiveGraphCanary.mjs";
import {
  NODEKIT_RUN_GENESIS_HASH,
  buildNodeKitRunEvent,
  canonicalNodeKitJson,
} from "../../backend/convex/domains/operations/taskManager/nodeKitRunEvents";
import { buildCanonicalNodeKitRunExport } from "../../backend/convex/domains/operations/taskManager/nodeKitRunExport";
import { buildNodeKitNativeSessionIdentity } from "../../backend/convex/domains/operations/taskManager/nodeKitRuntimeIdentity";

const hashBytes = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const canonicalHash = (value: unknown) =>
  `sha256:${createHash("sha256")
    .update(canonicalNodeKitJson(value), "utf8")
    .digest("hex")}`;
const repoRoot = resolve(import.meta.dirname, "../..");
const SANDBOX_IMAGE = `sha256:${"a".repeat(64)}`;
const NODEBENCH_CANDIDATE_COMMIT = readNodeBenchCandidateCommit();

function writeImageAttestation(root: string, image = SANDBOX_IMAGE) {
  const path = join(root, "activegraph-image-attestation.json");
  const attestation = createActiveGraphImageAttestation({
    sandboxImage: image,
    nodebenchCandidateCommit: NODEBENCH_CANDIDATE_COMMIT,
  });
  writeFileSync(path, `${JSON.stringify(attestation)}\n`, "utf8");
  return { path, attestation };
}

function withAttestedImage(
  attestation: ReturnType<typeof createActiveGraphImageAttestation>,
  runImpl: (...args: any[]) => any,
) {
  return vi.fn(
    (executable: string, args: readonly string[], options: unknown) => {
      if (args[0] === "image" && args[1] === "inspect") {
        return {
          status: 0,
          stdout: `${JSON.stringify(
            imageLabelsForActiveGraphAttestation(attestation),
          )}\n`,
          stderr: "",
        };
      }
      return runImpl(executable, args, options);
    },
  );
}

function listTypeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptSources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

async function writeValidExport(path: string) {
  const runId = "trace_disposable_copy_test";
  const nativeIdentity = await buildNodeKitNativeSessionIdentity({
    identityRef: "nodebench:agent-identity:fixture-agent",
    agentId: "codex.fixture",
    workspaceId: "workspace:activegraph-canary",
    nativeSessionId: "session:representative-stage-local-run",
    nativeSessionGeneration: 1,
    peerId: "peer:runner:fixture",
  });
  const started = await buildNodeKitRunEvent({
    runId,
    sequence: 0,
    eventType: "run.started",
    recordedAt: 10,
    payload: {
      workflowName: "offline-copy-test",
      sessionType: "agent",
      sessionStartedAt: 5,
      identityRef: nativeIdentity.identityRef,
      workspaceId: nativeIdentity.workspaceId,
      agentId: nativeIdentity.agentId,
      nativeSessionId: nativeIdentity.nativeSessionId,
      nativeSessionGeneration: nativeIdentity.nativeSessionGeneration,
      peerId: nativeIdentity.peerId,
      identitySnapshotHash: nativeIdentity.snapshotHash,
    },
    previousHash: NODEKIT_RUN_GENESIS_HASH,
  });
  const graph = {
    graphId: `execution-graph:sha256:${"a".repeat(64)}`,
    graphHash: "b".repeat(64),
    caseId: "case:representative-canary",
    stageId: "build",
    caseContentHash: "c".repeat(64),
    nodeId: "node:build-candidate",
    nodeRunId: "node-run:build-candidate:1",
  };
  const nodeStarted = await buildNodeKitRunEvent({
    runId,
    sequence: 1,
    eventType: "node.started",
    recordedAt: 11,
    payload: {
      ...graph,
      nodeKind: "task",
      frontierHash: "d".repeat(64),
    },
    previousHash: started.contentHash,
  });
  const edgeConsumed = await buildNodeKitRunEvent({
    runId,
    sequence: 2,
    eventType: "edge.consumed",
    recordedAt: 12,
    payload: {
      ...graph,
      edgeId: "edge:research-to-build",
      bindingId: `execution-edge-binding:sha256:${"e".repeat(64)}`,
      bindingHash: "f".repeat(64),
      artifactId: "artifact:research-pack",
      artifactSchemaVersion: "nodekit.research-pack/v1",
      artifactContentHash: "1".repeat(64),
      authorityKind: "deterministic",
    },
    previousHash: nodeStarted.contentHash,
  });
  const artifactProduced = await buildNodeKitRunEvent({
    runId,
    sequence: 3,
    eventType: "artifact.produced",
    recordedAt: 13,
    payload: {
      ...graph,
      artifactId: "artifact:build-candidate",
      artifactSchemaVersion: "nodekit.build-candidate/v1",
      artifactContentHash: "2".repeat(64),
      authorityKind: "agent-produced",
    },
    previousHash: edgeConsumed.contentHash,
  });
  const nodeCompleted = await buildNodeKitRunEvent({
    runId,
    sequence: 4,
    eventType: "node.completed",
    recordedAt: 14,
    payload: { ...graph, status: "completed" },
    previousHash: artifactProduced.contentHash,
  });
  const completed = await buildNodeKitRunEvent({
    runId,
    sequence: 5,
    eventType: "run.completed",
    recordedAt: 20,
    payload: { status: "completed" },
    previousHash: nodeCompleted.contentHash,
  });
  const exportDoc = await buildCanonicalNodeKitRunExport({
    sessionId: "session-copy-test",
    traceId: "trace-record-copy-test",
    events: [
      started,
      nodeStarted,
      edgeConsumed,
      artifactProduced,
      nodeCompleted,
      completed,
    ],
  });
  writeFileSync(path, `${JSON.stringify(exportDoc)}\n`, "utf8");
  return exportDoc;
}

function rehashExport(document: any) {
  let previousHash = NODEKIT_RUN_GENESIS_HASH;
  for (const event of document.events) {
    event.previousHash = previousHash;
    event.contentHash = canonicalHash({
      contractVersion: event.contractVersion,
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      recordedAt: event.recordedAt,
      payload: event.payload,
      previousHash: event.previousHash,
    });
    previousHash = event.contentHash;
  }
  document.hashes.chainHead = previousHash;
  document.hashes.exportHash = canonicalHash({
    ...document,
    hashes: {
      algorithm: "sha256",
      chainHead: previousHash,
    },
  });
}

describe("NodeKit -> ActiveGraph offline boundary", () => {
  it("hashes the exact ActiveGraph build inputs deterministically", () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-build-hash-"));
    mkdirSync(join(root, "src", "nodebench_activegraph_canary"), {
      recursive: true,
    });
    writeFileSync(join(root, ".dockerignore"), "*\n!src/\n", "utf8");
    writeFileSync(join(root, "Dockerfile"), "FROM scratch\n", "utf8");
    writeFileSync(
      join(root, "requirements.in"),
      "activegraph==1.10.0\n",
      "utf8",
    );
    writeFileSync(join(root, "UPSTREAM.json"), "{}\n", "utf8");
    const source = join(
      root,
      "src",
      "nodebench_activegraph_canary",
      "runtime.py",
    );
    writeFileSync(source, "VALUE = 1\n", "utf8");

    const first = computeActiveGraphBuildInputsHash(root);
    expect(computeActiveGraphBuildInputsHash(root)).toBe(first);
    writeFileSync(source, "VALUE = 2\n", "utf8");
    expect(computeActiveGraphBuildInputsHash(root)).not.toBe(first);
  });

  it("keeps owned trace creators canonical and limits deletion to retention", () => {
    const backendRoot = resolve(repoRoot, "backend", "convex");
    const sources = listTypeScriptSources(backendRoot).map((path) => ({
      path,
      relativePath: relative(repoRoot, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    }));
    const directTraceCreators = sources
      .filter(({ source }) => source.includes('insert("agentTaskTraces"'))
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(directTraceCreators).toEqual([
      "backend/convex/domains/mcp/mcpExecutionTraceEndpoints.ts",
      "backend/convex/domains/operations/taskManager/mutations.ts",
      "backend/convex/workflows/endToEndQa.ts",
    ]);
    const ownedTraceCreators = [
      "backend/convex/domains/mcp/mcpExecutionTraceEndpoints.ts",
      "backend/convex/domains/operations/taskManager/mutations.ts",
    ];
    for (const creator of ownedTraceCreators) {
      const source = sources.find(
        ({ relativePath }) => relativePath === creator,
      )?.source;
      expect(source).toContain("appendNodeKitRunEvent");
      expect(source).toContain('"run.started"');
    }

    const eventPatches = sources.flatMap(({ relativePath, source }) =>
      /\bpatch\(\s*["']nodeKitRunEvents["']/.test(source) ? [relativePath] : [],
    );
    expect(eventPatches).toEqual([]);
    const eventDeletes = sources.flatMap(({ relativePath, source }) =>
      /ctx\.db\.delete\(event\._id\)/.test(source) &&
      source.includes('"nodeKitRunEvents"')
        ? [relativePath]
        : [],
    );
    expect(eventDeletes).toEqual([
      "backend/convex/domains/operations/taskManager/nodeKitRunRetention.ts",
    ]);

    const exportSource = readFileSync(
      resolve(
        backendRoot,
        "domains",
        "operations",
        "taskManager",
        "nodeKitRunExport.ts",
      ),
      "utf8",
    );
    expect(exportSource).toContain(
      "const ownerId = await requireOwnerId(ctx);",
    );
    expect(exportSource).toContain("session.userId !== ownerId");
    expect(exportSource).toContain('"run_history_unavailable"');
    expect(exportSource).toContain(".take(NODEKIT_RUN_MAX_EVENTS + 1)");
    expect(exportSource).toContain("new ConvexError");
    const retentionSource = readFileSync(
      resolve(
        backendRoot,
        "domains",
        "operations",
        "taskManager",
        "nodeKitRunRetention.ts",
      ),
      "utf8",
    );
    expect(retentionSource).toContain("session.userId !== ownerId");
    expect(retentionSource).toContain('trace.status === "running"');
    expect(retentionSource).toContain('"by_type_retention_expiration"');
    expect(retentionSource).toContain("terminal.retentionExpiresAt > now");
    expect(retentionSource).toContain("for (const event of traceEvents)");
    expect(readFileSync(resolve(backendRoot, "crons.ts"), "utf8")).toContain(
      '"nodekit run-event retention"',
    );
  });

  it("stages a disposable copy, scrubs production credentials, and never mutates the source export", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-"));
    const sourceDir = join(root, "source");
    const evidenceRoot = join(root, "evidence");
    mkdirSync(sourceDir);
    const exportPath = join(sourceDir, "run-export.json");
    const exportDoc = await writeValidExport(exportPath);
    const beforeBytes = readFileSync(exportPath);
    const { path: imageAttestationPath, attestation } =
      writeImageAttestation(root);

    const spawnSyncImpl = withAttestedImage(
      attestation,
      (
        executable: string,
        args: readonly string[],
        options: {
          env: NodeJS.ProcessEnv;
          timeout?: number;
          maxBuffer?: number;
        },
      ) => {
        const outputPath = join(evidenceRoot, "fixed-run", "report.json");
        const dbPath = join(evidenceRoot, "fixed-run", "activegraph.sqlite3");
        writeFileSync(
          outputPath,
          `${JSON.stringify({
            schema_version: "nodebench.activegraph.nodekit-replay-output.v1",
            activegraph: {
              version: "1.10.0",
              release_commit: "148e12c2969f18fa12a1a3c2e75f3affd9aa0616",
              annotated_tag_object: "3fbcd8fc56a45ae68622d4e2b18a6d5844180527",
              inspected_ref: "8aedb1866cf5dce056af97529152ffd6f468a1ed",
            },
            isolation: {
              runtime: "docker",
              image: SANDBOX_IMAGE,
              network: "none",
              rootFilesystem: "read-only",
              writableMount: "/evidence",
              buildInputsHash: attestation.buildInputsHash,
              nodebenchCandidateCommit: attestation.nodebenchCandidateCommit,
              upstreamHash: attestation.upstreamHash,
              imageAttestationHash: attestation.attestationHash,
            },
            mode: "offline-observer",
            run_id: exportDoc.runId,
            input_export_sha256: exportDoc.hashes.exportHash,
            event_count: exportDoc.events.length,
            nodekit_chain_head: exportDoc.hashes.chainHead,
            replayed_events_sha256: `sha256:${createHash("sha256")
              .update(canonicalNodeKitJson(exportDoc.events), "utf8")
              .digest("hex")}`,
            persisted_reload_parity: true,
            verdict: "pass",
            limitations: ["offline observer only"],
          })}\n`,
          "utf8",
        );
        writeFileSync(
          dbPath,
          Buffer.concat([
            Buffer.from("SQLite format 3\u0000", "binary"),
            Buffer.alloc(128),
          ]),
        );
        expect(executable).toBe("docker");
        expect(args).toEqual(
          expect.arrayContaining([
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            SANDBOX_IMAGE,
          ]),
        );
        expect(options.env.CONVEX_URL).toBeUndefined();
        expect(options.env.CONVEX_SITE_URL).toBeUndefined();
        expect(options.env.MCP_SECRET).toBeUndefined();
        expect(options.env.GEMINI_API_KEY).toBeUndefined();
        expect(options.env.OPENAI_API_KEY).toBeUndefined();
        expect(options.timeout).toBe(120_000);
        expect(options.maxBuffer).toBe(1024 * 1024);
        return { status: 0, stdout: "", stderr: "" };
      },
    );

    const result = await runActiveGraphCanaryFromExport({
      exportPath,
      evidenceRoot,
      runDirectoryName: "fixed-run",
      sandboxImage: SANDBOX_IMAGE,
      imageAttestationPath,
      spawnSyncImpl,
      _testOnlyAllowDirtyBuildInputs: true,
      sourceEnvironment: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        CONVEX_URL: "https://prod.invalid",
        CONVEX_SITE_URL: "https://prod.invalid",
        MCP_SECRET: "must-not-cross",
        GEMINI_API_KEY: "must-not-cross",
        OPENAI_API_KEY: "must-not-cross",
      },
    });

    expect(spawnSyncImpl).toHaveBeenCalledTimes(2);
    expect(hashBytes(readFileSync(exportPath))).toBe(hashBytes(beforeBytes));
    expect(readFileSync(exportPath)).toEqual(beforeBytes);
    expect(
      resolve(result.stagedExportPath).startsWith(resolve(evidenceRoot)),
    ).toBe(true);
    expect(result.stagedExportPath).not.toBe(resolve(exportPath));
    expect(JSON.parse(readFileSync(result.stagedExportPath, "utf8"))).toEqual(
      exportDoc,
    );
    expect(result.report.verdict).toBe("pass");
    expect(result.report.input_export_sha256).toBe(exportDoc.hashes.exportHash);
    expect(readdirSync(join(evidenceRoot, "fixed-run")).sort()).toEqual([
      "activegraph.sqlite3",
      "nodekit-run-export.json",
      "report.json",
    ]);
  });

  it("requires an immutable sandbox image before creating evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-sandbox-"));
    const exportPath = join(root, "run-export.json");
    await writeValidExport(exportPath);
    const evidenceRoot = join(root, "evidence");
    const spawnSyncImpl = vi.fn();

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "must-not-exist",
        spawnSyncImpl,
      }),
    ).rejects.toThrow(/sandbox_image_required/);

    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(() => readdirSync(evidenceRoot)).toThrow();
  });

  it("rejects an immutable digest without its exact build attestation and image labels", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "nodekit-activegraph-attestation-"),
    );
    const exportPath = join(root, "run-export.json");
    await writeValidExport(exportPath);
    const evidenceRoot = join(root, "evidence");
    const noInspect = vi.fn();

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "must-not-exist",
        sandboxImage: SANDBOX_IMAGE,
        spawnSyncImpl: noInspect,
        _testOnlyAllowDirtyBuildInputs: true,
      }),
    ).rejects.toThrow(/image_attestation_required/);
    expect(noInspect).not.toHaveBeenCalled();

    const { path: imageAttestationPath } = writeImageAttestation(root);
    const wrongLabels = vi.fn(() => ({
      status: 0,
      stdout: "{}",
      stderr: "",
    }));
    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "must-not-exist",
        sandboxImage: SANDBOX_IMAGE,
        imageAttestationPath,
        spawnSyncImpl: wrongLabels,
        _testOnlyAllowDirtyBuildInputs: true,
      }),
    ).rejects.toThrow(/image_label_mismatch/);
    expect(wrongLabels).toHaveBeenCalledTimes(1);
    expect(() => readdirSync(evidenceRoot)).toThrow();
  });

  it.each([
    ["run.completed", "completed", "error"],
    ["run.failed", "error", "completed"],
  ] as const)(
    "rejects %s with contradictory status %s/%s before replay",
    async (terminalType, traceStatus, payloadStatus) => {
      const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-terminal-"));
      const exportPath = join(root, "run-export.json");
      const source = await writeValidExport(exportPath);
      const document: any = structuredClone(source);
      document.events.at(-1).eventType = terminalType;
      document.events.at(-1).payload.fields.status = payloadStatus;
      document.trace.status = traceStatus;
      document.completeness.terminalEventType = terminalType;
      rehashExport(document);

      expect(() => assertCanonicalNodeKitRunExport(document)).toThrow(
        /terminal_status_mismatch/,
      );
    },
  );

  it("rejects a hash-valid backward event timestamp before replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-time-"));
    const exportPath = join(root, "run-export.json");
    const source = await writeValidExport(exportPath);
    const document: any = structuredClone(source);
    const evidence = await buildNodeKitRunEvent({
      runId: document.runId,
      sequence: 1,
      eventType: "evidence.attached",
      recordedAt: document.events[0].recordedAt - 1,
      payload: {},
      previousHash: document.events[0].contentHash,
    });
    const terminal = await buildNodeKitRunEvent({
      runId: document.runId,
      sequence: 2,
      eventType: "run.completed",
      recordedAt: document.trace.endedAt,
      payload: { status: "completed" },
      previousHash: evidence.contentHash,
    });
    document.events = [
      document.events[0],
      structuredClone(evidence),
      structuredClone(terminal),
    ];
    document.completeness.eventCount = 3;
    document.completeness.lastSequence = 2;
    rehashExport(document);

    expect(() => assertCanonicalNodeKitRunExport(document)).toThrow(
      /recorded_at_not_monotonic/,
    );
  });

  it("rejects an oversized source export before creating evidence or spawning", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "nodekit-activegraph-source-bound-"),
    );
    const exportPath = join(root, "run-export.json");
    await writeValidExport(exportPath);
    appendFileSync(exportPath, " ".repeat(1024 * 1024), "utf8");
    const evidenceRoot = join(root, "evidence");
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "must-not-exist",
        sandboxImage: SANDBOX_IMAGE,
        spawnSyncImpl,
      }),
    ).rejects.toThrow(/export_too_large/);

    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(() => readdirSync(evidenceRoot)).toThrow();
  });

  it("rejects extra sandbox artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-artifacts-"));
    const exportPath = join(root, "run-export.json");
    const exportDoc = await writeValidExport(exportPath);
    const evidenceRoot = join(root, "evidence");
    const runDirectory = join(evidenceRoot, "artifact-run");
    const { path: imageAttestationPath, attestation } =
      writeImageAttestation(root);
    const spawnSyncImpl = withAttestedImage(attestation, () => {
      writeFileSync(
        join(runDirectory, "report.json"),
        JSON.stringify({
          schema_version: "nodebench.activegraph.nodekit-replay-output.v1",
          activegraph: {
            version: "1.10.0",
            release_commit: "148e12c2969f18fa12a1a3c2e75f3affd9aa0616",
            annotated_tag_object: "3fbcd8fc56a45ae68622d4e2b18a6d5844180527",
            inspected_ref: "8aedb1866cf5dce056af97529152ffd6f468a1ed",
          },
          isolation: {
            runtime: "docker",
            image: SANDBOX_IMAGE,
            network: "none",
            rootFilesystem: "read-only",
            writableMount: "/evidence",
            buildInputsHash: attestation.buildInputsHash,
            nodebenchCandidateCommit: attestation.nodebenchCandidateCommit,
            upstreamHash: attestation.upstreamHash,
            imageAttestationHash: attestation.attestationHash,
          },
          mode: "offline-observer",
          run_id: exportDoc.runId,
          input_export_sha256: exportDoc.hashes.exportHash,
          event_count: exportDoc.events.length,
          nodekit_chain_head: exportDoc.hashes.chainHead,
          replayed_events_sha256: `sha256:${createHash("sha256")
            .update(canonicalNodeKitJson(exportDoc.events), "utf8")
            .digest("hex")}`,
          persisted_reload_parity: true,
          verdict: "pass",
          limitations: ["offline observer only"],
        }),
        "utf8",
      );
      writeFileSync(
        join(runDirectory, "activegraph.sqlite3"),
        Buffer.concat([
          Buffer.from("SQLite format 3\u0000", "binary"),
          Buffer.alloc(128),
        ]),
      );
      writeFileSync(join(runDirectory, "unexpected.txt"), "not allowed");
      return { status: 0, stdout: "", stderr: "" };
    });

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "artifact-run",
        sandboxImage: SANDBOX_IMAGE,
        imageAttestationPath,
        spawnSyncImpl,
        _testOnlyAllowDirtyBuildInputs: true,
      }),
    ).rejects.toThrow(/artifact_set_invalid/);
  });

  it.each([
    {
      label: "report",
      mutate: (runDirectory: string) => {
        appendFileSync(
          join(runDirectory, "report.json"),
          " ".repeat(64 * 1024),
          "utf8",
        );
      },
    },
    {
      label: "SQLite database",
      mutate: (runDirectory: string) => {
        truncateSync(
          join(runDirectory, "activegraph.sqlite3"),
          64 * 1024 * 1024 + 1,
        );
      },
    },
  ])("rejects an oversized $label artifact", async ({ mutate }) => {
    const root = mkdtempSync(
      join(tmpdir(), "nodekit-activegraph-output-bound-"),
    );
    const exportPath = join(root, "run-export.json");
    const exportDoc = await writeValidExport(exportPath);
    const evidenceRoot = join(root, "evidence");
    const runDirectory = join(evidenceRoot, "oversized-run");
    const { path: imageAttestationPath, attestation } =
      writeImageAttestation(root);
    const spawnSyncImpl = withAttestedImage(attestation, () => {
      writeFileSync(
        join(runDirectory, "report.json"),
        JSON.stringify({
          schema_version: "nodebench.activegraph.nodekit-replay-output.v1",
          activegraph: {
            version: "1.10.0",
            release_commit: "148e12c2969f18fa12a1a3c2e75f3affd9aa0616",
            annotated_tag_object: "3fbcd8fc56a45ae68622d4e2b18a6d5844180527",
            inspected_ref: "8aedb1866cf5dce056af97529152ffd6f468a1ed",
          },
          isolation: {
            runtime: "docker",
            image: SANDBOX_IMAGE,
            network: "none",
            rootFilesystem: "read-only",
            writableMount: "/evidence",
            buildInputsHash: attestation.buildInputsHash,
            nodebenchCandidateCommit: attestation.nodebenchCandidateCommit,
            upstreamHash: attestation.upstreamHash,
            imageAttestationHash: attestation.attestationHash,
          },
          mode: "offline-observer",
          run_id: exportDoc.runId,
          input_export_sha256: exportDoc.hashes.exportHash,
          event_count: exportDoc.events.length,
          nodekit_chain_head: exportDoc.hashes.chainHead,
          replayed_events_sha256: `sha256:${createHash("sha256")
            .update(canonicalNodeKitJson(exportDoc.events), "utf8")
            .digest("hex")}`,
          persisted_reload_parity: true,
          verdict: "pass",
          limitations: ["offline observer only"],
        }),
        "utf8",
      );
      writeFileSync(
        join(runDirectory, "activegraph.sqlite3"),
        Buffer.concat([
          Buffer.from("SQLite format 3\u0000", "binary"),
          Buffer.alloc(128),
        ]),
      );
      mutate(runDirectory);
      return { status: 0, stdout: "", stderr: "" };
    });

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "oversized-run",
        sandboxImage: SANDBOX_IMAGE,
        imageAttestationPath,
        spawnSyncImpl,
        _testOnlyAllowDirtyBuildInputs: true,
      }),
    ).rejects.toThrow(/artifact_too_large/);
  });

  it("fails before creating evidence or spawning when the source export is tampered", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-invalid-"));
    const exportPath = join(root, "run-export.json");
    const exportDoc = await writeValidExport(exportPath);
    writeFileSync(
      exportPath,
      `${JSON.stringify({
        ...exportDoc,
        trace: { ...exportDoc.trace, id: "tampered" },
      })}\n`,
      "utf8",
    );
    const evidenceRoot = join(root, "evidence");
    const spawnSyncImpl = vi.fn();

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "must-not-exist",
        spawnSyncImpl,
      }),
    ).rejects.toThrow(/export_hash_mismatch/);

    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(() => readdirSync(evidenceRoot)).toThrow();
  });

  it("rejects unexpected contract fields before creating evidence or spawning", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-shape-"));
    const exportPath = join(root, "run-export.json");
    const exportDoc = await writeValidExport(exportPath);
    writeFileSync(
      exportPath,
      `${JSON.stringify({
        ...exportDoc,
        trace: { ...exportDoc.trace, reconstructedSummary: "not canonical" },
      })}\n`,
      "utf8",
    );
    const evidenceRoot = join(root, "evidence");
    const spawnSyncImpl = vi.fn();

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "must-not-exist",
        spawnSyncImpl,
      }),
    ).rejects.toThrow(/shape_invalid/);

    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(() => readdirSync(evidenceRoot)).toThrow();
  });

  it("fails closed on a nonzero canary exit and never reuses an evidence directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-fail-"));
    const exportPath = join(root, "run-export.json");
    await writeValidExport(exportPath);
    const evidenceRoot = join(root, "evidence");
    const { path: imageAttestationPath, attestation } =
      writeImageAttestation(root);
    const spawnSyncImpl = withAttestedImage(attestation, () => ({
      status: 2,
      stdout: "",
      stderr: "canary verdict failed",
    }));

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "failed-run",
        sandboxImage: SANDBOX_IMAGE,
        imageAttestationPath,
        spawnSyncImpl,
        _testOnlyAllowDirtyBuildInputs: true,
      }),
    ).rejects.toThrow(/ActiveGraph canary exited with code 2/);

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "failed-run",
        sandboxImage: SANDBOX_IMAGE,
        imageAttestationPath,
        spawnSyncImpl,
        _testOnlyAllowDirtyBuildInputs: true,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("reports a bounded child timeout as a typed failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodekit-activegraph-timeout-"));
    const exportPath = join(root, "run-export.json");
    await writeValidExport(exportPath);
    const evidenceRoot = join(root, "evidence");
    const { path: imageAttestationPath, attestation } =
      writeImageAttestation(root);
    const timeoutError = Object.assign(new Error("timed out"), {
      code: "ETIMEDOUT",
    });
    const spawnSyncImpl = withAttestedImage(attestation, () => ({
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      error: timeoutError,
    }));

    await expect(
      runActiveGraphCanaryFromExport({
        exportPath,
        evidenceRoot,
        runDirectoryName: "timeout-run",
        sandboxImage: SANDBOX_IMAGE,
        imageAttestationPath,
        spawnSyncImpl,
        _testOnlyAllowDirtyBuildInputs: true,
      }),
    ).rejects.toThrow(/canary_timeout/);
  });

  it("whitelists only process mechanics needed by the offline child", () => {
    const env = buildOfflineCanaryEnvironment({
      PATH: "path",
      Path: "windows-path",
      SystemRoot: "C:\\Windows",
      TEMP: "temp",
      TMP: "tmp",
      PYTHONPATH: "caller-pythonpath",
      CONVEX_DEPLOY_KEY: "secret",
      VITE_CONVEX_URL: "secret",
      MCP_HTTP_TOKEN: "secret",
      ANTHROPIC_API_KEY: "secret",
    });

    expect(env).toMatchObject({
      PATH: "path",
      Path: "windows-path",
      SystemRoot: "C:\\Windows",
      TEMP: "temp",
      TMP: "tmp",
      NODEBENCH_ACTIVEGRAPH_MODE: "offline-observer",
      PYTHONIOENCODING: "utf-8",
    });
    expect(Object.keys(env).sort()).not.toEqual(
      expect.arrayContaining([
        "CONVEX_DEPLOY_KEY",
        "VITE_CONVEX_URL",
        "MCP_HTTP_TOKEN",
        "ANTHROPIC_API_KEY",
      ]),
    );
    expect(env.PYTHONPATH).toBeUndefined();
  });
});
