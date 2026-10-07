/**
 * notebookAlerts.ts — client-side real-time alerting via ntfy.sh.
 *
 * ntfy is a pub/sub service that delivers HTTP POSTs as push notifications
 * to mobile apps, web subscribers, and CLI listeners. This module is a thin
 * wrapper with two production-readiness guarantees:
 *
 *   1. **Sampling**: the same alert code fires at most once per SAMPLE_WINDOW_MS
 *      per tab. A flapping bug produces one notification, not a storm.
 *   2. **Fail-open**: if the ntfy URL is unset, the network is down, or the
 *      POST throws, the alert is silently dropped. Alerting must NEVER block
 *      the user's save or throw into their editor.
 *
 * Configure via build-time env var:
 *   VITE_NOTEBOOK_ALERT_NTFY_URL=https://ntfy.sh/nodebench-notebook-prod
 *
 * Subscribe instructions: see docs/architecture/NOTEBOOK_RUNBOOK.md.
 */

export type AlertSeverity = "P0" | "P1" | "P2";

export type NotebookAlert = {
  severity: AlertSeverity;
  code: string;
  title: string;
  detail?: string;
  requestId?: string;
  // Free-form extra context. Keep small — the ntfy body is a single string.
  context?: Record<string, unknown>;
};

// ntfy priority ranges 1 (min) to 5 (max/urgent). Map severity once so the
// on-call engineer's phone rings only for P0s.
const SEVERITY_PRIORITY: Record<AlertSeverity, number> = {
  P0: 5,
  P1: 4,
  P2: 3,
};

const SEVERITY_TAG: Record<AlertSeverity, string> = {
  P0: "rotating_light",
  P1: "warning",
  P2: "bulb",
};

const SAMPLE_WINDOW_MS = 60_000;

// In-memory dedupe — per-code timestamps of last emit. Keyed by `code`, not
// by the full alert, so a bug that fires many different detail strings under
// one code still samples. Module-level so it survives re-renders; cleared on
// page reload (acceptable — the backend dedupe is independent).
const _lastEmittedMs = new Map<string, number>();

// Validate a user-provided URL against the defense-in-depth rules. Exported
// so tests can assert without having to mock `import.meta.env`.
export function validateAlertUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    // Allow ntfy.sh and self-hosted ntfy (override via env var).
    if (!parsed.hostname.endsWith("ntfy.sh") && !parsed.hostname.includes("ntfy")) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function alertUrl(): string | null {
  const envUrl = (
    import.meta as { env?: { VITE_NOTEBOOK_ALERT_NTFY_URL?: string } }
  ).env?.VITE_NOTEBOOK_ALERT_NTFY_URL;
  return validateAlertUrl(envUrl);
}

// Builds the ntfy request init (headers + body) for a given alert. Exported
// for tests so we can verify serialization without hitting the network.
export function buildAlertRequest(alert: NotebookAlert): {
  body: string;
  headers: Record<string, string>;
} {
  const body =
    [
      alert.detail ?? "",
      alert.requestId ? `ref: ${alert.requestId}` : "",
      alert.context ? `context: ${JSON.stringify(alert.context)}` : "",
      `ua: ${typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "unknown"}`,
    ]
      .filter(Boolean)
      .join("\n") || alert.title;
  const headers: Record<string, string> = {
    Title: `[${alert.severity}] ${alert.code}: ${alert.title}`.slice(0, 250),
    Priority: String(SEVERITY_PRIORITY[alert.severity]),
    Tags: SEVERITY_TAG[alert.severity],
  };
  return { body, headers };
}

export function shouldSample(code: string, now: number = Date.now()): boolean {
  const last = _lastEmittedMs.get(code);
  if (last != null && now - last < SAMPLE_WINDOW_MS) return false;
  _lastEmittedMs.set(code, now);
  return true;
}

// Exported for tests.
export function _resetSamplingForTests(): void {
  _lastEmittedMs.clear();
}

/**
 * Fire-and-forget real-time alert. Never throws. Never returns a rejected
 * promise. Returns a boolean indicating whether the POST was attempted
 * (after sampling + URL validation).
 *
 * @param alert the payload
 * @param overrideUrl for tests — bypasses `import.meta.env`. Must still pass
 *   `validateAlertUrl`.
 */
export function publishNotebookAlert(
  alert: NotebookAlert,
  overrideUrl?: string | null,
): boolean {
  const url = overrideUrl !== undefined ? validateAlertUrl(overrideUrl) : alertUrl();
  if (!url) return false;
  if (!shouldSample(alert.code)) return false;

  const { body, headers } = buildAlertRequest(alert);

  // keepalive: true ensures the POST survives a navigation/unload.
  try {
    void fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => {
      // Fail-open: ntfy outage must not surface to the user.
    });
  } catch {
    // Fail-open.
  }
  return true;
}
