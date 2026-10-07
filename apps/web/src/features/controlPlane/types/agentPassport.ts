/**
 * AgentPassport — persistent identity for a user's agent with scoped authority.
 *
 * What it can read, spend, sign, reveal, and execute.
 * Fine-grained, revocable delegation with trust tiers.
 *
 * @see docs/architecture/AGENT_TRUST_INFRASTRUCTURE.md
 */

/** Trust tier determines default behavior for unspecified tools */
export type TrustTier = "sandbox" | "supervised" | "autonomous";

/** Tool-level permission */
export type ToolPermission = "allow" | "deny" | "escalate";

export interface AgentPassport {
  /** Unique passport identifier */
  passportId: string;
  /** User who owns this agent */
  userId: string;
  /** Human-readable agent name */
  displayName: string;
  /** Trust tier — determines default behavior for unspecified tools */
  trustTier: TrustTier;
  /** Explicit tool permissions (overrides trust tier defaults) */
  allowedTools: string[];
  deniedTools: string[];
  /** Tools that require human approval before execution */
  escalatedTools: string[];
  /** Maximum spend per action (USD, 0 = no spend allowed) */
  spendLimit: number;
  /** Data scope — which data domains this agent can access */
  dataScope: string[];
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 revocation timestamp (null = active) */
  revokedAt: string | null;
}

/** Passport summary for UI display */
export interface PassportSummary {
  passportId: string;
  displayName: string;
  trustTier: TrustTier;
  toolCount: { allowed: number; denied: number; escalated: number };
  active: boolean;
}
