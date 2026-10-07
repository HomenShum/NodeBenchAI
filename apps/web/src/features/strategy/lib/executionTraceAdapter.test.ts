import { describe, expect, it } from "vitest";

import type { TaskSession, TaskSpan, TaskTrace } from "@/features/agents/components/TaskManager/types";

import { buildExecutionTraceFromLiveRun } from "./executionTraceAdapter";

describe("buildExecutionTraceFromLiveRun", () => {
  it("maps a live saved run into the execution trace contract", () => {
    const session = {
      _id: "session_live_1",
      title: "Live spreadsheet enrichment",
      description: "Inspect a workbook, research company positioning, and export a verified result.",
      type: "agent",
      visibility: "public",
      status: "completed",
      startedAt: Date.parse("2026-03-11T18:00:00.000Z"),
      completedAt: Date.parse("2026-03-11T18:08:00.000Z"),
      totalDurationMs: 480000,
      totalTokens: 14000,
      goalId: "goal_live_1",
      successCriteria: ["Keep recommendations inside the verified reputation boundary."],
      sourceRefs: [{ label: "Tests Assured site", href: "https://testsassured.com/", kind: "company_website" }],
      crossCheckStatus: "aligned",
      toolsUsed: ["web_search", "spreadsheet_edit"],
      metadata: {
        uploadedFiles: ["/mnt/data/ideas.xlsx"],
        outputs: ["/mnt/data/ideas_filled.xlsx"],
      },
    } as unknown as TaskSession & { metadata?: unknown };

    const traces = [
      {
        _id: "trace_live_1",
        sessionId: "session_live_1",
        traceId: "trace-1",
        workflowName: "Research positioning",
        status: "completed",
        startedAt: Date.parse("2026-03-11T18:01:00.000Z"),
        endedAt: Date.parse("2026-03-11T18:03:00.000Z"),
        totalDurationMs: 120000,
        sourceRefs: [{ label: "Tests Assured site", href: "https://testsassured.com/", kind: "company_website" }],
        metadata: {
          summary: "Collected public positioning and truth-boundary evidence.",
          toolSequence: ["web_search"],
          executionTraceEvidence: [
            {
              title: "Public positioning evidence",
              summary: "Captured public positioning and truth-boundary support.",
              sourceRefs: [{ label: "Tests Assured site", href: "https://testsassured.com/", kind: "company_website" }],
              supportedClaims: ["immersive-tech QA positioning"],
              unsupportedClaims: ["formal Meta contract scope"],
            },
          ],
          executionTraceDecisions: [
            {
              decisionType: "ranking",
              statement: "Agentic QA Control Plane was ranked as the primary recommendation.",
              basis: ["Best fit with public reputation.", "Lowest identity-mismatch risk."],
              evidenceRefs: ["evidence_ref_2"],
              alternativesConsidered: ["Private Device Lab", "XR training sandbox"],
            },
          ],
        },
      },
      {
        _id: "trace_live_2",
        sessionId: "session_live_1",
        traceId: "trace-2",
        workflowName: "Verify workbook export",
        status: "completed",
        startedAt: Date.parse("2026-03-11T18:05:00.000Z"),
        endedAt: Date.parse("2026-03-11T18:07:00.000Z"),
        totalDurationMs: 120000,
        crossCheckStatus: "aligned",
        metadata: {
          summary: "Rendered and rechecked the saved workbook.",
          outputs: [{ path: "/tmp/render.png", kind: "png", label: "Rendered preview" }],
          executionTraceVerificationChecks: [
            {
              label: "Workbook render check",
              status: "passed",
              details: "Rendered workbook passed layout review.",
              relatedArtifactIds: ["/tmp/render.png"],
            },
          ],
        },
      },
    ] as unknown as Array<TaskTrace & { metadata?: unknown }>;

    const spans = [
      {
        _id: "span_live_1",
        traceId: "trace_live_1",
        seq: 0,
        depth: 0,
        spanType: "retrieval",
        name: "Web search",
        status: "completed",
        startedAt: Date.parse("2026-03-11T18:01:05.000Z"),
        endedAt: Date.parse("2026-03-11T18:01:35.000Z"),
        durationMs: 30000,
        data: {
          tool: "web_search",
          query: "Tests Assured Meta QA",
          executionTraceStep: {
            stage: "research",
            type: "research_query_executed",
            title: "Search public reputation",
            tool: "web_search",
            action: "search_public_sources",
            target: "Tests Assured public footprint",
            resultSummary: "Collected public reputation evidence and unsupported-claim boundaries.",
            evidenceRefs: ["evidence_ref_2"],
            artifactsOut: [],
            verification: ["Used public sources only."],
            confidence: 0.88,
          },
        },
      },
      {
        _id: "span_live_2",
        traceId: "trace_live_2",
        seq: 1,
        depth: 0,
        spanType: "guardrail",
        name: "Render verification",
        status: "completed",
        startedAt: Date.parse("2026-03-11T18:06:00.000Z"),
        endedAt: Date.parse("2026-03-11T18:06:20.000Z"),
        durationMs: 20000,
        metadata: { summary: "Render check passed." },
      },
    ] as unknown as TaskSpan[];

    const trace = buildExecutionTraceFromLiveRun({ session, traces, spans });

    expect(trace.run.run_id).toBe("session_live_1");
    expect(trace.inputs.uploaded_files).toContain("/mnt/data/ideas.xlsx");
    expect(trace.outputs.some((output: any) => output.path === "/mnt/data/ideas_filled.xlsx")).toBe(true);
    expect(trace.evidence_catalog.some((item: any) => item.title === "Tests Assured site")).toBe(true);
    expect(trace.evidence_catalog.some((item: any) => item.title === "Public positioning evidence")).toBe(true);
    expect(trace.steps.some((step: any) => step.title === "Search public reputation")).toBe(true);
    expect(
      trace.decisions.some(
        (decision: any) =>
          decision.statement === "Agentic QA Control Plane was ranked as the primary recommendation.",
      ),
    ).toBe(true);
    expect(trace.verification_checks.some((check: any) => check.label === "Workbook render check")).toBe(true);
  });
});
