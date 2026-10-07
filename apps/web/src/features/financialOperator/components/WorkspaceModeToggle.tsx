/**
 * WorkspaceModeToggle — floating control that switches the chat surface
 * into "workspace mode": the operator-console takes over the chat
 * content area while the composer + agent panel remain live.
 *
 * Why a floating toggle vs editing FastAgentPanel directly:
 *   - FastAgentPanel.tsx is 3700+ lines; reaching into its render tree
 *     for one button is high blast radius
 *   - URL-param-driven state (`?ws=1`) means the toggle works on every
 *     chat/root surface without coupling to its render tree
 *
 * Visibility rule: only renders on desktop chat surfaces (plain `/`,
 * `/?surface=ask`, or `/?surface=chat`). Mobile uses the canonical bottom
 * chrome, so the floating pill stays hidden there.
 *
 * Persistence: toggle state lives in `?ws=1` (shareable). When the
 * user reloads or shares the URL, workspace mode rehydrates.
 */

import { useState, useEffect } from "react";
import { LayoutDashboard, MessageSquare } from "lucide-react";

const URL_PARAM = "ws";
const MOBILE_TOGGLE_QUERY = "(max-width: 767px)";

export function isWorkspaceModeActive(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(URL_PARAM) === "1";
}

export function setWorkspaceMode(active: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (active) {
    url.searchParams.set(URL_PARAM, "1");
  } else {
    url.searchParams.delete(URL_PARAM);
  }
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function shouldRenderToggle(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.(MOBILE_TOGGLE_QUERY).matches) return false;
  const path = window.location.pathname;
  const surface = new URLSearchParams(window.location.search).get("surface");
  // Hide on the standalone demo route — the workspace IS the page there.
  if (path.startsWith("/finance-demo") || path.startsWith("/financial-operator") || path.startsWith("/finops")) {
    return false;
  }
  // Hide on canonical info pages where workspace mode would be confusing.
  const HIDDEN_PREFIXES = ["/cli", "/pricing", "/changelog", "/legal", "/about", "/api-docs", "/share/", "/report/", "/embed/"];
  if (HIDDEN_PREFIXES.some((p) => path.startsWith(p))) return false;
  return path === "/" && (!surface || surface === "ask" || surface === "chat");
}

export function WorkspaceModeToggle() {
  const [active, setActive] = useState<boolean>(() => isWorkspaceModeActive());
  const [visible, setVisible] = useState<boolean>(() => shouldRenderToggle());

  useEffect(() => {
    const onPop = () => {
      setActive(isWorkspaceModeActive());
      setVisible(shouldRenderToggle());
    };
    window.addEventListener("popstate", onPop);
    const media = window.matchMedia?.(MOBILE_TOGGLE_QUERY);
    media?.addEventListener?.("change", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      media?.removeEventListener?.("change", onPop);
    };
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => setWorkspaceMode(!active)}
      aria-pressed={active}
      aria-label={active ? "Exit workspace mode" : "Enter workspace mode"}
      title={
        active
          ? "Exit workspace mode — return to plain chat"
          : "Enter workspace mode — operator-console cards take over the chat reading area"
      }
      className={[
        // Toggle sits above the workspace pane (z-80) so users can dismiss
        // mid-run without hunting for the close button inside the pane.
        "fixed z-[85] inline-flex items-center gap-2 rounded-full border px-3 py-1.5",
        "text-[12px] font-semibold leading-none transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40",
        // Position: bottom-right on mobile (stacks above bottom-nav), top-right on desktop
        "right-4 bottom-[calc(72px+env(safe-area-inset-bottom,0px))] xl:bottom-auto xl:top-4",
        active
          ? "border-[color:color-mix(in_oklab,var(--accent-primary)_40%,transparent)] bg-[var(--accent-primary)] text-white shadow-[var(--shadow-accent)]"
          : "border-[var(--border-color)] bg-[var(--bg-primary)]/90 text-[var(--text-primary)] backdrop-blur shadow-[var(--shadow-sm)] hover:bg-[var(--bg-hover)]",
      ].join(" ")}
    >
      {active ? (
        <>
          <MessageSquare size={14} strokeWidth={1.8} aria-hidden="true" />
          Exit workspace
        </>
      ) : (
        <>
          <LayoutDashboard size={14} strokeWidth={1.8} aria-hidden="true" />
          Workspace mode
        </>
      )}
    </button>
  );
}
