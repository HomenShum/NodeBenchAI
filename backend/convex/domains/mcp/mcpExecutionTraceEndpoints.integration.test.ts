/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";

const DIR_SEGMENTS = ["domains", "mcp"];
const hash = (character: string) => character.repeat(64);

function rerootGlobKey(key: string): string {
  const parts = key.replace(/^\.\//, "").split("/");
  const base = [...DIR_SEGMENTS];
  while (parts[0] === "..") {
    parts.shift();
    base.pop();
  }
  return [...base, ...parts].join("/");
}

const convexModules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(
    ([key, loader]) => [rerootGlobKey(key), loader],
  ),
);

let convexTest: any;
let convexTestAvailable = false;
try {
  const convexTestModule =
    process.env.NODEBENCH_CONVEX_TEST_MODULE ?? "convex-test";
  const mod = await import(/* @vite-ignore */ convexTestModule);
  convexTest = mod.convexTest;
  convexTestAvailable = typeof convexTest === "function";
} catch {
  convexTestAvailable = false;
}

const traceEndpoints = (internal as any).domains.mcp.mcpExecutionTraceEndpoints;

describe("NodeKit execution trace gateway contract", () => {
  it("keeps graph writes and exports secret-gated with injected ownership", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "backend/convex/domains/mcp/mcpGatewayDispatcher.ts",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /recordExecutionGraphEvent:\s*\{[\s\S]*?recordExecutionGraphEvent,[\s\S]*?type:\s*"mutation",[\s\S]*?injectUserId:\s*true,[\s\S]*?\}/,
    );
    expect(source).not.toMatch(
      /PUBLIC_RESEARCH_GATEWAY_FNS[\s\S]*?recordExecutionGraphEvent/,
    );
    expect(source).toMatch(
      /exportNodeKitRun:\s*\{[\s\S]*?mcpExportNodeKitRun,[\s\S]*?type:\s*"query",[\s\S]*?injectUserId:\s*true,[\s\S]*?\}/,
    );
  });
});

function nativeSessionReference(overrides: Record<string, string> = {}) {
  return {
    workspaceId: `workspace:sha256:${hash("a")}`,
    sessionId: `session:sha256:${hash("b")}`,
    workspaceArtifactRef: `native-workspace:sha256:${hash("c")}`,
    workspaceArtifactDigest: hash("c"),
    sessionArtifactRef: `native-agent-session:sha256:${hash("d")}`,
    sessionArtifactDigest: hash("d"),
    checkpointArtifactRef: `native-session-checkpoint:sha256:${hash("e")}`,
    checkpointArtifactDigest: hash("e"),
    ...overrides,
  };
}

function startArgs(userId: string, reference = nativeSessionReference()) {
  return {
    userId,
    title: "Compile the approved build stage",
    workflowName: "nodekit-stage-local-build",
    type: "agent" as const,
    visibility: "private" as const,
    nativeSessionReference: reference,
  };
}

