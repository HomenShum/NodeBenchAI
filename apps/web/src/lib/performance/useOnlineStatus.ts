/**
 * useOnlineStatus — reactive online/offline status for the browser and
 * the Convex websocket.
 *
 * Pattern: SWR offline detection.  Returning visitors who lose network
 * connectivity should see an honest "you're offline — showing cached
 * data" banner rather than silently consuming stale cache forever.
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — `online` reflects the real `navigator.onLine` value
 *                    and reacts to `online`/`offline` events.
 *                    `convexConnected` reflects the live Convex
 *                    websocket health when exposed by the client.
 *  - ERROR_BOUNDARY — every browser API is feature-detected; if the
 *                    runtime doesn't support `navigator.onLine` or
 *                    Convex doesn't expose `useConvexConnectionState`
 *                    we default to `true` so we don't false-alarm.
 *  - DETERMINISTIC — pure function of browser state; no random IDs.
 *
 * Per `.claude/rules/reexamine_a11y.md`:
 *  - The consumer of this hook should pair the offline banner with an
 *    icon/text label, not just a color, for color-blind safety.
 *  - The banner should be `role="status"` + `aria-live="polite"` so
 *    screen readers announce it without interrupting the user.
 *
 * Per `.claude/rules/reexamine_resilience.md`:
 *  - Graceful degradation: when offline, SWR will keep serving the
 *    last cached value.  This hook only adds the user-visible signal
 *    that the data is stale, not a hard failure.
 */

import { useEffect, useState } from "react";
import { useConvexConnectionState } from "convex/react";

export interface OnlineStatus {
  /** True when `navigator.onLine === true` (or the browser doesn't expose it). */
  online: boolean;
  /**
   * True when the Convex client reports `isWebSocketConnected === true`,
   * OR when Convex doesn't expose its connection state to us.  We
   * default to `true` (rather than `false`) so we don't false-alarm
   * in environments where this signal isn't available.
   */
  convexConnected: boolean;
}

/** Detect `navigator.onLine` without throwing on non-browser runtimes. */
function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  // Some embedded webviews return `undefined` — treat as online.
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

export function useOnlineStatus(): OnlineStatus {
  const [online, setOnline] = useState<boolean>(readOnline);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Resync on mount in case the initial render missed a transition.
    setOnline(readOnline());
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Convex connection state — `useConvexConnectionState` is reactive
  // and re-renders when `isWebSocketConnected` flips.  This hook must
  // be called unconditionally on every render (React hooks rule).  If
  // a future Convex version changes the shape, we still default to
  // `true` so we never invent an offline state from a missing field.
  const cs = useConvexConnectionState();
  const convexConnected =
    cs && typeof cs.isWebSocketConnected === "boolean"
      ? cs.isWebSocketConnected
      : true;

  return { online, convexConnected };
}
