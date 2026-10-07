import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NODEKIT_RUN_GENESIS_HASH,
  buildNodeKitRunEvent,
} from "../../backend/convex/domains/operations/taskManager/nodeKitRunEvents";
import { buildCanonicalNodeKitRunExport } from "../../backend/convex/domains/operations/taskManager/nodeKitRunExport";
import {
  ACTIVEGRAPH_CORPUS_SCENARIOS,
  callNodeBenchGateway,
  collectActiveGraphCorpus,
} from "../nodekit/collectActiveGraphCorpus.mjs";
import { loadActiveGraphCorpus } from "../nodekit/runActiveGraphCorpus.mjs";

describe("ActiveGraph owner-export corpus collector", () => {
  it("collects exactly 20 distinct owner-scoped terminal exports", async () => {
    const root = mkdtempSync(join(tmpdir(), "activegraph-corpus-collector-"));
    const sessions = new Map<string, any>();
    let next = 0;
    const calls: string[] = [];
    const gatewayCall = async ({ fn, args }: any) => {
      calls.push(fn);
      if (fn === "mcpStartExecutionRun") {
        const id = next++;
        const session = {
          sessionId: `session-${id}`,
          traceId: `trace-${id}`,
          publicTraceId: `run-${id}`,
          status: "running",
          startArgs: args,
        };
        sessions.set(session.traceId, session);
        return session;
      }
      if (fn === "exportNodeKitRun") {
        const session = sessions.get(args.traceId);
        const index = Number(session.traceId.split("-")[1]);
        const failed =
          ACTIVEGRAPH_CORPUS_SCENARIOS[index].graphMode === "failed";
        const started = await buildNodeKitRunEvent({
          runId: session.publicTraceId,
          sequence: 0,
          eventType: "run.started",
          recordedAt: 100 + index * 10,
          payload: {
            workflowName: session.startArgs.workflowName,
            sessionType: session.startArgs.type,
            sessionStartedAt: 100 + index * 10,
          },
          previousHash: NODEKIT_RUN_GENESIS_HASH,
        });
        const terminal = await buildNodeKitRunEvent({
          runId: session.publicTraceId,
          sequence: 1,
          eventType: failed ? "run.failed" : "run.completed",
          recordedAt: 101 + index * 10,
          payload: { status: failed ? "error" : "completed" },
          previousHash: started.contentHash,
        });
        return buildCanonicalNodeKitRunExport({
          sessionId: session.sessionId,
          traceId: session.traceId,
          events: [started, terminal],
        });
      }
      return null;
    };

    const result = await collectActiveGraphCorpus({
      gatewayUrl: "https://example.convex.site/api/mcpGateway",
      mcpSecret: "not-used-by-injected-test-gateway",
      outputDirectory: join(root, "corpus"),
      gatewayCall,
    });

    expect(result.corpusSize).toBe(20);
    expect(calls.filter((name) => name === "exportNodeKitRun")).toHaveLength(
      20,
    );
    expect(
      calls.filter((name) => name === "mcpStartExecutionRun"),
    ).toHaveLength(20);
    expect(loadActiveGraphCorpus(result.manifestPath).entries).toHaveLength(20);
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(
      new Set(manifest.exports.map((entry: any) => entry.label)).size,
    ).toBe(20);
  });

  it("rejects non-allowlisted gateway hosts before fetch", async () => {
    let called = false;
    await expect(
      callNodeBenchGateway({
        gatewayUrl: "https://169.254.169.254/api/mcpGateway",
        mcpSecret: "a".repeat(32),
        fn: "exportNodeKitRun",
        args: { traceId: "trace" },
        fetchImpl: async () => {
          called = true;
          throw new Error("must not fetch");
        },
      }),
    ).rejects.toThrow(/gateway_url_invalid/);
    expect(called).toBe(false);
  });

  it("terminalizes a partially created run when collection fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "activegraph-corpus-failure-"));
    const calls: string[] = [];
    const gatewayCall = async ({ fn }: any) => {
      calls.push(fn);
      if (fn === "mcpStartExecutionRun") {
        return {
          sessionId: "session-partial",
          traceId: "trace-partial",
          publicTraceId: "run-partial",
          status: "running",
        };
      }
      if (fn === "recordStep") throw new Error("synthetic failure");
      return null;
    };

    await expect(
      collectActiveGraphCorpus({
        gatewayUrl: "https://example.convex.site/api/mcpGateway",
        mcpSecret: "not-used-by-injected-test-gateway",
        outputDirectory: join(root, "corpus"),
        gatewayCall,
      }),
    ).rejects.toThrow(/synthetic failure/);
    expect(calls).toContain("completeTrace");
    expect(calls).toContain("updateSessionStatus");
    expect(calls).not.toContain("exportNodeKitRun");
  });
});
