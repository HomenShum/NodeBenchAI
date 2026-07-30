import type { McpTool } from "../types.js";

type GatewaySuccess<T> = {
  success: true;
  data: T;
};

type GatewayFailure = {
  success: false;
  error: string;
};

type GatewayResult<T> = GatewaySuccess<T> | GatewayFailure;

function getTraceConfig(): { siteUrl: string; secret: string } | null {
  const siteUrl = process.env.CONVEX_SITE_URL || process.env.VITE_CONVEX_URL;
  const secret = process.env.MCP_SECRET;
  if (!siteUrl || !secret) return null;
  return { siteUrl: siteUrl.replace(/\/$/, ""), secret };
}

async function callGateway<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<GatewayResult<T>> {
  const config = getTraceConfig();
  if (!config) {
    return {
      success: false,
      error:
        "Missing CONVEX_SITE_URL (or VITE_CONVEX_URL) or MCP_SECRET. Cannot call execution trace backend.",
    };
  }

  const res = await fetch(`${config.siteUrl}/api/mcpGateway`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mcp-secret": config.secret,
    },
    body: JSON.stringify({ fn, args }),
  });

  const payload = (await res.json()) as GatewayResult<T> & { message?: string };
  if (!res.ok) {
    const errorMessage =
      ("error" in payload ? payload.error : undefined) ||
      payload.message ||
      `Execution trace backend returned HTTP ${res.status}`;
    return {
      success: false,
      error: errorMessage,
    };
  }
  return payload;
}

