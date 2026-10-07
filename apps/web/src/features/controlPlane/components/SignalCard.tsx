/**
 * SignalCard — Renders a classified signal with evidence badges.
 *
 * Shows: category tag, label, direction arrow, confidence bar,
 * evidence count with verification status, expandable source drawer.
 */

import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types matching server response ──────────────────────────────

interface SignalVariable {
  rank: number;
  name: string;
  category?: string;
  direction: string;
  impact: string;
  confidence?: number;
  rawName?: string;
  evidenceRefs?: string[];
  needsOntologyReview?: boolean;
}

interface EvidenceSpan {
  spanId: string;
  sourceUrl: string | null;
  claimText: string;
  verificationStatus: "verified" | "partial" | "unverified" | "contradicted";
  confidence: number;
  sourceSnippet: string;
  retrievalMethod: string;
  sourceTitle: string;
}

interface EvidenceManifest {
  totalSpans: number;
  verifiedCount: number;
  partialCount: number;
  unverifiedCount: number;
  contradictedCount: number;
  verificationRate: number;
  spans: EvidenceSpan[];
}

// ─── Direction icon ──────────────────────────────────────────────

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (direction === "down") return <TrendingDown className="h-3.5 w-3.5 text-rose-400" />;
  return <Minus className="h-3.5 w-3.5 text-content-muted" />;
}

// ─── Verification badge ──────────────────────────────────────────

function VerificationBadge({ status, count }: { status: string; count: number }) {
  const config = {
    verified: { icon: ShieldCheck, color: "text-emerald-400 bg-emerald-500/10", label: "Verified" },
    partial: { icon: ShieldAlert, color: "text-amber-400 bg-amber-500/10", label: "Partial" },
    unverified: { icon: ShieldQuestion, color: "text-content-muted bg-white/[0.04]", label: "Unverified" },
    contradicted: { icon: ShieldAlert, color: "text-rose-400 bg-rose-500/10", label: "Contradicted" },
  }[status] ?? { icon: ShieldQuestion, color: "text-content-muted bg-white/[0.04]", label: "Unknown" };

  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", config.color)}>
      <Icon className="h-3 w-3" />
      {count} {config.label.toLowerCase()}
    </span>
  );
}

// ─── Confidence bar ──────────────────────────────────────────────

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-content-muted">{pct}%</span>
    </div>
  );
}

// ─── Source drawer ────────────────────────────────────────────────

function SourceDrawer({ spans }: { spans: EvidenceSpan[] }) {
  if (!spans.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-white/[0.04] pt-2">
      {spans.map((span) => (
        <div key={span.spanId} className="flex items-start gap-2 text-[11px]">
          <VerificationBadge status={span.verificationStatus} count={1} />
          <div className="min-w-0 flex-1">
            {span.sourceSnippet && (
              <p className="line-clamp-2 text-content-muted">{span.sourceSnippet}</p>
            )}
            {span.sourceUrl && (
              <a
                href={span.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-accent-primary hover:underline"
              >
                {span.sourceTitle}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────

export function SignalCard({
  signal,
  evidence,
}: {
  signal: SignalVariable;
  evidence?: EvidenceManifest;
}) {
  const [expanded, setExpanded] = useState(false);

  // Find evidence spans relevant to this signal
  const relevantSpans = (evidence?.spans ?? []).filter((span) => {
    const sigName = (signal.rawName ?? signal.name).toLowerCase();
    return span.claimText.toLowerCase().includes(sigName.slice(0, 15));
  });

  const bestStatus = relevantSpans.length > 0
    ? relevantSpans.some((s) => s.verificationStatus === "verified") ? "verified"
      : relevantSpans.some((s) => s.verificationStatus === "partial") ? "partial"
        : relevantSpans.some((s) => s.verificationStatus === "contradicted") ? "contradicted"
          : "unverified"
    : "unverified";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      {/* Top row: category + direction + impact */}
      <div className="flex items-center gap-2">
        {signal.category && (
          <span className="rounded-md bg-accent-primary/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-primary/80">
            {signal.category}
          </span>
        )}
        <DirectionIcon direction={signal.direction} />
        <span className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase",
          signal.impact === "high" ? "bg-rose-500/10 text-rose-400"
            : signal.impact === "medium" ? "bg-amber-500/10 text-amber-400"
              : "bg-white/[0.04] text-content-muted",
        )}>
          {signal.impact}
        </span>
        <div className="flex-1" />
        {signal.confidence != null && <ConfidenceBar confidence={signal.confidence} />}
      </div>

      {/* Label */}
      <div className="mt-2 text-[13px] font-medium text-content">{signal.name}</div>

      {/* Evidence summary + expand toggle */}
      <div className="mt-2 flex items-center gap-2">
        {relevantSpans.length > 0 ? (
          <VerificationBadge status={bestStatus} count={relevantSpans.length} />
        ) : (
          <VerificationBadge status="unverified" count={0} />
        )}

        {relevantSpans.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="ml-auto flex items-center gap-1 text-[10px] text-content-muted transition-colors hover:text-content"
          >
            Sources
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* Expandable source drawer */}
      {expanded && <SourceDrawer spans={relevantSpans} />}
    </div>
  );
}

export default SignalCard;
