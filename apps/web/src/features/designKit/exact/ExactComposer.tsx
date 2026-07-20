import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2, Plus, X } from "lucide-react";
import { useEntitySuggest, type EntitySuggestHit } from "./useEntitySuggest";

export type ExactComposerPin = {
  kind: string;
  label: string;
  removable?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  title?: string;
};

export type ExactComposerTool = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
};

export type ExactComposerModelOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ExactComposerProps = {
  as?: "div" | "form";
  className?: string;
  innerClassName?: string;
  cardClassName?: string;
  cardTestId?: string;
  inputClassName?: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  ariaLabel: string;
  inputTestId?: string;
  maxLength?: number;
  disabled?: boolean;
  submitting?: boolean;
  submitDisabled?: boolean;
  submitTestId?: string;
  submitPerfAction?: string;
  pins?: ExactComposerPin[];
  onRemovePin?: (index: number) => void;
  addPinLabel?: string;
  onAddPin?: () => void;
  addPinExpanded?: boolean;
  options?: React.ReactNode;
  tools?: ExactComposerTool[];
  modelLabel?: string;
  modelTitle?: string;
  modelProvider?: string;
  onModelClick?: () => void;
  modelValue?: string;
  modelOptions?: ExactComposerModelOption[];
  onModelValueChange?: (value: string) => void;
  modelSelectTestId?: string;
  footerMeta?: string;
  suggestions?: string[];
  onSuggestion?: (suggestion: string) => void;
  /**
   * Enable @entity autocomplete popup. When true, typing `@<prefix>` after a
   * whitespace boundary fires a debounced entity lookup and renders a popup
   * (combobox pattern). On select, the literal `@${slug}` token is inserted
   * at the caret position.
   *
   * Defaults to false — existing call sites stay unchanged. Cockpit chat
   * (`?surface=chat`) sets this to true so bankers can disambiguate
   * "@Orbital" → "@orbital-labs".
   */
  enableEntityMentions?: boolean;
  /** Optional callback fired when the user picks an entity. */
  onEntityMention?: (hit: { slug: string; title: string }) => void;
};

const MENTION_DEBOUNCE_MS = 100;

