/**
 * ScratchpadViewer — raw markdown working-memory viewer for a run.
 *
 * Pattern: transparency via raw working memory (PR8 from the refactor checklist).
 *          The notebook's structured output is derived from the scratchpad;
 *          power users can inspect the scratchpad directly to see how the
 *          agent is thinking in real time.
 *
 * Prior art:
 *   - Claude Code — session transcripts viewable on disk
 *   - Manus AI — virtual workspace file, human-inspectable
 *   - Cognition Devin — markdown notes alongside every task
 *   - Cursor — rules/context files inspectable
 *
 * See: .claude/rules/scratchpad_first.md
 *      .claude/rules/layered_memory.md
 *      docs/architecture/SCRATCHPAD_PATTERN.md
 *      docs/architecture/AGENT_PIPELINE.md
 *
 * Phase 1 scope: viewer UI + empty/loading states. The Convex subscription
 * for the scratchpad content is supplied via the `markdownSource` prop, so
 * this component stays testable and reusable across contexts (entity page
 * drawer, chat rail, admin debug view).
 *
 * UX invariants:
 *  - Default-collapsed — not shown to non-power users until they ask
 *  - Streams live — updates appear without stealing focus
 *  - Monospace + max-width — readable like a code/notes file, not a blog
 *  - Pre-wrap — preserves markdown structure visually
 *  - No interactive elements inside the viewer (read-only, by design)
 *  - "Open full" opens a dedicated view for deep inspection
 */

import { memo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScratchpadViewerProps = {
  /**
   * Raw markdown content of the scratchpad. Supplied by parent via the
   * appropriate subscription (useEntityNotebookDoc or useScratchpadStream).
   * `undefined` = loading; `null` = no scratchpad exists yet; empty string = real empty state.
   */
  markdownSource: string | null | undefined;
  /** Display name of the run — e.g. "Acme AI · run #1204". */
  runLabel?: string;
  /** Scratchpad version number — shown as "v7" next to the run label. */
  version?: number;
  /** Timestamp of the last write, for the "updated 2m ago" line. */
  updatedAt?: number;
  /** Open in a dedicated viewer route — optional callback. */
  onOpenFull?: () => void;
  /** Default expanded? Defaults to false (power-user opt-in). */
  defaultExpanded?: boolean;
  /** Additional classes. */
  className?: string;
};

function formatRelative(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function ScratchpadViewerBase(props: ScratchpadViewerProps) {
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);

  const isLoading = props.markdownSource === undefined;
  const isEmpty = props.markdownSource === null;
  const body = props.markdownSource ?? "";

  return (
    <aside
      className={cn(
        "flex flex-col rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]",
        props.className,
      )}
      aria-labelledby="scratchpad-viewer-heading"
    >
      {/* Header — collapsible */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls="scratchpad-viewer-body"
        className="flex w-full items-center justify-between gap-2 rounded-t-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757] dark:hover:bg-white/[0.04]"
      >
        <span className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          )}
          <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <h3
            id="scratchpad-viewer-heading"
            className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            Scratchpad
          </h3>
          {props.runLabel ? (
            <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">
              {props.runLabel}
              {props.version != null ? ` · v${props.version}` : null}
            </span>
          ) : null}
        </span>
        {props.updatedAt != null ? (
          <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
            updated {formatRelative(props.updatedAt)}
          </span>
        ) : null}
      </button>

      {/* Body */}
      {expanded ? (
        <div
          id="scratchpad-viewer-body"
          className="flex flex-col gap-2 border-t border-gray-100 px-3 py-3 dark:border-white/[0.06]"
        >
          {/* Power-user context — this is raw working memory, not the final artifact */}
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            This is the agent's raw working memory for the current run. It's
            free-form and revises itself over time. The structured output on
            this entity page is derived from this file on checkpoint.
          </p>

          {isLoading ? (
            <div
              role="status"
              className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.01] dark:text-gray-400"
            >
              Loading scratchpad…
            </div>
          ) : isEmpty ? (
            <div
              role="status"
              className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.01] dark:text-gray-400"
            >
              No scratchpad yet for this entity. Start a run to populate it — the
              sub-agents write here first, then structure their output at
              checkpoint.
            </div>
          ) : (
            <pre
              className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-[11px] leading-5 text-gray-700 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-gray-300"
              aria-label="Scratchpad markdown content"
            >
              {body}
            </pre>
          )}

          {props.onOpenFull ? (
            <button
              type="button"
              onClick={props.onOpenFull}
              className="inline-flex items-center gap-1 self-start rounded-md px-2 py-1 text-[11px] font-medium text-[#d97757] transition-colors hover:bg-[#d97757]/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]"
            >
              Open full view
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

export const ScratchpadViewer = memo(ScratchpadViewerBase);
ScratchpadViewer.displayName = "ScratchpadViewer";

export default ScratchpadViewer;
