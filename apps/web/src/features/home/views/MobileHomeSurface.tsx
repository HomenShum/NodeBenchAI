/**
 * MobileHomeSurface — port of
 * docs/design/nodebench-ai-design-system/ui_kits/nodebench-mobile/MobileHome.jsx
 *
 * Mobile-only home greeting + watchlist + nudges + recent threads.
 * Rendered above the desktop HomeLanding via a `md:hidden` wrapper so the
 * desktop composer-first experience is untouched.
 *
 * Uses fixture data matching the DISCO scenario from the design kit's
 * `data.jsx`. Replace the fixture with live queries once the user's
 * watchlist + nudges + thread history are wired through Convex.
 */
import { useNavigate } from "react-router-dom";
import { Bell, ChevronRight, FileText, Link2, MessageSquare, Search, UserPlus, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";

type Trend = "up" | "down";

interface WatchlistTile {
  id: string;
  name: string;
  initials: string;
  ticker: string;
  value: string;
  trend: Trend;
  delta: string;
  meta: string;
  avatarGradient: string;
}

interface NudgeItem {
  id: string;
  title: string;
  meta: string[];
  kind: "source" | "claim" | "entity";
  icon: LucideIcon;
}

interface ThreadItem {
  id: string;
  title: string;
  meta: string;
}

// ---------------------------------------------------------------------------
// Fixture (mirrors design-kit data.jsx DISCO scenario)
// ---------------------------------------------------------------------------

const USER_FIRST_NAME = "Homen";

const WATCHLIST: WatchlistTile[] = [
  {
    id: "disco",
    name: "Disco Corp.",
    initials: "DC",
    ticker: "DC",
    value: "$418M",
    trend: "up",
    delta: "+3.4%",
    meta: "ARR \u00b7 signal fresh 4h",
    avatarGradient: "linear-gradient(135deg, #1A365D, #0F4C81)",
  },
  {
    id: "relay",
    name: "Relay Legal",
    initials: "RL",
    ticker: "RLY",
    value: "$212M",
    trend: "up",
    delta: "+1.8%",
    meta: "Series D \u00b7 closed",
    avatarGradient: "linear-gradient(135deg, #6B3BA3, #8B5CC1)",
  },
  {
    id: "lexn",
    name: "LexNode",
    initials: "LX",
    ticker: "LXN",
    value: "$84M",
    trend: "down",
    delta: "-5.1%",
    meta: "Signal stale 2d",
    avatarGradient: "linear-gradient(135deg, #C77826, #E09149)",
  },
  {
    id: "clio",
    name: "Clio",
    initials: "CL",
    ticker: "CLO",
    value: "$1.2B",
    trend: "up",
    delta: "+0.6%",
    meta: "Market leader",
    avatarGradient: "linear-gradient(135deg, #334155, #475569)",
  },
];

const NUDGES: NudgeItem[] = [
  {
    id: "n1",
    title: "New 10-K filed by Disco Corp.",
    meta: ["SEC EDGAR", "15 min ago"],
    kind: "source",
    icon: FileText,
  },
  {
    id: "n2",
    title: "Churn claim: evidence now contradicts prior brief",
    meta: ["Workspace \u00b7 Disco", "1h"],
    kind: "claim",
    icon: AlertTriangle,
  },
  {
    id: "n3",
    title: "Relay Legal added Eduardo Martinez as GM Americas",
    meta: ["LinkedIn", "3h"],
    kind: "entity",
    icon: UserPlus,
  },
  {
    id: "n4",
    title: "Gartner refreshed eDiscovery Magic Quadrant",
    meta: ["Gartner", "Today"],
    kind: "source",
    icon: FileText,
  },
];

const THREADS: ThreadItem[] = [
  { id: "t1", title: "What's the state of Disco's churn?", meta: "2m \u00b7 14 sources" },
  { id: "t2", title: "Map the eDiscovery 2025 landscape", meta: "yesterday \u00b7 38 sources" },
  { id: "t3", title: "Who's winning NAM mid-market?", meta: "3d \u00b7 21 sources" },
  { id: "t4", title: "Pricing pages across top 8 vendors", meta: "1w \u00b7 42 sources" },
];

// ---------------------------------------------------------------------------

export function MobileHomeSurface() {
  const navigate = useNavigate();
  const { open } = useFastAgent();

  const openChat = (prefill?: string) => {
    if (prefill) {
      navigate(`/?prompt=${encodeURIComponent(prefill)}`);
    } else {
      open({});
    }
  };

  return (
    <div
      data-testid="mobile-home-surface"
      className="md:hidden flex min-h-[calc(100vh-56px)] flex-col gap-5 bg-[var(--bg-app,#fafafa)] px-4 pb-6 pt-4 text-[var(--fg-1,#111827)] dark:bg-[#0b0b0e] dark:text-white"
    >
      {/* Header — brand + entity breadcrumb + bell */}
      <header className="flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold tracking-tight">
            Node<em className="not-italic text-[#d97757]">Bench</em>
          </span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Disco Corp. · workspace
          </span>
        </div>
        <button
          type="button"
          aria-label="Notifications"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-400"
        >
          <Bell size={15} />
        </button>
      </header>

      {/* Greeting */}
      <section>
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em]">
          Good morning, {USER_FIRST_NAME}.
        </h2>
        <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
          Four signals on your watchlist this morning.
        </p>
      </section>

      {/* Tap-to-chat search */}
      <button
        type="button"
        onClick={() => openChat()}
        className="flex items-center gap-2 rounded-[14px] border border-gray-200 bg-white px-3 py-3 text-left text-[13px] shadow-sm transition active:scale-[0.99] dark:border-white/[0.08] dark:bg-white/[0.02]"
      >
        <Search size={15} className="text-gray-400" aria-hidden />
        <span className="flex-1 text-gray-400">
          Ask NodeBench about any company…
        </span>
        <kbd className="rounded border border-gray-200 bg-[#f5f4f1] px-1.5 py-[1px] font-mono text-[10px] text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-400">
          ⌘K
        </kbd>
      </button>

      <section className="rounded-[12px] border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d97757]/10 text-[#d97757]">
            <Link2 size={13} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-gray-600 dark:text-gray-300">
              Research first — <button
              type="button"
              onClick={() => navigate("/settings?tab=connections")}
              className="font-semibold text-[#d97757]"
            >link when ready
            </button>
          </div>
        </div>
        </div>
      </section>

      {/* Watchlist */}
      <section>
        <header className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
            Watchlist
          </span>
          <button
            type="button"
            className="text-[12px] font-medium text-[#d97757] transition hover:underline"
            onClick={() => navigate("/reports")}
          >
            Manage
          </button>
        </header>
        <div className="grid grid-cols-2 gap-2">
          {WATCHLIST.map((tile) => (
            <WatchlistCard
              key={tile.id}
              tile={tile}
              onClick={() => navigate(`/reports/${tile.id}/graph?tab=brief`)}
            />
          ))}
        </div>
      </section>

      {/* Nudges */}
      <section>
        <header className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
            Since you were last here
          </span>
          <button
            type="button"
            onClick={() => navigate("/?surface=inbox")}
            className="text-[12px] font-medium text-[#d97757] transition hover:underline"
          >
            All {NUDGES.length}
          </button>
        </header>
        <div className="flex flex-col gap-1.5">
          {NUDGES.map((n) => (
            <NudgeRow
              key={n.id}
              item={n}
              onClick={() => navigate("/?surface=inbox")}
            />
          ))}
        </div>
      </section>

      {/* Recent threads */}
      <section>
        <header className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
            Recent threads
          </span>
          <button
            type="button"
            onClick={() => navigate("/?surface=chat")}
            className="text-[12px] font-medium text-[#d97757] transition hover:underline"
          >
            View all
          </button>
        </header>
        <div className="flex flex-col gap-1.5">
          {THREADS.map((t) => (
            <ThreadRow
              key={t.id}
              item={t}
              onClick={() => openChat(t.title)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WatchlistCard({
  tile,
  onClick,
}: {
  tile: WatchlistTile;
  onClick: () => void;
}) {
  const trendColor =
    tile.trend === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1.5 rounded-[14px] border border-gray-200 bg-white p-3 text-left transition active:scale-[0.98] dark:border-white/[0.08] dark:bg-white/[0.02]"
    >
      <div className="flex w-full items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-semibold text-white"
          style={{ background: tile.avatarGradient }}
          aria-hidden
        >
          {tile.initials}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {tile.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
          {tile.ticker}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <strong className="text-[15px] font-semibold tracking-tight">{tile.value}</strong>
        <span className={`text-[11px] font-medium ${trendColor}`}>{tile.delta}</span>
      </div>
      <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
        {tile.meta}
      </div>
    </button>
  );
}

function NudgeRow({
  item,
  onClick,
}: {
  item: NudgeItem;
  onClick: () => void;
}) {
  const kindBg = {
    source: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300",
    claim: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    entity: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
  }[item.kind];
  const IconCmp = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-2.5 rounded-[12px] border border-gray-200 bg-white px-3 py-2.5 text-left transition active:scale-[0.99] dark:border-white/[0.08] dark:bg-white/[0.02]"
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${kindBg}`}
      >
        <IconCmp size={13} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium leading-tight">
          {item.title}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
          {item.meta.map((m, i) => (
            <span key={i} className="truncate">
              {i > 0 && <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>}
              {m}
            </span>
          ))}
        </span>
      </span>
      <ChevronRight size={14} className="mt-1 shrink-0 text-gray-300 dark:text-gray-600" />
    </button>
  );
}

function ThreadRow({
  item,
  onClick,
}: {
  item: ThreadItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-[12px] border border-gray-200 bg-white px-3 py-2.5 text-left transition active:scale-[0.99] dark:border-white/[0.08] dark:bg-white/[0.02]"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d97757]/10 text-[#d97757]">
        <MessageSquare size={13} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium">{item.title}</span>
        <span className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {item.meta}
        </span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-gray-300 dark:text-gray-600" />
    </button>
  );
}

export default MobileHomeSurface;
