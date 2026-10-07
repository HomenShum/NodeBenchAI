import type { ForecastGateDecision } from "../temporal/forecastGatePolicy";

export type ForecastAwareOpenClawDirective =
  | "delegate_now"
  | "hold_for_packet_refresh"
  | "hold_for_diligence"
  | "hold_for_important_change_review"
  | "observe_only";

export interface ForecastAwareOpenClawHandoffInput {
  currentCompanyTruth?: string;
  activePacketId?: string;
  packetLineageId?: string;
  constraints?: string[];
  successCriteria?: string[];
  evidenceRefs?: string[];
  approvalRequired?: boolean;
  undoInstructions?: string;
  forecastGate: ForecastGateDecision;
}

export interface ForecastAwareOpenClawHandoff {
  shouldExecute: boolean;
  requiresApproval: boolean;
  executionDirective: ForecastAwareOpenClawDirective;
  reason: string;
  packet: {
    currentCompanyTruth?: string;
    activePacketId?: string;
    packetLineageId?: string;
    forecastGate: ForecastGateDecision;
    constraints: string[];
    successCriteria: string[];
    evidenceRefs: string[];
    undoInstructions?: string;
  };
}

function compactStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function buildForecastAwareOpenClawHandoff(
  input: ForecastAwareOpenClawHandoffInput,
): ForecastAwareOpenClawHandoff {
  const gate = input.forecastGate;
  const basePacket = {
    currentCompanyTruth: input.currentCompanyTruth,
    activePacketId: input.activePacketId,
    packetLineageId: input.packetLineageId,
    forecastGate: gate,
    constraints: compactStrings(input.constraints),
    successCriteria: compactStrings(input.successCriteria),
    evidenceRefs: compactStrings([...(input.evidenceRefs ?? []), ...(gate.evidenceRefs ?? [])]),
    undoInstructions: input.undoInstructions,
  };

  if (gate.recommendedAction === "delegate") {
    return {
      shouldExecute: true,
      requiresApproval: input.approvalRequired ?? true,
      executionDirective: "delegate_now",
      reason: "Forecast gate permits a bounded OpenClaw handoff.",
      packet: basePacket,
    };
  }

  if (gate.recommendedAction === "refresh_packet") {
    return {
      shouldExecute: false,
      requiresApproval: false,
      executionDirective: "hold_for_packet_refresh",
      reason: "Forecast gate requires packet refresh before OpenClaw execution.",
      packet: basePacket,
    };
  }

  if (gate.recommendedAction === "deepen_diligence") {
    return {
      shouldExecute: false,
      requiresApproval: false,
      executionDirective: "hold_for_diligence",
      reason: "Forecast gate requires deeper diligence before OpenClaw execution.",
      packet: basePacket,
    };
  }

  if (gate.recommendedAction === "escalate") {
    return {
      shouldExecute: false,
      requiresApproval: true,
      executionDirective: "hold_for_important_change_review",
      reason: "Forecast gate detected an important-change candidate; hold for review.",
      packet: basePacket,
    };
  }

  return {
    shouldExecute: false,
    requiresApproval: false,
    executionDirective: "observe_only",
    reason: "Forecast gate recommends observation and does not permit execution.",
    packet: basePacket,
  };
}
