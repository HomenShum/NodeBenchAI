/**
 * Rail — left workspace rail with the canonical 5-tab nav.
 *
 * Spec: Home · Reports · Chat · Inbox · Me (preserves existing CLAUDE.md guarantee).
 * Workspace is intentionally NOT a sixth tab — it lives at /redesign/workspace.
 */

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import type { SurfaceId } from "../fixtures";

interface RailProps {
  active: SurfaceId;
  onChange: (id: SurfaceId) => void;
  onOpenWorkspace: () => void;
  liveStats?: { entities: number; reports: number; followUps: number };
  inboxCount?: number;
}

const NAV: Array<{ id: SurfaceId; label: string; hint: string; icon: string }> = [
  { id: "home", label: "Home", hint: "Pulse + memory wins", icon: "" },
  { id: "reports", label: "Reports", hint: "Reusable memory library", icon: "" },
  { id: "chat", label: "Chat", hint: "Live operating surface", icon: "" },
  { id: "inbox", label: "Inbox", hint: "Attention + uncertainty", icon: "" },
  { id: "me", label: "Me", hint: "Memory + privacy + budget", icon: "" },
];

const ICONS: Record<SurfaceId, string> = {
  home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  reports: "M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 6h14M9 13h6M9 17h4",
  chat: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z",
  inbox: "M3 13h6l1 2h4l1-2h6M3 13l3-8h12l3 8M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6",
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
};

export function Rail({ active, onChange, onOpenWorkspace, liveStats, inboxCount = 0 }: RailProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [signingIn, setSigningIn] = useState(false);
  const showAuthCta = !isLoading && !isAuthenticated;
  const signInAnonymously = () => {
    setSigningIn(true);
    void signIn("anonymous").catch(() => undefined).finally(() => setSigningIn(false));
  };

  return (
    <aside className="rd-pane" aria-label="Primary navigation" style={{ padding: "20px 14px", gap: 24 }}>
      <a href="/" style={{
        display: "flex", alignItems: "center", gap: 8, padding: "0 6px 16px",
        borderBottom: "1px solid var(--rd-line-faint)", textDecoration: "none", color: "inherit",
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "var(--rd-accent)", display: "grid", placeItems: "center",
          fontFamily: "var(--rd-font-mono)", fontSize: 13, fontWeight: 700, color: "#fff",
        }}>N</div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 590, color: "var(--rd-ink-strong)" }}>NodeBench</span>
          <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>entity intelligence</span>
        </div>
      </a>

      <nav aria-label="Surfaces" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={isActive ? "page" : undefined}
              className="rd-btn rd-btn--quiet"
              style={{
                justifyContent: "flex-start",
                gap: 10,
                padding: "8px 10px",
                width: "100%",
                background: isActive ? "var(--rd-accent-soft)" : "transparent",
                color: isActive ? "var(--rd-accent-strong)" : "var(--rd-ink-mute)",
                fontWeight: isActive ? 590 : 510,
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={ICONS[item.id]} />
              </svg>
              <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
              {item.id === "inbox" && inboxCount > 0 && (
                <span className="rd-pill rd-pill--accent" style={{ padding: "1px 7px", fontSize: 10 }}>{inboxCount}</span>
              )}
            </button>
          );
        })}
      </nav>

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
        {showAuthCta && (
          <button
            type="button"
            onClick={signInAnonymously}
            disabled={signingIn}
            className="rd-btn rd-btn--primary"
            style={{ width: "100%", justifyContent: "center", marginBottom: 12, minHeight: 34 }}
          >
            {signingIn ? "Signing in..." : "Sign in anonymously"}
          </button>
        )}
        <div className="rd-row--between" style={{ marginBottom: 8 }}>
          <div className="rd-eyebrow">Memory</div>
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="rd-mono"
            title="Open Sources workspace — manage all entities, sources, and watchlist"
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
          >Sources →</button>
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
