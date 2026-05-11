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

  const onSignIn = () => {
    void signIn("anonymous").catch(() => undefined);
  };

  return (
    <header
      data-rd-topnav
      role="banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 20px",
        height: 52,
        borderBottom: "1px solid var(--rd-line-faint)",
        background: "var(--rd-paper)",
        flexShrink: 0,
      }}
    >
      <a
        href="#main-content"
        className="rd-skip-link"
        style={{
          position: "absolute",
          left: -9999,
          top: 8,
          zIndex: 100,
          padding: "8px 16px",
          background: "var(--rd-panel)",
          color: "var(--rd-ink-strong)",
          border: "2px solid var(--rd-accent)",
          borderRadius: "var(--rd-r-sm)",
          fontSize: 13,
          fontWeight: 590,
          textDecoration: "none",
        }}
        onFocus={(e) => { e.currentTarget.style.left = "20px"; }}
        onBlur={(e) => { e.currentTarget.style.left = "-9999px"; }}
      >
        Skip to main content
      </a>
      <button
        type="button"
        onClick={() => onChange("home")}
        aria-label="NodeBench home"
        className="rd-btn rd-btn--quiet"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          padding: "4px 8px",
          minWidth: 0,
          background: "transparent",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "var(--rd-accent)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--rd-font-mono)",
            fontSize: 12,
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1,
          }}
        >
          N
        </span>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 590,
            letterSpacing: "-0.01em",
            color: "var(--rd-ink-strong)",
            whiteSpace: "nowrap",
          }}
        >
          NodeBench{" "}
          <span style={{ color: "var(--rd-accent-strong)" }}>AI</span>
        </span>
      </button>

      <nav
        aria-label="Primary navigation"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: 3,
          borderRadius: "var(--rd-r-pill)",
          background: "var(--rd-muted)",
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
                padding: "5px 12px",
                minHeight: 28,
                borderRadius: "var(--rd-r-pill)",
                fontSize: 13,
                fontWeight: isActive ? 590 : 510,
                background: isActive ? "var(--rd-panel)" : "transparent",
                color: isActive ? "var(--rd-ink-strong)" : "var(--rd-ink-mute)",
                boxShadow: isActive ? "var(--rd-shadow-xs)" : "none",
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search reports, entities, inbox"
          aria-keyshortcuts="Meta+K Control+K"
          className="rd-btn rd-btn--quiet"
          data-rd-topnav-search
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px 5px 12px",
            minHeight: 30,
            maxWidth: 420,
            width: "100%",
            borderRadius: "var(--rd-r-md)",
            border: "1px solid var(--rd-line)",
            background: "var(--rd-panel)",
            color: "var(--rd-ink-soft)",
            fontSize: 12.5,
            justifyContent: "flex-start",
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span
            style={{
              flex: 1,
              textAlign: "left",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Search reports, entities, inbox…
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
            K
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
          onClick={onToggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="rd-btn rd-btn--quiet"
          style={{
            width: 30,
            height: 30,
            padding: 0,
            borderRadius: 8,
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

        {isLoading ? (
          <div
            aria-hidden="true"
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--rd-muted)",
            }}
          />
        ) : initials ? (
          <button
            type="button"
            aria-label="Account menu"
            className="rd-btn rd-btn--quiet"
            style={{
              width: 30,
              height: 30,
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
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="rd-btn rd-btn--primary rd-btn--sm"
            style={{
              padding: "5px 11px",
              minHeight: 30,
              fontSize: 12.5,
              fontWeight: 590,
            }}
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
