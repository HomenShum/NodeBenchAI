import { afterEach, describe, expect, it, vi } from "vitest";
import { executionTraceTools } from "../tools/executionTraceTools.js";

const originalSiteUrl = process.env.CONVEX_SITE_URL;
const originalSecret = process.env.MCP_SECRET;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.CONVEX_SITE_URL;
  } else {
    process.env.CONVEX_SITE_URL = originalSiteUrl;
  }

  if (originalSecret === undefined) {
    delete process.env.MCP_SECRET;
  } else {
    process.env.MCP_SECRET = originalSecret;
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("executionTraceTools", () => {
  it("exports the expected execution trace MCP tools", () => {
    const names = executionTraceTools.map((tool) => tool.name);
    expect(names).toEqual([
      "start_execution_run",
      "complete_execution_run",
      "record_execution_step",
      "record_execution_decision",
      "record_execution_verification",
      "record_execution_graph_event",
      "attach_execution_evidence",
      "request_execution_approval",
    ]);
  });

  it("returns a configuration error when trace backend env vars are missing", async () => {
    delete process.env.CONVEX_SITE_URL;
    delete process.env.MCP_SECRET;

    const tool = executionTraceTools.find(
      (entry) => entry.name === "start_execution_run",
    );
    expect(tool).toBeDefined();

    const result = (await tool!.handler({ title: "Spreadsheet trace" })) as any;
    expect(result.error).toBe(true);
    expect(result.message).toContain("MCP_SECRET");
  });

  it("calls the gateway with the expected payload for start_execution_run", async () => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site/";
    process.env.MCP_SECRET = "trace-secret";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            sessionId: "session_123",
            traceId: "trace_doc_456",
            publicTraceId: "trace_public_789",
            status: "running",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = executionTraceTools.find(
      (entry) => entry.name === "start_execution_run",
    );
    const result = (await tool!.handler({
      title: "Spreadsheet trace",
      workflowName: "Spreadsheet enrichment",
      type: "agent",
      visibility: "private",
      nativeSessionReference: {
        workspaceId: `workspace:sha256:${"a".repeat(64)}`,
        sessionId: `session:sha256:${"b".repeat(64)}`,
        workspaceArtifactRef: `native-workspace:sha256:${"c".repeat(64)}`,
        workspaceArtifactDigest: "c".repeat(64),
        sessionArtifactRef: `native-agent-session:sha256:${"d".repeat(64)}`,
        sessionArtifactDigest: "d".repeat(64),
        checkpointArtifactRef: `native-session-checkpoint:sha256:${"e".repeat(64)}`,
        checkpointArtifactDigest: "e".repeat(64),
      },
    })) as any;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.convex.site/api/mcpGateway");
    expect(init.method).toBe("POST");
    expect(init.headers["x-mcp-secret"]).toBe("trace-secret");
    expect(JSON.parse(init.body)).toEqual({
      fn: "mcpStartExecutionRun",
      args: {
        title: "Spreadsheet trace",
        workflowName: "Spreadsheet enrichment",
        description: undefined,
        type: "agent",
        visibility: "private",
        goalId: undefined,
        visionSnapshot: undefined,
        successCriteria: undefined,
        sourceRefs: undefined,
        nativeSessionReference: {
          workspaceId: `workspace:sha256:${"a".repeat(64)}`,
          sessionId: `session:sha256:${"b".repeat(64)}`,
          workspaceArtifactRef: `native-workspace:sha256:${"c".repeat(64)}`,
          workspaceArtifactDigest: "c".repeat(64),
          sessionArtifactRef: `native-agent-session:sha256:${"d".repeat(64)}`,
          sessionArtifactDigest: "d".repeat(64),
          checkpointArtifactRef: `native-session-checkpoint:sha256:${"e".repeat(64)}`,
          checkpointArtifactDigest: "e".repeat(64),
        },
        metadata: undefined,
      },
    });
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("session_123");
    expect(result.traceId).toBe("trace_doc_456");
    expect(result.publicTraceId).toBe("trace_public_789");
  });

  it("records an exact NodeKit edge binding instead of inferring readiness from exit status", async () => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site/";
    process.env.MCP_SECRET = "trace-secret";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: "event_doc_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = executionTraceTools.find(
      (entry) => entry.name === "record_execution_graph_event",
    );
    const payload = {
      traceId: "trace_doc_456",
      eventType: "edge.consumed",
      graphId: `execution-graph:sha256:${"a".repeat(64)}`,
      graphHash: "b".repeat(64),
      caseId: "case:nodebench",
      stageId: "build",
      caseContentHash: "c".repeat(64),
      nodeId: "node:build-ui",
      nodeRunId: "node-run:build-ui:1",
      edgeId: "edge:research-to-ui",
      bindingId: `execution-edge-binding:sha256:${"d".repeat(64)}`,
      bindingHash: "e".repeat(64),
      artifactId: "artifact:research-pack",
      artifactSchemaVersion: "nodekit.research-pack/v1",
      artifactContentHash: "f".repeat(64),
      authorityKind: "deterministic",
    };

    const result = (await tool!.handler(payload)) as any;

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      fn: "recordExecutionGraphEvent",
      args: payload,
    });
    expect(result).toMatchObject({
      success: true,
      eventHash: "event_doc_123",
      eventType: "edge.consumed",
    });
  });

  it("requires an error message when completing a failed execution run", async () => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site/";
    process.env.MCP_SECRET = "trace-secret";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = executionTraceTools.find(
      (entry) => entry.name === "complete_execution_run",
    );
    const result = (await tool!.handler({
      sessionId: "session_123",
      traceId: "trace_doc_456",
      status: "failed",
    })) as any;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.error).toBe(true);
    expect(result.message).toContain("errorMessage");
  });
});
