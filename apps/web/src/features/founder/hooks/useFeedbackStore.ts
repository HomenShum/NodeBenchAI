/**
 * useFeedbackStore — localStorage-backed feedback collection hook.
 *
 * No Convex dependency. Pure client-side storage for user feedback items.
 * Each item captures rating, comment, category, surface context, and timestamp.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";

// ── Types ────────────────────────────────────────────────────────────────────

export type FeedbackCategory =
  | "Output quality"
  | "Speed"
  | "Relevance"
  | "Missing feature"
  | "Bug"
  | "Other";

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  "Output quality",
  "Speed",
  "Relevance",
  "Missing feature",
  "Bug",
  "Other",
];

export interface FeedbackItem {
  id: string;
  rating: number;
  comment: string;
  category: FeedbackCategory;
  timestamp: number;
  surface: string;
  pathname: string;
}

export interface FeedbackStore {
  feedbackItems: FeedbackItem[];
  submitFeedback: (input: {
    rating: number;
    comment: string;
    category: FeedbackCategory;
  }) => void;
  averageRating: number;
  totalCount: number;
  categoryBreakdown: Record<FeedbackCategory, number>;
}

// ── Storage key & helpers ────────────────────────────────────────────────────

const STORAGE_KEY = "nodebench_feedback";
const MAX_ITEMS = 500;

let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "[]";
}

function getServerSnapshot(): string {
  return "[]";
}

function readItems(): FeedbackItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeItems(items: FeedbackItem[]): void {
  // Keep bounded — evict oldest when over MAX_ITEMS
  const bounded = items.length > MAX_ITEMS ? items.slice(-MAX_ITEMS) : items;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  emitChange();
}

function deriveSurface(pathname: string): string {
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const surface = searchParams.get("surface");
  if (surface) return surface;

  // Derive from pathname
  if (pathname.startsWith("/deep-sim") || pathname.startsWith("/memo"))
    return "memo";
  if (pathname.startsWith("/research")) return "research";
  if (pathname.startsWith("/editor") || pathname.startsWith("/workspace"))
    return "editor";
  if (pathname.startsWith("/telemetry") || pathname.startsWith("/oracle"))
    return "telemetry";
  return "ask";
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFeedbackStore(): FeedbackStore {
  const location = useLocation();

  // Subscribe to localStorage changes via useSyncExternalStore
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const feedbackItems = useMemo<FeedbackItem[]>(() => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [raw]);

  const submitFeedback = useCallback(
    (input: {
      rating: number;
      comment: string;
      category: FeedbackCategory;
    }) => {
      const item: FeedbackItem = {
        id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        rating: Math.max(1, Math.min(5, Math.round(input.rating))),
        comment: input.comment.trim().slice(0, 500),
        category: input.category,
        timestamp: Date.now(),
        surface: deriveSurface(location.pathname),
        pathname: location.pathname,
      };
      const current = readItems();
      writeItems([...current, item]);
    },
    [location.pathname],
  );

  const averageRating = useMemo(() => {
    if (feedbackItems.length === 0) return 0;
    const sum = feedbackItems.reduce((acc, item) => acc + item.rating, 0);
    return Math.round((sum / feedbackItems.length) * 10) / 10;
  }, [feedbackItems]);

  const totalCount = feedbackItems.length;

  const categoryBreakdown = useMemo(() => {
    const breakdown: Record<FeedbackCategory, number> = {
      "Output quality": 0,
      Speed: 0,
      Relevance: 0,
      "Missing feature": 0,
      Bug: 0,
      Other: 0,
    };
    for (const item of feedbackItems) {
      if (item.category in breakdown) {
        breakdown[item.category]++;
      }
    }
    return breakdown;
  }, [feedbackItems]);

  return {
    feedbackItems,
    submitFeedback,
    averageRating,
    totalCount,
    categoryBreakdown,
  };
}
