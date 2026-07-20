/**
 * RichNotebookEditor — TipTap-based notebook surface with kit parity.
 *
 * Features (1:1 parity with docs/design/nodebench-ai-design-system/ui_kits/
 * nodebench-workspace/Notebook.jsx):
 *   1. Slash command menu (type `/`, 8 items, arrow/enter/esc).
 *   2. AI proposals (accept/dismiss inline via nb_proposal node).
 *   3. Save-state indicator (green dot "Saved" / warn dot "Saving…",
 *      900ms debounce matching kit markEdit).
 *   4. Claim block with expand/collapse + evidence list (nb_claim node).
 *
 * The component stays backwards-compatible: existing callers that only
 * pass { initialContent, storageKey, ... } still mount without a
 * proposals[] or claims[] array. When those arrays are provided, they
 * are seeded into the editor document on first mount.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { NbProposal, type ProposalAttrs } from "../extensions/nbProposal";
import { NbClaim, type ClaimAttrs } from "../extensions/nbClaim";
import { createSlashCommandExtension } from "../extensions/slashCommand";
import { createSlashRenderer } from "../extensions/slashMenuRenderer";
import "../styles/notebook.css";

// Lazy-loaded so the finder bundle (~3KB) only ships when a caller passes a
// reportId. Older callers (no reportId → no Cmd+F binding) pay nothing.
const NotebookBlockFinder = lazy(() =>
  import("./NotebookBlockFinder").then((m) => ({ default: m.NotebookBlockFinder })),
);

export type NotebookProposal = Omit<ProposalAttrs, "state"> & {
  state?: ProposalAttrs["state"];
};
export type NotebookClaim = ClaimAttrs;

type RichNotebookEditorProps = {
  initialContent: string;
  storageKey?: string;
  testId?: string;
  className?: string;
  editorClassName?: string;
  footer?: ReactNode;
  onChange?: (html: string) => void;
  /**
   * Imperative append request from parent surfaces. The editor inserts the HTML
   * once per unique id, then lets the normal onUpdate/local/Convex save path run.
   */
  appendRequest?: {
    id: string;
    html: string;
  };
  /** Optional AI proposals seeded at mount; rendered as nb_proposal nodes. */
  proposals?: NotebookProposal[];
  /** Optional claim blocks seeded at mount; rendered as nb_claim nodes. */
  claims?: NotebookClaim[];
  /** Debounce for "saved" → "saving" transition (default 900ms, matches kit). */
  saveDebounceMs?: number;
  /** Show the save-state indicator pill (default true). */
  showSaveState?: boolean;
  /**
   * Optional report id. When present:
   *   - Cmd/Ctrl+F (while focus is inside this editor) opens the
   *     NotebookBlockFinder, scoped to this reportId.
   *   - The browser's native Find is preempted (`preventDefault`).
   * When absent, Cmd+F is a no-op for this component (browser's native Find
   * runs as usual).
   */
  reportId?: string;
};

type ToolbarButton = {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

function readStoredNotebook(storageKey: string | undefined, fallback: string) {
  if (!storageKey || typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

function writeStoredNotebook(storageKey: string | undefined, html: string) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, html);
  } catch {
    // Local storage can be unavailable in private sessions. The editor should
    // still work as an in-memory notebook in that case.
  }
}

function buildSeedHtml(
  initial: string,
  proposals?: NotebookProposal[],
  claims?: NotebookClaim[],
) {
  let html = initial;
  if (proposals?.length) {
    const rendered = proposals
      .map((p) => {
        const attrs = {
          ...p,
          state: p.state ?? "pending",
        } satisfies ProposalAttrs;
        return `<div data-type="nb-proposal" data-id="${encodeHtml(attrs.id)}" data-label="${encodeHtml(attrs.label)}" data-note="${encodeHtml(attrs.note)}" data-original-text="${encodeHtml(attrs.originalText)}" data-proposed-text="${encodeHtml(attrs.proposedText)}" data-state="${attrs.state}"></div>`;
      })
      .join("");
    html += rendered;
  }
  if (claims?.length) {
    const rendered = claims
      .map((c) => {
        const encoded = encodeHtml(JSON.stringify(c));
        return `<div data-type="nb-claim" data-claim="${encoded}"></div>`;
      })
      .join("");
    html += rendered;
  }
  return html;
}

function encodeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function RichNotebookEditor({
  initialContent,
  storageKey,
  testId = "rich-notebook-editor",
  className,
  editorClassName,
  footer,
  onChange,
  appendRequest,
  proposals,
  claims,
  saveDebounceMs = 900,
  showSaveState = true,
  reportId,
}: RichNotebookEditorProps) {
  const content = useMemo(
    () => buildSeedHtml(readStoredNotebook(storageKey, initialContent), proposals, claims),
    // Only seed once; subsequent proposals/claims updates should flow via the
    // editor's own API to avoid resetting user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppendRequestIdRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const closeFinder = useCallback(() => {
    setFinderOpen(false);
    // After closing, return focus to the editor host so the user can keep typing.
    // ProseMirror's contenteditable is inside editorContainerRef.
    const editable = editorContainerRef.current?.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    );
    editable?.focus();
  }, []);

  const slashExtension = useMemo(
    () =>
      createSlashCommandExtension({
        render: createSlashRenderer,
      }),
    [],
  );

  const editor = useEditor({
    extensions: [StarterKit, NbProposal, NbClaim, slashExtension],
    content,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none font-serif leading-8 text-gray-700 focus:outline-none dark:text-gray-200",
          "prose-headings:font-semibold prose-headings:tracking-[-0.01em] prose-p:my-3 prose-ul:my-3 prose-ol:my-3",
          editorClassName,
        ),
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const html = activeEditor.getHTML();
      writeStoredNotebook(storageKey, html);
      onChange?.(html);
      setSaveState("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        setSaveState("saved");
      }, Math.max(120, saveDebounceMs));
    },
  });

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editor || !appendRequest || !appendRequest.html.trim()) return;
    if (lastAppendRequestIdRef.current === appendRequest.id) return;
    lastAppendRequestIdRef.current = appendRequest.id;
    editor.chain().focus().insertContent(appendRequest.html).run();
  }, [appendRequest, editor]);

  // Editor-scoped Cmd/Ctrl+F binding. Only fires when focus is inside the
  // editor article (so the browser's native Find still works elsewhere on the
  // page). No-op when `reportId` is undefined — older callers see no change.
  useEffect(() => {
    if (!reportId) return;
    function onKeyDown(e: KeyboardEvent) {
      // Cmd on macOS, Ctrl elsewhere — match the platform's Find shortcut.
      const isCmdF =
        (e.key === "f" || e.key === "F") && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (!isCmdF) return;
      // Only intercept when focus is inside this editor. Browser-native Find
      // continues to work everywhere else on the page.
      const active = document.activeElement;
      const host = rootRef.current;
      if (!host || !active || !host.contains(active)) return;
      e.preventDefault();
      e.stopPropagation();
      setFinderOpen(true);
    }
    // Keydown on document with focus guard — same as TipTap's own shortcut path.
    // Capture phase so we beat the browser's native handler, which honors
    // `preventDefault` only on the *first* listener to call it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [reportId]);

  const buttons: ToolbarButton[] = editor
    ? [
        {
          label: "Heading",
          icon: Heading2,
          active: editor.isActive("heading", { level: 2 }),
          onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          label: "Bold",
          icon: Bold,
          active: editor.isActive("bold"),
          onClick: () => editor.chain().focus().toggleBold().run(),
        },
        {
          label: "Italic",
          icon: Italic,
          active: editor.isActive("italic"),
          onClick: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          label: "Bullet list",
          icon: List,
          active: editor.isActive("bulletList"),
          onClick: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          label: "Numbered list",
          icon: ListOrdered,
          active: editor.isActive("orderedList"),
          onClick: () => editor.chain().focus().toggleOrderedList().run(),
        },
        {
          label: "Quote",
          icon: Quote,
          active: editor.isActive("blockquote"),
          onClick: () => editor.chain().focus().toggleBlockquote().run(),
        },
        {
          label: "Undo",
          icon: Undo2,
          disabled: !editor.can().chain().focus().undo().run(),
          onClick: () => editor.chain().focus().undo().run(),
        },
        {
          label: "Redo",
          icon: Redo2,
          disabled: !editor.can().chain().focus().redo().run(),
          onClick: () => editor.chain().focus().redo().run(),
        },
      ]
    : [];

  return (
    <article
      ref={rootRef}
      className={cn(
        "relative rounded-md border border-black/[0.08] bg-[#fffcf6] p-4 shadow-sm dark:border-white/[0.08] dark:bg-[#15130f]",
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-black/[0.06] pb-3 dark:border-white/[0.08]">
        {buttons.map((button) => {
          const Icon = button.icon;
          return (
            <button
              key={button.label}
              type="button"
              aria-label={button.label}
              aria-pressed={button.active === undefined ? undefined : button.active}
              title={button.label}
              disabled={button.disabled}
              onClick={button.onClick}
              data-active={button.active ? "true" : "false"}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md border text-gray-600 transition dark:text-gray-300",
                button.active
                  ? "border-[#d97757]/35 bg-[#d97757]/12 text-[#ad5f45] dark:text-[#f0b39a]"
                  : "border-black/[0.06] bg-white hover:border-[#d97757]/30 hover:text-[#ad5f45] dark:border-white/[0.08] dark:bg-white/[0.04]",
                button.disabled && "cursor-not-allowed opacity-40 hover:border-black/[0.06] hover:text-gray-600",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          );
        })}
        {showSaveState ? (
          <div
            className="nb-save-state ml-auto"
            role="status"
            aria-live="polite"
            data-testid={`${testId}-save-state`}
          >
            <span
              className="nb-save-dot"
              style={{
                background:
                  saveState === "saved"
                    ? "var(--success, #059669)"
                    : "var(--warn, #b45309)",
                boxShadow:
                  saveState === "saved"
                    ? "0 0 0 2px rgba(4,120,87,0.16)"
                    : "0 0 0 2px rgba(180,83,9,0.16)",
              }}
              aria-hidden="true"
            />
            <span>{saveState === "saved" ? "Saved" : "Saving…"}</span>
          </div>
        ) : null}
      </div>
      <div ref={editorContainerRef} className="border-l-2 border-[#d97757] pl-5">
        {editor ? (
          <EditorContent editor={editor} data-testid={testId} />
        ) : (
          <div className="text-sm text-gray-400">Loading notebook editor...</div>
        )}
      </div>
      {footer ? (
        <div className="mt-4 border-t border-black/[0.05] pt-3 dark:border-white/[0.05]">
          {footer}
        </div>
      ) : null}
      {reportId && finderOpen ? (
        <Suspense fallback={null}>
          <NotebookBlockFinder
            reportId={reportId}
            containerRef={editorContainerRef}
            onClose={closeFinder}
          />
        </Suspense>
      ) : null}
    </article>
  );
}

export default RichNotebookEditor;
