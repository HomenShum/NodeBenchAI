// src/features/chat/components/QuotePopover.tsx
//
// QuotePopover — a floating selection-action popover for assistant messages.
//
// Ports the behavior of docs/design/nodebench-ai-design-system/ui_kits/nodebench-web/
// ChatThread.jsx lines 321-333 (the `nb-quote-pop` floating menu) to the production
// FastAgentPanel / ChatHome surface.
//
// When the user selects text inside the mount container, a small glass card
// appears near the selection with two pills:
//   - "Quote to composer"  → prepends `> ${selection}\n\n` to the composer input
//   - "Ask about this"     → fills composer with `About "${selection}" — can you explain more?`
//
// The popover closes on:
//   - Selection cleared (mousedown outside the popover)
//   - Scroll inside the container
//   - Escape key
//
// Pattern: Floating menu on selection (see web kit ChatThread.jsx handleQuote).
// Prior art:
//   - ChatGPT / Perplexity quote-on-select popovers
//   - Medium highlight-and-share toolbar
//
// See also: .claude/rules/reexamine_a11y.md (aria-label on icon buttons),
//           .claude/rules/reexamine_keyboard.md (Escape to close, focus ring).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface QuotePopoverSelection {
  /** The selected text, trimmed. */
  text: string;
  /** Viewport-relative x coordinate (center of selection). */
  x: number;
  /** Viewport-relative y coordinate (top of selection). */
  y: number;
}

export interface QuotePopoverProps {
  /**
   * The scrollable container whose selection events we listen to. The popover
   * only opens when the selection anchor is inside this container.
   */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Called when the user clicks "Quote to composer". Receives the raw selected
   * text (the consumer is responsible for formatting, e.g. prepending `> `).
   */
  onQuote: (text: string) => void;
  /**
   * Called when the user clicks "Ask about this". Receives the raw selected
   * text (the consumer is responsible for wording the prompt).
   */
  onAskAbout: (text: string) => void;
  /**
   * Minimum selection length before the popover appears. Defaults to 3.
   * Matches the kit's `text.length < 3` guard in ChatThread.jsx:161.
   */
  minLength?: number;
  /**
   * When true, disables the popover entirely (e.g. on mobile where the native
   * text-selection UI is more useful).
   */
  disabled?: boolean;
}

/**
 * Returns true if `node` is a descendant of `container` (handles text nodes).
 */
function isInsideContainer(node: Node | null, container: HTMLElement | null): boolean {
  if (!node || !container) return false;
  let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (current) {
    if (current === container) return true;
    current = current.parentNode;
  }
  return false;
}

export function QuotePopover({
  containerRef,
  onQuote,
  onAskAbout,
  minLength = 3,
  disabled = false,
}: QuotePopoverProps): React.ReactElement | null {
  const [selection, setSelection] = useState<QuotePopoverSelection | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setSelection(null), []);

  // Capture a selection when it's inside the mount container.
  const captureSelection = useCallback(() => {
    if (disabled) return;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length < minLength || !sel || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const container = containerRef.current;
    if (!container) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    // Require the selection to be inside the container (don't trigger on
    // selections in e.g. the composer or other surfaces).
    if (!isInsideContainer(range.startContainer, container) || !isInsideContainer(range.endContainer, container)) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setSelection(null);
      return;
    }
    setSelection({
      text,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, [containerRef, disabled, minLength]);

  // Listen for selection end on the container.
  useEffect(() => {
    if (disabled) return;
    const container = containerRef.current;
    if (!container) return;
    const onEnd = () => {
      // Defer so window.getSelection() reflects the final selection state.
      setTimeout(captureSelection, 0);
    };
    container.addEventListener('mouseup', onEnd);
    container.addEventListener('touchend', onEnd);
    return () => {
      container.removeEventListener('mouseup', onEnd);
      container.removeEventListener('touchend', onEnd);
    };
  }, [captureSelection, containerRef, disabled]);

  // Close on outside mousedown, container scroll, or Escape.
  useEffect(() => {
    if (!selection) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      if (popRef.current && ev.target instanceof Node && popRef.current.contains(ev.target)) {
        return; // click was inside the popover — keep it open
      }
      close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    const container = containerRef.current;
    window.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('keydown', onKey);
    container?.addEventListener('scroll', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('keydown', onKey);
      container?.removeEventListener('scroll', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [close, containerRef, selection]);

  const clearNativeSelection = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges();
    }
  }, []);

  const handleQuote = useCallback(() => {
    if (!selection) return;
    onQuote(selection.text);
    setSelection(null);
    clearNativeSelection();
  }, [clearNativeSelection, onQuote, selection]);

  const handleAskAbout = useCallback(() => {
    if (!selection) return;
    onAskAbout(selection.text);
    setSelection(null);
    clearNativeSelection();
  }, [clearNativeSelection, onAskAbout, selection]);

  // Clamp the popover to the viewport so it doesn't overflow.
  const style = useMemo<React.CSSProperties | undefined>(() => {
    if (!selection) return undefined;
    // Position above the selection, centered, with a small gap. The popover
    // uses `translate(-50%, -100%)` so the coordinates are the anchor point.
    const gap = 8;
    const top = Math.max(8, selection.y - gap);
    const left = Math.max(80, Math.min(selection.x, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 80));
    return {
      position: 'fixed',
      top,
      left,
      transform: 'translate(-50%, -100%)',
      zIndex: 60,
    };
  }, [selection]);

  if (!selection) return null;

  return (
    <div
      ref={popRef}
      role="menu"
      aria-label="Quote actions"
      style={style}
      // Stop the mousedown from propagating to our window-level close handler.
      onMouseDown={(e) => e.stopPropagation()}
      className={[
        'flex items-center gap-1',
        'rounded-full border border-white/[0.08]',
        'bg-[#1a1a1a]/95 backdrop-blur-md',
        'shadow-[0_8px_24px_rgba(0,0,0,0.45)]',
        'px-1 py-1',
        'animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none',
      ].join(' ')}
    >
      <button
        type="button"
        role="menuitem"
        onClick={handleQuote}
        aria-label="Quote selection to composer"
        className={[
          'inline-flex items-center gap-1.5',
          'px-2.5 py-1 rounded-full',
          'text-[11px] font-medium text-white/90',
          'hover:bg-white/[0.08] active:bg-white/[0.12]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/60',
          'transition-colors',
        ].join(' ')}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <polyline points="9 17 4 12 9 7" />
          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </svg>
        Quote
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={handleAskAbout}
        aria-label="Ask about selection"
        className={[
          'inline-flex items-center gap-1.5',
          'px-2.5 py-1 rounded-full',
          'text-[11px] font-medium text-white/90',
          'hover:bg-white/[0.08] active:bg-white/[0.12]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/60',
          'transition-colors',
        ].join(' ')}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        Ask about this
      </button>
    </div>
  );
}

export default QuotePopover;
