/**
 * useScratchnodeSessionId — read the anonymous ScratchNode session id
 * that scratchnode.live writes to localStorage under `sn_session_id`.
 *
 * Identity contract: ScratchNode writes a crypto.randomUUID() to
 * localStorage.sn_session_id on first visit (see
 * public/proto/home-v5.html ~line 3035). Same Convex deployment, so the
 * same id can be used as the `ownerKey` for convex/notes.ts reads from
 * nodebenchai.com. If the user has never visited scratchnode.live in
 * this browser, sn_session_id is null → empty state.
 *
 * Hook (not a one-line read) because localStorage isn't available during
 * SSR AND we need a discriminated state so the surface can distinguish
 * "still loading" from "definitively no session" — without that
 * distinction the empty-state flickers on first paint.
 */

import { useEffect, useState } from "react";

export type ScratchnodeSessionIdState =
  | { status: "loading"; sessionId: null }
  | { status: "missing"; sessionId: null }
  | { status: "ready"; sessionId: string };

const STORAGE_KEY = "sn_session_id";

export function useScratchnodeSessionId(): ScratchnodeSessionIdState {
  const [state, setState] = useState<ScratchnodeSessionIdState>({
    status: "loading",
    sessionId: null,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      setState({ status: "missing", sessionId: null });
      return;
    }
    try {
      const id = window.localStorage.getItem(STORAGE_KEY);
      // UUIDv4 (36 chars) or "sess_<ts>_<rand>" (>= 8 chars). Matches the
      // validation in convex/events.ts requireMember.
      if (id && typeof id === "string" && id.length >= 8 && id.length <= 64) {
        setState({ status: "ready", sessionId: id });
      } else {
        setState({ status: "missing", sessionId: null });
      }
    } catch {
      // Private-mode browsers throw on localStorage access.
      setState({ status: "missing", sessionId: null });
    }
  }, []);

  return state;
}
