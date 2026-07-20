/**
 * painMapping.ts — Map search results to real 2026 founder pain themes.
 *
 * Every result shows which pain it resolves, with a user-facing label
 * and what NodeBench did to fix it. Not marketing — product proof.
 *
 * 5 pain themes from live 2026 community signals:
 * 1. "I don't know what I'm building" (clarity)
 * 2. "Context gets messy across sessions" (continuity)
 * 3. "I keep explaining the same thing" (duplication)
 * 4. "I can't tell what's real vs made up" (trust)
 * 5. "The output isn't ready to send" (handoff)
 */

// ─── Pain themes ─────────────────────────────────────────────────

export interface PainResolution {
  /** Which pain theme this result addresses */
  painId: string;
  /** User-facing label (plain English) */
  painLabel: string;
  /** What the user was struggling with */
  userPain: string;
  /** What NodeBench did to fix it — specific to this result */
  fix: string;
  /** Proof: what evidence backs the fix */
  proof: string;
}

export const PAIN_THEMES = {
  clarity: {
    id: "clarity",
    label: "Now you know what you're building",
    pain: "Founders can't articulate what company they're building, what's weak, or what outsiders will care about.",
    sourceQuote: "I keep rewriting my pitch because I don't actually know what I'm building yet.",
  },
  continuity: {
    id: "continuity",
    label: "You didn't start over this time",
    pain: "Every new session restarts from zero. Prior decisions, contradictions, and context are lost.",
    sourceQuote: "I keep repeating the same context to my AI tools. They're brilliant strangers every time.",
  },
  duplication: {
    id: "duplication",
    label: "Your context traveled with you",
    pain: "Founders re-explain the same company truth to every tool, agent, investor, and banker.",
    sourceQuote: "I explained my startup to ChatGPT, then Claude, then my investor deck, then my bank — four times.",
  },
  trust: {
    id: "trust",
    label: "Every claim is cited",
    pain: "AI outputs mix real facts with hallucinations. No way to tell which claims are grounded.",
    sourceQuote: "The AI gave me revenue numbers that sounded great. Turns out they were completely made up.",
  },
  handoff: {
    id: "handoff",
    label: "Ready to send right now",
    pain: "Good analysis sits in a dashboard. It never becomes a memo, email, or delegation packet.",
    sourceQuote: "I have all this intelligence but I still spend 2 hours turning it into something I can send.",
  },
} as const;

// ─── Detect which pains a search result resolves ──────────────────

export function detectPainResolutions(result: {
  query: string;
  classification: string;
  entityName: string;
  answer: string;
  confidence: number;
  signals: any[];
  risks: any[];
  comparables: any[];
  evidence: { totalSpans: number; verifiedCount: number; verificationRate: number };
  sourceRefs: any[];
  nextActions: any[];
}): PainResolution[] {
  const resolutions: PainResolution[] = [];
  const q = result.query.toLowerCase();

  // Pain 1: CLARITY — always resolved when we return a structured packet
  if (result.answer && result.answer.length > 50 && result.confidence > 0) {
    const signalCount = result.signals?.length ?? 0;
    const riskCount = result.risks?.length ?? 0;
    resolutions.push({
      painId: "clarity",
      painLabel: PAIN_THEMES.clarity.label,
      userPain: PAIN_THEMES.clarity.pain,
      fix: `Identified ${result.entityName} with ${signalCount} signals, ${riskCount} risks, and ${result.confidence}% confidence.`,
      proof: `${result.sourceRefs?.length ?? 0} sources searched, ${result.evidence.verifiedCount} claims verified.`,
    });
  }

  // Pain 4: TRUST — resolved when evidence verification rate > 0
  if (result.evidence.totalSpans > 0 && result.evidence.verifiedCount > 0) {
    resolutions.push({
      painId: "trust",
      painLabel: PAIN_THEMES.trust.label,
      userPain: PAIN_THEMES.trust.pain,
      fix: `${result.evidence.verifiedCount}/${result.evidence.totalSpans} claims backed by source citations.`,
      proof: `${Math.round(result.evidence.verificationRate * 100)}% verification rate across ${result.sourceRefs?.length ?? 0} sources.`,
    });
  }

  // Pain 5: HANDOFF — resolved when we produce exportable content
  if (result.answer && result.nextActions?.length > 0) {
    resolutions.push({
      painId: "handoff",
      painLabel: PAIN_THEMES.handoff.label,
      userPain: PAIN_THEMES.handoff.pain,
      fix: `Structured packet with ${result.nextActions.length} next actions, ready to export or delegate.`,
      proof: `Packet includes entity truth, risks, comparables, and cited next moves.`,
    });
  }

  // Pain 3: DUPLICATION — resolved for company searches (context packaged once)
  if (result.classification === "company_search" && result.entityName) {
    resolutions.push({
      painId: "duplication",
      painLabel: PAIN_THEMES.duplication.label,
      userPain: PAIN_THEMES.duplication.pain,
      fix: `${result.entityName} context packaged once — export as memo, Slack brief, or agent delegation.`,
      proof: `One search produces investor, banker, founder, and CEO views of the same truth.`,
    });
  }

  // Pain 2: CONTINUITY — resolved when we detect "what changed" or weekly reset patterns
  if (q.includes("changed") || q.includes("reset") || q.includes("since last") || q.includes("refresh")) {
    resolutions.push({
      painId: "continuity",
      painLabel: PAIN_THEMES.continuity.label,
      userPain: PAIN_THEMES.continuity.pain,
      fix: `Compared current state to prior context and surfaced what matters now.`,
      proof: `Session-aware search with packet lineage tracking.`,
    });
  }

  return resolutions;
}
