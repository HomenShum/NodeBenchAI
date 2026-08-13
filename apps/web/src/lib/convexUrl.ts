/**
 * The one place that decides whether VITE_CONVEX_URL names a usable Convex
 * deployment.
 *
 * Why this exists. Every caller used to test the env var for *presence*
 * (`convexUrl ? new Client(convexUrl) : null`), and presence is not validity.
 * The repo's own `.env.example` ships
 * `VITE_CONVEX_URL=https://your-project.convex.cloud`, and the README's "Local
 * development" section says `cp .env.example .env.local` — so the documented
 * first-run path produced a non-empty string that every truthiness check
 * accepted. `*.convex.cloud` is a wildcard, so that host resolves; Convex's
 * edge then answers the WebSocket with
 * `FatalError: Couldn't parse deployment name your-project`, which
 * `convex/dist/esm/browser/sync/client.js` rethrows out of its message handler
 * before terminating the socket. Net effect measured 2026-08-13 at 1280x900:
 * `/redesign/chat` rendered the real product shell
 * (`[data-agent-runtime-surface="redesign-chat"]`) with a permanently dead
 * backend, two console errors including that uncaught throw, and the designed
 * `MissingConvexUrlScreen` skipped entirely. That is strictly worse than the
 * setup card the empty-string branch shows, and it came from the same line.
 * Evidence: `promotion/evidence/convex-setup-gate/`.
 *
 * The rule mirrors Convex's own rather than inventing a heuristic: a
 * `*.convex.cloud` host must carry a deployment name matching the regex in
 * `convex/dist/esm/cli/lib/extractDeploymentNameForWorkOS.js`. Any other host
 * is left alone, because that is the self-hosted / local-backend case, which
 * Convex does not name-parse.
 */

/** Convex's own deployment-name shape: adjective-animal-number. */
const CONVEX_CLOUD_DEPLOYMENT = /^[a-z]+-[a-z]+-[0-9]+\.(?:[^.]+\.)?convex\.cloud$/;

/**
 * Returns the configured deployment URL, or null when it is absent, malformed,
 * or a `*.convex.cloud` host Convex will refuse to route.
 */
export function resolveConvexUrl(raw?: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  // ponytail: hostname shape only. A *.convex.site host (HTTP actions, not the
  // sync URL) still slips through as "self-hosted"; nothing has been observed
  // setting one. Tighten if that ever shows up in a capture.
  if (
    parsed.hostname.endsWith(".convex.cloud") &&
    !CONVEX_CLOUD_DEPLOYMENT.test(parsed.hostname)
  ) {
    return null;
  }

  return value.replace(/\/+$/, "");
}

/** `resolveConvexUrl` applied to this build's `VITE_CONVEX_URL`. */
export function configuredConvexUrl(): string | null {
  return resolveConvexUrl(import.meta.env?.VITE_CONVEX_URL as string | undefined);
}
