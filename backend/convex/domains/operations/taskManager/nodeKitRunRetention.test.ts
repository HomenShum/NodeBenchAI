import { describe, expect, it } from "vitest";

import {
  NODEKIT_RUN_GENESIS_HASH,
  buildNodeKitRunEvent,
  type NodeKitRunEvent,
} from "./nodeKitRunEvents";
import { exportNodeKitRun } from "./nodeKitRunExport";
import {
  deleteOwnedNodeKitRunHistory,
  purgeExpiredNodeKitRunEvents,
} from "./nodeKitRunRetention";

type Row = Record<string, any> & { _id: string };
type Tables = Record<string, Row[]>;

class MockQuery {
  private rows: Row[];
  private indexName = "";

  constructor(rows: Row[]) {
    this.rows = [...rows];
  }

  withIndex(
    name: string,
    apply: (q: {
      eq: (field: string, value: unknown) => any;
      lte: (field: string, value: number) => any;
    }) => unknown,
  ) {
    this.indexName = name;
    const builder = {
      eq: (field: string, value: unknown) => {
        this.rows = this.rows.filter((row) => row[field] === value);
        return builder;
      },
      lte: (field: string, value: number) => {
        this.rows = this.rows.filter(
          (row) => typeof row[field] === "number" && row[field] <= value,
        );
        return builder;
      },
    };
    apply(builder);
    return this;
  }

  order(direction: "asc" | "desc") {
    const fields = this.indexName.includes("status_started")
      ? ["startedAt"]
      : this.indexName.includes("retention")
        ? ["retentionExpiresAt"]
        : ["sequence"];
    this.rows.sort((left, right) => {
      for (const field of fields) {
        const delta = Number(left[field] ?? 0) - Number(right[field] ?? 0);
        if (delta !== 0) return direction === "asc" ? delta : -delta;
      }
      return String(left._id).localeCompare(String(right._id));
    });
    return this;
  }

  async first() {
    return this.rows[0] ?? null;
  }

  async take(limit: number) {
    return this.rows.slice(0, limit);
  }
}

class MockDb {
  readonly tables: Tables;
  private nextId = 0;

  constructor(tables: Tables) {
    this.tables = structuredClone(tables);
  }

  async get(id: string) {
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }

  query(table: string) {
    return new MockQuery(this.tables[table] ?? []);
  }

  async insert(table: string, value: Record<string, unknown>) {
    const id = `${table}:inserted-${this.nextId++}`;
    (this.tables[table] ??= []).push({ _id: id, ...structuredClone(value) });
    return id;
  }

  async patch(id: string, value: Record<string, unknown>) {
    const row = await this.get(id);
    if (!row) throw new Error(`missing row ${id}`);
    Object.assign(row, structuredClone(value));
  }

  async delete(id: string) {
    for (const rows of Object.values(this.tables)) {
      const index = rows.findIndex((candidate) => candidate._id === id);
      if (index >= 0) {
        rows.splice(index, 1);
        return;
      }
    }
  }
}

function createCtx(tables: Tables, subject: string | null = "owner-a") {
  const scheduled: Array<{ delay: number; args: unknown }> = [];
  return {
    db: new MockDb(tables),
    auth: {
      getUserIdentity: async () => (subject ? { subject } : null),
    },
    scheduler: {
      runAfter: async (delay: number, _fn: unknown, args: unknown) => {
        scheduled.push({ delay, args });
      },
    },
    scheduled,
  };
}

function terminalHistory(overrides: Partial<Row> = {}): Tables {
  return {
    agentTaskSessions: [
      {
        _id: "session-a",
        userId: "owner-a",
        type: "agent",
        startedAt: 1,
      },
    ],
    agentTaskTraces: [
      {
        _id: "trace-a",
        sessionId: "session-a",
        traceId: "run-a",
        workflowName: "Owner workflow",
        status: "completed",
        startedAt: 1,
        endedAt: 2,
      },
    ],
    nodeKitRunEvents: [
      {
        _id: "event-a-0",
        traceId: "trace-a",
        sessionId: "session-a",
        userId: "owner-a",
        runId: "run-a",
        sequence: 0,
        eventType: "run.started",
        ...overrides,
      },
      {
        _id: "event-a-1",
        traceId: "trace-a",
        sessionId: "session-a",
        userId: "owner-a",
        runId: "run-a",
        sequence: 1,
        eventType: "run.completed",
        ...overrides,
      },
    ],
  };
}

