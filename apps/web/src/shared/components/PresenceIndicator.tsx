import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import usePresence from "@convex-dev/presence/react";
import FacePile from "@convex-dev/presence/facepile";
import { useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useEffect, useRef, useMemo, useState } from "react";

// Toggle presence debug logs in the browser console by setting VITE_DEBUG_PRESENCE=true
// e.g., in .env.local: VITE_DEBUG_PRESENCE=true
const DEBUG_PRESENCE: boolean = (import.meta as any)?.env?.VITE_DEBUG_PRESENCE === "true";
// NEW: configurable heartbeat and idle thresholds via env (with safe fallbacks)
const DEFAULT_HEARTBEAT_MS: number = Number((import.meta as any)?.env?.VITE_PRESENCE_HEARTBEAT_MS) || 30000; // NEW
const DEFAULT_IDLE_MS: number = Number((import.meta as any)?.env?.VITE_PRESENCE_IDLE_MS) || 120000; // NEW

interface PresenceIndicatorProps {
  documentId: Id<"documents">;
  userId: string;
  // NEW: optional overrides for tuning presence behavior without code changes
  intervalMs?: number; // heartbeat interval override
  idleMs?: number; // idle timeout before pausing presence
}

function PresenceCore({ documentId, userId, intervalMs }: PresenceIndicatorProps) {
  // NEW: pass interval to presence hook to reduce heartbeat frequency when desired
  const presenceState = usePresence(api.presence, documentId, userId, intervalMs ?? DEFAULT_HEARTBEAT_MS);
  // Normalize to avoid conditional hooks later and stabilize reference
  const validPresenceState = useMemo(
    () => (Array.isArray(presenceState) ? presenceState : []),
    [presenceState],
  );

  // Debug: heartbeat active
  useEffect(() => {
    if (DEBUG_PRESENCE) {
      console.debug("PresenceCore: heartbeat active", { documentId, userId });
    }
  }, [documentId, userId]);

  // Debug: presence state changes (logs only when length changes)
  const prevLenRef = useRef<number>(validPresenceState.length);
  useEffect(() => {
    if (!DEBUG_PRESENCE) return;
    const len = validPresenceState.length;
    if (prevLenRef.current !== len) {
      console.debug("PresenceCore: state update", {
        count: len,
        users: validPresenceState.map((u: any) => ({ userId: u.userId, online: u.online })),
      });
      prevLenRef.current = len;
    }
  }, [validPresenceState]);

  // Add better error handling and loading states
  if (!presenceState) {
    return null;
  }

  if (validPresenceState.length === 0) {
    return null;
  }

  // Generate avatar colors based on userId hash
  const getAvatarColor = (id: string): string => {
    const colors = [
      "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500",
      "bg-amber-500", "bg-cyan-500", "bg-rose-500", "bg-indigo-500",
    ];
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  return (
    <div className="flex items-center gap-2">
      {/* Overlapping Avatar Bubbles */}
      <div className="flex -space-x-2">
        {validPresenceState.slice(0, 5).map((user: any, index: number) => {
          const isCurrentUser = user.userId === userId;
          const initial = (user.name || user.userId || "?").charAt(0).toUpperCase();
          const avatarColor = getAvatarColor(user.userId || "");

          return (
            <div
              key={user.userId || index}
              className={`relative w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold border-2 border-white shadow-sm ${avatarColor} ${isCurrentUser ? "ring-2 ring-blue-400 ring-offset-1" : ""}`}
              title={isCurrentUser ? "You" : (user.name || `User ${user.userId?.slice(-4)}`)}
              style={{ zIndex: validPresenceState.length - index }}
            >
              {user.image ? (
                <img src={user.image} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                initial
              )}
              {isCurrentUser && (
                <span className="absolute -bottom-1 -right-1 bg-blue-500 text-[8px] text-white px-1 rounded-sm font-bold shadow">
                  YOU
                </span>
              )}
            </div>
          );
        })}
        {validPresenceState.length > 5 && (
          <div
            className="w-7 h-7 rounded-full bg-surface-secondary text-content-secondary flex items-center justify-center text-xs font-medium border-2 border-white shadow-sm"
            title={`+${validPresenceState.length - 5} more`}
          >
            +{validPresenceState.length - 5}
          </div>
        )}
      </div>

      {/* Label */}
      <span className="text-xs text-content-muted whitespace-nowrap">
        {validPresenceState.length === 1 ? "just you" : `${validPresenceState.length} editing`}
      </span>
    </div>
  );
}

export function PresenceIndicator({ documentId, userId, intervalMs, idleMs: idleMsProp }: PresenceIndicatorProps) {
  // 1) Ensure we have a client-side auth token
  const token = useAuthToken();
  // 2) Ensure the server sees the authenticated user before starting heartbeats
  const serverUserId = useQuery(api.domains.auth.presence.getUserId, token ? {} : "skip");

  // NEW: Idle gating to reduce network traffic when the page is visible but the user is inactive
  const [enabled, setEnabled] = useState<boolean>(true); // NEW
  const idleMs = idleMsProp ?? DEFAULT_IDLE_MS; // NEW
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // NEW

  // NEW: reset idle timer on user activity
  useEffect(() => {
    const resetIdle = () => {
      if (!enabled && DEBUG_PRESENCE) {
        console.debug("PresenceIndicator: re-enabling due to activity");
      }
      setEnabled(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (DEBUG_PRESENCE) {
          console.debug("PresenceIndicator: disabling due to idle");
        }
        setEnabled(false);
      }, idleMs);
    };

    // Start/refresh timer immediately on mount/changes
    resetIdle();

    // Common activity signals with stable handler
    const events = ["pointermove", "keydown", "focusin"]; // NEW
    const handleActivity = () => resetIdle();
    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }));

    // Pause immediately when tab is hidden; resume timer when visible
    const onVisibility = () => {
      if (document.hidden) {
        if (DEBUG_PRESENCE) console.debug("PresenceIndicator: page hidden -> disabling");
        setEnabled(false);
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
      } else {
        resetIdle();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [idleMs, enabled]);

  // Guard: must have a userId prop, a token, and the server must confirm the same user
  if (!userId || !token || !serverUserId || serverUserId !== userId) {
    if (DEBUG_PRESENCE) {
      console.debug("PresenceIndicator: gated", {
        hasUserId: !!userId,
        hasToken: !!token,
        serverUserId,
        userId,
      });
    }
    return null;
  }

  if (DEBUG_PRESENCE) {
    console.debug("PresenceIndicator: starting presence", {
      documentId,
      userId,
    });
  }

  return enabled ? (
    <PresenceCore
      documentId={documentId}
      userId={userId}
      intervalMs={intervalMs ?? DEFAULT_HEARTBEAT_MS} // NEW: provide configurable heartbeat interval
    />
  ) : null;
}
