/**
 * TopNav — unified top horizontal bar for /redesign.
 *
 * Mirrors the affordances of src/layouts/ProductTopNav.tsx (the cockpit's
 * top nav) but lives in the redesign token namespace (--rd-*) so it does
 * not pull cockpit Tailwind classes into the isolated shell.
 *
 * Slots:
 *   left   — brand mark `N` + "NodeBench AI" wordmark, links to /redesign
 *   center — 5 nav tabs (Home / Reports / Chat / Inbox / Me) with active
 *            state, aria-current, Alt+1..Alt+5 shortcuts
 *   right  — search button (opens CommandPalette via passed callback)
 *            + theme toggle + profile chip (initials / "Sign in")
 *
 * A11y:
 *   - <header><nav aria-label="Primary navigation">
 *   - aria-current="page" on active tab
 *   - aria-keyshortcuts on each tab ("Alt+N")
 *   - Focus rings via existing rd-btn :focus-visible
 *   - Respects prefers-reduced-motion (no transitions added beyond the
 *     token-scoped defaults)
 *
 * Mounted in: RedesignShell.tsx (above the rd-shell grid on desktop;
 * not mounted on mobile — MobileShell already owns its own top bar).
 */

import { useEffect, useMemo } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import type { SurfaceId } from "../fixtures";

interface TopNavProps {
  active: SurfaceId;
  onChange: (id: SurfaceId) => void;
  onOpenPalette: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  wideMode?: boolean;
  onToggleWideMode?: () => void;
  prototypeMode?: boolean;
}

interface NavItem {
  id: SurfaceId;
  label: string;
  /** 1-based slot for Alt+N keyboard shortcut. */
  slot: 1 | 2 | 3 | 4 | 5;
}

const NAV: NavItem[] = [
  { id: "home", label: "Home", slot: 1 },
  { id: "reports", label: "Reports", slot: 2 },
  { id: "chat", label: "Chat", slot: 3 },
  { id: "inbox", label: "Inbox", slot: 4 },
  { id: "me", label: "Me", slot: 5 },
];

