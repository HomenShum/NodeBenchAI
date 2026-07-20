/**
 * ReportNotebookEditor — TipTap-backed report editor.
 *
 * Each report is a living TipTap document. Three writers:
 *   1. The user (typing directly)
 *   2. Chat (when the agent answers a question, the answer becomes a new block)
 *   3. Agents (autonomous workers append claims, refresh sources, mark needs-review)
 *
 * Spec (from the user's pasted design):
 *   - notebookHtml stored on Convex `reports.notebookHtml`
 *   - notebookUpdatedAt last-write timestamp
 *   - save state pill (Saved / Saving… / Agent editing…)
 *   - read-only public mode toggle
 *   - rewrite sections, insert entity cards, attach citations
 *   - mark claims as needs_review, create follow-ups
 *   - ask AI to improve selected text
 *   - export CRM-ready data
 *
 * This showcase uses real @tiptap/react + StarterKit. Custom block markup
 * (claim / follow-up / source-list) flows through TipTap as raw HTML for now;
 * production would promote each to a custom Node extension via `Node.create()`.
 *
 * `applyChatPatch()` and `applyAgentPatch()` are imperative entry points
 * exposed via the editor ref so the parent (chat surface, agent runtime) can
 * insert content programmatically.
 */

import {
  useEditor,
  EditorContent,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { NotebookCustomBlocks } from "./notebookExtensions";
import { SlashMenu, type SlashOption } from "./SlashMenu";
import { BubbleMenu } from "./BubbleMenu";
import { BlockHandle } from "./BlockHandle";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pill } from "./Pill";

export type SaveState = "saved" | "saving" | "agent_editing" | "chat_editing";

export interface NotebookPatch {
  /**
   * HTML to insert. The TipTap editor parses it and inserts at the current
   * selection (or end of document if none).
   */
  html: string;
  /** Optional anchor — if provided, inserts after the matching block id. */
  afterBlockId?: string;
  /** Author of the patch — drives the save-state indicator + audit log. */
  source: "chat" | "agent" | "user";
  /** Short label rendered in the audit feed when this patch lands. */
  label: string;
}

export interface ReportNotebookEditorHandle {
  /** Apply a patch from chat (e.g. agent answer becomes a new block). */
  applyChatPatch: (patch: NotebookPatch) => void;
  /** Apply a patch from an autonomous agent. */
  applyAgentPatch: (patch: NotebookPatch) => void;
  /** Read current HTML. */
  getHtml: () => string;
  /** Direct editor handle for advanced ops (used sparingly). */
  editor: Editor | null;
}

interface ReportNotebookEditorProps {
  /** Initial HTML — typically `reportNotebookHtml[reportId]`. */
  initialHtml: string;
  /** Read-only public-share mode. */
  readOnly?: boolean;
  /** Fires whenever HTML changes. Debounce in production before persisting. */
  onChange?: (html: string) => void;
  /** Audit feed entries — last N edits with author + timestamp. */
  onAuditEntry?: (entry: { source: NotebookPatch["source"]; label: string; at: number }) => void;
  /** Notify parent of save state changes so the chrome can show a subtle pill. */
  onSaveStateChange?: (state: SaveState) => void;
}

