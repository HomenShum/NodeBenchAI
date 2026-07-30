import { describe, expect, it } from "vitest";

import {
  NODEKIT_RUN_GENESIS_HASH,
  buildNodeKitRunEvent,
  verifyNodeKitRunEventChain,
  type NodeKitRunEvent,
} from "./nodeKitRunEvents";

const RUN_ID = "trace_stage_local_graph";
const GRAPH = {
  graphId: `execution-graph:sha256:${"a".repeat(64)}`,
  graphHash: `${"b".repeat(64)}`,
  caseId: "case:nodebench",
  stageId: "build",
  caseContentHash: `${"c".repeat(64)}`,
} as const;

async function append(
  events: NodeKitRunEvent[],
  eventType: NodeKitRunEvent["eventType"],
  payload: Record<string, unknown>,
): Promise<void> {
  const previous = events.at(-1);
  events.push(
    await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: events.length,
      eventType,
      recordedAt: 1_725_000_000_000 + events.length,
      payload,
      previousHash: previous?.contentHash ?? NODEKIT_RUN_GENESIS_HASH,
    }),
  );
}

async function validGraphEvents(): Promise<NodeKitRunEvent[]> {
  const events: NodeKitRunEvent[] = [];
  await append(events, "run.started", {
    workflowName: "Stage-local NodeKit consumer",
    sessionType: "agent",
    sessionStartedAt: 1_725_000_000_000,
    identityRef: "nodebench:agent-identity:agent_doc_123",
    workspaceId: "workspace:nodebench",
    agentId: "codex.desktop",
    nativeSessionId: "session:desktop:2026-07-29",
    nativeSessionGeneration: 4,
    peerId: "peer:runner:codex",
    identitySnapshotHash: `sha256:${"d".repeat(64)}`,
  });
  await append(events, "node.started", {
    ...GRAPH,
    nodeId: "node:build-ui",
    nodeRunId: "node-run:build-ui:1",
    nodeKind: "task",
    frontierHash: `${"e".repeat(64)}`,
  });
  await append(events, "edge.consumed", {
    ...GRAPH,
    nodeId: "node:build-ui",
    nodeRunId: "node-run:build-ui:1",
    edgeId: "edge:research-to-ui",
    bindingId: `execution-edge-binding:sha256:${"f".repeat(64)}`,
    bindingHash: `${"1".repeat(64)}`,
    artifactId: "artifact:research-pack",
    artifactSchemaVersion: "nodekit.research-pack/v1",
    artifactContentHash: `${"2".repeat(64)}`,
    authorityKind: "deterministic",
  });
  await append(events, "artifact.produced", {
    ...GRAPH,
    nodeId: "node:build-ui",
    nodeRunId: "node-run:build-ui:1",
    artifactId: "artifact:ui-candidate",
    artifactSchemaVersion: "nodekit.ui-candidate/v1",
    artifactContentHash: `${"3".repeat(64)}`,
    authorityKind: "agent-produced",
  });
  await append(events, "node.completed", {
    ...GRAPH,
    nodeId: "node:build-ui",
    nodeRunId: "node-run:build-ui:1",
    status: "completed",
  });
  await append(events, "run.completed", { status: "completed" });
  return events;
}

describe("NodeKit graph-aware run events", () => {
  it("accepts a complete stage-local node and edge-binding lifecycle", async () => {
    const events = await validGraphEvents();

    await expect(
      verifyNodeKitRunEventChain(events, RUN_ID),
    ).resolves.toMatchObject({
      eventCount: 6,
      terminalEventType: "run.completed",
    });
  });

  it("fails closed when a terminal run still has an open graph node", async () => {
    const events = await validGraphEvents();
    events.splice(4, 1);
    const terminal = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 4,
      eventType: "run.completed",
      recordedAt: 1_725_000_000_004,
      payload: { status: "completed" },
      previousHash: events[3].contentHash,
    });
    events[4] = terminal;

    await expect(verifyNodeKitRunEventChain(events, RUN_ID)).rejects.toEqual(
      expect.objectContaining({
        code: "graph_node_lifecycle_incomplete",
      }),
    );
  });

  it("rejects an edge consumption that is not bound to the currently running node", async () => {
    const events = await validGraphEvents();
    const invalidEdge = await buildNodeKitRunEvent({
      runId: RUN_ID,
      sequence: 2,
      eventType: "edge.consumed",
      recordedAt: 1_725_000_000_002,
      payload: {
        ...GRAPH,
        nodeId: "node:other",
        nodeRunId: "node-run:other:1",
        edgeId: "edge:research-to-ui",
        bindingId: `execution-edge-binding:sha256:${"f".repeat(64)}`,
        bindingHash: `${"1".repeat(64)}`,
        artifactId: "artifact:research-pack",
        artifactSchemaVersion: "nodekit.research-pack/v1",
        artifactContentHash: `${"2".repeat(64)}`,
        authorityKind: "deterministic",
      },
      previousHash: events[1].contentHash,
    });
    events.splice(2);
    events.push(invalidEdge);
    await append(events, "run.failed", { status: "error" });

    await expect(verifyNodeKitRunEventChain(events, RUN_ID)).rejects.toEqual(
      expect.objectContaining({
        code: "graph_node_not_running",
      }),
    );
  });
});
