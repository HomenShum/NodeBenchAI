import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth, useQuery} from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  Inbox,
  LogIn,
  MessageSquare,
  Search,
  User,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import type { CockpitSurfaceId } from "@/lib/registry/viewRegistry";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { useProductBootstrap } from "@/features/product/lib/useProductBootstrap";
import { cn } from "@/lib/utils";

interface SurfaceShortcut {
  id: CockpitSurfaceId;
  label: string;
  icon: LucideIcon;
  color: string;
}

const SURFACE_SHORTCUTS: SurfaceShortcut[] = [
  { id: "ask", label: "Home", icon: Home, color: "currentColor" },
  { id: "packets", label: "Reports", icon: FileText, color: "currentColor" },
  { id: "workspace", label: "Chat", icon: MessageSquare, color: "currentColor" },
  { id: "history", label: "Inbox", icon: Inbox, color: "currentColor" },
  { id: "connect", label: "Me", icon: User, color: "currentColor" },
];

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

interface WorkspaceRailProps {
  activeSurface: CockpitSurfaceId;
  onSurfaceChange: (surface: CockpitSurfaceId) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
}

export const WorkspaceRail = memo(function WorkspaceRail({
  activeSurface,
  onSurfaceChange,
  isCollapsed,
  onToggleCollapse,
  onOpenSettings,
  onOpenPalette,
}: WorkspaceRailProps) {
  useProductBootstrap();

  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();

  const shellSnapshot = useQuery(
    api?.domains.product.shell.getWorkspaceRailSnapshot
      ? api.domains.product.shell.getWorkspaceRailSnapshot
      : "skip",
    api?.domains.product.shell.getWorkspaceRailSnapshot
      ? { anonymousSessionId }
      : "skip",
  );

  const sessionItems = Array.isArray(shellSnapshot?.recentChats) ? shellSnapshot.recentChats : [];
  const reportItems = Array.isArray(shellSnapshot?.recentReports) ? shellSnapshot.recentReports : [];
  const nudgeItems = Array.isArray(shellSnapshot?.openNudges) ? shellSnapshot.openNudges : [];
  return (
    <nav
      className={cn(
        "hidden xl:flex shrink-0 flex-col border-r border-black/[0.05] bg-white/[0.68] backdrop-blur-2xl transition-[width] duration-200 ease-in-out dark:border-white/[0.05] dark:bg-[#0b1016]/[0.92]",
        isCollapsed ? "w-12" : "w-[236px]",
      )}
      id="main-navigation"
      role="navigation"
      aria-label="Primary navigation"
      data-agent-id="cockpit:workspace-rail"
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-black/[0.05] px-3 py-3 dark:border-white/[0.05]",
          isCollapsed && "justify-center px-0",
        )}
      >
        <button
          type="button"
          onClick={() => onSurfaceChange("ask")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-black/[0.05] bg-white text-sm font-bold text-content shadow-[0_12px_28px_-20px_rgba(15,23,42,0.22)] transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.06] dark:shadow-[0_16px_36px_-24px_rgba(0,0,0,0.88)] dark:hover:bg-white/[0.08]"
          aria-label="Open home"
        >
          N
        </button>
        {!isCollapsed ? (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-content">NodeBench</div>
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-content-muted">Threads first. Reports when ready.</div>
          </div>
        ) : null}
      </div>

      {/* ── Command palette trigger — primary action, right after brand ── */}
      {onOpenPalette && (
        <div className={cn("px-2 pt-2 pb-1", isCollapsed && "flex justify-center px-1")}>
          <button
            type="button"
            onClick={onOpenPalette}
            className={cn(
              "flex items-center gap-2 rounded-[14px] border border-black/[0.05] bg-black/[0.02] text-content-muted transition-colors hover:border-black/[0.08] hover:bg-black/[0.03] hover:text-content dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.05]",
              isCollapsed ? "h-9 w-9 justify-center" : "w-full px-3 py-2 text-xs",
            )}
            aria-label="Search or jump (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
            {!isCollapsed && (
              <>
                <span className="flex-1 text-left">Search...</span>
                <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] opacity-50">
                  {isMac ? "⌘K" : "Ctrl+K"}
                </kbd>
              </>
            )}
          </button>
        </div>
      )}

      <div className={cn("flex flex-col gap-1 px-2 py-2", isCollapsed && "items-center px-0")}>
        {SURFACE_SHORTCUTS.map((shortcut) => {
          const Icon = shortcut.icon;
          const isActive = activeSurface === shortcut.id;
          return (
            <button
              key={shortcut.id}
              type="button"
              onClick={() => onSurfaceChange(shortcut.id)}
              aria-label={shortcut.label}
              aria-current={isActive ? "page" : undefined}
              data-agent-id={`cockpit:surface:${shortcut.id}`}
              data-agent-action="navigate"
              className={cn(
                "flex items-center gap-2.5 rounded-[14px] text-[13px] font-medium transition-all duration-150",
                isCollapsed ? "mx-auto h-9 w-9 justify-center" : "px-2.5 py-1.5",
                isActive
                  ? "bg-white text-gray-900 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.18),inset_0_0_0_1px_rgba(15,23,42,0.06)] dark:bg-white/[0.08] dark:text-white dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                  : "text-content-muted hover:bg-black/[0.03] hover:text-content dark:hover:bg-white/[0.04]",
              )}
              style={isActive ? { color: shortcut.color } : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed ? <span>{shortcut.label}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessionItems.length > 0 && (
          <RailSection
            collapsed={isCollapsed}
            title="Recent chats"
            items={sessionItems.map((session) => ({
              id: String(session._id),
              label: session.title ?? session.query ?? "Untitled chat",
              detail: session.status,
              icon: Bot,
              onClick: () =>
                navigate(
                  buildCockpitPath({
                    surfaceId: "workspace",
                    extra: {
                      q: session.query ?? null,
                      lens: session.lens ?? null,
                    },
                  }),
                ),
            }))}
          />
        )}

        {reportItems.length > 0 && (
          <RailSection
            collapsed={isCollapsed}
            title="Recent reports"
            items={reportItems.map((report) => ({
              id: String(report._id),
              label: report.title ?? "Untitled report",
              detail: report.type ?? "report",
              icon: FileText,
              onClick: () => navigate(buildCockpitPath({ surfaceId: "packets" })),
            }))}
          />
        )}

        {nudgeItems.length > 0 && (
          <RailSection
            collapsed={isCollapsed}
            title="Open inbox"
            items={nudgeItems.map((nudge) => ({
              id: String(nudge._id),
              label: nudge.title ?? "Inbox item",
              detail: nudge.priority ?? "open",
              icon: Bell,
              onClick: () => navigate(buildCockpitPath({ surfaceId: "history" })),
            }))}
          />
        )}
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 border-t border-black/[0.05] px-2 py-3 dark:border-white/[0.05]",
          isCollapsed && "items-center",
        )}
      >
        {/* Auth: signed in — profile + settings */}
        {isAuthenticated ? (
          <div className={cn("flex items-center", isCollapsed ? "flex-col gap-1" : "gap-2")}>
            <button
              type="button"
              onClick={() => navigate(buildCockpitPath({ surfaceId: "connect" }))}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/[0.05] bg-white/[0.78] transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
              aria-label="Operator profile"
            >
              <User className="h-4 w-4 text-content-muted" />
            </button>
            {!isCollapsed && (
              <span className="flex-1 truncate text-[12px] text-content-secondary">Operator</span>
            )}
            {!isCollapsed && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                data-testid="open-settings"
                className="flex h-7 w-7 items-center justify-center rounded-[10px] text-content-muted transition-colors hover:bg-black/[0.03] hover:text-content dark:hover:bg-white/[0.06]"
                aria-label="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          /* Auth: guest — sign in CTA */
          !isCollapsed ? (
            <button
              type="button"
              onClick={() => void signIn("anonymous")}
              className="flex w-full items-center gap-2 rounded-lg border border-accent-primary/20 bg-accent-primary/[0.06] px-3 py-2 text-xs font-medium text-accent-primary transition-all hover:bg-accent-primary/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/30 active:scale-[0.99]"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign in anonymously</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void signIn("anonymous")}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-accent-primary transition-all hover:bg-accent-primary/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/30 active:scale-[0.96]"
              aria-label="Sign in anonymously"
            >
              <LogIn className="h-4 w-4" />
            </button>
          )
        )}

        {/* Collapse toggle — always visible */}
        <div className={cn("flex", isCollapsed ? "justify-center" : "justify-end")}>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex h-7 w-7 items-center justify-center rounded-[10px] text-content-muted transition-colors hover:bg-black/[0.03] hover:text-content dark:hover:bg-white/[0.06]"
            aria-label={isCollapsed ? "Expand workspace rail" : "Collapse workspace rail"}
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </nav>
  );
});

function RailSection({
  collapsed,
  title,
  items,
}: {
  collapsed: boolean;
  title: string;
  items: Array<{ id: string; label: string; detail: string; icon: LucideIcon; onClick: () => void }>;
}) {
  return (
    <section className="px-2 pb-3">
      {!collapsed ? (
        <div className="px-1 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-content-muted">
          {title}
        </div>
      ) : null}
      <div className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              className={cn(
                "flex items-center gap-2 rounded-[12px] text-left text-[12px] text-content-secondary transition-colors hover:bg-black/[0.03] hover:text-content dark:hover:bg-white/[0.04]",
                collapsed ? "mx-auto h-9 w-9 justify-center" : "px-2.5 py-1.5",
              )}
              aria-label={collapsed ? item.label : undefined}
              title={item.label}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-content-muted" />
              {!collapsed ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  <span className="block truncate text-[11px] text-content-muted">{item.detail}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default WorkspaceRail;
