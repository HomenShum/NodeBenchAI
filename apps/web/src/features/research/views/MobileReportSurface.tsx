/**
 * MobileReportSurface — combined port of
 * docs/design/nodebench-ai-design-system/ui_kits/nodebench-mobile/
 *   MobileBrief.jsx · MobileSources.jsx · MobileNotebook.jsx
 *
 * Single mobile-only report surface with internal sub-tab switching between
 * Brief / Sources / Notebook. Mounts above the desktop ReportDetailWorkspace
 * via a `md:hidden` wrapper so the desktop cards workspace is untouched.
 *
 * Fixture data mirrors the design-kit `data.jsx` DISCO scenario
 * (MDATA.brief / MDATA.sources / MDATA.notebook). Swap to live
 * `hydrateEntities.compactFindings` output once the mobile report mount
 * is wired to the canonical entity graph.
 */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  MessageSquare,
  Radio,
  Share2,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type SubTab = "brief" | "sources" | "notebook";

// ---------------------------------------------------------------------------
// Fixtures (mirror design-kit data.jsx)
// ---------------------------------------------------------------------------

const BRIEF = {
  kicker: "Diligence brief · Disco Corp.",
  title: "Platform narrative holds — Q2 renewals are the load-bearing quarter.",
  sub: "A four-quarter review of Disco Corp.'s retention mechanics, pricing, and competitive position, with a quantified next-quarter read.",
  meta: ["v4 · Draft", "Updated 42m ago", "14 sources", "Confidence: Medium-High"],
  verdict:
    "Disco's platform thesis is quantitatively supported by NRR expansion and Relay head-to-head wins, but Q2 Am Law 200 renewals gate the public-comps narrative. Base case: NRR lands 116–119% with 2 pts of upside from the Relay swaps.",
  stats: [
    { v: "114%", l: "NRR · Q4 FY24", trend: "up" as const },
    { v: "88%", l: "GRR · mid-market soft", trend: "down" as const },
    { v: "+41", l: "Net new logos · Q4", trend: "up" as const },
    { v: "38%", l: "ARR renews in Q2", trend: null },
  ],
  triad: [
    {
      tag: "What",
      color: null as null,
      h: "NRR bent from 108% → 114% in four quarters.",
      p: "Platform-tier upsell accounts for roughly 60% of the lift; Relay head-to-head wins contribute another 25%. Small-firm churn remains elevated but is a declining share of the base.",
    },
    {
      tag: "So what",
      color: "indigo" as const,
      h: "The platform narrative now has quantitative cover.",
      p: "Public comps will reprice on the NRR line if Q2 renewals clear 92% among Am Law 200. A miss reopens the bear case that Disco is a single-product eDiscovery tool.",
    },
    {
      tag: "Now what",
      color: "ok" as const,
      h: "Watch three signals over the next 60 days.",
      p: "(1) Am Law 200 renewal closes in late April. (2) Relay's own earnings cadence — they report before Disco. (3) Any deal-desk pricing changes from the Clio/NetDocs axis.",
    },
  ],
  timeline: [
    { d: "Apr 12", t: "Am Law 200 renewal window opens", m: "Historical decision peak is weeks 2–3." },
    { d: "Apr 28", t: "Relay Legal earnings", m: "Read-through for platform-tier demand." },
    { d: "May 09", t: "Disco Q1 print", m: "NRR the single most important line item." },
    { d: "May 22", t: "Am Law 200 window closes", m: "Renewal retention rate crystallizes." },
  ],
};

type ClaimStatusKey = "strong" | "medium" | "fresh" | "primary" | "disputed" | "internal";

interface ClaimEntry {
  id: string;
  q: string;
  statuses: [ClaimStatusKey, string][];
  evidence: { src: string; meta: string; strength: "strong" | "medium" | "weak" }[];
}

