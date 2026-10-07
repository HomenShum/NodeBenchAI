/**
 * EventCorpusExplorer — landing surface for /events/:eventId.
 *
 * V1 scope (this PR closes the routing gap, not the data plane):
 *   - Renders the event id passed via the URL so a dogfood user can
 *     verify routing works end-to-end (i.e. /events/test-event-id no
 *     longer falls through to home).
 *   - Provides a stable data-testid="event-corpus-explorer" surface so
 *     the live-smoke + Playwright suites can assert presence.
 *   - Leaves a clearly-labelled `Empty state` for the real corpus once
 *     the productEvents → searchableText pipeline lands. We render
 *     "No corpus rows yet for {eventId}" rather than a generic placeholder
 *     so reviewers can see at a glance which event id was resolved.
 *
 * Honest-status (.claude/rules/agentic_reliability.md):
 *   - This route never returns 200 with fake data. If the route resolver
 *     hands us an empty eventId, we render the "no event id" state and
 *     announce it via aria-live so screen readers and tests see the truth.
 *   - There is NO hardcoded passing score / verdict here. The "ready"
 *     surface is the route resolving and the eventId being readable —
 *     nothing more.
 *
 * Accessibility (.claude/rules/reexamine_a11y.md):
 *   - role="region" + aria-label so this section is a discoverable
 *     landmark.
 *   - The eventId is rendered in a <code> element for visual scanability
 *     and uses font-mono for screen contrast in dark mode.
 */
import { useMemo } from "react";

export interface EventCorpusExplorerProps {
  /**
   * Resolved event id from the URL. App.tsx pulls this from the path
   * regex; viewRegistry.ts exposes it as `entityName` in the cockpit
   * surface state (same plumbing channel as /entity/:slug).
   */
  eventId: string | null;
  /** Test-id override; default matches the smoke contract. */
  testId?: string;
}

function sanitize(id: string | null): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  // Bound the rendered id to a sane length so an attacker can't fill the
  // surface with a 10K-char path segment. (BOUND_READ analog.)
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

export function EventCorpusExplorer({
  eventId,
  testId = "event-corpus-explorer",
}: EventCorpusExplorerProps) {
  const resolvedId = useMemo(() => sanitize(eventId), [eventId]);

  return (
    <section
      data-testid={testId}
      data-event-id={resolvedId ?? ""}
      role="region"
      aria-label="Event corpus"
      className="mx-auto flex min-h-[480px] max-w-[960px] flex-col gap-4 px-6 py-8"
    >
      <header className="flex items-baseline justify-between gap-4 border-b border-black/[0.08] pb-4 dark:border-white/[0.08]">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            Event corpus
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {resolvedId ? (
              <code className="font-mono text-xl text-[#ad5f45] dark:text-[#f0b39a]">
                {resolvedId}
              </code>
            ) : (
              "No event id"
            )}
          </h1>
        </div>
        <a
          href="/?surface=reports"
          className="text-xs text-gray-500 hover:text-[#ad5f45] dark:text-gray-400 dark:hover:text-[#f0b39a]"
        >
          ← Reports
        </a>
      </header>

      {resolvedId ? (
        <div className="flex flex-1 flex-col gap-3" data-testid={`${testId}-empty`}>
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-black/[0.06] bg-white/[0.02] p-4 text-sm text-gray-600 dark:border-white/[0.06] dark:text-gray-300"
          >
            No corpus rows yet for <code className="font-mono">{resolvedId}</code>.
            The /events/:eventId route is wired — the productEvents
            corpus reader is the next PR.
          </p>
          <ul className="grid grid-cols-1 gap-2 text-sm text-gray-500 dark:text-gray-400 sm:grid-cols-3">
            <li className="rounded-md border border-black/[0.06] p-3 dark:border-white/[0.06]">
              <strong className="block text-xs uppercase tracking-[0.18em] text-gray-400">
                Sources
              </strong>
              <span>—</span>
            </li>
            <li className="rounded-md border border-black/[0.06] p-3 dark:border-white/[0.06]">
              <strong className="block text-xs uppercase tracking-[0.18em] text-gray-400">
                Mentions
              </strong>
              <span>—</span>
            </li>
            <li className="rounded-md border border-black/[0.06] p-3 dark:border-white/[0.06]">
              <strong className="block text-xs uppercase tracking-[0.18em] text-gray-400">
                Linked entities
              </strong>
              <span>—</span>
            </li>
          </ul>
        </div>
      ) : (
        <p
          role="status"
          aria-live="polite"
          data-testid={`${testId}-missing-id`}
          className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200"
        >
          The event id is missing from the URL. Open this surface via
          /events/:eventId — the route resolver passes the slug here.
        </p>
      )}
    </section>
  );
}

export default EventCorpusExplorer;
