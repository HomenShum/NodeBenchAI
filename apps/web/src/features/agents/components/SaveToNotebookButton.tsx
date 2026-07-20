/**
 * SaveToNotebookButton — cross-surface agent → notebook write handle.
 *
 * Lives under any agent response (Chat, Side Panel, future Inline) when
 * the user is viewing an entity. Click → append a new block to the
 * entity's notebook with:
 *   kind:        "text"
 *   content:     the agent response text (chipped)
 *   authorKind:  "agent"
 *   accessMode:  "read"   ← pending suggestion (user can Accept/Dismiss)
 *
 * This is the keystone of the three-surface agent unification: all surfaces
 * produce the same output shape (agent-authored read-only block) and the
 * user reviews all pending suggestions in one place — the notebook itself.
 *
 * Prior art:
 *   - Notion AI — "Insert below" / "Replace selection" routes AI output
 *     into the document as editable content
 *   - Cursor — "Apply" on code suggestions
 *   - Linear — "Draft" responses that convert to final on Accept
 *
 * See: .claude/rules/agentic_reliability.md (HONEST_STATUS on save failure)
 *      docs/architecture/AGENT_PIPELINE.md
 */

import { memo, useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";

import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { cn } from "@/lib/utils";
import type { BlockChip } from "@/features/entities/components/notebook/BlockChipRenderer";

type Props = {
  /**
   * Entity slug to save against. When `null`, the button renders nothing —
   * there's no notebook to target (e.g. chat not scoped to an entity).
   */
  entitySlug: string | null | undefined;
  /** Plain text of the agent's response. Chipped into a single text block. */
  text: string;
  /** Optional author ID for provenance. Defaults to surface name. */
  authorId?: string;
  /** Surface this button lives in — labels the block's source for audit. */
  surface?: "chat" | "panel" | "inline";
  /** Additional classes for positioning. */
  className?: string;
  /** Compact variant for inline placement (no icon label). */
  compact?: boolean;
  /** Optional share token for owner-agnostic access. */
  shareToken?: string;
};

function textToChips(text: string): BlockChip[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return [{ type: "text", value: trimmed }];
}

function SaveToNotebookButtonBase({
  entitySlug,
  text,
  authorId,
  surface = "panel",
  className,
  compact,
  shareToken,
}: Props) {
  const api = useConvexApi();
  const appendBlock = useMutation(
    api?.domains.product.blocks.appendBlock ?? ("skip" as never),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (!entitySlug || !api) return;
    const chips = textToChips(text);
    if (chips.length === 0) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      await appendBlock({
        anonymousSessionId: getAnonymousProductSessionId(),
        shareToken,
        entitySlug,
        kind: "text",
        content: chips,
        authorKind: "agent",
        authorId: authorId ?? `agent:${surface}`,
        // Pending suggestion — user reviews and Accept/Dismiss in the
        // notebook. Matches the existing accessMode model.
        accessMode: "read",
      });
      setStatus("saved");
      // Reset after 2s so the user can save again if they want another copy.
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setStatus("error");
      setErrorMsg(
        e instanceof Error ? e.message : "Failed to save — please retry.",
      );
    }
  }, [api, appendBlock, authorId, entitySlug, shareToken, surface, text]);

  if (!entitySlug) return null;
  if (!text.trim()) return null;

  const labelIdle = compact ? "Save" : "Save to notebook";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "saving"}
      aria-label={`${labelIdle}${entitySlug ? ` (${entitySlug})` : ""}`}
      title={errorMsg ?? undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1",
        status === "saved"
          ? "text-emerald-600 dark:text-emerald-400"
          : status === "error"
            ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
            : "text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 focus-visible:ring-[var(--accent-primary)]/40",
        status === "saving" ? "cursor-wait opacity-70" : "",
        className,
      )}
    >
      {status === "saving" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : status === "saved" ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      ) : (
        <FileText className="h-3 w-3" aria-hidden="true" />
      )}
      <span>
        {status === "saving"
          ? "Saving…"
          : status === "saved"
            ? "Saved"
            : status === "error"
              ? "Retry save"
              : labelIdle}
      </span>
    </button>
  );
}

export const SaveToNotebookButton = memo(SaveToNotebookButtonBase);
export default SaveToNotebookButton;