const SOURCES = {
  filters: ["all", "fresh <30d", "high trust", "primary", "disputed"] as const,
  claims: [
    {
      id: "c1",
      q: "NRR reached 114% in Q4 FY24",
      statuses: [
        ["strong", "strong"],
        ["fresh", "fresh <30d"],
        ["primary", "primary"],
      ],
      evidence: [
        { src: "Disco Q4 FY24 10-K, p.42", meta: "SEC · 9d", strength: "strong" },
        { src: "Earnings call transcript", meta: "Seeking Alpha · 9d", strength: "strong" },
        { src: "Workspace note: Apr-03 memo", meta: "Internal · 12d", strength: "medium" },
      ],
    },
    {
      id: "c2",
      q: "Am Law 200 cohort is 38% of ARR",
      statuses: [
        ["medium", "medium"],
        ["internal", "internal"],
      ],
      evidence: [
        { src: "Internal renewal tracker v7", meta: "Workspace · 1d", strength: "medium" },
        { src: "Disco IR deck, Mar 2025", meta: "Disco.com · 32d", strength: "medium" },
      ],
    },
    {
      id: "c3",
      q: "Relay Legal grew NRR to 119%",
      statuses: [
        ["strong", "strong"],
        ["fresh", "fresh <30d"],
      ],
      evidence: [
        { src: "Relay Series D memo", meta: "PitchBook · 3d", strength: "strong" },
        { src: "Crunchbase funding refresh", meta: "Crunchbase · 3d", strength: "medium" },
      ],
    },
    {
      id: "c4",
      q: "Mid-market gross churn is elevated",
      statuses: [
        ["medium", "medium"],
        ["disputed", "disputed"],
      ],
      evidence: [
        { src: "Anecdotal — 3 small-firm quotes", meta: "Internal · 1d", strength: "weak" },
        { src: "Gartner MQ commentary", meta: "Gartner · 22d", strength: "medium" },
      ],
    },
  ] as ClaimEntry[],
  recentSources: [
    { title: "Disco Q4 FY24 10-K filing", meta: ["SEC", "9d"], strength: "strong" as const },
    { title: "Gartner MQ for eDiscovery 2025", meta: ["Gartner", "22d"], strength: "strong" as const },
    { title: "Relay Legal Series D coverage", meta: ["PitchBook", "3d"], strength: "medium" as const },
    { title: "Am Law 200 renewal tracker", meta: ["Workspace", "1d"], strength: "medium" as const },
    { title: "Clio pricing page snapshot", meta: ["web.archive", "7d"], strength: "weak" as const },
  ],
};

type NotebookSeg =
  | string
  | { t: "chip"; name: string; type: string; initials: string }
  | { t: "mark"; v: string };

type NotebookBlock =
  | { t: "h2"; v: string }
  | { t: "p"; v: string | NotebookSeg[] }
  | { t: "proposal"; state: "open" | "accepted" | "dismissed"; note: string }
  | { t: "claim"; v: string; conf: string; sourcesN: number };

const NOTEBOOK = {
  title: "Disco diligence — April field notes",
  meta: ["Personal workspace", "Updated 42m ago", "Autosave on"],
  body: [
    { t: "h2", v: "The renewal window matters more than the quarter." },
    {
      t: "p",
      v: [
        "Across four quarters, ",
        { t: "chip", name: "Disco Corp.", type: "company", initials: "DC" },
        " has pushed NRR from 108% to 114% [1]. That's platform-tier upsell, not price. ",
        "But 38% of ARR ",
        { t: "mark", v: "renews in Q2" },
        " — so the April–May window, not the fiscal year, is the load-bearing moment [2].",
      ],
    },
    {
      t: "proposal",
      state: "open",
      note: "Merge Relay's Series D narrative into Competitive > Position — 2 direct contradictions with last week's memo.",
    },
    { t: "h2", v: "What Q2 actually looks like" },
    {
      t: "p",
      v: [
        "The Am Law 200 cohort decides roughly in weeks 2–3 of April. ",
        { t: "chip", name: "Relay Legal", type: "investor", initials: "RL" },
        " prints before ",
        { t: "chip", name: "Disco Corp.", type: "company", initials: "DC" },
        ", which gives us a read-through on platform-tier demand [3].",
      ],
    },
    {
      t: "claim",
      v: "If Am Law 200 holds ≥92%, NRR clears 118% and platform thesis wins the public comps.",
      conf: "Medium-high",
      sourcesN: 6,
    },
    { t: "h2", v: "What would change my mind" },
    {
      t: "p",
      v: [
        "Three disconfirmers I'll watch: (a) a pricing change from ",
        { t: "chip", name: "Clio / NetDocs axis", type: "market", initials: "CL" },
        " that resets mid-market expectations, (b) a visible enterprise-tier loss, (c) any SEC-driven review of ",
        { t: "chip", name: "ESI retention rules", type: "regulation", initials: "ES" },
        " [4].",
      ],
    },
    {
      t: "proposal",
      state: "accepted",
      note: "Pull through the LexNode runway concern into the Competitors card. Marked accepted and applied to v4 draft.",
    },
  ] as NotebookBlock[],
  footnotes: [
    { n: 1, title: "Disco Q4 FY24 10-K, p.42", meta: "SEC · 9d · primary" },
    { n: 2, title: "Internal renewal tracker v7", meta: "Workspace · 1d · secondary" },
    { n: 3, title: "Relay Series D memo", meta: "PitchBook · 3d · primary" },
    { n: 4, title: "Gartner MQ commentary", meta: "Gartner · 22d · synthesis" },
  ],
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Kicker({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "indigo" | "ok" }) {
  const color =
    tone === "accent"
      ? "text-[#d97757]"
      : tone === "indigo"
        ? "text-indigo-600"
        : tone === "ok"
          ? "text-emerald-600"
          : "text-gray-500";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${color}`}>{children}</span>
  );
}

function Pill({
  children,
  tone = "neutral",
  mono = true,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "accent";
  mono?: boolean;
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-100"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 border-amber-100"
        : tone === "accent"
          ? "bg-[#d97757]/10 text-[#d97757] border-[#d97757]/20"
          : "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        mono ? "font-mono" : ""
      } ${cls}`}
    >
      {children}
    </span>
  );
}