describe.skipIf(!convexTestAvailable)(
  "NodeKit execution trace canonical references and graph persistence",
  () => {
    it("persists only canonical refs and digests and never creates lifecycle authority", async () => {
      const t = convexTest(schema, convexModules);
      const userId = await t.run((ctx: any) =>
        ctx.db.insert("users", { email: "nodekit-reference@example.com" }),
      );
      const started = await t.mutation(
        traceEndpoints.mcpStartExecutionRun,
        startArgs(userId),
      );
      expect(started.nativeSessionReference).toMatchObject(
        nativeSessionReference(),
      );

      const stored = await t.run(async (ctx: any) => ({
        identities: await ctx.db.query("agentIdentities").collect(),
        sessions: await ctx.db.query("agentTaskSessions").collect(),
        traces: await ctx.db.query("agentTaskTraces").collect(),
        events: await ctx.db.query("nodeKitRunEvents").collect(),
      }));
      expect(stored.identities).toHaveLength(0);
      expect(stored.sessions).toHaveLength(1);
      expect(stored.traces).toHaveLength(1);
      expect(stored.events).toHaveLength(1);
      expect(stored.sessions[0].nativeSessionReference.referenceHash).toBe(
        stored.events[0].payload.fields.nativeSessionReferenceHash,
      );
      expect(JSON.stringify(stored)).not.toMatch(
        /providerSession|nativeSessionGeneration|credential|resumable/i,
      );
    });

    it.each([
      ["raw workspace label", { workspaceId: "workspace:raw" }],
      ["raw session label", { sessionId: "session:provider-raw" }],
      ["bad checkpoint digest", { checkpointArtifactDigest: "bad" }],
    ])(
      "rejects %s before inserting partial state",
      async (_label, override) => {
        const t = convexTest(schema, convexModules);
        const userId = await t.run((ctx: any) =>
          ctx.db.insert("users", { email: `${hash("f")}@example.com` }),
        );
        await expect(
          t.mutation(
            traceEndpoints.mcpStartExecutionRun,
            startArgs(userId, nativeSessionReference(override)),
          ),
        ).rejects.toThrow(/native_session_reference_invalid/);
        const counts = await t.run(async (ctx: any) => ({
          sessions: (await ctx.db.query("agentTaskSessions").collect()).length,
          traces: (await ctx.db.query("agentTaskTraces").collect()).length,
          events: (await ctx.db.query("nodeKitRunEvents").collect()).length,
        }));
        expect(counts).toEqual({ sessions: 0, traces: 0, events: 0 });
      },
    );

    it("keeps burst and sustained starts bounded without inventing continuity state", async () => {
      const t = convexTest(schema, convexModules);
      const userId = await t.run((ctx: any) =>
        ctx.db.insert("users", { email: "nodekit-burst@example.com" }),
      );
      await Promise.all(
        Array.from({ length: 8 }, () =>
          t.mutation(traceEndpoints.mcpStartExecutionRun, startArgs(userId)),
        ),
      );
      for (let index = 0; index < 24; index += 1) {
        await t.mutation(
          traceEndpoints.mcpStartExecutionRun,
          startArgs(userId),
        );
      }
      const stored = await t.run(async (ctx: any) => ({
        identities: await ctx.db.query("agentIdentities").collect(),
        sessions: await ctx.db.query("agentTaskSessions").collect(),
        traces: await ctx.db.query("agentTaskTraces").collect(),
        events: await ctx.db.query("nodeKitRunEvents").collect(),
      }));
      expect(stored.identities).toHaveLength(0);
      expect(stored.sessions).toHaveLength(32);
      expect(stored.traces).toHaveLength(32);
      expect(stored.events).toHaveLength(32);
    });

    it("rejects cross-tenant graph appends and stores the owner-bound exact graph event", async () => {
      const t = convexTest(schema, convexModules);
      const { ownerId, foreignId } = await t.run(async (ctx: any) => ({
        ownerId: await ctx.db.insert("users", {
          email: "nodekit-owner@example.com",
        }),
        foreignId: await ctx.db.insert("users", {
          email: "nodekit-foreign@example.com",
        }),
      }));
      const started = await t.mutation(
        traceEndpoints.mcpStartExecutionRun,
        startArgs(ownerId),
      );
      const graphEvent = {
        traceId: started.traceId,
        eventType: "node.started" as const,
        graphId: `execution-graph:sha256:${hash("1")}`,
        graphHash: hash("2"),
        caseId: "case:nodebench",
        stageId: "build",
        caseContentHash: hash("3"),
        nodeId: "node:build-ui",
        nodeRunId: "node-run:build-ui:1",
        nodeKind: "task",
        frontierHash: hash("4"),
      };
      await expect(
        t.mutation(traceEndpoints.recordExecutionGraphEvent, {
          userId: foreignId,
          ...graphEvent,
        }),
      ).rejects.toThrow(/not owned/);
      const contentHash = await t.mutation(
        traceEndpoints.recordExecutionGraphEvent,
        { userId: ownerId, ...graphEvent },
      );
      expect(contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  },
);
