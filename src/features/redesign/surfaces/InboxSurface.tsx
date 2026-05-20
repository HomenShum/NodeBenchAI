/**
 * Inbox — review queue for batch outputs + agent suggestions.
 *
 * Pattern: Linear Inbox + Front. Five lanes triage everything that needs the human:
 *   - Batch review · agent generations awaiting approval
 *   - Agent suggestions · proposed claims / actions
 *   - Captures · ambiguous notes that need targeting
 *   - Watchlist · entity signals + stale sources
 *   - Approvals · privacy / budget / connector writes
 *
 * Keyboard-first: j/k navigate · a accept · r reject · e edit · m move · p preview
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { type InboxItem, type InboxLane } from "../fixtures";
import { Pill } from "../components/Pill";
import { useInboxLive } from "../hooks/useInboxLive";
import { showToast } from "../components/Toast";
import { getAnonymousProductSessionId } from "../../product/lib/productIdentity";

type DateRange = "all" | "today" | "7d" | "30d";
const DATE_RANGES: Array<{ id: DateRange; label: string }> = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

const LANES: Array<{ id: InboxLane; label: string; tone: "amber" | "accent" | "blue" | "green" | undefined }> = [
  { id: "batch_review", label: "Batch review", tone: "amber" },
  { id: "agent_suggestions", label: "Agent suggestions", tone: "accent" },
  { id: "captures", label: "Captures", tone: undefined },
  { id: "watchlist", label: "Watchlist", tone: "blue" },
  { id: "approvals", label: "Approvals", tone: "accent" },
];

export function InboxSurface() {
  const [lane, setLane] = useState<InboxLane | "all">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());
  const completeNudge = useMutation(
    (api as unknown as {
      domains: { product: { nudges: { completeNudge: unknown } } };
    }).domains.product.nudges.completeNudge as Parameters<typeof useMutation>[0],
  );
  const snoozeNudge = useMutation(
    (api as unknown as {
      domains: { product: { nudges: { snoozeNudge: unknown } } };
    }).domains.product.nudges.snoozeNudge as Parameters<typeof useMutation>[0],
  );

  // Sprint S3: live aggregator over pipeline runs.
  const { items: allItems, isLive, isLoading, liveCount } = useInboxLive();

  const items = useMemo(() => {
    let base = allItems.filter((i) => !snoozed.has(i.id));
    if (lane !== "all") base = base.filter((i) => (i.lane ?? legacyToLane(i.category)) === lane);
    // Date range filter — heuristic on `meta` text since fixtures don't have timestamps
    if (dateRange !== "all") {
      const recencyHint = (m: string) => {
        const lower = m.toLowerCase();
        if (lower.includes("just now") || lower.includes("m ago") || lower.includes("today")) return 0;
        if (lower.includes("h ago")) return 0;
        if (lower.includes("d ago")) {
          const days = Number(lower.match(/(\d+)d ago/)?.[1] ?? 99);
          return days;
        }
        if (lower.includes("yesterday")) return 1;
        return 99;
      };
      const cap = dateRange === "today" ? 0 : dateRange === "7d" ? 7 : 30;
      base = base.filter((i) => recencyHint(i.meta) <= cap);
    }
    return base;
  }, [lane, allItems, dateRange, snoozed]);

  const toggleChecked = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearChecked = () => setChecked(new Set());
  const selectedNudgeIds = () =>
    Array.from(checked)
      .filter((id) => id.startsWith("nudge_"))
      .map((id) => id.slice("nudge_".length));

  const completeSelectedNudges = async () => {
    const nudgeIds = selectedNudgeIds();
    if (nudgeIds.length === 0) return;
    const anonymousSessionId = getAnonymousProductSessionId();
    await Promise.all(
      nudgeIds.map((nudgeId) =>
        completeNudge({ anonymousSessionId, nudgeId }),
      ),
    );
  };

  const snoozeSelectedNudges = async () => {
    const nudgeIds = selectedNudgeIds();
    if (nudgeIds.length === 0) return;
    const anonymousSessionId = getAnonymousProductSessionId();
    await Promise.all(
      nudgeIds.map((nudgeId) =>
        snoozeNudge({ anonymousSessionId, nudgeId }),
      ),
    );
  };

  const acceptAll = () => {
    void completeSelectedNudges().catch((error) => {
      console.error("[inbox] failed to complete nudges", error);
      showToast({ tone: "warning", message: "Some persisted nudges could not be completed." });
    });
    showToast({ tone: "success", message: `Accepted ${checked.size} item${checked.size === 1 ? "" : "s"}.` });
    clearChecked();
  };
  const rejectAll = () => {
    void completeSelectedNudges().catch((error) => {
      console.error("[inbox] failed to dismiss nudges", error);
      showToast({ tone: "warning", message: "Some persisted nudges could not be dismissed." });
    });
    showToast({ tone: "warning", message: `Rejected ${checked.size} item${checked.size === 1 ? "" : "s"}.` });
    clearChecked();
  };
  const snoozeAll = (label: string) => {
    void snoozeSelectedNudges().catch((error) => {
      console.error("[inbox] failed to snooze nudges", error);
      showToast({ tone: "warning", message: "Some persisted nudges could not be snoozed." });
    });
    setSnoozed((prev) => new Set([...prev, ...checked]));
    showToast({
      tone: "info",
      message: `Snoozed ${checked.size} item${checked.size === 1 ? "" : "s"} until ${label}.`,
      action: { label: "Undo", onClick: () => setSnoozed((prev) => {
        const next = new Set(prev);
        for (const id of checked) next.delete(id);
        return next;
      }) },
    });
    clearChecked();
  };

  // Auto-select first row on lane change
  useEffect(() => {
    setActiveId(items[0]?.id ?? null);
  }, [lane, items]);

  // Counts per lane
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: allItems.length };
    for (const l of LANES) {
      m[l.id] = allItems.filter((i) => (i.lane ?? legacyToLane(i.category)) === l.id).length;
    }
    return m;
  }, [allItems]);

  const activeItem = useMemo(() => items.find((i) => i.id === activeId) ?? items[0] ?? null, [items, activeId]);

  const completeOneNudge = async (itemId: string) => {
    if (!itemId.startsWith("nudge_")) return false;
    const anonymousSessionId = getAnonymousProductSessionId();
    await completeNudge({ anonymousSessionId, nudgeId: itemId.slice("nudge_".length) });
    return true;
  };

  const closePreviewItem = (item: InboxItem) => {
    setSnoozed((prev) => new Set(prev).add(item.id));
  };

  const handlePreviewAction = (
    item: InboxItem,
    action: "accept" | "reject" | "edit" | "move" | "open",
  ) => {
    if (action === "accept" || action === "reject") {
      closePreviewItem(item);
      if (item.id.startsWith("nudge_")) {
        void completeOneNudge(item.id)
          .then(() => showToast({
            tone: action === "accept" ? "success" : "warning",
            message: `${action === "accept" ? "Accepted" : "Rejected"} and persisted this live nudge.`,
          }))
          .catch((error) => {
            console.error(`[inbox] failed to ${action} nudge`, error);
            showToast({ tone: "warning", message: "Local queue updated, but the persisted nudge write failed." });
          });
      } else {
        showToast({
          tone: action === "accept" ? "success" : "warning",
          message: `${action === "accept" ? "Accepted" : "Rejected"} this starter item locally. Live artifacts persist through Convex nudges.`,
        });
      }
      return;
    }

    if (action === "open") {
      window.location.href = "/redesign/reports";
      return;
    }

    showToast({
      tone: "info",
      message: `${action === "edit" ? "Edit" : "Move"} is a local preview until this item is attached to a live report or nudge.`,
    });
  };

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = items.findIndex((i) => i.id === activeId);
      if (e.key === "j") { e.preventDefault(); setActiveId(items[Math.min(items.length - 1, idx + 1)]?.id ?? null); }
      else if (e.key === "k") { e.preventDefault(); setActiveId(items[Math.max(0, idx - 1)]?.id ?? null); }
      else if (e.key === "a" || e.key === "r" || e.key === "e" || e.key === "m") {
        if (!activeItem) return;
        e.preventDefault();
        if (e.key === "a") handlePreviewAction(activeItem, "accept");
        if (e.key === "r") handlePreviewAction(activeItem, "reject");
        if (e.key === "e") handlePreviewAction(activeItem, "edit");
        if (e.key === "m") handlePreviewAction(activeItem, "move");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, activeId, activeItem]);

  const inboxGroups = buildInboxV2Groups(items);

  return (
    <div className="rd-v2-proto-center rd-v2-inbox-center">
      <div className="rd-v2-inbox-head">
        <h1>Inbox</h1>
        <span>
          {isLive ? `${liveCount} live items` : isLoading ? "Checking live items" : "0 live items"} · {items.filter((item) => item.whyTone === "amber" || item.lane === "approvals").length} need action
        </span>
        <button
          type="button"
          onClick={() => {
            if (items.length === 0) {
              showToast({ tone: "info", message: "No live Inbox rows are available to mark read." });
              return;
            }
            setSnoozed((prev) => new Set([...prev, ...items.map((item) => item.id)]));
            showToast({ tone: "success", message: `Marked ${items.length} live Inbox item${items.length === 1 ? "" : "s"} read locally.` });
          }}
        >
          Mark all read
        </button>
        <button
          type="button"
          className="rd-v2-btn-primary"
          onClick={() => showToast({ tone: "info", message: "Auto-triage runs through the live nudge and pipeline queues. No starter rows were inserted." })}
        >
          Auto-triage
        </button>
      </div>
      {inboxGroups.map((group) => (
        <section key={group.label} className="rd-v2-inbox-group">
          <div className="rd-v2-inbox-group-head"><span>{group.label}</span><b>{group.items.length}</b></div>
          {group.items.length === 0 ? (
            <article className="rd-inbox-empty">
              <span className="rd-v2-source-icon" data-source="system">—</span>
              <div>
                <span className="rd-v2-inbox-title-row"><strong>{group.empty}</strong></span>
              </div>
            </article>
          ) : (
            group.items.map((item) => (
              <article
                key={item.id}
                className={activeId === item.id ? "is-active" : ""}
                onClick={() => setActiveId(item.id)}
              >
                <span className="rd-v2-source-icon" data-source={inboxV2Source(item)}>
                  {inboxV2Icon(item)}
                </span>
                <div>
                  <span className="rd-v2-inbox-title-row">
                    {activeId === item.id && <i />}
                    <strong>{item.title}</strong>
                  </span>
                  <p>{item.body}</p>
                </div>
                <time>{item.meta}</time>
                <b>{item.whyHere ?? item.category.replace(/_/g, " ")}</b>
              </article>
            ))
          )}
        </section>
      ))}
      {allItems.length > items.length && (
        <button
          className="rd-v2-show-more"
          type="button"
          onClick={() => showToast({ tone: "info", message: isLive ? "All live Inbox rows for this session are visible." : "Inbox is empty because no live nudges or pipeline review rows were returned." })}
        >
          Show {allItems.length - items.length} more item{allItems.length - items.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );

  return (
    <div className="rd-stack" style={{ padding: "32px 40px 40px", gap: 18, maxWidth: 1280, height: "100%" }}>
      <header className="rd-row--between">
        <div className="rd-stack" style={{ gap: 4 }}>
          <div className="rd-row" style={{ gap: 8, alignItems: "center" }}>
            <div className="rd-eyebrow">Inbox · review queue</div>
            {isLive ? (
              <Pill tone="green" title="Live pipeline review data from Convex">
                <span className="rd-dot rd-dot--live" />Live · {liveCount} from runs
              </Pill>
            ) : (
              <Pill title="Starter queue is visible while live review items hydrate or when the user has no private items yet.">
                Starter review lanes
              </Pill>
            )}
          </div>
          <h1 className="rd-h1">Where you decide. Everything else runs in the background.</h1>
          <p className="rd-faint" style={{ maxWidth: 620, fontSize: 13.5 }}>
            Batch outputs awaiting approval, agent suggestions, ambiguous captures, watchlist signals, and approval-required writes.
            Keyboard: <span className="rd-kbd">j</span><span className="rd-kbd">k</span> move · <span className="rd-kbd">a</span> accept · <span className="rd-kbd">r</span> reject · <span className="rd-kbd">e</span> edit.
          </p>
        </div>
      </header>

      {/* Lane tabs + date range */}
      <div className="rd-row--between" style={{ gap: 12, flexWrap: "wrap" }}>
        <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button
            className="rd-filter-chip"
            aria-pressed={lane === "all"}
            onClick={() => setLane("all")}
          >All <span className="rd-mono" style={{ marginLeft: 4, opacity: 0.7 }}>{counts.all}</span></button>
          {LANES.map((l) => (
            <button
              key={l.id}
              className="rd-filter-chip"
              aria-pressed={lane === l.id}
              onClick={() => setLane(l.id)}
            >
              {l.label} <span className="rd-mono" style={{ marginLeft: 4, opacity: 0.7 }}>{counts[l.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="rd-facet">
          <span className="rd-facet__label">Range</span>
          <div className="rd-facet__chips" role="radiogroup" aria-label="Date range">
            {DATE_RANGES.map((d) => (
              <button
                key={d.id}
                role="radio"
                aria-checked={dateRange === d.id}
                aria-selected={dateRange === d.id}
                className="rd-facet__chip"
                onClick={() => setDateRange(d.id)}
              >{d.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Bulk action bar — appears when items are checked */}
      {checked.size > 0 && (
        <div className="rd-inbox-bulk">
          <span className="rd-inbox-bulk__count">{checked.size} selected</span>
          <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={acceptAll}>✓ Accept all</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={rejectAll}>Reject all</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => snoozeAll("tomorrow")}>Snooze · Tomorrow</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => snoozeAll("next week")}>Snooze · Next week</button>
          <span className="rd-inbox-bulk__spacer" />
          <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={clearChecked}>Cancel</button>
        </div>
      )}

      {snoozed.size > 0 && checked.size === 0 && (
        <div className="rd-row" style={{ gap: 8, alignItems: "center", fontSize: 11.5, color: "var(--rd-ink-soft)" }}>
          <span>{snoozed.size} item{snoozed.size === 1 ? "" : "s"} snoozed</span>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => setSnoozed(new Set())}>Unsnooze all</button>
        </div>
      )}

      {/* Two-pane shell */}
      <div className="rd-inbox-shell">
        <div className="rd-inbox-list">
          {items.length === 0 ? (
            <div className="rd-card rd-card__hero" style={{ textAlign: "center", padding: "32px" }}>
              <div className="rd-eyebrow">Empty</div>
              <h2 className="rd-h2">No items in this lane.</h2>
            </div>
          ) : (
            items.map((it) => (
              <InboxRow
                key={it.id}
                item={it}
                isActive={activeId === it.id}
                isChecked={checked.has(it.id)}
                onActivate={() => setActiveId(it.id)}
                onToggleCheck={() => toggleChecked(it.id)}
              />
            ))
          )}
        </div>

        <div className="rd-inbox-preview">
          {activeItem ? (
            <InboxPreview
              item={activeItem}
              onAccept={() => handlePreviewAction(activeItem, "accept")}
              onReject={() => handlePreviewAction(activeItem, "reject")}
              onEdit={() => handlePreviewAction(activeItem, "edit")}
              onMove={() => handlePreviewAction(activeItem, "move")}
              onOpenReport={() => handlePreviewAction(activeItem, "open")}
            />
          ) : (
            <div className="rd-inbox-preview__empty">
              Pick an item to preview it here.<br />
              <span className="rd-mono" style={{ marginTop: 8, display: "block" }}>
                <span className="rd-kbd">j</span> next · <span className="rd-kbd">k</span> prev · <span className="rd-kbd">a</span> accept · <span className="rd-kbd">r</span> reject
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxRow({ item, isActive, isChecked, onActivate, onToggleCheck }: { item: InboxItem; isActive: boolean; isChecked?: boolean; onActivate: () => void; onToggleCheck?: () => void }) {
  const tone = item.whyTone ?? "amber";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);
  return (
    <div
      ref={ref}
      className="rd-inbox-row"
      role="option"
      aria-selected={isActive}
      data-checked={isChecked || undefined}
      onClick={onActivate}
    >
      {onToggleCheck && (
        <input
          type="checkbox"
          className="rd-inbox-row__check"
          checked={!!isChecked}
          onChange={(e) => { e.stopPropagation(); onToggleCheck(); }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${item.title}`}
        />
      )}
      <span className="rd-inbox-row__lane-glyph" aria-hidden="true">
        <LaneGlyph lane={item.lane ?? legacyToLane(item.category)} />
      </span>
      <span className={`rd-inbox-row__why rd-inbox-row__why--${tone}`}>{item.whyHere ?? item.category.replace(/_/g, " ")}</span>
      <div style={{ minWidth: 0 }}>
        <div className="rd-inbox-row__title">{item.title}</div>
        <div className="rd-inbox-row__meta" style={{ marginTop: 2 }}>{item.meta}</div>
      </div>
      {typeof item.confidence === "number" && (
        <span
          className="rd-mono"
          aria-label={`Confidence ${item.confidence > 0.85 ? "high" : item.confidence > 0.65 ? "medium" : "low"} ${(item.confidence * 100).toFixed(0)} percent`}
          style={{ fontSize: 11, fontWeight: 700, color: item.confidence > 0.85 ? "var(--rd-green)" : item.confidence > 0.65 ? "var(--rd-accent-strong)" : "var(--rd-amber)", display: "inline-flex", alignItems: "center", gap: 3 }}
        >
          <span aria-hidden="true">{item.confidence > 0.85 ? "●" : item.confidence > 0.65 ? "◐" : "○"}</span>
          {(item.confidence * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

function InboxPreview({
  item,
  onAccept,
  onReject,
  onEdit,
  onMove,
  onOpenReport,
}: {
  item: InboxItem;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onMove: () => void;
  onOpenReport: () => void;
}) {
  // Per nexu-io/open-design pattern: actions live in the header next to the title,
  // not anchored to viewport-bottom. Decision velocity wins; no "empty card / floating accept" feel.
  const confidencePct = typeof item.confidence === "number" ? Math.round(item.confidence * 100) : null;
  const confTone =
    item.confidence == null ? null
    : item.confidence > 0.85 ? "green"
    : item.confidence > 0.65 ? "amber"
    : "amber";
  return (
    <>
      {/* Header: why-here pill + inline confidence + meta + primary action cluster */}
      <header className="rd-inbox-preview__header">
        <div className="rd-inbox-preview__why">
          <Pill tone={item.whyTone ?? "amber"}>{item.whyHere ?? "Needs review"}</Pill>
          {confidencePct !== null && (
            <span
              className={`rd-inbox-preview__conf rd-inbox-preview__conf--${confTone}`}
              aria-label={`Confidence ${confidencePct}%`}
              title={`Confidence ${confidencePct}%`}
            >
              <span aria-hidden="true">●</span> {confidencePct}%
            </span>
          )}
          <span className="rd-mono rd-inbox-preview__meta">{item.meta}</span>
        </div>
        <div className="rd-inbox-preview__actions">
          <button className="rd-btn rd-btn--primary rd-btn--sm" aria-keyshortcuts="a" onClick={onAccept}>
            ✓ Accept <span className="rd-kbd">a</span>
          </button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" aria-keyshortcuts="r" onClick={onReject}>
            Reject <span className="rd-kbd">r</span>
          </button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" aria-keyshortcuts="e" onClick={onEdit}>
            Edit <span className="rd-kbd">e</span>
          </button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" aria-keyshortcuts="m" onClick={onMove}>
            Move <span className="rd-kbd">m</span>
          </button>
        </div>
      </header>

      {/* Title + body in document flow — no margin-top auto, no dangling sections */}
      <h2 className="rd-h2 rd-inbox-preview__title">{item.title}</h2>
      <p className="rd-body rd-inbox-preview__body">{item.body}</p>

      {item.detected && (
        <div className="rd-inbox-preview__entities">
          <span className="rd-eyebrow">Detected</span>
          {item.detected.person && <Pill>{item.detected.person}</Pill>}
          {item.detected.company && <Pill tone="blue">{item.detected.company}</Pill>}
          {item.detected.topic && <Pill tone="accent">{item.detected.topic}</Pill>}
        </div>
      )}

      {/* Inline confidence bar — small, attached to content, not its own section */}
      {confidencePct !== null && (
        <div className="rd-inbox-preview__confbar" aria-hidden="true">
          <div
            className="rd-inbox-preview__confbar-fill"
            data-tone={confTone}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      )}

      <div className="rd-inbox-preview__deeplink">
        <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={onOpenReport}>Open in report →</button>
      </div>
    </>
  );
}

function buildInboxV2Groups(items: InboxItem[]) {
  const groups = [
    {
      label: "Requires action",
      empty: "No approval or agent-action rows",
      items: items.filter((item) =>
        (item.lane ?? legacyToLane(item.category)) === "approvals" ||
        (item.lane ?? legacyToLane(item.category)) === "agent_suggestions" ||
        item.whyTone === "amber",
      ),
    },
    {
      label: "To read",
      empty: "No watchlist or capture rows",
      items: items.filter((item) =>
        (item.lane ?? legacyToLane(item.category)) === "watchlist" ||
        (item.lane ?? legacyToLane(item.category)) === "captures",
      ),
    },
    {
      label: "Waiting on others",
      empty: "No waiting rows",
      items: items.filter((item) =>
        item.meta.toLowerCase().includes("waiting") ||
        item.body.toLowerCase().includes("approval") ||
        item.body.toLowerCase().includes("requires"),
      ),
    },
    {
      label: "Filed",
      empty: "No filed rows",
      items: items.filter((item) => item.whyTone === "green"),
    },
  ];

  return groups.map((group, index) => ({
    ...group,
    items: index === 0
      ? group.items
      : group.items.filter((item) => !groups.slice(0, index).some((prior) => prior.items.some((priorItem) => priorItem.id === item.id))),
  }));
}

function inboxV2Source(item: InboxItem): string {
  const lane = item.lane ?? legacyToLane(item.category);
  if (lane === "approvals") return "github";
  if (lane === "watchlist") return "source";
  if (lane === "agent_suggestions") return "agent";
  return "email";
}

function inboxV2Icon(item: InboxItem): string {
  const source = inboxV2Source(item);
  if (source === "github") return "⌁";
  if (source === "source") return "◦";
  if (source === "agent") return "✦";
  return "✉";
}

function LaneGlyph({ lane }: { lane: InboxLane }) {
  const map: Record<InboxLane, { d: string; bg: string; color: string }> = {
    batch_review: { d: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11", bg: "var(--rd-amber-bg)", color: "var(--rd-amber)" },
    agent_suggestions: { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4", bg: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)" },
    captures: { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", bg: "var(--rd-paper-warm)", color: "var(--rd-ink-mute)" },
    watchlist: { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", bg: "var(--rd-blue-bg)", color: "var(--rd-blue)" },
    approvals: { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3", bg: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)" },
  };
  const m = map[lane];
  return (
    <span style={{
      display: "grid", placeItems: "center",
      width: 18, height: 18, borderRadius: 4,
      background: m.bg, color: m.color,
    }}>
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d={m.d} />
      </svg>
    </span>
  );
}

function legacyToLane(category: InboxItem["category"]): InboxLane {
  switch (category) {
    case "approval": return "approvals";
    case "watchlist": return "watchlist";
    case "automation": return "approvals";
    case "needs_confirmation":
    case "unassigned":
    case "event":
    default: return "captures";
  }
}
