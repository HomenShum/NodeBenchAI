/**
 * becPlaybook.ts
 *
 * BEC (Business Email Compromise) Procedural Controls Playbook.
 *
 * KEY INSIGHT: BEC defenses are not only "detect spoofing"; the winning move is
 * MANDATORY OUT-OF-BAND VERIFICATION when payment instructions, banking details,
 * or "urgent secrecy" patterns appear.
 *
 * This module generates:
 * 1. Procedural verification tasks (not optional suggestions)
 * 2. Two-person approval requirements for payment-related anomalies
 * 3. BEC playbook artifacts with signals + required next steps
 *
 * Reference: FBI IC3 BEC guidance
 * https://www.fbi.gov/how-we-can-help-you/scams-and-safety/common-frauds-and-scams/business-email-compromise
 */

import { DDRiskSignal } from "../../agents/dueDiligence/types";

// ============================================================================
// BEC PATTERN TYPES
// ============================================================================

/**
 * Types of BEC patterns detected
 */
export type BECPatternType =
  | "payment_instruction_change"   // "New bank account" / "Updated wire details"
  | "urgency_pressure"             // "ASAP" / "Act now" / "Time sensitive"
  | "secrecy_request"              // "Confidential" / "Don't tell anyone"
  | "authority_impersonation"      // CEO/CFO impersonation patterns
  | "email_domain_spoofing"        // Domain lookalike (examp1e.com vs example.com)
  | "compromised_thread"           // Reply-chain manipulation
  | "unusual_request"              // "Exception to process" / "Bypass approval";

/**
 * Detected BEC pattern with evidence
 */
export interface BECPattern {
  type: BECPatternType;
  severity: "medium" | "high" | "critical";
  detected: string;           // What was found
  context: string;            // Where it was found
  evidence: string;           // Exact quote/match
  timestamp: number;
}

// ============================================================================
// PROCEDURAL TASK TYPES
// ============================================================================

/**
 * Procedural verification task (mandatory, not optional)
 */
export interface BECVerificationTask {
  id: string;
  type: "callback_verification" | "dual_approval" | "document_request" | "identity_confirmation" | "freeze_transaction";
  priority: "high" | "critical";
  title: string;
  description: string;
  instructions: string[];
  requiredBefore: string;     // What action this blocks
  timeout: number;            // Hours before escalation
  assignedTo?: string;        // Role, not person
  requiresWitness: boolean;   // Two-person rule
  completionCriteria: string;
  escalationPath: string;
}

/**
 * BEC Playbook artifact (auto-generated when triggers fire)
 */
export interface BECPlaybook {
  id: string;
  entityName: string;
  generatedAt: number;
  expiresAt: number;          // Playbook validity window

  // Detection summary
  patternsDetected: BECPattern[];
  overallThreatLevel: "medium" | "high" | "critical";
  threatSummary: string;

  // Required actions (not suggestions)
  mandatoryTasks: BECVerificationTask[];
  blockedActions: string[];   // What can't proceed until tasks complete

  // Verification protocol
  verificationProtocol: {
    method: "phone_callback" | "in_person" | "video_call" | "physical_document";
    knownContactRequired: boolean;
    scriptedQuestions: string[];
  };

  // Audit trail
  auditTrail: Array<{
    timestamp: number;
    action: string;
    actor?: string;
    result?: string;
  }>;

  // Status
  status: "active" | "resolved" | "escalated" | "false_positive";
  resolution?: string;
}

// ============================================================================
// BEC DETECTION
// ============================================================================

/**
 * Regex patterns for BEC indicator detection
 */
