/**
 * Engine Conformance Scoring
 *
 * Computes a deterministic conformance score from a session's tool call history.
 * Used to generate "Conformance Reports" — the sellable output of the engine.
 */

import type { EngineSession } from "./session.js";

export interface ConformanceBreakdown {
  stepsCompleted: boolean;
  qualityGatePassed: boolean;
  testLayersLogged: boolean;
  flywheelCompleted: boolean;
  learningsRecorded: boolean;
  reconPerformed: boolean;
  verificationCycleStarted: boolean;
  noErrors: boolean;
}

export interface ConformanceReport {
  sessionId: string;
  preset: string;
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: ConformanceBreakdown;
  summary: string;
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  totalDurationMs: number;
  generatedAt: number;
}

const FLYWHEEL_TOOLS = [
  "start_flywheel",
  "log_flywheel_step",
  "run_quality_gate",
];

const TEST_TOOLS = [
  "log_test_result",
];

const LEARNING_TOOLS = [
  "log_learning",
  "save_session_note",
  "search_all_knowledge",
];

const RECON_TOOLS = [
  "run_recon",
  "log_recon_finding",
];

const VERIFICATION_TOOLS = [
  "start_verification_cycle",
  "log_verification_step",
];

const QUALITY_GATE_TOOLS = [
  "run_quality_gate",
];

function hasToolCalled(session: EngineSession, toolNames: string[]): boolean {
  return toolNames.some((name) => session.successfulToolNames.has(name));
}

export function computeConformance(
  session: EngineSession,
  expectedSteps?: number,
): ConformanceReport {
  const history = session.callHistory;
  const successful = session.successfulCallCount;
  const failed = session.failedCallCount;
  const total = session.totalCallCount;
  const totalDurationMs = session.totalCallDurationMs;

  const breakdown: ConformanceBreakdown = {
    stepsCompleted: expectedSteps ? successful >= expectedSteps : successful > 0,
    qualityGatePassed: hasToolCalled(session, QUALITY_GATE_TOOLS),
    testLayersLogged: hasToolCalled(session, TEST_TOOLS),
    flywheelCompleted: hasToolCalled(session, FLYWHEEL_TOOLS),
    learningsRecorded: hasToolCalled(session, LEARNING_TOOLS),
    reconPerformed: hasToolCalled(session, RECON_TOOLS),
    verificationCycleStarted: hasToolCalled(session, VERIFICATION_TOOLS),
    noErrors: failed === 0,
  };

  // Score: each check is worth 12.5 points (8 checks × 12.5 = 100)
  const checks = Object.values(breakdown);
  const passed = checks.filter(Boolean).length;
  const score = Math.round((passed / checks.length) * 100);

  const grade: ConformanceReport["grade"] =
    score >= 90 ? "A" :
    score >= 75 ? "B" :
    score >= 60 ? "C" :
    score >= 40 ? "D" : "F";

  const failedChecks = Object.entries(breakdown)
    .filter(([, v]) => !v)
    .map(([k]) => k.replace(/([A-Z])/g, " $1").toLowerCase().trim());

  let summary = score === 100
    ? `All conformance checks passed. ${successful}/${total} tool calls succeeded in ${totalDurationMs}ms.`
    : `Score ${score}/100 (${grade}). Missing: ${failedChecks.join(", ")}. ${successful}/${total} calls succeeded.`;
  if (history.length < total) {
    summary += ` Trace and recovery extraction retain only the latest ${history.length} calls; totals and completed checks cover the full session.`;
  }

  return {
    sessionId: session.id,
    preset: session.preset,
    score,
    grade,
    breakdown,
    summary,
    totalSteps: total,
    successfulSteps: successful,
    failedSteps: failed,
    totalDurationMs,
    generatedAt: Date.now(),
  };
}
