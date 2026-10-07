import {
  useCallback,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Mention from "@tiptap/extension-mention";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { ExpandableMention } from "@/features/notebook/extensions/expandableMention";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";

import { useConvexApi } from "@/lib/convexApi";
import type { EntityMatch } from "./MentionPicker";
import { BlockChipRenderer, type BlockChip } from "./BlockChipRenderer";
import { chipsToProsemirrorDoc, prosemirrorDocToChips } from "../../../../../../../shared/notebookBlockProsemirror";
import {
  createDiligenceDecorationPlugin,
  diligenceDecorationPluginKey,
  type DiligenceDecorationData,
} from "./DiligenceDecorationPlugin";
import { diligenceRenderers } from "./diligenceRenderers";

/** Block kinds reachable via inline markdown shortcut (`## ` → H2, etc.). */
export type MarkdownBlockKind = "heading_2" | "heading_3" | "bullet" | "quote" | "todo";

/** Map of prefix → target block kind. Hoisted out of `handleKeyDown` so the
 *  Record literal isn't re-allocated on every keystroke. */
const MARKDOWN_SHORTCUTS: Readonly<Record<string, MarkdownBlockKind>> = Object.freeze({
  "##": "heading_2",
  "###": "heading_3",
  "-": "bullet",
  "*": "bullet",
  ">": "quote",
  "[]": "todo",
  "[ ]": "todo",
});

type Props = {
  syncDocumentId: string;
  chips: BlockChip[];
  className: string;
  isEditable: boolean;
  ariaLabel: string;
  autoFocus?: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onLocalContentChange?: (content: BlockChip[]) => void;
  onEnter: () => void;
  onBackspaceAtStart: () => void;
  onOpenSlash: () => void;
  onCloseSlash: () => void;
  /** Markdown shortcut — called when the user types a recognized prefix
      followed by space at the start of an empty block. Parent transforms
      the block kind and clears the prefix. */
  onMarkdownShortcut?: (kind: MarkdownBlockKind) => void;
  /** Tab pressed — indent this block (make it a child of the previous block). */
  onTabIndent?: () => void;
  /** Shift+Tab pressed — outdent this block one level. */
  onShiftTabOutdent?: () => void;
  diligenceDecorations?: readonly DiligenceDecorationData[];
  onAcceptDecoration?: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
  onDismissDecoration?: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
  onRefreshDecoration?: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
  /** Seam between inline decoration → side-panel drawer. */
  onAskAboutDecoration?: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
};

export type NotebookBlockEditorHandle = {
  insertMention: (match: EntityMatch) => void;
  focus: () => void;
};

const NotebookMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mentionSuggestionChar: {
        default: "@",
      },
      label: {
        default: null,
      },
    };
  },
  renderText({ node }) {
    const trigger =
      typeof node.attrs.mentionSuggestionChar === "string"
        ? node.attrs.mentionSuggestionChar
        : "@";
    const label =
      typeof node.attrs.label === "string"
        ? node.attrs.label
        : typeof node.attrs.id === "string"
          ? node.attrs.id
          : "";
    return `${trigger}${label}`;
  },
  renderHTML({ node, HTMLAttributes }) {
    const trigger =
      typeof node.attrs.mentionSuggestionChar === "string"
        ? node.attrs.mentionSuggestionChar
        : "@";
    const label =
      typeof node.attrs.label === "string"
        ? node.attrs.label
        : typeof node.attrs.id === "string"
          ? node.attrs.id
          : "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class:
          "rounded px-1 text-[var(--accent-primary)] bg-[var(--accent-primary)]/10",
        "data-type": "mention",
        "data-mention-target":
          typeof node.attrs.id === "string" ? node.attrs.id : undefined,
        "data-mention-trigger": trigger,
      }),
      `${trigger}${label}`,
    ];
  },
});

