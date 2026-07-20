/**
 * Rail - left contextual workspace rail.
 *
 * TopNav owns Home / Reports / Chat / Inbox / Me. This rail carries memory
 * status and workspace context so desktop users do not see two competing
 * primary navigation systems.
 */

import type { SurfaceId } from "../fixtures";

interface RailProps {
  active: SurfaceId;
  onChange: (id: SurfaceId) => void;
  onOpenWorkspace: () => void;
  liveStats?: { entities: number; reports: number; followUps: number };
  inboxCount?: number;
}

const NAV: Array<{ id: SurfaceId; label: string; hint: string }> = [
  { id: "home", label: "Home", hint: "Pulse plus memory wins" },
  { id: "reports", label: "Reports", hint: "Reusable memory library" },
  { id: "chat", label: "Chat", hint: "Live operating surface" },
  { id: "inbox", label: "Inbox", hint: "Attention and uncertainty" },
  { id: "me", label: "Me", hint: "Memory, privacy, and budget" },
];

export function Rail({ active, onOpenWorkspace, liveStats, inboxCount = 0 }: RailProps) {
  const activeItem = NAV.find((item) => item.id === active) ?? NAV[0];

  return (
    <aside className="rd-pane" aria-label="Workspace context" style={{ padding: "20px 14px", gap: 24 }}>
      <a
        href="/redesign"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 6px 16px",
          borderBottom: "1px solid var(--rd-line-faint)",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "var(--rd-accent)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--rd-font-mono)",
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
          }}
        >
          N
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 590, color: "var(--rd-ink-strong)" }}>NodeBench</span>
          <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>entity intelligence</span>
        </div>
      </a>

      <section
        aria-label="Current surface"
        className="rd-stack"
        style={{
          gap: 8,
          padding: "12px 10px",
          border: "1px solid var(--rd-line-faint)",
          borderRadius: 12,
          background: "var(--rd-panel)",
        }}
      >
        <div className="rd-eyebrow">Current surface</div>
        <div style={{ fontSize: 15, fontWeight: 650, color: "var(--rd-ink-strong)" }}>{activeItem.label}</div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--rd-ink-soft)" }}>{activeItem.hint}</p>
        {active === "inbox" && inboxCount > 0 && (
          <span className="rd-pill rd-pill--accent" style={{ width: "fit-content" }}>
            {inboxCount} item{inboxCount === 1 ? "" : "s"} need attention
          </span>
        )}
      </section>

      <button
        type="button"
        onClick={onOpenWorkspace}
        className="rd-btn rd-btn--ghost"
        style={{ marginTop: 4, justifyContent: "flex-start", gap: 10, padding: "8px 10px", width: "100%" }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16v6H4zM4 13h16v6H4zM8 5v14M16 5v14" />
        </svg>
        <span style={{ flex: 1, textAlign: "left" }}>Open workspace</span>
        <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{">"}</span>
      </button>

      <div style={{ marginTop: "auto", padding: "12px 8px", borderTop: "1px solid var(--rd-line-faint)" }}>
        <div className="rd-row--between" style={{ marginBottom: 8 }}>
          <div className="rd-eyebrow">Memory</div>
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="rd-mono"
            title="Open Sources workspace - manage all entities, sources, and watchlist"
            style={{
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 8,
              minHeight: 30,
              padding: "5px 8px",
              fontSize: 10,
              color: "var(--rd-accent-strong)",
              cursor: "pointer",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Sources -&gt;
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
          <Stat label="Entities" value={liveStats?.entities ?? 0} />
          <Stat label="Reports" value={liveStats?.reports ?? 0} />
          <Stat label="Follow-ups" value={liveStats?.followUps ?? 0} />
          <Stat label="From memory" value={liveStats ? "Live" : "0%"} />
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ color: "var(--rd-ink-soft)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ color: "var(--rd-ink-strong)", fontWeight: 590, fontSize: 13 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
