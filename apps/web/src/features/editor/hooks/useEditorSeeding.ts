/**
 * Editor seeding hook for UnifiedEditor
 * Handles seed/restore logic and markdown parsing
 */

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { Id } from '../../../../convex/_generated/dataModel';
import { blocksAreTriviallyEmpty, bnEnsureTopLevelBlock } from '../utils/blockUtils';

// Caches for seeding state
const seededDocCache = new Map<string, string>();
const restoreCache = new Map<string, { seed: string; signal: number }>();

interface UseEditorSeedingOptions {
  editor: any;
  documentId: Id<"documents">;
  seedMarkdown?: string;
  restoreSignal?: number;
  restoreMarkdown?: string;
  serverHadContent: boolean;
  markHasContent: () => Promise<void>;
}

export function useEditorSeeding({
  editor,
  documentId,
  seedMarkdown,
  restoreSignal,
  restoreMarkdown,
  serverHadContent,
  markHasContent,
}: UseEditorSeedingOptions) {
  const attemptedSeedRef = useRef(false);

  // Use default BlockNoteEditor for markdown parsing
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

  // Seed the document with provided markdown if editor exists and doc is empty
  useEffect(() => {
    const ed: any = editor;
    if (!ed) return;
    if (attemptedSeedRef.current) return;

    const docKey = String(documentId);
    const blocks: any[] = Array.isArray(ed.topLevelBlocks) ? ed.topLevelBlocks : [];
    const isTriviallyEmpty = blocksAreTriviallyEmpty(blocks);

    const seed = (seedMarkdown || '').trim();
    const cachedSeed = seed ? seededDocCache.get(docKey) : undefined;
    const localHad = (() => {
      try { return window.localStorage.getItem(`nb.doc.hasContent.${String(documentId)}`) === '1'; }
      catch { return false; }
    })();
    const hadEverContent = (!!serverHadContent) || localHad;

    if (isTriviallyEmpty && seed) {
      if (cachedSeed === seed) { attemptedSeedRef.current = true; return; }
      if (hadEverContent) { attemptedSeedRef.current = true; seededDocCache.set(docKey, seed); return; }
      attemptedSeedRef.current = true;
      void (async () => {
        try {
          const newBlocks = await blocksFromMarkdown(seed);
          if (Array.isArray(newBlocks) && newBlocks.length > 0) {
            const existing: any[] = Array.isArray(ed.topLevelBlocks) ? ed.topLevelBlocks : [];
            ed.replaceBlocks(existing, newBlocks);
            seededDocCache.set(docKey, seed);
            try {
              window.localStorage.setItem(`nb.doc.hasContent.${String(documentId)}`, '1');
            } catch {
              // localStorage not available
            }
            void markHasContent();
          }
        } catch (e) {
        }
      })();
    } else if (seed) {
      seededDocCache.set(docKey, seed);
    }
  }, [editor, seedMarkdown, blocksFromMarkdown, documentId, serverHadContent, markHasContent]);

  // Restore from provided markdown when signal changes
  useEffect(() => {
    const ed: any = editor;
    if (!ed) return;
    if (typeof restoreSignal !== 'number') return;
    const seed = (restoreMarkdown || '').trim();
    if (!seed) return;

    const docKey = String(documentId);
    const existing: any[] = Array.isArray(ed.topLevelBlocks) ? ed.topLevelBlocks : [];
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
        ed.replaceBlocks(existing, newBlocks);
        restoreCache.set(docKey, { seed, signal: explicitRestore ? restoreSignal : 0 });
        seededDocCache.set(docKey, seed);
        try {
          window.localStorage.setItem(`nb.doc.hasContent.${String(documentId)}`, '1');
        } catch {
          // localStorage not available
        }
        void markHasContent();
      } catch (e) {
      }
    })();
  }, [restoreSignal, restoreMarkdown, blocksFromMarkdown, editor, documentId, markHasContent]);

  return { blocksFromMarkdown };
}