export const NotebookBlockEditor = forwardRef<NotebookBlockEditorHandle, Props>(
  function NotebookBlockEditor(
    {
      syncDocumentId,
      chips,
      className,
      isEditable,
      ariaLabel,
      autoFocus = false,
      onFocus,
      onBlur,
      onLocalContentChange,
      onEnter,
      onBackspaceAtStart,
      onOpenSlash,
      onCloseSlash,
      onMarkdownShortcut,
      onTabIndent,
      onShiftTabOutdent,
      diligenceDecorations = [],
      onAcceptDecoration,
      onDismissDecoration,
      onRefreshDecoration,
      onAskAboutDecoration,
    },
    ref,
  ) {
    const api = useConvexApi();
    const createRequestedRef = useRef(false);
    const lastPublishedRef = useRef<string>("");
    const isEditableRef = useRef(isEditable);
    const onFocusRef = useRef(onFocus);
    const onBlurRef = useRef(onBlur);
    const onLocalContentChangeRef = useRef(onLocalContentChange);
    const onEnterRef = useRef(onEnter);
    const onBackspaceAtStartRef = useRef(onBackspaceAtStart);
    const onOpenSlashRef = useRef(onOpenSlash);
    const onCloseSlashRef = useRef(onCloseSlash);
    const onMarkdownShortcutRef = useRef(onMarkdownShortcut);
    const onTabIndentRef = useRef(onTabIndent);
    const onShiftTabOutdentRef = useRef(onShiftTabOutdent);
    const diligenceDecorationsRef = useRef<readonly DiligenceDecorationData[]>(diligenceDecorations);
    const onAcceptDecorationRef = useRef(onAcceptDecoration);
    const onDismissDecorationRef = useRef(onDismissDecoration);
    const onRefreshDecorationRef = useRef(onRefreshDecoration);
    const onAskAboutDecorationRef = useRef(onAskAboutDecoration);

    const diligenceExtension = useMemo(
      () =>
        Extension.create({
          name: "nodebenchDiligenceDecorations",
          addProseMirrorPlugins() {
            return [
              createDiligenceDecorationPlugin({
                getDecorations: () => diligenceDecorationsRef.current,
                anchors: [{ kind: "top" }],
                renderers: diligenceRenderers,
                onAcceptDecoration: (runId, blockType) =>
                  onAcceptDecorationRef.current?.(runId, blockType),
                onDismissDecoration: (runId, blockType) =>
                  onDismissDecorationRef.current?.(runId, blockType),
                onRefreshDecoration: (runId, blockType) =>
                  onRefreshDecorationRef.current?.(runId, blockType),
                onAskAboutDecoration: (runId, blockType) =>
                  onAskAboutDecorationRef.current?.(runId, blockType),
              }),
            ];
          },
        }),
      [diligenceRenderers],
    );
    const baseExtensions = useMemo(
      () => [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          codeBlock: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          horizontalRule: false,
          link: false,
          underline: false,
        }),
        Underline,
        // Framework audit §6 / violation #6: first-time users had no hint
        // the editor does more than typing. A single ghost-text prompt
        // ("Type / for commands…") when the block is empty + focused gives
        // discoverability without chrome. Hidden as soon as the user
        // begins typing — Tiptap's Placeholder handles that natively.
        Placeholder.configure({
          placeholder: "Type / for commands…",
          showOnlyCurrent: false,
          includeChildren: false,
          emptyEditorClass: "is-empty",
          emptyNodeClass: "is-empty",
        }),
        Link.configure({
          openOnClick: false,
          autolink: true,
        }),
        Image,
        NotebookMention.configure({
          suggestion: {
            char: "@",
            items: () => [],
          },
        }),
        diligenceExtension,
        ExpandableMention,
      ],
      [diligenceExtension],
    );

    const syncApi = useMemo(
      () =>
        api?.domains.product.blockProsemirror
          ? {
              getSnapshot: api.domains.product.blockProsemirror.getSnapshot,
              latestVersion: api.domains.product.blockProsemirror.latestVersion,
              getSteps: api.domains.product.blockProsemirror.getSteps,
              submitSteps: api.domains.product.blockProsemirror.submitSteps,
              submitSnapshot: api.domains.product.blockProsemirror.submitSnapshot,
            }
          : null,
      [api],
    );

    const sync = useTiptapSync(
      (syncApi ?? {
        getSnapshot: "skip",
        latestVersion: "skip",
        getSteps: "skip",
        submitSteps: "skip",
        submitSnapshot: "skip",
      }) as any,
      syncDocumentId,
      {
        snapshotDebounceMs: 900,
      },
    );

    // Latch `sync.extension` and `sync.initialContent` once populated so
    // `useEditor`'s dep array doesn't churn on every parent re-render.
    // Without this, any parent reactivity (pagination tick, another
    // block's update) can rebuild every editor on the page — which is
    // the "every block is loading" perception. These values are
    // monotonically populated once (null/undefined → set); collab
    // updates flow through the extension itself, not through reference
    // identity changes.
    const latchedExtensionRef = useRef<typeof sync.extension | null>(null);
    const latchedInitialContentRef = useRef<typeof sync.initialContent | null>(null);
    if (sync.extension && !latchedExtensionRef.current) {
      latchedExtensionRef.current = sync.extension;
    }
    if (sync.initialContent !== null && latchedInitialContentRef.current === null) {
      latchedInitialContentRef.current = sync.initialContent;
    }
    const stableExtension = latchedExtensionRef.current;
    const stableInitialContent = latchedInitialContentRef.current;

    useEffect(() => {
      if (sync.isLoading || sync.initialContent !== null || createRequestedRef.current) {
        return;
      }
      createRequestedRef.current = true;
      void sync.create(chipsToProsemirrorDoc(chips));
    }, [chips, sync]);

    useEffect(() => {
      isEditableRef.current = isEditable;
    }, [isEditable]);

    useEffect(() => {
      onFocusRef.current = onFocus;
      onBlurRef.current = onBlur;
      onLocalContentChangeRef.current = onLocalContentChange;
      onEnterRef.current = onEnter;
      onBackspaceAtStartRef.current = onBackspaceAtStart;
      onOpenSlashRef.current = onOpenSlash;
      onCloseSlashRef.current = onCloseSlash;
      onMarkdownShortcutRef.current = onMarkdownShortcut;
      onTabIndentRef.current = onTabIndent;
      onShiftTabOutdentRef.current = onShiftTabOutdent;
      onAcceptDecorationRef.current = onAcceptDecoration;
      onDismissDecorationRef.current = onDismissDecoration;
      onRefreshDecorationRef.current = onRefreshDecoration;
      onAskAboutDecorationRef.current = onAskAboutDecoration;
    }, [
      onAcceptDecoration,
      onAskAboutDecoration,
      onBackspaceAtStart,
      onBlur,
      onCloseSlash,
      onDismissDecoration,
      onEnter,
      onFocus,
      onLocalContentChange,
      onOpenSlash,
      onRefreshDecoration,
    ]);

    const editorOptions = useMemo(
      () => ({
        immediatelyRender: false,
        editable: isEditableRef.current,
        content:
          stableInitialContent ??
          ({
            type: "doc",
            content: [{ type: "paragraph" }],
          } as const),
        extensions: stableExtension ? [...baseExtensions, stableExtension] : baseExtensions,
        editorProps: {
          attributes: {
            // `nb-block-shell` here mirrors what the fallback wrapper uses,
            // so the fallback → live editor swap is pixel-identical: same
            // containment, same layout isolation, no reflow flash.
            class: `nb-block-shell outline-none focus-visible:outline-none ${className} ${
              !isEditableRef.current ? "cursor-default opacity-80" : ""
            }`,
            role: "textbox",
            "aria-label": ariaLabel,
            "aria-readonly": String(!isEditableRef.current),
          },
          handleKeyDown(view: any, event: KeyboardEvent) {
            const textContent = view.state.doc.textContent;
            if (!isEditableRef.current) {
              if (event.key === "Escape") onCloseSlashRef.current();
              if (
                event.key === "/" ||
                event.key === "Enter" ||
                event.key === "Backspace" ||
                event.key.length === 1
              ) {
                event.preventDefault();
                return true;
              }
              return false;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onEnterRef.current();
              return true;
            }
            if (event.key === "Backspace" && textContent.length === 0) {
              event.preventDefault();
              onBackspaceAtStartRef.current();
              return true;
            }
            if (event.key === "/" && !event.shiftKey && textContent.length === 0) {
              event.preventDefault();
              onOpenSlashRef.current();
              return true;
            }
            // Block-level markdown shortcuts — trigger on Space after the
            // prefix, mirroring Notion/Linear. Only fires when the block's
            // only text so far is the prefix itself (prevents mid-line
            // accidents).
            if (event.key === " " && onMarkdownShortcutRef.current) {
              const match = MARKDOWN_SHORTCUTS[textContent];
              if (match) {
                event.preventDefault();
                // Clear the prefix — the kind change visually carries the
                // semantic, no need to keep the "##" characters.
                view.dispatch(
                  view.state.tr.delete(0, view.state.doc.content.size),
                );
                onMarkdownShortcutRef.current(match);
                return true;
              }
            }
            // Tab / Shift-Tab — indent/outdent the block via moveBlock
            // in the parent. Roam/Obsidian convention. PreventDefault on
            // Tab is required to stop the browser from moving focus.
            if (event.key === "Tab") {
              event.preventDefault();
              if (event.shiftKey) {
                onShiftTabOutdentRef.current?.();
              } else {
                onTabIndentRef.current?.();
              }
              return true;
            }
            if (event.key === "Escape") {
              onCloseSlashRef.current();
            }
            return false;
          },
        },
        onFocus() {
          onFocusRef.current();
        },
        onBlur() {
          onBlurRef.current();
        },
        onUpdate({ editor: activeEditor }: { editor: { getJSON: () => unknown } }) {
          const onLocalContentChange = onLocalContentChangeRef.current;
          if (!onLocalContentChange || !stableInitialContent || !stableExtension) return;
          const nextContent = prosemirrorDocToChips(activeEditor.getJSON()) as BlockChip[];
          const signature = JSON.stringify(nextContent);
          if (signature === lastPublishedRef.current) return;
          lastPublishedRef.current = signature;
          onLocalContentChange(nextContent);
        },
      }),
      [
        ariaLabel,
        baseExtensions,
        className,
        stableExtension,
        stableInitialContent,
      ],
    );

    const editor = useEditor(
      editorOptions,
      [syncDocumentId, stableExtension, stableInitialContent],
    );

    useEffect(() => {
      diligenceDecorationsRef.current = diligenceDecorations;
      if (!editor || editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(diligenceDecorationPluginKey, true));
    }, [diligenceDecorations, editor]);

    const focusEditorSafely = useCallback(() => {
      if (typeof window === "undefined") return;
      window.requestAnimationFrame(() => {
        if (!editor || editor.isDestroyed) return;
        const mounted =
          Boolean((editor as { view?: { dom?: Node } }).view?.dom?.isConnected) ||
          Boolean((editor.options.element as HTMLElement | null | undefined)?.isConnected);
        if (!mounted) return;
        try {
          editor.commands.focus("end");
        } catch {
          // The sync editor can be re-created during collaboration bursts.
          // Missing a single autofocus attempt is acceptable; crashing the
          // whole live notebook is not.
        }
      });
    }, [editor]);

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(isEditable);
    }, [editor, isEditable]);

    useEffect(() => {
      if (!editor || !autoFocus) return;
      focusEditorSafely();
    }, [autoFocus, editor, focusEditorSafely]);

    useImperativeHandle(
      ref,
      () => ({
        insertMention(match) {
          if (!editor) return;
          const mounted =
            Boolean((editor as { view?: { dom?: Node } }).view?.dom?.isConnected) ||
            Boolean((editor.options.element as HTMLElement | null | undefined)?.isConnected);
          if (!mounted) return;
          editor
            .chain()
            .focus()
            .insertContent([
              {
                type: "mention",
                attrs: {
                  id: match.slug,
                  label: match.name,
                  mentionSuggestionChar: "@",
                },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
        focus() {
          focusEditorSafely();
        },
      }),
      [editor, focusEditorSafely],
    );

    // While the sync snapshot is loading, render the static chip content
    // (not a "Loading…" placeholder) so block clicks feel instant — the
    // editor swaps in live once Convex responds, without a visible flash.
    // This is the Notion/Linear pattern: content is always visible; edit
    // affordance upgrades in place.
    //
    // Key polish notes:
    //   - No `aria-busy` here: the chips ARE real content, not a loading
    //     state. Announcing "busy" would flood screen readers on every
    //     notebook open/scroll.
    //   - `ProseMirror` class on the wrapper matches what TipTap renders,
    //     so typography, spacing, and chip alignment are pixel-identical
    //     between fallback and live editor — the swap is invisible.
    //   - `contain: content` (via `nb-block-shell`) isolates layout so
    //     one block's hydration doesn't reflow its neighbors.
    if (!api || !stableExtension || !stableInitialContent || !editor) {
      // When chips render no visible text, add a <br> so the line-box matches
      // what TipTap will later render (`<p><br class="ProseMirror-trailingBreak"></p>`).
      // Without it, `nb-block-shell`'s `content-visibility: auto` sizes the
      // empty wrapper to `contain-intrinsic-size` (~24.5px) instead of the
      // line-height-driven 28px, causing a 3.5px dip during the hover→mount
      // transition — the "empty newline expands on hover" jitter.
      // "Empty" here means no chip contributes a line-box: whitespace-only
      // text/mention/link chips count as empty. Image and linebreak chips
      // DO render visible content (an <img> or a <br>) so they are non-empty.
      const chipsEmpty = chips.every((c) => {
        if (c.type === "image") return false;
        if (c.type === "linebreak") return false;
        return !c.value || c.value.trim().length === 0;
      });
      return (
        <div
          className={`ProseMirror nb-block-shell ${className} outline-none focus-visible:outline-none`}
          role="textbox"
          aria-label={ariaLabel}
        >
          <BlockChipRenderer chips={chips} />
          {chipsEmpty ? <br aria-hidden="true" /> : null}
        </div>
      );
    }

    /**
     * Slice C.2 — delegated click routing for decoration action buttons.
     *
     * The FounderRenderer (and future block renderers) emit <button> elements
     * with `data-action`, `data-block`, and `data-run-id` attributes. A single
     * capture-level click handler on the editor wrapper routes them to
     * parent-supplied callbacks without requiring renderers to manage React
     * refs directly.
     *
     * Actions route via the refs (so handler identity stays stable):
     *   - accept   → onAcceptDecoration(runId, blockType)
     *   - refresh  → onRefreshDecoration(runId, blockType)
     *   - dismiss  → onDismissDecoration(runId, blockType)
     *
     * The parent (EntityNotebookLive) wires those to the Phase 2 runtime:
     *   - acceptDecorationIntoNotebook() / ProseMirror frozen-snapshot insert
     *   - re-run this block's sub-agent
     *   - sessionArtifacts.dismissArtifact + decoration plugin flush
     *
     * Event delegation keeps the editor render tree unchanged when new block
     * types or new renderers arrive.
     */
    return <EditorContent editor={editor} />;
  },
);

export default NotebookBlockEditor;