describe("NodeKit owner-scoped deletion", () => {
  it("rejects anonymous and cross-owner deletion without removing rows", async () => {
    for (const [subject, code] of [
      [null, "not_authenticated"],
      ["owner-b", "trace_not_found"],
    ] as const) {
      const ctx = createCtx(terminalHistory(), subject);
      await expect(
        (deleteOwnedNodeKitRunHistory as any)._handler(ctx, {
          traceId: "trace-a",
        }),
      ).rejects.toMatchObject({ data: { code } });
      expect(ctx.db.tables.nodeKitRunEvents).toHaveLength(2);
    }
  });

  it("deletes the complete terminal chain for its owner", async () => {
    const ctx = createCtx(terminalHistory());
    await expect(
      (deleteOwnedNodeKitRunHistory as any)._handler(ctx, {
        traceId: "trace-a",
      }),
    ).resolves.toEqual({ deleted: 2 });
    expect(ctx.db.tables.nodeKitRunEvents).toEqual([]);
  });

  it("rejects corrupt cross-owner history without a partial delete", async () => {
    const tables = terminalHistory();
    tables.nodeKitRunEvents[1].userId = "owner-b";
    const ctx = createCtx(tables);

    await expect(
      (deleteOwnedNodeKitRunHistory as any)._handler(ctx, {
        traceId: "trace-a",
      }),
    ).rejects.toMatchObject({
      data: { code: "event_ownership_mismatch" },
    });
    expect(ctx.db.tables.nodeKitRunEvents).toHaveLength(2);
  });

  it("reports deleted or expired canonical history truthfully", async () => {
    const ctx = createCtx(terminalHistory());
    await (deleteOwnedNodeKitRunHistory as any)._handler(ctx, {
      traceId: "trace-a",
    });

    await expect(
      (exportNodeKitRun as any)._handler(ctx, { traceId: "trace-a" }),
    ).rejects.toMatchObject({
      data: { code: "run_history_unavailable" },
    });
  });
});

