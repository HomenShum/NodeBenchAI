import { describe, expect, it } from "vitest";

import {
  NODEKIT_RUN_GENESIS_HASH,
  NodeKitRunContractError,
  appendNodeKitRunEvent,
  buildNodeKitRunEvent,
  canonicalNodeKitJson,
  sha256CanonicalNodeKitValue,
  verifyNodeKitRunEventChain,
  type NodeKitRunEvent,
} from "./nodeKitRunEvents";
import {
  NODEKIT_RUN_EXPORT_SCHEMA_VERSION,
  assertNodeKitRunExport,
  buildCanonicalNodeKitRunExport,
} from "./nodeKitRunExport";

const RUN_ID = "trace_nodekit_export_contract";

async function validEvents(): Promise<NodeKitRunEvent[]> {
  const started = await buildNodeKitRunEvent({
    runId: RUN_ID,
    sequence: 0,
    eventType: "run.started",
    recordedAt: 1_725_000_000_000,
    payload: {
      workflowName: "Entity intelligence",
      model: "gemini-3.5-flash",
      sessionType: "agent",
      sessionStartedAt: 1_724_999_999_000,
    },
    previousHash: NODEKIT_RUN_GENESIS_HASH,
  });
  const decision = await buildNodeKitRunEvent({
    runId: RUN_ID,
    sequence: 1,
    eventType: "decision.recorded",
    recordedAt: 1_725_000_000_010,
    payload: {
      statement: "Select the evidence-backed candidate",
      basis: ["source:a", "source:b"],
      nested: { z: 2, a: 1 },
    },
    previousHash: started.contentHash,
  });
  const completed = await buildNodeKitRunEvent({
    runId: RUN_ID,
    sequence: 2,
    eventType: "run.completed",
    recordedAt: 1_725_000_000_020,
    payload: {
      status: "completed",
      crossCheckStatus: "aligned",
    },
    previousHash: decision.contentHash,
  });
  return [started, decision, completed];
}

