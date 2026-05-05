/**
 * BlockHandle — Notion-style left-margin `+ ⋮⋮` handle that appears on block hover.
 *
 * Why: removing the persistent toolbar (Karpathy / founder personas) cost us discoverability
 * for casual users (banker / teacher personas). Notion's solution is the left-margin handle:
 *   - `+` button: hover reveals it, click opens a block-insert popover
 *   - `⋮⋮` drag handle: hover reveals it, click opens a block-actions menu (delete/dup/turn into…)
 *
 * Clicking `+` opens a subset of the slash-menu options anchored to the hovered block.
 * Inserts the new block AFTER the hovered block.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface BlockHandleProps {
  editor: Editor | null;
  surfaceEl: HTMLElement | null;
}

interface HandleAnchor {
  top: number;        // CSS top relative to surface (already scroll-adjusted)
  left: number;       // CSS left of the block (handle sits to its left)
  blockEl: HTMLElement;
  blockTagLowercase: string;
}

interface MenuAnchor {
  top: number;
  left: number;
}

interface BlockOption {
  id: string;
  label: string;
  hint: string;
  icon: string; // 1-2 char glyph
  insertHtml: string;
}

const BLOCK_OPTIONS: BlockOption[] = [
  { id: "h1", label: "Heading 1", hint: "Large title", icon: "H1", insertHtml: "<h1>Heading</h1>" },
  { id: "h2", label: "Heading 2", hint: "Section title", icon: "H2", insertHtml: "<h2>Heading</h2>" },
  { id: "h3", label: "Heading 3", hint: "Sub-section", icon: "H3", insertHtml: "<h3>Heading</h3>" },
  { id: "p", label: "Text", hint: "Plain paragraph", icon: "¶", insertHtml: "<p></p>" },
  { id: "ul", label: "Bulleted list", hint: "Bullets", icon: "•", insertHtml: "<ul><li>Item</li></ul>" },
  { id: "ol", label: "Numbered list", hint: "1. 2. 3.", icon: "1.", insertHtml: "<ol><li>Item</li></ol>" },
  { id: "quote", label: "Quote", hint: "Pull quote", icon: "“", insertHtml: "<blockquote><p>Quote</p></blockquote>" },
  { id: "hr", label: "Divider", hint: "Horizontal rule", icon: "—", insertHtml: "<hr />" },
  { id: "claim", label: "Claim", hint: "Citable assertion", icon: "✓", insertHtml: `<div data-block="claim" data-status="review"><p>State the claim here.</p></div><p></p>` },
  { id: "followup", label: "Follow-up", hint: "Action item", icon: "→", insertHtml: `<div data-block="follow-up" data-due="this-week"><p>What's the next action?</p></div><p></p>` },
  { id: "source", label: "Source list", hint: "Numbered citations", icon: "[n]", insertHtml: `<div data-block="source-list"><ol><li>New source · refreshed today</li></ol></div><p></p>` },
];

export function BlockHandle({ editor, surfaceEl }: BlockHandleProps) {
  const [anchor, setAnchor] = useState<HandleAnchor | null>(null);
  const [menuAt, setMenuAt] = useState<MenuAnchor | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastBlockRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!editor || !surfaceEl) return;

    const onPointerMove = (e: PointerEvent) => {
      // If menu is open, don't shift the handle target
      if (menuAt) return;
      // Find the block under the cursor (or nearest above on the same row)
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!target) return;
      const surface = surfaceEl;
      // Skip when over the handle itself
      if (handleRef.current?.contains(target)) return;
      // Find nearest block-level child of .ProseMirror
      const proseMirror = surface.querySelector(".ProseMirror");
      if (!proseMirror) return;
      let block: HTMLElement | null = target;
      while (block && block.parentElement !== proseMirror) {
        block = block.parentElement;
      }
      if (!block) {
        // Cursor not over a block — try by Y coordinate (find block whose vertical range covers Y)
        const children = Array.from(proseMirror.children) as HTMLElement[];
        for (const c of children) {
          const r = c.getBoundingClientRect();
          if (e.clientY >= r.top && e.clientY <= r.bottom) {
            block = c;
            break;
          }
        }
      }
      if (!block || block === lastBlockRef.current) {
        if (!block) setAnchor(null);
        return;
      }
      lastBlockRef.current = block;
      const blockRect = block.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      setAnchor({
        top: blockRect.top - surfaceRect.top + surface.scrollTop + 4,
        left: blockRect.left - surfaceRect.left + surface.scrollLeft,
        blockEl: block,
        blockTagLowercase: block.tagName.toLowerCase(),
      });
    };

    const onPointerLeave = () => {
      if (menuAt) return;
      setAnchor(null);
      lastBlockRef.current = null;
    };

    surfaceEl.addEventListener("pointermove", onPointerMove);
    surfaceEl.addEventListener("pointerleave", onPointerLeave);
    return () => {
      surfaceEl.removeEventListener("pointermove", onPointerMove);
      surfaceEl.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [editor, surfaceEl, menuAt]);

  // Click outside to close menu
  useEffect(() => {
    if (!menuAt) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (menuRef.current?.contains(t) || handleRef.current?.contains(t)) return;
      setMenuAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAt(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuAt]);

  const insertBlockAfter = (opt: BlockOption) => {
    if (!editor || !anchor) return;
    // Find ProseMirror position at the END of the hovered block
    const view = editor.view;
    const blockRect = anchor.blockEl.getBoundingClientRect();
    const pos = view.posAtCoords({ left: blockRect.right - 4, top: blockRect.bottom - 4 });
    if (!pos) return;
    // The end-of-block position; insert content after it
    const endPos = Math.min(pos.pos, view.state.doc.content.size);
    editor
      .chain()
      .focus()
      .insertContentAt(endPos, opt.insertHtml)
      .run();
    setMenuAt(null);
  };

  const openMenu = () => {
    if (!anchor) return;
    setMenuAt({ top: anchor.top, left: anchor.left - 18 });
  };

  if (!editor) return null;

  return (
    <>
      {anchor && (
        <div
          ref={handleRef}
          className="rd-block-handle"
          style={{
            position: "absolute",
            top: anchor.top,
            left: Math.max(0, anchor.left - 56),
            zIndex: 6,
          }}
          // Don't lose focus on click
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="rd-block-handle__btn"
            title="Add block below"
            aria-label="Add block below"
            onClick={openMenu}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            className="rd-block-handle__btn rd-block-handle__btn--drag"
            title="Drag or open block menu"
            aria-label="Drag or open block menu"
          >
            <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
              <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
              <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
            </svg>
          </button>
        </div>
      )}

      {menuAt && (
        <div
          ref={menuRef}
          className="rd-block-handle__menu"
          role="menu"
          style={{
            position: "absolute",
            top: menuAt.top + 26,
            left: menuAt.left,
            zIndex: 60,
          }}
        >
          <div className="rd-slash-menu__header">Add block</div>
          {BLOCK_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              role="menuitem"
              className="rd-slash-menu__item"
              onClick={() => insertBlockAfter(opt)}
            >
              <span className="rd-slash-menu__icon">{opt.icon}</span>
              <span>
                <span className="rd-slash-menu__title">{opt.label}</span>
                <span className="rd-slash-menu__hint">{opt.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
