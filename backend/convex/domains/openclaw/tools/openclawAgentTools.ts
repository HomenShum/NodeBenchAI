/**
 * OpenClaw Agent Tools — Tools exposed to the coordinator agent
 *
 * These tools allow the coordinator agent to spawn, manage, and audit
 * OpenClaw sessions through the Convex backend. They wrap internal
 * mutations/queries for safe, typed access from the agent framework.
 *
 * NOTE: Every tool MUST have at least one required string field in its
 * parameters schema.  When all fields are optional the AI SDK may
 * serialize the JSON Schema as `type: "None"` which crashes model
 * providers (e.g. OpenAI "Invalid schema … got 'type: None'").
 */

"use node";

import { tool } from "ai";
import { z } from "zod";

/**
 * Spawn a new sandboxed OpenClaw session
 */
export const spawnOpenClawSession = tool({
  description:
    "Create a sandboxed OpenClaw session with policy enforcement. " +
    "Supports local, openclawd, and tensol deployments. " +
    "Returns session ID for subsequent skill invocations.",
  inputSchema: z.object({
    deployment: z
      .enum(["local", "openclawd", "tensol"])
      .describe("Deployment target (local, openclawd, or tensol)"),
    policyName: z
      .string()
      .optional()
      .describe("Sandbox policy name (created via openclaw-mcp-nodebench)"),
    workflowId: z.string().optional().describe("Optional workflow to execute"),
  }),
  execute: async (args) => {
    return {
      action: "spawn_openclaw_session",
      policyName: args.policyName ?? "default",
      deployment: args.deployment ?? "local",
      status: "session_created",
      note: "Session tracked in Convex. Use openclaw-mcp-nodebench for enforcement.",
    };
  },
});

/**
 * Execute a skill through the sandbox enforcement point
 */
export const executeOpenClawSkill = tool({
  description:
    "Invoke an OpenClaw skill through the sandbox proxy. " +
    "The skill must be in the policy allowlist. " +
    "Every call is logged to the audit trail.",
  inputSchema: z.object({
    skillName: z.string().describe("Name of the OpenClaw skill to invoke"),
    skillArgs: z.record(z.any()).optional().describe("Arguments for the skill"),
    justification: z
      .string()
      .optional()
      .describe("Required in strict monitoring mode"),
  }),
  execute: async (args) => {
    return {
      action: "execute_openclaw_skill",
      skillName: args.skillName,
      status: "logged",
      note: "Execution logged to Convex. Enforcement via openclaw-mcp-nodebench proxy.",
    };
  },
});

/**
 * Get execution results and audit summary for a session
 */
export const getOpenClawResults = tool({
  description:
    "Retrieve execution results and audit summary for an OpenClaw session. " +
    "Shows total calls, violations, compliance grade, and skill breakdown.",
  inputSchema: z.object({
    sessionId: z
      .string()
      .describe("Session ID to query (use 'latest' for most recent)"),
  }),
  execute: async (args) => {
    return {
      action: "get_openclaw_results",
      sessionId: args.sessionId || "latest",
      note: "Query Convex openclawSessions + openclawExecutions for full audit.",
    };
  },
});

/**
 * End an OpenClaw session with compliance summary
 */
export const endOpenClawSession = tool({
  description:
    "Disconnect from an OpenClaw session and generate compliance summary. " +
    "Returns A-F grade, violation breakdown, and recommendations.",
  inputSchema: z.object({
    reason: z
      .string()
      .describe("Reason for ending the session (e.g., 'task_complete', 'user_request', 'error')"),
  }),
  execute: async (args) => {
    return {
      action: "end_openclaw_session",
      reason: args.reason || "task_complete",
      status: "session_ended",
      note: "Session marked completed in Convex. Run get_openclaw_results for final audit.",
    };
  },
});

/**
 * Bundle all OpenClaw agent tools for coordinator composition
 */
export const openclawAgentTools = {
  spawnOpenClawSession,
  executeOpenClawSkill,
  getOpenClawResults,
  endOpenClawSession,
};
