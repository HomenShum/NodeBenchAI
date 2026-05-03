import React from "react";
import { ChevronRight, Loader2, Plus, X } from "lucide-react";

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
  footerMeta?: string;
  suggestions?: string[];
  onSuggestion?: (suggestion: string) => void;
};

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
  footerMeta,
  suggestions = [],
  onSuggestion,
}: ExactComposerProps) {
  const disabledSubmit = Boolean(submitDisabled || submitting || disabled);
  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (disabledSubmit) return;
    onSubmit();
  };
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
      <textarea
        data-testid={inputTestId}
        className={`nb-composer-input${inputClassName ? ` ${inputClassName}` : ""}`}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        maxLength={maxLength}
      />
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
              {onModelClick ? (
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