const BEC_PATTERNS: Array<{
  type: BECPatternType;
  patterns: RegExp[];
  severity: BECPattern["severity"];
}> = [
  {
    type: "payment_instruction_change",
    patterns: [
      /\b(new|updated|changed?)\s+(bank|wire|account|routing|payment)\s*(details?|info|instructions?|number)?\b/gi,
      /\b(bank|account|wire|payment).{0,20}(has\s+)?changed\b/gi,
      /\b(different|alternate)\s+(account|bank)\b/gi,
      /\bwire\s+to\s+(?:this|the\s+following)\b/gi,
      /\bnew\s+(details|account|bank)\s*(below|attached)?\b/gi,
    ],
    severity: "critical",
  },
  {
    type: "urgency_pressure",
    patterns: [
      /\b(urgent|urgently|asap|immediately|right\s+away|act\s+now)\b/gi,
      /\b(time\s+sensitive|deadline|must\s+be\s+done\s+today)\b/gi,
      /\b(can'?t\s+wait|no\s+time|hurry)\b/gi,
    ],
    severity: "high",
  },
  {
    type: "secrecy_request",
    patterns: [
      /\b(confidential|keep\s+(this\s+)?between\s+us|don'?t\s+tell|secret)\b/gi,
      /\b(do\s+not\s+share|private\s+matter|sensitive)\b/gi,
      /\b(off\s+the\s+record|quiet|discretion)\b/gi,
    ],
    severity: "high",
  },
  {
    type: "authority_impersonation",
    patterns: [
      /\b(ceo|cfo|president|founder)\s+(here|speaking|requesting)\b/gi,
      /\b(on\s+behalf\s+of|authorized\s+by|per)\s+(the\s+)?(ceo|cfo|boss|president)\b/gi,
      /\b(i'?m\s+in\s+a\s+meeting|can'?t\s+talk|traveling)\b/gi,
    ],
    severity: "high",
  },
  {
    type: "unusual_request",
    patterns: [
      /\b(exception|bypass|skip)\s+(the\s+)?(approval|process|protocol)\b/gi,
      /\b(special\s+circumstance|one\s+time|just\s+this\s+once)\b/gi,
      /\b(don'?t\s+follow|ignore\s+the\s+usual)\b/gi,
    ],
    severity: "high",
  },
];

/**
 * Detect BEC patterns in text content
 */
export function detectBECPatterns(
  content: string,
  context: string = "communication"
): BECPattern[] {
  const patterns: BECPattern[] = [];

  for (const { type, patterns: regexes, severity } of BEC_PATTERNS) {
    for (const regex of regexes) {
      const matches = content.matchAll(regex);
      for (const match of matches) {
        patterns.push({
          type,
          severity,
          detected: `${type.replace(/_/g, " ")} indicator`,
          context,
          evidence: match[0],
          timestamp: Date.now(),
        });
      }
    }
  }

  // Deduplicate by type (keep most severe)
  const uniquePatterns = new Map<BECPatternType, BECPattern>();
  for (const pattern of patterns) {
    const existing = uniquePatterns.get(pattern.type);
    if (!existing || compareSeverity(pattern.severity, existing.severity) > 0) {
      uniquePatterns.set(pattern.type, pattern);
    }
  }

  return [...uniquePatterns.values()];
}

/**
 * Detect BEC patterns from risk signals
 */
export function detectBECFromSignals(
  signals: DDRiskSignal[]
): BECPattern[] {
  const patterns: BECPattern[] = [];

  for (const signal of signals) {
    if (signal.category === "transaction_integrity") {
      // Map signal to BEC pattern
      const lowerSignal = signal.signal.toLowerCase();

      if (lowerSignal.includes("payment") || lowerSignal.includes("wire") ||
          lowerSignal.includes("bank") || lowerSignal.includes("account")) {
        patterns.push({
          type: "payment_instruction_change",
          severity: signal.severity === "critical" ? "critical" : "high",
          detected: "Payment-related anomaly in risk signal",
          context: signal.source,
          evidence: signal.signal,
          timestamp: signal.detectedAt,
        });
      }

      if (lowerSignal.includes("urgency") || lowerSignal.includes("urgent")) {
        patterns.push({
          type: "urgency_pressure",
          severity: "high",
          detected: "Urgency language in risk signal",
          context: signal.source,
          evidence: signal.signal,
          timestamp: signal.detectedAt,
        });
      }

      if (lowerSignal.includes("domain") && lowerSignal.includes("doesn't match")) {
        patterns.push({
          type: "email_domain_spoofing",
          severity: "high",
          detected: "Domain mismatch detected",
          context: signal.source,
          evidence: signal.signal,
          timestamp: signal.detectedAt,
        });
      }
    }
  }

  return patterns;
}

// ============================================================================
// PLAYBOOK GENERATION
// ============================================================================

/**
 * Generate BEC playbook from detected patterns
 */
export function generateBECPlaybook(
  entityName: string,
  patterns: BECPattern[]
): BECPlaybook | null {
  if (patterns.length === 0) return null;

  const id = `bec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Determine overall threat level
  const hasCritical = patterns.some(p => p.severity === "critical");
  const hasPayment = patterns.some(p => p.type === "payment_instruction_change");
  const overallThreatLevel: BECPlaybook["overallThreatLevel"] =
    hasCritical || hasPayment ? "critical" :
    patterns.length >= 2 ? "high" : "medium";

  // Generate mandatory tasks
  const mandatoryTasks: BECVerificationTask[] = [];

  // Always require callback verification for payment changes
  if (hasPayment) {
    mandatoryTasks.push({
      id: `task-${id}-callback`,
      type: "callback_verification",
      priority: "critical",
      title: "MANDATORY: Verify payment details via known phone number",
      description: "Call the company using a phone number from your existing records (NOT from the suspicious communication). Verify any payment instruction changes.",
      instructions: [
        "1. Look up the company's phone number from your CRM or a verified source",
        "2. Call that number directly (do NOT use any number in the suspicious message)",
        "3. Ask to speak with the named person or their finance team",
        "4. Verbally confirm the payment instruction change",
        "5. Document the call with date, time, person spoken to, and confirmation",
      ],
      requiredBefore: "Any payment or wire transfer",
      timeout: 24,
      assignedTo: "finance_team",
      requiresWitness: true,
      completionCriteria: "Verbal confirmation from known contact at company",
      escalationPath: "Escalate to CFO if callback fails after 2 attempts",
    });

    mandatoryTasks.push({
      id: `task-${id}-dual`,
      type: "dual_approval",
      priority: "critical",
      title: "MANDATORY: Two-person approval for payment",
      description: "Any payment involving changed instructions requires approval from two authorized personnel.",
      instructions: [
        "1. First approver reviews all documentation",
        "2. Second approver independently verifies callback completion",
        "3. Both must sign off before payment proceeds",
      ],
      requiredBefore: "Payment execution",
      timeout: 48,
      assignedTo: "finance_manager",
      requiresWitness: true,
      completionCriteria: "Two independent signatures on payment authorization",
      escalationPath: "Escalate to CEO if single approver attempts to proceed",
    });
  }

  // Document request for authority impersonation
  if (patterns.some(p => p.type === "authority_impersonation")) {
    mandatoryTasks.push({
      id: `task-${id}-identity`,
      type: "identity_confirmation",
      priority: "high",
      title: "Verify sender identity via separate channel",
      description: "The message appears to impersonate an authority figure. Verify identity before proceeding.",
      instructions: [
        "1. Do NOT reply to the suspicious message",
        "2. Contact the claimed sender via known internal channel (Slack, office phone, etc.)",
        "3. Ask them directly if they sent the request",
        "4. If they didn't, report as potential BEC attack",
      ],
      requiredBefore: "Any action requested in the message",
      timeout: 4,
      assignedTo: "recipient",
      requiresWitness: false,
      completionCriteria: "Direct confirmation from actual person",
      escalationPath: "Report to security team if identity cannot be confirmed",
    });
  }

  // Freeze for critical patterns
  if (hasCritical || patterns.length >= 3) {
    mandatoryTasks.push({
      id: `task-${id}-freeze`,
      type: "freeze_transaction",
      priority: "critical",
      title: "FREEZE: Hold all related transactions",
      description: "Multiple BEC indicators detected. Freeze all related transactions until verification complete.",
      instructions: [
        "1. Do not process any payments related to this entity",
        "2. Flag the entity in your system as 'pending verification'",
        "3. Notify relevant stakeholders of the hold",
        "4. Resume only after all verification tasks are complete",
      ],
      requiredBefore: "N/A - immediate action",
      timeout: 0,
      requiresWitness: false,
      completionCriteria: "Transaction hold confirmed in system",
      escalationPath: "N/A",
    });
  }

  // Build threat summary
  const patternSummary = patterns.map(p =>
    `${p.type.replace(/_/g, " ")}: "${p.evidence}"`
  ).join("; ");

  // Determine verification protocol
  const verificationProtocol: BECPlaybook["verificationProtocol"] = hasPayment
    ? {
        method: "phone_callback",
        knownContactRequired: true,
        scriptedQuestions: [
          "Can you confirm you sent a request to change payment instructions?",
          "What is the correct account/routing number for payments?",
          "Is [NAME] authorized to request payment changes?",
        ],
      }
    : {
        method: "phone_callback",
        knownContactRequired: true,
        scriptedQuestions: [
          "Did you send this request?",
          "Can you verify the details?",
        ],
      };

  return {
    id,
    entityName,
    generatedAt: Date.now(),
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days

    patternsDetected: patterns,
    overallThreatLevel,
    threatSummary: `BEC indicators detected: ${patternSummary}`,

    mandatoryTasks,
    blockedActions: hasPayment
      ? ["payment_processing", "wire_transfer", "invoice_payment"]
      : ["requested_action"],

    verificationProtocol,

    auditTrail: [{
      timestamp: Date.now(),
      action: "playbook_generated",
      result: `${patterns.length} patterns detected, ${mandatoryTasks.length} tasks created`,
    }],

    status: "active",
  };
}

/**
 * Check if BEC playbook blocks an action
 */
export function isActionBlocked(
  playbook: BECPlaybook,
  action: string
): {
  blocked: boolean;
  reason: string;
  requiredTasks: BECVerificationTask[];
} {
  if (playbook.status !== "active") {
    return { blocked: false, reason: "Playbook not active", requiredTasks: [] };
  }

  const actionLower = action.toLowerCase();
  const blocked = playbook.blockedActions.some(ba =>
    actionLower.includes(ba.replace(/_/g, " ")) ||
    actionLower.includes(ba)
  );

  if (blocked) {
    const incompleteTasks = playbook.mandatoryTasks.filter(t =>
      !playbook.auditTrail.some(a =>
        a.action === "task_completed" && a.result?.includes(t.id)
      )
    );

    return {
      blocked: true,
      reason: `Action blocked by BEC playbook: ${playbook.threatSummary}`,
      requiredTasks: incompleteTasks,
    };
  }

  return { blocked: false, reason: "", requiredTasks: [] };
}

/**
 * Mark a task as completed in the playbook
 */
export function completeTask(
  playbook: BECPlaybook,
  taskId: string,
  actor: string,
  notes: string
): BECPlaybook {
  const task = playbook.mandatoryTasks.find(t => t.id === taskId);
  if (!task) return playbook;

  playbook.auditTrail.push({
    timestamp: Date.now(),
    action: "task_completed",
    actor,
    result: `Task ${taskId}: ${notes}`,
  });

  // Check if all tasks complete
  const completedTaskIds = new Set(
    playbook.auditTrail
      .filter(a => a.action === "task_completed")
      .map(a => a.result?.match(/Task (task-[^:]+)/)?.[1])
      .filter(Boolean)
  );

  const allComplete = playbook.mandatoryTasks.every(t =>
    completedTaskIds.has(t.id)
  );

  if (allComplete) {
    playbook.status = "resolved";
    playbook.resolution = "All verification tasks completed";
    playbook.auditTrail.push({
      timestamp: Date.now(),
      action: "playbook_resolved",
      result: "All tasks completed, blocks removed",
    });
  }

  return playbook;
}

// ============================================================================
// UTILITIES
// ============================================================================

function compareSeverity(a: BECPattern["severity"], b: BECPattern["severity"]): number {
  const order = { medium: 0, high: 1, critical: 2 };
  return order[a] - order[b];
}

/**
 * Format playbook for display
 */
export function formatPlaybook(playbook: BECPlaybook): string {
  const lines: string[] = [];

  lines.push(`=== BEC PLAYBOOK: ${playbook.entityName} ===`);
  lines.push(`Threat Level: ${playbook.overallThreatLevel.toUpperCase()}`);
  lines.push(`Status: ${playbook.status}`);
  lines.push("");

  lines.push("DETECTED PATTERNS:");
  for (const p of playbook.patternsDetected) {
    lines.push(`  [${p.severity}] ${p.type}: "${p.evidence}"`);
  }
  lines.push("");

  lines.push("MANDATORY TASKS:");
  for (const t of playbook.mandatoryTasks) {
    lines.push(`  [${t.priority}] ${t.title}`);
    lines.push(`    Required before: ${t.requiredBefore}`);
    if (t.requiresWitness) lines.push(`    ** REQUIRES TWO-PERSON APPROVAL **`);
  }
  lines.push("");

  lines.push("BLOCKED ACTIONS:");
  for (const a of playbook.blockedActions) {
    lines.push(`  - ${a}`);
  }

  return lines.join("\n");
}
