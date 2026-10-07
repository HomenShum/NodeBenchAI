/**
 * Human-in-the-Loop (HITL) Configuration
 * 
 * Based on LangChain HITL patterns:
 * - Interrupt decision types: approve, edit, reject
 * - Configurable per-tool interrupt settings
 */

import { z } from "zod";

export const HITL_CONFIG = {
  name: "HITLManager",
  version: "1.0.0",
  defaultTimeout: 300000, // 5 minutes
};

// Decision types (LangChain pattern)
export const DECISION_TYPES = ["approve", "edit", "reject"] as const;
export type DecisionType = typeof DECISION_TYPES[number];

// Interrupt request schema
export const interruptRequestSchema = z.object({
  toolName: z.string().describe("Name of the tool requiring approval"),
  arguments: z.record(z.any()).describe("Arguments to the tool"),
  description: z.string().describe("Human-readable description of the action"),
  allowedDecisions: z.array(z.enum(DECISION_TYPES)).default(["approve", "reject"]),
});

export type InterruptRequest = z.infer<typeof interruptRequestSchema>;

// Decision response schema
export const decisionResponseSchema = z.object({
  type: z.enum(DECISION_TYPES),
  editedAction: z.object({
    name: z.string(),
    args: z.record(z.any()),
  }).optional().describe("For 'edit' decisions - modified tool call"),
  message: z.string().optional().describe("For 'reject' decisions - explanation"),
});

export type DecisionResponse = z.infer<typeof decisionResponseSchema>;

// Tools that require human approval by default
export const SENSITIVE_TOOLS: Record<string, { allowedDecisions: DecisionType[] }> = {
  "deleteEvent": { allowedDecisions: ["approve", "reject"] },
  "deleteTask": { allowedDecisions: ["approve", "reject"] },
  "bulkUpdate": { allowedDecisions: ["approve", "edit", "reject"] },
  "executeSQL": { allowedDecisions: ["approve", "reject"] },
  "writeFile": { allowedDecisions: ["approve", "edit", "reject"] },
};

// Check if a tool requires human approval
export function requiresApproval(toolName: string): boolean {
  return toolName in SENSITIVE_TOOLS;
}

// Get allowed decisions for a tool
export function getAllowedDecisions(toolName: string): DecisionType[] {
  return SENSITIVE_TOOLS[toolName]?.allowedDecisions || ["approve", "reject"];
}
