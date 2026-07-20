/**
 * ModelSwitchedCard — visible audit card for model failover events.
 *
 * B-PR5 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Surfaces failover events from the model router (B-PR4) so users can
 * see when the system actually switched models and why. Replaces the
 * "silent recovery" anti-pattern where users wonder if their request
 * even ran on the model they expected.
 *
 * Two presentations:
 *   - Recovered: green/slate card. The fallback succeeded; the request
 *     completed using `toModel`. Shows the chain of attempts so the
 *     user can verify the tier they paid for.
 *   - Failed: amber card. Every model in the chain returned an error.
 *     The request did NOT complete. Surfaces the last error so the
 *     user has something concrete to debug.
 *
 * Pure presentation. No hooks, no Convex calls. Caller passes the
 * structured `ModelSwitchEvent` from a hook that subscribes to router
 * audit events (wiring lands in a follow-up PR).
 */

import { Zap, ZapOff, ArrowRight, AlertTriangle, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════

/** Why a particular model in the chain was abandoned. */
export type ModelSwitchReason =
  /** HTTP 429 from upstream provider. */
  | "rate_limit"
  /** HTTP 5xx (502/503/504). */
  | "server_error"
  /** Network timeout / fetch error. */
  | "timeout"
  /** Provider returned a malformed response we could not parse. */
  | "invalid_response"
  /** Capability filter rejected this attempt during chain resolution. */
  | "capability_mismatch"
  /** Tier-floor enforcement skipped a cheaper option. */
  | "tier_floor"
  /** Per-request budget cap fired before this model was tried. */
  | "budget"
  /** Some other error class. Treat as opaque in the UI. */
  | "other";

/** A single attempted model in the failover chain. */
export interface ModelSwitchAttempt {
  modelId: string;
  /** Tier of the attempted model — lets the card show tier downgrades. */
  tier?: "free" | "cheap" | "standard" | "premium";
  reason: ModelSwitchReason;
  /** Optional human-readable detail (e.g. "qwen3-coder-free returned 429"). */
  detail?: string;
  /** Latency before this model was abandoned (ms). */
  latencyMs?: number;
}

/**
 * Discriminated chat message for model failover events.
 * Caller stamps a wall-clock at construction time so the card can show
 * "switched 12s ago" without re-fetching.
 */
export type ModelSwitchEvent =
  | {
      kind: "recovered";
      /** Originally requested / tried model. */
      fromModel: string;
      /** Model that ultimately succeeded. */
      toModel: string;
      /** Tiers — used to surface "downgrade from premium → cheap" warnings. */
      fromTier?: ModelSwitchAttempt["tier"];
      toTier?: ModelSwitchAttempt["tier"];
      /** Full chain of attempts in order. Includes the successful tail. */
      attempts: readonly ModelSwitchAttempt[];
      timestamp: number;
    }
  | {
      kind: "failed";
      /** Originally requested / tried model. */
      fromModel: string;
      /** Full chain of attempts. All failed. */
      attempts: readonly ModelSwitchAttempt[];
      /** Final error message, surfaced verbatim to the user. */
      lastError: string;
      timestamp: number;
    };

export interface ModelSwitchedCardProps {
  event: ModelSwitchEvent;
  className?: string;
  /** Show the per-attempt list. Defaults to false (compact view). */
  showAttempts?: boolean;
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function reasonLabel(reason: ModelSwitchReason): string {
  switch (reason) {
    case "rate_limit":
      return "rate-limited (429)";
    case "server_error":
      return "server error (5xx)";
    case "timeout":
      return "timed out";
    case "invalid_response":
      return "invalid response";
    case "capability_mismatch":
      return "missing capability";
    case "tier_floor":
      return "below tier floor";
    case "budget":
      return "budget cap hit";
    case "other":
      return "errored";
  }
}

const TIER_RANK: Record<NonNullable<ModelSwitchAttempt["tier"]>, number> = {
  free: 0,
  cheap: 1,
  standard: 2,
  premium: 3,
};

function isDowngrade(
  from: ModelSwitchAttempt["tier"],
  to: ModelSwitchAttempt["tier"],
): boolean {
  if (!from || !to) return false;
  return TIER_RANK[to] < TIER_RANK[from];
}

// ════════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════════

export function ModelSwitchedCard({
  event,
  className,
  showAttempts = false,
}: ModelSwitchedCardProps) {
  if (event.kind === "failed") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="model-switched-card-failed"
        className={cn(
          "flex flex-col gap-2 rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900 shadow-[0_8px_24px_-20px_rgba(190,18,60,0.4)] dark:border-rose-400/20 dark:bg-rose-500/[0.06] dark:text-rose-200",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <ZapOff className="h-4 w-4" aria-hidden />
          <span className="font-medium">All fallback models failed</span>
          <span className="ml-auto text-xs opacity-70">
            {formatRelativeTime(event.timestamp)}
          </span>
        </div>

        <div className="text-xs leading-relaxed text-rose-900/90 dark:text-rose-100/90">
          Started with{" "}
          <code className="rounded bg-rose-100/80 px-1.5 py-0.5 font-mono text-[11px] dark:bg-rose-500/[0.1]">
            {event.fromModel}
          </code>
          ; exhausted {event.attempts.length} model
          {event.attempts.length === 1 ? "" : "s"} before bailing.
        </div>

        <div className="rounded-lg bg-rose-100/70 px-2 py-1.5 text-xs text-rose-950 dark:bg-rose-500/[0.1] dark:text-rose-100">
          <span className="opacity-70">Last error:</span>{" "}
          <span className="font-mono text-[11px]">{event.lastError}</span>
        </div>

        {showAttempts && event.attempts.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {event.attempts.map((a, i) => (
              <li
                key={`${a.modelId}-${i}`}
                className="flex items-center gap-2 rounded-md bg-rose-100/40 px-2 py-1 dark:bg-rose-500/[0.04]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />
                <span className="font-mono text-[11px]">{a.modelId}</span>
                <span className="ml-auto text-[10px] opacity-70">
                  {reasonLabel(a.reason)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const downgrade = isDowngrade(event.fromTier, event.toTier);
  const attempts = event.attempts;
  const failedAttempts = attempts.slice(0, -1);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="model-switched-card-recovered"
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm text-slate-700 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.2)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-emerald-500" aria-hidden />
        <span className="font-medium text-slate-800 dark:text-slate-100">
          Switched models
        </span>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {formatRelativeTime(event.timestamp)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <code className="rounded-md bg-white/80 px-2 py-0.5 font-mono text-[11px] dark:bg-white/[0.06]">
          {event.fromModel}
        </code>
        <ArrowRight className="h-3 w-3 opacity-60" aria-hidden />
        <code className="rounded-md bg-emerald-100/70 px-2 py-0.5 font-mono text-[11px] text-emerald-800 dark:bg-emerald-500/[0.1] dark:text-emerald-200">
          {event.toModel}
        </code>
        {failedAttempts.length > 0 ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            after {failedAttempts.length} failed attempt
            {failedAttempts.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {downgrade ? (
        <div className="flex items-start gap-1.5 rounded-lg bg-amber-50/80 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-500/[0.06] dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            Quality downgrade — completed at <strong>{event.toTier}</strong> tier
            instead of the requested <strong>{event.fromTier}</strong> tier. Rerun
            with explicit pinning if the response quality matters here.
          </span>
        </div>
      ) : null}

      {showAttempts && attempts.length > 1 ? (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <ChevronDown
              className="h-3 w-3 transition-transform group-open:rotate-180"
              aria-hidden
            />
            Show all attempts ({attempts.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1 text-xs">
            {attempts.map((a, i) => {
              const isLastAndOk = i === attempts.length - 1;
              return (
                <li
                  key={`${a.modelId}-${i}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1",
                    isLastAndOk
                      ? "bg-emerald-50/60 dark:bg-emerald-500/[0.04]"
                      : "bg-slate-100/70 dark:bg-white/[0.03]",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isLastAndOk
                        ? "bg-emerald-500"
                        : "bg-slate-400 dark:bg-slate-500",
                    )}
                    aria-hidden
                  />
                  <span className="font-mono text-[11px]">{a.modelId}</span>
                  <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
                    {isLastAndOk ? "succeeded" : reasonLabel(a.reason)}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
