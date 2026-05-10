/**
 * VoiceCostBadge — daily voice spend indicator + tier-fallback transparency.
 *
 * Pattern: Read-only spend summary; subscribes to
 * `voice/costLedger:checkCap` (landed in PR #274). Shows totalUsd vs capUsd
 * with a horizontal progress bar + warning state at 80% + capped state at
 * 100%. HONEST_SCORES — totalUsd is server-computed from sum(byTier).
 *
 * Tier-fallback transparency (PR #311 — May 10, 2026):
 *   When the latest routing decision shows actualTierUsed !== tier (i.e. the
 *   request was downgraded from gpt-realtime-2 to gpt-4o-realtime-preview, or
 *   from openai-* to gemini-flash-live), the badge renders a "Fallback active"
 *   chip with the reason text. HONEST_STATUS — never silently pretend the
 *   premium tier served when a degraded model actually responded.
 *
 * See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §2 (voiceCostLedger),
 *      server/agents/realtimeVoicePolicy.ts (VoiceRoutingDecision shape).
 *
 * Visual states (cost):
 *   - Healthy   (< 80%): muted text + slim accent bar
 *   - Warning   (>=80%): amber accent + warning copy
 *   - Cap hit  (>=100%): rose accent + "capture-only mode" copy
 *
 * Visual states (fallback):
 *   - None: no chip (request served the requested tier)
 *   - Active: amber chip with reason; click toggles full reason text
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   HONEST_STATUS — fallback chip MUST appear whenever degraded; no silent UI.
 *
 * A11y (.claude/rules/reexamine_a11y.md):
 *   role="status", aria-live="polite" on the chip; aria-expanded on toggle;
 *   focus-visible ring; no pulse animation (prefers-reduced-motion safe).
 *
 * Glass card DNA, terracotta accent for the bar fill.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

interface VoiceCostBadgeProps {
  userId: string; // user's Convex id
  className?: string;
}

interface CapSnapshot {
  userId: string;
  dayUtc: string;
  totalUsd: number;
  capUsd: number;
  remaining: number;
  hit: boolean;
  warning80pct: boolean;
}

interface RoutingDecisionRow {
  createdAt: number;
  surface?: string;
  requestedTier?: string;
  decision: {
    tier?: string;
    actualTierUsed?: string;
    fallbackReason?: string;
    fallbackChain?: string[];
    model?: string;
    [key: string]: unknown;
  };
}

function fmtUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

const FALLBACK_REASON_COPY: Record<string, string> = {
  openai_key_missing: "OpenAI key not configured — using Gemini Live instead",
  openai_realtime_unavailable:
    "Account not yet upgraded to gpt-realtime-2 — using legacy realtime preview",
  openai_legacy_realtime_unavailable:
    "Both gpt-realtime-2 and legacy preview unavailable — using Gemini Live instead",
  rate_limited: "OpenAI rate-limited — using Gemini Live instead",
  session_create_failed:
    "OpenAI session creation failed — using Gemini Live instead",
};

function fallbackCopy(reason: string | undefined): string {
  if (!reason) return "Fallback active";
  return FALLBACK_REASON_COPY[reason] ?? `Fallback active (${reason})`;
}

export function VoiceCostBadge({ userId, className }: VoiceCostBadgeProps): JSX.Element {
  const [showFallbackDetail, setShowFallbackDetail] = useState(false);

  // Type-erased lookup — `api.domains.integrations.voice.costLedger.checkCap`
  // resolves at runtime once codegen has consumed PR #274's mutation files.
  const checkCapRef = (api as unknown as {
    domains: { integrations: { voice: { costLedger: { checkCap: unknown } } } };
  }).domains.integrations.voice.costLedger.checkCap;

  const snap = useQuery(
    checkCapRef as Parameters<typeof useQuery>[0],
    { userId } as Parameters<typeof useQuery>[1],
  ) as CapSnapshot | undefined;

  // Subscribe to the latest routing decision so we can surface fallback
  // transparency. Same type-erasure pattern — codegen resolves at runtime.
  const routingRef = (api as unknown as {
    domains: {
      integrations: {
        voice: { realtimeGateway: { getLatestVoiceRoutingDecision: unknown } };
      };
    };
  }).domains.integrations.voice.realtimeGateway.getLatestVoiceRoutingDecision;

  const latestRouting = useQuery(
    routingRef as Parameters<typeof useQuery>[0],
    { userKey: userId } as Parameters<typeof useQuery>[1],
  ) as RoutingDecisionRow | null | undefined;

  const isLoading = snap === undefined;

  // HONEST_STATUS — fallback active when actualTierUsed differs from tier
  // OR when fallbackReason is explicitly set. Never assume "no fallback"
  // from absence of routing data — that just means no decision yet.
  const fallbackActive = Boolean(
    latestRouting &&
      latestRouting.decision &&
      ((latestRouting.decision.fallbackReason &&
        latestRouting.decision.fallbackReason.length > 0) ||
        (latestRouting.decision.actualTierUsed &&
          latestRouting.decision.tier &&
          latestRouting.decision.actualTierUsed !==
            latestRouting.decision.tier)),
  );

  const fallbackReason = latestRouting?.decision?.fallbackReason as
    | string
    | undefined;
  const requestedTier = latestRouting?.decision?.tier as string | undefined;
  const servedTier = latestRouting?.decision?.actualTierUsed as
    | string
    | undefined;
  const servedModel = latestRouting?.decision?.model as string | undefined;

  // Tone selection — matches CLAUDE.md design DNA + accessibility (color paired with text)
  const tone = !snap
    ? "muted"
    : snap.hit
      ? "rose"
      : snap.warning80pct
        ? "amber"
        : "accent";

  const toneClasses: Record<string, string> = {
    muted: "border-edge/30 bg-content/[0.02]",
    accent: "border-edge/30 bg-content/[0.02]",
    amber: "border-amber-300/40 bg-amber-500/10",
    rose: "border-rose-300/40 bg-rose-500/10",
  };

  const fillClasses: Record<string, string> = {
    muted: "bg-content/20",
    accent: "bg-[#d97757]",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
  };

  const pct = snap ? Math.min(100, Math.round((snap.totalUsd / Math.max(snap.capUsd, 0.01)) * 100)) : 0;

  return (
    <section
      role="region"
      aria-label="Daily voice spend"
      className={[
        "rounded-2xl border bg-surface/80 backdrop-blur-md",
        "p-4 sm:p-5",
        toneClasses[tone],
        className ?? "",
      ].join(" ")}
    >
      <header className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-content-muted">
          Voice spend today
        </h3>
        {!isLoading && (
          <span className="text-[11px] text-content-muted/80 font-mono">
            {snap?.dayUtc}
          </span>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-6 w-32 rounded bg-content/[0.06] animate-pulse" />
          <div className="h-1.5 w-full rounded-full bg-content/[0.05] animate-pulse" />
        </div>
      ) : snap ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-2xl font-semibold tabular-nums text-content">
              {fmtUsd(snap.totalUsd)}
              <span className="ml-2 text-sm font-normal text-content-muted">
                / {fmtUsd(snap.capUsd)}
              </span>
            </p>
            <span
              className={[
                "text-xs font-medium tabular-nums",
                tone === "rose"
                  ? "text-rose-300"
                  : tone === "amber"
                    ? "text-amber-300"
                    : "text-content-muted",
              ].join(" ")}
            >
              {pct}%
            </span>
          </div>

          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-content/[0.05]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% of daily voice cap used`}
          >
            <div
              className={[
                "h-full rounded-full transition-all duration-300",
                fillClasses[tone],
              ].join(" ")}
              style={{ width: `${pct}%` }}
            />
          </div>

          {snap.hit && (
            <p className="mt-2 text-xs text-rose-300">
              Daily cap reached. Capture-only mode until midnight UTC. Agent + translation tiers blocked.
            </p>
          )}
          {!snap.hit && snap.warning80pct && (
            <p className="mt-2 text-xs text-amber-300">
              Approaching daily voice cap. {fmtUsd(snap.remaining)} remaining.
            </p>
          )}
          {!snap.hit && !snap.warning80pct && snap.totalUsd > 0 && (
            <p className="mt-2 text-xs text-content-muted">
              {fmtUsd(snap.remaining)} remaining today.
            </p>
          )}
          {snap.totalUsd === 0 && (
            <p className="mt-2 text-xs text-content-muted">
              No voice activity today.
            </p>
          )}

          {/* HONEST_STATUS fallback transparency — surface when the served
              tier differs from what was requested. role="status" +
              aria-live="polite" so screen readers announce the
              degradation without grabbing focus. */}
          {fallbackActive && (
            <div
              role="status"
              aria-live="polite"
              data-testid="voice-fallback-chip"
              className="mt-3 rounded-xl border border-amber-300/40 bg-amber-500/10 p-3"
            >
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 text-amber-300">
                  &#9888;
                </span>
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowFallbackDetail((v) => !v)}
                    aria-expanded={showFallbackDetail}
                    aria-controls="voice-fallback-detail"
                    aria-label={`Voice tier fallback active: ${fallbackCopy(fallbackReason)}. Toggle details.`}
                    className="text-left text-xs text-amber-200 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 focus-visible:ring-offset-0 rounded"
                  >
                    <span className="font-medium">Fallback active.</span>{" "}
                    <span>{fallbackCopy(fallbackReason)}</span>
                  </button>
                  {showFallbackDetail && (
                    <dl
                      id="voice-fallback-detail"
                      className="mt-2 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11px] text-content-muted"
                    >
                      {requestedTier && (
                        <>
                          <dt className="font-medium text-content-muted/80">
                            Requested
                          </dt>
                          <dd className="font-mono">{requestedTier}</dd>
                        </>
                      )}
                      {servedTier && servedTier !== requestedTier && (
                        <>
                          <dt className="font-medium text-content-muted/80">
                            Served
                          </dt>
                          <dd className="font-mono">{servedTier}</dd>
                        </>
                      )}
                      {servedModel && (
                        <>
                          <dt className="font-medium text-content-muted/80">
                            Model
                          </dt>
                          <dd className="font-mono">{servedModel}</dd>
                        </>
                      )}
                      {fallbackReason && (
                        <>
                          <dt className="font-medium text-content-muted/80">
                            Reason
                          </dt>
                          <dd className="font-mono">{fallbackReason}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
