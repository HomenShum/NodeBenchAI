/**
 * analytics.ts — Lightweight self-hosted event tracking.
 *
 * - trackEvent(name, properties?) records UI events
 * - Bounded ring buffer of 200 events (BOUND)
 * - Respects Do Not Track: navigator.doNotTrack === '1' → no-op
 * - Exposes getEventStream() for telemetry/system surface
 * - Optional Convex mutation hook for server-side persistence
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AnalyticsEvent {
  name: string;
  properties: Record<string, string | number>;
  timestamp: number;
  surface: string;
  path: string;
}

type ConvexAnalyticsReporter = (event: AnalyticsEvent) => void;

// ── State ──────────────────────────────────────────────────────────────────────

const MAX_EVENTS = 200;
const events: AnalyticsEvent[] = [];
let convexReporter: ConvexAnalyticsReporter | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isDoNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.doNotTrack === "1";
}

function currentSurface(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const querySurface = params.get("surface");
    if (querySurface && querySurface.trim().length > 0) {
      return querySurface.trim();
    }
    const segment = window.location.pathname.split("/").filter(Boolean)[0];
    return segment || "home";
  } catch {
    return "unknown";
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Track a named event with optional properties.
 * No-ops if Do Not Track is enabled.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, string | number>,
): void {
  if (isDoNotTrack()) return;

  const event: AnalyticsEvent = {
    name,
    properties: properties ?? {},
    timestamp: Date.now(),
    surface: currentSurface(),
    path: typeof window !== "undefined" ? window.location.pathname : "/",
  };

  // BOUND: evict oldest when at capacity
  if (events.length >= MAX_EVENTS) {
    events.shift();
  }
  events.push(event);

  // Dev mode: log events
  if (import.meta.env.DEV) {
    console.debug("[NodeBench Analytics]", name, properties ?? "");
  }

  // Optional Convex persistence
  if (convexReporter) {
    try {
      convexReporter(event);
    } catch {
      // Silently fail
    }
  }
}

/**
 * Get the bounded list of recent events (newest last).
 */
export function getEventStream(): readonly AnalyticsEvent[] {
  return events;
}

/**
 * Clear all stored events.
 */
export function clearEvents(): void {
  events.length = 0;
}

/**
 * Wire a Convex mutation for server-side event persistence.
 */
export function setAnalyticsReporter(reporter: ConvexAnalyticsReporter | null): void {
  convexReporter = reporter;
}
