/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";

const DIR_SEGMENTS = ["domains", "mcp"];

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
  it("keeps graph writes secret-gated and injects the service owner", () => {
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
  });
});

function startArgs(
  userId: string,
  overrides: Partial<{
    agentId: string;
    workspaceId: string;
    nativeSessionId: string;
    nativeSessionGeneration: number;
    peerId: string;
  }> = {},
) {
  return {
    userId,
    title: "Compile the approved build stage",
    workflowName: "nodekit-stage-local-build",
    type: "agent" as const,
    visibility: "private" as const,
    nativeIdentity: {
      agentId: "codex.desktop",
      workspaceId: "workspace:nodebench",
      nativeSessionId: "session:desktop:2026-07-29",
      nativeSessionGeneration: 4,
      peerId: "peer:runner:codex",
      ...overrides,
    },
  };
}

describe.skipIf(!convexTestAvailable)(
  "NodeKit execution trace identity and graph persistence",
  () => {
    it("creates, reconnects, and explicitly rotates one owner-scoped native identity", async () => {
      const t = convexTest(schema, convexModules);
      const userId = await t.run((ctx: any) =>
        ctx.db.insert("users", { email: "nodekit-identity@example.com" }),
      );

      const created = await t.mutation(
        traceEndpoints.mcpStartExecutionRun,
        startArgs(userId),
      );
      const reconnected = await t.mutation(
        traceEndpoints.mcpStartExecutionRun,
        startArgs(userId),
      );
      const rotated = await t.mutation(
        traceEndpoints.mcpStartExecutionRun,
        startArgs(userId, {
          nativeSessionId: "session:desktop:2026-07-30",
          nativeSessionGeneration: 5,
        }),
      );

      expect([
        created.nativeIdentityContinuity,
        reconnected.nativeIdentityContinuity,
        rotated.nativeIdentityContinuity,
      ]).toEqual(["created", "reconnect", "rotate"]);
      expect(created.nativeIdentity?.identityRef).toBe(
        reconnected.nativeIdentity?.identityRef,
      );
      expect(rotated.nativeIdentity).toMatchObject({
        nativeSessionId: "session:desktop:2026-07-30",
        nativeSessionGeneration: 5,
      });

      const stored = await t.run(async (ctx: any) => ({
        identities: await ctx.db.query("agentIdentities").collect(),
        sessions: await ctx.db.query("agentTaskSessions").collect(),
        traces: await ctx.db.query("agentTaskTraces").collect(),
        events: await ctx.db.query("nodeKitRunEvents").collect(),
      }));
      expect(stored.identities).toHaveLength(1);
      expect(stored.sessions).toHaveLength(3);
      expect(stored.traces).toHaveLength(3);
      expect(stored.events).toHaveLength(3);
      expect(stored.sessions[0].nativeIdentity.snapshotHash).toBe(
        stored.events[0].payload.fields.identitySnapshotHash,
      );
    });

    it.each([
      {
        label: "stale generation",
        overrides: { nativeSessionGeneration: 3 },
        message: /native_session_stale/,
      },
      {
        label: "same-generation session collision",
        overrides: { nativeSessionId: "session:collision" },
        message: /native_session_collision/,
      },
      {
        label: "peer replacement during reconnect",
        overrides: { peerId: "peer:runner:impostor" },
        message: /native_peer_mismatch/,
      },
    ])(
      "rejects $label without appending partial state",
      async ({ overrides, message }) => {
        const t = convexTest(schema, convexModules);
        const userId = await t.run((ctx: any) =>
          ctx.db.insert("users", {
            email: `nodekit-${overrides.nativeSessionGeneration ?? 4}@example.com`,
          }),
        );
        await t.mutation(
          traceEndpoints.mcpStartExecutionRun,
          startArgs(userId),
        );

        await expect(
          t.mutation(
            traceEndpoints.mcpStartExecutionRun,
            startArgs(userId, overrides),
          ),
        ).rejects.toThrow(message);

        const counts = await t.run(async (ctx: any) => ({
          identities: (await ctx.db.query("agentIdentities").collect()).length,
          sessions: (await ctx.db.query("agentTaskSessions").collect()).length,
          traces: (await ctx.db.query("agentTaskTraces").collect()).length,
          events: (await ctx.db.query("nodeKitRunEvents").collect()).length,
        }));
        expect(counts).toEqual({
          identities: 1,
          sessions: 1,
          traces: 1,
          events: 1,
        });
      },
    );

    it("validates the complete native identity before inserting any row", async () => {
      const t = convexTest(schema, convexModules);
      const userId = await t.run((ctx: any) =>
        ctx.db.insert("users", { email: "nodekit-invalid@example.com" }),
      );

      await expect(
        t.mutation(
          traceEndpoints.mcpStartExecutionRun,
          startArgs(userId, { nativeSessionId: "unsafe session id" }),
        ),
      ).rejects.toThrow(/native_identity_field_invalid/);

      const counts = await t.run(async (ctx: any) => ({
        identities: (await ctx.db.query("agentIdentities").collect()).length,
        sessions: (await ctx.db.query("agentTaskSessions").collect()).length,
      }));
      expect(counts).toEqual({ identities: 0, sessions: 0 });
    });

    it("serializes a burst of reconnects onto one identity without duplicate rows", async () => {
      const t = convexTest(schema, convexModules);
      const userId = await t.run((ctx: any) =>
        ctx.db.insert("users", { email: "nodekit-burst@example.com" }),
      );

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          t.mutation(traceEndpoints.mcpStartExecutionRun, startArgs(userId)),
        ),
      );
      expect(
        results.filter(
          (result) => result.nativeIdentityContinuity === "created",
        ),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result) => result.nativeIdentityContinuity === "reconnect",
        ),
      ).toHaveLength(7);

      const identityCount = await t.run(
        async (ctx: any) =>
          (await ctx.db.query("agentIdentities").collect()).length,
      );
      expect(identityCount).toBe(1);
    });

    it("keeps sustained reconnect state bounded to one identity while retaining immutable run snapshots", async () => {
      const t = convexTest(schema, convexModules);
      const userId = await t.run((ctx: any) =>
        ctx.db.insert("users", { email: "nodekit-sustained@example.com" }),
      );

      for (let index = 0; index < 32; index += 1) {
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
      expect(stored.identities).toHaveLength(1);
      expect(stored.sessions).toHaveLength(32);
      expect(stored.traces).toHaveLength(32);
      expect(stored.events).toHaveLength(32);
      expect(
        new Set(
          stored.sessions.map(
            (session: any) => session.nativeIdentity.snapshotHash,
          ),
        ),
      ).toEqual(new Set([stored.identities[0].nativeIdentitySnapshotHash]));
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
        graphId: `execution-graph:sha256:${"a".repeat(64)}`,
        graphHash: "b".repeat(64),
        caseId: "case:nodebench",
        stageId: "build",
        caseContentHash: "c".repeat(64),
        nodeId: "node:build-ui",
        nodeRunId: "node-run:build-ui:1",
        nodeKind: "task",
        frontierHash: "d".repeat(64),
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

      const events = await t.run((ctx: any) =>
        ctx.db.query("nodeKitRunEvents").collect(),
      );
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        eventType: "node.started",
        runId: started.publicTraceId,
      });
    });
  },
);
