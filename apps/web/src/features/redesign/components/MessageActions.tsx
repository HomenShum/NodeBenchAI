/**
 * MessageActions — per-message hover toolbar.
 *
 * Standard LLM-chat affordances: Copy / Regen / Pin to report / Branch / 👍 / 👎 / Why?.
 * Reveals on message hover; visible on focus-within for keyboard users.
 *
 * Reactions write to a local state for now (handler prop). When the live agent run
 * lands, the parent wires these to Convex mutations:
 *   - regenerate → triggers a new pipelineRun with the same ownerKey
 *   - pin → upserts a claim into the active report's documentPatches
 *   - 👍/👎 → records to agentRunFeedback (TODO: schema)
 */

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ai-ui/dropdown-menu";

interface MessageActionsProps {
  /** The text/markdown to copy to clipboard. */
  copyText: string;
  /** Called when user wants the message regenerated with optional tier override. */
  onRegenerate?: (tier?: "free" | "fast" | "deep") => void;
  /** Called when user wants to pin a claim from this message into the active report. */
  onPin?: () => void;
  /** Called when user wants to branch the conversation from this message. */
  onBranch?: () => void;
  /** Called when user wants the trace / model reasoning shown. */
  onWhy?: () => void;
  /** Called for thumbs up / down feedback. */
  onReact?: (kind: "up" | "down") => void;
  /** Sprint 4 P2.7 — Compare A/B parallel variants. */
  onCompare?: () => void;
  /** Sprint 4 P2.13 — Reproducibility hash share URL. */
  onShare?: () => void;
}

export function MessageActions({ copyText, onRegenerate, onPin, onBranch, onWhy, onReact, onCompare, onShare }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [reaction, setReaction] = useState<"up" | "down" | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore — sandbox may block clipboard
    }
  };

  const react = (kind: "up" | "down") => {
    setReaction(reaction === kind ? null : kind);
    onReact?.(kind);
  };

  return (
    <div className="rd-msg-actions" role="toolbar" aria-label="Message actions">
      <button
        type="button"
        className="rd-msg-actions__btn"
        onClick={copy}
        title="Copy message (⌘C)"
        aria-label="Copy"
      >
        {copied ? <span className="rd-msg-actions__copied">Copied</span> : <CopyIcon />}
      </button>

      {onRegenerate && (
        <DropdownMenu>
          <div className="rd-msg-actions__regen">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rd-msg-actions__btn"
                title="Regenerate"
                aria-label="Regenerate"
              >
                <RegenIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="rd-msg-actions__menu" align="start" sideOffset={4}>
              <DropdownMenuItem onSelect={() => onRegenerate()}>Regenerate</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRegenerate("free")}>Try free tier</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRegenerate("fast")}>Try fast tier</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRegenerate("deep")}>Try deep tier</DropdownMenuItem>
            </DropdownMenuContent>
          </div>
        </DropdownMenu>
      )}

      {onPin && (
        <button
          type="button"
          className="rd-msg-actions__btn"
          onClick={onPin}
          title="Pin a claim from this answer to the report"
          aria-label="Pin claim"
        ><PinIcon /></button>
      )}

      {onBranch && (
        <button
          type="button"
          className="rd-msg-actions__btn"
          onClick={onBranch}
          title="Branch conversation from here"
          aria-label="Branch"
        ><BranchIcon /></button>
      )}

      {onWhy && (
        <button
          type="button"
          className="rd-msg-actions__btn rd-msg-actions__btn--text"
          onClick={onWhy}
          title="Show the model's reasoning"
        >Why?</button>
      )}

      {onCompare && (
        <button
          type="button"
          className="rd-msg-actions__btn"
          onClick={onCompare}
          title="Compare two variants of this answer (A/B)"
          aria-label="Compare A/B"
        ><CompareIcon /></button>
      )}

      {onShare && (
        <button
          type="button"
          className="rd-msg-actions__btn"
          onClick={onShare}
          title="Copy a reproducible link to this exact answer"
          aria-label="Share answer link"
        ><ShareIcon /></button>
      )}

      <span className="rd-msg-actions__sep" aria-hidden="true" />

      <button
        type="button"
        className="rd-msg-actions__btn"
        data-active={reaction === "up" || undefined}
        onClick={() => react("up")}
        title="Helpful"
        aria-label="Thumbs up"
        aria-pressed={reaction === "up"}
      ><ThumbsUpIcon /></button>
      <button
        type="button"
        className="rd-msg-actions__btn"
        data-active={reaction === "down" || undefined}
        onClick={() => react("down")}
        title="Not helpful"
        aria-label="Thumbs down"
        aria-pressed={reaction === "down"}
      ><ThumbsDownIcon /></button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function RegenIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.3M21 4v6h-6" /><path d="M21 12a9 9 0 0 1-15.5 6.3M3 20v-6h6" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5M9 3h6l1 6 3 3v2H5v-2l3-3z" />
    </svg>
  );
}
function BranchIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="6" cy="18" r="2" />
      <path d="M6 8v8M8 18h8M6 8a6 6 0 0 0 6 6h4" />
    </svg>
  );
}
function ThumbsUpIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 10v12M14 5l-2 5h6.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.1 21H7v-9.5L11 3a2 2 0 0 1 3 2z" />
    </svg>
  );
}
function ThumbsDownIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 14V2M10 19l2-5H5.5a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 6.9 3H17v9.5L13 21a2 2 0 0 1-3-2z" />
    </svg>
  );
}
function CompareIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="7" height="14" rx="1" />
      <rect x="14" y="5" width="7" height="14" rx="1" />
      <path d="M10 12h4" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}
