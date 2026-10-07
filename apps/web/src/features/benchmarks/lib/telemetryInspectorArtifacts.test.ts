import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildTelemetryInspectorRunsFromEvalArtifact,
  type EnterpriseEvalArtifact,
} from "./telemetryInspectorArtifacts";

describe("telemetryInspectorArtifacts", () => {
  it("converts the latest enterprise eval artifact into inspector runs", () => {
    const artifact = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "docs/architecture/benchmarks/enterprise-investigation-eval-latest.json"),
        "utf8",
      ),
    ) as EnterpriseEvalArtifact;

    const runs = buildTelemetryInspectorRunsFromEvalArtifact(artifact);

    expect(runs.length).toBeGreaterThanOrEqual(artifact.cases.length);
    expect(runs.some((run) => run.tags.includes("enterpriseInvestigation"))).toBe(true);
    expect(runs.every((run) => run.steps.length >= 3)).toBe(true);
    // Fixture video url is null (pending_capture) — conversion normalizes null → undefined
    const expectedVideoUrl = artifact.stream.video?.url ?? undefined;
    expect(runs.every((run) => run.videoUrl === expectedVideoUrl)).toBe(true);
    expect(
      runs.some((run) =>
        run.steps.some(
          (step) =>
            step.title === "Required LLM judge verdict" &&
            step.response.llmJudge &&
            typeof step.response.llmJudge === "object",
        ),
      ),
    ).toBe(true);
  });

  it("supports v2 investigation payload artifacts without legacy fields", () => {
    const artifact: EnterpriseEvalArtifact = {
      generatedAt: "2026-03-15T00:00:00.000Z",
      summary: {
        totalCases: 1,
        passedCases: 1,
        deterministicAverage: 92,
        llmJudgeAverage: 89,
        totalEstimatedTokens: 1200,
      },
      cases: [
        {
          caseId: "v2-case",
          title: "Investigation payload v2 case",
          dataset: "public-fixture",
          query: "Investigate a deployment-driven outage",
          deterministic: {
            overall: 92,
            passed: true,
          },
          llmJudge: {
            score: 89,
            passed: true,
            reasoning: "The investigation reconstructs the failure and remediation path.",
          },
          telemetry: {
            totalDurationMs: 1200,
            anomalyCount: 2,
            causalChainLength: 2,
            sourceHashCount: 2,
            proposedAction: "Require approval for high-risk deploys",
          },
          investigation: {
            meta: {
              query: "Investigate a deployment-driven outage",
              overall_confidence: 0.87,
            },
            observed_facts: [
              { statement: "A deploy increased error rates.", evidence_refs: ["ev-1"] },
              { statement: "A rollback restored service.", evidence_refs: ["ev-2"] },
            ],
            derived_signals: {
              anomalies: [{ signal_key: "error_rate" }],
              forecast: {
                summary: "Risk remains elevated for the next 24 hours.",
                confidence: 0.78,
                evidence_refs: ["ev-1"],
              },
            },
            hypotheses: [
              {
                statement: "The deploy pipeline lacked guardrails.",
                status: "best_supported",
                confidence: 0.81,
              },
            ],
            counter_analysis: {
              result: "Traffic spike was tested and rejected as the primary cause.",
              questions_tested: ["Was this purely a traffic event?"],
            },
            recommended_actions: [
              {
                priority: "P0",
                action: "Require approval for high-risk deploys",
                human_gate: "APPROVE_REQUIRED",
              },
            ],
            evidence_catalog: [
              { content_hash: "sha256:abc", source_uri: "https://example.com/e1" },
              { content_hash: "sha256:def", source_uri: "https://example.com/e2" },
            ],
            traceability: {
              trace_id: "trace-123",
              tool_calls: 4,
              replay_url: "https://example.com/replay/123",
              otel_spans_recorded: true,
              artifact_integrity: "verified_for_captured_items",
            },
            limitations: ["Fixture-backed coverage only."],
          },
        },
      ],
      stream: {
        object: "enterprise_investigation_eval_stream",
        events: [
          {
            at: "2026-03-15T00:00:00.000Z",
            type: "case.started",
            caseId: "v2-case",
            detail: "Case started.",
          },
          {
            at: "2026-03-15T00:00:01.000Z",
            type: "case.investigation_built",
            caseId: "v2-case",
            detail: "Investigation built.",
            telemetry: {
              confidenceScore: 0.87,
            },
          },
          {
            at: "2026-03-15T00:00:02.000Z",
            type: "case.judged",
            caseId: "v2-case",
            detail: "Judge finished.",
          },
          {
            at: "2026-03-15T00:00:03.000Z",
            type: "case.completed",
            caseId: "v2-case",
            detail: "Case completed.",
          },
        ],
        finalVerdict: "PASS",
        telemetry: {
          totalEstimatedTokens: 1200,
          averageJudgeScore: 89,
          averageDeterministicScore: 92,
        },
        video: {
          status: "ready",
          url: "https://example.com/video.mp4",
        },
      },
      failures: [],
    };

    const runs = buildTelemetryInspectorRunsFromEvalArtifact(artifact);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.confidence).toBe(0.87);
    expect(runs[0]?.summary).toContain("Traffic spike was tested and rejected");
    expect(runs[0]?.tags).toContain("traceable");
    expect(runs[0]?.videoUrl).toBe("https://example.com/video.mp4");
    expect(
      runs[0]?.steps.some((step) =>
        step.warnings?.some((warning) => warning.includes("1 anomaly signal(s) detected before synthesis.")),
      ),
    ).toBe(true);
    expect(
      runs[0]?.steps.find((step) => step.title === "Proof pack and final telemetry")?.response.replayUrl,
    ).toBe("https://example.com/replay/123");
  });
});