export const executionTraceTools: McpTool[] = [
  {
    name: "start_execution_run",
    description:
      "Start a live Convex-backed execution trace run for a workflow. Creates a task session and trace together so later steps, decisions, evidence, verifications, and approvals all land on the same durable run.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Human-readable run title shown in NodeBench UI.",
        },
        workflowName: {
          type: "string",
          description:
            "Workflow label for the trace, e.g. 'Spreadsheet enrichment'. Defaults to title.",
        },
        description: {
          type: "string",
          description: "Short run purpose or operator instruction.",
        },
        type: {
          type: "string",
          enum: ["manual", "agent", "swarm", "cron", "scheduled"],
          description: "Session type (default: agent).",
        },
        visibility: {
          type: "string",
          enum: ["public", "private"],
          description:
            "Whether the run is publicly visible in shared UI surfaces (default: private).",
        },
        goalId: {
          type: "string",
          description:
            "Optional Oracle/mission goal ID for cross-check tracking.",
        },
        visionSnapshot: {
          type: "string",
          description: "Optional immutable vision snapshot to anchor the run.",
        },
        successCriteria: {
          type: "array",
          items: { type: "string" },
          description: "Success criteria for the run.",
        },
        sourceRefs: {
          type: "array",
          description: "Optional source references attached at run start.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              href: { type: "string" },
              note: { type: "string" },
              kind: { type: "string" },
            },
            required: ["label"],
          },
        },
        nativeSessionReference: {
          type: "object",
          description:
            "Optional refs-and-digests-only projection of Caseflow-canonical native workspace, session, and latest checkpoint artifacts. This reference cannot authorize resume.",
          properties: {
            workspaceId: { type: "string" },
            sessionId: { type: "string" },
            workspaceArtifactRef: { type: "string" },
            workspaceArtifactDigest: { type: "string" },
            sessionArtifactRef: { type: "string" },
            sessionArtifactDigest: { type: "string" },
            checkpointArtifactRef: { type: "string" },
            checkpointArtifactDigest: { type: "string" },
          },
          required: [
            "workspaceId",
            "sessionId",
            "workspaceArtifactRef",
            "workspaceArtifactDigest",
            "sessionArtifactRef",
            "sessionArtifactDigest",
            "checkpointArtifactRef",
            "checkpointArtifactDigest",
          ],
          additionalProperties: false,
        },
        metadata: {
          type: "object",
          description: "Opaque metadata stored on both the session and trace.",
          additionalProperties: true,
        },
      },
      required: ["title"],
    },
    handler: async (args: {
      title: string;
      workflowName?: string;
      description?: string;
      type?: "manual" | "agent" | "swarm" | "cron" | "scheduled";
      visibility?: "public" | "private";
      goalId?: string;
      visionSnapshot?: string;
      successCriteria?: string[];
      sourceRefs?: Array<{
        label: string;
        href?: string;
        note?: string;
        kind?: string;
      }>;
      nativeSessionReference?: {
        workspaceId: string;
        sessionId: string;
        workspaceArtifactRef: string;
        workspaceArtifactDigest: string;
        sessionArtifactRef: string;
        sessionArtifactDigest: string;
        checkpointArtifactRef: string;
        checkpointArtifactDigest: string;
      };
      metadata?: Record<string, unknown>;
    }) => {
      const start = Date.now();
      const result = await callGateway<{
        sessionId: string;
        traceId: string;
        publicTraceId: string;
        status: string;
      }>("mcpStartExecutionRun", {
        title: args.title,
        workflowName: args.workflowName ?? args.title,
        description: args.description,
        type: args.type ?? "agent",
        visibility: args.visibility ?? "private",
        goalId: args.goalId,
        visionSnapshot: args.visionSnapshot,
        successCriteria: args.successCriteria,
        sourceRefs: args.sourceRefs,
        nativeSessionReference: args.nativeSessionReference,
        metadata: args.metadata,
      });

      if (!result.success) {
        return {
          error: true,
          message: result.error,
          latencyMs: Date.now() - start,
        };
      }

      return {
        success: true,
        latencyMs: Date.now() - start,
        sessionId: result.data.sessionId,
        traceId: result.data.traceId,
        publicTraceId: result.data.publicTraceId,
        status: result.data.status,
        instructions: [
          "Run started. Record execution steps and evidence against this trace ID.",
          "Use record_execution_step for meaningful actions, then record_execution_decision and attach_execution_evidence as you go.",
          "Close the run with complete_execution_run when verification finishes.",
        ],
      };
    },
  },
  {
    name: "complete_execution_run",
    description:
      "Finish a live execution run by updating session status, trace status, and optional usage metrics. Use this after the workflow either completes or fails.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Convex agentTaskSessions ID.",
        },
        traceId: {
          type: "string",
          description: "Convex agentTaskTraces ID.",
        },
        status: {
          type: "string",
          enum: ["completed", "failed"],
          description: "Terminal run status.",
        },
        crossCheckStatus: {
          type: "string",
          enum: ["aligned", "drifting", "violated"],
          description: "Optional Oracle alignment status.",
        },
        deltaFromVision: {
          type: "string",
          description: "Optional operator-facing drift summary.",
        },
        errorMessage: {
          type: "string",
          description: "Required when status is failed.",
        },
        inputTokens: {
          type: "number",
          description: "Optional input token count.",
        },
        outputTokens: {
          type: "number",
          description: "Optional output token count.",
        },
        toolsUsed: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tools used during the run.",
        },
        agentsInvolved: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of agents involved in the run.",
        },
        estimatedCostUsd: {
          type: "number",
          description: "Optional estimated cost in USD.",
        },
      },
      required: ["sessionId", "traceId", "status"],
    },
    handler: async (args: {
      sessionId: string;
      traceId: string;
      status: "completed" | "failed";
      crossCheckStatus?: "aligned" | "drifting" | "violated";
      deltaFromVision?: string;
      errorMessage?: string;
      inputTokens?: number;
      outputTokens?: number;
      toolsUsed?: string[];
      agentsInvolved?: string[];
      estimatedCostUsd?: number;
    }) => {
      const start = Date.now();
      const totalTokens = (args.inputTokens ?? 0) + (args.outputTokens ?? 0);

      if (args.status === "failed" && !args.errorMessage) {
        return {
          error: true,
          message:
            "errorMessage is required when completing an execution run with status='failed'.",
          latencyMs: Date.now() - start,
        };
      }

      if (
        args.inputTokens !== undefined ||
        args.outputTokens !== undefined ||
        args.toolsUsed !== undefined ||
        args.agentsInvolved !== undefined ||
        args.estimatedCostUsd !== undefined
      ) {
        const metricsResult = await callGateway<null>("updateSessionMetrics", {
          sessionId: args.sessionId,
          totalTokens,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          toolsUsed: args.toolsUsed,
          agentsInvolved: args.agentsInvolved,
          estimatedCostUsd: args.estimatedCostUsd,
        });

        if (!metricsResult.success) {
          return {
            error: true,
            message: metricsResult.error,
            latencyMs: Date.now() - start,
          };
        }
      }

      const traceResult = await callGateway<null>("completeTrace", {
        traceId: args.traceId,
        status: args.status === "failed" ? "error" : "completed",
        tokenUsage:
          args.inputTokens !== undefined || args.outputTokens !== undefined
            ? {
                input: args.inputTokens ?? 0,
                output: args.outputTokens ?? 0,
                total: totalTokens,
              }
            : undefined,
        estimatedCostUsd: args.estimatedCostUsd,
        crossCheckStatus: args.crossCheckStatus,
        deltaFromVision: args.deltaFromVision,
      });

      if (!traceResult.success) {
        return {
          error: true,
          message: traceResult.error,
          latencyMs: Date.now() - start,
        };
      }

      const sessionResult = await callGateway<null>("updateSessionStatus", {
        sessionId: args.sessionId,
        status: args.status,
        errorMessage: args.errorMessage,
        crossCheckStatus: args.crossCheckStatus,
        deltaFromVision: args.deltaFromVision,
      });

      if (!sessionResult.success) {
        return {
          error: true,
          message: sessionResult.error,
          latencyMs: Date.now() - start,
        };
      }

      return {
        success: true,
        latencyMs: Date.now() - start,
        sessionId: args.sessionId,
        traceId: args.traceId,
        status: args.status,
      };
    },
  },
  {
    name: "record_execution_step",
    description:
      "Record a structured execution step receipt on a live execution trace. Use this for meaningful actions like file inspection, research queries, edits, exports, or issue fixes.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Convex agentTaskTraces ID." },
        parentSpanId: {
          type: "string",
          description: "Optional parent span ID.",
        },
        stage: {
          type: "string",
          enum: [
            "ingest",
            "inspect",
            "research",
            "propose",
            "edit",
            "verify",
            "export",
            "summarize",
          ],
        },
        type: {
          type: "string",
          enum: [
            "task_started",
            "file_loaded",
            "sheet_inspected",
            "format_detected",
            "research_query_executed",
            "evidence_attached",
            "decision_recorded",
            "cells_updated",
            "comment_added",
            "style_changed",
            "render_generated",
            "issue_detected",
            "issue_fixed",
            "verification_passed",
            "artifact_exported",
            "task_completed",
          ],
        },
        title: { type: "string" },
        tool: { type: "string" },
        action: { type: "string" },
        target: { type: "string" },
        resultSummary: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        artifactsOut: { type: "array", items: { type: "string" } },
        verification: { type: "array", items: { type: "string" } },
        confidence: { type: "number" },
        startedAt: { type: "number" },
        endedAt: { type: "number" },
        metadata: { type: "object", additionalProperties: true },
      },
      required: [
        "traceId",
        "stage",
        "type",
        "title",
        "tool",
        "action",
        "target",
        "resultSummary",
      ],
    },
    handler: async (args: Record<string, unknown>) => {
      const start = Date.now();
      const result = await callGateway<string>("recordStep", args);
      if (!result.success) {
        return {
          error: true,
          message: result.error,
          latencyMs: Date.now() - start,
        };
      }
      return {
        success: true,
        latencyMs: Date.now() - start,
        spanId: result.data,
        traceId: args.traceId,
      };
    },
  },
  {
    name: "record_execution_decision",
    description:
      "Record a structured decision on a live execution trace without storing raw hidden reasoning. Use for rankings, selections, rejections, or escalation logic grounded in evidence.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Convex agentTaskTraces ID." },
        decisionType: {
          type: "string",
          description:
            "Decision type, e.g. ranking, selection, rejection, escalation.",
        },
        statement: { type: "string", description: "Decision statement." },
        basis: {
          type: "array",
          items: { type: "string" },
          description: "Concise reasons supporting the choice.",
        },
        evidenceRefs: { type: "array", items: { type: "string" } },
        alternativesConsidered: { type: "array", items: { type: "string" } },
        confidence: { type: "number" },
        limitations: { type: "array", items: { type: "string" } },
      },
      required: ["traceId", "decisionType", "statement", "basis"],
    },
    handler: async (args: Record<string, unknown>) => {
      const start = Date.now();
      const result = await callGateway<string>("recordDecision", args);
      if (!result.success) {
        return {
          error: true,
          message: result.error,
          latencyMs: Date.now() - start,
        };
      }
      return {
        success: true,
        latencyMs: Date.now() - start,
        traceId: result.data,
        decisionType: args.decisionType,
      };
    },
  },
  {
    name: "record_execution_verification",
    description:
      "Record a verification result on a live execution trace. Use for render checks, formula checks, diff checks, artifact integrity checks, and issue-fix confirmations.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Convex agentTaskTraces ID." },
        label: { type: "string", description: "Short verification label." },
        status: {
          type: "string",
          enum: ["passed", "warning", "failed", "fixed"],
        },
        details: {
          type: "string",
          description: "Human-readable verification details.",
        },
        relatedArtifactIds: { type: "array", items: { type: "string" } },
        createGuardrailSpan: {
          type: "boolean",
          description:
            "Whether to also create a guardrail span (default true).",
        },
      },
      required: ["traceId", "label", "status", "details"],
    },
    handler: async (args: Record<string, unknown>) => {
      const start = Date.now();
      const result = await callGateway<string>("recordVerification", args);
      if (!result.success) {
        return {
          error: true,
          message: result.error,
          latencyMs: Date.now() - start,
        };
      }
      return {
        success: true,
        latencyMs: Date.now() - start,
        traceId: result.data,
        label: args.label,
        status: args.status,
      };
    },
  },
  {
    name: "record_execution_graph_event",
    description:
      "Append one exact NodeKit stage-local graph event to a live execution trace. Use NodeKit-produced graph, frontier, edge-binding, artifact, and review-context identifiers; this tool records the evidence-bound handoff and never infers readiness from process exit status.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string" },
        eventType: {
          type: "string",
          enum: [
            "node.started",
            "edge.consumed",
            "artifact.produced",
            "node.completed",
            "node.failed",
            "barrier.opened",
            "barrier.blocked",
          ],
        },
        graphId: { type: "string" },
        graphHash: { type: "string" },
        caseId: { type: "string" },
        stageId: { type: "string" },
        caseContentHash: { type: "string" },
        nodeId: { type: "string" },
        nodeRunId: { type: "string" },
        nodeKind: { type: "string", enum: ["task", "review", "barrier"] },
        frontierHash: { type: "string" },
        edgeId: { type: "string" },
        bindingId: { type: "string" },
        bindingHash: { type: "string" },
        artifactId: { type: "string" },
        artifactSchemaVersion: { type: "string" },
        artifactContentHash: { type: "string" },
        authorityKind: {
          type: "string",
          enum: [
            "agent-produced",
            "deterministic",
            "human-attested",
            "nodeproof-verified",
          ],
        },
        status: { type: "string" },
        reasonCode: { type: "string" },
        blockingEdgeCount: { type: "number" },
        reviewContextRef: { type: "string" },
        reviewSeparation: {
          type: "string",
          enum: [
            "same-context",
            "fresh-context",
            "independent-model",
            "independent-human",
          ],
        },
        protectedEvaluator: { type: "boolean" },
      },
      required: [
        "traceId",
        "eventType",
        "graphId",
        "graphHash",
        "caseId",
        "stageId",
        "caseContentHash",
        "nodeId",
        "nodeRunId",
      ],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>) => {
      const start = Date.now();
      const result = await callGateway<string>(
        "recordExecutionGraphEvent",
        args,
      );
      if (!result.success) {
        return {
          error: true,
          message: result.error,
          latencyMs: Date.now() - start,
        };
      }
      return {
        success: true,
        latencyMs: Date.now() - start,
        eventHash: result.data,
        traceId: args.traceId,
        eventType: args.eventType,
      };
    },
  },
  {
    name: "attach_execution_evidence",
    description:
      "Attach evidence to a live execution trace. Use for URLs, uploaded files, screenshots, render outputs, and truth-boundary notes that support or qualify the workflow output.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Convex agentTaskTraces ID." },
        title: { type: "string", description: "Evidence title." },
        summary: {
          type: "string",
          description: "What this evidence supports or qualifies.",
        },
        sourceRefs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              href: { type: "string" },
              note: { type: "string" },
              kind: { type: "string" },
            },
            required: ["label"],
          },
        },
        supportedClaims: { type: "array", items: { type: "string" } },
        unsupportedClaims: { type: "array", items: { type: "string" } },
      },
      required: ["traceId", "title", "summary", "sourceRefs"],
    },
    handler: async (args: Record<string, unknown>) => {
      const start = Date.now();
      const result = await callGateway<string>("attachEvidence", args);
      if (!result.success) {
        return {
          error: true,
          message: result.error,
          latencyMs: Date.now() - start,
        };
      }
      return {
        success: true,
        latencyMs: Date.now() - start,
        traceId: result.data,
        title: args.title,
      };
    },
  },
  {
    name: "request_execution_approval",
    description:
      "Request a human approval gate for a risky execution-trace action. Approval state is written onto the live run so the UI and ledger can show the pending handoff.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Convex agentTaskSessions ID.",
        },
        traceId: {
          type: "string",
          description: "Optional related agentTaskTraces ID.",
        },
        toolName: {
          type: "string",
          description: "Tool or action requiring approval.",
        },
        toolArgs: {
          type: "object",
          additionalProperties: true,
          description: "Arguments or change payload for the risky action.",
        },
        riskLevel: { type: "string", enum: ["low", "medium", "high"] },
        justification: {
          type: "string",
          description:
            "Why approval is needed and what will happen if approved.",
        },
      },
      required: ["sessionId", "toolName", "riskLevel", "justification"],
    },
    handler: async (args: Record<string, unknown>) => {
      const start = Date.now();
      const result = await callGateway<string>("requestTraceApproval", args);
      if (!result.success) {
        return {
          error: true,
          message: result.error,
          latencyMs: Date.now() - start,
        };
      }
      return {
        success: true,
        latencyMs: Date.now() - start,
        approvalId: result.data,
        sessionId: args.sessionId,
        traceId: args.traceId,
        riskLevel: args.riskLevel,
      };
    },
  },
];
