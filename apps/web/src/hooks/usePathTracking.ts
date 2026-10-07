/**
 * usePathTracking — Auto-records navigation path steps for the founder platform.
 *
 * Listens to route changes via react-router-dom, records step timing and
 * surface classification, persists the session to localStorage.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { VIEW_REGISTRY } from "@/lib/registry/viewRegistry";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SurfaceType = "view" | "entity" | "artifact";

export interface PathStep {
  sessionId: string;
  stepIndex: number;
  surfaceType: SurfaceType;
  surfaceRef: string;
  surfaceLabel: string;
  enteredAt: number;
  exitedAt: number | null;
  durationMs: number | null;
  transitionFrom: string | null;
}

export interface PathSession {
  sessionId: string;
  startedAt: number;
  steps: PathStep[];
}

export interface UsePathTrackingResult {
  sessionId: string;
  currentPath: string;
  pathHistory: PathStep[];
  totalSteps: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "nodebench_path_session";
const MAX_STEPS = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a path→title lookup from VIEW_REGISTRY (computed once). */
const PATH_TITLE_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const entry of VIEW_REGISTRY) {
    map[entry.path] = entry.title;
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        map[alias] = entry.title;
      }
    }
  }
  return map;
})();

/** Resolve a pathname to a human-readable label via the view registry. */
function lookupSurfaceLabel(pathname: string): string {
  // Direct match
  if (PATH_TITLE_MAP[pathname]) return PATH_TITLE_MAP[pathname];

  // Try stripping trailing slash
  const trimmed = pathname.replace(/\/$/, "") || "/";
  if (PATH_TITLE_MAP[trimmed]) return PATH_TITLE_MAP[trimmed];

  // Try matching dynamic parent paths (e.g. /entity/:name → /entity/:name)
  for (const entry of VIEW_REGISTRY) {
    if (entry.dynamic && pathname.startsWith(entry.path.replace(/\/:[^/]+$/, "/"))) {
      return entry.title;
    }
  }

  // Fallback: derive from last path segment
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "Home";
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ");
}

/** Classify a pathname into a surface type. */
function deriveSurfaceType(pathname: string): SurfaceType {
  // Artifact paths
  if (/\/(export|lineage)(\/|$)/.test(pathname)) return "artifact";

  // Entity paths — contain a UUID-like or named entity segment after a known parent
  // e.g. /entity/acme-corp, /founder/companies/abc123
  if (/\/entity\/[^/]+/.test(pathname) || /\/[^/]+\/[0-9a-f]{8,}/.test(pathname)) {
    return "entity";
  }

  // Founder views
  if (/^\/founder(\/|$)/.test(pathname)) return "view";

  return "view";
}

/** Load persisted session from localStorage, or null. */
function loadSession(): PathSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PathSession;
  } catch {
    return null;
  }
}

/** Persist session to localStorage. */
function saveSession(session: PathSession): void {
  try {
    // Evict oldest steps if over budget
    if (session.steps.length > MAX_STEPS) {
      session.steps = session.steps.slice(-MAX_STEPS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePathTracking(): UsePathTrackingResult {
  const location = useLocation();
  const pathname = location.pathname;

  // Stable session ID — created once per hook mount
  const [session, setSession] = useState<PathSession>(() => {
    const existing = loadSession();
    if (existing) return existing;
    return {
      sessionId: crypto.randomUUID(),
      startedAt: Date.now(),
      steps: [],
    };
  });

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const prevPathnameRef = useRef<string | null>(null);

  const recordStep = useCallback(
    (newPathname: string, previousPathname: string | null) => {
      const now = Date.now();
      setSession((prev) => {
        // Close previous step
        const steps = [...prev.steps];
        if (steps.length > 0) {
          const lastStep = { ...steps[steps.length - 1] };
          if (lastStep.exitedAt === null) {
            lastStep.exitedAt = now;
            lastStep.durationMs = now - lastStep.enteredAt;
            steps[steps.length - 1] = lastStep;
          }
        }

        // Open new step
        const newStep: PathStep = {
          sessionId: prev.sessionId,
          stepIndex: steps.length,
          surfaceType: deriveSurfaceType(newPathname),
          surfaceRef: newPathname,
          surfaceLabel: lookupSurfaceLabel(newPathname),
          enteredAt: now,
          exitedAt: null,
          durationMs: null,
          transitionFrom: previousPathname,
        };

        steps.push(newStep);

        const next: PathSession = { ...prev, steps };
        saveSession(next);
        return next;
      });
    },
    [],
  );

  // Record initial step on mount, then track subsequent route changes
  useEffect(() => {
    if (prevPathnameRef.current === null) {
      // First mount — record initial step
      recordStep(pathname, null);
      prevPathnameRef.current = pathname;
      return;
    }

    if (pathname !== prevPathnameRef.current) {
      const previousPathname = prevPathnameRef.current;
      prevPathnameRef.current = pathname;
      recordStep(pathname, previousPathname);
    }
  }, [pathname, recordStep]);

  // Close the current step on unmount (page close / component teardown)
  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (s.steps.length > 0) {
        const now = Date.now();
        const steps = [...s.steps];
        const lastStep = { ...steps[steps.length - 1] };
        if (lastStep.exitedAt === null) {
          lastStep.exitedAt = now;
          lastStep.durationMs = now - lastStep.enteredAt;
          steps[steps.length - 1] = lastStep;
          const final = { ...s, steps };
          saveSession(final);
        }
      }
    };
  }, []);

  return {
    sessionId: session.sessionId,
    currentPath: pathname,
    pathHistory: session.steps,
    totalSteps: session.steps.length,
  };
}
