/**
 * BubbleMenu — Notion / Roam / Obsidian-style floating formatting menu.
 *
 * Appears only when the user selects non-empty text inside the TipTap editor.
 * Anchored above the selection rectangle. Auto-hides on collapsed selection.
 *
 * Why: NodeBench previously shipped a persistent WYSIWYG toolbar pinned at the top
 * of the document. None of Notion / Roam / Obsidian / ChatGPT / Claude do that —
 * they all use selection-triggered floating menus + slash commands. The persistent
 * toolbar made power users (Karpathy / founder personas) churn — Gemini 3.1 Pro
 * QA flagged it as P0 in the founder scenario.
 *
 * Buttons (in order, like Notion):
 *   B · I · S · Code · | · H1 · H2 · H3 · | · Link · Quote
 *
 * Future: add "Ask AI" pill at the right edge — invokes the agent against the
 * selection (the rule says "ask AI to improve selected text" in the spec).
 */

import { useEffect, useState, useRef, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";

interface BubbleMenuProps {
  editor: Editor | null;
  /** Container the menu is positioned within (for scroll math). */
  surfaceEl: HTMLElement | null;
}

interface Anchor {
  top: number;
  left: number;
}

export function BubbleMenu({ editor, surfaceEl }: BubbleMenuProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor || !surfaceEl) return;

    const update = () => {
      const { state, view } = editor;
      const { selection } = state;
      if (selection.empty) {
        setAnchor(null);
        return;
      }
      const { from, to } = selection;
      // Get the bounding rect of the selection
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const surfaceRect = surfaceEl.getBoundingClientRect();
      const selRect = {
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
        left: Math.min(start.left, end.left),
        right: Math.max(start.right, end.right),
      };
      // Position the menu centered above the selection (or below if no room above)
      const menuHeight = menuRef.current?.offsetHeight ?? 36;
      const menuWidth = menuRef.current?.offsetWidth ?? 320;
      const centerX = (selRect.left + selRect.right) / 2;
      let top = selRect.top - surfaceRect.top + surfaceEl.scrollTop - menuHeight - 8;
      if (top < surfaceEl.scrollTop + 8) {
        // not enough room above — place below
        top = selRect.bottom - surfaceRect.top + surfaceEl.scrollTop + 8;
      }
      const left = Math.max(8, centerX - surfaceRect.left + surfaceEl.scrollLeft - menuWidth / 2);
      setAnchor({ top, left });
    };

    editor.on("selectionUpdate", update);
    editor.on("update", update);
    editor.on("blur", () => {
      // Keep menu visible if focus moved INTO the menu
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!menuRef.current?.contains(active)) {
          setAnchor(null);
        }
      }, 60);
    });

    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
    };
  }, [editor, surfaceEl]);

  if (!editor || !anchor) return null;

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs);

  return (
    <div
      ref={menuRef}
      className="rd-bubble-menu"
      role="toolbar"
      aria-label="Format selection"
      style={{
        position: "absolute",
        top: anchor.top,
        left: anchor.left,
        zIndex: 50,
      }}
      // prevent the editor losing selection on click
      onMouseDown={(e) => e.preventDefault()}
    >
      <BubbleBtn
        label="Bold"
        active={isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        shortcut="⌘B"
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z" />
        </svg>
      </BubbleBtn>
      <BubbleBtn
        label="Italic"
        active={isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        shortcut="⌘I"
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 4h-9M14 20H5M15 4 9 20" />
        </svg>
      </BubbleBtn>
      <BubbleBtn
        label="Strikethrough"
        active={isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16" />
        </svg>
      </BubbleBtn>
      <BubbleBtn
        label="Inline code"
        active={isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        shortcut="⌘E"
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
        </svg>
      </BubbleBtn>

      <Divider />

      <BubbleBtn
        label="Heading 1"
        active={isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <span style={{ fontWeight: 700, fontSize: 11 }}>H1</span>
      </BubbleBtn>
      <BubbleBtn
        label="Heading 2"
        active={isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <span style={{ fontWeight: 700, fontSize: 11 }}>H2</span>
      </BubbleBtn>
      <BubbleBtn
        label="Heading 3"
        active={isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span style={{ fontWeight: 700, fontSize: 11 }}>H3</span>
      </BubbleBtn>

      <Divider />

      <BubbleBtn
        label="Bulleted list"
        active={isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      </BubbleBtn>
      <BubbleBtn
        label="Numbered list"
        active={isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </svg>
      </BubbleBtn>
      <BubbleBtn
        label="Quote"
        active={isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21c0-3 3-6 6-6V9H3zM15 21c0-3 3-6 6-6V9h-6z" />
        </svg>
      </BubbleBtn>

      <Divider />

      <BubbleBtn
        label="Add comment"
        onClick={() => {/* hook into comment thread */}}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </BubbleBtn>

      <BubbleBtn
        label="Ask AI to improve"
        onClick={() => {/* hook into agent runtime — applyChatPatch with selection */}}
        accent
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
        </svg>
        <span style={{ fontSize: 10.5, fontWeight: 590, marginLeft: 4 }}>Ask AI</span>
      </BubbleBtn>
    </div>
  );
}

interface BubbleBtnProps {
  label: string;
  active?: boolean;
  accent?: boolean;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}

function BubbleBtn({ label, active, accent, shortcut, onClick, children }: BubbleBtnProps) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="rd-bubble-menu__btn"
      style={{
        background: accent ? "var(--rd-accent-soft)" : (active ? "var(--rd-accent-tint)" : "transparent"),
        color: accent ? "var(--rd-accent-strong)" : (active ? "var(--rd-accent-strong)" : "var(--rd-ink)"),
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="rd-bubble-menu__divider" />;
}
