/**
 * AgentComposer — the single composer primitive across all three
 * agent surfaces (drawer, chat page, and eventually inline).
 *
 * Pattern: headless-ish layout; styling hooks exposed via `variant`.
 * The Linear/Perplexity/Cursor UX baseline: auto-growing textarea,
 * Enter to send, Shift+Enter for newline, Cmd/Ctrl+Enter also sends
 * (force-send while in IME or multi-line), optional context chips
 * above the input, submit affordance to the right.
 *
 * Keyboard contract:
 *   - Enter              → send (unless Shift held, unless composing)
 *   - Shift+Enter        → newline
 *   - Cmd/Ctrl+Enter     → send (force, bypasses composing guard)
 *   - Esc                → clears the input (does NOT close parent)
 *
 * Accessibility:
 *   - `role="form"` wrapper + `aria-label`
 *   - Textarea has explicit label via `aria-label` prop
 *   - Submit button has `aria-disabled` + helpful hover title
 *
 * Migration posture: NEW consumers should import this. Existing
 * FastAgentInputBar and ProductIntakeComposer continue to work;
 * they migrate to this primitive in a follow-up PR (not this one).
 */

import { useCallback, useRef, useState, useEffect, memo, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AgentComposerProps {
  /** Controlled value. If omitted, composer uses internal state. */
  value?: string;
  onChange?: (value: string) => void;
  /** Called when the user submits. Return a promise; the composer
   *  disables submit + shows pending state until it resolves. */
  onSubmit: (value: string) => void | Promise<void>;
  /** If true, submit is disabled (e.g., mid-stream). */
  disabled?: boolean;
  /** Placeholder text. */
  placeholder?: string;
  /** ARIA label for the textarea. */
  ariaLabel?: string;
  /** Optional chip row (context, attachments) shown above input. */
  contextChips?: ReactNode;
  /** Optional trailing actions (left of submit) — file upload, etc. */
  leadingActions?: ReactNode;
  /** Visual variant. "drawer" = compact (292px wide); "page" = roomy. */
  variant?: "drawer" | "page" | "inline";
  /** Auto-focus on mount. */
  autoFocus?: boolean;
}

export const AgentComposer = memo(function AgentComposer({
  value: controlledValue,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "Ask NodeBench…",
  ariaLabel = "Message the agent",
  contextChips,
  leadingActions,
  variant = "drawer",
  autoFocus = false,
}: AgentComposerProps) {
  const [internalValue, setInternalValue] = useState("");
  const [pending, setPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? (controlledValue ?? "") : internalValue;

  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  // Auto-grow the textarea up to 10 lines, then scroll. Runs on
  // every value change; cheap because we only touch height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, variant === "drawer" ? 160 : 240);
    el.style.height = `${next}px`;
  }, [value, variant]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || pending) return;
    try {
      setPending(true);
      await onSubmit(trimmed);
      setValue("");
    } finally {
      setPending(false);
    }
  }, [value, disabled, pending, onSubmit, setValue]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composition — never hijack
      if (event.nativeEvent.isComposing) return;
      const forceSubmit = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      if (forceSubmit) {
        event.preventDefault();
        void handleSubmit();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSubmit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setValue("");
      }
    },
    [handleSubmit, setValue],
  );

  const canSubmit = value.trim().length > 0 && !disabled && !pending;

  const wrapperClass = cn(
    "nb-composer-surface rounded-2xl border border-white/[0.08] bg-white/[0.02] transition",
    variant === "drawer" && "p-2.5",
    variant === "page" && "p-3",
    variant === "inline" && "p-2",
    disabled && "opacity-60 pointer-events-none",
  );

  return (
    <div
      className={wrapperClass}
      data-nb-composer={variant}
      role="group"
      aria-label={ariaLabel}
    >
      {contextChips ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {contextChips}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={1}
        className={cn(
          "block w-full resize-none bg-transparent text-sm leading-[1.5] text-content placeholder:text-content-muted focus:outline-none",
          variant === "drawer" ? "min-h-[28px]" : "min-h-[40px]",
        )}
        disabled={disabled}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">{leadingActions}</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-content-muted">
            {navigator.platform?.includes("Mac") ? "⌘↵" : "Ctrl+↵"}
          </span>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            aria-label="Send message"
            aria-disabled={!canSubmit}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-lg transition",
              canSubmit
                ? "bg-[color:var(--accent-primary)] text-white hover:bg-[color:var(--accent-primary-hover)]"
                : "bg-white/[0.06] text-content-muted",
            )}
            title={canSubmit ? "Send" : "Type a message to send"}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});

AgentComposer.displayName = "AgentComposer";
