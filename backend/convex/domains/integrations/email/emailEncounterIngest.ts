/**
 * Email Encounter Ingest
 *
 * Detects forwarded emails that contain encounter information and
 * creates encounters in the same format as Slack captures.
 *
 * Patterns detected:
 * - Forwarded emails with meeting details
 * - Email threads about introductions
 * - Follow-up emails from events
 *
 * @module integrations/email/emailEncounterIngest
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface EmailContent {
  id: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  date: number;
  threadId?: string;
}

interface DetectedEncounter {
  isEncounter: boolean;
  reason?: string;
  originalSender?: string;
  participants: Array<{ name: string; email?: string; company?: string }>;
  companies: string[];
  context?: string;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process an email to detect if it's an encounter capture.
 */
export const processEmailForEncounter = internalAction({
  args: {
    userId: v.id("users"),
    emailId: v.string(),
    subject: v.string(),
    from: v.string(),
    to: v.string(),
    body: v.string(),
    date: v.number(),
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.boolean(),
    isEncounter: v.boolean(),
    encounterId: v.optional(v.id("userEvents")),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    console.log(`[EmailEncounterIngest] Processing email: "${args.subject.slice(0, 50)}..."`);

    // Detect if this is an encounter-type email
    const detected = detectEncounterFromEmail({
      id: args.emailId,
      subject: args.subject,
      from: args.from,
      to: args.to,
      body: args.body,
      date: args.date,
      threadId: args.threadId,
    });

    if (!detected.isEncounter) {
      return {
        processed: true,
        isEncounter: false,
        reason: detected.reason,
      };
    }

    console.log(`[EmailEncounterIngest] Detected encounter with ${detected.participants.length} participants, confidence: ${detected.confidence}`);

    // Check for duplicate
    const existingEncounter = await ctx.runQuery(
      internal.domains.integrations.slack.encounterMutations.getEncounterBySourceId,
      {
        userId: args.userId,
        sourceId: args.emailId,
      }
    );

    if (existingEncounter) {
      console.log(`[EmailEncounterIngest] Duplicate encounter, skipping`);
      return {
        processed: true,
        isEncounter: true,
        encounterId: existingEncounter,
        reason: "duplicate",
      };
    }

    // Resolve entities against existing research
    const resolved = await ctx.runAction(
      internal.domains.integrations.slack.encounterResolver.resolveEncounterEntities,
      {
        parsed: {
          participants: detected.participants,
          companies: detected.companies,
          context: detected.context,
          followUpRequested: detectFollowUpRequest(args.body),
          confidence: detected.confidence,
        },
        userId: args.userId,
      }
    );

    // Create the encounter
    const encounterId = await ctx.runMutation(
      internal.domains.integrations.slack.encounterMutations.createEncounter,
      {
        userId: args.userId,
        sourceType: "email_forward",
        sourceId: args.emailId,
        encounter: {
          participants: resolved.participants,
          companies: resolved.companies,
          context: detected.context || args.subject,
          followUpRequested: detectFollowUpRequest(args.body),
          rawText: args.body.slice(0, 2000), // Limit stored text
          researchStatus: "none",
        },
      }
    );

    // Trigger fast-pass research
    if (resolved.participants.length > 0 || resolved.companies.length > 0) {
      await ctx.scheduler.runAfter(0, internal.domains.integrations.slack.encounterResearch.triggerFastPassResearch, {
        encounterId,
        entities: [
          ...resolved.participants.map((p: any) => ({
            name: p.name,
            type: "person" as const,
            existingEntityId: p.linkedEntityId,
          })),
          ...resolved.companies.map((c: any) => ({
            name: c.name,
            type: "company" as const,
            existingEntityId: c.linkedEntityId,
          })),
        ],
      });
    }

    // Check if this is related to a recent Slack encounter
    const linkedSlackEncounter = await ctx.runQuery(
      internal.domains.integrations.email.emailEncounterIngest.findRelatedSlackEncounter,
      {
        userId: args.userId,
        participantNames: resolved.participants.map((p: any) => p.name),
        companyNames: resolved.companies.map((c: any) => c.name),
        lookbackHours: 72,
      }
    );

    if (linkedSlackEncounter) {
      console.log(`[EmailEncounterIngest] Linked to Slack encounter: ${linkedSlackEncounter}`);
      // TODO: Create a reference between the two encounters
    }

    console.log(`[EmailEncounterIngest] Created encounter: ${encounterId}`);

    return {
      processed: true,
      isEncounter: true,
      encounterId,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect if an email contains encounter information.
 */
function detectEncounterFromEmail(email: EmailContent): DetectedEncounter {
  const subjectLower = email.subject.toLowerCase();
  const bodyLower = email.body.toLowerCase();
  const participants: Array<{ name: string; email?: string; company?: string }> = [];
  const companies: string[] = [];
  let confidence = 0;
  let context: string | undefined;

  // ─── Check for Forwarded Email ───────────────────────────────────────────
  const isForwarded = /^(fwd?:|fw:|\[fwd\])/i.test(email.subject) ||
    /^-+\s*forwarded message/im.test(email.body) ||
    /^>\s*from:/im.test(email.body);

  if (!isForwarded) {
    // Also check for intro patterns
    const isIntro = /^(intro|introduction|meet|connecting)/i.test(subjectLower) ||
      /wanted to (introduce|connect)/i.test(bodyLower) ||
      /meet\s+(?:with\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/i.test(email.body);

    if (!isIntro) {
      return {
        isEncounter: false,
        reason: "not_forwarded_or_intro",
        participants: [],
        companies: [],
        confidence: 0,
      };
    }
    confidence += 0.2;
  } else {
    confidence += 0.3;
  }

  // ─── Check for Encounter Keywords ────────────────────────────────────────
  const encounterKeywords = [
    /meeting/i,
    /call/i,
    /coffee/i,
    /lunch/i,
    /dinner/i,
    /conference/i,
    /event/i,
    /intro/i,
    /connect/i,
  ];

  const keywordMatches = encounterKeywords.filter((k) =>
    k.test(subjectLower) || k.test(bodyLower)
  ).length;

  if (keywordMatches === 0) {
    return {
      isEncounter: false,
      reason: "no_encounter_keywords",
      participants: [],
      companies: [],
      confidence: 0,
    };
  }

  confidence += keywordMatches * 0.1;

  // ─── Extract Original Sender ─────────────────────────────────────────────
  const forwardedFromMatch = email.body.match(
    /from:\s*(?:"?([^"<\n]+)"?\s*)?<?([^>\n\s]+@[^>\n\s]+)>?/i
  );

  if (forwardedFromMatch) {
    const name = forwardedFromMatch[1]?.trim();
    const emailAddr = forwardedFromMatch[2]?.trim();

    if (name && isValidPersonName(name)) {
      const company = extractCompanyFromEmail(emailAddr);
      participants.push({ name, email: emailAddr, company });
      if (company && !companies.includes(company)) {
        companies.push(company);
      }
      confidence += 0.2;
    }
  }

  // ─── Extract Names from Body ─────────────────────────────────────────────
  const namePatterns = [
    /meet(?:ing)?\s+(?:with\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    /introduce(?:d)?\s+(?:you\s+to\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    /connect(?:ing)?\s+(?:you\s+with\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    /spoke\s+(?:with|to)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:from|at|of)\s+([A-Z][A-Za-z0-9]+)/g,
  ];

  for (const pattern of namePatterns) {
    let match;
    while ((match = pattern.exec(email.body)) !== null) {
      const name = match[1]?.trim();
      const company = match[2]?.trim();

      if (name && isValidPersonName(name) && !participants.some((p) => p.name === name)) {
        participants.push({ name, company });
        if (company && !companies.includes(company)) {
          companies.push(company);
        }
        confidence += 0.1;
      }
    }
  }

  // ─── Extract Context ─────────────────────────────────────────────────────
  // Try to extract topic/context from subject or first line
  const contextPatterns = [
    /re:\s*(.+?)(?:$|\n)/i,
    /(?:regarding|about|re:)\s*(.+?)(?:$|\n)/i,
    /discussion(?:\s+on)?\s*(.+?)(?:$|\n)/i,
  ];

  for (const pattern of contextPatterns) {
    const match = email.subject.match(pattern) || email.body.match(pattern);
    if (match) {
      context = match[1].trim().slice(0, 100);
      break;
    }
  }

  if (!context && email.subject) {
    // Use cleaned subject as context
    context = email.subject
      .replace(/^(fwd?:|fw:|re:|\[fwd\])/gi, "")
      .trim()
      .slice(0, 100);
  }

  // ─── Final Confidence Check ──────────────────────────────────────────────
  if (participants.length === 0 && companies.length === 0) {
    return {
      isEncounter: false,
      reason: "no_entities_detected",
      participants: [],
      companies: [],
      confidence: 0,
    };
  }

  confidence = Math.min(confidence, 1);

  return {
    isEncounter: confidence >= 0.3,
    participants,
    companies,
    context,
    confidence,
    reason: confidence >= 0.3 ? undefined : "low_confidence",
  };
}

/**
 * Check if there's a follow-up request in the email.
 */
function detectFollowUpRequest(body: string): boolean {
  return /follow[\s-]?up|schedule|next\s+steps|action\s+items|to[\s-]?do|let me know|get back to/i.test(body);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that a string looks like a person's name.
 */
function isValidPersonName(name: string): boolean {
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;

  // Each word should be capitalized
  if (!words.every((w) => /^[A-Z][a-z]+$/.test(w))) return false;

  // Exclude common false positives
  const excludeWords = [
    "The", "This", "That", "What", "When", "Where", "Why", "How",
    "And", "But", "For", "With", "From", "About", "Meeting", "Call",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  if (words.some((w) => excludeWords.includes(w))) return false;

  return true;
}

/**
 * Extract company name from email domain.
 */
function extractCompanyFromEmail(email: string): string | undefined {
  if (!email) return undefined;

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return undefined;

  // Skip personal email domains
  const personalDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "me.com"];
  if (personalDomains.includes(domain)) return undefined;

  // Extract company name from domain
  const parts = domain.split(".");
  if (parts.length < 2) return undefined;

  // Get the main part (before .com, .io, etc.)
  const companyPart = parts[0];

  // Capitalize first letter
  return companyPart.charAt(0).toUpperCase() + companyPart.slice(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find a related Slack encounter based on participants/companies.
 */
export const findRelatedSlackEncounter = internalQuery({
  args: {
    userId: v.id("users"),
    participantNames: v.array(v.string()),
    companyNames: v.array(v.string()),
    lookbackHours: v.optional(v.number()),
  },
  returns: v.union(v.null(), v.id("userEvents")),
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours || 72) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    // Get recent Slack encounters
    const recentEncounters = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", args.userId).eq("sourceType", "slack")
      )
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .collect();

    // Score matches
    for (const encounter of recentEncounters) {
      const enc = encounter.encounter;
      if (!enc) continue;

      let score = 0;

      // Check participant matches
      for (const name of args.participantNames) {
        const nameLower = name.toLowerCase();
        if (enc.participants.some((p: { name: string }) => p.name.toLowerCase().includes(nameLower))) {
          score += 2;
        }
      }

      // Check company matches
      for (const company of args.companyNames) {
        const companyLower = company.toLowerCase();
        if (enc.companies.some((c: { name: string }) => c.name.toLowerCase().includes(companyLower))) {
          score += 1;
        }
      }

      // Return if we have a strong match
      if (score >= 2) {
        return encounter._id;
      }
    }

    return null;
  },
});

/**
 * Check if an email has already been processed.
 */
export const isEmailProcessed = internalQuery({
  args: {
    userId: v.id("users"),
    emailId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", args.userId).eq("sourceType", "email_forward")
      )
      .filter((q) => q.eq(q.field("sourceId"), args.emailId))
      .first();

    return existing !== null;
  },
});
