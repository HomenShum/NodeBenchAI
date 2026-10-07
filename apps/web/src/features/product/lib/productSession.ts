export interface ProductDraftFile {
  evidenceId?: string;
  name: string;
  type: string;
  size?: number;
}

export interface ProductDraftSession {
  query: string;
  lens: string;
  files: ProductDraftFile[];
  updatedAt: number;
}

const PRODUCT_DRAFT_KEY = "nodebench:product-draft";
const PRODUCT_LAST_CHAT_PATH_KEY = "nodebench:last-chat-path";
const PRODUCT_SHAREABLE_QUERY_MAX = 280;

function canUseStorage() {
  return typeof window !== "undefined" && !!window.sessionStorage;
}

export function loadProductDraft(): ProductDraftSession | null {
  if (!canUseStorage()) return null;

  try {
    const raw = window.sessionStorage.getItem(PRODUCT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProductDraftSession>;
    if (!parsed || typeof parsed.query !== "string") return null;

    return {
      query: parsed.query,
      lens: typeof parsed.lens === "string" ? parsed.lens : "founder",
      files: Array.isArray(parsed.files)
        ? parsed.files.filter(
            (file): file is ProductDraftFile =>
              !!file &&
              typeof file.name === "string" &&
              typeof file.type === "string" &&
              (file.evidenceId === undefined || typeof file.evidenceId === "string"),
          )
        : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveProductDraft(input: {
  query: string;
  lens: string;
  files?: ProductDraftFile[];
}) {
  if (!canUseStorage()) return;

  const next: ProductDraftSession = {
    query: input.query,
    lens: input.lens,
    files: input.files ?? [],
    updatedAt: Date.now(),
  };

  try {
    window.sessionStorage.setItem(PRODUCT_DRAFT_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures in private/incognito contexts.
  }
}

export function shouldPersistDraftQueryInUrl(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (trimmed.length > PRODUCT_SHAREABLE_QUERY_MAX) return false;
  return !/[\r\n]/.test(trimmed);
}

export function clearProductDraft() {
  if (!canUseStorage()) return;

  try {
    window.sessionStorage.removeItem(PRODUCT_DRAFT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function loadLastChatPath(): string | null {
  if (!canUseStorage()) return null;

  try {
    const raw = window.sessionStorage.getItem(PRODUCT_LAST_CHAT_PATH_KEY);
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.startsWith("/?surface=chat") ? trimmed : null;
  } catch {
    return null;
  }
}

export function saveLastChatPath(path: string | null) {
  if (!canUseStorage()) return;

  try {
    if (!path || !path.trim()) {
      window.sessionStorage.removeItem(PRODUCT_LAST_CHAT_PATH_KEY);
      return;
    }
    const normalized = path.trim();
    if (!normalized.startsWith("/?surface=chat")) return;
    window.sessionStorage.setItem(PRODUCT_LAST_CHAT_PATH_KEY, normalized);
  } catch {
    // Ignore storage failures in private/incognito contexts.
  }
}

/* Recent searches (localStorage, persists across sessions) */

const RECENT_KEY = "nb:product:recent";
const MAX_RECENT = 5;

export interface RecentSearch {
  query: string;
  lens: string;
  ts: number;
}

export function formatRecentSearchLabel(query: string, maxLength = 140) {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const suffix = "...";
  return `${normalized.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

export function getRecentSearches(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string, lens: string) {
  if (typeof window === "undefined") return;
  try {
    const recent = getRecentSearches().filter((r) => r.query !== query);
    recent.unshift({ query, lens, ts: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // Ignore storage failures in private/incognito contexts.
  }
}
