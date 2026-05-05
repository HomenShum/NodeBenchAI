/**
 * StyleGalleryCard — Notion-templates-style preview card for a memo style.
 *
 * Shows the style's voice, persona, mock memo lines (in the actual style),
 * source citation, and "Try on [entity]" CTA. Used in:
 *   - Home page (new-visitor: hero gallery)
 *   - Me page (Style Gallery tab)
 *   - Reports page (chip click → pick another style)
 */

import { Pill } from "./Pill";
import type { MemoStyle } from "../fixtures";

interface StyleGalleryCardProps {
  style: MemoStyle;
  onTry?: (style: MemoStyle, entity: string) => void;
  onSelect?: (style: MemoStyle) => void;
  defaultTryEntity?: string;
  selected?: boolean;
}

export function StyleGalleryCard({ style, onTry, onSelect, defaultTryEntity = "Apple", selected }: StyleGalleryCardProps) {
  return (
    <article
      className="rd-style-card"
      data-selected={selected || undefined}
      tabIndex={0}
      role="button"
      onClick={() => onSelect?.(style)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(style); } }}
    >
      <div className="rd-style-card__preview" aria-hidden="true">
        {style.previewLines.slice(0, 5).map((line, i) => (
          <span key={i} className="rd-style-card__preview-line">{line}</span>
        ))}
      </div>
      <div className="rd-style-card__body">
        <div className="rd-row" style={{ justifyContent: "space-between", gap: 8 }}>
          <h3 className="rd-style-card__title">{style.name}</h3>
          {style.id === "user.inferred" && style.confidence && (
            <Pill tone="green">{Math.round(style.confidence * 100)}% match</Pill>
          )}
        </div>
        <p className="rd-style-card__voice">{style.voice}</p>
        <div className="rd-row" style={{ gap: 5, flexWrap: "wrap" }}>
          <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>
            {style.persona}
          </span>
        </div>
      </div>
      <div className="rd-style-card__foot">
        <span
          className="rd-mono"
          style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}
          title={`source: ${style.source}`}
        >
          source: <span style={{ color: "var(--rd-ink-mute)" }}>{style.source}</span>
        </span>
        {onTry && (
          <button
            className="rd-btn rd-btn--primary rd-btn--sm"
            onClick={(e) => { e.stopPropagation(); onTry(style, defaultTryEntity); }}
          >
            Try on {defaultTryEntity} →
          </button>
        )}
      </div>
    </article>
  );
}
