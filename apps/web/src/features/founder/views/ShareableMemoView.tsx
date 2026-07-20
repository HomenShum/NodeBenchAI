/**
 * ShareableMemoView — Standalone, public-facing Decision Memo page.
 *
 * Route: /memo/:id
 * No auth required. No sidebar, no nav, no cockpit chrome.
 * Renders a beautiful, print-ready Decision Memo — the viral artifact.
 *
 * Data source: localStorage key "nodebench-memos" (JSON map of id -> MemoData).
 * Pre-seeded: /memo/demo always works with built-in demo data.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation, Link } from "react-router-dom";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ShareableMemoVariable {
  rank: number;
  name: string;
  direction: "up" | "down" | "neutral";
  impact: "high" | "medium" | "low";
}

export interface ShareableMemoScenario {
  label: string;
  probability: number;
  outcome: string;
}

export interface ShareableMemoAction {
  action: string;
  impact: "high" | "medium" | "low";
}

export interface ShareableMemoData {
  id: string;
  company: string;
  date: string;
  question: string;
  answer: string;
  confidence: number;
  sourceCount: number;
  variables: ShareableMemoVariable[];
  scenarios: ShareableMemoScenario[];
  actions: ShareableMemoAction[];
}

/* ------------------------------------------------------------------ */
/*  Demo data — pre-seeded so /memo/demo always works                  */
/* ------------------------------------------------------------------ */

export const DEMO_MEMO: ShareableMemoData = {
  id: "demo",
  company: "Acme AI",
  date: new Date().toISOString().slice(0, 10),
  question: "Should we raise Series A now or wait until Q3?",
  answer:
    "Raise now. Your distribution quality is high enough to command terms, but the window narrows as 3 funded competitors enter your segment in Q2. Waiting risks a crowded round.",
  confidence: 78,
  sourceCount: 14,
  variables: [
    { rank: 1, name: "Distribution quality", direction: "up", impact: "high" },
    { rank: 2, name: "Competitive entry timing", direction: "down", impact: "high" },
    { rank: 3, name: "Revenue retention trend", direction: "up", impact: "medium" },
    { rank: 4, name: "Founder-market signal", direction: "up", impact: "medium" },
    { rank: 5, name: "Macro funding climate", direction: "neutral", impact: "low" },
  ],
  scenarios: [
    { label: "Base", probability: 55, outcome: "Close $8M at $40M pre by mid-Q2" },
    { label: "Bull", probability: 25, outcome: "Oversubscribed $12M at $55M pre — strong signal" },
    { label: "Bear", probability: 20, outcome: "Delayed to Q3 — competitors dilute narrative" },
  ],
  actions: [
    { action: "Lock 2 lead investors before Q2 competitor announcements", impact: "high" },
    { action: "Ship retention dashboard to prove net revenue expansion", impact: "medium" },
    { action: "Run pilot with enterprise design partner for Series A narrative", impact: "medium" },
  ],
};

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                               */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "nodebench-memos";

export function saveMemoToStorage(memo: ShareableMemoData): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: Record<string, ShareableMemoData> = raw ? JSON.parse(raw) : {};
    store[memo.id] = memo;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // best-effort
  }
}

export function getMemoFromStorage(id: string): ShareableMemoData | null {
  if (id === "demo") return DEMO_MEMO;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const store: Record<string, ShareableMemoData> = JSON.parse(raw);
    return store[id] ?? null;
  } catch {
    return null;
  }
}

