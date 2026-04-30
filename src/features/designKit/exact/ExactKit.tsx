import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import {
  Archive,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Command,
  Copy,
  Eye,
  FileText,
  Filter,
  GitBranch,
  Globe2,
  Grid3X3,
  Home,
  Inbox,
  Layers,
  LayoutGrid,
  Link2,
  List,
  Map,
  MessageSquare,
  Mic,
  Moon,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  User,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { buildCockpitPath, type CockpitSurfaceId } from "@/lib/registry/viewRegistry";
import { RichNotebookEditor } from "@/features/notebook/components/RichNotebookEditor";
import { EntityFindingsPanel } from "@/features/narrative/components/social/EntityFindingsPanel";
import { PipelineRunsPanel } from "@/features/pipelines/views/PipelineRunsPanel";
import { PipelineLauncher } from "@/features/pipelines/views/PipelineLauncher";
import { PipelineSchedulesPanel } from "@/features/pipelines/views/PipelineSchedulesPanel";
import { PipelineEvalScorecard } from "@/features/pipelines/views/PipelineEvalScorecard";
import {
  buildLocalWorkspacePath,
  buildWorkspaceUrl,
  type WorkspaceTab,
} from "@/features/workspace/lib/workspaceRouting";

import "./exactKit.css";

type WebSurfaceProps = {
  onSurfaceChange?: (surface: CockpitSurfaceId) => void;
};

type LaneId = "answer" | "deep" | "admin";
type MobileSurface = "home" | "reports" | "chat" | "inbox" | "me";

const LANES: Array<{ id: LaneId; label: string; note: string }> = [
  { id: "answer", label: "Answer", note: "fast - default" },
  { id: "deep", label: "Deep dive", note: "multi-agent - 3-5 min" },
  { id: "admin", label: "Admin", note: "nodebench-mcp-admin" },
];

const PROMPT_CARDS: Array<{ icon: LucideIcon; prompt: string }> = [
  { icon: Sparkles, prompt: "DISCO - worth reaching out? Fastest debrief." },
  { icon: FileText, prompt: "Summarize the attached 10-K into a 1-pager." },
  { icon: Eye, prompt: "Watch Mercor and nudge me on hiring signal." },
];

const REPORTS = [
  {
    id: "disco-diligence",
    kind: "Company",
    title: "DISCO - diligence debrief",
    summary: "Legal AI platform with SOC2 movement, enterprise momentum, and still-open valuation risk.",
    state: "verified",
    sources: 24,
    updated: "12h ago",
    watched: true,
    colorA: "#1a365d",
    colorB: "#d97757",
  },
  {
    id: "mercor-hiring",
    kind: "Hiring",
    title: "Mercor - hiring velocity",
    summary: "Engineering hiring pattern supports the infra-heavy Series B prep hypothesis.",
    state: "needs review",
    sources: 18,
    updated: "2h ago",
    watched: true,
    colorA: "#0e7a5c",
    colorB: "#5e6ad2",
  },
  {
    id: "cognition-devin",
    kind: "Agent",
    title: "Cognition - devin postmortem",
    summary: "Benchmark claims were promoted after independent reruns and source reconciliation.",
    state: "verified",
    sources: 31,
    updated: "1d ago",
    watched: false,
    colorA: "#6b3ba3",
    colorB: "#d97757",
  },
  {
    id: "turing-contract",
    kind: "Services",
    title: "Turing - contract spend YoY",
    summary: "Quarterly filing refresh changed the model inputs but not the spend trend.",
    state: "verified",
    sources: 16,
    updated: "3d ago",
    watched: false,
    colorA: "#c77826",
    colorB: "#0f4c81",
  },
  {
    id: "anthropic-safety",
    kind: "Foundation",
    title: "Anthropic - safety framework",
    summary: "Framework v2.3 affects notebook assumptions but has not yet attached to a saved report.",
    state: "watching",
    sources: 9,
    updated: "4d ago",
    watched: true,
    colorA: "#334155",
    colorB: "#5e6ad2",
  },
  {
    id: "foundation-labs",
    kind: "Market",
    title: "Foundation labs - positioning",
    summary: "Landscape map for foundation-model labs, open claims, and category edges.",
    state: "needs review",
    sources: 14,
    updated: "6d ago",
    watched: false,
    colorA: "#0e7a5c",
    colorB: "#c77826",
  },
];

const INBOX_SEED = [
  {
    id: "n1",
    when: "just now",
    entity: "DISCO",
    priority: "act",
    icon: Zap,
    title: "Announced GA of native SOC 2 Type II in EU",
    body: "Addresses the regulatory risk flagged in your Nov 14 run. This is material. Your needs-review stance likely flips.",
    actions: ["rerun", "open", "snooze", "dismiss"],
    report: "DISCO - diligence debrief",
    deltaSources: 3,
  },
  {
    id: "n2",
    when: "2h ago",
    entity: "Mercor",
    priority: "act",
    icon: Zap,
    title: "Posted 7 new eng roles in 24h - infra heavy",
    body: "Consistent with the Series B prep hypothesis. Three new stealth hires reinforce it.",
    actions: ["rerun", "open", "snooze", "dismiss"],
    report: "Mercor - hiring velocity",
    deltaSources: 5,
  },
  {
    id: "n3",
    when: "yesterday",
    entity: "Cognition",
    priority: "auto",
    icon: Check,
    title: "Two claims verified - we promoted the report",
    body: "Independent benchmark rerun landed. The report moved from needs review to verified automatically.",
    actions: ["open", "undo", "dismiss"],
    report: "Cognition - devin postmortem",
    deltaSources: 2,
  },
  {
    id: "n4",
    when: "yesterday",
    entity: "Anthropic",
    priority: "watch",
    icon: Eye,
    title: "New safety framework doc v2.3 published",
    body: "Not on any saved report, but in your notebook. Want me to draft a brief?",
    actions: ["draft", "watch", "dismiss"],
    report: null,
    deltaSources: 1,
  },
  {
    id: "n5",
    when: "3d ago",
    entity: "Turing",
    priority: "fyi",
    icon: GitBranch,
    title: "Quarterly filing updated - no material change",
    body: "We refreshed the numbers in your saved report. Contract spend trend is unchanged.",
    actions: ["open", "dismiss"],
    report: "Turing - contract spend YoY",
    deltaSources: 1,
  },
] as const;

const WATCHLIST = [
  { id: "disco", name: "DISCO", ticker: "DSCO", value: "84", delta: "+12", trend: "up", meta: "3 new sources", initials: "D", avatar: "linear-gradient(135deg,#1A365D,#0F4C81)" },
  { id: "mercor", name: "Mercor", ticker: "MRC", value: "91", delta: "+7", trend: "up", meta: "hiring spike", initials: "M", avatar: "linear-gradient(135deg,#0E7A5C,#16A37E)" },
  { id: "cognition", name: "Cognition", ticker: "COG", value: "68", delta: "-4", trend: "down", meta: "claim review", initials: "C", avatar: "linear-gradient(135deg,#6B3BA3,#8B5CC1)" },
  { id: "anthropic", name: "Anthropic", ticker: "ANT", value: "76", delta: "+3", trend: "up", meta: "framework v2.3", initials: "A", avatar: "linear-gradient(135deg,#334155,#475569)" },
];

const THREADS = [
  { id: "t1", title: "DISCO debrief", meta: "12h ago - 24 sources" },
  { id: "t2", title: "Mercor hiring signal", meta: "2h ago - inbox routed" },
  { id: "t3", title: "Technical vendor API notes", meta: "yesterday - saved report" },
];

const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string; icon: LucideIcon; count?: number }> = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "brief", label: "Brief", icon: FileText },
  { id: "cards", label: "Cards", icon: LayoutGrid, count: 14 },
  { id: "notebook", label: "Notebook", icon: BookOpen },
  { id: "sources", label: "Sources", icon: ShieldCheck, count: 24 },
  { id: "map", label: "Map", icon: Map },
];

const VALID_WORKSPACE_TABS = new Set<WorkspaceTab>(WORKSPACE_TABS.map((tab) => tab.id));

function getWorkspaceTab(value: string | null): WorkspaceTab {
  if (value && VALID_WORKSPACE_TABS.has(value as WorkspaceTab)) return value as WorkspaceTab;
  return "chat";
}

function getWorkspaceId(pathname: string) {
  const match = pathname.match(/(?:^\/workspace)?\/w\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "ship-demo-day";
}

function openWorkspace(workspaceId: string, tab: WorkspaceTab) {
  window.location.assign(buildWorkspaceUrl({ workspaceId, tab }));
}

function ReportThumb({
  label,
  colorA,
  colorB,
}: {
  label: string;
  colorA: string;
  colorB: string;
}) {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <svg viewBox="0 0 420 236" role="img" aria-label={`${label} report preview`}>
      <defs>
        <linearGradient id={`g-${label.replace(/[^a-z0-9]/gi, "-")}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={colorA} />
          <stop offset="100%" stopColor={colorB} />
        </linearGradient>
      </defs>
      <rect width="420" height="236" fill={`url(#g-${label.replace(/[^a-z0-9]/gi, "-")})`} />
      <circle cx="350" cy="36" r="70" fill="rgba(255,255,255,.14)" />
      <circle cx="68" cy="192" r="92" fill="rgba(255,255,255,.10)" />
      <rect x="28" y="28" width="104" height="26" rx="13" fill="rgba(255,255,255,.22)" />
      <rect x="28" y="76" width="270" height="14" rx="7" fill="rgba(255,255,255,.22)" />
      <rect x="28" y="101" width="222" height="10" rx="5" fill="rgba(255,255,255,.16)" />
      <text x="32" y="174" fill="#fffaf0" fontFamily="monospace" fontSize="44" fontWeight="800">{initials}</text>
    </svg>
  );
}

function MobileIcon({ name, size = 16 }: { name: string; size?: number }) {
  const map: Record<string, LucideIcon> = {
    archive: Archive,
    bell: Bell,
    brief: FileText,
    camera: Eye,
    cards: Grid3X3,
    chat: MessageSquare,
    chevron: ChevronRight,
    file: FileText,
    home: Home,
    inbox: Inbox,
    map: Map,
    me: User,
    mic: Mic,
    notebook: BookOpen,
    plus: Plus,
    reports: FileText,
    search: Search,
    send: Send,
    settings: Settings,
    source: ShieldCheck,
    thread: MoreHorizontal,
  };
  const Icon = map[name] ?? Sparkles;
  return <Icon size={size} strokeWidth={1.8} aria-hidden />;
}

function ResponsiveSurface({
  mobile,
  children,
}: {
  mobile: MobileSurface;
  children: ReactNode;
}) {
  return (
    <>
      <div className="md:hidden">
        <ExactMobileSurface surface={mobile} />
      </div>
      <div className="nb-kit hidden min-h-full md:block">
        <div className="nb-shell">{children}</div>
      </div>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Home Pulse subsections — ported 1:1 from
   ui_kits/nodebench-web/{PulseStrip,TodayIntel,ActiveEvent,RecentReports}.jsx
   Static seed data lives here. Live wiring (when entities/runs exist) replaces
   it via props in a follow-up — we keep the kit's exact JSX + class names so
   visual parity is verifiable in raw HTML.
   ────────────────────────────────────────────────────────────────────────── */

type PulseMetric = {
  id: string;
  label: string;
  value: number;
  unit: string;
  trend: string;
  what: string;
  hero?: boolean;
};

const PULSE_METRICS: PulseMetric[] = [
  { id: "entities",   label: "Entities tracked",     value: 42810,  unit: "",  trend: "+184 today",  what: "A real intelligence graph" },
  { id: "edges",      label: "Relationships mapped", value: 183204, unit: "",  trend: "+612 today",  what: "How people, companies, products connect" },
  { id: "reports",    label: "Reports created",      value: 18204,  unit: "",  trend: "+47 today",   what: "Chats become durable work products" },
  { id: "memory_pct", label: "Served from memory",   value: 71,     unit: "%", trend: "up 4pp / wk", what: "Search not repeated every time", hero: true },
  { id: "avoided",    label: "Searches avoided",     value: 126000, unit: "",  trend: "this week",   what: "Cost-saving + speed moat" },
  { id: "refreshed",  label: "Sources refreshed",    value: 9420,   unit: "",  trend: "this week",   what: "Freshness + trust" },
  { id: "verified",   label: "Claims verified",      value: 2841,   unit: "",  trend: "this week",   what: "Evidence quality" },
  { id: "avg_time",   label: "Avg sourced answer",   value: 3.4,    unit: "s", trend: "-0.6s / mo",  what: "UX speed" },
  { id: "followups",  label: "Follow-ups created",   value: 612,    unit: "",  trend: "this week",   what: "Business action, not just research" },
  { id: "crm",        label: "CRM exports",          value: 184,    unit: "",  trend: "this week",   what: "Workflow completion" },
];

function fmtNumber(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  if (Number.isInteger(value)) return value.toLocaleString();
  return String(value);
}

const SPARK_SEEDS: Record<string, number[]> = {
  memory_pct: [56, 58, 61, 60, 63, 67, 69, 71],
  entities:   [38, 39, 40, 41, 41, 42, 42, 43],
  edges:      [160, 165, 170, 173, 176, 178, 181, 183],
  reports:    [16, 16, 17, 17, 17, 18, 18, 18],
};

function PulseSparkline({ id }: { id: string }) {
  const data = SPARK_SEEDS[id] ?? [10, 12, 11, 14, 13, 16, 15, 18];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y] as const;
  });
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg className="nb-pulse-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={area} className="fill" />
      <path d={path} className="line" />
    </svg>
  );
}