describe("canonical NodeKit run export", () => {
  it("emits an immutable ordered export with per-event and whole-export hashes", async () => {
    const events = await validEvents();
    const exportDoc = await buildCanonicalNodeKitRunExport({
      sessionId: "session_123",
      traceId: "trace_record_123",
      events,
    });

    expect(exportDoc.schemaVersion).toBe(NODEKIT_RUN_EXPORT_SCHEMA_VERSION);
    expect(exportDoc.events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(exportDoc.completeness).toEqual({
      eventChainComplete: true,
      spanLifecycleComplete: true,
      contractVersion: "nodekit.run-event/v1",
      eventCount: 3,
      firstSequence: 0,
      lastSequence: 2,
      terminalEventType: "run.completed",
    });
    expect(exportDoc.hashes.algorithm).toBe("sha256");
    expect(exportDoc.hashes.chainHead).toBe(events[2].contentHash);
    expect(exportDoc.hashes.exportHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(exportDoc)).toBe(true);
    expect(Object.isFrozen(exportDoc.events)).toBe(true);
    expect(Object.isFrozen(exportDoc.events[1].payload)).toBe(true);
    expect(() => {
      (
        exportDoc.events[0].payload.fields as {
          workflowName: string;
        }
      ).workflowName = "mutated";
    }).toThrow();

    await expect(assertNodeKitRunExport(exportDoc)).resolves.toBe(exportDoc);
  });

  it("hashes canonical content independently of object key insertion order", async () => {
    const first = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 0,
      eventType: "run.started",
      recordedAt: 42,
      payload: {
        b: 2,
        a: { d: 4, c: 3 },
        workflowName: "ordered",
        sessionType: "agent",
        sessionStartedAt: 1,
      },
      previousHash: NODEKIT_RUN_GENESIS_HASH,
    });
    const second = await buildNodeKitRunEvent({
      previousHash: NODEKIT_RUN_GENESIS_HASH,
      payload: {
        sessionStartedAt: 1,
        sessionType: "agent",
        workflowName: "ordered",
        a: { c: 3, d: 4 },
        b: 2,
      },
      recordedAt: 42,
      eventType: "run.started",
      sequence: 0,
      runId: RUN_ID,
    });

    expect(second.contentHash).toBe(first.contentHash);
  });

  it("matches the cross-language RFC 8785 number and key-order fixture", async () => {
    const fixture = {
      z: -0,
      tiny: 1e-7,
      threshold: 1e-6,
      huge: 1e21,
      fraction: 0.8,
      nested: { "😀": 2, "\uE000": 1 },
    };

    expect(canonicalNodeKitJson(fixture)).toBe(
      '{"fraction":0.8,"huge":1e+21,"nested":{"😀":2,"":1},"threshold":0.000001,"tiny":1e-7,"z":0}',
    );
    await expect(sha256CanonicalNodeKitValue(fixture)).resolves.toBe(
      "sha256:d4f50ebd3e2d78d0975c68bafdbdf327b64a13c9acddd09cc95a747a1eaa1812",
    );
  });

  it.each([
    {
      label: "sequence gap",
      mutate: (events: NodeKitRunEvent[]) => {
        events[1] = { ...events[1], sequence: 4 };
      },
      code: "sequence_not_contiguous",
    },
    {
      label: "broken previous hash",
      mutate: (events: NodeKitRunEvent[]) => {
        events[1] = {
          ...events[1],
          previousHash: NODEKIT_RUN_GENESIS_HASH,
        };
      },
      code: "previous_hash_mismatch",
    },
    {
      label: "tampered payload",
      mutate: (events: NodeKitRunEvent[]) => {
        events[1] = {
          ...events[1],
          payload: {
            ...events[1].payload,
            sourceDigest: `sha256:${"f".repeat(64)}`,
          },
        };
      },
      code: "content_hash_mismatch",
    },
    {
      label: "missing terminal event",
      mutate: (events: NodeKitRunEvent[]) => {
        events.pop();
      },
      code: "terminal_event_missing",
    },
    {
      label: "event after terminal",
      mutate: (events: NodeKitRunEvent[]) => {
        events.push({ ...events[1], sequence: 3 });
      },
      code: "terminal_event_not_last",
    },
  ])("fails closed for a $label", async ({ mutate, code }) => {
    const events = structuredClone(await validEvents());
    mutate(events);

    await expect(
      verifyNodeKitRunEventChain(events, RUN_ID),
    ).rejects.toMatchObject({
      name: "NodeKitRunContractError",
      code,
    });
  });

  it("rejects a whole-export hash mismatch without normalizing it away", async () => {
    const exportDoc = await buildCanonicalNodeKitRunExport({
      sessionId: "session_123",
      traceId: "trace_record_123",
      events: await validEvents(),
    });
    const tampered = structuredClone(exportDoc);
    (tampered.trace as { id: string }).id = "rewritten-after-export";

    await expect(assertNodeKitRunExport(tampered)).rejects.toMatchObject({
      name: "NodeKitRunContractError",
      code: "export_hash_mismatch",
    });
  });

  it("rejects a trace status that contradicts the terminal event", async () => {
    const exportDoc = await buildCanonicalNodeKitRunExport({
      sessionId: "session_123",
      traceId: "trace_record_123",
      events: await validEvents(),
    });
    const contradicted = structuredClone(exportDoc);
    (contradicted.trace as { status: string }).status = "error";

    await expect(assertNodeKitRunExport(contradicted)).rejects.toMatchObject({
      name: "NodeKitRunContractError",
      code: "terminal_status_mismatch",
    });
  });

  it("binds export metadata only to immutable event snapshots", async () => {
    const events = await validEvents();
    const first = await buildCanonicalNodeKitRunExport({
      sessionId: "session_123",
      traceId: "trace_record_123",
      events,
    });
    const second = await buildCanonicalNodeKitRunExport({
      sessionId: "session_123",
      traceId: "trace_record_123",
      events,
    });

    expect(second).toEqual(first);
    expect(second.hashes.exportHash).toBe(first.hashes.exportHash);
    expect(second.session).toEqual({
      id: "session_123",
      typeAtRunStart: "agent",
      startedAt: 1_724_999_999_000,
    });
    expect(second.session).not.toHaveProperty("title");
    expect(second.session).not.toHaveProperty("status");
  });

  it("stores only a bounded redacted projection of arbitrary payloads", async () => {
    const event = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 0,
      eventType: "approval.requested",
      recordedAt: 42,
      payload: {
        approvalId: "approval_1",
        toolName: "publish",
        riskLevel: "high",
        justification: "contains customer context",
        toolArgs: {
          apiKey: "must-never-be-stored",
          customerEmail: "private@example.com",
        },
      },
      previousHash: NODEKIT_RUN_GENESIS_HASH,
    });

    expect(event.payload.fields).toEqual({
      approvalId: "approval_1",
      toolName: "publish",
      riskLevel: "high",
    });
    expect(JSON.stringify(event)).not.toContain("must-never-be-stored");
    expect(JSON.stringify(event)).not.toContain("private@example.com");
    expect(JSON.stringify(event)).not.toContain("customer context");
    expect(event.payload.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects a terminal run while an explicit span remains open", async () => {
    const [started] = await validEvents();
    const spanStarted = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 1,
      eventType: "span.started",
      recordedAt: started.recordedAt + 1,
      payload: { spanId: "span_open" },
      previousHash: started.contentHash,
    });
    const completed = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 2,
      eventType: "run.completed",
      recordedAt: started.recordedAt + 2,
      payload: { status: "completed" },
      previousHash: spanStarted.contentHash,
    });

    await expect(
      verifyNodeKitRunEventChain([started, spanStarted, completed], RUN_ID),
    ).rejects.toMatchObject({
      name: "NodeKitRunContractError",
      code: "span_lifecycle_incomplete",
    });
  });

  it.each([
    {
      eventType: "run.completed" as const,
      status: "error",
    },
    {
      eventType: "run.failed" as const,
      status: "completed",
    },
  ])(
    "rejects a $eventType event whose safe status is $status",
    async ({ eventType, status }) => {
      await expect(
        buildNodeKitRunEvent({
          runId: RUN_ID,
          sequence: 0,
          eventType,
          recordedAt: 42,
          payload: { status },
          previousHash: NODEKIT_RUN_GENESIS_HASH,
        }),
      ).rejects.toMatchObject({
        name: "NodeKitRunContractError",
        code: "terminal_status_mismatch",
      });
    },
  );

  it("rejects a hash-valid chain whose event clock moves backwards", async () => {
    const [started] = await validEvents();
    const decision = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 1,
      eventType: "decision.recorded",
      recordedAt: started.recordedAt + 1_000,
      payload: { decisionType: "future-decision" },
      previousHash: started.contentHash,
    });
    const completed = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 2,
      eventType: "run.completed",
      recordedAt: started.recordedAt + 100,
      payload: { status: "completed" },
      previousHash: decision.contentHash,
    });

    await expect(
      verifyNodeKitRunEventChain([started, decision, completed], RUN_ID),
    ).rejects.toMatchObject({
      name: "NodeKitRunContractError",
      code: "recorded_at_not_monotonic",
    });
  });

  it("reserves enough bounded capacity to close every open span and terminate", async () => {
    const events: NodeKitRunEvent[] = [];
    let previousHash: string = NODEKIT_RUN_GENESIS_HASH;
    for (let sequence = 0; sequence < 254; sequence += 1) {
      const event = await buildNodeKitRunEvent({
        runId: RUN_ID,
        sequence,
        eventType: sequence === 0 ? "run.started" : "decision.recorded",
        recordedAt: 1_725_000_000_000 + sequence,
        payload:
          sequence === 0
            ? {
                workflowName: "Capacity boundary",
                sessionType: "agent",
                sessionStartedAt: 1_725_000_000_000,
              }
            : { decisionType: `decision-${sequence}` },
        previousHash,
      });
      events.push(event);
      previousHash = event.contentHash;
    }
    const stored = events.map((event) => ({
      ...event,
      sessionId: "session_123",
      traceId: "trace_record_123",
      userId: "user_123",
    }));
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => ({
              first: async () => stored.at(-1),
              take: async () => stored,
            }),
          }),
        }),
        insert: async () => "must-not-insert",
      },
    };

    await expect(
      appendNodeKitRunEvent(ctx as never, {
        sessionId: "session_123" as never,
        traceId: "trace_record_123" as never,
        userId: "user_123" as never,
        runId: RUN_ID,
        eventType: "span.started",
        recordedAt: 1_725_000_000_254,
        payload: { spanId: "span-that-cannot-fit" },
      }),
    ).rejects.toMatchObject({
      name: "NodeKitRunContractError",
      code: "event_capacity_reserved",
    });
  });

  it("reserves the final bounded event slot for termination", async () => {
    const latest = {
      sequence: 254,
      eventType: "decision.recorded",
      runId: RUN_ID,
      sessionId: "session_123",
      userId: "user_123",
      contentHash: `sha256:${"a".repeat(64)}`,
    };
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => ({
              first: async () => latest,
            }),
          }),
        }),
      },
    };

    await expect(
      appendNodeKitRunEvent(ctx as never, {
        sessionId: "session_123" as never,
        traceId: "trace_record_123" as never,
        userId: "user_123" as never,
        runId: RUN_ID,
        eventType: "decision.recorded",
        recordedAt: 42,
        payload: { decisionType: "must-not-fit" },
      }),
    ).rejects.toMatchObject({
      name: "NodeKitRunContractError",
      code: "terminal_slot_required",
    });
  });

  it("uses typed contract errors rather than partial exports", () => {
    const error = new NodeKitRunContractError("legacy_trace", "No event chain");

    expect(error.name).toBe("NodeKitRunContractError");
    expect(error.code).toBe("legacy_trace");
  });
});