export function generateMemoId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function copyMemoUrl(id: string): void {
  const url = `${window.location.origin}/memo/${id}`;
  navigator.clipboard.writeText(url).catch(() => {
    // fallback: hidden textarea copy (prompt() not supported in all contexts)
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

/* ------------------------------------------------------------------ */
/*  OG Meta Tags                                                       */
/* ------------------------------------------------------------------ */

function MemoMetaTags({ memo }: { memo: ShareableMemoData }) {
  useEffect(() => {
    const setMeta = (property: string, content: string) => {
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("property", property);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    const title = `Decision Memo: ${memo.question.slice(0, 60)} — NodeBench`;
    document.title = title;
    setMeta("og:title", `${memo.company} — Decision Memo`);
    setMeta("og:description", memo.answer.slice(0, 200));
    setMeta("og:type", "article");
    setMeta("og:url", window.location.href);
    setMeta("og:site_name", "NodeBench");

    // Dynamic OG image via /api/og/:id edge function
    const ogParams = new URLSearchParams({
      company: memo.company,
      question: memo.question.slice(0, 90),
      confidence: String(memo.confidence),
      verdict: memo.answer.slice(0, 160),
    });
    const topVars = memo.variables.slice(0, 3);
    topVars.forEach((v, i) => ogParams.set(`s${i + 1}`, v.name));
    const ogImageUrl = `${window.location.origin}/api/og/${memo.id}?${ogParams.toString()}`;
    setMeta("og:image", ogImageUrl);
    setMeta("og:image:width", "1200");
    setMeta("og:image:height", "630");

    // Twitter card
    const setMetaName = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", name);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };
    setMetaName("twitter:card", "summary_large_image");
    setMetaName("twitter:title", `${memo.company} — Decision Memo`);
    setMetaName("twitter:description", memo.answer.slice(0, 200));
    setMetaName("twitter:image", ogImageUrl);

    return () => {
      document.title = "NodeBench";
    };
  }, [memo]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Share bar                                                          */
/* ------------------------------------------------------------------ */

function MemoShareBar({ memo }: { memo: ShareableMemoData }) {
  const [copied, setCopied] = useState(false);

  const memoUrl = useMemo(
    () => `${window.location.origin}/memo/${memo.id}`,
    [memo.id],
  );

  const shareText = useMemo(
    () =>
      `${memo.company} Decision Memo: ${memo.question.slice(0, 80)}\n\nGenerated by NodeBench`,
    [memo.company, memo.question],
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(memoUrl).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = memoUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [memoUrl]);

  const handleTwitter = useCallback(() => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(memoUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer,width=550,height=420");
  }, [shareText, memoUrl]);

  const handleLinkedIn = useCallback(() => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(memoUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer,width=550,height=520");
  }, [memoUrl]);

  const handleNativeShare = useCallback(() => {
    if (navigator.share) {
      navigator.share({ title: `${memo.company} Decision Memo`, text: shareText, url: memoUrl }).catch(() => {
        // user cancelled — no-op
      });
    } else {
      handleCopy();
    }
  }, [memo.company, shareText, memoUrl, handleCopy]);

  const btnBase =
    "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[11px] font-medium transition-colors";
  const btnGlass =
    "border-white/[0.08] bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80";

  return (
    <div className="shareable-memo-no-print flex flex-wrap items-center gap-2">
      {/* Copy URL */}
      <button
        type="button"
        onClick={handleCopy}
        className={`${btnBase} ${copied ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : btnGlass}`}
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        )}
        {copied ? "Copied!" : "Copy link"}
      </button>

      {/* Twitter / X */}
      <button type="button" onClick={handleTwitter} className={`${btnBase} ${btnGlass}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        Share on X
      </button>

      {/* LinkedIn */}
      <button type="button" onClick={handleLinkedIn} className={`${btnBase} ${btnGlass}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        LinkedIn
      </button>

      {/* Native share (mobile / OS-level) */}
      {"share" in navigator && (
        <button type="button" onClick={handleNativeShare} className={`${btnBase} ${btnGlass}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const impactColor = (impact: "high" | "medium" | "low") =>
  impact === "high" ? "text-amber-400" : impact === "medium" ? "text-blue-400" : "text-zinc-500";

const directionArrow = (d: "up" | "down" | "neutral") =>
  d === "up" ? "\u2197" : d === "down" ? "\u2198" : "\u2192";

const confidenceDotColor = (c: number) =>
  c >= 75 ? "bg-emerald-500" : c >= 50 ? "bg-cyan-500" : c >= 25 ? "bg-amber-500" : "bg-rose-500";

function ScenarioBar({ scenario }: { scenario: ShareableMemoScenario }) {
  const barColor =
    scenario.label === "Bull"
      ? "bg-emerald-500/60"
      : scenario.label === "Bear"
        ? "bg-rose-500/60"
        : "bg-cyan-500/60";

  return (
    <div className="shareable-memo-scenario rounded-lg border border-white/[0.20] bg-white/[0.12] p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white/90">{scenario.label}</span>
        <span className="text-xs tabular-nums text-white/60">{scenario.probability}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${scenario.probability}%` }}
        />
      </div>
      <p className="mt-2.5 text-[12px] leading-relaxed text-white/60">{scenario.outcome}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Not Found state                                                    */
/* ------------------------------------------------------------------ */

function MemoNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#151413] px-6 text-center">
      <div className="text-6xl font-bold text-white/70">404</div>
      <h1 className="mt-4 text-xl font-semibold text-white/80">Memo not found</h1>
      <p className="mt-2 max-w-md text-sm text-white/60">
        This Decision Memo may have been removed, or the link is invalid.
        Memos are stored locally in your browser.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-primary/80"
      >
        Go to NodeBench
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ShareableMemoView() {
  const location = useLocation();
  // Extract ID from /memo/:id — no React Router <Route> needed
  const id = useMemo(() => {
    const match = location.pathname.match(/^\/memo\/(.+)$/);
    return match?.[1] ?? "";
  }, [location.pathname]);
  const memo = useMemo(() => getMemoFromStorage(id), [id]);

  if (!memo) return <MemoNotFound />;

  return (
    <>
      <MemoMetaTags memo={memo} />

      {/* Print stylesheet */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .shareable-memo-root { background: white !important; color: black !important; padding: 0 !important; }
          .shareable-memo-root * { color: black !important; border-color: #e5e7eb !important; }
          .shareable-memo-card { background: #f9fafb !important; border: 1px solid #e5e7eb !important; }
          .shareable-memo-scenario { background: #f9fafb !important; }
          .shareable-memo-accent { color: #d97757 !important; }
          .shareable-memo-footer { border-color: #e5e7eb !important; }
          .shareable-memo-no-print { display: none !important; }
          .shareable-memo-bar-bg { background: #e5e7eb !important; }
          .shareable-memo-bar-fill { opacity: 1 !important; }
        }
      `}</style>

      <div className="shareable-memo-root min-h-screen bg-[#151413] px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
        <div className="mx-auto max-w-2xl">

          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="mb-8 flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60" style={{ fontFamily: "Manrope, sans-serif" }}>
                Decision Memo
              </div>
              <h1 className="mt-1 text-lg font-bold text-white/90 sm:text-xl" style={{ fontFamily: "Manrope, sans-serif" }}>
                {memo.company}
              </h1>
              <div className="mt-1 text-[11px] text-white/60 tabular-nums">{memo.date}</div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1.5">
                <span className={`h-2 w-2 rounded-full ${confidenceDotColor(memo.confidence)}`} />
                <span className="text-xs font-semibold tabular-nums text-white/70">{memo.confidence}%</span>
                <span className="text-[10px] text-white/60">confidence</span>
              </div>
            </div>
          </div>

          {/* ── Share bar ──────────────────────────────────────────── */}
          <div className="mb-6">
            <MemoShareBar memo={memo} />
          </div>

          {/* ── Question ───────────────────────────────────────────── */}
          <div className="shareable-memo-card rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-3" style={{ fontFamily: "Manrope, sans-serif" }}>
              Question
            </div>
            <p className="text-base font-semibold leading-snug text-white/90 sm:text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>
              {memo.question}
            </p>
          </div>

          {/* ── Recommendation ─────────────────────────────────────── */}
          <div className="shareable-memo-card mt-4 rounded-xl border border-accent-primary/20 bg-accent-primary/[0.04] p-5 sm:p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-primary/60 mb-3 shareable-memo-accent" style={{ fontFamily: "Manrope, sans-serif" }}>
              Recommendation
            </div>
            <p className="text-sm leading-relaxed text-white/80 sm:text-base" style={{ fontFamily: "Manrope, sans-serif" }}>
              {memo.answer}
            </p>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-white/60">
              <span className="flex items-center gap-1.5">
                <span className={`inline-flex h-2 w-2 rounded-full ${confidenceDotColor(memo.confidence)}`} />
                {memo.confidence}% confidence
              </span>
              <span>{memo.sourceCount} sources analyzed</span>
            </div>
          </div>

          {/* ── Top Variables ──────────────────────────────────────── */}
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-3" style={{ fontFamily: "Manrope, sans-serif" }}>
              Top Variables
            </div>
            <div className="shareable-memo-card rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.06]">
              {memo.variables.map((v) => (
                <div key={v.rank} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="w-5 text-right text-[11px] tabular-nums text-white/60">
                    {v.rank}
                  </span>
                  <span className="flex-1 text-white/80" style={{ fontFamily: "Manrope, sans-serif" }}>{v.name}</span>
                  <span className="text-sm">{directionArrow(v.direction)}</span>
                  <span className={`text-[10px] font-semibold uppercase ${impactColor(v.impact)}`}>
                    {v.impact}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Scenarios ─────────────────────────────────────────── */}
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-3" style={{ fontFamily: "Manrope, sans-serif" }}>
              Scenarios
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {memo.scenarios.map((s) => (
                <ScenarioBar key={s.label} scenario={s} />
              ))}
            </div>
          </div>

          {/* ── Best Next Actions ──────────────────────────────────── */}
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-3" style={{ fontFamily: "Manrope, sans-serif" }}>
              Best Next Actions
            </div>
            <div className="shareable-memo-card rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.06]">
              {memo.actions.map((item, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent-primary/10 text-[10px] font-bold text-accent-primary shareable-memo-accent">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-white/80" style={{ fontFamily: "Manrope, sans-serif" }}>{item.action}</span>
                  <span className={`shrink-0 text-[10px] font-semibold uppercase ${impactColor(item.impact)}`}>
                    {item.impact}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Branding Footer ────────────────────────────────────── */}
          <div className="shareable-memo-footer mt-10 border-t border-white/[0.06] pt-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-accent-primary">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                </svg>
                <span className="text-xs font-semibold text-white/60" style={{ fontFamily: "Manrope, sans-serif" }}>
                  NodeBench
                </span>
              </div>
              <p className="mt-1 text-[10px] text-white/60">
                Generated by NodeBench — nodebenchai.com
              </p>
            </div>
            <Link
              to="/"
              className="shareable-memo-no-print rounded-lg border border-white/[0.20] bg-white/[0.12] px-3 py-1.5 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/60"
            >
              Try NodeBench
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
