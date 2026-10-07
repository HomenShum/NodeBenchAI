/**
 * CompanyProfile — Rich expanded company view from a ResultPacket.
 *
 * Renders 8 structured sections: Overview, VC Scorecard, Changes,
 * Risks, Competitive Landscape, Scenarios, Actions, Sources.
 * All data comes from the existing ResultPacket — no new API calls.
 */

import { memo, useState } from "react";
import {
  ArrowUpRight,
  AlertTriangle,
  BarChart3,
  ChevronUp,
  Globe,
  Lightbulb,
  Shield,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Calendar,
  Sparkles,
  X,
} from "lucide-react";
import type { ResultPacket } from "./searchTypes";

/* ── Helpers ─────────────────────────────────────────────────────── */

function DirectionIcon({ dir }: { dir: string }) {
  if (dir === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (dir === "down") return <TrendingDown className="h-3.5 w-3.5 text-rose-400" />;
  return <Minus className="h-3.5 w-3.5 text-content-muted" />;
}

function ImpactDot({ impact }: { impact: string }) {
  const c = impact === "high" ? "bg-rose-500" : impact === "medium" ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}

const SECTION_HEADER = "mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted";
const CARD = "rounded-xl border border-edge/40 bg-surface/50 p-4";

/* ── Section Components ──────────────────────────────────────────── */

function OverviewSection({ packet: p }: { packet: ResultPacket }) {
  return (
    <div className={CARD}>
      <p className="text-sm leading-relaxed text-content-secondary">{p.answer}</p>
      {p.keyMetrics && p.keyMetrics.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {p.keyMetrics.map((m, i) => (
            <div key={i} className="rounded-lg border border-edge/30 bg-white/[0.02] px-3 py-2 text-center">
              <div className="text-lg font-semibold text-content tabular-nums">{m.value}</div>
              <div className="text-[10px] text-content-muted">{m.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScorecardSection({ packet: p }: { packet: ResultPacket }) {
  if (!p.variables?.length) return null;
  return (
    <div>
      <h3 className={SECTION_HEADER}><Target className="mr-1.5 inline h-3.5 w-3.5" />VC Scorecard</h3>
      <div className={CARD}>
        <div className="space-y-2">
          {p.variables.map((v, i) => (
            <div key={i} className="flex items-center gap-3 py-1 border-b border-edge/20 last:border-0">
              <span className="w-5 text-xs text-content-muted tabular-nums font-medium">{v.rank}.</span>
              <DirectionIcon dir={v.direction} />
              <span className="flex-1 text-sm text-content">{v.name}</span>
              <span className="flex items-center gap-1.5">
                <ImpactDot impact={v.impact} />
                <span className="text-[10px] text-content-muted capitalize">{v.impact}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChangesSection({ packet: p }: { packet: ResultPacket }) {
  if (!p.changes?.length) return null;
  return (
    <div>
      <h3 className={SECTION_HEADER}><Calendar className="mr-1.5 inline h-3.5 w-3.5" />What Changed</h3>
      <div className="space-y-2">
        {p.changes.map((c, i) => (
          <div key={i} className={`${CARD} flex items-start gap-3`}>
            <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#d97757]" />
            <div className="flex-1">
              <p className="text-sm text-content-secondary">{c.description}</p>
              {c.date && <time className="mt-1 block text-[10px] text-content-muted">{c.date}</time>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RisksSection({ packet: p }: { packet: ResultPacket }) {
  if (!p.risks?.length) return null;
  return (
    <div>
      <h3 className={SECTION_HEADER}><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />Risk Register</h3>
      <div className="space-y-2">
        {p.risks.map((r, i) => (
          <div key={i} className={`${CARD} border-l-2 border-l-rose-500/40`}>
            <div className="text-sm font-medium text-content">{r.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-content-muted">{r.description}</p>
            {r.falsification && (
              <p className="mt-2 text-[10px] italic text-content-muted">
                <Shield className="mr-1 inline h-3 w-3" />
                Kill signal: {r.falsification}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparablesSection({ packet: p, onSearch }: { packet: ResultPacket; onSearch?: (name: string) => void }) {
  if (!p.comparables?.length) return null;
  return (
    <div>
      <h3 className={SECTION_HEADER}><Globe className="mr-1.5 inline h-3.5 w-3.5" />Competitive Landscape</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {p.comparables.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSearch?.(c.name)}
            className={`${CARD} text-left transition-all hover:border-[#d97757]/20 hover:bg-[#d97757]/[0.03]`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-content">{c.name}</span>
              <ArrowUpRight className="h-3 w-3 text-content-muted" />
            </div>
            {c.note && <p className="mt-1 text-[11px] text-content-muted">{c.note}</p>}
            <div className="mt-2 flex items-center gap-1">
              <ImpactDot impact={c.relevance} />
              <span className="text-[10px] text-content-muted capitalize">{c.relevance} relevance</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ScenariosSection({ packet: p }: { packet: ResultPacket }) {
  if (!p.scenarios?.length) return null;
  return (
    <div>
      <h3 className={SECTION_HEADER}><BarChart3 className="mr-1.5 inline h-3.5 w-3.5" />Scenario Branches</h3>
      <div className="space-y-2">
        {p.scenarios.map((s, i) => (
          <div key={i} className={CARD}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-content">{s.label}</span>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium tabular-nums text-content-muted">
                {typeof s.probability === "number" ? `${Math.round(s.probability * 100)}%` : s.probability}
              </span>
            </div>
            <p className="mt-1 text-xs text-content-muted">{s.outcome}</p>
            {/* Probability bar */}
            <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-[#d97757]"
                style={{ width: `${Math.round((typeof s.probability === "number" ? s.probability : 0.5) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionsSection({ packet: p }: { packet: ResultPacket }) {
  if (!p.interventions?.length) return null;
  return (
    <div>
      <h3 className={SECTION_HEADER}><Lightbulb className="mr-1.5 inline h-3.5 w-3.5" />Recommended Actions</h3>
      <div className="space-y-2">
        {p.interventions.map((a, i) => (
          <div key={i} className={`${CARD} flex items-start gap-3`}>
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#d97757]/10 text-xs font-bold text-[#d97757]">
              {i + 1}
            </span>
            <div className="flex-1">
              <p className="text-sm text-content">{a.action}</p>
              <div className="mt-1 flex items-center gap-1">
                <ImpactDot impact={a.impact} />
                <span className="text-[10px] text-content-muted capitalize">{a.impact} impact</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcesSection({ packet: p }: { packet: ResultPacket }) {
  const sources = p.sourceRefs ?? [];
  if (sources.length === 0 && (p.sourceCount ?? 0) === 0) return null;
  return (
    <div>
      <h3 className={SECTION_HEADER}><ExternalLink className="mr-1.5 inline h-3.5 w-3.5" />Sources ({sources.length || p.sourceCount})</h3>
      <div className={CARD}>
        <div className="space-y-1.5">
          {sources.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-4 shrink-0 text-content-muted tabular-nums">{i + 1}.</span>
              {s.href ? (
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-[#d97757] hover:underline"
                >
                  {s.title || s.label || s.domain || "Source"}
                </a>
              ) : (
                <span className="flex-1 truncate text-content-muted">{s.label || "Local source"}</span>
              )}
              {s.domain && <span className="shrink-0 text-content-muted">{s.domain}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────── */

interface CompanyProfileProps {
  packet: ResultPacket;
  onClose: () => void;
  onSearch?: (query: string) => void;
}

export const CompanyProfile = memo(function CompanyProfile({
  packet,
  onClose,
  onSearch,
}: CompanyProfileProps) {
  return (
    <div className="rounded-2xl border border-edge/40 bg-surface/80 backdrop-blur-sm overflow-hidden">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-edge/40 bg-surface/90 backdrop-blur-md px-5 py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-[#d97757]" />
          <h2 className="text-lg font-semibold text-content">{packet.entityName}</h2>
          <span className="rounded-full bg-[#d97757]/10 px-2 py-0.5 text-xs font-medium text-[#d97757] tabular-nums">
            {packet.confidence}% confidence
          </span>
          {packet.proofStatus && (
            <span className="rounded-full border border-edge/40 px-2 py-0.5 text-[10px] text-content-muted capitalize">
              {packet.proofStatus}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="rounded-lg p-2.5 text-content-muted hover:text-content hover:bg-white/[0.10] transition-colors"
          aria-label="Close profile"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content sections */}
      <div className="space-y-6 px-5 py-5">
        <OverviewSection packet={packet} />
        <ScorecardSection packet={packet} />
        <ChangesSection packet={packet} />
        <RisksSection packet={packet} />
        <ComparablesSection packet={packet} onSearch={onSearch} />
        <ScenariosSection packet={packet} />
        <ActionsSection packet={packet} />
        <SourcesSection packet={packet} />

        {/* Follow-up questions */}
        {packet.nextQuestions && packet.nextQuestions.length > 0 && (
          <div>
            <h3 className={SECTION_HEADER}>Dig deeper</h3>
            <div className="flex flex-wrap gap-2">
              {packet.nextQuestions.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSearch?.(q)}
                  className="rounded-full border border-edge/40 bg-white/[0.03] px-3 py-1.5 text-xs text-content-secondary hover:border-[#d97757]/20 hover:bg-[#d97757]/[0.04] hover:text-content transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default CompanyProfile;
