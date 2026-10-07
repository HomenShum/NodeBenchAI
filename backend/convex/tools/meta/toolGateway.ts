/**
 * Tool Execution Gateway
 *
 * The single most important architectural component for progressive disclosure.
 * ALL non-meta tool execution must flow through this gateway.
 *
 * Responsibilities:
 * 1. Enforce skill activation requirement for non-meta tools
 * 2. Validate tool allowlists from active skills
 * 3. Classify and handle risk tiers (read-only, write, destructive)
 * 4. Log disclosure events for telemetry
 * 5. Handle confirmation flow for write/destructive operations (future)
 *
 * @see docs/architecture/progressive-disclosure-gap-analysis.md Section 9
 */

import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { DisclosureLogger, type DisclosureSurface } from "../../domains/telemetry/disclosureEvents";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Meta-tools that bypass skill requirement.
 * These are the discovery/navigation tools that help agents find the right skills/tools.
 */
export const META_TOOLS = new Set([
  // Skill discovery
  "searchAvailableSkills",
  "describeSkill",
  "listSkillCategories",
  // Tool discovery
  "searchAvailableTools",
  "describeTools",
  "listToolCategories",
  // The gateway itself
  "invokeTool",
]);

/**
 * Risk tiers for built-in tools.
 * - read-only: No confirmation required, executes immediately
 * - write: Creates/modifies data, requires confirmation in strict mode
 * - destructive: Deletes data or has significant side effects, always requires confirmation
 */
export const TOOL_RISK_TIERS: Record<string, "read-only" | "write" | "destructive"> = {
  // Read-only tools (safe to execute without confirmation)
  lookupGroundTruthEntity: "read-only",
  getBankerGradeEntityInsights: "read-only",
  searchAvailableSkills: "read-only",
  listSkillCategories: "read-only",
  describeSkill: "read-only",
  searchAvailableTools: "read-only",
  listToolCategories: "read-only",
  describeTools: "read-only",
  listEvents: "read-only",
  searchDocuments: "read-only",
  getDocumentById: "read-only",
  searchEntities: "read-only",
  getEntityById: "read-only",
  linkupSearch: "read-only",
  linkupFetch: "read-only",
  evaluateEntityForPersona: "read-only",

  // Write tools (create or modify data)
  createDocument: "write",
  updateDocument: "write",
  createEntity: "write",
  updateEntity: "write",
  addFeedItem: "write",
  scheduleDigest: "write",

  // Destructive tools (delete data or significant side effects)
  deleteDocument: "destructive",
  deleteEntity: "destructive",
  clearCache: "destructive",
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Active skill context for gateway decisions.
 */
export interface ActiveSkill {
  name: string;
  allowedTools: string[];
}

/**
 * Context required for gateway operations.
 */
export interface GatewayContext {
  ctx: ActionCtx;
  logger: DisclosureLogger;
  activeSkill: ActiveSkill | null;
  /** Session ID for action draft tracking */
  sessionId?: string;
  userId?: string;
  /** If true, skip confirmation flow even for write/destructive tools */
  bypassConfirmation?: boolean;
}

/**
 * Result of a gateway execution.
 */
export type GatewayResult<T> =
  | { status: "success"; result: T; latencyMs: number }
  | { status: "blocked"; blockedReason: string; rule: string }
  | { status: "pending_confirmation"; draftId: string; toolName: string; riskTier: string }
  | { status: "error"; error: string };

/**
 * Tool executor function type.
 */
export type ToolExecutor<T = unknown> = (
  ctx: ActionCtx,
  toolName: string,
  args: Record<string, unknown>
) => Promise<T>;

// ═══════════════════════════════════════════════════════════════════════════
// GATEWAY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The single gateway for all tool execution.
 * Enforces: skill activation, risk tiers, confirmation flow, logging.
 *
 * @param toolName - The name of the tool to execute
 * @param args - Arguments to pass to the tool
 * @param gatewayCtx - Gateway context with logger, active skill, etc.
 * @param executor - Function that actually executes the tool
 * @returns Gateway result with status and result/error
 */
export async function executeViaGateway<T>(
  toolName: string,
  args: Record<string, unknown>,
  gatewayCtx: GatewayContext,
  executor: ToolExecutor<T>
): Promise<GatewayResult<T>> {
  const { ctx, logger, activeSkill, bypassConfirmation } = gatewayCtx;
  const startTime = Date.now();

  // 1. Meta-tools always allowed (they ARE the discovery mechanism)
  if (META_TOOLS.has(toolName)) {
    return executeDirectly(toolName, args, gatewayCtx, executor);
  }

  // 2. Non-meta tools require active skill (unless in permissive mode)
  if (!activeSkill) {
    const reason = `Tool "${toolName}" requires an active skill. Use searchAvailableSkills + describeSkill first.`;
    logger.logEnforcementBlocked("skill_required", reason, toolName);
    return {
      status: "blocked",
      blockedReason: reason,
      rule: "skill_required",
    };
  }

  // 3. Check tool is in active skill's allowlist
  if (activeSkill.allowedTools.length > 0 && !activeSkill.allowedTools.includes(toolName)) {
    const reason = `Tool "${toolName}" is not allowed by active skill "${activeSkill.name}". Allowed: ${activeSkill.allowedTools.join(", ")}`;
    logger.logEnforcementBlocked("skill_allowlist", reason, toolName);
    return {
      status: "blocked",
      blockedReason: reason,
      rule: "skill_allowlist",
    };
  }

  // 4. Check risk tier
  const riskTier = TOOL_RISK_TIERS[toolName] ?? "read-only";

  if ((riskTier === "write" || riskTier === "destructive") && !bypassConfirmation) {
    // Create action draft for confirmation
    try {
      const draftId = await ctx.runMutation(
        internal.tools.meta.actionDraftMutations.createActionDraft,
        {
          sessionId: gatewayCtx.sessionId || "unknown",
          userId: gatewayCtx.userId as any,
          toolName,
          args: JSON.stringify(args),
          riskTier: riskTier,
          actionSummary: generateActionSummary(toolName, args),
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute timeout
        }
      );

      logger.logConfirmationRequested(toolName, String(draftId), riskTier);

      return {
        status: "pending_confirmation",
        draftId: String(draftId),
        toolName,
        riskTier,
      };
    } catch (error) {
      // If draft creation fails, log and proceed with execution (graceful degradation)
      console.warn(`[gateway] Failed to create action draft: ${error}`);
      logger.logConfirmationRequested(toolName, "fallback", riskTier);
    }
  }

  // 5. Execute the tool
  return executeDirectly(toolName, args, gatewayCtx, executor);
}

/**
 * Generate a human-readable summary of the action for confirmation UI.
 */
function generateActionSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "createEvent":
      return `Create calendar event: "${args.title || "Untitled"}" on ${args.startTime || "unknown date"}`;
    case "deleteEvent":
      return `Delete calendar event: ${args.eventId || "unknown event"}`;
    case "sendEmail":
      return `Send email to: ${args.to || "unknown recipient"} - Subject: "${args.subject || "No subject"}"`;
    case "createDocument":
      return `Create document: "${args.title || "Untitled document"}"`;
    case "deleteDocument":
      return `Delete document: ${args.documentId || "unknown document"}`;
    case "updateNarrativeSection":
      return `Update document section: ${args.sectionId || "unknown section"}`;
    default:
      return `Execute ${toolName} with ${Object.keys(args).length} arguments`;
  }
}

