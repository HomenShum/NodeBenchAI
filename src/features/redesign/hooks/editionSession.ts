/**
 * Local helper for the editorial home — read the same anonymous
 * session ID the rest of the app uses so guest pulses route to the
 * same owner.  Mirrors useAnonymousSession's storage contract; we
 * intentionally do *not* generate a new ID here (avoid double-create).
 */

const STORAGE_KEY = "nodebench:anonymous:sessionId";

export function getStoredAnonymousSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ?? undefined;
  } catch {
    return undefined;
  }
}
