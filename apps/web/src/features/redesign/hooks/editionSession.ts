/**
 * Local helper for the editorial home — read the same anonymous
 * session ID the rest of the product uses so guest pulses, reports,
 * nudges, and Inbox rows route to the same owner. We intentionally do
 * not generate a new ID here because read-only edition queries should
 * not create identity as a side effect.
 */

const PRODUCT_STORAGE_KEY = "nodebench:product-anon-session";
const LEGACY_STORAGE_KEY = "nodebench:anonymous:sessionId";
const PRODUCT_COOKIE_KEY = "nodebench_product_anon_session";

function readCookieSessionId(): string | undefined {
  if (typeof document === "undefined" || typeof document.cookie !== "string") {
    return undefined;
  }
  const prefix = `${PRODUCT_COOKIE_KEY}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

export function getStoredAnonymousSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return (
      localStorage.getItem(PRODUCT_STORAGE_KEY) ??
      sessionStorage.getItem(PRODUCT_STORAGE_KEY) ??
      readCookieSessionId() ??
      localStorage.getItem(LEGACY_STORAGE_KEY) ??
      undefined
    );
  } catch {
    return undefined;
  }
}