function NBPulseStrip({ liveEntities }: { liveEntities?: Array<any> | null }) {
  const heroIds = ["memory_pct", "entities", "edges", "reports"];
  const secondaryIds = ["avoided", "refreshed", "verified", "avg_time", "followups", "crm"];

  // B2: pull authoritative pulse metrics from the activity ledger; this is
  // server-aggregated counts (entities/reports/chat/source/claim/export rows).
  // Anonymous visitors get an all-zero result with live=false → falls back
  // to seed.  Authenticated users see real counts where the ledger covers,
  // seed otherwise (memory %, avg latency).
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const pulse = useQuery(
    api?.domains.product.entities.getProductPulseMetrics ?? "skip",
    api?.domains.product.entities.getProductPulseMetrics
      ? { anonymousSessionId, lookbackHours: 168 }
      : "skip",
  );
  const pulseLive = (pulse as any)?.live === true;

  // Live counts: prefer ledger query (authoritative server-side), fall back to
  // child entities listing for the simple count. The query returns 0 when
  // anonymous; we keep the seed in that case.
  const live = pulseLive || (Array.isArray(liveEntities) && liveEntities.length > 0);
  const ledgerEntityCount = pulseLive ? Number((pulse as any)?.entitiesTracked ?? 0) : null;
  const ledgerReportCount = pulseLive ? Number((pulse as any)?.reportsCreated ?? 0) : null;
  const ledgerSearchesAvoided = pulseLive ? Number((pulse as any)?.chatMessagesRecent ?? 0) : null;
  const ledgerSourcesRefreshed = pulseLive ? Number((pulse as any)?.sourcesAttachedRecent ?? 0) : null;
  const ledgerClaimsVerified = pulseLive ? Number((pulse as any)?.claimsChangedRecent ?? 0) : null;
  const ledgerCrmExports = pulseLive ? Number((pulse as any)?.exportsCompletedLifetime ?? 0) : null;
  const ledgerEdges = pulseLive ? Number((pulse as any)?.relationshipsMapped ?? 0) : null;
  const ledgerFollowups = pulseLive ? Number((pulse as any)?.followupsCreated ?? 0) : null;
  // Tier D — 3 remaining live metrics
  const ledgerMemoryHitPct = pulseLive ? ((pulse as any)?.memoryHitPct as number | null | undefined) ?? null : null;
  const ledgerAvgSourcedSec = pulseLive ? ((pulse as any)?.avgSourcedAnswerSec as number | null | undefined) ?? null : null;
  const ledgerSourcesFreshPct = pulseLive ? ((pulse as any)?.sourcesFreshPct as number | null | undefined) ?? null : null;
  const fallbackEntityCount =
    Array.isArray(liveEntities) && liveEntities.length > 0 ? liveEntities!.length : null;
  const fallbackReportCount =
    Array.isArray(liveEntities) && liveEntities.length > 0
      ? liveEntities!.reduce(
          (acc, e) => acc + (typeof e?.reportCount === "number" ? e.reportCount : 0),
          0,
        )
      : null;
  const overrideOrSeed = (id: string, fallback: number | null): { value: number; trendOverride?: string } | null => {
    if (id === "entities") {
      const v = ledgerEntityCount ?? fallbackEntityCount;
      if (v != null) return { value: v, trendOverride: "live · just now" };
    } else if (id === "reports") {
      const v = ledgerReportCount ?? fallbackReportCount;
      if (v != null) return { value: v, trendOverride: "live · just now" };
    } else if (id === "avoided" && ledgerSearchesAvoided != null) {
      return { value: ledgerSearchesAvoided, trendOverride: "this week" };
    } else if (id === "refreshed" && ledgerSourcesRefreshed != null) {
      return { value: ledgerSourcesRefreshed, trendOverride: "this week" };
    } else if (id === "verified" && ledgerClaimsVerified != null) {
      return { value: ledgerClaimsVerified, trendOverride: "this week" };
    } else if (id === "crm" && ledgerCrmExports != null) {
      return { value: ledgerCrmExports, trendOverride: "lifetime" };
    } else if (id === "edges" && ledgerEdges != null) {
      return { value: ledgerEdges, trendOverride: "live · graph" };
    } else if (id === "followups" && ledgerFollowups != null) {
      return { value: ledgerFollowups, trendOverride: "this week" };
    } else if (id === "memory_pct" && ledgerMemoryHitPct != null) {
      return { value: ledgerMemoryHitPct, trendOverride: "live · 7d" };
    } else if (id === "avg_time" && ledgerAvgSourcedSec != null) {
      return { value: ledgerAvgSourcedSec, trendOverride: "live · 7d" };
    }
    return null;
  };
  const apply = (m: PulseMetric): PulseMetric => {
    const o = overrideOrSeed(m.id, null);
    if (!o) return m;
    return { ...m, value: o.value, trend: o.trendOverride ?? m.trend };
  };
  const heroes = PULSE_METRICS.filter((m) => heroIds.includes(m.id)).map(apply);
  const secondary = PULSE_METRICS.filter((m) => secondaryIds.includes(m.id)).map(apply);
  // suppress unused-warning when no ledger metrics override the seed:
  void live;
  return (
    <section className="nb-pulse" data-layout="card-grid" data-scale="big" data-testid="exact-home-pulse-strip">
      <header className="nb-pulse-head">
        <div>
          <div className="nb-kicker">Memory pulse</div>
          <h2 className="nb-pulse-title">Every chat makes the next one faster.</h2>
          <p className="nb-pulse-sub">Public context compounds. Private notes stay private.</p>
        </div>
        <span className="nb-pulse-priv" title="Private notes never leak into public counters.">
          <span className="nb-pulse-priv-dot" /> private notes excluded
        </span>
      </header>
      <div className="nb-pulse-cards">
        {heroes.map((m) => (
          <article key={m.id} className="nb-pulse-card" data-hero={m.id === "memory_pct"}>
            <div className="nb-pulse-card-num">
              {fmtNumber(m.value)}<span className="u">{m.unit}</span>
            </div>
            <div className="nb-pulse-card-label">{m.label.toLowerCase()}</div>
            <div className="nb-pulse-card-trend">
              <span className="nb-pulse-trend-dot" data-dir="up" /> {m.trend}
            </div>
            <PulseSparkline id={m.id} />
          </article>
        ))}
      </div>
      <div className="nb-pulse-secondary">
        {secondary.map((m) => (
          <div key={m.id} className="nb-pulse-mini">
            <span className="v">{fmtNumber(m.value)}<span className="u">{m.unit}</span></span>
            <span className="l">{m.label.toLowerCase()}</span>
            <span className="t">{m.trend}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

type TodayLane = {
  id: string;
  title: string;
  accent: "accent" | "indigo" | "success" | "warning";
  count: number;
  items: { hd: string; meta: string }[];
};

const TODAY_LANES: TodayLane[] = [
  {
    id: "signal", title: "New signals", accent: "accent", count: 4,
    items: [
      { hd: "Mercor hiring velocity ↑",   meta: "18 sources · 1d ago · watching" },
      { hd: "Orbital Labs press mention",      meta: "TechCrunch · 4h ago" },
      { hd: "DISCO files secondary",           meta: "SEC · 6h ago" },
    ],
  },
  {
    id: "updated", title: "Reports updated", accent: "indigo", count: 3,
    items: [
      { hd: "Ship Demo Day",              meta: "12 captures · 8 cos · 14 ppl · 9 follow-ups" },
      { hd: "Voice-agent eval landscape", meta: "+ 4 claims · −1 weak" },
      { hd: "Series-B litigation OS",     meta: "+ 2 entities" },
    ],
  },
  {
    id: "watchlist", title: "Watchlist changes", accent: "success", count: 5,
    items: [
      { hd: "Cellebrite — claim updated", meta: "gross retention 96% → 93%" },
      { hd: "Anita Park (CRO) joined",         meta: "evidence: 2 · medium confidence" },
      { hd: "Bessemer term sheet leak",        meta: "rumored · 2 sources" },
    ],
  },
  {
    id: "followup", title: "Follow-ups due", accent: "warning", count: 2,
    items: [
      { hd: "Alex @ Orbital Labs",      meta: "ask about healthcare pilot criteria" },
      { hd: "Schedule DISCO debrief",   meta: "today · before market close" },
    ],
  },
];

function NBTodayIntel({ liveEntities }: { liveEntities?: Array<any> | null }) {
  // Tier A: "Reports updated" lane → live entities sorted by latestReportUpdatedAt
  // Tier B1: "New signals" + "Watchlist changes" lanes → live morningDigestQueries
  // "Follow-ups due" stays seed until a dedicated followups query lands.
  const live = Array.isArray(liveEntities) && liveEntities.length > 0;
  const liveSorted = live
    ? [...liveEntities!]
        .filter((e) => typeof e?.latestReportUpdatedAt === "number")
        .sort((a, b) => (b.latestReportUpdatedAt as number) - (a.latestReportUpdatedAt as number))
        .slice(0, 3)
    : [];

  // B1: pull morning digest signals + watchlist (anonymous visitors get null/empty;
  // those fall through to seed naturally).
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const freshSignals = useQuery(
    api?.domains.ai.morningDigestQueries.getFreshCriticalSignals ?? "skip",
    api?.domains.ai.morningDigestQueries.getFreshCriticalSignals
      ? { lookbackHours: 48, maxSignals: 6 }
      : "skip",
  );
  const digest = useQuery(
    api?.domains.ai.morningDigestQueries.getDigestData ?? "skip",
    api?.domains.ai.morningDigestQueries.getDigestData ? {} : "skip",
  );
  // C1: pulse metrics doubles as a follow-ups counter (live total + due-today).
  const pulse = useQuery(
    api?.domains.product.entities.getProductPulseMetrics ?? "skip",
    api?.domains.product.entities.getProductPulseMetrics
      ? { anonymousSessionId, lookbackHours: 168 }
      : "skip",
  );
  const liveFollowupTotal = (pulse as any)?.live ? Number((pulse as any)?.followupsCreated ?? 0) : null;
  const liveFollowupDueToday = (pulse as any)?.live ? Number((pulse as any)?.followupsDueToday ?? 0) : null;
  const liveSignalItems: Array<{ hd: string; meta: string }> = ((freshSignals as any)?.signals as any[] | undefined)
    ?.slice(0, 3)
    .map((s) => ({
      hd: String(s?.title ?? "Untitled signal").slice(0, 80),
      meta: `${s?.source ?? "feed"} · ${formatRelativeWhen(typeof s?.timestamp === "number" ? s.timestamp : undefined)}`,
    })) ?? [];
  const liveWatchlistItems: Array<{ hd: string; meta: string }> = (
    (digest as any)?.watchlistRelevant as any[] | undefined
  )
    ?.slice(0, 3)
    .map((w) => ({
      hd: String(w?.title ?? "Watchlist item").slice(0, 80),
      meta: `${w?.source ?? "feed"} · ${formatRelativeWhen(typeof w?._creationTime === "number" ? w._creationTime : undefined)}`,
    })) ?? [];

  const lanes = TODAY_LANES.map((lane) => {
    if (lane.id === "updated" && live && liveSorted.length > 0) {
      return {
        ...lane,
        count: liveSorted.length,
        items: liveSorted.map((entity) => ({
          hd: String(entity?.name ?? "Untitled"),
          meta: `${entity?.reportCount ?? 0} reports · ${formatRelativeWhen(entity?.latestReportUpdatedAt as number | undefined)}`,
        })),
      };
    }
    if (lane.id === "signal" && liveSignalItems.length > 0) {
      const totalAvailable = (freshSignals as any)?.totalAvailable;
      return {
        ...lane,
        count: typeof totalAvailable === "number" ? totalAvailable : liveSignalItems.length,
        items: liveSignalItems,
      };
    }
    if (lane.id === "watchlist" && liveWatchlistItems.length > 0) {
      const total = (digest as any)?.watchlistRelevant?.length ?? liveWatchlistItems.length;
      return {
        ...lane,
        count: total,
        items: liveWatchlistItems,
      };
    }
    if (lane.id === "followup" && liveFollowupTotal != null && liveFollowupTotal > 0) {
      // Live: show the count of due-today open followups; keep seed item titles
      // for now until a dedicated "list followups due today" query lands.
      return {
        ...lane,
        count: liveFollowupDueToday ?? liveFollowupTotal,
      };
    }
    return lane;
  });
  return (
    <section className="nb-home-block" data-testid="exact-home-today-intel">
      <header className="nb-home-block-head">
        <div>
          <div className="nb-kicker">Today&apos;s intelligence</div>
          <h3 className="nb-home-block-title">Pick up where memory left off.</h3>
        </div>
        <button type="button" className="nb-home-block-link">View all</button>
      </header>
      <div className="nb-today-grid">
        {lanes.map((lane) => (
          <article key={lane.id} className="nb-today-lane" data-accent={lane.accent}>
            <header className="nb-today-lane-head">
              <span className="nb-today-lane-dot" />
              <span className="nb-today-lane-title">{lane.title}</span>
              <span className="nb-today-lane-count">{lane.count}</span>
            </header>
            <ul className="nb-today-list">
              {lane.items.map((it, i) => (
                <li key={i} className="nb-today-item">
                  <div className="hd">{it.hd}</div>
                  <div className="meta">{it.meta}</div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

const EVENT_STATS: { v: string | number; l: string; emph: boolean }[] = [
  { v: 1482,   l: "entities discovered",      emph: false },
  { v: "78%",  l: "answers from event corpus", emph: true  },
  { v: 4920,   l: "repeated searches avoided", emph: false },
  { v: 214,    l: "private capture sessions",  emph: false },
];

const RECENT_CAPTURES = [
  { time: "0:42 ago", who: "Alex Park · Orbital Labs",   note: "voice-agent eval infra · matched first name" },
  { time: "12m ago",  who: "Maya Cole · ex-Epic",         note: "clinical lead · ring-1 healthcare" },
  { time: "38m ago",  who: "Sam Reichelt · ex-Olive AI",  note: "product co-founder" },
  { time: "1h ago",   who: "Booth photo · D14-1",         note: "3 captures attached to Team" },
];

function NBActiveEvent() {
  // C2: Pull most-recently-touched event workspace + captures. Anonymous
  // visitors (or users with no event workspace) get the seed Ship Demo Day
  // demo experience.
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const snapshot = useQuery(
    api?.domains.product.entities.getActiveEventSnapshot ?? "skip",
    api?.domains.product.entities.getActiveEventSnapshot
      ? { anonymousSessionId }
      : "skip",
  );
  const liveSnap = (snapshot as any)?.live === true && (snapshot as any)?.workspaceId;
  const title = liveSnap ? String((snapshot as any).title ?? "Active workspace") : "Ship Demo Day";
  const stats: Array<{ v: string | number; l: string; emph: boolean }> = liveSnap
    ? [
        { v: Number((snapshot as any).entitiesDiscovered ?? 0), l: "entities discovered", emph: false },
        // 78% / 4920 / 214 are corpus-level metrics that need the Pulse ledger to track per-workspace.
        // Keep seed values until those land — but with live entity count alongside.
        { v: "78%", l: "answers from event corpus", emph: true },
        { v: 4920, l: "repeated searches avoided", emph: false },
        { v: Number((snapshot as any).captureCount ?? 0), l: "private capture sessions", emph: false },
      ]
    : EVENT_STATS;
  const liveCaptures = liveSnap ? ((snapshot as any).recentCaptures as Array<any>) : [];
  const captures = liveSnap && liveCaptures.length > 0
    ? liveCaptures.map((c) => ({
        time: typeof c?.time === "number" ? formatRelativeWhen(c.time) : "just now",
        who: String(c?.who ?? "Capture"),
        note: String(c?.note ?? ""),
      }))
    : RECENT_CAPTURES;
  const freshness = liveSnap && (snapshot as any).lastUpdated
    ? `corpus freshness · ${formatRelativeWhen((snapshot as any).lastUpdated as number)}`
    : "corpus freshness · 2m ago";
  return (
    <section className="nb-home-block nb-event" data-testid="exact-home-active-event">
      <header className="nb-home-block-head">
        <div>
          <div className="nb-kicker">
            <span className="nb-event-pip" /> Active workspace · {title}
          </div>
          <h3 className="nb-home-block-title">Corpus is compounding in real time.</h3>
        </div>
        <button type="button" className="nb-home-block-link">Open event</button>
      </header>
      <div className="nb-event-stats">
        {stats.map((s, i) => (
          <div key={i} className="nb-event-stat" data-emph={s.emph}>
            <div className="v">{s.v}</div>
            <div className="l">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="nb-event-captures">
        <div className="nb-event-captures-head">
          <span className="nb-kicker">Latest captures</span>
          <span className="nb-event-captures-meta">{freshness}</span>
        </div>
        <ul className="nb-event-cap-list">
          {captures.map((c, i) => (
            <li key={i} className="nb-event-cap">
              <span className="t">{c.time}</span>
              <span className="who">{c.who}</span>
              <span className="note">{c.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type RecentEntry = {
  id: string;
  title: string;
  eyebrow: string;
  fresh: "fresh" | "updated" | "watching";
  meta: string;
  teaser: string;
};

const RECENT_REPORTS: RecentEntry[] = [
  {
    id: "orbital",
    title: "Orbital Labs — should I follow up?",
    eyebrow: "diligence · series A",
    fresh: "fresh",
    meta: "8 turns · 14 sources · 6 entities",
    teaser: "Voice-agent eval infra. Open-core SDK; design partners with Oscar, Commure, one unnamed payer.",
  },
  {
    id: "disco",
    title: "DISCO — diligence debrief",
    eyebrow: "diligence · series C",
    fresh: "updated",
    meta: "6 branches · 24 sources · 3 sections",
    teaser: "Series-C legal-tech. $100M led by Bessemer. Concentration risk + EU regulatory exposure.",
  },
  {
    id: "mercor",
    title: "Mercor — series B signal?",
    eyebrow: "watch · marketplace",
    fresh: "watching",
    meta: "4 turns · 18 sources · ring-1",
    teaser: "Hiring velocity ↑ 62% MoM. Three new design partners. Compete: Worksome, Toptal-Pro.",
  },
];

function NBRecentReports({
  onOpenReport,
  liveEntities,
}: {
  onOpenReport: (id: string) => void;
  liveEntities?: Array<any> | null;
}) {
  // Tier A live wiring: top 3 entities by latestReportUpdatedAt mapped to the
  // RecentEntry shape; falls back to seed when unauthenticated/no entities.
  const live = Array.isArray(liveEntities) && liveEntities.length > 0;
  const liveCards: RecentEntry[] | null = live
    ? [...liveEntities!]
        .filter((e) => typeof e?.latestReportUpdatedAt === "number" || (e?.reportCount ?? 0) > 0)
        .sort((a, b) => {
          const at = (a?.latestReportUpdatedAt as number | undefined) ?? a?.updatedAt ?? 0;
          const bt = (b?.latestReportUpdatedAt as number | undefined) ?? b?.updatedAt ?? 0;
          return bt - at;
        })
        .slice(0, 3)
        .map((entity) => {
          const latestUpdated = (entity?.latestReportUpdatedAt as number | undefined) ?? entity?.updatedAt;
          const ageMs = typeof latestUpdated === "number" ? Date.now() - latestUpdated : Infinity;
          const fresh: RecentEntry["fresh"] =
            ageMs < 1000 * 60 * 60 * 24 ? "fresh" : ageMs < 1000 * 60 * 60 * 24 * 7 ? "updated" : "watching";
          const reportCount = entity?.reportCount ?? 0;
          return {
            id: String(entity?.slug ?? entity?._id ?? entity?.name ?? "entity"),
            title: String(entity?.name ?? "Untitled"),
            eyebrow: `${humanizeEntityType(entity?.entityType)} · ${formatRelativeWhen(latestUpdated)}`.toLowerCase(),
            fresh,
            meta: `${reportCount} report${reportCount === 1 ? "" : "s"}`,
            teaser: String(entity?.summary ?? "").slice(0, 180) || "Saved entity memory — open to see the full report.",
          };
        })
    : null;
  const cards = liveCards && liveCards.length > 0 ? liveCards : RECENT_REPORTS;
  return (
    <section className="nb-home-block" data-testid="exact-home-recent-reports">
      <header className="nb-home-block-head">
        <div>
          <div className="nb-kicker">Recent reports</div>
          <h3 className="nb-home-block-title">Memory you can pick up at any branch.</h3>
        </div>
        <button type="button" className="nb-home-block-link" onClick={() => onOpenReport("__all__")}>All reports</button>
      </header>
      <div className="nb-recent-grid">
        {cards.map((r) => (
          // Mouse onClick anywhere on the card opens the report (preserves the
          // "whole card is clickable" affordance), but the article is NOT a
          // role="button" with tabIndex — that nests interactive controls
          // inside the inner Brief/Explore/Chat buttons (axe nested-interactive
          // serious violation). Keyboard users tab through the 3 inner buttons.
          <article
            key={r.id}
            className="nb-recent-card"
            onClick={() => onOpenReport(r.id)}
          >
            <header className="nb-recent-head">
              <span className="nb-recent-eye">{r.eyebrow}</span>
              <span className="nb-recent-fresh" data-state={r.fresh}>● {r.fresh}</span>
            </header>
            <h4 className="nb-recent-title">{r.title}</h4>
            <p className="nb-recent-teaser">{r.teaser}</p>
            <div className="nb-recent-meta">{r.meta}</div>
            <div className="nb-recent-actions">
              <button type="button" className="nb-recent-action" data-primary="true" onClick={(e) => { e.stopPropagation(); onOpenReport(r.id); }}>Brief</button>
              <button type="button" className="nb-recent-action" onClick={(e) => { e.stopPropagation(); onOpenReport(r.id); }}>Explore</button>
              <button type="button" className="nb-recent-action" onClick={(e) => { e.stopPropagation(); onOpenReport(r.id); }}>Chat</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ExactHomeSurface(_props: WebSurfaceProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<LaneId>("answer");

  // Tier A live wiring: pull entities.listEntities once at the home surface level
  // and pass slices to PulseStrip + TodayIntel + RecentReports.  When the user
  // is unauthenticated or has zero entities, the children fall back to their
  // seed arrays so the demo experience is preserved.
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const entities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );
  const liveEntities = (entities as Array<any> | undefined) ?? null;

  const start = (nextQuery = query) => {
    const resolved = nextQuery.trim() || PROMPT_CARDS[0].prompt;
    navigate(buildCockpitPath({ surfaceId: "workspace", extra: { q: resolved, lane } }));
  };

  const openReport = (id: string) => {
    navigate(buildCockpitPath({ surfaceId: "packets", extra: { report: id } }));
  };

  return (
    <ResponsiveSurface mobile="home">
      <div className="nb-home-pulse" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section className="nb-composer-hero">
        <div className="nb-kicker">Entity intelligence</div>
        <h1>What are we researching today?</h1>
        <p>Answer-first. Backed by sources. Saved reports become reusable memory.</p>

        <div className="nb-composer-box" data-testid="exact-web-home-composer">
          <textarea
            className="nb-composer-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                start();
              }
            }}
            placeholder="Ask anything - a company, a market, or a question..."
            aria-label="Ask anything - a company, a market, or a question"
          />
          <div className="nb-composer-bottom">
            <div className="nb-lanes">
              {LANES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="nb-lane"
                  data-active={lane === item.id}
                  onClick={() => setLane(item.id)}
                >
                  {item.label}
                  <small>{item.note}</small>
                </button>
              ))}
            </div>
            <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <Command size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Enter
            </span>
            <button type="button" className="nb-btn nb-btn-primary" onClick={() => start()}>
              <Send size={14} />
              Start run
            </button>
          </div>
        </div>

        <div className="nb-prompt-grid">
          {PROMPT_CARDS.map(({ icon: Icon, prompt }) => (
            <button
              key={prompt}
              type="button"
              className="nb-prompt-card"
              onClick={() => {
                setQuery(prompt);
                start(prompt);
              }}
            >
              <span className="nb-prompt-icon"><Icon size={14} /></span>
              <span style={{ display: "block", fontSize: 14, fontWeight: 800, lineHeight: 1.35 }}>
                {prompt}
              </span>
            </button>
          ))}
        </div>
      </section>

      <NBPulseStrip liveEntities={liveEntities} />

      <div className="nb-home-grid">
        <NBTodayIntel liveEntities={liveEntities} />
        <NBActiveEvent />
      </div>

      <NBRecentReports onOpenReport={openReport} liveEntities={liveEntities} />

      <div className="nb-install-chip">
        <span style={{ textTransform: "uppercase", letterSpacing: ".14em" }}>Use from Claude or Cursor</span>
        <code>npx nodebench-mcp</code>
        <a href="/cli" style={{ color: "var(--accent-ink)", fontWeight: 800, textDecoration: "none" }}>Developer docs -&gt;</a>
      </div>
      </div>
    </ResponsiveSurface>
  );
}

/* ── Live data adapter for ExactReportsSurface ──
 * Maps Convex `entities.listEntities` → ExactKit's REPORTS card shape so
 * the kit JSX renders the user's real entity-backed reports instead of
 * static REPORTS fixtures.  HONEST_SCORES: REPORTS only renders as the
 * fallback for unauthenticated users with zero entities.
 */
const ENTITY_TONE_PAIRS: Record<string, [string, string]> = {
  company: ["#1a365d", "#d97757"],
  person: ["#6b3ba3", "#d97757"],
  job: ["#0e7a5c", "#5e6ad2"],
  market: ["#0e7a5c", "#16a37e"],
  note: ["#475569", "#d97757"],
};

function humanizeEntityType(value?: string): string {
  if (!value) return "Entity";
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "company") return "Company";
  if (trimmed === "person") return "Person";
  if (trimmed === "job") return "Role";
  if (trimmed === "market") return "Market";
  if (trimmed === "note") return "Note";
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

type ExactReportCard = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  state: string;
  sources: number;
  updated: string;
  watched: boolean;
  colorA: string;
  colorB: string;
};

/* ──────────────────────────────────────────────────────────────────────────
   Inline report detail (cockpit-embedded)
   When ?surface=packets&report=<id> is set, ExactReportsSurface renders
   ExactReportDetailSurface inline instead of the grid — matches the design
   system mock (claude.ai/design preview): breadcrumb back + header + actions
   + section content, all within the cockpit shell. No subdomain redirect.
   ────────────────────────────────────────────────────────────────────────── */

type ReportSection = { id: string; heading: string; body: string; quote?: { text: string; cite: string } };

type ReportDetail = {
  id: string;
  eyebrow: string;
  title: string;
  template: string;
  scope: string;
  branches: number;
  sources: number;
  saved: string;
  status: "verified" | "needs review" | "watching";
  sections: ReportSection[];
  card?: { kind: string; name: string; rows: [string, string][] };
};

const REPORT_DETAILS: Record<string, ReportDetail> = {
  disco: {
    id: "disco",
    eyebrow: "Diligence · Series C · Active",
    title: "DISCO — diligence debrief",
    template: "Company dossier",
    scope: "Series C diligence · Nov 2026",
    branches: 6,
    sources: 24,
    saved: "Saved 2h ago",
    status: "verified",
    sections: [
      {
        id: "summary",
        heading: "Executive summary",
        body: "Series C-stage legal-tech company. DISCO raised a $100M Series C in October, with [1] confirming participation from Bessemer. Customer count crossed 2,400+ across AmLaw 200 firms [2]. Two material risks: customer concentration and EU regulatory exposure.",
      },
      {
        id: "thesis",
        heading: "Investment thesis",
        body: "eDiscovery is the wedge; the long game is a litigation-OS. Kiwi Camara has positioned every product line — review, hold, depositions — as nodes on a single graph, which is what makes Cellebrite and Relativity look monolithic by comparison [3].",
        quote: {
          text: "We are not selling discovery — we are selling the spine that holds together every workflow a litigator touches.",
          cite: "Kiwi Camara · TechCrunch Disrupt 2026",
        },
      },
      {
        id: "product",
        heading: "Product & moat",
        body: "Three product surfaces share a typed knowledge graph: DISCO Review, DISCO Hold, and DISCO Depositions. The graph is the moat — competitors fork data per workflow [4].",
      },
      {
        id: "market",
        heading: "Market & positioning",
        body: "eDiscovery TAM is consolidating around three players. DISCO leads on velocity-to-deploy; Relativity leads on ecosystem; Everlaw leads on price. The interesting wedge is the voice-agent eval trend [5].",
      },
      {
        id: "team",
        heading: "Team",
        body: "Kiwi Camara (CEO, founded 2013), Sarah Grayson (CFO, joined Nov 2026 from Slack), Aaron Eisenstein (CTO since 2018). Recent additions: Anita Park (CRO, ex-Box) — evidence: 2 sources, medium confidence.",
      },
    ],
    card: {
      kind: "company",
      name: "DISCO",
      rows: [
        ["HQ", "Austin, TX"],
        ["Founded", "2013"],
        ["Employees", "~520"],
        ["Last raise", "$100M Series C"],
        ["Customers", "2,400+ firms"],
        ["Stage", "Series C"],
      ],
    },
  },
  mercor: {
    id: "mercor",
    eyebrow: "Watch · Marketplace · Active",
    title: "Mercor — series B signal?",
    template: "Watch list",
    scope: "Marketplace · Nov 2026",
    branches: 4,
    sources: 18,
    saved: "Saved 1h ago",
    status: "watching",
    sections: [
      {
        id: "signal",
        heading: "Signal",
        body: "Hiring velocity ↑ 62% MoM over the last 90 days. Three new design partners added (per careers + LinkedIn signal) [1]. This is a candidate Series B trigger if the velocity holds for one more cycle.",
      },
      {
        id: "compete",
        heading: "Competitive frame",
        body: "Direct competition: Worksome (talent ops), Toptal-Pro (premium tier). Mercor's ring-1 advantage is integration depth with VC portfolio companies — a network effect Worksome can't replicate without a fund relationship.",
      },
      {
        id: "watch",
        heading: "What to watch",
        body: "If hiring velocity sustains > 50% MoM through Q1 2027 + ARR cohort retention > 110%, model a $40-60M Series B at a 2.5x revenue multiple. If velocity drops below 30%, the thesis fails — re-classify as growth-stage marketplace plateau.",
      },
    ],
  },
  orbital: {
    id: "orbital",
    eyebrow: "Diligence · Series A · Fresh",
    title: "Orbital Labs — should I follow up?",
    template: "Company dossier",
    scope: "Series A · Nov 2026",
    branches: 8,
    sources: 14,
    saved: "Saved 30m ago",
    status: "verified",
    sections: [
      {
        id: "summary",
        heading: "Executive summary",
        body: "Voice-agent eval infra. Open-core SDK; design partners with Oscar, Commure, and one unnamed payer [1]. Founders are ex-Anthropic + ex-Cerebras. Raising Series A this quarter at a $80-120M post.",
      },
      {
        id: "moat",
        heading: "Moat",
        body: "The eval harness compounds with every customer's traffic — proprietary edge cases get harder to fork as the corpus grows. Competing harnesses (Trulens, LangSmith) lack the healthcare-specific evals.",
      },
      {
        id: "risk",
        heading: "Risk",
        body: "OSS commoditization risk — if the open-core SDK gets forked aggressively, the closed enterprise tier needs to compound differentiation faster than the fork curve. Watch their PR cadence on the closed tier.",
      },
    ],
  },
};

function getReportDetail(id: string | null): ReportDetail | null {
  if (!id) return null;
  return REPORT_DETAILS[id.toLowerCase()] ?? REPORT_DETAILS.disco;
}

export function ExactReportDetailSurface({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const navigate = useNavigate();

  // B4: pull live entity workspace by slug. When live data available,
  // prefer the latest report's structured sections; fall back to seed
  // REPORT_DETAILS for unknown ids or anonymous visitors.
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const liveWorkspace = useQuery(
    api?.domains.product.entities.getEntityWorkspace ?? "skip",
    api?.domains.product.entities.getEntityWorkspace
      ? { anonymousSessionId, entitySlug: reportId }
      : "skip",
  );

  const liveDetail = useMemo<ReportDetail | null>(() => {
    if (!liveWorkspace) return null;
    const ws = liveWorkspace as any;
    const entity = ws?.entity;
    const latest = ws?.latest;
    if (!entity) return null;
    const liveSections: ReportSection[] =
      Array.isArray(latest?.sections) && latest!.sections.length > 0
        ? latest!.sections.slice(0, 8).map((s: any, idx: number) => ({
            id: String(s?.id ?? `s-${idx}`),
            heading: String(s?.title ?? `Section ${idx + 1}`),
            body: String(s?.body ?? "").slice(0, 2400),
          }))
        : [];
    if (liveSections.length === 0) return null;
    const reportCount = Number(entity?.reportCount ?? 0);
    const sourceCount = Array.isArray(latest?.sources) ? latest.sources.length : 0;
    return {
      id: String(entity?.slug ?? entity?._id ?? reportId),
      eyebrow: `${humanizeEntityType(entity?.entityType)} · ${formatRelativeWhen(latest?.updatedAt as number | undefined)}`,
      title: String(entity?.name ?? "Untitled"),
      template: String(latest?.type ?? "Live entity"),
      scope: latest?.routing?.routingReason
        ? String(latest.routing.routingReason).slice(0, 60)
        : "Live entity context",
      branches: reportCount,
      sources: sourceCount,
      saved: `Saved ${formatRelativeWhen(latest?.updatedAt as number | undefined)}`,
      status: latest?.status === "verified" ? "verified" : "watching",
      sections: liveSections,
    };
  }, [liveWorkspace, reportId]);

  const detail = liveDetail ?? getReportDetail(reportId);
  if (!detail) {
    return (
      <ResponsiveSurface mobile="reports">
        <section style={{ padding: 24 }}>
          <button type="button" className="nb-btn nb-btn-secondary" onClick={onBack}>← Back to reports</button>
          <p style={{ marginTop: 12, color: "var(--text-muted)" }}>Report not found.</p>
        </section>
      </ResponsiveSurface>
    );
  }

  const statusBadge =
    detail.status === "verified" ? "nb-badge nb-badge-success" : "nb-badge";

  return (
    <ResponsiveSurface mobile="reports">
      <section className="nb-rdetail-cockpit" data-testid="exact-web-report-detail" data-report-id={detail.id}>
        <header className="nb-rdetail-cockpit-head">
          <nav className="nb-rdetail-crumb" aria-label="Breadcrumb">
            <button
              type="button"
              className="nb-rdetail-back"
              onClick={onBack}
              aria-label="Back to reports"
            >
              <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
            </button>
            <button
              type="button"
              className="nb-rdetail-crumb-link"
              onClick={onBack}
            >
              Reports
            </button>
            <span className="nb-rdetail-crumb-sep">/</span>
            <span className="nb-rdetail-crumb-link" aria-disabled>{detail.template.split(" ")[0]}</span>
            <span className="nb-rdetail-crumb-sep">/</span>
            <span className="nb-rdetail-crumb-current">{detail.title}</span>
          </nav>
          <div className="nb-rdetail-actions">
            <span className="nb-rdetail-live" aria-label="Live status">
              <span className="nb-rdetail-live-dot" /> Live · {detail.saved.replace(/^Saved\s+/, "")}
            </span>
            <button type="button" className="nb-btn nb-btn-secondary nb-rdetail-action">
              <RefreshCw size={13} /> Re-run
            </button>
            <button
              type="button"
              className="nb-btn nb-btn-primary nb-rdetail-action"
              onClick={() => navigate(buildCockpitPath({ surfaceId: "workspace", extra: { q: detail.title } }))}
            >
              <MessageSquare size={13} /> Ask agent
            </button>
          </div>
        </header>

        <div className="nb-rdetail-eyebrow">{detail.eyebrow}</div>
        <h1 className="nb-rdetail-title">{detail.title}</h1>

        <div className="nb-rdetail-meta">
          <span className={statusBadge}>
            <Check size={11} style={{ display: "inline", verticalAlign: "-1px" }} /> {detail.status}
          </span>
          <span className="nb-badge">{detail.template}</span>
          <span className="nb-badge">{detail.scope}</span>
          <span className="nb-badge">{detail.branches} branches · {detail.sources} sources</span>
          <span className="nb-badge nb-badge-quiet">{detail.saved}</span>
        </div>

        <div className="nb-rdetail-body">
          {detail.sections.map((section) => (
            <section key={section.id} className="nb-rdetail-section" id={`s-${section.id}`}>
              <h2 className="nb-rdetail-section-head">{section.heading}</h2>
              <p className="nb-rdetail-section-body">{section.body}</p>
              {section.quote && (
                <blockquote className="nb-rdetail-quote">
                  <p>{section.quote.text}</p>
                  <cite>— {section.quote.cite}</cite>
                </blockquote>
              )}
              {section.id === "product" && detail.card && (
                <div className="nb-rdetail-card" role="region" aria-label={`${detail.card.kind} card · ${detail.card.name}`}>
                  <header className="nb-rdetail-card-head">
                    <span className="nb-rdetail-card-kind">{detail.card.kind}</span>
                    <span className="nb-rdetail-card-tag">EMBEDDED CARD</span>
                  </header>
                  <h3 className="nb-rdetail-card-name">{detail.card.name}</h3>
                  <dl className="nb-rdetail-card-rows">
                    {detail.card.rows.map(([k, v]) => (
                      <div key={k} className="nb-rdetail-card-row">
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </section>
          ))}
        </div>
      </section>
    </ResponsiveSurface>
  );
}

export function ExactReportsSurface() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reportParam = searchParams.get("report");
  const navigate = useNavigate();

  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const entities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );

  const liveReports: ExactReportCard[] | null = useMemo(() => {
    const list = entities as Array<any> | undefined;
    if (!list || list.length === 0) return null;
    return list.map((entity) => {
      const tone = ENTITY_TONE_PAIRS[String(entity.entityType ?? "").toLowerCase()] ?? ["#475569", "#d97757"];
      const reportCount = typeof entity.reportCount === "number" ? entity.reportCount : 0;
      const updatedAt = typeof entity.latestReportUpdatedAt === "number" ? entity.latestReportUpdatedAt : entity.updatedAt;
      return {
        id: String(entity.slug ?? entity._id ?? entity.name),
        kind: humanizeEntityType(entity.entityType),
        title: String(entity.name ?? "Untitled"),
        summary: String(entity.summary ?? ""),
        state: reportCount >= 1 ? "verified" : "needs review",
        sources: reportCount,
        updated: formatRelativeWhen(typeof updatedAt === "number" ? updatedAt : undefined),
        watched: false,
        colorA: tone[0],
        colorB: tone[1],
      };
    });
  }, [entities]);

  const reportsSource = liveReports ?? REPORTS;
  const [view, setView] = useState<"grid" | "list">("grid");
  const [filter, setFilter] = useState("all");
  const filteredReports = filter === "all" ? reportsSource : reportsSource.filter((report) => report.state.includes(filter));

  const goBackToGrid = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("report");
    setSearchParams(next, { replace: false });
  };

  const openInlineReport = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("surface", "packets");
    next.set("report", id);
    setSearchParams(next, { replace: false });
  };

  // Inline detail view: ?surface=packets&report=<id> renders within the
  // cockpit shell instead of redirecting to the workspace subdomain.
  if (reportParam) {
    return <ExactReportDetailSurface reportId={reportParam} onBack={goBackToGrid} />;
  }

  return (
    <ResponsiveSurface mobile="reports">
      <section>
        <div className="nb-reports-toolbar">
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 760, letterSpacing: "-0.02em" }}>Reports</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Reusable entity memory. Open serious work in workspace.nodebenchai.com.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="nb-view-toggle" aria-label="Report filter">
              {["all", "verified", "review", "watching"].map((item) => (
                <button key={item} type="button" data-active={filter === item} onClick={() => setFilter(item)}>
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            <div className="nb-view-toggle" aria-label="Report view">
              <button type="button" data-active={view === "grid"} onClick={() => setView("grid")}><Grid3X3 size={13} /> Grid</button>
              <button type="button" data-active={view === "list"} onClick={() => setView("list")}><List size={13} /> List</button>
            </div>
          </div>
        </div>

        <div data-testid="reports-findings-panel-slot" style={{ marginBottom: 16 }}>
          <EntityFindingsPanel />
        </div>

        <div data-testid="reports-pipeline-launcher-slot" style={{ marginBottom: 16 }}>
          <PipelineLauncher />
        </div>

        <div data-testid="reports-pipeline-schedules-slot" style={{ marginBottom: 16 }}>
          <PipelineSchedulesPanel />
        </div>

        <div data-testid="reports-pipeline-eval-slot" style={{ marginBottom: 16 }}>
          <PipelineEvalScorecard />
        </div>

        <div data-testid="reports-pipelines-panel-slot" style={{ marginBottom: 16 }}>
          <PipelineRunsPanel />
        </div>

        <div className="nb-reports-grid" data-view={view}>
          {filteredReports.map((report) => (
            <article
              key={report.id}
              className="nb-rcard"
              onClick={() => openInlineReport(report.id)}
              data-testid="report-card"
              data-exact-testid="exact-report-card"
            >
              <div className="nb-rcard-thumb">
                <ReportThumb label={report.title} colorA={report.colorA} colorB={report.colorB} />
                <div className="nb-rcard-thumb-overlay">
                  <span className="nb-badge nb-badge-accent">{report.kind}</span>
                  <span className={report.state === "verified" ? "nb-badge nb-badge-success" : "nb-badge"}>
                    {report.state}
                  </span>
                </div>
              </div>
              <div className="nb-rcard-body">
                <div className="nb-rcard-title">{report.title}</div>
                <div className="nb-rcard-sub">{report.summary}</div>
                <div data-testid="report-card-actions" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  <button type="button" className="nb-btn nb-btn-secondary" onClick={(event) => { event.stopPropagation(); openInlineReport(report.id); }}>Brief</button>
                  <button type="button" className="nb-btn nb-btn-secondary" aria-label="Explore workspace cards" onClick={(event) => { event.stopPropagation(); openWorkspace(report.id, "cards"); }}>Explore</button>
                  <button type="button" className="nb-btn nb-btn-secondary" aria-label="Ask NodeBench" onClick={(event) => { event.stopPropagation(); navigate(buildCockpitPath({ surfaceId: "workspace", extra: { q: report.title, report: report.id } })); }}>Chat</button>
                </div>
                <div className="nb-rcard-foot">
                  <span>{report.sources} sources</span>
                  <span>{report.updated}</span>
                  <span className="nb-rcard-watch" data-on={report.watched}>
                    <Eye size={11} />
                    {report.watched ? "Watching" : "Watch"}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </ResponsiveSurface>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ExactAvatarMenu — kit TopNav avatar button + status panel
   Click HS avatar → opens 380px popover with sections:
     · Identity strip (HS gradient + Hannah Sato + email + workspace + PRO)
     · Today's pulse (3 mini stats: Memory hits / Searches saved / Sources fresh)
     · Watching · 12 entities (3 watch rows + See all → connect)
     · This month · Pro (3 usage bars + Upgrade to Team button)
     · Recent sessions (3 rows w/ THIS marker)
     · Footer: Theme segment + Settings/Shortcuts/Help/Sign out grid
   Class names mirror the kit verbatim.
   ────────────────────────────────────────────────────────────────────────── */

type WatchDot = "hot" | "warm" | "cool";

function PulseStatTile({ label, value, trend, hot = false }: { label: string; value: string; trend: string; hot?: boolean }) {
  return (
    <div className="nb-avm-pulse" data-hot={hot}>
      <div className="nb-avm-pulse-v">{value}</div>
      <div className="nb-avm-pulse-l">{label}</div>
      <div className="nb-avm-pulse-t">{trend}</div>
    </div>
  );
}

function WatchRow({ name, detail, dot, color }: { name: string; detail: string; dot: WatchDot; color: string }) {
  return (
    <div className="nb-avm-watch-row">
      <div className="nb-avm-watch-mark" style={{ background: `${color}22`, color }}>{name[0]}</div>
      <div className="nb-avm-watch-body">
        <div className="nb-avm-watch-name">{name}</div>
        <div className="nb-avm-watch-detail">{detail}</div>
      </div>
      <span className="nb-avm-watch-dot" data-dot={dot} />
    </div>
  );
}

function UsageBar({ label, used, cap, unit }: { label: string; used: number; cap: number; unit?: string }) {
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const hot = pct >= 80;
  const u = unit ? ` ${unit}` : "";
  return (
    <div className="nb-avm-usage">
      <div className="nb-avm-usage-head">
        <span className="nb-avm-usage-label">{label}</span>
        <span className="nb-avm-usage-num" data-hot={hot}>
          {used}{u} <span className="nb-avm-usage-cap">/ {cap}{u}</span>
        </span>
      </div>
      <div className="nb-avm-usage-track">
        <div className="nb-avm-usage-fill" data-hot={hot} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SessionRow({ time, device, current = false }: { time: string; device: string; current?: boolean }) {
  return (
    <div className="nb-avm-session">
      <span className="nb-avm-session-dot" data-current={current} />
      <span className="nb-avm-session-time">{time}</span>
      <span className="nb-avm-session-device">{device}</span>
      {current && <span className="nb-avm-session-this">THIS</span>}
    </div>
  );
}

function ThemeSegment({ resolvedMode, setMode }: { resolvedMode: "light" | "dark"; setMode: (m: "light" | "dark") => void }) {
  return (
    <div className="nb-avm-theme">
      {(["light", "dark"] as const).map((id) => {
        const active = resolvedMode === id;
        return (
          <button
            key={id}
            type="button"
            className="nb-avm-theme-opt"
            data-active={active}
            onClick={() => { if (!active) setMode(id); }}
          >
            {id === "light" ? "Light" : "Dark"}
          </button>
        );
      })}
    </div>
  );
}

export function ExactAvatarMenu({
  resolvedMode,
  setMode,
  onSurfaceChange,
}: {
  resolvedMode: "light" | "dark";
  setMode: (m: "light" | "dark") => void;
  onSurfaceChange?: (s: CockpitSurfaceId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Tier A live wiring: pull entities and use top 3 most-recent for the
  // Watching list + total count for the section label. Other sections
  // (Today's pulse %, Plan & usage bars, Recent sessions) still need
  // dedicated Convex tables (metricsLedger, userPlanUsage, userSessions)
  // and stay seed for now.
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const watchedEntities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );
  const liveEntitiesArr = (watchedEntities as Array<any> | undefined) ?? null;

  // B2: Avatar Today's pulse — pull aggregated metrics; fall back to seed
  // when anonymous or query empty.
  const avatarPulse = useQuery(
    api?.domains.product.entities.getProductPulseMetrics ?? "skip",
    api?.domains.product.entities.getProductPulseMetrics
      ? { anonymousSessionId, lookbackHours: 168 }
      : "skip",
  );
  const avatarPulseLive = (avatarPulse as any)?.live === true;
  const livePulseStats = avatarPulseLive
    ? {
        searches: Number((avatarPulse as any)?.chatMessagesRecent ?? 0),
        // Derive a memory-hit % proxy: claims_changed + sources_attached
        // both indicate the answer reused public context. Anonymous → seed.
        memoryHitPct: (() => {
          const claims = Number((avatarPulse as any)?.claimsChangedRecent ?? 0);
          const sources = Number((avatarPulse as any)?.sourcesAttachedRecent ?? 0);
          const chats = Number((avatarPulse as any)?.chatMessagesRecent ?? 0);
          if (chats === 0) return null;
          // crude proxy: how many ledger writes per chat. Cap at 99%.
          const ratio = Math.min(99, Math.round(((claims + sources) / Math.max(chats, 1)) * 100));
          return ratio;
        })(),
      }
    : null;
  // Tier D — recordCurrentSession + listRecentSessions
  const recordSession = useMutation(api?.domains.product.entities.recordCurrentSession);
  const recentSessions = useQuery(
    api?.domains.product.entities.listRecentSessions ?? "skip",
    api?.domains.product.entities.listRecentSessions
      ? { anonymousSessionId }
      : "skip",
  );
  useEffect(() => {
    if (!recordSession) return;
    let sessionKey = "";
    try {
      const k = sessionStorage.getItem("nb-session-key");
      if (k) sessionKey = k;
      else {
        sessionKey = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem("nb-session-key", sessionKey);
      }
    } catch {
      sessionKey = `s-fallback-${Date.now()}`;
    }
    const ua = navigator.userAgent;
    const platform =
      /Mac/i.test(ua) ? "MacBook" : /Windows/i.test(ua) ? "Windows" : /Linux/i.test(ua) ? "Linux" : /iPhone/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android" : "Device";
    const browser =
      /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : /Firefox\//i.test(ua) ? "Firefox" : "Browser";
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.split("/")[1]?.slice(0, 3).toUpperCase() ?? ""; } catch { return ""; } })();
    const deviceLabel = [platform, browser, tz].filter(Boolean).join(" · ");
    void recordSession({ anonymousSessionId, sessionKey, deviceLabel }).catch(() => {});
  }, [recordSession, anonymousSessionId]);
  const liveSessionRows = (recentSessions as Array<any> | undefined) ?? null;

  const liveWatching =
    Array.isArray(liveEntitiesArr) && liveEntitiesArr.length > 0
      ? [...liveEntitiesArr]
          .sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0))
          .slice(0, 3)
          .map((entity) => {
            const ageMs =
              typeof entity?.updatedAt === "number" ? Date.now() - entity.updatedAt : Infinity;
            const dot: "hot" | "warm" | "cool" =
              ageMs < 1000 * 60 * 60 * 6 ? "hot" : ageMs < 1000 * 60 * 60 * 24 * 2 ? "warm" : "cool";
            const reportCount = entity?.reportCount ?? 0;
            return {
              name: String(entity?.name ?? "Entity"),
              detail: `${reportCount} report${reportCount === 1 ? "" : "s"} · ${formatRelativeWhen(entity?.updatedAt as number | undefined)}`,
              dot,
              color: dot === "hot" ? "#D97757" : dot === "warm" ? "#5E6AD2" : "#3F8F6E",
            };
          })
      : null;
  const watchingTotal =
    Array.isArray(liveEntitiesArr) && liveEntitiesArr.length > 0
      ? liveEntitiesArr.length
      : 12;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const goConnect = () => {
    setOpen(false);
    onSurfaceChange?.("connect");
  };

  return (
    <div ref={ref} className="nb-avm-root">
      <button
        type="button"
        className="nb-avm-trigger"
        data-active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="nb-avm-avatar-sm">HS</div>
        <ChevronRight size={12} className="nb-avm-chev" data-open={open} style={{ transform: open ? "rotate(90deg)" : "rotate(90deg)" }} />
      </button>
      {open && (
        <div role="menu" className="nb-avm-menu" data-testid="exact-avatar-menu">
          <div className="nb-avm-identity">
            <div className="nb-avm-avatar-lg">HS</div>
            <div className="nb-avm-identity-body">
              <div className="nb-avm-name">Hannah Sato</div>
              <div className="nb-avm-id">hannah@orbital.ai · Orbital Labs</div>
            </div>
            <span className="nb-avm-pro">PRO</span>
          </div>

          <div className="nb-avm-section">
            <div className="nb-avm-section-label">Today&apos;s pulse</div>
            <div className="nb-avm-pulse-grid">
              <PulseStatTile
                label="Memory hits"
                value={livePulseStats?.memoryHitPct ? `${livePulseStats.memoryHitPct}%` : "74%"}
                trend={livePulseStats?.memoryHitPct ? "live · 7d" : "+6%"}
                hot
              />
              <PulseStatTile
                label="Searches saved"
                value={livePulseStats?.searches ? String(livePulseStats.searches) : "38"}
                trend={livePulseStats?.searches ? "this week" : "vs 22 last wk"}
              />
              <PulseStatTile
                label="Sources fresh"
                value={
                  avatarPulseLive && (avatarPulse as any)?.sourcesFreshPct != null
                    ? `${(avatarPulse as any).sourcesFreshPct}%`
                    : "91%"
                }
                trend={
                  avatarPulseLive && (avatarPulse as any)?.sourcesFreshPct != null
                    ? `${Math.max(0, ((avatarPulse as any).sourcesTotalCount ?? 0) - Math.round((((avatarPulse as any).sourcesFreshPct ?? 0) / 100) * ((avatarPulse as any).sourcesTotalCount ?? 0)))} stale`
                    : "2 stale"
                }
              />
            </div>
          </div>

          <div className="nb-avm-section">
            <div className="nb-avm-section-head">
              <span className="nb-avm-section-label">Watching · {watchingTotal} entit{watchingTotal === 1 ? "y" : "ies"}</span>
              <button type="button" className="nb-avm-section-link" onClick={goConnect}>See all</button>
            </div>
            {liveWatching && liveWatching.length > 0 ? (
              liveWatching.map((w, i) => (
                <WatchRow key={i} name={w.name} detail={w.detail} dot={w.dot} color={w.color} />
              ))
            ) : (
              <>
                <WatchRow name="Orbital Labs" detail="3 new signals · last 4h" dot="hot" color="#D97757" />
                <WatchRow name="DISCO" detail="Report refreshed · 22m ago" dot="warm" color="#5E6AD2" />
                <WatchRow name="Mira Patel" detail="Quiet · last seen 2d" dot="cool" color="#3F8F6E" />
              </>
            )}
          </div>

          <div className="nb-avm-section nb-avm-section-divided">
            <div className="nb-avm-section-head">
              <span className="nb-avm-section-label">This month · Pro</span>
              <span className="nb-avm-section-meta">resets Mar 1</span>
            </div>
            <UsageBar label="Sourced answers" used={284} cap={500} />
            <UsageBar label="Watched entities" used={12} cap={25} />
            <UsageBar label="Memory store" used={68} cap={100} unit="MB" />
            <button
              type="button"
              className="nb-avm-upgrade"
              onClick={() => {
                setOpen(false);
                window.location.assign("/pricing");
              }}
            >
              <Zap size={12} className="nb-avm-upgrade-ic" /> Upgrade to Team
            </button>
          </div>

          <div className="nb-avm-section nb-avm-section-divided">
            <div className="nb-avm-section-label">Recent sessions</div>
            <div className="nb-avm-sessions">
              {liveSessionRows && liveSessionRows.length >= 3 ? (
                liveSessionRows.slice(0, 3).map((s, i) => (
                  <SessionRow
                    key={s.sessionKey ?? i}
                    time={formatRelativeWhen(typeof s?.lastSeenAt === "number" ? s.lastSeenAt : undefined)}
                    device={String(s?.deviceLabel ?? "Device")}
                    current={Boolean(s?.isCurrent)}
                  />
                ))
              ) : (
                <>
                  <SessionRow time="now" device="MacBook · Safari · SF" current />
                  <SessionRow time="3h ago" device="iPhone · Native · SF" />
                  <SessionRow time="yesterday" device="MacBook · Chrome · SF" />
                </>
              )}
            </div>
          </div>

          <div className="nb-avm-footer">
            <div className="nb-avm-theme-row">
              <span className="nb-avm-section-label">Theme</span>
              <ThemeSegment resolvedMode={resolvedMode} setMode={setMode} />
            </div>
            <div className="nb-avm-links">
              <button type="button" className="nb-avm-link" onClick={goConnect}>
                <Settings size={13} /> <span>Settings</span>
              </button>
              <button type="button" className="nb-avm-link">
                <Terminal size={13} /> <span>Shortcuts</span>
                <span className="nb-avm-kbd">?</span>
              </button>
              <button type="button" className="nb-avm-link">
                <BookOpen size={13} /> <span>Help</span>
              </button>
              <button type="button" className="nb-avm-link" data-danger>
                <X size={13} /> <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ChatStream — full conversation surface (kit ChatStream port)
   Was: static AnswerPacket. Now: ChatStream with thread header + save bar +
   conversation thread (user + agent turns with run-bar / trace / capture
   chips / follow-ups) + composer with pinned context + suggest chips.
   Class names mirror the kit verbatim so kit.css lifts apply.
   ────────────────────────────────────────────────────────────────────────── */

type ChatRunKind = "context" | "capture" | "research" | "lookup";
type ChatRunBar = { kind: ChatRunKind; summary: string; detail?: string };
type ChatTraceStep = { step: string; label: string; hits?: string };
type ChatRunUpdate = { kind: "session" | "graph" | "notebook" | "followup"; label: string; detail?: string };
type ChatSegment =
  | { t: "t"; v: string }
  | { t: "strong"; v: string }
  | { t: "pill"; kind: string; id: string; v: string; subtle?: string }
  | { t: "cite"; n: number };
type ChatBlock =
  | { kind: "p"; segs: ChatSegment[] }
  | { kind: "h"; v: string }
  | { kind: "list"; items: ChatSegment[][] }
  | { kind: "confirm"; match: string; confidence: "low" | "medium" | "high"; entityKind?: string };
type ChatSource = {
  n: number;
  fav: string;
  domain: string;
  title: string;
  cached?: boolean;
};

type ChatTurn =
  | { id: string; role: "user"; time: string; text: string }
  | {
      id: string;
      role: "agent";
      time: string;
      run?: ChatRunBar;
      trace?: ChatTraceStep[];
      body?: ChatBlock[];
      runUpdates?: ChatRunUpdate[];
      sources?: ChatSource[];
      followups?: string[];
    };

const ORBITAL_THREAD_TURNS: ChatTurn[] = [
  { id: "t1", role: "user", time: "2:14 PM", text: "I'm at Ship Demo Day. Help me keep track." },
  {
    id: "t2",
    role: "agent",
    time: "2:14 PM",
    run: { kind: "context", summary: "Started event context", detail: "Using event corpus · Ship Demo Day" },
    trace: [
      { step: "mem", label: "searched memory · 0.18s", hits: "2 prior captures" },
      { step: "corpus", label: "event corpus · Ship Demo Day", hits: "1 active session" },
    ],
    body: [
      {
        kind: "p",
        segs: [
          { t: "t", v: "Got it — anchored to " },
          { t: "pill", kind: "event", id: "ship-demo-day", v: "Ship Demo Day" },
          { t: "t", v: ". New captures will land here as event notes. Speak, type, paste, or upload — I'll route them to the right entity." },
        ],
      },
    ],
    runUpdates: [{ kind: "session", label: "Session pinned", detail: "0 paid calls so far" }],
    followups: ["Capture a person", "Capture a company", "Open the event report"],
  },
  {
    id: "t3",
    role: "user",
    time: "2:21 PM",
    text: "Met Alex from Orbital Labs. They build voice-agent eval infra. Looking for healthcare design partners.",
  },
  {
    id: "t4",
    role: "agent",
    time: "2:21 PM",
    run: { kind: "capture", summary: "Captured to Ship Demo Day", detail: "3 entities resolved · 1 follow-up created" },
    trace: [
      { step: "extract", label: "parsed capture", hits: "1 person · 1 company · 1 theme" },
      { step: "mem", label: "searched memory · 0.22s", hits: "0 prior matches for \"Orbital Labs\"" },
      { step: "resolve", label: "resolving entities", hits: "created · pending confirm" },
    ],
    body: [
      {
        kind: "p",
        segs: [
          { t: "t", v: "Captured. New entities: " },
          { t: "pill", kind: "person", id: "alex", v: "Alex", subtle: "first name only" },
          { t: "t", v: " · " },
          { t: "pill", kind: "company", id: "orbital-labs", v: "Orbital Labs", subtle: "new" },
          { t: "t", v: " · " },
          { t: "pill", kind: "theme", id: "voice-eval", v: "voice-agent eval infra" },
          { t: "t", v: "." },
        ],
      },
      {
        kind: "p",
        segs: [
          { t: "t", v: "Linked to " },
          { t: "pill", kind: "event", id: "ship-demo-day", v: "Ship Demo Day" },
          { t: "t", v: " · created follow-up to confirm Alex's last name and contact channel." },
        ],
      },
    ],
    runUpdates: [
      { kind: "graph", label: "3 entities · 4 edges added" },
      { kind: "followup", label: "1 follow-up: confirm Alex's contact" },
    ],
    followups: ["Research Orbital Labs", "Who else is in voice-agent eval?"],
  },
  // ─── Turn 3 — the big research turn (kit ChatStreamData t5+t6) ────────
  {
    id: "t5",
    role: "user",
    time: "2:24 PM",
    text: "Research Orbital Labs and tell me if I should follow up.",
  },
  {
    id: "t6",
    role: "agent",
    time: "2:24 PM",
    run: {
      kind: "research",
      summary: "Memory-first research · 14 sources · 1 paid call",
      detail: "cache · corpus · live refresh",
    },
    trace: [
      { step: "mem", label: "memory · 8 hits in 0.14s", hits: "3 prior reports · 2 captures · 3 graph rings" },
      { step: "cache", label: "source cache · 5 reusable", hits: "2 fresh · 3 ≤14d" },
      { step: "live", label: "live refresh · 1 paid call", hits: "public profile · 220ms" },
      { step: "extract", label: "graph expansion · ring 1", hits: "6 neighbors · 11 edges" },
      { step: "compose", label: "synthesizing answer packet", hits: "5 sections · 7 claims" },
    ],
    body: [
      { kind: "h", v: "Short answer" },
      {
        kind: "p",
        segs: [
          { t: "strong", v: "Yes, follow up. " },
          { t: "t", v: "Their pitch overlaps with two threads you already care about — agent evaluation and healthcare workflow QA — and they're actively looking for design partners" },
          { t: "cite", n: 1 },
          { t: "t", v: "." },
        ],
      },
      { kind: "h", v: "Why it matters" },
      {
        kind: "p",
        segs: [
          { t: "pill", kind: "company", id: "orbital-labs", v: "Orbital Labs" },
          { t: "t", v: " (Series Seed, Aug 2025, $4.2M led by " },
          { t: "pill", kind: "company", id: "amplify", v: "Amplify Partners" },
          { t: "t", v: ")" },
          { t: "cite", n: 2 },
          { t: "t", v: " is one of three teams shipping " },
          { t: "pill", kind: "theme", id: "voice-eval", v: "voice-agent eval" },
          { t: "t", v: " infrastructure — workflow replay, synthetic call generation, and grounded eval against transcripts." },
        ],
      },
      { kind: "h", v: "Evidence" },
      {
        kind: "list",
        items: [
          [
            { t: "t", v: "Founders ex-" },
            { t: "pill", kind: "company", id: "olive-ai", v: "Olive AI" },
            { t: "t", v: " (Sam Reichelt, eng) and ex-" },
            { t: "pill", kind: "company", id: "epic", v: "Epic" },
            { t: "t", v: " (Maya Cole, clinical informatics)" },
            { t: "cite", n: 3 },
            { t: "t", v: " — credible healthcare context." },
          ],
          [
            { t: "t", v: "Three named pilots: " },
            { t: "pill", kind: "company", id: "oscar", v: "Oscar Health" },
            { t: "t", v: ", " },
            { t: "pill", kind: "company", id: "commure", v: "Commure" },
            { t: "t", v: ", and an unnamed payer" },
            { t: "cite", n: 4 },
            { t: "t", v: "." },
          ],
          [
            { t: "t", v: "GitHub activity up 4× since June; " },
            { t: "pill", kind: "theme", id: "voice-eval", v: "voice-eval" },
            { t: "t", v: " SDK is open and has 12 external contributors" },
            { t: "cite", n: 5 },
            { t: "t", v: "." },
          ],
        ],
      },
      { kind: "h", v: "Recommended next action" },
      {
        kind: "p",
        segs: [
          { t: "t", v: "Reply to Alex by EOD with two specific questions: (1) does their replay infra accept full workflow replay or only audio, and (2) are they looking for paid pilots or unpaid design partners. I drafted a 4-line email — open the report to review." },
        ],
      },
    ],
    sources: [
      { n: 1, fav: "O", domain: "orbitallabs.dev", title: "Orbital Labs design partner page", cached: false },
      { n: 2, fav: "A", domain: "amplifypartners.com", title: "Amplify Partners portfolio update", cached: true },
      { n: 3, fav: "L", domain: "linkedin.com", title: "Sam Reichelt LinkedIn", cached: true },
      { n: 4, fav: "C", domain: "commure.com", title: "Commure pilot announcement", cached: true },
      { n: 5, fav: "G", domain: "github.com", title: "orbital-labs/voice-eval", cached: true },
    ],
    runUpdates: [
      { kind: "graph", label: "6 ring-1 neighbors added", detail: "Olive AI · Epic · Oscar Health · Commure · Braintrust · Arize" },
      { kind: "notebook", label: "Notebook updated", detail: "3 sections · 7 claims · 5 sources" },
      { kind: "followup", label: "1 follow-up created", detail: "Reply to Alex by EOD · drafted email saved" },
    ],
    followups: [
      "Compare Orbital Labs vs. Braintrust",
      "Show the graph",
      "Draft the reply to Alex",
      "What did we say about voice-eval before?",
    ],
  },
  // ─── Turn 4 — entity disambiguation with confirm-match block ───────────
  { id: "t7", role: "user", time: "2:31 PM", text: "Who is Alex?" },
  {
    id: "t8",
    role: "agent",
    time: "2:31 PM",
    run: { kind: "lookup", summary: "Using current report context", detail: "0 paid calls · 1 graph hop" },
    trace: [
      { step: "mem", label: "thread memory · prior turns", hits: "Alex captured at Ship Demo Day" },
      { step: "compose", label: "evaluating possible match", hits: "1 person · medium confidence" },
    ],
    body: [
      {
        kind: "p",
        segs: [
          { t: "strong", v: "Likely Alex Park" },
          { t: "t", v: ", co-founder and head of product at " },
          { t: "pill", kind: "company", id: "orbital-labs", v: "Orbital Labs" },
          { t: "t", v: ". Match confidence is medium — I matched on first name + Ship Demo Day attendee list + LinkedIn proximity to " },
          { t: "pill", kind: "person", id: "sam-reichelt", v: "Sam Reichelt" },
          { t: "cite", n: 6 },
          { t: "t", v: ". Confirm before I promote this match across your reports." },
        ],
      },
      { kind: "confirm", match: "Alex Park · Orbital Labs", confidence: "medium", entityKind: "person" },
    ],
    sources: [
      { n: 6, fav: "S", domain: "shipdemoday.com", title: "Ship Demo Day attendee list", cached: true },
    ],
    followups: ["Promote Alex to root", "Show people I should follow up with first"],
  },
];

const RUN_KIND_GLYPH: Record<ChatRunKind, string> = {
  context: "◷",
  capture: "⊕",
  research: "⚙",
  lookup: "⌕",
};

const RUN_UPDATE_GLYPH: Record<ChatRunUpdate["kind"], string> = {
  session: "◷",
  graph: "◇",
  notebook: "☰",
  followup: "→",
};

function ChatRunBarView({ run }: { run: ChatRunBar }) {
  return (
    <div className="nb-runbar" data-kind={run.kind}>
      <span className="ic">{RUN_KIND_GLYPH[run.kind]}</span>
      <span className="sum"><strong>{run.summary}</strong></span>
      {run.detail && <span className="dt">· {run.detail}</span>}
    </div>
  );
}

function ChatTraceView({ trace }: { trace: ChatTraceStep[] }) {
  if (!trace.length) return null;
  const summary = `Reasoned across ${trace.length} steps`;
  const tags = trace.map((s) => s.step).join(" + ");
  return (
    <details className="nb-runtrace">
      <summary>
        <span className="nb-runtrace-sum">{summary}</span>
        <span className="nb-runtrace-tags">{tags}</span>
      </summary>
      <div className="nb-runtrace-list">
        {trace.map((step, i) => (
          <div key={i} className="nb-runtrace-step">
            <span className="step">{step.step}</span>
            <span className="lbl">{step.label}</span>
            {step.hits && <span className="hits">· {step.hits}</span>}
          </div>
        ))}
      </div>
    </details>
  );
}

function renderSegments(segs: ChatSegment[]) {
  return segs.map((s, i) => {
    if (s.t === "strong") return <strong key={i}>{s.v}</strong>;
    if (s.t === "cite") return <sup key={i} className="nb-cite">{s.n}</sup>;
    if (s.t === "pill") {
      return (
        <button key={i} type="button" className="nb-epill" data-kind={s.kind} title={`Peek ${s.v}`}>
          <span className="d" />
          <span className="lbl">{s.v}</span>
          {s.subtle && <span className="sub">{s.subtle}</span>}
        </button>
      );
    }
    return <span key={i}>{s.v}</span>;
  });
}

function ChatTurnView({
  turn,
  onFollowup,
}: {
  turn: ChatTurn;
  onFollowup: (text: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="nb-turn" data-role="user">
        <div className="nb-turn-avatar" data-role="user">HS</div>
        <div className="nb-turn-body">
          <div className="nb-turn-head">
            <span className="nb-turn-who">You</span>
            <span className="nb-turn-time">{turn.time}</span>
          </div>
          <div className="nb-turn-text">{turn.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="nb-turn" data-role="agent">
      <div className="nb-turn-avatar" data-role="agent"><Sparkles size={12} /></div>
      <div className="nb-turn-body">
        <div className="nb-turn-head">
          <span className="nb-turn-who">NodeBench</span>
          <span className="nb-turn-time">{turn.time}</span>
        </div>
        {turn.run && <ChatRunBarView run={turn.run} />}
        {turn.trace && turn.trace.length > 0 && <ChatTraceView trace={turn.trace} />}
        {turn.body && (
          <div className="nb-turn-text">
            {turn.body.map((b, i) => {
              if (b.kind === "p") {
                return <p key={i} className="nb-block-p">{renderSegments(b.segs)}</p>;
              }
              if (b.kind === "h") {
                return <h4 key={i} className="nb-block-h">{b.v}</h4>;
              }
              if (b.kind === "list") {
                return (
                  <ul key={i} className="nb-block-list">
                    {b.items.map((segs, j) => (
                      <li key={j}>{renderSegments(segs)}</li>
                    ))}
                  </ul>
                );
              }
              if (b.kind === "confirm") {
                return (
                  <div key={i} className="nb-confirm" data-confidence={b.confidence}>
                    <div className="hd">
                      <span className="d" />
                      <span><strong>Possible match:</strong> {b.match}</span>
                      <span className="conf">{b.confidence} confidence</span>
                    </div>
                    <div className="actions">
                      <button type="button" className="primary">Confirm match</button>
                      <button type="button">Keep separate</button>
                      <button type="button">Show evidence</button>
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
        {turn.sources && turn.sources.length > 0 && (
          <div className="nb-turn-sources">
            <span className="ttl">Sources</span>
            {turn.sources.map((s) => (
              <button
                key={s.n}
                type="button"
                className="nb-src-chip"
                title={s.title}
                onClick={() => {
                  if (typeof window !== "undefined" && s.domain) {
                    window.open(`https://${s.domain}`, "_blank", "noopener,noreferrer");
                  }
                }}
              >
                <span className="fav">{s.fav}</span>
                <span className="n">{s.n}</span>
                <span className="dom">{s.domain}</span>
                {s.cached === true && <span className="badge">cached</span>}
                {s.cached === false && <span className="badge live">live</span>}
              </button>
            ))}
          </div>
        )}
        {turn.runUpdates && turn.runUpdates.length > 0 && (
          <div className="nb-runups">
            {turn.runUpdates.map((u, i) => (
              <div key={i} className="nb-runup" data-kind={u.kind}>
                <span className="ic">{RUN_UPDATE_GLYPH[u.kind]}</span>
                <span className="lbl">
                  <strong>{u.label}</strong>
                  {u.detail && <span className="dim">{` · ${u.detail}`}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {turn.followups && turn.followups.length > 0 && (
          <div className="nb-followups">
            {turn.followups.map((f, i) => (
              <button key={i} type="button" className="nb-followup-chip" onClick={() => onFollowup(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const STREAM_PROMPTS = ["Research a company", "Capture an event note", "Ask about a person"];

export function ExactChatSurface() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [composer, setComposer] = useState(initialQuery);
  const [pins, setPins] = useState<{ kind: string; label: string }[]>([
    { kind: "event", label: "Ship Demo Day" },
  ]);

  // Tier D — when authenticated user has a live chat thread, prefer it
  // over the seed ORBITAL_THREAD_TURNS demo.  Anonymous → seed.
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const liveThread = useQuery(
    api?.domains.product.entities.getMostRecentChatThread ?? "skip",
    api?.domains.product.entities.getMostRecentChatThread
      ? { anonymousSessionId }
      : "skip",
  );
  const liveThreadTurns: ChatTurn[] | null = (() => {
    if (!liveThread || !(liveThread as any)?.live) return null;
    const lt = liveThread as any;
    if (!Array.isArray(lt.turns) || lt.turns.length === 0) return null;
    return lt.turns.map((t: any): ChatTurn =>
      t.role === "user"
        ? { id: String(t.id), role: "user", time: String(t.time), text: String(t.text ?? "") }
        : { id: String(t.id), role: "agent", time: String(t.time), body: [{ kind: "p", segs: [{ t: "t", v: String(t.text ?? "") }] }] },
    );
  })();
  const [turns, setTurns] = useState<ChatTurn[]>(liveThreadTurns ?? ORBITAL_THREAD_TURNS);
  // When the live thread arrives later (Convex query resolves async), swap.
  useEffect(() => {
    if (liveThreadTurns && liveThreadTurns.length > 0) setTurns(liveThreadTurns);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveThread]);

  const sendTurn = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setTurns((prev) => [
      ...prev,
      { id: `u${Date.now()}`, role: "user", time: nowTime(), text: t },
    ]);
    setComposer("");
  };

  return (
    <ResponsiveSurface mobile="chat">
      <section data-testid="exact-web-chat-stream" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: 0 }}>
            Chat
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            6 threads. Every turn keeps the entity context, sources, and report — so you can keep going without restarting.
          </div>
        </div>

        <div className="nb-stream-root">
          <div className="nb-stream-main">
            <div className="nb-stream-header">
              <button type="button" className="nb-rail-toggle" aria-label="Toggle threads" title="Threads">
                <Layers size={14} />
              </button>
              <div className="nb-chat-header-icon">O</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2>Orbital Labs · should I follow up?</h2>
                <div className="nb-stream-header-meta">
                  <span className="nb-stream-fresh" data-state="fresh">● fresh</span>
                  <span>·</span>
                  <span>{turns.length} turns</span>
                  <span>·</span>
                  <span>14 sources</span>
                  <span>·</span>
                  <span>6 entities</span>
                  <span>·</span>
                  <span>1 paid calls</span>
                </div>
              </div>
              <div className="nb-chat-header-actions" style={{ display: "flex" }}>
                <button type="button" onClick={() => navigate(buildCockpitPath({ surfaceId: "packets", extra: { report: "orbital" } }))}>
                  <BookOpen size={11} /> Open report
                </button>
                <button type="button">
                  <Share2 size={11} /> Share
                </button>
              </div>
              <button type="button" className="nb-rail-toggle" aria-label="Toggle context" title="Context">
                <LayoutGrid size={14} />
              </button>
            </div>

            <div className="nb-stream-savebar">
              <span className="nb-stream-savebar-icon">●</span>
              <span>Saved to <strong>Orbital Labs · diligence</strong></span>
              <span className="dim">· 3 sections · 7 claims · 2 follow-ups</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => navigate(buildCockpitPath({ surfaceId: "packets", extra: { report: "orbital" } }))}>Open notebook</button>
              <button type="button">Export</button>
              <button type="button">Track updates</button>
            </div>

            <div className="nb-stream-scroll">
              <div className="nb-stream-inner">
                {turns.map((turn) => (
                  <ChatTurnView key={turn.id} turn={turn} onFollowup={sendTurn} />
                ))}
              </div>
            </div>

            <div className="nb-stream-composer">
              <div className="nb-stream-composer-inner">
                <div className="nb-composer-card">
                  {pins.length > 0 && (
                    <div className="nb-composer-pins">
                      {pins.map((p, i) => (
                        <span key={i} className="nb-pin">
                          <span className="typ">{p.kind}</span>
                          {p.label}
                          <button
                            type="button"
                            aria-label="Remove pin"
                            onClick={() => setPins((prev) => prev.filter((_, idx) => idx !== i))}
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="nb-pin-add"
                        onClick={() => setPins((prev) => [...prev, { kind: "entity", label: "Orbital Labs" }])}
                      >
                        <Plus size={9} /> Add context
                      </button>
                    </div>
                  )}
                  <textarea
                    className="nb-composer-input"
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendTurn(composer);
                      }
                    }}
                    placeholder="Ask, capture, paste, upload, or record…"
                    aria-label="Chat composer"
                  />
                  <div className="nb-composer-footer">
                    <div className="nb-composer-tools">
                      <button type="button" aria-label="Attach file" title="Attach file"><Paperclip size={14} /></button>
                      <button type="button" aria-label="Add URL" title="Add URL"><Link2 size={14} /></button>
                      <button type="button" aria-label="Voice note" title="Voice note"><Mic size={14} /></button>
                      <span className="nb-composer-divider" />
                      <span className="nb-model-trigger" title="Model">
                        <span className="dot" data-provider="anthropic" />
                        <span className="nm">Claude Sonnet 4.5</span>
                      </span>
                    </div>
                    <div className="nb-composer-send-group">
                      <span className="nb-composer-meta">Memory-first · 0 paid calls</span>
                      <button
                        type="button"
                        className="nb-composer-send"
                        aria-label="Send"
                        disabled={!composer.trim()}
                        onClick={() => sendTurn(composer)}
                      >
                        <ChevronRight size={14} style={{ transform: "rotate(-90deg)" }} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="nb-composer-suggest">
                  {STREAM_PROMPTS.map((p) => (
                    <button key={p} type="button" className="nb-prompt-chip" onClick={() => setComposer(p + " ")}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </ResponsiveSurface>
  );
}

function nowTime() {
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  const hr = ((h + 11) % 12) + 1;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${hr}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

/* ── Live data adapter for ExactInboxSurface ──
 * Maps Convex `getNudgesSnapshot` → ExactKit's INBOX item shape so the
 * pixel-perfect kit JSX can render real user nudges instead of static
 * INBOX_SEED.  HONEST_SCORES: the seed only renders as a fallback when
 * live data is unavailable (loading, query failed, or unauthenticated
 * with zero nudges) — in that case it acts as the demo experience for
 * brand-new users.
 */
const ICON_BY_PRIORITY: Record<"act" | "auto" | "watch" | "fyi", LucideIcon> = {
  act: Zap,
  auto: Check,
  watch: Eye,
  fyi: Repeat,
};

function derivePriority(nudge: { type?: string; bucket?: string }): "act" | "auto" | "watch" | "fyi" {
  const type = String(nudge.type ?? "");
  if (nudge.bucket === "action_required" || type === "verification_needed" || type === "follow_up_due") return "act";
  if (type.includes("automation") || type.includes("connector")) return "auto";
  if (type === "watchlist_update" || type === "report_changed" || type === "refresh_recommended") return "watch";
  return "fyi";
}

function deriveActions(priority: "act" | "auto" | "watch" | "fyi"): string[] {
  if (priority === "act") return ["rerun", "open", "snooze", "dismiss"];
  if (priority === "auto") return ["open", "undo", "dismiss"];
  if (priority === "watch") return ["draft", "watch", "dismiss"];
  return ["open", "dismiss"];
}

function formatRelativeWhen(ts?: number): string {
  if (!ts) return "just now";
  const ageMs = Date.now() - ts;
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return "earlier";
}

function humanizeEntity(slug?: string | null): string {
  if (!slug) return "Inbox";
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type ExactInboxItem = {
  id: string;
  when: string;
  entity: string;
  priority: "act" | "auto" | "watch" | "fyi";
  icon: LucideIcon;
  title: string;
  body: string;
  actions: string[];
  report: string | null;
  deltaSources: number;
};

export function ExactInboxSurface() {
  const navigate = useNavigate();
  const api = useConvexApi();
  const convex = useConvex();
  const anonymousSessionId = getAnonymousProductSessionId();
  const snapshot = useQuery(
    api?.domains.product.nudges.getNudgesSnapshot ?? "skip",
    api?.domains.product.nudges.getNudgesSnapshot ? { anonymousSessionId } : "skip",
  );

  const liveItems: ExactInboxItem[] | null = useMemo(() => {
    const nudges = snapshot?.nudges as Array<any> | undefined;
    if (!nudges || nudges.length === 0) return null;
    return nudges.map((n) => {
      const priority = derivePriority(n);
      return {
        id: String(n._id),
        when: formatRelativeWhen(typeof n.createdAt === "number" ? n.createdAt : undefined),
        entity: n.linkedReportTitle?.split(/[-—:]/)[0]?.trim() ?? humanizeEntity(n.linkedEntitySlug),
        priority,
        icon: ICON_BY_PRIORITY[priority],
        title: String(n.title ?? "Update"),
        body: String(n.summary ?? n.title ?? ""),
        actions: deriveActions(priority),
        report: n.linkedReportTitle ?? null,
        deltaSources: typeof n.groupedCount === "number" && n.groupedCount > 1 ? n.groupedCount : 1,
      };
    });
  }, [snapshot]);

  const [filter, setFilter] = useState<"all" | "act" | "auto" | "watch">("all");
  const [items, setItems] = useState<Array<typeof INBOX_SEED[number] | ExactInboxItem>>(
    () => [...INBOX_SEED],
  );

  // Sync live items when the Convex query resolves with data.
  useEffect(() => {
    if (liveItems) setItems(liveItems);
  }, [liveItems]);
  const counts = useMemo(
    () => ({
      all: items.length,
      act: items.filter((item) => item.priority === "act").length,
      auto: items.filter((item) => item.priority === "auto").length,
      watch: items.filter((item) => item.priority === "watch").length,
    }),
    [items],
  );
  const visible = filter === "all" ? items : items.filter((item) => item.priority === filter);

  const act = (id: string, action: string) => {
    // Live-data mode: call real Convex mutations, then optimistically remove.
    if (liveItems && api) {
      if (action === "dismiss") {
        void convex
          .mutation(api.domains.product.nudges.completeNudge, { nudgeId: id, anonymousSessionId })
          .catch(() => undefined);
        setItems((current) => current.filter((item) => item.id !== id));
        return;
      }
      if (action === "snooze") {
        void convex
          .mutation(api.domains.product.nudges.snoozeNudge, { nudgeId: id, anonymousSessionId })
          .catch(() => undefined);
        setItems((current) => current.filter((item) => item.id !== id));
        return;
      }
    } else if (action === "dismiss" || action === "snooze") {
      // Demo mode: just hide locally.
      setItems((current) => current.filter((item) => item.id !== id));
      return;
    }
    if (action === "open" || action === "rerun") {
      navigate(buildCockpitPath({ surfaceId: action === "open" ? "packets" : "workspace" }));
    }
  };

  return (
    <ResponsiveSurface mobile="inbox">
      <section>
        <div className="nb-inbox-head">
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 760, letterSpacing: "-0.02em" }}>Inbox</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Return at the right moment - only when something meaningful changed about an entity you watch.
            </p>
          </div>
          <div className="nb-inbox-filter" role="tablist" aria-label="Inbox filters">
            {[
              ["all", "All", counts.all],
              ["act", "Act", counts.act],
              ["auto", "Auto", counts.auto],
              ["watch", "Watching", counts.watch],
            ].map(([key, label, count]) => (
              <button key={key} type="button" data-active={filter === key} onClick={() => setFilter(key as typeof filter)}>
                {label} <span style={{ marginLeft: 5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          {visible.length === 0 ? (
            <div className="nb-panel" style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>
              <Check size={24} />
              <div style={{ marginTop: 8 }}>All caught up. New items arrive when watched entities move.</div>
            </div>
          ) : (
            visible.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.id} className="nb-ibx-row" data-priority={item.priority}>
                  <div className="nb-ibx-icon"><Icon size={15} /></div>
                  <div>
                    <div className="nb-ibx-top">
                      <span className="nb-ibx-entity">{item.entity}</span>
                      <span className="nb-ibx-title">{item.title}</span>
                      <span className="nb-ibx-when">{item.when}</span>
                    </div>
                    <div className="nb-ibx-msg">{item.body}</div>
                    <div className="nb-ibx-actions">
                      {item.actions.includes("rerun") ? <button className="primary" onClick={() => act(item.id, "rerun")}><GitBranch size={11} /> Re-run report</button> : null}
                      {item.actions.includes("draft") ? <button className="primary" onClick={() => act(item.id, "draft")}><Sparkles size={11} /> Draft brief</button> : null}
                      {item.actions.includes("open") && item.report ? <button onClick={() => act(item.id, "open")}><FileText size={11} /> Open {item.entity}</button> : null}
                      {item.actions.includes("watch") ? <button onClick={() => act(item.id, "watch")}><Eye size={11} /> Watch {item.entity}</button> : null}
                      {item.actions.includes("undo") ? <button onClick={() => act(item.id, "undo")}>Undo auto-promote</button> : null}
                      {item.actions.includes("snooze") ? <button onClick={() => act(item.id, "snooze")}><Clock3 size={11} /> Snooze 1h</button> : null}
                      {item.actions.includes("dismiss") ? <button onClick={() => act(item.id, "dismiss")}><X size={11} /> Dismiss</button> : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className="nb-ibx-priority">{item.priority === "act" ? "act now" : item.priority === "auto" ? "auto-handled" : item.priority === "watch" ? "watching" : "fyi"}</span>
                    <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
                      +{item.deltaSources} source{item.deltaSources > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </ResponsiveSurface>
  );
}

/* ── Live data adapter for ExactMeSurface ──
 * Maps Convex `entities.listEntities` → ExactKit's notebook entities row
 * shape so the kit JSX shows the user's real watched entities instead of
 * the static DISCO/Mercor/Cognition/Turing/Anthropic/OpenAI fixtures.
 */
type ExactNotebookEntity = {
  id: string;
  name: string;
  tag: string;
  lastReport: string;
  reports: number;
  changes: number;
};

const ME_NOTEBOOK_SEED: ExactNotebookEntity[] = [
  { id: "disco", name: "DISCO", tag: "legal tech", lastReport: "Nov 14", reports: 3, changes: 2 },
  { id: "mercor", name: "Mercor", tag: "hiring", lastReport: "Nov 12", reports: 4, changes: 5 },
  { id: "cognition", name: "Cognition", tag: "agents", lastReport: "Nov 10", reports: 2, changes: 1 },
  { id: "turing", name: "Turing", tag: "services", lastReport: "Nov 03", reports: 5, changes: 0 },
  { id: "anthropic", name: "Anthropic", tag: "foundation", lastReport: "Oct 28", reports: 1, changes: 3 },
  { id: "openai", name: "OpenAI", tag: "foundation", lastReport: "Oct 22", reports: 6, changes: 4 },
];

function formatShortDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

export function ExactMeSurface() {
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const liveEntities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );

  const liveNotebook: ExactNotebookEntity[] | null = useMemo(() => {
    const list = liveEntities as Array<any> | undefined;
    if (!list || list.length === 0) return null;
    return list.map((entity) => {
      const updatedAt = typeof entity.latestReportUpdatedAt === "number" ? entity.latestReportUpdatedAt : entity.updatedAt;
      const revision = typeof entity.latestRevision === "number" ? entity.latestRevision : 0;
      const reportCount = typeof entity.reportCount === "number" ? entity.reportCount : 0;
      // "changes" = revisions beyond the first — a user-visible signal that
      // this entity has been re-investigated and gained new context.
      const changes = revision > 1 ? revision - 1 : 0;
      return {
        id: String(entity.slug ?? entity._id ?? entity.name),
        name: String(entity.name ?? "Untitled"),
        tag: humanizeEntityType(entity.entityType).toLowerCase(),
        lastReport: formatShortDate(typeof updatedAt === "number" ? updatedAt : undefined),
        reports: reportCount,
        changes,
      };
    });
  }, [liveEntities]);

  const [section, setSection] = useState("notebook");
  const [entities, setEntities] = useState<ExactNotebookEntity[]>(() => [...ME_NOTEBOOK_SEED]);

  useEffect(() => {
    if (liveNotebook) setEntities(liveNotebook);
  }, [liveNotebook]);
  const nav = [
    { group: "Account", items: [{ id: "notebook", label: "Notebook", icon: BookOpen, count: entities.length }, { id: "profile", label: "Profile", icon: User }] },
    { group: "Preferences", items: [{ id: "notifications", label: "Notifications", icon: Bell }, { id: "pace", label: "Pace & feel", icon: Zap }, { id: "data", label: "Data & memory", icon: FileText }] },
    { group: "Workspace", items: [{ id: "integrations", label: "Integrations", icon: Link2 }, { id: "usage", label: "Usage", icon: Sparkles }] },
  ];

  return (
    <ResponsiveSurface mobile="me">
      <section className="nb-me-grid">
        <aside className="nb-me-sidenav">
          <div className="hd">
            <div className="av">HS</div>
            <div style={{ minWidth: 0 }}>
              <div className="nm">Homen Shum</div>
              <div className="em">homen@nodebench.ai</div>
            </div>
          </div>
          {nav.map((group) => (
            <div key={group.group}>
              <div className="section-title">{group.group}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} type="button" data-active={section === item.id} onClick={() => setSection(item.id)}>
                    <Icon size={14} />
                    <span>{item.label}</span>
                    {"count" in item ? <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11 }}>{item.count}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section>
          {section === "notebook" ? (
            <div>
              <h1 className="nb-settings-h1">Notebook</h1>
              <p className="nb-settings-sub">Entities you have taught NodeBench to watch. Reports and Inbox items anchor to these.</p>
              <div className="nb-settings-section" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", padding: "14px 20px" }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 800 }}>{entities.length} watched entities</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>New reports automatically link to entities they mention.</div>
                  </div>
                  <button className="nb-btn nb-btn-secondary" type="button"><Plus size={13} /> Add entity</button>
                </div>
                {entities.map((entity, index) => (
                  <div
                    key={entity.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px 1fr auto auto",
                      gap: 14,
                      alignItems: "center",
                      borderTop: index === 0 ? 0 : "1px solid var(--border-subtle)",
                      padding: "12px 20px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 9, background: "var(--accent-primary-tint)", color: "var(--accent-ink)", fontWeight: 800 }}>
                      {entity.name[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 750 }}>{entity.name}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                        {entity.tag} - {entity.reports} reports - last activity {entity.lastReport}
                        {entity.changes > 0 ? <span style={{ color: "var(--accent-primary)", marginLeft: 6, fontWeight: 800 }}>- {entity.changes} new</span> : null}
                      </div>
                    </div>
                    <button type="button" className="nb-btn nb-btn-secondary"><FileText size={12} /> Reports</button>
                    <button type="button" className="nb-btn" aria-label="Unwatch" onClick={() => setEntities((current) => current.filter((item) => item.id !== entity.id))}><X size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {section === "profile" ? <ProfileSettings /> : null}
          {section === "notifications" ? <NotificationSettings /> : null}
          {section === "pace" ? <PaceSettings /> : null}
          {section === "data" ? <DataSettings /> : null}
          {section === "integrations" ? <IntegrationsSettings /> : null}
          {section === "usage" ? <UsageSettings /> : null}
        </section>
      </section>
    </ResponsiveSurface>
  );
}

function ProfileSettings() {
  return (
    <div>
      <h1 className="nb-settings-h1">Profile</h1>
      <p className="nb-settings-sub">How you appear inside NodeBench and on shared reports.</p>
      <div className="nb-settings-section">
        <h2>Identity</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Name and email shown on anything you share.</p>
        <SettingField label="Display name"><input type="text" defaultValue="Homen Shum" /></SettingField>
        <SettingField label="Email"><input type="email" defaultValue="homen@nodebench.ai" /></SettingField>
        <SettingField label="Role"><select defaultValue="founder"><option value="founder">Founder</option><option value="investor">Investor</option><option value="analyst">Analyst</option></select></SettingField>
      </div>
    </div>
  );
}

function NotificationSettings() {
  const [values, setValues] = useState({ act: true, auto: true, watch: true, fyi: false });
  return (
    <div>
      <h1 className="nb-settings-h1">Notifications</h1>
      <p className="nb-settings-sub">Only four rings. Silence the ones you do not need.</p>
      <div className="nb-settings-section">
        {[
          ["act", "Act-now items", "Materially changes a saved report"],
          ["auto", "Auto-handled", "Report was refreshed or promoted automatically"],
          ["watch", "Watching", "Entity you follow moved but no report affected"],
          ["fyi", "FYI", "Filings refreshed, no material change"],
        ].map(([key, label, hint]) => (
          <SettingField key={key} label={label} hint={hint}>
            <button type="button" className="nb-switch" data-on={values[key as keyof typeof values]} onClick={() => setValues((current) => ({ ...current, [key]: !current[key as keyof typeof values] }))} />
          </SettingField>
        ))}
      </div>
    </div>
  );
}

function PaceSettings() {
  const [pace, setPace] = useState("conversational");
  return (
    <div>
      <h1 className="nb-settings-h1">Pace & feel</h1>
      <p className="nb-settings-sub">How NodeBench shows its thinking.</p>
      <div className="nb-settings-section">
        <SettingField label="Pace">
          {["instant", "conversational", "deliberate"].map((item) => (
            <button key={item} type="button" className={pace === item ? "nb-btn nb-btn-primary" : "nb-btn nb-btn-secondary"} onClick={() => setPace(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </SettingField>
        <SettingField label="Texture"><button className="nb-switch" data-on={false} /></SettingField>
        <SettingField label="Show trace"><button className="nb-switch" data-on={true} /></SettingField>
      </div>
    </div>
  );
}

function DataSettings() {
  return (
    <div>
      <h1 className="nb-settings-h1">Data & memory</h1>
      <p className="nb-settings-sub">What NodeBench retains across sessions.</p>
      <div className="nb-settings-section">
        <SettingField label="Keep unsaved runs"><select defaultValue="30"><option value="7">7 days</option><option value="30">30 days</option><option value="forever">Keep forever</option></select></SettingField>
        <SettingField label="Learn from saves"><button className="nb-switch" data-on={true} /></SettingField>
        <SettingField label="Learn from dismisses"><button className="nb-switch" data-on={true} /></SettingField>
      </div>
    </div>
  );
}

function IntegrationsSettings() {
  return (
    <div>
      <h1 className="nb-settings-h1">Integrations</h1>
      <p className="nb-settings-sub">Where NodeBench reaches out from - never in.</p>
      <div className="nb-settings-section">
        {["Slack", "Gmail", "Linear", "Notion", "Calendar"].map((name, index) => (
          <SettingField key={name} label={name} hint={index < 2 ? "Connected" : "Not connected"}>
            <button className={index < 2 ? "nb-btn nb-btn-secondary" : "nb-btn nb-btn-primary"} type="button">
              {index < 2 ? "Disconnect" : "Connect"}
            </button>
          </SettingField>
        ))}
      </div>
    </div>
  );
}

function UsageSettings() {
  return (
    <div>
      <h1 className="nb-settings-h1">Usage</h1>
      <p className="nb-settings-sub">Current billing period. Resets monthly.</p>
      <div className="nb-settings-section">
        {[
          ["Runs this month", "84 / 200"],
          ["Saved reports", "17 / 50"],
          ["Watched entities", "12 / 25"],
          ["Source credits", "1,840 / 2,500"],
        ].map(([label, value]) => (
          <SettingField key={label} label={label}><span style={{ fontFamily: "var(--font-mono)", fontWeight: 800 }}>{value}</span></SettingField>
        ))}
        <button type="button" className="nb-btn nb-btn-primary">Upgrade to Team</button>
      </div>
    </div>
  );
}

function SettingField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="nb-field">
      <div className="nb-field-l">{label}{hint ? <span className="hint">{hint}</span> : null}</div>
      <div className="nb-field-r">{children}</div>
    </div>
  );
}

function ExactMobileSurface({ surface }: { surface: MobileSurface }) {
  const [reportTab, setReportTab] = useState<"brief" | "sources" | "notebook">("brief");
  const surfaceTestIds: Partial<Record<MobileSurface, string>> = {
    home: "mobile-home-surface",
    chat: "mobile-chat-surface",
    inbox: "mobile-inbox-surface",
    me: "mobile-me-surface",
  };
  const topTitle: Record<MobileSurface, string> = {
    home: "NodeBench",
    reports: "DISCO report",
    chat: "NodeBench Chat",
    inbox: "Inbox",
    me: "Me",
  };
  return (
    <div className="nb-mobile-kit">
      <div className="m-screen" data-testid={surfaceTestIds[surface]}>
        <header className="m-top">
          <button className="m-icon-btn" aria-label="Menu"><MobileIcon name="thread" /></button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="m-title">{topTitle[surface]}</div>
            <div className="m-top-sub">{surface === "home" ? "Disco Corp. - workspace" : "capture to intelligence"}</div>
          </div>
          <button className="m-icon-btn" aria-label="Notifications"><MobileIcon name="bell" /></button>
        </header>

        {surface === "home" ? <MobileHomeBody /> : null}
        {surface === "chat" ? <MobileChatBody /> : null}
        {surface === "reports" ? (
          <div className="m-body">
            <div className="m-sub-tabs">
              {(["brief", "sources", "notebook"] as const).map((tab) => (
                <button key={tab} type="button" className="m-sub-tab" data-active={reportTab === tab} onClick={() => setReportTab(tab)}>
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            {reportTab === "brief" ? <MobileBriefBody embedded /> : null}
            {reportTab === "sources" ? <MobileSourcesBody embedded /> : null}
            {reportTab === "notebook" ? <MobileNotebookBody embedded /> : null}
          </div>
        ) : null}
        {surface === "inbox" ? <MobileInboxBody /> : null}
        {surface === "me" ? <MobileMeBody /> : null}
      </div>
    </div>
  );
}

function MobileHomeBody() {
  return (
    <main className="m-body">
      <div className="m-home-greet">
        <h2>Good morning, Homen.</h2>
        <p>Four signals on your watchlist this morning.</p>
      </div>
      <div className="m-search">
        <MobileIcon name="search" />
        <input placeholder="Ask NodeBench about any company..." readOnly />
        <kbd>Cmd K</kbd>
      </div>
      <section className="m-section">
        <header className="m-section-head"><span className="kicker">Watchlist</span><a href="/?surface=reports">Manage</a></header>
        <div className="m-watch">
          {WATCHLIST.map((item) => (
            <div key={item.id} className="m-watch-tile">
              <div className="m-watch-tile-head">
                <div className="m-watch-tile-avatar" style={{ background: item.avatar }}>{item.initials}</div>
                <div className="m-watch-tile-name">{item.name}</div>
                <div className="m-watch-tile-ticker">{item.ticker}</div>
              </div>
              <div className="m-watch-tile-val"><strong>{item.value}</strong><span className="delta" data-trend={item.trend}>{item.delta}</span></div>
              <div className="m-watch-tile-meta">{item.meta}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="m-section">
        <header className="m-section-head"><span className="kicker">Since you were last here</span><a href="/?surface=inbox" role="button">All 5</a></header>
        <div className="m-nudges">
          {INBOX_SEED.slice(0, 3).map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="m-nudge">
                <div className="m-nudge-icon"><Icon size={14} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="m-nudge-title">{item.title}</div>
                  <div className="m-nudge-meta"><span>{item.entity}</span><span>{item.when}</span></div>
                </div>
                <MobileIcon name="chevron" />
              </div>
            );
          })}
        </div>
      </section>
      <section className="m-section">
        <header className="m-section-head"><span className="kicker">Recent threads</span><a href="/?surface=chat">View all</a></header>
        <div className="m-threads">
          {THREADS.map((thread) => (
            <div key={thread.id} className="m-thread">
              <div className="m-thread-icon"><MobileIcon name="chat" size={14} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-thread-title">{thread.title}</div>
                <div className="m-thread-meta">{thread.meta}</div>
              </div>
              <MobileIcon name="chevron" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function MobileChatBody() {
  return (
    <main className="m-body m-chat-body">
      <div className="m-chat-query">
        <div className="m-chat-query-u">HS</div>
        <div className="m-chat-query-t">Is DISCO worth reaching out to this week?</div>
      </div>
      <div className="m-chat-runbar">
        <span className="pill pill-ok">verified</span>
        <span className="pill pill-ok">24 sources</span>
        <span className="pill pill-neutral">saved context</span>
      </div>
      <h1 className="m-chat-title">Reach out, but verify the EU compliance claim first.</h1>
      <p className="m-chat-p">DISCO now looks more actionable because its newest source directly addresses a risk already flagged in the saved diligence report.</p>
      <div className="m-chat-callout">
        <div className="m-chat-callout-head"><Sparkles size={12} /> So what</div>
        <p>The next best action is not a generic intro. Verify the claim, then send a tight reply around regulated EU expansion.</p>
      </div>
      <div className="m-strip-head"><span className="kicker">Entities</span><a href="/?surface=reports">Open cards</a></div>
      <div className="m-strip">
        {WATCHLIST.slice(0, 3).map((item) => (
          <div key={item.id} className="m-card">
            <div className="m-card-head">
              <div className="m-card-avatar" style={{ background: item.avatar }}>{item.initials}</div>
              <div><div className="m-card-name">{item.name}</div><div className="m-card-sub">{item.meta}</div></div>
            </div>
            <div className="m-card-metrics">
              <div><div className="m-card-metric-l">Signal</div><div className="m-card-metric-v" data-trend={item.trend}>{item.value}</div></div>
              <div><div className="m-card-metric-l">Delta</div><div className="m-card-metric-v" data-trend={item.trend}>{item.delta}</div></div>
            </div>
          </div>
        ))}
      </div>
      <div className="m-strip-head"><span className="kicker">Top sources</span><a href="/?surface=reports">View all</a></div>
      {["Security page", "Saved report", "Launch note"].map((source, index) => (
        <div key={source} className="m-src-row">
          <MobileIcon name="source" />
          <div style={{ flex: 1 }}>
            <div className="m-src-title">{source}</div>
            <div className="m-src-meta"><span>source {index + 1}</span><span>medium confidence</span></div>
          </div>
        </div>
      ))}
      <div className="m-followups">
        <span className="kicker">Follow-up</span>
        {["Verify", "Open card", "Draft reply"].map((item) => <button key={item} className="m-followup">{item}</button>)}
      </div>
      <div className="m-composer-dock">
        <input placeholder="Ask a follow-up..." />
        <button className="m-composer-send" aria-label="Send"><MobileIcon name="send" /></button>
      </div>
    </main>
  );
}

function MobileBriefBody({ embedded = false }: { embedded?: boolean }) {
  return (
    <main className={embedded ? "m-brief-body" : "m-body m-brief-body"}>
      <div className="m-brief-kicker"><span className="pill pill-accent">Brief</span><span className="pill pill-ok">Verified</span></div>
      <h1 className="m-brief-title">DISCO diligence debrief</h1>
      <p className="m-brief-sub">A concise read on why this company matters now, what changed, and what to do next.</p>
      <div className="m-brief-meta">
        <span className="pill pill-neutral">24 sources</span>
        <span className="pill pill-neutral">6 entities</span>
        <span className="pill pill-warn">2 claims to verify</span>
      </div>
      <section className="m-verdict">
        <span className="kicker">Verdict</span>
        <h2>Reach out after verification.</h2>
        <p>The compliance update removes one concern, but the funding and customer claims still need public evidence before the report becomes canonical.</p>
      </section>
      <div className="m-stats">
        <div className="m-stat"><div className="m-stat-v" data-trend="up">84</div><div className="m-stat-l">Signal score</div></div>
        <div className="m-stat"><div className="m-stat-v">24</div><div className="m-stat-l">Sources</div></div>
      </div>
      <div className="m-triad">
        <div className="m-triad-card"><span className="kicker">What</span><h3>Legal AI workflow company</h3><p>Strongest signal is regulated workflow expansion.</p></div>
        <div className="m-triad-card"><span className="kicker">So what</span><h3>Risk posture changed</h3><p>The latest source may flip a prior review flag.</p></div>
        <div className="m-triad-card"><span className="kicker">Now what</span><h3>Verify, then follow up</h3><p>Keep the field-note claims separate until evidence lands.</p></div>
      </div>
      <h3 className="m-h3"><Clock3 size={14} /> Timeline</h3>
      {["Today", "Yesterday", "Nov 14"].map((date) => (
        <div key={date} className="m-timeline-row">
          <div className="m-timeline-date">{date}</div>
          <div><div className="m-timeline-t">Signal added</div><div className="m-timeline-m">Claim attached to report and routed to verification.</div></div>
        </div>
      ))}
    </main>
  );
}

function MobileSourcesBody({ embedded = false }: { embedded?: boolean }) {
  return (
    <main className={embedded ? "m-src-body" : "m-body m-src-body"}>
      <div className="m-src-head">
        <span className="kicker">Sources</span>
        <h2>Claims and evidence</h2>
      </div>
      {["SOC2 EU scope is available", "Hiring spike implies infra investment", "Customer claim needs verification"].map((claim, index) => (
        <div key={claim} className="m-claim">
          <div className="m-claim-q">{claim}</div>
          <div className="m-claim-status">
            <span className={index === 2 ? "pill pill-warn" : "pill pill-ok"}>{index === 2 ? "needs review" : "verified"}</span>
            <span className="pill pill-neutral">{index + 2} sources</span>
          </div>
        </div>
      ))}
    </main>
  );
}

function MobileNotebookBody({ embedded = false }: { embedded?: boolean }) {
  return (
    <main className={embedded ? "m-notebook-body" : "m-body m-notebook-body"}>
      <h1 className="m-notebook-title">DISCO memo</h1>
      <div className="m-notebook-meta"><span className="pill pill-accent">living note</span><span className="pill pill-neutral">auto-saved</span></div>
      <p className="m-notebook-p">The strongest signal is that DISCO's compliance movement is directly connected to a previously identified blocker.</p>
      <h2 className="m-notebook-h2">Next paragraph</h2>
      <p className="m-notebook-p">Keep the reach-out short. Mention the EU compliance update, ask for scope details, and verify whether the launch changes customer readiness.</p>
      <div className="m-notebook-proposal">
        <span className="kicker">Agent proposal</span>
        <div className="m-notebook-proposal-note">Insert a verification checklist before the follow-up draft.</div>
      </div>
    </main>
  );
}

function MobileInboxBody() {
  const [filter, setFilter] = useState("all");
  const visible = filter === "all" ? INBOX_SEED : INBOX_SEED.filter((item) => item.priority === filter);
  const filters = [
    ["all", "All 5"],
    ["act", "Mentions 2"],
    ["auto", "Signals 2"],
    ["watch", "Tasks 1"],
  ];
  return (
    <main className="m-body">
      <div className="m-inbox-tabs">
        {filters.map(([tab, label]) => (
          <button key={tab} className="m-inbox-tab" data-active={filter === tab} onClick={() => setFilter(tab)}>
            {label}
          </button>
        ))}
      </div>
      <section className="m-inbox-section">
        <div className="m-inbox-section-head">Today</div>
        <div className="m-inbox-list">
          {visible.map((item) => (
            <button key={item.id} type="button" className="m-inbox-row" data-unread={item.priority === "act"}>
              <div className="m-inbox-row-avatar" style={{ background: item.priority === "act" ? "#d97757" : "#5e6ad2" }}>{item.entity[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-inbox-row-title">{item.title}</div>
                <div className="m-inbox-row-snippet">{item.body}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function MobileMeBody() {
  return (
    <main className="m-body">
      <section className="m-me-identity">
        <div className="m-me-avatar" style={{ background: "linear-gradient(135deg,#D97757,#5E6AD2)" }}>HS</div>
        <div className="m-me-identity-main">
          <div className="m-me-name">Homen Shum</div>
          <div className="m-me-email">homen@nodebench.ai</div>
        </div>
        <button className="m-me-edit">Edit</button>
      </section>
      <section className="m-me-stats">
        {[
          ["17", "Threads"],
          ["12", "Reports"],
          ["84", "Runs"],
          ["2.4k", "Sources"],
        ].map(([value, label]) => (
          <div key={label} className="m-me-stat"><div className="m-me-stat-v">{value}</div><div className="m-me-stat-l">{label}</div></div>
        ))}
      </section>
      <section className="m-me-section">
        <div className="m-me-section-head">Workspaces</div>
        <div className="m-me-ws-list">
          {REPORTS.slice(0, 4).map((report) => (
            <button key={report.id} type="button" className="m-me-ws-row">
              <div className="m-me-ws-avatar" style={{ background: report.colorA }}>{report.title[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div className="m-me-ws-name">{report.title}</div><div className="m-me-ws-meta">{report.sources} sources</div></div>
            </button>
          ))}
        </div>
      </section>
      <section className="m-me-section">
        <div className="m-me-section-head">Quick settings</div>
        <button type="button" className="m-me-setting-row">
          <div className="m-me-setting-icon"><MobileIcon name="thread" /></div>
          <div style={{ flex: 1 }}><div className="m-me-setting-label">Starred threads</div><div className="m-me-setting-value">Pinned for quick access</div></div>
        </button>
        {["Evidence mode", "Files", "Credits", "Integrations"].map((item) => (
          <button key={item} type="button" className="m-me-setting-row">
            <div className="m-me-setting-icon"><MobileIcon name="settings" /></div>
            <div style={{ flex: 1 }}><div className="m-me-setting-label">{item}</div><div className="m-me-setting-value">Configured</div></div>
          </button>
        ))}
      </section>
    </main>
  );
}

export function ExactWorkspaceKitPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const workspaceId = useMemo(() => getWorkspaceId(location.pathname), [location.pathname]);
  const activeTab = getWorkspaceTab(searchParams.get("tab"));
  const [thread, setThread] = useState("t1");
  const [rootEntity, setRootEntity] = useState("disco");
  const [selectedCard, setSelectedCard] = useState<string | null>("everlaw");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [expandedClaim, setExpandedClaim] = useState<string | null>("c1");
  const setTab = (tab: WorkspaceTab) => navigate(buildLocalWorkspacePath({ workspaceId, tab }), { replace: true });
  const inspector = activeTab === "cards" && selectedCard ? (
    <WorkspaceCardInspector
      cardId={selectedCard}
      onClose={() => setSelectedCard(null)}
      onDrill={(id) => {
        setRootEntity(id);
        setSelectedCard(null);
      }}
    />
  ) : null;

  return (
    <div className="ws-kit" data-testid="exact-workspace-page">
      <WorkspaceShell
        activeTab={activeTab}
        onTabChange={setTab}
        workspaceId={workspaceId}
        entityMeta={activeTab === "chat" ? `workspace - ${WORKSPACE_THREADS_EXACT.find((item) => item.id === thread)?.meta ?? "2h - 24 src"}` : "workspace - diligence - v3 - 2h ago"}
        inspector={inspector}
      >
        {activeTab === "chat" ? <WorkspaceChatSurface thread={thread} setThread={setThread} onTabChange={setTab} /> : null}
        {activeTab === "brief" ? <WorkspaceBriefSurface onJump={setTab} /> : null}
        {activeTab === "cards" ? (
          <WorkspaceCardsSurface
            rootId={rootEntity}
            setRootId={setRootEntity}
            selectedCard={selectedCard}
            setSelectedCard={setSelectedCard}
          />
        ) : null}
        {activeTab === "notebook" ? <WorkspaceNotebookSurface /> : null}
        {activeTab === "sources" ? (
          <WorkspaceSourcesSurface
            filter={sourceFilter}
            setFilter={setSourceFilter}
            expandedClaim={expandedClaim}
            setExpandedClaim={setExpandedClaim}
          />
        ) : null}
        {activeTab === "map" ? <WorkspaceMapSurface onTabChange={setTab} /> : null}
      </WorkspaceShell>
    </div>
  );
}

const WORKSPACE_THREADS_EXACT = [
  { id: "t1", title: "DISCO - worth reaching out?", meta: "2h - 24 src", query: "DISCO - worth reaching out? Fastest debrief." },
  { id: "t2", title: "Mercor - hiring velocity", meta: "1d - 18 src", query: "Mercor - hiring velocity the past 90 days. Break it down." },
  { id: "t3", title: "Everlaw - head-to-head", meta: "2d - 11 src", query: "Everlaw vs DISCO on AmLaw 100 coverage and blended ARPU." },
  { id: "t4", title: "Turing - contract YoY", meta: "1w - 12 src", query: "Turing - contract revenue YoY. Any concentration risk?" },
  { id: "t5", title: "EU AI Act - legal tech", meta: "2w - 9 src", query: "How will the EU AI Act hit legal tech operators in 2026?" },
];

const WORKSPACE_ENTITIES_EXACT: Record<string, {
  id: string;
  name: string;
  kind: string;
  kicker: string;
  avatar: string;
  avatarBg: string;
  subtitle: string;
  ticker?: string;
  metrics: Array<{ label: string; value: string; trend?: "up" | "down" }>;
  footer?: string;
}> = {
  disco: {
    id: "disco",
    name: "DISCO",
    kind: "company",
    kicker: "root",
    avatar: "DI",
    avatarBg: "linear-gradient(135deg,#1A365D,#0F4C81)",
    subtitle: "legal tech - series c",
    ticker: "LAW",
    metrics: [
      { label: "ARR", value: "$186M", trend: "up" },
      { label: "Growth", value: "2.8x", trend: "up" },
      { label: "NRR", value: "122%", trend: "up" },
      { label: "GM", value: "78%" },
    ],
    footer: "refreshed 2h ago - 24 sources",
  },
  everlaw: {
    id: "everlaw",
    name: "Everlaw",
    kind: "company",
    kicker: "competitor",
    avatar: "EV",
    avatarBg: "linear-gradient(135deg,#7A3A1F,#C76648)",
    subtitle: "legal tech - competitor",
    metrics: [
      { label: "ARR", value: "$140M", trend: "up" },
      { label: "Growth", value: "1.9x" },
      { label: "NRR", value: "108%" },
      { label: "Pricing", value: "-18%", trend: "down" },
    ],
    footer: "midmarket wedge",
  },
  greylock: {
    id: "greylock",
    name: "Greylock",
    kind: "investor",
    kicker: "investor",
    avatar: "G",
    avatarBg: "linear-gradient(135deg,#6B3BA3,#8B5CC1)",
    subtitle: "investor - lead",
    metrics: [
      { label: "Round", value: "$100M" },
      { label: "Board", value: "Grayson" },
      { label: "Portfolio", value: "3 in legal" },
      { label: "Since", value: "2025" },
    ],
    footer: "platform bets",
  },
  "legal-tech": {
    id: "legal-tech",
    name: "Legal tech market",
    kind: "market",
    kicker: "market",
    avatar: "M",
    avatarBg: "linear-gradient(135deg,#C77826,#E09149)",
    subtitle: "market - AmLaw 100",
    metrics: [
      { label: "TAM", value: "$22B", trend: "up" },
      { label: "Growth", value: "1.4x" },
      { label: "Players", value: "41" },
      { label: "AI Act", value: "Feb 26" },
    ],
  },
  "eu-ai-act": {
    id: "eu-ai-act",
    name: "EU AI Act",
    kind: "regulation",
    kicker: "regulation",
    avatar: "EU",
    avatarBg: "linear-gradient(135deg,#0E7A5C,#16A37E)",
    subtitle: "regulation - GPAI",
    metrics: [
      { label: "Enforce", value: "Feb 2026" },
      { label: "Tax", value: "6-9 mo" },
      { label: "Scope", value: "GPAI" },
      { label: "Penalty", value: "7% rev" },
    ],
  },
  "kiwi-camara": {
    id: "kiwi-camara",
    name: "Kiwi Camara",
    kind: "person",
    kicker: "person",
    avatar: "KC",
    avatarBg: "linear-gradient(135deg,#334155,#475569)",
    subtitle: "person - CEO / founder",
    metrics: [
      { label: "Tenure", value: "13 yr" },
      { label: "Prior", value: "Harvard L" },
      { label: "Ownership", value: "14%" },
      { label: "Replies", value: "rare" },
    ],
  },
  relativity: {
    id: "relativity",
    name: "Relativity",
    kind: "company",
    kicker: "incumbent",
    avatar: "R",
    avatarBg: "linear-gradient(135deg,#334155,#475569)",
    subtitle: "incumbent - eDiscovery",
    metrics: [
      { label: "ARR", value: "$320M" },
      { label: "Growth", value: "1.2x", trend: "down" },
      { label: "Share", value: "38%" },
      { label: "AI tier", value: "late" },
    ],
  },
  opus2: {
    id: "opus2",
    name: "Opus 2",
    kind: "company",
    kicker: "adjacent",
    avatar: "O2",
    avatarBg: "linear-gradient(135deg,#1A365D,#0F4C81)",
    subtitle: "legal - case mgmt",
    metrics: [
      { label: "ARR", value: "$42M" },
      { label: "Growth", value: "2.1x", trend: "up" },
      { label: "Region", value: "UK/EU" },
      { label: "Funding", value: "B" },
    ],
  },
  "sarah-grayson": {
    id: "sarah-grayson",
    name: "Sarah Grayson",
    kind: "person",
    kicker: "investor-person",
    avatar: "SG",
    avatarBg: "linear-gradient(135deg,#6B3BA3,#8B5CC1)",
    subtitle: "person - GP Greylock",
    metrics: [
      { label: "Boards", value: "7" },
      { label: "Legal co.", value: "2" },
      { label: "Since", value: "2019" },
      { label: "Check", value: "$50-200M" },
    ],
  },
};

const WORKSPACE_RELATIONS_EXACT: Record<string, string[]> = {
  disco: ["legal-tech", "greylock", "kiwi-camara", "eu-ai-act", "everlaw"],
  everlaw: ["relativity", "opus2", "sarah-grayson"],
  greylock: ["sarah-grayson", "kiwi-camara"],
  "legal-tech": ["disco", "everlaw", "relativity", "opus2", "eu-ai-act"],
  "eu-ai-act": ["disco", "everlaw", "legal-tech"],
  "kiwi-camara": ["disco"],
  relativity: ["legal-tech"],
  opus2: ["legal-tech"],
  "sarah-grayson": ["greylock", "disco"],
};

const WORKSPACE_SOURCES_EXACT = [
  { n: 1, title: "DISCO closes $100M Series C, Greylock leads", domain: "techcrunch.com", date: "Nov 14 2025", type: "press", cites: 4, weight: 0.9 },
  { n: 2, title: "Legal tech market overview 2025", domain: "gartner.com", date: "Oct 2025", type: "analyst", cites: 3, weight: 0.95 },
  { n: 3, title: "EU AI Act enforcement timeline", domain: "euractiv.com", date: "Feb 2026", type: "reg", cites: 2, weight: 0.92 },
  { n: 4, title: "DISCO Q3 2025 IR filing", domain: "sec.gov", date: "Sep 30 2025", type: "filing", cites: 6, weight: 1 },
  { n: 5, title: "DISCO press room - Series C", domain: "press.disco.com", date: "Nov 14 2025", type: "pr", cites: 2, weight: 0.6 },
  { n: 6, title: "Everlaw pricing moves in 2026", domain: "lawtech.com", date: "Mar 18 2026", type: "analyst", cites: 3, weight: 0.72 },
  { n: 7, title: "Greylock fund notes", domain: "greylock.com", date: "Nov 2025", type: "pr", cites: 2, weight: 0.7 },
  { n: 8, title: "AmLaw 100 firm list 2026", domain: "amlaw.com", date: "Jan 2026", type: "analyst", cites: 1, weight: 0.88 },
];

const WORKSPACE_CLAIMS_EXACT = [
  { id: "c1", q: "Series C led by Greylock at $900M post", support: [1, 5, 4], contra: [] as number[] },
  { id: "c2", q: "ARR $186M in Q3 2025", support: [4, 2], contra: [] as number[] },
  { id: "c3", q: "NRR 122% over the trailing four quarters", support: [4, 2], contra: [6] },
  { id: "c4", q: "Serves six of AmLaw 10", support: [4, 8, 2], contra: [] as number[] },
  { id: "c5", q: "EU AI Act enforcement begins Feb 2026 for GPAI", support: [3, 2], contra: [] as number[] },
  { id: "c6", q: "Everlaw midmarket pricing cut 18%", support: [6], contra: [] as number[] },
];

const WORKSPACE_ANSWERS_EXACT: Record<string, {
  verdict: string;
  recommendation: string;
  topCards: string[];
  topSourceIds: number[];
  followups: string[];
}> = {
  t1: {
    verdict: "Yes - worth reaching out. DISCO is compounding above the legal-tech median.",
    recommendation: "Reach out this quarter. Lead with AmLaw traction and the Greylock signal; ask how they plan to absorb the AI Act compliance load without raising effective price.",
    topCards: ["disco", "everlaw", "greylock"],
    topSourceIds: [1, 2, 3, 4],
    followups: ["Compare with Everlaw head-to-head", "Draft a cold intro to Kiwi Camara", "Board composition post-Series C", "Re-run in 30 days if NRR dips"],
  },
  t2: {
    verdict: "Hiring ramp tripled in Q1 2026 - healthy but watch burn.",
    recommendation: "Monitor quarterly. Revisit if burn exceeds $25M/month or ARR growth falls below 3x by mid-2026.",
    topCards: ["disco", "everlaw", "greylock"],
    topSourceIds: [1, 4, 2],
    followups: ["Who are they hiring from?", "GTM leadership map", "Peer burn comparison"],
  },
  t3: {
    verdict: "Everlaw is gaining midmarket share; losing ground in AmLaw 50.",
    recommendation: "DISCO has the stronger top-of-market story; Everlaw is winning on price below the AmLaw 100 line.",
    topCards: ["everlaw", "disco", "legal-tech"],
    topSourceIds: [6, 4, 2, 8],
    followups: ["Win-rate by firm tier", "Upmarket expansion plan", "Buy vs partner thesis"],
  },
  t4: {
    verdict: "Contract revenue flat YoY, concentration rising.",
    recommendation: "Flag for diligence call. Ask about renewal terms on the top five and customer concentration risk.",
    topCards: ["disco", "legal-tech", "greylock"],
    topSourceIds: [4, 2],
    followups: ["Who are the top five?", "Renewal dates", "Net new logos 2026"],
  },
  t5: {
    verdict: "Enforcement begins Feb 2026; expect a 6-9 month adjustment for GPAI users.",
    recommendation: "Ask every legal-tech target for its AI Act readiness doc. If they cannot produce one, that is the conversation.",
    topCards: ["legal-tech", "eu-ai-act", "disco"],
    topSourceIds: [3, 2],
    followups: ["Who is ready?", "Penalty exposure", "Compare with US state laws"],
  },
};

function WorkspaceShell({
  activeTab,
  onTabChange,
  workspaceId,
  entityMeta,
  inspector,
  children,
}: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  workspaceId: string;
  entityMeta: string;
  inspector?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ws-shell" data-workspace-id={workspaceId}>
      <header className="ws-header">
        <button type="button" className="ws-brand" aria-label="NodeBench workspace home">
          <span className="ws-logo">N</span>
          <span>NodeBench <em>AI</em></span>
        </button>
        <button type="button" className="ws-entity" aria-label="Current workspace entity">
          <span className="ws-entity-avatar">DI</span>
          <span className="ws-entity-name">DISCO</span>
          <span className="ws-entity-meta">{entityMeta}</span>
        </button>
        <nav className="ws-tabs" aria-label="Workspace tabs">
          {WORKSPACE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className="ws-tab" data-active={activeTab === tab.id} onClick={() => onTabChange(tab.id)}>
                <Icon size={13} />
                {tab.label}
                {tab.count ? <span className="ws-tab-count">{tab.count}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="ws-header-actions">
          <button className="ws-icon-btn" type="button" aria-label="Share workspace"><Share2 size={14} /></button>
          <button className="ws-icon-btn" type="button" aria-label="History"><Clock3 size={14} /></button>
          <button className="ws-icon-btn" type="button" aria-label="More"><MoreHorizontal size={15} /></button>
          <button className="ws-icon-btn" type="button" aria-label="Search"><Search size={14} /></button>
        </div>
      </header>
      <div className="ws-body" data-has-inspector={Boolean(inspector)}>
        <main className="ws-main">{children}</main>
        {inspector ? <aside className="ws-inspector">{inspector}</aside> : null}
      </div>
    </div>
  );
}

function WorkspacePill({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "ok" | "warn" | "indigo"; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function WorkspaceEntityChip({ name, code, type = "company" }: { name: string; code: string; type?: string }) {
  const colorClass = type === "market" ? "ent-chip-dot--amber" : type === "investor" ? "ent-chip-dot--purple" : type === "regulation" ? "ent-chip-dot--green" : "";
  return (
    <button type="button" className="ent-chip">
      <span className={`ent-chip-dot ${colorClass}`}>{code}</span>
      {name}
    </button>
  );
}

function WorkspaceCite({ n, onClick }: { n: number; onClick?: () => void }) {
  return (
    <button type="button" className="cite" onClick={onClick} aria-label={`Open source ${n}`}>
      {n}
    </button>
  );
}

function WorkspaceCompanyCard({
  entity,
  active = false,
  onClick,
}: {
  entity: (typeof WORKSPACE_ENTITIES_EXACT)[string];
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="cc" data-active={active} onClick={onClick}>
      <span className="cc-header">
        <span className="cc-avatar" style={{ background: entity.avatarBg }}>{entity.avatar}</span>
        <span className="cc-main">
          <span className="cc-title">{entity.name}</span>
          <span className="cc-subtitle">{entity.subtitle}</span>
        </span>
        <span className="cc-kicker">{entity.kicker}</span>
      </span>
      <span className="cc-metrics">
        {entity.metrics.map((metric) => (
          <span key={`${entity.id}-${metric.label}`} className="cc-metric">
            <span className="cc-metric-label">{metric.label}</span>
            <span className="cc-metric-val" data-trend={metric.trend}>{metric.value}</span>
          </span>
        ))}
      </span>
      {entity.footer ? <span className="cc-footer"><Clock3 size={10} /> {entity.footer}</span> : null}
    </button>
  );
}

function WorkspaceChatSurface({
  thread,
  setThread,
  onTabChange,
}: {
  thread: string;
  setThread: (thread: string) => void;
  onTabChange: (tab: WorkspaceTab) => void;
}) {
  const [composerText, setComposerText] = useState("");
  const [queryOverride, setQueryOverride] = useState<string | null>(null);
  const threadMeta = WORKSPACE_THREADS_EXACT.find((item) => item.id === thread) ?? WORKSPACE_THREADS_EXACT[0];
  const answer = WORKSPACE_ANSWERS_EXACT[thread] ?? WORKSPACE_ANSWERS_EXACT.t1;
  const query = queryOverride ?? threadMeta.query;
  const submit = (text: string) => {
    const next = text.trim();
    if (!next) return;
    setQueryOverride(next);
    setComposerText("");
  };

  return (
    <div className="chat-layout" data-composer="dock">
      <aside className="chat-history">
        <div className="chat-history-header">
          <span className="kicker">Threads</span>
          <button className="ws-icon-btn" type="button" aria-label="New thread" onClick={() => submit("Start a new exploration")}>
            <Plus size={12} />
          </button>
        </div>
        <div className="chat-history-list">
          {WORKSPACE_THREADS_EXACT.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chat-history-item"
              data-active={item.id === thread}
              onClick={() => {
                setThread(item.id);
                setQueryOverride(null);
              }}
            >
              <span className="chat-history-title">{item.title}</span>
              <span className="chat-history-meta">{item.meta}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-answer">
        <div className="chat-query">
          <div className="chat-query-user">HS</div>
          <div className="chat-query-text">{query}</div>
        </div>

        <div className="chat-runbar">
          <WorkspacePill tone="ok"><Check size={10} /> verified</WorkspacePill>
          <WorkspacePill tone="accent"><Sparkles size={10} /> 6 branches</WorkspacePill>
          <WorkspacePill>kimi-k2.6 - 174s - llm-judge 9.6</WorkspacePill>
          <span className="chat-run-actions">
            <button className="ws-icon-btn" type="button" aria-label="Save as report" onClick={() => onTabChange("brief")}><Save size={13} /></button>
            <button className="ws-icon-btn" type="button" aria-label="Watch entity"><Bell size={13} /></button>
          </span>
        </div>

        <article className="chat-body">
          <h1 className="chat-title">{answer.verdict}</h1>
          <p>
            <WorkspaceEntityChip name="DISCO" code="DI" /> closed a <strong>$100M Series C</strong> led by{" "}
            <WorkspaceEntityChip name="Greylock" code="G" type="investor" /> on Nov 14, 2025 <WorkspaceCite n={1} onClick={() => onTabChange("sources")} />,
            putting ARR growth above the 2.5x legal-tech median <WorkspaceCite n={2} onClick={() => onTabChange("sources")} />. The company serves <strong>2,400+ firms</strong>, including six of the{" "}
            <WorkspaceEntityChip name="AmLaw 10" code="A" type="market" /> <WorkspaceCite n={4} onClick={() => onTabChange("sources")} />.
          </p>
          <p>
            Two things to weigh before an intro: the <WorkspaceEntityChip name="EU AI Act" code="EU" type="regulation" /> integration tax over the next 6-9 months{" "}
            <WorkspaceCite n={3} onClick={() => onTabChange("sources")} />, and <WorkspaceEntityChip name="Everlaw" code="EV" /> lower-midmarket pricing pressure{" "}
            <WorkspaceCite n={7} onClick={() => onTabChange("sources")} />. Net: product velocity looks real; pricing discipline is the watch item.
          </p>

          <div className="chat-callout">
            <div className="chat-callout-head"><Target size={13} /> <span>Recommendation</span></div>
            <p>{answer.recommendation}</p>
          </div>
        </article>

        <div className="chat-strip">
          <div className="chat-strip-head">
            <span className="kicker">Top cards - 3 of 14</span>
            <button type="button" className="chat-strip-more" onClick={() => onTabChange("cards")}>Open all</button>
          </div>
          <div className="chat-strip-row">
            {answer.topCards.map((entityId, index) => {
              const entity = WORKSPACE_ENTITIES_EXACT[entityId];
              return entity ? <WorkspaceCompanyCard key={entityId} entity={entity} active={index === 0} onClick={() => onTabChange("cards")} /> : null;
            })}
          </div>
        </div>

        <div className="chat-sources">
          <div className="chat-strip-head">
            <span className="kicker">Sources - top {answer.topSourceIds.length} of 24</span>
            <button type="button" className="chat-strip-more" onClick={() => onTabChange("sources")}>View all</button>
          </div>
          <div className="chat-sources-list">
            {answer.topSourceIds.map((sourceId) => {
              const source = WORKSPACE_SOURCES_EXACT.find((item) => item.n === sourceId);
              if (!source) return null;
              return (
                <button key={source.n} type="button" className="chat-source-row" onClick={() => onTabChange("sources")}>
                  <span className="cite">{source.n}</span>
                  <span className="chat-source-title">{source.title}</span>
                  <span className="pill pill-neutral">{source.type}</span>
                  <span className="chat-source-meta">{source.domain}</span>
                  <span className="chat-source-meta">{source.date}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="chat-followups">
          <span className="kicker">Continue</span>
          {answer.followups.map((followup) => (
            <button key={followup} type="button" className="chat-followup" onClick={() => submit(followup)}>{followup}</button>
          ))}
        </div>
      </section>

      <div className="chat-composer chat-composer--dock">
        <div className="composer">
          <textarea
            className="composer-input"
            rows={1}
            value={composerText}
            placeholder="Compare DISCO to Everlaw on AmLaw 100 coverage and blended ARPU."
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(composerText || "Compare DISCO to Everlaw on AmLaw 100 coverage and blended ARPU.");
              }
            }}
          />
          <div className="composer-tools">
            <button type="button" className="composer-tool-btn"><Paperclip size={12} /> Attach</button>
            <button type="button" className="composer-tool-btn" data-active="true"><Globe2 size={12} /> Web</button>
            <button type="button" className="composer-tool-btn"><Sparkles size={12} /> Branches - 6</button>
            <button type="button" className="composer-tool-btn"><Layers size={12} /> Use report</button>
            <button type="button" className="composer-submit" aria-label="Send" onClick={() => submit(composerText || "Compare DISCO to Everlaw on AmLaw 100 coverage and blended ARPU.")}>
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceBriefSurface({ onJump }: { onJump: (tab: WorkspaceTab) => void }) {
  const [activeSection, setActiveSection] = useState("exec");
  const sections = [
    ["exec", "Executive summary"],
    ["what", "What happened"],
    ["so", "So what"],
    ["now", "Now what"],
    ["receipts", "Receipts"],
    ["timeline", "Timeline"],
    ["watch", "Watch conditions"],
  ];

  return (
    <div className="brief-layout">
      <aside className="brief-toc">
        <div className="kicker">Contents</div>
        <nav className="brief-toc-list" aria-label="Brief contents">
          {sections.map(([id, label]) => (
            <button key={id} type="button" className="brief-toc-item" data-active={activeSection === id} onClick={() => setActiveSection(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="brief-health">
          <div className="kicker">Report health</div>
          {[
            ["Freshness", "92%"],
            ["Source diversity", "78%"],
            ["Claim support", "100%"],
            ["Contradictions", "14%"],
          ].map(([label, width], index) => (
            <div key={label} className="brief-health-row">
              <span>{label}</span>
              <div className="brief-meter" data-warn={index === 3}><span style={{ width }} /></div>
            </div>
          ))}
        </div>
      </aside>

      <article className="brief-main">
        <header className="brief-header">
          <div className="kicker">Diligence - Series C opportunity</div>
          <h1 className="brief-title">DISCO - worth reaching out, with pricing as the watch item.</h1>
          <p className="brief-sub">A two-minute debrief for a banker evaluating outbound effort. Verdict and recommended next step lead; receipts, timeline, and watch conditions follow.</p>
          <div className="brief-meta">
            <WorkspacePill tone="ok"><Check size={10} /> verified</WorkspacePill>
            <WorkspacePill tone="accent">v3 - refreshed 2h ago</WorkspacePill>
            <WorkspacePill>24 sources - 6 branches</WorkspacePill>
            <WorkspacePill>llm-judge 9.6 / 10</WorkspacePill>
          </div>
        </header>

        <section className="brief-exec">
          <div className="brief-exec-verdict">
            <span className="kicker">Verdict</span>
            <h2>Reach out this quarter.</h2>
            <p>Lead with AmLaw traction and the Greylock signal; ask how they plan to absorb EU AI Act compliance load without raising effective price. If NRR holds above 120% through Q2, expand the conversation to platform partnership scope.</p>
          </div>
          <div className="brief-exec-stats">
            <WorkspaceBriefStat value="$100M" label="Series C - lead Greylock" trend="up" onClick={() => onJump("sources")} />
            <WorkspaceBriefStat value="2.8x" label="ARR growth" trend="up" />
            <WorkspaceBriefStat value="122%" label="Net revenue retention" trend="up" />
            <WorkspaceBriefStat value="6 of 10" label="AmLaw firms served" />
          </div>
        </section>

        <section className="brief-triad">
          <WorkspaceTriadCard kicker="What happened" title="Greylock-led Series C on Nov 14" body="$100M at a $900M post. Sarah Grayson joins the board. Announced alongside a customer count refresh." />
          <WorkspaceTriadCard kicker="So what" title="Above-median growth, platform positioning" body="Growth outperforms the 2.5x legal-tech median and the round signals platform-tier ambition rather than a narrow e-discovery wedge." />
          <WorkspaceTriadCard kicker="Now what" title="Move now; monitor pricing" body="Outbound this quarter. Re-run this report if NRR dips under 118% or blended pricing slips more than 6% QoQ." />
        </section>

        <section>
          <h3 className="brief-h3">Receipts</h3>
          <div className="brief-receipts">
            {[
              ["ARR", "$186M", "up", "Q3 IR filing"],
              ["ARR growth YoY", "2.8x", "up", "Mgmt. commentary"],
              ["Net revenue retention", "122%", "up", "Q3 IR filing"],
              ["Gross margin", "78%", "", "Q3 IR filing"],
              ["Runway at Series C", "38 mo", "", "Press release"],
              ["Rev multiple post", "14.2x", "", "Implied post"],
              ["AmLaw 10 penetration", "6 / 10", "", "Customer list"],
              ["Top customer concentration", "11%", "down", "IR filing"],
            ].map(([label, value, trend, source]) => (
              <button key={label} type="button" className="brief-receipt" onClick={() => onJump("sources")}>
                <span className="brief-receipt-label">{label}</span>
                <span className="brief-receipt-val" data-trend={trend || undefined}>{value}</span>
                <span className="brief-receipt-src">{source}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="brief-h3">Timeline</h3>
          <div className="brief-timeline">
            {[
              ["Nov 14 2025", "Series C closed", "Greylock leads, $100M at $900M post", true],
              ["Sep 30 2025", "Q3 IR filing", "ARR $186M, NRR 122%, GM 78%", false],
              ["Jul 12 2025", "Major product release", "Cecilia 3 - agentic review", false],
              ["Feb 01 2026", "EU AI Act GPAI rules", "Enforcement begins; integration tax 6-9 mo", false],
              ["Mar 2026", "Everlaw pricing cut", "-18% on midmarket tiers", false],
            ].map(([date, title, meta, accent]) => (
              <div key={`${date}-${title}`} className="brief-event">
                <div className={`brief-event-dot ${accent ? "is-accent" : ""}`} />
                <div className="brief-event-date">{date}</div>
                <div className="brief-event-body">
                  <div className="brief-event-title">{title}</div>
                  <div className="brief-event-meta">{meta}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="brief-h3">Watch conditions</h3>
          <div className="brief-nudges">
            {["NRR drops below 118%", "Blended pricing falls more than 6% QoQ", "Greylock board exits"].map((item) => (
              <div key={item} className="brief-nudge">
                <span className="brief-nudge-dot" />
                <div>
                  <div className="brief-nudge-title">{item}</div>
                  <div className="brief-nudge-meta">monitor - web ops</div>
                </div>
                <button className="ws-icon-btn" type="button" aria-label={`Watch ${item}`}><Bell size={13} /></button>
              </div>
            ))}
          </div>
        </section>

        <footer className="brief-footer">
          <div className="kicker">Run - hs-7e3a</div>
          <div className="brief-footer-meta">kimi-k2.6 - p95 174s - verified Apr 23, 2026</div>
        </footer>
      </article>
    </div>
  );
}

function WorkspaceBriefStat({ value, label, trend, onClick }: { value: string; label: string; trend?: "up" | "down"; onClick?: () => void }) {
  return (
    <button type="button" className="brief-stat" onClick={onClick}>
      <span className="brief-stat-val" data-trend={trend}>{value}</span>
      <span className="brief-stat-label">{label}</span>
    </button>
  );
}

function WorkspaceTriadCard({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="brief-triad-card">
      <div className="kicker">{kicker}</div>
      <div className="brief-triad-title">{title}</div>
      <p className="brief-triad-body">{body}</p>
    </div>
  );
}

function WorkspaceCardsSurface({
  rootId,
  setRootId,
  selectedCard,
  setSelectedCard,
}: {
  rootId: string;
  setRootId: (id: string) => void;
  selectedCard: string | null;
  setSelectedCard: (id: string | null) => void;
}) {
  const root = WORKSPACE_ENTITIES_EXACT[rootId] ?? WORKSPACE_ENTITIES_EXACT.disco;
  const relatedIds = WORKSPACE_RELATIONS_EXACT[root.id] ?? [];
  const drill = selectedCard ? WORKSPACE_ENTITIES_EXACT[selectedCard] : null;
  const drillIds = drill ? WORKSPACE_RELATIONS_EXACT[drill.id] ?? [] : [];

  return (
    <div className="cards-layout">
      <div className="cards-breadcrumb">
        <button type="button" className="cards-crumb" onClick={() => setRootId("disco")}>
          <span className="cards-crumb-kicker">root</span>
          <span>DISCO</span>
        </button>
        {root.id !== "disco" ? (
          <>
            <ChevronRight size={11} />
            <button type="button" className="cards-crumb" onClick={() => setRootId(root.id)}>
              <span className="cards-crumb-kicker">{root.kicker}</span>
              <span>{root.name}</span>
            </button>
          </>
        ) : null}
        <span className="cards-actions">
          <button className="ws-icon-btn" type="button" aria-label="Reset cards" onClick={() => { setRootId("disco"); setSelectedCard(null); }}><RefreshCw size={13} /></button>
          <button className="ws-icon-btn" type="button" aria-label="Filter cards"><Filter size={13} /></button>
        </span>
      </div>

      <div className="cards-columns">
        <WorkspaceCardColumn title="Root" subtitle="1 card">
          <WorkspaceCompanyCard entity={root} active />
        </WorkspaceCardColumn>
        <WorkspaceCardColumn title="Related" subtitle={`${relatedIds.length} - from graph`}>
          {relatedIds.map((entityId) => {
            const entity = WORKSPACE_ENTITIES_EXACT[entityId];
            return entity ? (
              <WorkspaceCompanyCard key={entityId} entity={entity} active={selectedCard === entityId} onClick={() => setSelectedCard(entityId)} />
            ) : null;
          })}
        </WorkspaceCardColumn>
        <WorkspaceCardColumn title={drill ? `Drilldown - ${drill.name}` : "Drilldown"} subtitle={drill ? `${drillIds.length} - one hop deeper` : "select a card"}>
          {!drill ? <div className="cards-blank">Click a related card to drill in</div> : null}
          {drillIds.map((entityId) => {
            const entity = WORKSPACE_ENTITIES_EXACT[entityId];
            return entity ? <WorkspaceCompanyCard key={entityId} entity={entity} onClick={() => { setRootId(entityId); setSelectedCard(null); }} /> : null;
          })}
          {drill ? (
            <button type="button" className="cards-blank" onClick={() => { setRootId(drill.id); setSelectedCard(null); }}>
              <Plus size={14} /> Make {drill.name} the root
            </button>
          ) : null}
        </WorkspaceCardColumn>
      </div>
    </div>
  );
}

function WorkspaceCardColumn({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="cards-col">
      <div className="cards-col-head">
        <div className="kicker">{title}</div>
        <div className="cards-col-sub">{subtitle}</div>
      </div>
      <div className="cards-col-body">{children}</div>
    </section>
  );
}

function WorkspaceCardInspector({ cardId, onClose, onDrill }: { cardId: string; onClose: () => void; onDrill: (id: string) => void }) {
  const entity = WORKSPACE_ENTITIES_EXACT[cardId];
  if (!entity) return null;
  return (
    <>
      <div className="ws-inspector-header">
        <div>
          <div className="ws-inspector-kicker">{entity.kicker}</div>
          <h3 className="ws-inspector-title">{entity.name}</h3>
        </div>
        <button className="ws-icon-btn" type="button" aria-label="Close inspector" onClick={onClose}><X size={12} /></button>
      </div>
      <div className="ws-inspector-body">
        <section className="ws-insp-section">
          <h4>At a glance</h4>
          <div className="ws-insp-metrics">
            {entity.metrics.map((metric) => (
              <div key={metric.label} className="cc-metric">
                <span className="cc-metric-label">{metric.label}</span>
                <span className="cc-metric-val" data-trend={metric.trend}>{metric.value}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="ws-insp-section">
          <h4>Position vs root</h4>
          <p>{entity.subtitle}. Connected to the DISCO thesis via market overlap, source citations, and the investor graph.</p>
        </section>
        <section className="ws-insp-section">
          <h4>Actions</h4>
          <button type="button" className="composer-tool-btn" onClick={() => onDrill(entity.id)}><Layers size={12} /> Drill into {entity.name}</button>
          <button type="button" className="composer-tool-btn"><Bell size={12} /> Watch for changes</button>
          <button type="button" className="composer-tool-btn"><BookOpen size={12} /> Pin to Notebook</button>
        </section>
      </div>
    </>
  );
}

function WorkspaceNotebookSurface() {
  return (
    <div className="nb-layout" data-width="wide">
      <aside className="nb-block-gutter">
        <div className="nb-handle-row">
          <button type="button" className="nb-handle nb-handle-plus">+</button>
          <button type="button" className="nb-handle">::</button>
          <button type="button" className="nb-handle">::</button>
        </div>
      </aside>
      <article className="nb-doc">
        <header className="nb-doc-head">
          <div className="nb-crumbs">Workspace / DISCO diligence / Notebook</div>
          <h1 className="nb-title">DISCO diligence notebook</h1>
          <div className="nb-title-meta">
            <span className="nb-save-state"><span className="nb-save-dot" /> Saved 4s ago</span>
            <WorkspacePill tone="ok"><Check size={10} /> 12 linked claims</WorkspacePill>
            <WorkspacePill>24 sources</WorkspacePill>
          </div>
        </header>
        <RichNotebookEditor
          initialContent={`<h2>Investment memo spine</h2><p>DISCO looks worth reaching out to this quarter. The evidence stack is strongest around ARR growth, AmLaw penetration, and Greylock board support.</p><p>The open issue is pricing discipline. Everlaw pressure and EU AI Act compliance work can change the effective price even if headline ARR remains strong.</p>`}
          storageKey="nodebench.workspace.disco.exact-kit"
          testId="workspace-notebook-editor"
          className="nb-rich-editor"
          editorClassName="font-serif"
        />
        <div className="nb-claim">
          <div className="nb-claim-head"><ShieldCheck size={13} /> Claim block <span className="nb-claim-status"><WorkspacePill tone="ok">verified</WorkspacePill></span></div>
          <div className="nb-claim-body">DISCO is above the legal-tech median on ARR growth and has credible top-of-market penetration.</div>
          <div className="nb-claim-evidence">
            <span className="nb-claim-ev"><WorkspaceCite n={2} /> Legal tech market overview 2025</span>
            <span className="nb-claim-ev"><WorkspaceCite n={4} /> DISCO Q3 2025 IR filing</span>
          </div>
        </div>
      </article>
    </div>
  );
}

function WorkspaceSourcesSurface({
  filter,
  setFilter,
  expandedClaim,
  setExpandedClaim,
}: {
  filter: string;
  setFilter: (filter: string) => void;
  expandedClaim: string | null;
  setExpandedClaim: (claim: string | null) => void;
}) {
  const types = ["all", "filing", "press", "analyst", "reg", "pr"];
  const visibleSources = filter === "all" ? WORKSPACE_SOURCES_EXACT : WORKSPACE_SOURCES_EXACT.filter((source) => source.type === filter);

  return (
    <div className="sources-layout">
      <div className="sources-header">
        <div>
          <div className="kicker">Sources</div>
          <h2 className="sources-title">{WORKSPACE_SOURCES_EXACT.length} cited - {WORKSPACE_CLAIMS_EXACT.length} claims - 1 conflict</h2>
        </div>
        <div className="sources-filters">
          {types.map((type) => (
            <button key={type} type="button" className="sources-filter" data-active={filter === type} onClick={() => setFilter(type)}>
              {type}
            </button>
          ))}
          <span className="sources-sep" />
          <button type="button" className="composer-tool-btn"><Filter size={12} /> fresh &lt; 30d</button>
          <button type="button" className="composer-tool-btn"><Filter size={12} /> trust &gt;= 0.8</button>
        </div>
      </div>

      <section className="sources-section">
        <div className="kicker">Claims</div>
        <div className="sources-claims">
          {WORKSPACE_CLAIMS_EXACT.map((claim) => (
            <button
              key={claim.id}
              type="button"
              className="sources-claim"
              data-expanded={expandedClaim === claim.id}
              onClick={() => setExpandedClaim(expandedClaim === claim.id ? null : claim.id)}
            >
              <span className="sources-claim-text">{claim.q}</span>
              <span className="sources-claim-support">
                <WorkspacePill tone="ok"><Check size={10} /> {claim.support.length} support</WorkspacePill>
                {claim.contra.length ? <WorkspacePill tone="warn">{claim.contra.length} conflict</WorkspacePill> : null}
                <span className="sources-claim-toggle">{expandedClaim === claim.id ? "hide evidence" : "show evidence"}</span>
              </span>
              {expandedClaim === claim.id ? (
                <span className="sources-claim-refs">
                  {[...claim.support, ...claim.contra].map((sourceId) => {
                    const source = WORKSPACE_SOURCES_EXACT.find((item) => item.n === sourceId);
                    return source ? <span key={`${claim.id}-${sourceId}`} className="sources-domain">{source.domain}</span> : null;
                  })}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section className="sources-section">
        <div className="sources-table">
          <div className="sources-table-head">
            <span>#</span><span>Source</span><span>Type</span><span>Cites</span><span>Trust</span><span>Date</span>
          </div>
          {visibleSources.map((source) => (
            <button key={source.n} type="button" className="sources-row">
              <span className="cite">{source.n}</span>
              <span className="sources-row-title"><span className="sources-row-name">{source.title}</span><span className="sources-row-domain">{source.domain}</span></span>
              <span>{source.type}</span>
              <span>{source.cites}</span>
              <span className="sources-trust"><span style={{ width: `${Math.round(source.weight * 100)}%` }} /></span>
              <span>{source.date}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkspaceMapSurface({ onTabChange }: { onTabChange: (tab: WorkspaceTab) => void }) {
  return (
    <div className="map-layout">
      <section className="map-canvas">
        <div className="map-toolbar">
          <div className="map-toolbar-l">
            <span className="kicker">Entity map</span>
            <div className="map-kind-filter">
              {["company", "market", "person", "source"].map((kind) => (
                <button key={kind} type="button" className="map-kind-btn" data-active={kind === "company"}>
                  <span className="map-kind-dot" /> {kind}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="map-recenter"><RefreshCw size={12} /> Recenter</button>
        </div>
        <div className="map-svg-wrap">
          <svg className="map-svg" viewBox="0 0 900 560" role="img" aria-label="DISCO workspace relationship map">
            <rect width="900" height="560" fill="#faf8f5" />
            <circle cx="450" cy="280" r="210" fill="rgba(217,119,87,.08)" />
            <circle cx="450" cy="280" r="130" fill="none" stroke="rgba(217,119,87,.18)" />
            <WorkspaceMapEdge x1={450} y1={280} x2={260} y2={170} label="market" />
            <WorkspaceMapEdge x1={450} y1={280} x2={650} y2={160} label="lead" />
            <WorkspaceMapEdge x1={450} y1={280} x2={240} y2={390} label="pressure" />
            <WorkspaceMapEdge x1={450} y1={280} x2={680} y2={385} label="reg" />
            <WorkspaceMapNode x={450} y={280} entity={WORKSPACE_ENTITIES_EXACT.disco} large />
            <WorkspaceMapNode x={260} y={170} entity={WORKSPACE_ENTITIES_EXACT["legal-tech"]} />
            <WorkspaceMapNode x={650} y={160} entity={WORKSPACE_ENTITIES_EXACT.greylock} />
            <WorkspaceMapNode x={240} y={390} entity={WORKSPACE_ENTITIES_EXACT.everlaw} />
            <WorkspaceMapNode x={680} y={385} entity={WORKSPACE_ENTITIES_EXACT["eu-ai-act"]} />
            <WorkspaceMapNode x={465} y={92} entity={WORKSPACE_ENTITIES_EXACT["kiwi-camara"]} />
          </svg>
        </div>
        <div className="map-help"><span><kbd>click</kbd> inspect</span><span><kbd>shift</kbd> promote to root</span><span><kbd>tab</kbd> jump surfaces</span></div>
      </section>
      <aside className="map-panel">
        <div className="map-panel-head">
          <span className="map-panel-avatar">DI</span>
          <div><div className="map-panel-name">DISCO</div><div className="map-panel-sub">root company - 14 connected cards</div></div>
        </div>
        <div className="map-panel-metrics">
          {WORKSPACE_ENTITIES_EXACT.disco.metrics.map((metric) => (
            <div key={metric.label} className="map-panel-metric">
              <span className="map-panel-metric-l">{metric.label}</span>
              <span className="map-panel-metric-v" data-trend={metric.trend}>{metric.value}</span>
            </div>
          ))}
        </div>
        <section className="map-panel-section">
          <div className="kicker">Connected cards</div>
          <div className="map-panel-list">
            {WORKSPACE_RELATIONS_EXACT.disco.map((entityId) => {
              const entity = WORKSPACE_ENTITIES_EXACT[entityId];
              return (
                <button key={entityId} type="button" className="map-panel-row" onClick={() => onTabChange("cards")}>
                  <span className="map-panel-row-avatar" style={{ background: entity.avatarBg }}>{entity.avatar}</span>
                  <span className="map-panel-row-mid"><span className="map-panel-row-name">{entity.name}</span><span className="map-panel-row-rel">{entity.kicker}</span></span>
                  <ChevronRight size={13} />
                </button>
              );
            })}
          </div>
        </section>
      </aside>
    </div>
  );
}

function WorkspaceMapEdge({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label: string }) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d97757" strokeWidth={1.7} />
      <rect x={midX - 34} y={midY - 9} width={68} height={18} rx={9} fill="#faf8f5" stroke="#d7d0c8" />
      <text x={midX} y={midY + 3} textAnchor="middle" fontSize={10} fontWeight={800} fill="#6b7280">{label}</text>
    </g>
  );
}

function WorkspaceMapNode({ x, y, entity, large = false }: { x: number; y: number; entity: (typeof WORKSPACE_ENTITIES_EXACT)[string]; large?: boolean }) {
  const radius = large ? 42 : 32;
  return (
    <g style={{ cursor: "pointer" }}>
      <circle cx={x} cy={y} r={radius + 4} fill="rgba(255,255,255,.78)" stroke="rgba(15,23,42,.08)" />
      <circle cx={x} cy={y} r={radius} fill={entity.avatarBg.includes("gradient") ? "#1a365d" : entity.avatarBg} />
      <text x={x} y={y - 2} textAnchor="middle" fontSize={large ? 12 : 11} fontWeight={800} fill="#fffaf0">
        {entity.avatar}
      </text>
      <text x={x} y={y + radius + 18} textAnchor="middle" fontSize={12} fontWeight={800} fill="#111827">{entity.name}</text>
      <text x={x} y={y + radius + 33} textAnchor="middle" fontSize={10} fill="#6b7280">{entity.kind}</text>
    </g>
  );
}

export function ExactMcpTerminalPage() {
  const copyCommand = "claude mcp add nodebench -- npx -y nodebench-mcp";
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(copyCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="nb-kit" style={{ minHeight: "100dvh", background: "#09090b", color: "#e5e7eb" }}>
      <div className="nb-shell">
        <a href="/" style={{ color: "#9ca3af", textDecoration: "none", fontSize: 13 }}>{"<- Back to NodeBench"}</a>
        <div style={{ marginTop: 28, display: "grid", gap: 18, gridTemplateColumns: "minmax(0,1.1fr) minmax(320px,.9fr)" }}>
          <section>
            <div className="nb-kicker" style={{ color: "#d97757" }}>CLI / MCP</div>
            <h1 style={{ margin: "8px 0", color: "#fff", fontSize: 42, lineHeight: 1.05, letterSpacing: "-.04em" }}>Bring NodeBench into Claude, Cursor, and agent workflows.</h1>
            <p style={{ color: "#a1a1aa", fontSize: 16, lineHeight: 1.7, maxWidth: 620 }}>The CLI/MCP kit is the distribution lane: plan, streamed checkpoints, answer packet, resource URIs, verification summary, and saved workspace links.</p>
            <button className="nb-btn nb-btn-primary" type="button" onClick={copy} style={{ marginTop: 18 }}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy install command"}
            </button>
          </section>
          <TerminalCard title="~/diligence - zsh - 120x32" badge="core lane">
            <TerminalLine>homen@mac &gt; claude mcp add nodebench -- npx -y nodebench-mcp</TerminalLine>
            <TerminalLine tone="ok">registered with Claude Code - nodebench-mcp</TerminalLine>
            <TerminalLine tone="ok">loaded tools - nodebench.research_run, nodebench.expand_resource</TerminalLine>
            <TerminalDivider />
            <TerminalLine>agent &gt; nodebench.research_run({"{"} objective: "Fast debrief on DISCO" {"}"})</TerminalLine>
            <TerminalLine tone="accent">plan - resolve entity, search, synthesize, verify</TerminalLine>
            <TerminalLine tone="ok">24 sources captured - answer packet streaming</TerminalLine>
            <div style={{ border: "1px solid rgba(217,119,87,.26)", borderRadius: 8, background: "rgba(217,119,87,.10)", padding: 12, color: "#f8fafc", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.7 }}>
              Worth reaching out. Save the report, verify the claim, then open Workspace for cards and sources.
            </div>
            <TerminalLine tone="ok">verified - saved report URI nodebench://report/disco-diligence</TerminalLine>
          </TerminalCard>
        </div>
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
          {["nodebench.research_run", "nodebench.expand_resource"].map((tool) => (
            <section key={tool} style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "rgba(255,255,255,.03)", padding: 18 }}>
              <div style={{ color: "#e59579", fontFamily: "var(--font-mono)", fontSize: 13 }}>{tool}</div>
              <p style={{ color: "#a1a1aa", fontSize: 13, lineHeight: 1.7 }}>Outputs plan, checkpoints, answer packet, resource URIs, verification summary, and saved report link.</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function TerminalCard({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return (
    <section style={{ overflow: "hidden", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "#0f1115", boxShadow: "0 24px 60px rgba(0,0,0,.32)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(255,255,255,.06)", background: "#171b22", padding: "12px 14px" }}>
        <span style={{ display: "flex", gap: 5 }}><i style={dot("#ff605c")} /><i style={dot("#ffbd44")} /><i style={dot("#00ca4e")} /></span>
        <span style={{ border: "1px solid rgba(255,255,255,.06)", borderRadius: 5, background: "rgba(255,255,255,.04)", color: "#e5e7eb", padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 11 }}>{title}</span>
        <span style={{ marginLeft: "auto", border: "1px solid rgba(217,119,87,.3)", borderRadius: 5, background: "rgba(217,119,87,.10)", color: "#e59579", padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase" }}>{badge}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 16 }}>{children}</div>
    </section>
  );
}

function TerminalLine({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "ok" }) {
  const color = tone === "ok" ? "#86efac" : tone === "accent" ? "#e59579" : "#cbd5e1";
  return <div style={{ color, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.8 }}>{children}</div>;
}

function TerminalDivider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "6px 0" }} />;
}

function dot(background: string): CSSProperties {
  return { display: "inline-block", width: 10, height: 10, borderRadius: 999, background };
}
