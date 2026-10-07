/**
 * EmbedView — Minimal iframe-friendly artifact widgets at /embed/:type/:id
 *
 * Types: memo, company, confidence
 * Designed for embedding in external sites, docs, or presentations.
 */

import { memo, useMemo, useEffect } from "react";
// type/id parsed from window.location.pathname (rendered outside React Router)
import { Building2, FileText, Gauge, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Demo Data ────────────────────────────────────────────────────────────

const DEMO_MEMO_EMBED = {
  company: "NodeBench",
  question: "Should we focus on hackathon distribution?",
  answer: "Yes. Hackathon teams have high urgency and willingness to try new tools. Pair with retention.sh for full-stack value.",
  confidence: 85,
};

const DEMO_COMPANY_EMBED = {
  name: "NodeBench",
  mission: "Operating intelligence for agent-native businesses",
  state: "operating",
  confidence: 88,
  signalCount: 14,
};

// ── Components ───────────────────────────────────────────────────────────

function MemoEmbed({ id }: { id: string }) {
  const data = useMemo(() => {
    try {
      const stored = localStorage.getItem("nodebench-memos");
      if (stored) {
        const memos = JSON.parse(stored);
        if (memos[id]) return memos[id];
      }
    } catch { /* fallback */ }
    return DEMO_MEMO_EMBED;
  }, [id]);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#1a1918] p-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent-primary" />
        <span className="text-[10px] uppercase tracking-[0.15em] text-white/30">Decision Memo</span>
      </div>
      <h3 className="mt-2 text-sm font-medium text-white/80">{data.question}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/40">{data.answer}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[10px] tabular-nums font-medium",
          data.confidence >= 75 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400",
        )}>
          {data.confidence}% confidence
        </span>
        <a
          href={`https://nodebenchai.com/memo/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-accent-primary hover:underline"
        >
          View full memo
        </a>
      </div>
    </div>
  );
}

function CompanyEmbed({ id }: { id: string }) {
  const data = useMemo(() => {
    try {
      const stored = localStorage.getItem("nodebench-company-profiles");
      if (stored) {
        const profiles = JSON.parse(stored);
        if (profiles[id]) return profiles[id];
      }
    } catch { /* fallback */ }
    return DEMO_COMPANY_EMBED;
  }, [id]);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#1a1918] p-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-accent-primary" />
        <span className="text-[10px] uppercase tracking-[0.15em] text-white/30">Company Intelligence</span>
      </div>
      <h3 className="mt-2 text-sm font-medium text-white/80">{data.name}</h3>
      <p className="mt-1 text-[11px] text-white/40">{data.mission}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] capitalize text-white/40">
          {data.state}
        </span>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[10px] tabular-nums",
          data.confidence >= 80 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400",
        )}>
          {data.confidence}%
        </span>
        <span className="text-[10px] text-white/25">{data.signalCount} signals</span>
      </div>
      <a
        href={`https://nodebenchai.com/company/${id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-[10px] text-accent-primary hover:underline"
      >
        View full profile
      </a>
    </div>
  );
}

function ConfidenceEmbed({ id }: { id: string }) {
  const confidence = useMemo(() => {
    try {
      const stored = localStorage.getItem("nodebench-memos");
      if (stored) {
        const memos = JSON.parse(stored);
        if (memos[id]?.confidence) return memos[id].confidence;
      }
    } catch { /* fallback */ }
    return 85;
  }, [id]);

  const color = confidence >= 75 ? "#10b981" : confidence >= 50 ? "#06b6d4" : confidence >= 25 ? "#f59e0b" : "#f43f5e";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#1a1918] p-4">
      <Gauge className="h-6 w-6" style={{ color }} />
      <div>
        <div className="text-2xl font-light tabular-nums" style={{ color }}>{confidence}%</div>
        <div className="text-[9px] uppercase tracking-wider text-white/25">Confidence</div>
      </div>
      <a
        href={`https://nodebenchai.com/memo/${id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto text-[10px] text-accent-primary hover:underline"
      >
        Details
      </a>
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────────────

function EmbedViewInner() {
  // Parse type and id from pathname directly since we're outside React Router's <Route>
  const { type, id } = useMemo(() => {
    const parts = window.location.pathname.replace(/^\/embed\//, "").split("/");
    return { type: parts[0] || undefined, id: parts[1] || undefined };
  }, []);

  useEffect(() => {
    document.title = `NodeBench Embed — ${type}`;
  }, [type]);

  if (!type || !id) {
    return (
      <div className="flex items-center justify-center p-6 text-white/30 text-xs">
        Invalid embed URL. Format: /embed/:type/:id
      </div>
    );
  }

  return (
    <div className="min-h-0 bg-transparent p-2 text-white" style={{ fontFamily: "'Manrope', sans-serif" }}>
      {type === "memo" && <MemoEmbed id={id} />}
      {type === "company" && <CompanyEmbed id={id} />}
      {type === "confidence" && <ConfidenceEmbed id={id} />}
      {!["memo", "company", "confidence"].includes(type) && (
        <div className="rounded-xl border border-white/[0.08] bg-[#1a1918] p-4 text-center text-[11px] text-white/30">
          Unknown embed type: {type}. Supported: memo, company, confidence.
        </div>
      )}
      <div className="mt-1 flex items-center justify-center gap-1 opacity-40">
        <Sparkles className="h-2.5 w-2.5 text-accent-primary" />
        <span className="text-[8px] text-white/20">NodeBench Delta</span>
      </div>
    </div>
  );
}

const EmbedView = memo(EmbedViewInner);
export default EmbedView;
