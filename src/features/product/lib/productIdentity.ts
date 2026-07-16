const PRODUCT_ANON_SESSION_KEY = "nodebench:product-anon-session";
const PRODUCT_ANON_COOKIE_KEY = "nodebench_product_anon_session";
let inMemoryAnonymousSessionId: string | null = null;

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage && !!window.sessionStorage;
}

function canUseDocumentCookie() {
  return typeof document !== "undefined" && typeof document.cookie === "string";
}

function createAnonymousSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `anon-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function readStoredAnonymousSessionId() {
  if (typeof window !== "undefined") {
    const urlSession = readAnonymousSessionFromUrl();
    if (urlSession) return urlSession;
  }
  if (canUseStorage()) {
    const persisted = window.localStorage.getItem(PRODUCT_ANON_SESSION_KEY);
    if (persisted) return persisted;
    const tabScoped = window.sessionStorage.getItem(PRODUCT_ANON_SESSION_KEY);
    if (tabScoped) return tabScoped;
  }
  const cookieScoped = readAnonymousSessionFromCookie();
  if (cookieScoped) return cookieScoped;
  return null;
}

function persistAnonymousSessionId(sessionId: string) {
  if (canUseStorage()) {
    window.localStorage.setItem(PRODUCT_ANON_SESSION_KEY, sessionId);
    window.sessionStorage.setItem(PRODUCT_ANON_SESSION_KEY, sessionId);
  }
  if (canUseDocumentCookie()) {
    document.cookie = `${PRODUCT_ANON_COOKIE_KEY}=${encodeURIComponent(sessionId)}; path=/; max-age=31536000; samesite=lax`;
  }
}

export function getAnonymousProductSessionId() {
  try {
    const existing = readStoredAnonymousSessionId();
    if (existing) {
      persistAnonymousSessionId(existing);
      return existing;
    }
    const next = createAnonymousSessionId();
    persistAnonymousSessionId(next);
    return next;
  } catch {
    inMemoryAnonymousSessionId ??= createAnonymousSessionId();
    return inMemoryAnonymousSessionId;
  }
}

function readAnonymousSessionFromCookie() {
  if (!canUseDocumentCookie()) return null;
  const prefix = `${PRODUCT_ANON_COOKIE_KEY}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(prefix.length));
  return isValidAnonymousSessionId(value) ? value : null;
}

function readAnonymousSessionFromUrl() {
  if (!import.meta.env.DEV && !isLocalHost(window.location.hostname)) return null;
  const value = new URL(window.location.href).searchParams.get("nbSession");
  return value && isValidAnonymousSessionId(value) ? value : null;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isValidAnonymousSessionId(value: string) {
  return /^[a-zA-Z0-9._:-]{3,160}$/.test(value);
}
