/**
 * askShortcut — pure helpers for the "Ask NodeBench" global keyboard
 * shortcut. Extracted so scenario tests can validate the matcher without
 * a DOM.
 *
 * Shortcut: Cmd+J (Mac) or Ctrl+J (Win/Linux).
 *   - Ignored when the target element is a text input / textarea /
 *     contenteditable, so users typing into the composer or a cell
 *     editor can still use Cmd+J for anything their editor maps it to.
 *     The pill remains clickable; only the keyboard hotkey defers.
 *   - Also ignored when the user is mid-IME composition.
 *   - Escape is handled separately by the panel itself.
 */

/** Minimal shape of the events we inspect — avoids coupling to KeyboardEvent
 *  types so this module stays trivially testable. */
export type AskShortcutEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  target?: unknown;
};

export type AskShortcutTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
};

/** Returns true if the target looks like a text-editing context where
 *  hijacking Cmd+J would be hostile to the user's flow. */
export function targetIsTextEditing(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const t = target as AskShortcutTarget;
  if (t.isContentEditable === true) return true;
  const tag = (t.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") {
    // Allow non-text inputs (checkbox, button-shaped inputs, etc.)
    if (tag === "INPUT" && t.getAttribute) {
      const type = (t.getAttribute("type") ?? "text").toLowerCase();
      const NON_TEXT = new Set([
        "button",
        "checkbox",
        "radio",
        "range",
        "submit",
        "reset",
        "file",
        "color",
        "image",
      ]);
      return !NON_TEXT.has(type);
    }
    return true;
  }
  return false;
}

/**
 * Decide whether the given keyboard event should trigger the Ask panel.
 * Pure. Same input -> same output.
 */
export function matchesAskShortcut(event: AskShortcutEventLike): boolean {
  if (event.isComposing === true) return false; // IME in flight
  if (event.repeat === true) return false; // key held down — one-shot only
  if (event.key.toLowerCase() !== "j") return false;
  // Exactly one of meta / ctrl should be held (Mac vs Win/Linux)
  const metaOnly = !!event.metaKey && !event.ctrlKey;
  const ctrlOnly = !!event.ctrlKey && !event.metaKey;
  if (!metaOnly && !ctrlOnly) return false;
  if (event.altKey || event.shiftKey) return false; // reserved for future expansions
  if (targetIsTextEditing(event.target)) return false;
  return true;
}
