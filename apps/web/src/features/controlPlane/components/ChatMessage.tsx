/**
 * ChatMessage — renders one turn in the conversation thread.
 *
 * User messages: right-aligned text bubble.
 * Assistant messages: rich structured card with entity header, answer,
 * expandable sections (variables, risks, comparables, sources),
 * and follow-up question chips.
 */

import { memo, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Target,
  Globe,
  Sparkles,
  ExternalLink,
  Users,
  Shield,
  Eye,
} from "lucide-react";
import type { ResultPacket, LensId } from "./searchTypes";
import { CompanyProfile } from "./CompanyProfile";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ChatEntry {
  id: string;
  query: string;
  lens: LensId;
  packet: ResultPacket | null; // null = loading
  timestamp: Date;
}

interface ChatMessageProps {
  entry: ChatEntry;
  onFollowUp?: (query: string) => void;
  onViewProfile?: (entry: ChatEntry) => void;
  isLatest?: boolean;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function DirectionIcon({ dir }: { dir: string }) {
  if (dir === "up") return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (dir === "down") return <TrendingDown className="h-3 w-3 text-rose-400" />;
  return <Minus className="h-3 w-3 text-content-muted" />;
}

function ImpactBadge({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    high: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${colors[impact] ?? colors.low}`}>
      {impact}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color = confidence >= 70 ? "bg-emerald-500" : confidence >= 40 ? "bg-amber-500" : "bg-rose-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

/* ── Expandable Section ─────────────────────────────────────────────── */

function Section({ title, icon: Icon, count, children, defaultOpen = false }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="border-t border-edge/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-content-muted hover:text-content transition-colors"
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="flex-1">{title}</span>
        <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums">{count}</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/* ── Loading Skeleton ───────────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-edge/40 bg-surface/50 p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-4 w-28 rounded bg-white/[0.06]" />
        <div className="h-4 w-12 rounded bg-white/[0.06]" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-white/[0.06]" />
        <div className="h-3 w-4/5 rounded bg-white/[0.06]" />
        <div className="h-3 w-3/5 rounded bg-white/[0.06]" />
      </div>
    </div>
  );
}

/* ── User Message ───────────────────────────────────────────────────── */

function UserBubble({ query }: { query: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[#d97757]/15 border border-[#d97757]/20 px-4 py-2.5 text-sm text-content">
        {query}
      </div>
    </div>
  );
}

/* ── Assistant Message ──────────────────────────────────────────────── */

function AssistantMessage({ entry, onFollowUp, onViewProfile }: {
  entry: ChatEntry;
  onFollowUp?: (query: string) => void;
  onViewProfile?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const p = entry.packet;
  if (!p) return <LoadingSkeleton />;

  const handleCopy = () => {
    navigator.clipboard.writeText(p.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-edge/40 bg-surface/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-[#d97757]" />
          <span className="text-sm font-semibold text-content">{p.entityName || "Analysis"}</span>
          <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-content-muted">
            <ConfidenceDot confidence={p.confidence} />
            {p.confidence}%
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md p-1.5 text-content-muted hover:text-content hover:bg-white/[0.06] transition-colors"
            title="Copy answer"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {onViewProfile && (
            <button
              type="button"
              onClick={() => onViewProfile()}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#d97757] hover:bg-[#d97757]/10 transition-colors"
            >
              Full profile
              <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Answer */}
      <div className="px-4 pb-3 text-[13px] leading-relaxed text-content-secondary">
        {p.answer}
      </div>

      {/* Expandable Sections */}
      <Section title="VC Scorecard" icon={Target} count={p.variables?.length ?? 0} defaultOpen>
        <div className="space-y-1.5">
          {p.variables?.map((v, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-content-muted tabular-nums">{v.rank}.</span>
              <DirectionIcon dir={v.direction} />
              <span className="flex-1 text-content-secondary">{v.name}</span>
              <ImpactBadge impact={v.impact} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Risks" icon={AlertTriangle} count={p.risks?.length ?? 0}>
        <div className="space-y-2">
          {p.risks?.map((r, i) => (
            <div key={i} className="rounded-lg border border-edge/30 bg-white/[0.02] p-2.5">
              <div className="text-xs font-medium text-content">{r.title}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-content-muted">{r.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {p.whyThisTeam && (
        <Section title="Why This Team" icon={Users} count={p.whyThisTeam.trustSignals?.length ?? 0} defaultOpen>
          <div className="space-y-2.5">
            {p.whyThisTeam.founderCredibility && (
              <div className="rounded-lg border border-edge/30 bg-white/[0.02] p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#d97757]/70 mb-1">
                  <Shield className="h-3 w-3" />Founder Credibility
                </div>
                <p className="text-[11px] leading-relaxed text-content-secondary">{p.whyThisTeam.founderCredibility}</p>
              </div>
            )}
            {p.whyThisTeam.trustSignals?.length > 0 && (
              <div className="rounded-lg border border-edge/30 bg-white/[0.02] p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-emerald-400/70 mb-1.5">
                  <Check className="h-3 w-3" />Trust Signals
                </div>
                <div className="space-y-1">
                  {p.whyThisTeam.trustSignals.map((s: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] text-content-secondary">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400/60" />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {p.whyThisTeam.visionMagnitude && (
              <div className="text-[11px] leading-relaxed text-content-muted">
                <span className="font-medium text-content-secondary">Market magnitude: </span>
                {p.whyThisTeam.visionMagnitude}
              </div>
            )}
            {p.whyThisTeam.hiddenRequirements?.length > 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-amber-400/70 mb-1.5">
                  <Eye className="h-3 w-3" />What Outsiders Will Expect
                </div>
                <div className="space-y-1">
                  {p.whyThisTeam.hiddenRequirements.map((r: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] text-content-secondary">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400/60" />
                      {r}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="Competitive Landscape" icon={Globe} count={p.comparables?.length ?? 0}>
        <div className="flex flex-wrap gap-2">
          {p.comparables?.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onFollowUp?.(`Tell me about ${c.name}`)}
              className="flex items-center gap-1.5 rounded-lg border border-edge/30 bg-white/[0.02] px-2.5 py-1.5 text-xs text-content-secondary hover:border-[#d97757]/20 hover:bg-[#d97757]/[0.04] transition-colors"
            >
              <span>{c.name}</span>
              <ImpactBadge impact={c.relevance} />
            </button>
          ))}
        </div>
      </Section>

      <Section title="Sources" icon={ExternalLink} count={p.sourceRefs?.length ?? p.sourceCount ?? 0}>
        <div className="space-y-1">
          {p.sourceRefs?.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="w-4 text-content-muted tabular-nums">{i + 1}.</span>
              {s.href ? (
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-[#d97757] hover:underline truncate max-w-[300px]">
                  {s.title || s.label || s.domain || s.href}
                </a>
              ) : (
                <span className="text-content-muted">{s.label}</span>
              )}
              {s.confidence != null && s.confidence > 0 && (
                <span className="ml-auto flex items-center gap-1 text-content-muted">
                  <ConfidenceDot confidence={s.confidence > 1 ? s.confidence : s.confidence * 100} />
                  {s.confidence > 1 ? Math.round(s.confidence) : Math.round(s.confidence * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Follow-up chips */}
      {(p.nextQuestions?.length ?? 0) > 0 && (
        <div className="border-t border-edge/40 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.15em] text-content-muted mb-2">Follow up</div>
          <div className="flex flex-wrap gap-1.5">
            {p.nextQuestions?.slice(0, 4).map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onFollowUp?.(q)}
                className="rounded-full border border-edge/40 bg-white/[0.03] px-3 py-1.5 text-[11px] text-content-secondary hover:border-[#d97757]/20 hover:bg-[#d97757]/[0.04] hover:text-content transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Export ─────────────────────────────────────────────────────── */

export const ChatMessage = memo(function ChatMessage({
  entry,
  onFollowUp,
  onViewProfile,
  isLatest,
}: ChatMessageProps) {
  const [showProfile, setShowProfile] = useState(false);

  return (
    <div className="space-y-3">
      <UserBubble query={entry.query} />
      {showProfile && entry.packet ? (
        <CompanyProfile
          packet={entry.packet}
          onClose={() => setShowProfile(false)}
          onSearch={onFollowUp}
        />
      ) : (
        <AssistantMessage
          entry={entry}
          onFollowUp={onFollowUp}
          onViewProfile={() => setShowProfile(true)}
        />
      )}
    </div>
  );
});

export default ChatMessage;