export function ExactComposer({
  as = "div",
  className,
  innerClassName,
  cardClassName,
  cardTestId,
  inputClassName,
  value,
  onValueChange,
  onSubmit,
  placeholder,
  ariaLabel,
  inputTestId,
  maxLength,
  disabled,
  submitting,
  submitDisabled,
  submitTestId,
  submitPerfAction,
  pins = [],
  onRemovePin,
  addPinLabel,
  onAddPin,
  addPinExpanded,
  options,
  tools = [],
  modelLabel,
  modelTitle = "Model",
  modelProvider = "anthropic",
  onModelClick,
  modelValue,
  modelOptions,
  onModelValueChange,
  modelSelectTestId,
  footerMeta,
  suggestions = [],
  onSuggestion,
  enableEntityMentions = false,
  onEntityMention,
}: ExactComposerProps) {
  const disabledSubmit = Boolean(submitDisabled || submitting || disabled);
  const hasModelSelect = Boolean(modelOptions?.length && modelValue && onModelValueChange);
  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (disabledSubmit) return;
    onSubmit();
  };

  // -- @entity mention state -------------------------------------------------
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const popupId = useId();
  const optionIdPrefix = `${popupId}-opt`;
  // `mentionPrefix` is the text typed after the trailing `@` at the caret.
  // It is debounced before being passed to useEntitySuggest so we do not
  // hammer the federated-search action on every keystroke (100 ms window
  // — short enough to feel live, long enough to dedup bursts).
  const [mentionPrefix, setMentionPrefix] = useState("");
  const [debouncedPrefix, setDebouncedPrefix] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mentionAtIndex, setMentionAtIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!enableEntityMentions || !mentionOpen) {
      setDebouncedPrefix("");
      return;
    }
    const handle = setTimeout(() => {
      setDebouncedPrefix(mentionPrefix);
    }, MENTION_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [mentionPrefix, mentionOpen, enableEntityMentions]);

  const { hits, isLoading: hitsLoading, error: hitsError } = useEntitySuggest({
    prefix: enableEntityMentions && mentionOpen ? debouncedPrefix : "",
    collection: "nb_entities",
    limit: 8,
  });

  // Detect `@<prefix>` at the caret. Only opens when the `@` follows a
  // whitespace boundary or is the first character, so email-looking text
  // like "foo@bar.com" does NOT trigger the popup.
  const detectMention = useCallback(
    (text: string, caret: number) => {
      if (!enableEntityMentions) return;
      const before = text.slice(0, caret);
      const match = before.match(/(?:^|\s)@([\w-]*)$/);
      if (match) {
        const atIdx = caret - match[1].length - 1;
        setMentionAtIndex(atIdx);
        setMentionPrefix(match[1]);
        setMentionOpen(true);
        setActiveIndex(0);
      } else {
        setMentionOpen(false);
        setMentionAtIndex(null);
      }
    },
    [enableEntityMentions],
  );

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionAtIndex(null);
    setMentionPrefix("");
  }, []);

  const insertMention = useCallback(
    (hit: EntitySuggestHit) => {
      const ta = textareaRef.current;
      const caret = ta?.selectionStart ?? value.length;
      const atIdx = mentionAtIndex ?? value.slice(0, caret).lastIndexOf("@");
      if (atIdx < 0) {
        closeMention();
        return;
      }
      const before = value.slice(0, atIdx);
      const after = value.slice(caret);
      const token = `@${hit.slug}`;
      const next = `${before}${token} ${after}`;
      onValueChange(next);
      onEntityMention?.({ slug: hit.slug, title: hit.title });
      closeMention();
      // Restore caret after React applies the new value. requestAnimationFrame
      // keeps this off the synchronous render path.
      requestAnimationFrame(() => {
        const ta2 = textareaRef.current;
        if (!ta2) return;
        const pos = before.length + token.length + 1;
        ta2.focus();
        try {
          ta2.setSelectionRange(pos, pos);
        } catch {
          // ignore — some browsers throw when the element is detached
        }
      });
    },
    [value, mentionAtIndex, onValueChange, onEntityMention, closeMention],
  );

  // Clamp the active index whenever the result set shrinks (e.g. user types
  // a more-specific prefix). DETERMINISTIC: never points past the array.
  useEffect(() => {
    if (activeIndex >= hits.length && hits.length > 0) {
      setActiveIndex(hits.length - 1);
    } else if (hits.length === 0 && activeIndex !== 0) {
      setActiveIndex(0);
    }
  }, [hits.length, activeIndex]);

  const popupOpen = enableEntityMentions && mentionOpen;
  const showError = popupOpen && Boolean(hitsError);
  const showEmpty = popupOpen && !hitsLoading && !hitsError && hits.length === 0 && debouncedPrefix.length > 0;
  const activeOptionId = popupOpen && hits.length > 0 ? `${optionIdPrefix}-${activeIndex}` : undefined;

  const handleTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    onValueChange(next);
    if (enableEntityMentions) {
      detectMention(next, event.target.selectionStart ?? next.length);
    }
  };

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popupOpen && hits.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((idx) => (idx + 1) % hits.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((idx) => (idx - 1 + hits.length) % hits.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        insertMention(hits[activeIndex]);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        insertMention(hits[activeIndex]);
        return;
      }
    }
    if (popupOpen && event.key === "Escape") {
      event.preventDefault();
      closeMention();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const popup = useMemo(() => {
    if (!popupOpen) return null;
    return (
      <div
        id={popupId}
        role="listbox"
        aria-label="Entity suggestions"
        data-exact-composer-mention-popup="true"
        className="nb-composer-mention-popup"
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          bottom: "100%",
          marginBottom: 4,
          zIndex: 50,
          maxHeight: 240,
          overflowY: "auto",
          borderRadius: 8,
          border: "1px solid var(--nb-edge, rgba(255,255,255,0.08))",
          background: "var(--nb-surface, rgba(20,20,19,0.96))",
          backdropFilter: "blur(8px)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
        }}
      >
        {showError ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="exact-composer-mention-error"
            style={{ padding: "8px 12px", fontSize: 12, color: "#f0a070" }}
          >
            Entity lookup temporarily unavailable
          </div>
        ) : hitsLoading && hits.length === 0 ? (
          <div
            role="status"
            aria-live="polite"
            style={{ padding: "8px 12px", fontSize: 12, opacity: 0.7 }}
          >
            Searching...
          </div>
        ) : showEmpty ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="exact-composer-mention-empty"
            style={{ padding: "8px 12px", fontSize: 12, opacity: 0.7 }}
          >
            No matches
          </div>
        ) : (
          hits.map((hit, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                type="button"
                key={hit.slug}
                id={`${optionIdPrefix}-${idx}`}
                role="option"
                aria-selected={active}
                data-testid={`exact-composer-mention-option-${hit.slug}`}
                onMouseDown={(e) => {
                  // Use onMouseDown so the click fires before the textarea
                  // blur handler can close the popup.
                  e.preventDefault();
                  insertMention(hit);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  display: "flex",
                  width: "100%",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  padding: "6px 12px",
                  fontSize: 12,
                  textAlign: "left",
                  background: active ? "rgba(217,119,87,0.14)" : "transparent",
                  color: "inherit",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 500 }}>{hit.title}</span>
                <span style={{ opacity: 0.65, fontSize: 11 }}>
                  @{hit.slug}
                  {hit.subtitle ? ` - ${hit.subtitle}` : ""}
                </span>
              </button>
            );
          })
        )}
      </div>
    );
  }, [popupOpen, popupId, optionIdPrefix, hits, activeIndex, hitsLoading, showError, showEmpty, insertMention]);
  const cardContents = (
    <>
      {(pins.length > 0 || onAddPin) ? (
        <div className="nb-composer-pins">
          {pins.map((pin, index) => {
            const pinContent = (
              <>
                <span className="typ">{pin.kind}</span>
                {pin.label}
                {pin.removable && onRemovePin && !pin.onClick ? (
                  <button
                    type="button"
                    aria-label="Remove pin"
                    onClick={() => onRemovePin(index)}
                  >
                    <X size={9} />
                  </button>
                ) : null}
              </>
            );

            return pin.onClick ? (
              <button
                key={`${pin.kind}-${pin.label}-${index}`}
                type="button"
                className="nb-pin nb-pin-action"
                onClick={pin.onClick}
                aria-label={pin.ariaLabel ?? `${pin.kind}: ${pin.label}`}
                title={pin.title}
              >
                {pinContent}
              </button>
            ) : (
              <span key={`${pin.kind}-${pin.label}-${index}`} className="nb-pin">
                {pinContent}
              </span>
            );
          })}
          {onAddPin ? (
            <button
              type="button"
              className="nb-pin-add"
              onClick={onAddPin}
              aria-expanded={addPinExpanded}
            >
              <Plus size={9} /> {addPinLabel ?? "Add context"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div style={{ position: "relative" }}>
        {popup}
        <textarea
          ref={textareaRef}
          data-testid={inputTestId}
          className={`nb-composer-input${inputClassName ? ` ${inputClassName}` : ""}`}
          value={value}
          onChange={handleTextareaChange}
          onKeyDown={handleTextareaKeyDown}
          onBlur={() => {
            // Delay close so a popup click (mousedown) can take effect first.
            setTimeout(() => closeMention(), 120);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          maxLength={maxLength}
          {...(enableEntityMentions
            ? {
                role: "combobox",
                "aria-autocomplete": "list" as const,
                "aria-expanded": popupOpen,
                "aria-controls": popupOpen ? popupId : undefined,
                "aria-activedescendant": activeOptionId,
              }
            : {})}
        />
      </div>
      {options}
      <div className="nb-composer-footer">
        <div className="nb-composer-tools">
          {tools.map((tool) => (
            <button
              key={tool.key}
              type="button"
              aria-label={tool.label}
              title={tool.label}
              onClick={tool.onClick}
              disabled={tool.disabled}
            >
              {tool.icon}
            </button>
          ))}
          {modelLabel ? (
            <>
              <span className="nb-composer-divider" />
              {hasModelSelect ? (
                <label className="nb-model-trigger nb-model-select-trigger" title={modelTitle}>
                  <span className="dot" data-provider={modelProvider} />
                  <select
                    data-testid={modelSelectTestId}
                    className="nb-model-select"
                    aria-label={modelTitle}
                    value={modelValue}
                    disabled={disabled}
                    onChange={(event) => onModelValueChange?.(event.target.value)}
                  >
                    {modelOptions?.map((option) => (
                      <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : onModelClick ? (
                <button
                  type="button"
                  className="nb-model-trigger"
                  title={modelTitle}
                  aria-label={modelTitle}
                  onClick={onModelClick}
                >
                  <span className="dot" data-provider={modelProvider} />
                  <span className="nm">{modelLabel}</span>
                </button>
              ) : (
                <span className="nb-model-trigger" title={modelTitle}>
                  <span className="dot" data-provider={modelProvider} />
                  <span className="nm">{modelLabel}</span>
                </span>
              )}
            </>
          ) : null}
        </div>
        <div className="nb-composer-send-group">
          {footerMeta ? <span className="nb-composer-meta">{footerMeta}</span> : null}
          <button
            type={as === "form" ? "submit" : "button"}
            data-testid={submitTestId}
            data-nb-perf-action={submitPerfAction}
            className="nb-composer-send"
            aria-label={submitting ? "Submitting" : "Send"}
            disabled={disabledSubmit}
            onClick={as === "form" ? undefined : () => handleSubmit()}
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ChevronRight size={14} style={{ transform: "rotate(-90deg)" }} />
            )}
          </button>
        </div>
      </div>
    </>
  );
  return (
    <div
      className={`nb-stream-composer-inner${innerClassName ? ` ${innerClassName}` : ""}${className ? ` ${className}` : ""}`}
      data-exact-composer="golden"
      data-exact-composer-version="2026-05-02"
    >
      {as === "form" ? (
        <form
          onSubmit={handleSubmit}
          className={`nb-composer-card${cardClassName ? ` ${cardClassName}` : ""}`}
          data-testid={cardTestId}
          data-exact-composer-card="true"
        >
          {cardContents}
        </form>
      ) : (
        <div
          className={`nb-composer-card${cardClassName ? ` ${cardClassName}` : ""}`}
          data-exact-composer-card="true"
        >
          {cardContents}
        </div>
      )}
      {suggestions.length > 0 ? (
        <div className="nb-composer-suggest">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="nb-prompt-chip"
              onClick={() => onSuggestion?.(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ExactComposer;
