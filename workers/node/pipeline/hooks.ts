/**
 * hooks.ts — Pipeline lifecycle hooks (Claude Code / Codex pattern).
 *
 * Pre-search gates: block/modify queries before execution
 * Post-search actions: auto-export, auto-archive after successful results
 *
 * Hook types:
 * - PreSearch: can block, modify, or allow a query
 * - PostSearch: runs after result is assembled (log, export, archive)
 * - PreExport: validates packet quality before export
 */

import type { PipelineState } from "./searchPipeline.js";

// ─── Hook types ──────────────────────────────────────────────────

export type HookDecision = "allow" | "deny" | "modify";

export interface PreSearchHookResult {
  decision: HookDecision;
  reason?: string;
  modifiedQuery?: string;
  modifiedLens?: string;
}

export interface PostSearchHookResult {
  actions: string[];  // what the hook did ("archived", "exported", "flagged")
}

export type PreSearchHook = (query: string, lens: string) => PreSearchHookResult;
export type PostSearchHook = (state: PipelineState) => PostSearchHookResult;

// ─── Built-in pre-search hooks ───────────────────────────────────

/** Block empty or too-short queries */
export const minLengthGate: PreSearchHook = (query) => {
  if (query.length < 3) {
    return { decision: "deny", reason: "Query too short — need at least 3 characters" };
  }
  return { decision: "allow" };
};

/** Block obviously non-entity queries */
export const nonsenseGate: PreSearchHook = (query) => {
  const lower = query.toLowerCase();
  const blocked = ["test", "hello", "hi", "asdf", "aaa", "123"];
  if (blocked.includes(lower)) {
    return { decision: "deny", reason: "Query doesn't look like a company or question — try a real search" };
  }
  return { decision: "allow" };
};

/** Auto-set lens based on query keywords */
export const autoLensHook: PreSearchHook = (query, lens) => {
  const lower = query.toLowerCase();
  if (lens === "founder" && (lower.includes("invest") || lower.includes("valuation") || lower.includes("series"))) {
    return { decision: "modify", modifiedLens: "investor", reason: "Switched to investor lens (investment-related query)" };
  }
  if (lens === "founder" && (lower.includes("bank") || lower.includes("loan") || lower.includes("credit"))) {
    return { decision: "modify", modifiedLens: "banker", reason: "Switched to banker lens (banking-related query)" };
  }
  return { decision: "allow" };
};

// ─── Built-in post-search hooks ──────────────────────────────────

/** Log high-quality results for archive consideration */
export const qualityLogger: PostSearchHook = (state) => {
  const actions: string[] = [];
  if (state.confidence >= 90 && state.classifiedSignals.length >= 2) {
    actions.push("high_quality_flagged");
  }
  if (state.evidence.verificationRate >= 0.8) {
    actions.push("well_verified");
  }
  if (state.painResolutions.length >= 3) {
    actions.push("multi_pain_resolved");
  }
  return { actions };
};

/** Flag results that need human review */
export const reviewFlagger: PostSearchHook = (state) => {
  const actions: string[] = [];
  if (state.confidence < 30) {
    actions.push("low_confidence_review");
  }
  if (state.evidence.contradictedCount > 0) {
    actions.push("contradictions_detected");
  }
  if (state.classifiedSignals.some(s => s.needsOntologyReview)) {
    actions.push("taxonomy_review_needed");
  }
  return { actions };
};

// ─── Hook runner ─────────────────────────────────────────────────

const PRE_SEARCH_HOOKS: PreSearchHook[] = [minLengthGate, nonsenseGate, autoLensHook];
const POST_SEARCH_HOOKS: PostSearchHook[] = [qualityLogger, reviewFlagger];

export function runPreSearchHooks(query: string, lens: string): {
  allowed: boolean;
  query: string;
  lens: string;
  hookResults: Array<{ hook: string; decision: HookDecision; reason?: string }>;
} {
  let currentQuery = query;
  let currentLens = lens;
  const hookResults: Array<{ hook: string; decision: HookDecision; reason?: string }> = [];

  for (const hook of PRE_SEARCH_HOOKS) {
    const result = hook(currentQuery, currentLens);
    hookResults.push({ hook: hook.name, decision: result.decision, reason: result.reason });

    if (result.decision === "deny") {
      return { allowed: false, query: currentQuery, lens: currentLens, hookResults };
    }
    if (result.decision === "modify") {
      if (result.modifiedQuery) currentQuery = result.modifiedQuery;
      if (result.modifiedLens) currentLens = result.modifiedLens;
    }
  }

  return { allowed: true, query: currentQuery, lens: currentLens, hookResults };
}

export function runPostSearchHooks(state: PipelineState): {
  allActions: string[];
  hookResults: Array<{ hook: string; actions: string[] }>;
} {
  const allActions: string[] = [];
  const hookResults: Array<{ hook: string; actions: string[] }> = [];

  for (const hook of POST_SEARCH_HOOKS) {
    const result = hook(state);
    hookResults.push({ hook: hook.name, actions: result.actions });
    allActions.push(...result.actions);
  }

  return { allActions, hookResults };
}