describe("NodeKit bounded retention maintenance", () => {
  it("closes a stale running trace, including its open span, before retention", async () => {
    const now = Date.now();
    const runId = "stale-run";
    const started = await buildNodeKitRunEvent({
      runId,
      sequence: 0,
      eventType: "run.started",
      recordedAt: now - 31 * 24 * 60 * 60 * 1000,
      payload: {
        workflowName: "Stale workflow",
        sessionType: "agent",
        sessionStartedAt: now - 31 * 24 * 60 * 60 * 1000,
      },
      previousHash: NODEKIT_RUN_GENESIS_HASH,
    });
    const spanStarted = await buildNodeKitRunEvent({
      runId,
      sequence: 1,
      eventType: "span.started",
      recordedAt: started.recordedAt + 1,
      payload: { spanId: "span-open" },
      previousHash: started.contentHash,
    });
    const nodeStarted = await buildNodeKitRunEvent({
      runId,
      sequence: 2,
      eventType: "node.started",
      recordedAt: spanStarted.recordedAt + 1,
      payload: {
        graphId: `execution-graph:sha256:${"a".repeat(64)}`,
        graphHash: "b".repeat(64),
        caseId: "case:stale",
        stageId: "build",
        caseContentHash: "c".repeat(64),
        nodeId: "node:stale-build",
        nodeRunId: "node-run:stale-build:1",
        nodeKind: "task",
      },
      previousHash: spanStarted.contentHash,
    });
    const rows = [started, spanStarted, nodeStarted].map((event, index) => ({
      _id: `stale-event-${index}`,
      sessionId: "stale-session",
      traceId: "stale-trace",
      userId: "owner-a",
      ...event,
    }));
    const ctx = createCtx({
      agentTaskSessions: [
        {
          _id: "stale-session",
          userId: "owner-a",
          type: "agent",
          startedAt: started.recordedAt,
        },
      ],
      agentTaskTraces: [
        {
          _id: "stale-trace",
          sessionId: "stale-session",
          traceId: runId,
          workflowName: "Stale workflow",
          status: "running",
          startedAt: started.recordedAt,
        },
      ],
      agentTaskSpans: [
        {
          _id: "span-open",
          traceId: "stale-trace",
          status: "running",
          startedAt: spanStarted.recordedAt,
        },
      ],
      nodeKitRunEvents: rows,
    });

    const result = await (purgeExpiredNodeKitRunEvents as any)._handler(
      ctx,
      {},
    );

    expect(result).toMatchObject({ staleClosed: 1, staleCorruptPurged: 0 });
    expect((await ctx.db.get("stale-trace"))?.status).toBe("error");
    expect((await ctx.db.get("span-open"))?.status).toBe("error");
    expect(ctx.db.tables.nodeKitRunEvents.at(-3)?.eventType).toBe(
      "node.failed",
    );
    expect(ctx.db.tables.nodeKitRunEvents.at(-2)?.eventType).toBe(
      "span.completed",
    );
    expect(ctx.db.tables.nodeKitRunEvents.at(-1)?.eventType).toBe("run.failed");
    expect(
      ctx.db.tables.nodeKitRunEvents.at(-1)?.retentionExpiresAt,
    ).toBeGreaterThan(now);
  });

  it("purges a corrupt stale chain without forging a terminal receipt", async () => {
    const now = Date.now();
    const started = await buildNodeKitRunEvent({
      runId: "corrupt-stale-run",
      sequence: 0,
      eventType: "run.started",
      recordedAt: now - 31 * 24 * 60 * 60 * 1000,
      payload: {
        workflowName: "Corrupt stale workflow",
        sessionType: "agent",
        sessionStartedAt: now - 31 * 24 * 60 * 60 * 1000,
      },
      previousHash: NODEKIT_RUN_GENESIS_HASH,
    });
    const ctx = createCtx({
      agentTaskSessions: [
        {
          _id: "corrupt-session",
          userId: "owner-a",
          type: "agent",
          startedAt: started.recordedAt,
        },
      ],
      agentTaskTraces: [
        {
          _id: "corrupt-trace",
          sessionId: "corrupt-session",
          traceId: "corrupt-stale-run",
          workflowName: "Corrupt stale workflow",
          status: "running",
          startedAt: started.recordedAt,
        },
      ],
      agentTaskSpans: [],
      nodeKitRunEvents: [
        {
          _id: "corrupt-event",
          sessionId: "corrupt-session",
          traceId: "corrupt-trace",
          userId: "owner-a",
          ...started,
          contentHash: `sha256:${"f".repeat(64)}`,
        },
      ],
    });

    const result = await (purgeExpiredNodeKitRunEvents as any)._handler(
      ctx,
      {},
    );

    expect(result).toMatchObject({ staleClosed: 0, staleCorruptPurged: 1 });
    expect((await ctx.db.get("corrupt-trace"))?.status).toBe("error");
    expect(ctx.db.tables.nodeKitRunEvents).toEqual([]);
    expect(
      ctx.db.tables.nodeKitRunEvents.some(
        (event) => event.eventType === "run.failed",
      ),
    ).toBe(false);
  });

  it("drains accumulated legacy spans in bounded stale-run continuations", async () => {
    const now = Date.now();
    const ctx = createCtx({
      agentTaskSessions: [
        {
          _id: "legacy-session",
          userId: "owner-a",
          type: "agent",
          startedAt: now - 31 * 24 * 60 * 60 * 1000,
        },
      ],
      agentTaskTraces: [
        {
          _id: "legacy-trace",
          sessionId: "legacy-session",
          traceId: "legacy-run",
          workflowName: "Accumulated legacy workflow",
          status: "running",
          startedAt: now - 31 * 24 * 60 * 60 * 1000,
        },
      ],
      agentTaskSpans: Array.from({ length: 300 }, (_, seq) => ({
        _id: `legacy-span-${seq}`,
        traceId: "legacy-trace",
        seq,
        status: "running",
        startedAt: now - 10_000,
      })),
      nodeKitRunEvents: [],
    });

    const first = await (purgeExpiredNodeKitRunEvents as any)._handler(ctx, {});
    expect(first).toMatchObject({
      stalePending: 1,
      staleCorruptPurged: 0,
      continuationScheduled: true,
    });
    expect((await ctx.db.get("legacy-trace"))?.status).toBe("running");
    expect(
      ctx.db.tables.agentTaskSpans.filter((span) => span.status === "running"),
    ).toHaveLength(44);
    expect(ctx.scheduled).toHaveLength(1);

    const second = await (purgeExpiredNodeKitRunEvents as any)._handler(
      ctx,
      {},
    );
    expect(second).toMatchObject({
      stalePending: 0,
      staleCorruptPurged: 1,
      continuationScheduled: false,
    });
    expect((await ctx.db.get("legacy-trace"))?.status).toBe("error");
    expect(
      ctx.db.tables.agentTaskSpans.filter((span) => span.status === "running"),
    ).toEqual([]);
  });

  it("bypasses expired nonterminal rows and drains a sustained terminal backlog in continuations", async () => {
    const now = Date.now();
    const tables: Tables = {
      agentTaskSessions: [],
      agentTaskTraces: [
        {
          _id: "still-running",
          sessionId: "running-session",
          traceId: "still-running",
          status: "running",
          startedAt: now,
        },
      ],
      nodeKitRunEvents: Array.from({ length: 128 }, (_, sequence) => ({
        _id: `running-${sequence}`,
        traceId: "still-running",
        sessionId: "running-session",
        userId: "owner-a",
        runId: "still-running",
        sequence,
        eventType: sequence === 0 ? "run.started" : "decision.recorded",
        retentionExpiresAt: now - 10_000,
      })),
    };
    for (let traceIndex = 0; traceIndex < 5; traceIndex += 1) {
      const traceId = `terminal-trace-${traceIndex}`;
      tables.agentTaskTraces.push({
        _id: traceId,
        sessionId: `terminal-session-${traceIndex}`,
        traceId,
        status: "completed",
        startedAt: now - 20_000,
      });
      for (let sequence = 0; sequence < 256; sequence += 1) {
        tables.nodeKitRunEvents.push({
          _id: `${traceId}-${sequence}`,
          traceId,
          sessionId: `terminal-session-${traceIndex}`,
          userId: "owner-a",
          runId: traceId,
          sequence,
          eventType: sequence === 255 ? "run.completed" : "decision.recorded",
          ...(sequence === 255
            ? { retentionExpiresAt: now - 1_000 + traceIndex }
            : {}),
        });
      }
    }
    const ctx = createCtx(tables);

    const first = await (purgeExpiredNodeKitRunEvents as any)._handler(ctx, {});
    expect(first).toMatchObject({
      deleted: 1024,
      continuationScheduled: true,
    });
    expect(ctx.scheduled).toHaveLength(1);
    expect(
      ctx.db.tables.nodeKitRunEvents.filter((row) =>
        String(row.traceId).startsWith("terminal-trace-"),
      ),
    ).toHaveLength(256);
    expect(
      ctx.db.tables.nodeKitRunEvents.filter(
        (row) => row.traceId === "still-running",
      ),
    ).toHaveLength(128);

    const second = await (purgeExpiredNodeKitRunEvents as any)._handler(
      ctx,
      {},
    );
    expect(second).toMatchObject({
      deleted: 256,
      continuationScheduled: false,
    });
    expect(
      ctx.db.tables.nodeKitRunEvents.filter((row) =>
        String(row.traceId).startsWith("terminal-trace-"),
      ),
    ).toEqual([]);
  });

  it("does not spin continuations for a full but non-progressing corrupt batch", async () => {
    const now = Date.now();
    const ctx = createCtx({
      agentTaskSessions: [],
      agentTaskTraces: [
        {
          _id: "contradictory-running-trace",
          sessionId: "missing-session",
          traceId: "contradictory-running-run",
          status: "running",
          startedAt: now,
        },
      ],
      nodeKitRunEvents: Array.from({ length: 128 }, (_, sequence) => ({
        _id: `contradictory-terminal-${sequence}`,
        traceId: "contradictory-running-trace",
        sessionId: "missing-session",
        userId: "owner-a",
        runId: "contradictory-running-run",
        sequence,
        eventType: "run.completed",
        retentionExpiresAt: now - 1_000,
      })),
    });

    const result = await (purgeExpiredNodeKitRunEvents as any)._handler(
      ctx,
      {},
    );

    expect(result).toMatchObject({
      deleted: 0,
      skippedRunning: 1,
      continuationScheduled: false,
    });
    expect(ctx.scheduled).toEqual([]);
  });
});
