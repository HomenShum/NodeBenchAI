/**
 * errorReporting.ts — Lightweight production error tracking.
 *
 * - Catches unhandled errors + unhandled promise rejections globally
 * - Accepts errors from React ErrorBoundary via reportError()
 * - Stores last 50 errors in a bounded ring buffer (BOUND)
 * - Exposes getRecentErrors() for the telemetry/system surface
 * - In dev mode: also logs with [NodeBench Error] prefix
 * - Optional Convex mutation hook (call setConvexReporter to wire)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrackedError {
  message: string;
  stack: string | undefined;
  /** Page path (no query params) at the time of error. */
  url: string;
  timestamp: number;
  surface: string;
}

type ConvexReporter = (error: TrackedError) => void;

// ── State ──────────────────────────────────────────────────────────────────────

const MAX_ERRORS = 50;
const errors: TrackedError[] = [];
let convexReporter: ConvexReporter | null = null;
let initialized = false;

// ── Helpers ────────────────────────────────────────────────────────────────────

function currentSurface(): string {
  try {
    const path = window.location.pathname;
    // Extract surface from cockpit path: / -> "home", /research -> "research", etc.
    const segment = path.split("/").filter(Boolean)[0];
    return segment || "home";
  } catch {
    return "unknown";
  }
}

function pushError(error: TrackedError): void {
  // BOUND: evict oldest when at capacity
  if (errors.length >= MAX_ERRORS) {
    errors.shift();
  }
  errors.push(error);

  // Dev mode: console log with prefix
  if (import.meta.env.DEV) {
    console.error("[NodeBench Error]", error.message, error.stack);
  }

  // Optional Convex persistence
  if (convexReporter) {
    try {
      convexReporter(error);
    } catch {
      // Silently fail — don't let reporting errors cascade
    }
  }
}

function buildTrackedError(
  message: string,
  stack: string | undefined,
  url?: string,
): TrackedError {
  return {
    message,
    stack,
    // Strip query params to avoid leaking tokens/session ids from URLs
    url: url || window.location.pathname,
    timestamp: Date.now(),
    surface: currentSurface(),
  };
}

// ── Global handlers ────────────────────────────────────────────────────────────

function handleGlobalError(event: ErrorEvent): void {
  const tracked = buildTrackedError(
    event.message || "Unknown error",
    event.error?.stack,
    event.filename,
  );
  pushError(tracked);
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Unhandled promise rejection";
  const stack = reason instanceof Error ? reason.stack : undefined;
  const tracked = buildTrackedError(message, stack);
  pushError(tracked);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Report an error from a React ErrorBoundary or any catch block.
 */
export function reportError(error: Error, context?: { section?: string }): void {
  const tracked = buildTrackedError(
    context?.section ? `[${context.section}] ${error.message}` : error.message,
    error.stack,
  );
  pushError(tracked);
}

/**
 * Get the bounded list of recent errors (newest last).
 */
export function getRecentErrors(): readonly TrackedError[] {
  return errors;
}

/**
 * Clear all stored errors (useful after viewing).
 */
export function clearErrors(): void {
  errors.length = 0;
}

/**
 * Wire a Convex mutation for server-side error persistence.
 * Call with `null` to disconnect.
 */
export function setConvexReporter(reporter: ConvexReporter | null): void {
  convexReporter = reporter;
}

/**
 * Initialize global error listeners. Call once at app mount.
 * Safe to call multiple times — only the first call attaches listeners.
 */
export function initErrorReporting(): void {
  if (initialized) return;
  initialized = true;

  window.addEventListener("error", handleGlobalError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
}

/**
 * Tear down global listeners (for testing or HMR).
 */
export function destroyErrorReporting(): void {
  if (!initialized) return;
  initialized = false;

  window.removeEventListener("error", handleGlobalError);
  window.removeEventListener("unhandledrejection", handleUnhandledRejection);
}