/**
 * Execute a tool directly (bypassing gateway checks).
 * Used for meta-tools and after gateway validation passes.
 */
async function executeDirectly<T>(
  toolName: string,
  args: Record<string, unknown>,
  gatewayCtx: GatewayContext,
  executor: ToolExecutor<T>
): Promise<GatewayResult<T>> {
  const { ctx, logger } = gatewayCtx;
  const startTime = Date.now();

  try {
    const result = await executor(ctx, toolName, args);
    const latencyMs = Date.now() - startTime;

    // Log successful invocation
    logger.logToolInvoke(toolName, true, latencyMs);

    return {
      status: "success",
      result,
      latencyMs,
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log failed invocation
    logger.logToolInvoke(toolName, false, latencyMs, errorMessage);

    return {
      status: "error",
      error: errorMessage,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRMATION FLOW (P1 - Stubbed for now)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Confirm a pending action draft and execute the deferred action.
 * P1 implementation - requires action draft table in schema.
 */
export async function confirmActionDraft<T>(
  draftId: string,
  gatewayCtx: GatewayContext,
  executor: ToolExecutor<T>
): Promise<GatewayResult<T>> {
  const { logger } = gatewayCtx;

  // TODO: P1 implementation
  // 1. Retrieve draft from action drafts table
  // 2. Verify draft status is "pending"
  // 3. Update draft status to "confirmed"
  // 4. Execute the tool
  // 5. Log confirmation granted

  logger.logConfirmationGranted(draftId);

  // For now, return an error indicating this is not yet implemented
  return {
    status: "error",
    error: "Action draft confirmation not yet implemented (P1)",
  };
}

/**
 * Deny a pending action draft.
 * P1 implementation - requires action draft table in schema.
 */
export async function denyActionDraft(
  draftId: string,
  reason: string,
  gatewayCtx: GatewayContext
): Promise<void> {
  const { logger } = gatewayCtx;

  // TODO: P1 implementation
  // 1. Retrieve draft from action drafts table
  // 2. Update draft status to "denied"
  // 3. Log confirmation denied

  logger.logConfirmationDenied(draftId, reason);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a tool is a meta-tool (discovery/navigation).
 */
export function isMetaTool(toolName: string): boolean {
  return META_TOOLS.has(toolName);
}

/**
 * Get the risk tier for a tool.
 */
export function getToolRiskTier(toolName: string): "read-only" | "write" | "destructive" {
  return TOOL_RISK_TIERS[toolName] ?? "read-only";
}

/**
 * Check if a tool requires confirmation (write or destructive).
 */
export function requiresConfirmation(toolName: string): boolean {
  const tier = getToolRiskTier(toolName);
  return tier === "write" || tier === "destructive";
}

/**
 * Create a gateway context for an execution session.
 */
export function createGatewayContext(
  ctx: ActionCtx,
  sessionId: string,
  options: {
    userId?: string;
    bypassConfirmation?: boolean;
    surface?: DisclosureSurface;
  } = {}
): GatewayContext {
  const { userId, bypassConfirmation, surface = "fastAgent" } = options;

  return {
    ctx,
    logger: new DisclosureLogger(sessionId, surface),
    activeSkill: null,
    sessionId,
    userId,
    bypassConfirmation,
  };
}

/**
 * Update the active skill in a gateway context.
 * Called when describeSkill succeeds and a skill is activated.
 */
export function setActiveSkill(
  gatewayCtx: GatewayContext,
  skill: ActiveSkill | null
): void {
  gatewayCtx.activeSkill = skill;
}

/**
 * Get current active skill from gateway context.
 */
export function getActiveSkill(gatewayCtx: GatewayContext): ActiveSkill | null {
  return gatewayCtx.activeSkill;
}

/**
 * Get disclosure summary from gateway context.
 */
export function getGatewayDisclosureSummary(gatewayCtx: GatewayContext) {
  return gatewayCtx.logger.getSummary();
}
