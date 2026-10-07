/**
 * MobileInboxSurface — port of
 * docs/design/nodebench-ai-design-system/ui_kits/nodebench-mobile/MobileInbox.jsx
 *
 * Unified attention feed: mentions, signals, tasks. Filter chips update
 * the list + show per-kind counts. Rows tap-open; archive swipe is a
 * tap target in this port.
 *
 * Mount: wraps the desktop NudgesHome via `md:hidden` / `hidden md:block`
 * split in the parent surface render.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, CheckCircle2, Filter, Settings } from "lucide-react";

type InboxKind = "mention" | "signal" | "task";

interface InboxItem {
  id: string;
  kind: InboxKind;
  actor: { initials: string; avatar: string };
  entity: string;
  meta: string;
  title: string;
  body: string;
  unread: boolean;
}

interface InboxSection {
  id: string;
  label: string;
  items: InboxItem[];
}

// ---------------------------------------------------------------------------
// Fixture (mirrors design-kit DISCO inbox scenario)
// ---------------------------------------------------------------------------

const SECTIONS: InboxSection[] = [
  {
    id: "today",
    label: "Today",
    items: [
      {
        id: "i1",
        kind: "mention",
        actor: { initials: "SG", avatar: "linear-gradient(135deg,#6B3BA3,#8B5CC1)" },
        entity: "Disco diligence",
        meta: "8m",
        title: "@ Mention · Sarah mentioned you",
        body: "Can you verify the Am Law 200 cohort claim? We're citing this in the board read tomorrow.",
        unread: true,
      },
      {
        id: "i2",
        kind: "signal",
        actor: { initials: "DC", avatar: "linear-gradient(135deg,#1A365D,#0F4C81)" },
        entity: "Disco Corp.",
        meta: "1h",
        title: "Q1 earnings moved to May 9 (from May 12)",
        body: "Watchlist alert · calendar update may affect your \"Churn next quarter\" thread.",
        unread: true,
      },
      {
        id: "i3",
        kind: "task",
        actor: { initials: "HS", avatar: "linear-gradient(135deg,#334155,#475569)" },
        entity: "Due today · Due 5:00 PM",
        meta: "due 5pm",
        title: "Reply to Kiwi Camara outreach draft",
        body: "Draft is ready — needs your tone pass before 5pm ET.",
        unread: true,
      },
      {
        id: "i4",
        kind: "signal",
        actor: { initials: "GL", avatar: "linear-gradient(135deg,#0E7A5C,#0B6A50)" },
        entity: "Greylock · 3h",
        meta: "3h",
        title: "New fund announced — $1.2B Fund XVII",
        body: "Public filing · could change the competitive-capital picture for your Legal Tech deck.",
        unread: false,
      },
    ],
  },
  {
    id: "this-week",
    label: "This week",
    items: [
      {
        id: "i5",
        kind: "mention",
        actor: { initials: "AM", avatar: "linear-gradient(135deg,#C77826,#E09149)" },
        entity: "NRR narrative memo",
        meta: "yesterday",
        title: "@ Mention · Alan asked for a source",
        body: "Can you pull the underlying 10-K page for the NRR expansion claim?",
        unread: false,
      },
      {
        id: "i6",
        kind: "task",
        actor: { initials: "HS", avatar: "linear-gradient(135deg,#334155,#475569)" },
        entity: "Due Friday",
        meta: "2d",
        title: "Review pricing-sensitivity pull",
        body: "Workspace · competitive pricing scrape needs your sign-off before publishing.",
        unread: false,
      },
    ],
  },
];

const KIND_STYLE: Record<InboxKind, { label: string; cls: string }> = {
  mention: {
    label: "@ Mention",
    cls: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  },
  signal: {
    label: "Signal",
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  task: {
    label: "Task",
    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
};

type FilterId = "all" | "mentions" | "signals" | "tasks";

// ---------------------------------------------------------------------------

export function MobileInboxSurface() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterId>("all");
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [read, setRead] = useState<Set<string>>(new Set());

  const allItems = useMemo(
    () => SECTIONS.flatMap((s) => s.items),
    [],
  );

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = { all: 0, mentions: 0, signals: 0, tasks: 0 };
    for (const item of allItems) {
      if (archived.has(item.id)) continue;
      c.all += 1;
      if (item.kind === "mention") c.mentions += 1;
      if (item.kind === "signal") c.signals += 1;
      if (item.kind === "task") c.tasks += 1;
    }
    return c;
  }, [allItems, archived]);

  const unreadCount = useMemo(
    () =>
      allItems.filter((i) => i.unread && !read.has(i.id) && !archived.has(i.id)).length,
    [allItems, read, archived],
  );

  const kindMatches = (kind: InboxKind) => {
    if (filter === "all") return true;
    if (filter === "mentions") return kind === "mention";
    if (filter === "signals") return kind === "signal";
    if (filter === "tasks") return kind === "task";
    return true;
  };

  const markRead = (id: string) =>
    setRead((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const archive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setArchived((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const openItem = (item: InboxItem) => {
    markRead(item.id);
    if (item.kind === "mention") navigate("/?surface=chat");
    else if (item.kind === "signal") navigate("/");
    else if (item.kind === "task") navigate("/?surface=reports");
  };

  const tabs: Array<{ id: FilterId; label: string }> = [
    { id: "all", label: "All" },
    { id: "mentions", label: "Mentions" },
    { id: "signals", label: "Signals" },
    { id: "tasks", label: "Tasks" },
  ];

  return (
    <div
      data-testid="mobile-inbox-surface"
      className="md:hidden flex min-h-[calc(100vh-56px)] flex-col bg-[var(--bg-app,#fafafa)] dark:bg-[#0b0b0e]"
    >
      {/* Top header */}
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <div>
          <div className="text-[18px] font-semibold tracking-tight">Inbox</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Filter"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-400"
          >
            <Filter size={15} />
          </button>
          <button
            type="button"
            aria-label="Settings"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-400"
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      {/* Filter tabs */}
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-gray-200 bg-[var(--bg-app,#fafafa)]/95 px-3 py-2 backdrop-blur dark:border-white/[0.08] dark:bg-[#0b0b0e]/95">
        {tabs.map((t) => {
          const isActive = filter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                isActive
                  ? "bg-[#d97757] text-white"
                  : "bg-white text-gray-600 dark:bg-white/[0.02] dark:text-gray-300"
              }`}
            >
              <span>{t.label}</span>
              <span
                className={`rounded-full px-1 text-[10px] ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-gray-400"
                }`}
              >
                {counts[t.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto pb-[calc(20px+env(safe-area-inset-bottom,0px))]">
        {SECTIONS.map((sec) => {
          const visible = sec.items.filter(
            (i) => kindMatches(i.kind) && !archived.has(i.id),
          );
          if (visible.length === 0) return null;
          return (
            <section key={sec.id} className="px-3 pt-3">
              <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                {sec.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {visible.map((item) => {
                  const isUnread = item.unread && !read.has(item.id);
                  const ks = KIND_STYLE[item.kind];
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => openItem(item)}
                      className={`flex items-start gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                        isUnread
                          ? "border-[#d97757]/30 bg-white dark:bg-white/[0.03]"
                          : "border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]"
                      }`}
                    >
                      <span
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                        style={{ background: item.actor.avatar }}
                      >
                        {item.actor.initials}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1 text-[10px]">
                          <span
                            className={`rounded-full px-1.5 py-[1px] font-semibold ${ks.cls}`}
                          >
                            {ks.label}
                          </span>
                          <span className="truncate text-gray-500 dark:text-gray-400">
                            {item.entity}
                          </span>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <span className="text-gray-400 dark:text-gray-500">
                            {item.meta}
                          </span>
                        </span>
                        <span className="mt-1 truncate text-[13px] font-semibold">
                          {item.title}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-[11px] text-gray-600 dark:text-gray-400">
                          {item.body}
                        </span>
                      </span>
                      {isUnread && (
                        <span
                          aria-label="Unread"
                          className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#d97757]"
                        />
                      )}
                      <span
                        role="button"
                        aria-label="Archive"
                        onClick={(e) => archive(item.id, e)}
                        className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
                      >
                        <Archive size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        {allItems.filter((i) => kindMatches(i.kind) && !archived.has(i.id)).length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <div className="text-[14px] font-semibold">All clear</div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400">
              No {filter === "all" ? "items" : filter} in your inbox right now.
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-200 px-3 py-3 dark:border-white/[0.06]">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[12px] text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <Archive size={13} />
            View archive
          </button>
          <button
            type="button"
            onClick={() => setRead(new Set(allItems.map((i) => i.id)))}
            className="flex items-center gap-1.5 text-[12px] text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <CheckCircle2 size={13} />
            Mark all read
          </button>
        </div>
      </div>
    </div>
  );
}

export default MobileInboxSurface;
