import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import { EditorProvider, useCurrentEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import { useQuery, useMutation, useConvex } from "convex/react";

import { type PartialBlock, BlockNoteEditor } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { SuggestionMenuController } from "@blocknote/react";

import { ProposalProvider } from "@/components/proposals/ProposalProvider";
import { ProposalBar } from "@/components/proposals/ProposalBar";
import { useInlineFastAgent } from "./UnifiedEditor/useInlineFastAgent";
import { InlineAgentProgress } from "./UnifiedEditor/InlineAgentProgress";
import { DeepAgentProgress } from "./UnifiedEditor/DeepAgentProgress";
import { PendingEditHighlights } from "./UnifiedEditor/PendingEditHighlights";
import { ProposalInlineDecorations } from "./UnifiedEditor/ProposalInlineDecorations";
import { usePendingEdits } from "../hooks/usePendingEdits";

import { computeStructuredOps } from "@/components/proposals/diffUtils";

// Import extracted utilities and types
import type { EditorMode, UnifiedEditorProps, AIToolAction } from "../types";
import { extractPlainText, blocksAreTriviallyEmpty, getBlockText, bnEnsureTopLevelBlock } from "../utils/blockUtils";
import { sanitizeProseMirrorContent } from "../utils/sanitize";
import { useFileUpload } from "../hooks/useFileUpload";
import { useAIKeyboard } from "../hooks/useAIKeyboard";
import { useMentionMenu } from "../hooks/useMentionMenu";
import { useHashtagMenu } from "../hooks/useHashtagMenu";
import { useSlashMenuItems } from "../hooks/useSlashMenuItems";
import { useFeedback } from "@/shared/hooks/useFeedback";

// Re-export types for backwards compatibility
export type { EditorMode, UnifiedEditorProps };

// Caches for seeding state
const seededDocCache = new Map<string, string>();
const restoreCache = new Map<string, { seed: string; signal: number }>();

/**
 * UnifiedEditor
 * - Single canonical editor based on BlockNote + Convex ProseMirror sync
 * - Supports three modes via lightweight UI/behavior switches
 *   - quickEdit: compact UI for small edits
 *   - quickNote: minimal single-note feel (no slash menu, compact paddings)
 *   - full: full-featured document editor
 */
export default function UnifiedEditor({ documentId, mode = "full", isGridMode, isFullscreen, editable = true, autoCreateIfEmpty = false, seedMarkdown, restoreSignal, restoreMarkdown, registerExporter }: UnifiedEditorProps) {

  const convex = useConvex();
  const currentUser = useQuery(api.domains.auth.auth.loggedInUser);

  // Explicit Convex refs required by the sync hook
  const pmRefs = useMemo(() => ({
    getSnapshot: api.domains.documents.prosemirror.getSnapshot,
    latestVersion: api.domains.documents.prosemirror.latestVersion,
    getSteps: api.domains.documents.prosemirror.getSteps,
    submitSteps: api.domains.documents.prosemirror.submitSteps,
    submitSnapshot: api.domains.documents.prosemirror.submitSnapshot,
  }), []);

  // Editor configuration by mode
  const isCompact = mode === "quickEdit" || mode === "quickNote";
  const disableSlashMenu = mode === "quickNote" || !editable; // keep super light or when view-only

  // File upload handler for BlockNote - using extracted hook
  const { uploadFile } = useFileUpload();

  // Note: We intentionally do NOT pass the custom schema to editorOptions here.
  // The useBlockNoteSync hook creates a headless BlockNoteEditor internally,
  // and passing React-based inline content specs (mention, hashtag) to a headless
  // editor causes "Every schema needs a 'text' type" errors because the React
  // rendering parts can't be initialized in headless mode.
  //
  // Instead, we'll apply the schema after the editor is created by using
  // the editor's built-in schema or by recreating the editor with the schema.
  const editorOptions = useMemo(() => ({
    uploadFile, // Add file upload handler
    // Note: TipTap extensions (TaskList, TaskItem, etc.) removed to fix
    // "Every schema needs a 'text' type" error. BlockNote's default schema
    // already includes list support via bulletListItem, numberedListItem, checkListItem.
  }), [uploadFile]);

  // Initialize sync hook
  const sync = useBlockNoteSync(pmRefs as any, documentId, {
    editorOptions,
    snapshotDebounceMs: 2000,
    onSyncError: (error: Error) => {
    },
  });

  // Initialize inline Fast Agent with streaming support
  const {
    askFastAgent,
    isStreaming: isAIStreaming,
    streamingMessages,
    threadId: inlineAgentThreadId,
  } = useInlineFastAgent({
    editor: sync.editor,
    userId: currentUser?._id,
    documentId,
  });

  // Subscribe to pending Deep Agent edits and apply them via PmBridge
  const {
    pendingEdits,
    hasFailedEdits,
    pendingCount,
    staleCount,
    isAgentEditing,
    isProcessing: isDeepAgentProcessing,
    currentEdit,
    editsByThread,
    retryEdit,
    cancelThreadEdits,
    cancelAllEdits,
  } = usePendingEdits(documentId);

  // State for DeepAgentProgress panel
  const [deepAgentMinimized, setDeepAgentMinimized] = useState(false);

  // Ref for editor container (used for edit highlights)
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Log Deep Agent edit activity for debugging
  useEffect(() => {
    if (isAgentEditing) {
      // Deep Agent editing state tracked (debug logging removed)
    }
    if (hasFailedEdits) {
    }
    if (staleCount > 0) {
    }
  }, [isAgentEditing, pendingCount, hasFailedEdits, staleCount, isDeepAgentProcessing]);

  // AI keyboard handler for /ai and /edit patterns - using extracted hook
  useAIKeyboard({ editor: sync.editor, askFastAgent });

  // Mention menu items - using extracted hook
  const { getMentionMenuItems } = useMentionMenu({ editor: sync.editor });

  // Hashtag menu items - using extracted hook
  const { getHashtagMenuItems } = useHashtagMenu({ editor: sync.editor, documentId });

  // Custom slash menu items for Fast Agent integration - using extracted hook
  const { getCustomSlashMenuItems } = useSlashMenuItems({ askFastAgent });

  // Sanitize the loaded content to remove unsupported node types
  const syncInitialContent = (sync as { initialContent?: unknown }).initialContent;
  useEffect(() => {
    if (syncInitialContent) {
      try {
        const sanitized = sanitizeProseMirrorContent(syncInitialContent as any);
        if (sanitized !== syncInitialContent) {
          // Content was sanitized to remove unsupported node types
        }
      } catch (err) {
        console.error("[UnifiedEditor] Error sanitizing content:", err);
      }
    }
  }, [syncInitialContent]);

  // --- AI proposal/apply wiring (parity with NB3, minimal overlay) ---
  type AIToolAction = {
    type: 'createDocument' | 'updateDocument' | 'archiveDocument' | 'findDocuments' | 'createNode' | 'updateNode' | 'archiveNode';
    documentId?: Id<'documents'>;
    title?: string;
    content?: unknown;
    nodeId?: Id<'nodes'>;
    parentId?: Id<'nodes'> | null;
    markdown?: string;
    // Optional semantic anchor: resolve target position by heading text
    anchorHeading?: string;
  };

  // Server-side content flag via agentsPrefs
  const prefs = useQuery((api as any).agentsPrefs.getAgentsPrefs, {} as any) as (Record<string, string> | undefined);
  const serverHadContent = useMemo(() => {
    try { return (prefs && prefs[`doc.hasContent.${String(documentId)}`] === '1') || false; } catch { return false; }
  }, [prefs, documentId]);
  const setAgentsPrefs = useMutation((api as any).agentsPrefs.setAgentsPrefs);
  const serverMarkedRef = useRef(false);
  const markHasContent = useCallback(async () => {
    if (serverMarkedRef.current) return;
    serverMarkedRef.current = true;
    try {
      await setAgentsPrefs({ prefs: { [`doc.hasContent.${String(documentId)}`]: '1' } as any });
    } catch { }
  }, [setAgentsPrefs, documentId]);
  // ProseMirror latest version preflight (to avoid creating when snapshots exist)
  const latestVersion = useQuery((api as any).prosemirror.latestVersion as any, { id: String(documentId) } as any) as number | null;
  const safeLatestVersion: number = typeof latestVersion === 'number' ? latestVersion : 0;


  const [pendingProposal, setPendingProposal] = useState<null | { message: string; actions: AIToolAction[]; anchorBlockId: string | null }>(null);
  const attemptedAutoCreateRef = useRef(false);
  const attemptedSeedRef = useRef(false);

  // Ensure file/doc notes exist without requiring a manual click
  useEffect(() => {
    if (
      autoCreateIfEmpty &&
      !serverHadContent &&
      safeLatestVersion <= 0 &&
      !sync.editor &&
      !attemptedAutoCreateRef.current
    ) {
      attemptedAutoCreateRef.current = true;
      try {
        void sync.create?.({ type: "doc", content: [] } as any);
      } catch (e) {
      }
    }
  }, [autoCreateIfEmpty, serverHadContent, safeLatestVersion, sync]);

  // Helper: get current or last block as a reasonable default target
  const getCurrentOrLastBlock = useCallback((): any | null => {
    try {
      const anyEd: any = sync.editor as any;
      const pos = anyEd?.getTextCursorPosition?.();
      if (pos?.block) return pos.block;
      const all = anyEd?.topLevelBlocks ?? [];
      return all.length ? all[all.length - 1] : null;
    } catch { return null; }
  }, [sync.editor]);

  // bnEnsureTopLevelBlock is imported from ../utils/blockUtils

  // Use default BlockNoteEditor for markdown parsing (no custom schema needed)
  // The custom schema with mention/hashtag is only needed for the main editor
  const parserEditor = useMemo(() => BlockNoteEditor.create(), []);

  const blocksFromMarkdown = useCallback(async (md?: string): Promise<any[]> => {
    const txt = (md ?? '').trim();
    if (!txt) return [];
    try {
      const rawBlocks: PartialBlock[] = await parserEditor.tryParseMarkdownToBlocks(txt);
      const unwrapLocal = (blocks: PartialBlock[]): PartialBlock[] => {
        const out: PartialBlock[] = [];
        const push = (b: any) => {
          if (!b) return;
          if (b._flattenFromDoc && Array.isArray(b.content)) {
            for (const c of b.content) push(bnEnsureTopLevelBlock(c));
            return;
          }
          if (b.type && b.type !== "blockGroup") out.push(b);
        };
        for (const b of blocks) push(bnEnsureTopLevelBlock(b as any));
        return out;
      };
      const unwrapped = unwrapLocal(rawBlocks);
      const normalized = unwrapped
        .map((b: any) => bnEnsureTopLevelBlock(b))
        .filter((b: any) => b && b.type && !["blockGroup", "text"].includes(b.type));
      return normalized;
    } catch (e) {
      return [{ type: 'paragraph', content: [{ type: 'text', text: txt }] }];
    }
  }, [parserEditor]);

  // Seed the document with provided markdown if editor exists and doc is empty or trivial
  useEffect(() => {
    const editor: any = sync.editor as any;
    if (!editor) return;
    if (attemptedSeedRef.current) return;

    const docKey = String(documentId);

    // Note: Do NOT skip seeding purely based on a local flag; only seed when the doc is actually empty/trivial.
    // This ensures previously created "null" docs still get seeded on first render.

    const blocks: any[] = Array.isArray(editor.topLevelBlocks) ? editor.topLevelBlocks : [];
    const isTriviallyEmpty = blocksAreTriviallyEmpty(blocks);

    const seed = (seedMarkdown || '').trim();
    const cachedSeed = seed ? seededDocCache.get(docKey) : undefined;
    const localHad = (() => { try { return window.localStorage.getItem(`nb.doc.hasContent.${String(documentId)}`) === '1'; } catch { return false; } })();
    const hadEverContent = (!!serverHadContent) || localHad;
    if (isTriviallyEmpty && seed) {
      if (cachedSeed === seed) { attemptedSeedRef.current = true; return; }
      // If the doc ever had content and is now empty, assume user intentionally cleared it; do not auto-reseed
      if (hadEverContent) { attemptedSeedRef.current = true; seededDocCache.set(docKey, seed); return; }
      attemptedSeedRef.current = true;
      void (async () => {
        try {
          const newBlocks = await blocksFromMarkdown(seed);
          if (Array.isArray(newBlocks) && newBlocks.length > 0) {
            const existing: any[] = Array.isArray(editor.topLevelBlocks) ? editor.topLevelBlocks : [];
            // Replace existing (possibly empty) blocks with seeded blocks
            editor.replaceBlocks(existing, newBlocks);
            seededDocCache.set(docKey, seed);
            // Mark document as having content
            try { window.localStorage.setItem(`nb.doc.hasContent.${String(documentId)}`, '1'); } catch { }; void markHasContent();
          }
        } catch (e) {
        }
      })();
    } else if (seed) {
      seededDocCache.set(docKey, seed);
    }
  }, [sync.editor, seedMarkdown, blocksFromMarkdown, documentId, serverHadContent, markHasContent]);


  // Restore from provided markdown when signal changes
  useEffect(() => {
    const editor: any = sync.editor as any;
    if (!editor) return;
    if (typeof restoreSignal !== 'number') return;
    const seed = (restoreMarkdown || '').trim();
    if (!seed) return;

    const docKey = String(documentId);
    const existing: any[] = Array.isArray(editor.topLevelBlocks) ? editor.topLevelBlocks : [];
    const isTriviallyEmpty = blocksAreTriviallyEmpty(existing);
    const explicitRestore = restoreSignal > 0;
    const cached = restoreCache.get(docKey);

    if (!explicitRestore) {
      if (!isTriviallyEmpty) return;
      if (cached && cached.seed === seed) return;
    } else if (cached && cached.seed === seed && cached.signal === restoreSignal) {
      return;
    }

    void (async () => {
      try {
        const newBlocks = await blocksFromMarkdown(seed);
        editor.replaceBlocks(existing, newBlocks);
        restoreCache.set(docKey, { seed, signal: explicitRestore ? restoreSignal : 0 });
        seededDocCache.set(docKey, seed);
        try { window.localStorage.setItem(`nb.doc.hasContent.${String(documentId)}`, '1'); } catch { }; void markHasContent();
      } catch (e) {
      }
    })();
  }, [restoreSignal, restoreMarkdown, blocksFromMarkdown, sync.editor, documentId, markHasContent]);

  // Helper: resolve target block by heading text (case-insensitive)
  const resolvePositionByHeading = useCallback((heading: string): any | null => {
    try {
      const anyEd: any = sync.editor as any;
      const blocks: any[] = anyEd?.topLevelBlocks ?? [];
      const needle = heading.trim().toLowerCase();
      return blocks.find((b: any) => {
        if (b?.type !== 'heading') return false;
        const text = (b?.content || []).map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join(' ').trim().toLowerCase();
        return text === needle;
      }) ?? null;
    } catch { return null; }
  }, [sync.editor]);

  const findBlockByNodeId = useCallback((nodeId: string): any | null => {
    try {
      const anyEd: any = sync.editor as any;
      const all: any[] = anyEd?.topLevelBlocks ?? [];
      return all.find((b: any) => String(b?.props?.nodeId ?? "") === nodeId) ?? null;
    } catch { return null; }
  }, [sync.editor]);

  // Apply a set of actions (minimal: updateNode/createNode with markdown)
  const applyActions = useCallback(async (actions: AIToolAction[], detail?: any) => {
    const editor: any = sync.editor as any;
    if (!editor) return;
    let anchor: any | null = null;
    // Prefer explicit block id if provided in event detail
    try {
      const anchorId: string | undefined = typeof detail?.anchorBlockId === 'string' ? detail.anchorBlockId : undefined;
      if (anchorId) {
        const all = editor.topLevelBlocks ?? [];
        anchor = all.find((b: any) => b.id === anchorId) ?? null;
      }
    } catch { /* noop */ }

    for (const action of actions) {
      if (action.type === 'updateDocument' && typeof action.title === 'string') {
        // Title rename handled elsewhere via toolbar; ignore in UnifiedEditor for now
        continue;
      }
      if ((action.type === 'updateNode' || action.type === 'createNode') && typeof action.markdown === 'string') {
        // Resolve target precedence: nodeId -> per-action anchorBlockId -> action.anchorHeading -> event anchor -> current/last
        let target: any | null = null;
        const nodeId: string | undefined = (action as any)?.nodeId;
        const perActionAnchorId: string | undefined = (action as any)?.anchorBlockId;
        if (nodeId) target = findBlockByNodeId(String(nodeId));
        if (!target && perActionAnchorId) {
          try {
            const all = editor.topLevelBlocks ?? [];
            target = all.find((b: any) => b.id === perActionAnchorId) ?? null;
          } catch { /* noop */ }
        }
        if (!target && action.anchorHeading) target = resolvePositionByHeading(action.anchorHeading);
        if (!target) target = anchor ?? getCurrentOrLastBlock();

        const newBlocks = await blocksFromMarkdown(action.markdown);
        if (!newBlocks.length) continue;
        if (action.type === 'updateNode' && target) {
          if (newBlocks.length === 1) {
            editor.updateBlock(target.id, newBlocks[0]);
          } else {
            editor.replaceBlocks([target], newBlocks);
          }
        } else if (action.type === 'createNode' && target) {
          editor.insertBlocks(newBlocks, target, 'after');
        } else if (action.type === 'createNode' && !target) {
          // Fallback: append to end
          const all = editor.topLevelBlocks ?? [];
          const last = all.length ? all[all.length - 1] : null;
          if (last) editor.insertBlocks(newBlocks, last, 'after');
          else editor.replaceBlocks([], newBlocks);
        }
      }
    }
  }, [sync.editor, blocksFromMarkdown, getCurrentOrLastBlock, resolvePositionByHeading, findBlockByNodeId]);

  // Listen for proposals and apply requests from AIChatPanel/test buttons
  useEffect(() => {
    const onProposal = (evt: Event) => {
      const e = evt as CustomEvent<any>;
      const detail = e?.detail || {};
      const actions: AIToolAction[] = Array.isArray(detail?.actions) ? detail.actions : [];
      const message: string = typeof detail?.message === 'string' ? detail.message : 'AI proposed changes';
      if (!actions.length) return;
      // Compute a reasonable anchor block id (current selection -> second block -> first)
      let anchorBlockId: string | null = null;
      try {
        const anyEd: any = sync.editor as any;
        const pos = anyEd?.getTextCursorPosition?.();
        if (pos?.block?.id) anchorBlockId = String(pos.block.id);
        if (!anchorBlockId) {
          const all: any[] = anyEd?.topLevelBlocks ?? [];
          const first = all?.[0] ?? null;
          const second = all?.[1] ?? null;
          anchorBlockId = second?.id ?? first?.id ?? null;
        }
      } catch { /* noop */ }
      setPendingProposal({ message, actions, anchorBlockId });
    };
    const onApply = (evt: Event) => {
      const e = evt as CustomEvent<any>;
      const detail = e?.detail || {};
      const actions: AIToolAction[] = Array.isArray(detail?.actions) ? detail.actions : [];
      if (!actions.length) return;
      void applyActions(actions, detail);
      setPendingProposal(null);
      // Trigger success feedback sound
      try {
        window.dispatchEvent(new CustomEvent('nodebench:feedback:success'));
      } catch { /* noop */ }
    };
    window.addEventListener('nodebench:aiProposal', onProposal);
    window.addEventListener('nodebench:applyActions', onApply);
    return () => {
      window.removeEventListener('nodebench:aiProposal', onProposal);
      window.removeEventListener('nodebench:applyActions', onApply);
    };
  }, [applyActions, sync.editor]);

  // Enable hidden Tiptap shadow editor only when AI Chat is active
  const [aiChatActive, setAiChatActive] = useState(false);
  useEffect(() => {
    const onMount = () => setAiChatActive(true);
    const onUnmount = () => setAiChatActive(false);
    window.addEventListener('nodebench:aiChat:mounted', onMount as EventListener);
    window.addEventListener('nodebench:aiChat:unmounted', onUnmount as EventListener);
    return () => {
      window.removeEventListener('nodebench:aiChat:mounted', onMount as EventListener);
      window.removeEventListener('nodebench:aiChat:unmounted', onUnmount as EventListener);
    };
  }, []);

  // Bridge component that exposes PM context + accepts PM operations
  const PmBridge: React.FC<{ documentId: string | Id<"documents"> | undefined }>
    = ({ documentId }) => {
      const { editor } = useCurrentEditor();

      useEffect(() => {
        if (!editor) return;
        const buildContext = () => {
          try {
            const json = editor.state.doc.toJSON();
            const { from, to } = editor.state.selection;
            const nodes: any[] = [];
            editor.state.doc.descendants((node: any, pos: number) => {
              const entry: any = { type: node.type.name, from: pos, to: pos + node.nodeSize };
              if (node.attrs && Object.keys(node.attrs).length) entry.attrs = node.attrs;
              if (node.isText && typeof node.text === 'string') entry.text = node.text;
              nodes.push(entry);
            });
            return { doc: json, selection: { from, to }, nodes };
          } catch (e) {
            return null;
          }
        };

        const onRequest = (evt: Event) => {
          const e = evt as CustomEvent<{ requestId: string }>;
          const ctx = buildContext();
          try {
            window.dispatchEvent(new CustomEvent('nodebench:ai:pmContext', {
              detail: { requestId: e.detail?.requestId, documentId, context: ctx },
            }));
          } catch (err) {
          }
        };

        const onApply = (evt: Event) => {
          // Extended type for Deep Agent edit support with result callback
          interface ApplyOperationsDetail {
            operations?: any[];
            documentId?: string;
            documentVersion?: number; // Version at time of edit creation (OCC)
            editId?: string; // Deep Agent edit ID for tracking
            anchorOccurrenceStrategy?: "nearest" | "next" | "prev";
            onResult?: (success: boolean, error?: string) => void; // Callback for result reporting
          }
          const e = evt as CustomEvent<ApplyOperationsDetail>;
          const ops: any[] = Array.isArray(e.detail?.operations) ? e.detail?.operations : [];
          const anchorOccurrenceStrategy = e.detail?.anchorOccurrenceStrategy;
          const onResult = e.detail?.onResult;
          const editId = e.detail?.editId;
          const editDocVersion = e.detail?.documentVersion;

          if (!ops.length) {
            onResult?.(false, "No operations provided");
            return;
          }

          // Optimistic Locking Validation: Check if document version has changed
          // The edit was created at a specific version - if the document has changed since,
          // the edit may be stale and could cause conflicts
          if (typeof editDocVersion === 'number' && typeof safeLatestVersion === 'number') {
            if (editDocVersion < safeLatestVersion) {
              const versionDiff = safeLatestVersion - editDocVersion;

              // Allow small version differences (user may have made minor edits)
              // but reject if too far behind (document has changed significantly)
              const MAX_VERSION_DRIFT = 10; // Allow up to 10 versions of drift
              if (versionDiff > MAX_VERSION_DRIFT) {
                const errMsg = `Edit is stale: document has changed significantly (${versionDiff} versions behind). Please retry the edit.`;
                console.error(`[PM Bridge] Rejecting stale edit ${editId}:`, errMsg);
                onResult?.(false, errMsg);
                return;
              } else {
                // Minor version drift allowed
              }
            }
          }

          // Track operation results for Deep Agent feedback
          const operationErrors: string[] = [];

          try {
            editor.chain().focus();

            // Build a text index to map plain-text offsets to PM positions
            const segments: { text: string; plainStart: number; plainEnd: number; pmStart: number; pmEnd: number }[] = [];
            let plainCursor = 0;
            const doc = editor.state.doc;
            doc.descendants((node, pos) => {
              if (node.isText && typeof node.text === 'string') {
                const text = node.text;
                const pmStart = pos;
                const pmEnd = pos + node.nodeSize; // for text, nodeSize === text.length
                const plainStart = plainCursor;
                const plainEnd = plainStart + text.length;
                segments.push({ text, plainStart, plainEnd, pmStart, pmEnd });
                plainCursor = plainEnd;
              }
            });
            const fullPlain = segments.map(s => s.text).join('');
            const plainToPm = (offset: number): number | null => {
              if (offset < 0) return null;
              for (const s of segments) {
                if (offset >= s.plainStart && offset <= s.plainEnd) {
                  const delta = offset - s.plainStart;
                  return s.pmStart + delta;
                }
              }
              return null;
            };

            const pmToPlain = (pos: number): number | null => {
              for (const s of segments) {
                const len = s.plainEnd - s.plainStart;
                if (pos >= s.pmStart && pos <= s.pmStart + len) {
                  const delta = pos - s.pmStart;
                  return s.plainStart + delta;
                }
              }
              return null;
            };


            for (const op of ops) {
              if (!op || typeof op !== 'object') continue;

              if (op.type === 'replace' && typeof op.from === 'number' && typeof op.to === 'number') {
                const content = op.content ?? [];
                editor.chain().deleteRange({ from: op.from, to: op.to }).insertContentAt(op.from, content).run();

              } else if (op.type === 'insert' && typeof op.at === 'number') {
                const content = op.content ?? [];
                editor.chain().insertContentAt(op.at, content).run();

              } else if (op.type === 'delete' && typeof op.from === 'number' && typeof op.to === 'number') {
                editor.chain().deleteRange({ from: op.from, to: op.to }).run();

              } else if (op.type === 'setAttrs' && typeof op.pos === 'number' && op.attrs && typeof op.attrs === 'object') {
                // Best-effort node attribute update at a position
                editor.commands.command(({ tr, state }) => {
                  try {
                    const $pos = state.doc.resolve(op.pos);
                    const node = $pos.nodeAfter || $pos.parent?.maybeChild($pos.index());
                    if (!node) return false;
                    const type = node.type;
                    tr.setNodeMarkup(op.pos, type, { ...(node.attrs || {}), ...(op.attrs || {}) });
                    return true;
                  } catch {
                    return false;
                  }
                });

              } else if (op.type === 'anchoredReplace' && typeof op.anchor === 'string') {
                // Support both old format (delete/insert) and new format (search/replace)
                const anchor: string = op.anchor;
                const toDelete: string = typeof op.delete === 'string' ? op.delete : (typeof op.search === 'string' ? op.search : '');
                const toInsert: string = typeof op.insert === 'string' ? op.insert : (typeof op.replace === 'string' ? op.replace : '');

                // Find all occurrences of the anchor in the flattened plain text
                const occ: number[] = [];
                if (anchor.length > 0) {
                  let i = 0;
                  while (i <= fullPlain.length) {
                    const j = fullPlain.indexOf(anchor, i);
                    if (j === -1) break;
                    occ.push(j);
                    i = j + Math.max(1, anchor.length);
                  }
                }

                if (occ.length === 0) {
                  const errMsg = `Anchor not found: "${anchor.slice(0, 50)}${anchor.length > 50 ? '...' : ''}"`;
                  operationErrors.push(errMsg);
                  continue;
                }

                // Prefer the occurrence closest to the current selection; allow next/prev cycling
                const selPm = editor.state.selection?.from ?? 0;
                const selPlain = pmToPlain(selPm) ?? 0;
                let nearestValue = occ[0];
                let nearestIdx = 0;
                let bestDist = Math.abs(nearestValue - selPlain);
                for (let k = 0; k < occ.length; k++) {
                  const val = occ[k];
                  const d = Math.abs(val - selPlain);
                  if (d < bestDist) { bestDist = d; nearestValue = val; nearestIdx = k; }
                }
                let chosenIdx = nearestIdx;
                if (anchorOccurrenceStrategy === 'next' && occ.length > 1) {
                  chosenIdx = (nearestIdx + 1) % occ.length;
                } else if (anchorOccurrenceStrategy === 'prev' && occ.length > 1) {
                  chosenIdx = (nearestIdx - 1 + occ.length) % occ.length;
                }
                const bestIdx = occ[chosenIdx];

                const fromPlain = bestIdx + anchor.length;
                const toPlain = fromPlain + toDelete.length;
                const pmFrom = plainToPm(fromPlain);
                const pmTo = plainToPm(toPlain);
                if (typeof pmFrom === 'number' && typeof pmTo === 'number') {
                  const chain = editor.chain().deleteRange({ from: pmFrom, to: pmTo });
                  if (toInsert) chain.insertContentAt(pmFrom, toInsert);
                  chain.run();
                } else {
                  const errMsg = `Failed to map offsets for anchor: "${anchor.slice(0, 30)}..."`;
                  operationErrors.push(errMsg);
                }

              } else if (op.type === 'replaceDocument' && typeof op.content === 'string') {
                editor.commands.clearContent(true);
                if (op.content) editor.chain().insertContent(op.content).run();
              }
            }

            // Report success/failure to Deep Agent via callback
            if (onResult) {
              if (operationErrors.length > 0) {
                onResult(false, operationErrors.join("; "));
              } else {
                onResult(true);
              }
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            // Report failure to Deep Agent
            onResult?.(false, `Operation failed: ${errorMsg}`);
          }
        };

        window.addEventListener('nodebench:ai:requestPmContext', onRequest as EventListener);
        window.addEventListener('nodebench:ai:applyPmOperations', onApply as EventListener);
        return () => {
          window.removeEventListener('nodebench:ai:requestPmContext', onRequest as EventListener);
          window.removeEventListener('nodebench:ai:applyPmOperations', onApply as EventListener);
        };
      }, [editor, documentId, safeLatestVersion]);

      // Broadcast editor focus/selection with a lightweight preview for Chat auto-selection and chips
      useEffect(() => {
        const editor: any = (sync as any)?.editor;
        if (!editor) return;
        const emit = () => {
          try {
            // Prefer current block text; fallback to small slice of doc
            let preview = '';
            try {
              const blk = getCurrentOrLastBlock();
              if (blk) preview = (getBlockText(blk) || '').slice(0, 200);
            } catch { }
            if (!preview) {
              try {
                const texts: string[] = [];
                editor.state.doc.descendants((n: any) => { if (n.isText && typeof n.text === 'string') texts.push(n.text); });
                preview = texts.join(' ').slice(0, 200);
              } catch { }
            }
            window.dispatchEvent(new CustomEvent('nodebench:editor:focused', { detail: { documentId, preview } }));
            // Persist a local flag indicating this doc has content, to avoid reseeding on next mount
            if ((preview || '').trim().length > 0) {
              try { window.localStorage.setItem(`nb.doc.hasContent.${String(documentId)}`, '1'); } catch { }; void markHasContent();
            }
          } catch { }
        };
        try { emit(); } catch { }
        try { editor.on('selectionUpdate', emit); } catch { }
        try { editor.on('update', emit); } catch { }
        return () => {
          try { editor.off?.('selectionUpdate', emit); } catch { }
          try { editor.off?.('update', emit); } catch { }
        };
      }, [sync.editor, documentId, getCurrentOrLastBlock, getBlockText]);

      return null;
    };

  // Expose exporter to parent
  useEffect(() => {
    if (!registerExporter) return;
    const ed: any = sync.editor as any;
    if (!ed) return;
    registerExporter(async () => {
      try {
        const blocks: any[] = ed?.topLevelBlocks ?? [];
        const plain = blocks.map(getBlockText).join('\n\n');
        return { plain };
      } catch {
        return { plain: '' };
      }
    });
  }, [registerExporter, sync.editor]);

  // Hidden Tiptap editor used only for PM context/exact offsets
  const ShadowTiptap: React.FC = () => {
    const syncTT = useTiptapSync(pmRefs as any, documentId);
    if (syncTT.isLoading || syncTT.initialContent === null) return null;
    return (
      <div style={{ display: 'none' }} aria-hidden>
        {(() => {
          try {
            let json = syncTT.initialContent as any;

            // Sanitize content to remove unsupported node types
            json = sanitizeProseMirrorContent(json);

            const containsBN = JSON.stringify(json).includes('blockContainer') || JSON.stringify(json).includes('blockGroup');
            const extractText = (node: any): string => {
              if (!node) return '';

              if (typeof node === 'string') return node;
              if (Array.isArray(node)) return node.map(extractText).join(' ');
              const type = node.type;
              if (type === 'text' && typeof node.text === 'string') return node.text;
              const content = Array.isArray(node.content) ? node.content : [];
              return content.map(extractText).join(' ');
            };
            const safeContent = containsBN
              ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: extractText(json) }] }] }
              : json;
            return (
              <EditorProvider content={safeContent as any} extensions={[StarterKit, syncTT.extension]}>
                <PmBridge documentId={documentId} />
              </EditorProvider>
            );
          } catch (err) {
            console.error("[UnifiedEditor] Error rendering ShadowTiptap:", err);
            // Return empty editor on error
            return (
              <EditorProvider content={{ type: 'doc', content: [] }} extensions={[StarterKit, syncTT.extension]}>
                <PmBridge documentId={documentId} />
              </EditorProvider>
            );
          }
        })()}
      </div>
    );
  };


  // Helpers for diff overlay

  const getBlockEl = useCallback((blockId: string): HTMLElement | null => {
    const root = editorContainerRef.current;
    try {
      return (root?.querySelector?.(`[data-block-id="${blockId}"], [data-id="${blockId}"]`) as HTMLElement) || null;
    } catch {
      return null;
    }
  }, [editorContainerRef]);

  const computeProposalTargets = useCallback(() => {
    const targets: Array<{ blockId: string; nodeId?: string; ops: { type: 'eq' | 'add' | 'del'; line: string }[]; action: any }> = [];
    try {
      if (!pendingProposal) return targets;
      const actions = (pendingProposal.actions || []).filter((a: any) => typeof (a as any)?.markdown === 'string');
      const anyEd: any = sync.editor as any;
      const allBlocks: any[] = anyEd?.topLevelBlocks ?? [];
      for (const action of actions) {
        let blk: any | null = null;
        if (action.nodeId) blk = findBlockByNodeId(String(action.nodeId));
        if (!blk) {
          const perAnchor = (action as any)?.anchorBlockId ?? pendingProposal.anchorBlockId;
          if (perAnchor) blk = allBlocks.find(b => b.id === perAnchor) ?? null;
        }
        if (!blk) continue;
        const current = getBlockText(blk);
        const proposed = String(action.markdown || '');
        const { ops } = computeStructuredOps(current, proposed);
        targets.push({ blockId: blk.id, nodeId: action.nodeId, ops, action });
      }
    } catch { }
    return targets;
  }, [pendingProposal, sync.editor, getBlockText]);








  const [positionTick, setPositionTick] = useState(0);
  void positionTick;
  useEffect(() => {
    const root = editorContainerRef.current;
    const handle = () => setPositionTick((t) => t + 1);
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    root?.addEventListener('scroll', handle, true);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
      root?.removeEventListener('scroll', handle, true);
    };
  }, []);

  // Revert to a previous local checkpoint by applying inverse actions

  if (sync.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="flex flex-col items-center gap-2 text-sm text-content-secondary">

          <div className="motion-safe:animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500/30" />
          Loading editor…
        </div>
      </div>
    );
  }

  // Check if sync has an error (e.g., unsupported node types)
  const syncError = (sync as { error?: unknown }).error;
  if (syncError) {
    console.error("[UnifiedEditor] Sync error:", syncError);
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <p className="text-content-secondary mb-4">Unable to load document</p>
          <p className="text-xs text-[var(--text-tertiary)] mb-4">{String(syncError)}</p>
          <button
            className="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white"
            onClick={() => window.location.reload()}
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  if (!sync.editor) {
    if (autoCreateIfEmpty) {
      return (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="flex items-center gap-2 text-content-secondary text-sm">
            <div className="motion-safe:animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500/30" />
            Preparing notes…
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <button
          className="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white"
          onClick={() => { void sync.create?.({ type: "doc", content: [] } as any); }}
        >
          Create document
        </button>
      </div>
    );
  }

  const enableProposalUI = ((import.meta as any)?.env?.VITE_PROPOSAL_UI === 'on');
  const proposalTargets = (enableProposalUI && editable && pendingProposal) ? computeProposalTargets() : [] as any[];
  return (
    <ProposalProvider>
      <div
        ref={editorContainerRef}
        className={`max-w-none relative ${isCompact ? "prose prose-sm" : "prose prose-lg"} ${isGridMode && !isFullscreen ? "minimal-grid-mode" : ""
          }`}
        data-editor-id={documentId}
      >

        {/* {aiChatActive && <ShadowTiptap />} */}

        {pendingProposal && (
          <div className="absolute top-2 right-2 z-10 bg-surface-secondary/95 backdrop-blur border border-edge rounded-md shadow p-2 flex items-center gap-2">
            <span className="text-xs text-content-secondary truncate max-w-[260px]" title={pendingProposal.message}>
              {pendingProposal.message}
            </span>
            <button
              className="px-2 py-0.5 text-xs rounded bg-indigo-600 text-white hover:opacity-90"
              onClick={() => {
                try {
                  window.dispatchEvent(new CustomEvent('nodebench:applyActions', { detail: { actions: pendingProposal.actions, anchorBlockId: pendingProposal.anchorBlockId } }));
                } catch { /* ignore */ }
              }}
            >
              Apply
            </button>
            <button
              className="px-2 py-0.5 text-xs rounded border border-edge hover:bg-surface-hover"
              onClick={() => setPendingProposal(null)}
            >
              Dismiss
            </button>
          </div>

        )}
        {editable && enableProposalUI && pendingProposal && Array.isArray(proposalTargets) && (proposalTargets as any[]).length > 0 && (
          <ProposalBar targets={proposalTargets as any} onDismiss={() => setPendingProposal(null)} />
        )}
        {editable && pendingProposal && (
          <ProposalInlineDecorations
            pendingProposal={pendingProposal}
            setPendingProposal={setPendingProposal as unknown as (p: any) => void}
            computeProposalTargets={computeProposalTargets}
            findBlockByNodeId={findBlockByNodeId}
            syncEditor={sync.editor}
            editorContainerRef={editorContainerRef as React.RefObject<HTMLDivElement>}
            getBlockEl={getBlockEl}
          />
        )}

        {/* AI Streaming Indicator */}
        {isAIStreaming && (
          <div
            style={{
              position: 'fixed',
              bottom: '20px',
              right: '20px',
              maxWidth: '400px',
              zIndex: 1000,
            }}
          >
            <InlineAgentProgress
              messages={streamingMessages}
              isStreaming={isAIStreaming}
              threadId={inlineAgentThreadId}
              onViewInPanel={() => {
                if (inlineAgentThreadId) {
                  window.dispatchEvent(
                    new CustomEvent('navigate:fastAgentThread', {
                      detail: { threadId: inlineAgentThreadId },
                    })
                  );
                }
              }}
            />
          </div>
        )}

        {/* Deep Agent Progress Indicator */}
        {isAgentEditing && (
          <div
            style={{
              position: 'fixed',
              bottom: '20px',
              left: '20px',
              zIndex: 1000,
            }}
          >
            <DeepAgentProgress
              pendingEdits={pendingEdits}
              isProcessing={isDeepAgentProcessing}
              currentEdit={currentEdit}
              editsByThread={editsByThread}
              onRetryEdit={retryEdit}
              onCancelThread={cancelThreadEdits}
              onCancelAll={cancelAllEdits}
              minimized={deepAgentMinimized}
              onToggleMinimized={() => setDeepAgentMinimized(!deepAgentMinimized)}
            />
          </div>
        )}

        {/* Editor container with pending edit highlights */}
        <div style={{ position: 'relative' }}>
          {/* Pending Edit Highlights Overlay */}
          <PendingEditHighlights
            editor={sync.editor}
            pendingEdits={pendingEdits}
            currentEdit={currentEdit}
            containerRef={editorContainerRef as React.RefObject<HTMLDivElement>}
          />

          <BlockNoteView
            editor={sync.editor}
            theme={document?.documentElement?.classList?.contains?.("dark") ? "dark" : "light"}
            slashMenu={false}
            editable={editable as any}
            data-block-id-attribute="data-block-id"
          >
            {/* Custom slash menu with Fast Agent integration */}
            {!disableSlashMenu && (
              <SuggestionMenuController
                {...({
                  triggerCharacter: "/",
                  getItems: async (query: string) =>
                    filterSuggestionItems(
                      sync.editor ? getCustomSlashMenuItems(sync.editor) : [],
                      query,
                    ),
                } as any)}
              />
            )}

            {/* Adds a mentions menu which opens with the "@" key */}
            <SuggestionMenuController
              triggerCharacter={"@"}
              getItems={async (query) =>
                filterSuggestionItems(await getMentionMenuItems(query), query)
              }
            />

            {/* Adds a hashtags menu which opens with the "#" key */}
            <SuggestionMenuController
              triggerCharacter={"#"}
              getItems={async (query) =>
                filterSuggestionItems(await getHashtagMenuItems(query), query)
              }
            />
          </BlockNoteView>
        </div>


      </div>
    </ProposalProvider>
  );
}

