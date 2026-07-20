export * from "./queries";
export * from "./mutations";

// Re-export shared ActionSpan adapter for trajectory consumers
export {
  trajectorySpanToActionSpan,
  type ActionSpan,
  type EvidenceRef,
  type JudgeResult,
  type CostRecord,
  type EscalationStatus,
  type ActorIdentity,
  actionSpanValidator,
} from "../../shared/actionSpan";
