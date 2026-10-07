/**
 * The single-surface header intentionally contains no product navigation.
 * The composer is NodeBench's only command surface; the header retains only
 * identity, explicit authentication, and theme preference.
 */

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ai-ui/dropdown-menu";
import { VoiceCostBadge } from "@/features/voice";
import { useCurrentUserId } from "@/hooks/useCurrentUser";

interface TopNavProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function TopNav({ theme, onToggleTheme }: TopNavProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const userId = useCurrentUserId();

  const onSignIn = () => {
    void Promise.resolve(
      signIn("google", {
        redirectTo: typeof window !== "undefined" ? window.location.href : "/redesign/chat",
      }),
    ).catch(() => undefined);
  };

  const onSignOut = () => {
    void Promise.resolve(signOut()).catch(() => undefined);
  };

  return (
    <header
      data-rd-topnav
      data-testid="one-surface-header"
      role="banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "7px clamp(14px, 2.2vw, 28px)",
        minHeight: 48,
        borderBottom: "1px solid var(--rd-line-faint)",
        background: "var(--rd-paper)",
        flexShrink: 0,
        zIndex: 20,
      }}
    >
      <a
        href="/redesign/chat"
        aria-label="NodeBench decision workspace"
        style={{
          color: "var(--rd-ink-strong)",
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "-0.3px",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Node<span style={{ color: "var(--rd-accent)" }}>Bench</span>
      </a>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7 }}>
        {!isLoading && !isAuthenticated && (
          <button
            type="button"
            onClick={onSignIn}
            className="rd-btn rd-btn--quiet rd-btn--sm"
            data-rd-account-slot
            style={{ minHeight: 32, padding: "6px 10px", fontSize: 12 }}
          >
            Sign in
          </button>
        )}

        {isAuthenticated && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-rd-account-slot
                aria-label="Account menu"
                title="Account"
                className="rd-account-trigger"
              >
                NB
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rd-account-menu">
              <DropdownMenuLabel>NodeBench account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {userId && <VoiceCostBadge userId={userId} className="rd-account-voice" />}
              {userId && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={onSignOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="rd-btn rd-btn--quiet"
          style={{
            width: 32,
            height: 32,
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
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
