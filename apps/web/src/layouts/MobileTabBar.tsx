/**
 * MobileTabBar — fixed bottom navigation for compact layouts below xl.
 *
 * Replaces the hidden WorkspaceRail sidebar on mobile.
 * Mirrors SitFlow's tab bar: 56px height + safe-area padding,
 * haptic feedback, smart badge (hides when focused), terracotta active indicator.
 */

import { memo } from "react";
import { useLocation } from "react-router-dom";
import { FileText, Home, Inbox, MessageSquare, User } from "lucide-react";
import type { CockpitSurfaceId } from "@/lib/registry/viewRegistry";
import "@/features/designKit/exact/exactKit.css";

interface MobileTabBarProps {
  activeSurface: CockpitSurfaceId;
  onSurfaceChange: (surface: CockpitSurfaceId) => void;
  agentActive?: boolean;
  unreadBriefCount?: number;
  hidden?: boolean;
}

const TABS: readonly {
  id: CockpitSurfaceId;
  label: string;
  icon: typeof MessageSquare;
}[] = [
  { id: "ask", label: "Home", icon: Home },
  { id: "packets", label: "Reports", icon: FileText },
  { id: "workspace", label: "Chat", icon: MessageSquare },
  { id: "history", label: "Inbox", icon: Inbox },
  { id: "connect", label: "Me", icon: User },
];

export const MobileTabBar = memo(function MobileTabBar({
  activeSurface,
  onSurfaceChange,
  agentActive: _agentActive = false,
  unreadBriefCount = 0,
  hidden = false,
}: MobileTabBarProps) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const hasFocusedChatRun = Boolean(
    searchParams.get("session")?.trim() ||
      searchParams.get("q")?.trim() ||
      searchParams.get("draft")?.trim(),
  );
  const hideForActiveChatThread = hasFocusedChatRun;

  if (hidden || hideForActiveChatThread) {
    return null;
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 xl:hidden"
      role="navigation"
      aria-label="Mobile navigation"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="m-tabbar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSurface === tab.id;
          const showBadge =
            tab.id === "history" && unreadBriefCount > 0 && !isActive;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                onSurfaceChange(tab.id);
                if (typeof navigator?.vibrate === "function") navigator.vibrate(10);
              }}
              className="m-tab"
              data-active={isActive ? "true" : "false"}
              aria-current={isActive ? "page" : undefined}
              aria-label={tab.label}
              data-agent-id={`cockpit:mobile-surface:${tab.id}`}
              data-agent-action="navigate"
              data-agent-label={tab.label}
            >
              <span className="relative">
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                {showBadge && (
                  <span className="m-tab-badge">
                    {unreadBriefCount > 9 ? "9+" : unreadBriefCount}
                  </span>
                )}
              </span>
              <span className="m-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});

export default MobileTabBar;
