/**
 * Human-in-the-Loop (HITL) Module
 */

// Configuration
export { 
  HITL_CONFIG, 
  DECISION_TYPES, 
  SENSITIVE_TOOLS,
  requiresApproval,
  getAllowedDecisions,
  type DecisionType,
  type InterruptRequest,
  type DecisionResponse,
} from "./config";

// Interrupt manager (mutations/queries)
export {
  createInterrupt,
  getPendingInterrupts,
  resolveInterrupt,
  getInterrupt,
  cancelInterrupt,
} from "./interruptManager";

// Tools
export { askHumanSchema, askHumanToolDefinition, executeAskHuman } from "./tools";