export function TopNav({
  active,
  onChange,
  onOpenPalette,
  theme,
  onToggleTheme,
  wideMode = false,
  onToggleWideMode,
  prototypeMode = false,
}: TopNavProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();

  // Alt+1..Alt+5 surface jumps (matches the cockpit's pattern).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const slot = Number(e.key);
      if (!Number.isInteger(slot) || slot < 1 || slot > NAV.length) return;
      const target = NAV.find((item) => item.slot === slot);
      if (!target) return;
      // Don't steal Alt+N when a field is focused — let the browser handle.
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) {
        return;
      }
      e.preventDefault();
      onChange(target.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onChange]);

  const initials = useMemo(() => {
    if (!isAuthenticated) return null;
    // We don't have access to user profile here in v1; show a neutral chip.
    // RightInspector / MeSurface own the full identity story.
    return "NB";
  }, [isAuthenticated]);
  const showAccountSlot = !prototypeMode && active !== "home";

  const onSignIn = () => {
    void signIn("google", {
      redirectTo: typeof window !== "undefined" ? window.location.href : "/redesign",
    }).catch(() => undefined);
  };

  return (
    <header
      data-rd-topnav
      role="banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 28px",
        height: 52,
        borderBottom: "1px solid var(--rd-line-faint)",
        background: "var(--rd-paper)",
        flexShrink: 0,
        zIndex: 20,
      }}
    >
      <button
        type="button"
        onClick={() => onChange("home")}
        aria-label="NodeBench home"
        className="rd-btn rd-btn--quiet"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0,
          padding: 0,
          minWidth: 0,
          flexShrink: 0,
          background: "transparent",
        }}
      >
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.3px",
            color: "var(--rd-ink-strong)",
            whiteSpace: "nowrap",
          }}
        >
          Node<span style={{ color: "var(--rd-accent)" }}>Bench</span>
        </span>
      </button>

      <nav
        aria-label="Primary navigation"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: 0,
          borderRadius: "var(--rd-r-pill)",
          background: "transparent",
        }}
      >
        {NAV.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={isActive ? "page" : undefined}
              aria-keyshortcuts={`Alt+${item.slot}`}
              title={`${item.label} (Alt+${item.slot})`}
              className="rd-btn rd-btn--quiet"
              style={{
                padding: "7px 12px",
                minHeight: 34,
                borderRadius: "var(--rd-r-pill)",
                fontSize: 13,
                fontWeight: isActive ? 590 : 500,
                background: isActive ? "var(--rd-accent-soft)" : "transparent",
                color: isActive ? "var(--rd-accent-strong)" : "var(--rd-ink-soft)",
                boxShadow: "none",
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ marginLeft: "auto", display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Find a person, company, or action"
          aria-keyshortcuts="Meta+K Control+K"
          className="rd-btn rd-btn--quiet"
          data-rd-topnav-search
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            minHeight: 34,
            width: prototypeMode ? 276 : 270,
            borderRadius: "var(--rd-r-pill)",
            border: "1px solid var(--rd-line)",
            background: "var(--rd-panel)",
            color: "var(--rd-ink-faint)",
            fontSize: prototypeMode ? 11.5 : 12,
            justifyContent: "flex-start",
          }}
        >
          <span
            style={{
              flex: 1,
              textAlign: "left",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Find a person, company, or action
          </span>
          <kbd
            data-rd-topnav-kbd
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "1px 5px",
              fontFamily: "var(--rd-font-mono)",
              fontSize: 10,
              fontWeight: 590,
              color: "var(--rd-ink-soft)",
              background: "var(--rd-muted)",
              border: "1px solid var(--rd-line-faint)",
              borderRadius: 4,
            minWidth: 18,
            justifyContent: "center",
            lineHeight: 1.4,
          }}
        >
            Ctrl K
          </kbd>
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onToggleWideMode}
          aria-pressed={wideMode}
          aria-label={wideMode ? "Use standard width" : "Use wide mode"}
          title={wideMode ? "Use standard width (W)" : "Use wide mode (W)"}
          className="rd-btn rd-btn--quiet"
          style={{
            width: 34,
            height: 34,
            padding: 0,
            borderRadius: "50%",
            border: "1px solid var(--rd-line)",
            background: wideMode ? "var(--rd-accent-soft)" : "var(--rd-panel)",
            display: "grid",
            placeItems: "center",
            color: wideMode ? "var(--rd-accent-strong)" : "var(--rd-ink-mute)",
          }}
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8V5h3" />
            <path d="M20 8V5h-3" />
            <path d="M4 16v3h3" />
            <path d="M20 16v3h-3" />
            <path d="M9 12h6" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="rd-btn rd-btn--quiet"
          style={{
            width: 34,
            height: 34,
            padding: 0,
            borderRadius: "50%",
            border: "1px solid var(--rd-line)",
            background: "var(--rd-panel)",
            display: "grid",
            placeItems: "center",
            color: "var(--rd-ink-mute)",
          }}
        >
          {theme === "dark" ? (
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {showAccountSlot && isLoading ? (
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "var(--rd-muted)",
            }}
          />
        ) : showAccountSlot && initials ? (
          <button
            type="button"
            aria-label="Account menu"
            className="rd-btn rd-btn--quiet"
            style={{
              width: 34,
              height: 34,
              padding: 0,
              borderRadius: "50%",
              background: "var(--rd-accent-soft)",
              color: "var(--rd-accent-strong)",
              fontFamily: "var(--rd-font-mono)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              display: "grid",
              placeItems: "center",
            }}
          >
            {initials}
          </button>
        ) : showAccountSlot ? (
          <button
            type="button"
            onClick={onSignIn}
            className="rd-btn rd-btn--primary rd-btn--sm"
            style={{
              padding: "7px 12px",
              minHeight: 34,
              fontSize: 12.5,
              fontWeight: 590,
            }}
          >
            Continue
          </button>
        ) : null}
      </div>
    </header>
  );
}