function Cite({ n, onClick }: { n: number; onClick?: () => void }) {
  return (
    <sup
      role="button"
      onClick={onClick}
      className="ml-0.5 inline-flex h-[14px] min-w-[14px] cursor-pointer items-center justify-center rounded-full bg-[#d97757]/10 px-1 font-mono text-[9px] font-bold text-[#d97757]"
    >
      {n}
    </sup>
  );
}

function Chip({ name, initials, type }: { name: string; initials: string; type: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-1.5 py-[1px] align-middle text-[11px] font-semibold text-gray-700"
      title={`${type}: ${name}`}
    >
      <span className="font-mono text-[9px] tracking-wide text-gray-500">{initials}</span>
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// BRIEF sub-view
// ---------------------------------------------------------------------------

function BriefView({ onNavigate }: { onNavigate: (t: SubTab) => void }) {
  return (
    <div className="space-y-4 px-4 pt-3 pb-10">
      <div className="flex items-center gap-2">
        <Kicker tone="accent">Brief</Kicker>
        <Pill mono tone="neutral">draft v4</Pill>
      </div>
      <h1 className="text-[20px] font-semibold leading-tight text-gray-900">{BRIEF.title}</h1>
      <p className="text-[13.5px] leading-relaxed text-gray-600">{BRIEF.sub}</p>
      <div className="flex flex-wrap gap-1.5">
        {BRIEF.meta.map((m) => (
          <Pill key={m}>{m}</Pill>
        ))}
      </div>

      {/* Verdict */}
      <section className="rounded-2xl border border-[#d97757]/20 bg-[#d97757]/[0.05] p-4">
        <Kicker tone="accent">Verdict</Kicker>
        <h2 className="mt-1 text-[16px] font-semibold text-gray-900">
          Base case holds, Q2 is the tell.
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
          {BRIEF.verdict}
          <Cite n={1} onClick={() => onNavigate("sources")} />
        </p>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        {BRIEF.stats.map((s) => (
          <div key={s.l} className="rounded-xl border border-black/5 bg-white p-3">
            <div
              className={`font-mono text-[18px] font-bold ${
                s.trend === "up"
                  ? "text-emerald-600"
                  : s.trend === "down"
                    ? "text-amber-700"
                    : "text-gray-900"
              }`}
            >
              {s.v}
            </div>
            <div className="mt-0.5 text-[10.5px] uppercase tracking-wide text-gray-500">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Triad */}
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#d97757]">
        <FileText size={14} strokeWidth={1.7} />
        <span>Structured take</span>
      </h3>
      <div className="space-y-2">
        {BRIEF.triad.map((t) => (
          <div
            key={t.tag}
            className={`rounded-2xl border p-3 ${
              t.color === "indigo"
                ? "border-[rgba(94,106,210,0.18)] bg-[rgba(94,106,210,0.08)]"
                : t.color === "ok"
                  ? "border-[rgba(4,120,87,0.18)] bg-[rgba(4,120,87,0.08)]"
                  : "border-black/5 bg-white"
            }`}
          >
            <Kicker tone={t.color === "indigo" ? "indigo" : t.color === "ok" ? "ok" : "accent"}>
              {t.tag}
            </Kicker>
            <h4 className="mt-1 text-[14px] font-semibold text-gray-900">{t.h}</h4>
            <p className="mt-1 text-[12.5px] leading-relaxed text-gray-700">{t.p}</p>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-500">
        <Clock size={14} strokeWidth={1.7} />
        <span>Next 60 days</span>
      </h3>
      <div className="space-y-2">
        {BRIEF.timeline.map((r) => (
          <div
            key={r.d}
            className="flex items-start gap-3 rounded-xl border border-black/5 bg-white p-3"
          >
            <div className="w-16 flex-none font-mono text-[11px] font-bold uppercase text-[#d97757]">
              {r.d}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-gray-900">{r.t}</div>
              <div className="mt-0.5 text-[11px] text-gray-500">{r.m}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Drill links */}
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-500">
        <Radio size={14} strokeWidth={1.7} />
        <span>Go deeper</span>
      </h3>
      <div className="space-y-1.5">
        <DrillRow
          icon={FileText}
          title="Inspect sources & claim graph"
          meta="14 sources · 4 claims"
          onClick={() => onNavigate("sources")}
        />
        <DrillRow
          icon={Sparkles}
          title="Open April field notes"
          meta="Personal · 2 proposals pending"
          onClick={() => onNavigate("notebook")}
        />
        <DrillRow
          icon={MessageSquare}
          title="Ask a follow-up"
          meta="Resume chat thread"
          onClick={() => undefined}
        />
      </div>
    </div>
  );
}

function DrillRow({
  icon: Icon,
  title,
  meta,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white px-3 py-3 text-left hover:bg-black/[0.02] active:scale-[0.99]"
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#f4f3f1] text-gray-600">
        <Icon size={14} strokeWidth={1.7} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-semibold text-gray-900">{title}</span>
        <span className="block truncate text-[11px] text-gray-500">{meta}</span>
      </span>
      <ChevronRight size={14} className="flex-none text-gray-400" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// SOURCES sub-view
// ---------------------------------------------------------------------------

function SourcesView() {
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>("c1");

  const filtered = SOURCES.claims.filter((c) => {
    if (filter === "all") return true;
    const match = filter.replace(/<30d$/, "").trim();
    return c.statuses.some(([k]) => k === match || filter.startsWith(k));
  });

  return (
    <div className="space-y-4 px-4 pt-3 pb-10">
      <div>
        <Kicker>Run signal</Kicker>
        <h2 className="mt-1 text-[16px] font-semibold text-gray-900">
          14 sources · 4 claims · medium–high confidence
        </h2>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {SOURCES.filters.map((f) => (
          <button
            key={f}
            data-active={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              filter === f
                ? "border-[#d97757] bg-[#d97757] text-white"
                : "border-black/10 bg-white text-gray-600 hover:border-black/20"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Claims */}
      <div className="space-y-2">
        {filtered.map((c) => {
          const isOpen = expanded === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setExpanded(isOpen ? null : c.id)}
              className="block w-full rounded-2xl border border-black/5 bg-white p-3 text-left hover:bg-black/[0.02]"
            >
              <div className="text-[13px] font-semibold text-gray-900">{c.q}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {c.statuses.map(([k, label]) => {
                  const tone =
                    k === "strong"
                      ? "ok"
                      : k === "disputed"
                        ? "warn"
                        : k === "primary" || k === "fresh"
                          ? "accent"
                          : "neutral";
                  return (
                    <Pill key={k} tone={tone} mono={false}>
                      {label}
                    </Pill>
                  );
                })}
                <span className="ml-auto">
                  <Pill>{c.evidence.length} evidence</Pill>
                </span>
              </div>
              {isOpen && (
                <div className="mt-3 space-y-1.5 border-t border-black/5 pt-3">
                  {c.evidence.map((e) => (
                    <div key={e.src} className="flex items-center gap-2">
                      <Pill tone={e.strength === "strong" ? "ok" : e.strength === "medium" ? "accent" : "warn"} mono={false}>
                        {e.strength}
                      </Pill>
                      <span className="flex-1 truncate text-[12px] font-semibold text-gray-800">
                        {e.src}
                      </span>
                      <span className="flex-none font-mono text-[10px] text-gray-500">{e.meta}</span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Recent sources */}
      <h3 className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-500">
        <FileText size={14} strokeWidth={1.7} />
        <span>All sources ({SOURCES.recentSources.length})</span>
      </h3>
      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
        {SOURCES.recentSources.map((r, i) => (
          <div
            key={r.title}
            className={`flex items-center gap-3 px-3 py-2.5 ${
              i !== SOURCES.recentSources.length - 1 ? "border-b border-black/5" : ""
            }`}
          >
            <div
              className={`flex h-6 w-6 flex-none items-center justify-center rounded-md font-mono text-[10px] font-bold ${
                r.strength === "strong"
                  ? "bg-emerald-50 text-emerald-700"
                  : r.strength === "medium"
                    ? "bg-[#d97757]/10 text-[#d97757]"
                    : "bg-amber-50 text-amber-700"
              }`}
            >
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-gray-900">{r.title}</div>
              <div className="mt-0.5 flex gap-2 text-[10.5px] text-gray-500">
                {r.meta.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>
            </div>
            <ChevronRight size={14} className="flex-none text-gray-400" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NOTEBOOK sub-view
// ---------------------------------------------------------------------------

function renderPar(val: string | NotebookSeg[]) {
  if (typeof val === "string") return val;
  const out: ReactNode[] = [];
  val.forEach((seg, i) => {
    if (typeof seg === "string") {
      const re = /\[(\d+)\]/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        if (m.index > last) out.push(<span key={`s-${i}-${last}`}>{seg.slice(last, m.index)}</span>);
        out.push(<Cite key={`c-${i}-${m.index}`} n={parseInt(m[1], 10)} />);
        last = m.index + m[0].length;
      }
      if (last < seg.length) out.push(<span key={`e-${i}-${last}`}>{seg.slice(last)}</span>);
    } else if (seg.t === "chip") {
      out.push(<Chip key={`ch-${i}`} name={seg.name} type={seg.type} initials={seg.initials} />);
    } else if (seg.t === "mark") {
      // Kit parity: var(--warn) + rgba(180,83,9,0.14) background, not bg-amber-100.
      out.push(
        <mark
          key={`mk-${i}`}
          className="rounded bg-amber-800/15 px-1 font-semibold text-amber-800"
        >
          {seg.v}
        </mark>,
      );
    }
  });
  return out;
}

function NotebookView({ onNavigate }: { onNavigate: (t: SubTab) => void }) {
  const initialProposals: Record<number, "open" | "accepted" | "dismissed"> = {};
  NOTEBOOK.body.forEach((b, i) => {
    if (b.t === "proposal") initialProposals[i] = b.state;
  });
  const [proposals, setProposals] = useState(initialProposals);
  const setProp = (i: number, s: "open" | "accepted" | "dismissed") =>
    setProposals((p) => ({ ...p, [i]: s }));

  return (
    <div className="space-y-4 px-4 pt-3 pb-10">
      <div>
        <h1 className="text-[18px] font-semibold leading-tight text-gray-900">{NOTEBOOK.title}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {NOTEBOOK.meta.map((m) => (
            <Pill key={m}>{m}</Pill>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {NOTEBOOK.body.map((block, i) => {
          if (block.t === "h2") {
            return (
              <h2 key={i} className="mt-4 text-[15px] font-semibold text-gray-900">
                {block.v}
              </h2>
            );
          }
          if (block.t === "p") {
            return (
              <p key={i} className="text-[13px] leading-relaxed text-gray-700">
                {renderPar(block.v)}
              </p>
            );
          }
          if (block.t === "proposal") {
            const state = proposals[i] ?? "open";
            return (
              <div
                key={i}
                data-state={state}
                className={`rounded-2xl border p-3 ${
                  state === "accepted"
                    ? "border-emerald-100 bg-emerald-50/60"
                    : state === "dismissed"
                      ? "border-gray-100 bg-gray-50 opacity-60"
                      : "border-[#d97757]/20 bg-[#d97757]/[0.05]"
                }`}
              >
                <Kicker tone={state === "accepted" ? "ok" : "accent"}>
                  {state === "accepted" ? "✓ Accepted proposal" : "AI proposal · margin"}
                </Kicker>
                <div className="mt-1 text-[12.5px] leading-relaxed text-gray-700">{block.note}</div>
                {state === "open" && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      className="rounded-full bg-[#d97757] px-3 py-1 text-[11px] font-semibold text-white"
                      onClick={() => setProp(i, "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold text-gray-600"
                      onClick={() => setProp(i, "dismissed")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          }
          if (block.t === "claim") {
            return (
              <div
                key={i}
                className="rounded-2xl border border-[#d97757]/20 bg-[#d97757]/[0.04] p-3"
              >
                <div className="flex items-center gap-1.5">
                  <Radio size={12} strokeWidth={1.7} className="text-[#d97757]" />
                  <Kicker tone="accent">Claim block</Kicker>
                </div>
                <div className="mt-1 text-[13px] font-semibold text-gray-900">{block.v}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill tone="ok" mono={false}>
                    Confidence: {block.conf}
                  </Pill>
                  <Pill>{block.sourcesN} sources</Pill>
                  <button
                    className="inline-flex items-center rounded-full border border-[#d97757]/30 bg-[#d97757]/10 px-2 py-0.5 text-[10px] font-semibold text-[#d97757]"
                    onClick={() => onNavigate("sources")}
                  >
                    Open evidence →
                  </button>
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* Footnotes */}
      <div className="mt-6 rounded-2xl border border-black/5 bg-white p-3">
        <Kicker>Footnotes</Kicker>
        <div className="mt-2 space-y-1.5">
          {NOTEBOOK.footnotes.map((f) => (
            <button
              key={f.n}
              onClick={() => onNavigate("sources")}
              className="flex w-full items-start gap-2 text-left"
            >
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#d97757]/10 font-mono text-[10px] font-bold text-[#d97757]">
                {f.n}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-gray-900">{f.title}</div>
                <div className="mt-0.5 text-[10.5px] text-gray-500">{f.meta}</div>
              </div>
              <ChevronRight size={12} className="flex-none text-gray-400" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer shell with sub-tabs
// ---------------------------------------------------------------------------

export default function MobileReportSurface({
  reportSlug = "acme-ai",
  reportTitle = "Disco Corp.",
  initialSub = "brief",
}: {
  reportSlug?: string;
  reportTitle?: string;
  initialSub?: SubTab;
}) {
  const [sub, setSub] = useState<SubTab>(initialSub);
  const navigate = useNavigate();

  return (
    <div
      data-testid="mobile-report-surface"
      data-sub={sub}
      className="md:hidden min-h-dvh w-full bg-[#f8f7f5] text-[#111827]"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/85 px-3 pt-3 pb-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            className="rounded-full p-2 text-gray-600 hover:bg-black/5 active:scale-95"
            aria-label="Back"
            onClick={() => navigate("/?surface=reports")}
          >
            <ArrowLeft size={16} strokeWidth={1.7} />
          </button>
          <div>
            <div className="text-[14px] font-semibold leading-tight">Reports</div>
            <div className="text-[10.5px] text-gray-500">{reportTitle} · v4</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded-full p-2 text-gray-600 hover:bg-black/5 active:scale-95"
            aria-label="Save"
          >
            <Bookmark size={16} strokeWidth={1.7} />
          </button>
          <button
            className="rounded-full p-2 text-gray-600 hover:bg-black/5 active:scale-95"
            aria-label="Share"
          >
            <Share2 size={16} strokeWidth={1.7} />
          </button>
          {sub === "sources" ? (
            <button
              className="rounded-full p-2 text-gray-600 hover:bg-black/5 active:scale-95"
              aria-label="Filter"
            >
              <Filter size={16} strokeWidth={1.7} />
            </button>
          ) : null}
        </div>
      </header>

      {/* Sub-tab strip */}
      <div
        data-testid="mobile-report-subtabs"
        className="sticky top-[56px] z-[9] flex border-b border-black/5 bg-white/85 px-2 backdrop-blur"
      >
        {(
          [
            { id: "brief", label: "Brief" },
            { id: "sources", label: "Sources" },
            { id: "notebook", label: "Notebook" },
          ] as { id: SubTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            data-active={sub === t.id}
            onClick={() => setSub(t.id)}
            className={`relative flex-1 px-3 py-2 text-[12.5px] font-semibold transition ${
              sub === t.id ? "text-[#d97757]" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {sub === t.id ? (
              <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-t bg-[#d97757]" />
            ) : null}
          </button>
        ))}
      </div>

      {/* Pane */}
      {sub === "brief" && <BriefView onNavigate={setSub} />}
      {sub === "sources" && <SourcesView />}
      {sub === "notebook" && <NotebookView onNavigate={setSub} />}

      {/* Silence unused vars */}
      <span className="hidden" aria-hidden data-slug={reportSlug} />
    </div>
  );
}