export const ReportNotebookEditor = forwardRef<ReportNotebookEditorHandle, ReportNotebookEditorProps>(
  function ReportNotebookEditor({ initialHtml, readOnly = false, onChange, onAuditEntry, onSaveStateChange }, ref) {
    const [saveState, setSaveStateRaw] = useState<SaveState>("saved");
    const setSaveState = (s: SaveState) => {
      setSaveStateRaw(s);
      onSaveStateChange?.(s);
    };
    const [slashAnchor, setSlashAnchor] = useState<{ top: number; left: number } | null>(null);
    const [slashQuery, setSlashQuery] = useState("");
    const [slashStartPos, setSlashStartPos] = useState<number | null>(null);
    const surfaceRef = useRef<HTMLDivElement | null>(null);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable codeBlock highlighting bundle — we don't render code in reports
          codeBlock: false,
        }),
        Placeholder.configure({
          placeholder: ({ node }) =>
            node.type.name === "paragraph" ? "Type '/' for blocks, or just write…" : "",
          showOnlyWhenEditable: true,
          showOnlyCurrent: false,
          emptyEditorClass: "is-editor-empty",
        }),
        ...NotebookCustomBlocks,
      ],
      content: initialHtml,
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: "rd-notebook__content",
          spellcheck: "true",
        },
        handleKeyDown(view, event) {
          if (event.key !== "/") return false;
          // Open slash menu anchored at current caret coords (relative to surface)
          const { from } = view.state.selection;
          const coords = view.coordsAtPos(from);
          const surface = surfaceRef.current;
          if (!surface) return false;
          const rect = surface.getBoundingClientRect();
          setSlashAnchor({
            top: coords.bottom - rect.top + surface.scrollTop + 6,
            left: coords.left - rect.left + surface.scrollLeft,
          });
          setSlashStartPos(from);
          setSlashQuery("");
          return false; // let "/" land in the document
        },
      },
      onUpdate: ({ editor: ed }) => {
        setSaveState("saving");
        onChange?.(ed.getHTML());
        // Mock save debounce
        const t = window.setTimeout(() => setSaveState("saved"), 600);
        return () => window.clearTimeout(t);
      },
      onSelectionUpdate: ({ editor: ed }) => {
        // Track slash-menu state by reading the text from / to caret
        if (slashStartPos === null) return;
        const { from } = ed.state.selection;
        if (from < slashStartPos) {
          // caret moved before the slash → close menu
          setSlashAnchor(null);
          setSlashStartPos(null);
          setSlashQuery("");
          return;
        }
        const text = ed.state.doc.textBetween(slashStartPos, from, "\n", "\n");
        // text starts with "/", strip it
        if (!text.startsWith("/")) {
          setSlashAnchor(null);
          setSlashStartPos(null);
          setSlashQuery("");
          return;
        }
        setSlashQuery(text.slice(1));
      },
    });

    // Imperative API — chat + agent edits land here
    useImperativeHandle(
      ref,
      () => ({
        applyChatPatch: (patch) => applyPatch(editor, patch, setSaveState, onAuditEntry, "chat_editing"),
        applyAgentPatch: (patch) => applyPatch(editor, patch, setSaveState, onAuditEntry, "agent_editing"),
        getHtml: () => editor?.getHTML() ?? "",
        editor,
      }),
      [editor, onAuditEntry]
    );

    // Sync read-only changes
    useEffect(() => {
      editor?.setEditable(!readOnly);
    }, [editor, readOnly]);

    const handleSlashSelect = (opt: SlashOption) => {
      if (!editor || slashStartPos === null) return;
      const { from } = editor.state.selection;
      // Delete the slash + filter text, then insert the chosen block
      editor
        .chain()
        .focus()
        .deleteRange({ from: slashStartPos, to: from })
        .insertContent(opt.insertHtml)
        .run();
      setSlashAnchor(null);
      setSlashStartPos(null);
      setSlashQuery("");
    };

    const handleSlashClose = () => {
      setSlashAnchor(null);
      setSlashStartPos(null);
      setSlashQuery("");
    };

    return (
      <div className="rd-notebook">
        {/* Editor surface — no persistent toolbar.
            Format-on-selection lives in <BubbleMenu>; block insert lives in slash menu. */}
        <div ref={surfaceRef} className="rd-notebook__surface" style={{ position: "relative" }}>
          <EditorContent editor={editor} />
          <BubbleMenu editor={editor} surfaceEl={surfaceRef.current} />
          {!readOnly && <BlockHandle editor={editor} surfaceEl={surfaceRef.current} />}
          <SlashMenu
            anchor={slashAnchor}
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={handleSlashClose}
          />
        </div>
      </div>
    );
  }
);

function applyPatch(
  editor: Editor | null,
  patch: NotebookPatch,
  setSaveState: (s: SaveState) => void,
  onAuditEntry: ReportNotebookEditorProps["onAuditEntry"],
  state: "chat_editing" | "agent_editing"
) {
  if (!editor) return;
  setSaveState(state);
  // Move selection to end if no anchor (simple production-safe default)
  editor.chain().focus("end").insertContent(patch.html).run();
  onAuditEntry?.({ source: patch.source, label: patch.label, at: Date.now() });
  window.setTimeout(() => setSaveState("saved"), 1000);
}

/**
 * Subtle save-state pill exposed for the page chrome (top-right of header).
 * Replaces the prior in-toolbar pill that Gemini QA flagged as developer-chrome leakage.
 */
export function NotebookSaveStatePill({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  return <SaveStatePill state={state} readOnly={readOnly} />;
}

function SaveStatePill({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  if (readOnly) {
    return <Pill>Read-only · public share</Pill>;
  }
  // Subtle by default — most users don't need to know about persistence
  const map: Record<SaveState, { label: string; tone: "green" | "amber" | "accent" | "blue"; icon: string }> = {
    saved: { label: "Saved", tone: "green", icon: "M5 12l4 4L19 7" },
    saving: { label: "Saving…", tone: "amber", icon: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" },
    chat_editing: { label: "Chat editing", tone: "accent", icon: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" },
    agent_editing: { label: "Agent editing", tone: "blue", icon: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" },
  };
  const m = map[state];
  return (
    <span
      title={state === "saved" ? "Auto-saved" : m.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 510,
        background: state === "saved" ? "transparent" : `var(--rd-${m.tone}-bg)`,
        color: `var(--rd-${m.tone})`,
        border: state === "saved" ? "none" : `1px solid var(--rd-${m.tone}-border, var(--rd-line))`,
      }}
    >
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={m.icon} />
      </svg>
      {state !== "saved" && <span>{m.label}</span>}
    </span>
  );
}
