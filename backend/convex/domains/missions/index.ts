export * from "./missionOrchestrator";
export * from "./costQueries";
// preExecutionGate.ts is "use node" — cannot re-export from a non-"use node" barrel.
// Access via internal.domains.missions.preExecutionGate.evaluatePreExecutionGate
export * from "./preExecutionGateQueries";

// Re-export shared ActionSpan adapter for mission consumers
export {
  runStepToActionSpan,
  type ActionSpan,
  type EvidenceRef,
  type JudgeResult,
  type CostRecord,
  type EscalationStatus,
  type ActorIdentity,
  actionSpanValidator,
} from "../../shared/actionSpan";
