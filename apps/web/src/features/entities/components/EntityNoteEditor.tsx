import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Code2,
  Heading2,
  List,
  MessageSquareQuote,
  RotateCcw,
  RotateCw,
  Sparkles,
  Type,
} from "lucide-react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  type EditorState,
  type LexicalEditor,
  UNDO_COMMAND,
} from "lexical";
import { $setBlocksType } from "@lexical/selection";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { CodeNode, $createCodeNode } from "@lexical/code";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { LinkNode } from "@lexical/link";
import type {
  EntityNoteDocument,
  EntityNoteDocumentBlock,
  EntityNoteDocumentBlockType,
} from "@/features/entities/lib/entityNoteDocument";

const EntityMarkdownEditor = lazy(() => import("./EntityNoteMarkdownEditor"));

type EntityNoteEditorProps = {
  document: EntityNoteDocument;
  onChange: (document: EntityNoteDocument) => void;
  statusLabel?: string;
  helperText?: string;
  toolbarPreset?: "full" | "compact";
  showStats?: boolean;
  readOnly?: boolean;
};

export type EntityNoteEditorHandle = {
  getCurrentDocument: () => EntityNoteDocument;
};

type ToolbarButtonProps = {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
};

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^- \[[x ]\]\s+/gim, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[#*_~]/g, "")
    .trim();
}

function inferBlockType(line: string): { type: EntityNoteDocumentBlockType; text: string; depth?: number } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
  if (heading) {
    return { type: "heading", text: heading[2].trim() };
  }

  const check = trimmed.match(/^[-*]\s+\[(?: |x|X)\]\s+(.*)$/);
  if (check) {
    return { type: "check", text: check[1].trim() };
  }

  const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (bullet) {
    const depth = Math.floor((bullet[1]?.length ?? 0) / 2);
    return { type: "bullet", text: bullet[2].trim(), depth };
  }

  const quote = trimmed.match(/^>\s?(.*)$/);
  if (quote) {
    return { type: "quote", text: quote[1].trim() };
  }

  return { type: "paragraph", text: trimmed };
}

function extractRefs(text: string) {
  const entityRefs = [...text.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);
  const sourceRefs = [...text.matchAll(/\[source:([^\]]+)\]/gi)]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);
  return { entityRefs, sourceRefs };
}

function markdownToBlocks(markdown: string): EntityNoteDocumentBlock[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks: EntityNoteDocumentBlock[] = [];
  let order = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const fence = trimmed;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const codeText = codeLines.join("\n").trim();
      const refs = extractRefs(codeText);
      blocks.push({
        blockId: `block-${order + 1}`,
        order: order++,
        type: "code",
        text: codeText,
        markdown: `${fence}\n${codeLines.join("\n")}\n\`\`\``,
        ...refs,
      });
      continue;
    }

    const inferred = inferBlockType(line);
    if (!inferred) {
      index += 1;
      continue;
    }

    if (inferred.type === "paragraph") {
      const paragraphLines = [trimmed];
      index += 1;
      while (index < lines.length) {
        const next = lines[index] ?? "";
        if (!next.trim() || inferBlockType(next)?.type !== "paragraph") break;
        paragraphLines.push(next.trim());
        index += 1;
      }
      const paragraphText = paragraphLines.join(" ");
      const refs = extractRefs(paragraphText);
      blocks.push({
        blockId: `block-${order + 1}`,
        order: order++,
        type: "paragraph",
        text: paragraphText,
        markdown: paragraphLines.join("\n"),
        ...refs,
      });
      continue;
    }

    const refs = extractRefs(inferred.text);
    blocks.push({
      blockId: `block-${order + 1}`,
      order: order++,
      type: inferred.type,
      depth: inferred.depth,
      text: inferred.text,
      markdown: trimmed,
      ...refs,
    });
    index += 1;
  }

  return blocks;
}

function lexicalStateToDocument(editorState: EditorState, previous: EntityNoteDocument): EntityNoteDocument {
  const markdown = editorState.read(() => $convertToMarkdownString(TRANSFORMERS)).trim();
  const blocks = markdownToBlocks(markdown);
  const plainText = stripMarkdown(markdown);

  return {
    ...previous,
    markdown,
    plainText,
    lexicalState: editorState.toJSON(),
    blocks,
  };
}

function ToolbarButton({ label, onClick, icon }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[rgba(15,23,42,0.08)] bg-white/80 px-3 py-1.5 text-[11px] font-medium text-content transition hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
    >
      <span className="inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </button>
  );
}

function LexicalToolbar({
  preset = "full",
}: {
  preset?: "full" | "compact";
}) {
  const [editor] = useLexicalComposerContext();

  const formatHeading = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode("h2"));
      }
    });
  };

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
  };

  return (
    <div className="flex flex-wrap gap-2 border-b border-[rgba(15,23,42,0.08)] px-4 py-3 dark:border-white/10">
      {preset === "compact" ? (
        <>
          <ToolbarButton label="Heading" icon={<Heading2 className="h-3.5 w-3.5" />} onClick={formatHeading} />
          <ToolbarButton
            label="List"
            icon={<List className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
          />
          <ToolbarButton
            label="Bold"
            icon={<Type className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
          />
        </>
      ) : (
        <>
          <ToolbarButton label="Body" icon={<Type className="h-3.5 w-3.5" />} onClick={formatParagraph} />
          <ToolbarButton label="Heading" icon={<Heading2 className="h-3.5 w-3.5" />} onClick={formatHeading} />
          <ToolbarButton
            label="Bullet"
            icon={<List className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
          />
          <ToolbarButton
            label="Checklist"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)}
          />
          <ToolbarButton label="Quote" icon={<MessageSquareQuote className="h-3.5 w-3.5" />} onClick={formatQuote} />
          <ToolbarButton
            label="Bold"
            icon={<Type className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
          />
        </>
      )}
      {preset === "full" ? (
        <>
          <ToolbarButton
            label="Code"
            icon={<Code2 className="h-3.5 w-3.5" />}
            onClick={() => editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) {
                const codeNode = $createCodeNode();
                selection.insertNodes([codeNode]);
              }
            })}
          />
          <ToolbarButton
            label="Remove list"
            icon={<List className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)}
          />
          <ToolbarButton
            label="Undo"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
          />
          <ToolbarButton
            label="Redo"
            icon={<RotateCw className="h-3.5 w-3.5" />}
            onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
          />
        </>
      ) : null}
    </div>
  );
}

function LexicalSeed({
  markdown,
}: {
  markdown: string;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.update(() => {
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    });
  }, [editor, markdown]);

  return null;
}

function LexicalEditableState({ readOnly }: { readOnly: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return null;
}

function LexicalDocumentEditor({
  document,
  onChange,
  toolbarPreset = "full",
  readOnly = false,
}: {
  document: EntityNoteDocument;
  onChange: (document: EntityNoteDocument) => void;
  toolbarPreset?: "full" | "compact";
  readOnly?: boolean;
}) {
  const initialConfig = useMemo(
    () => ({
      namespace: `entity-note-${document._id ?? "draft"}-${document.latestRevision}`,
      editable: !readOnly,
      onError(error: Error) {
        throw error;
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
      theme: {
        paragraph: "nb-lexical-paragraph",
        quote: "nb-lexical-quote",
        heading: {
          h1: "nb-lexical-heading-xl",
          h2: "nb-lexical-heading-lg",
          h3: "nb-lexical-heading-md",
        },
        text: {
          bold: "font-semibold",
          italic: "italic",
          underline: "underline",
        },
        list: {
          ul: "nb-lexical-list",
          listitem: "nb-lexical-list-item",
          nested: {
            listitem: "nb-lexical-list-item",
          },
          olDepth: ["nb-lexical-list", "nb-lexical-list"],
          ulDepth: ["nb-lexical-list", "nb-lexical-list"],
        },
      },
      editorState: document.lexicalState
        ? JSON.stringify(document.lexicalState)
        : undefined,
    }),
    [document._id, document.latestRevision, document.lexicalState, readOnly],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {!document.lexicalState ? <LexicalSeed markdown={document.markdown} /> : null}
      <LexicalEditableState readOnly={readOnly} />
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white transition-colors focus-within:border-gray-300 dark:border-white/10 dark:bg-white/[0.02] dark:focus-within:border-white/20">
        {!readOnly ? <LexicalToolbar preset={toolbarPreset} /> : null}
        <div className="px-5 py-5">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                data-testid="entity-note-rich-input"
                className={`nb-lexical-editor min-h-[360px] sm:min-h-[420px] xl:min-h-[520px] outline-none ${
                  readOnly ? "cursor-default" : ""
                }`}
                aria-readonly={readOnly}
                aria-placeholder={
                  readOnly
                    ? "Shared note"
                    : "Write notes that compound with future runs..."
                }
                placeholder={
                  <div className="pointer-events-none absolute text-sm text-content-muted/60">
                    {readOnly ? "Shared note" : "Write notes that compound with future runs..."}
                  </div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          {!readOnly ? <HistoryPlugin /> : null}
          <ListPlugin />
          <LinkPlugin />
          {!readOnly ? <MarkdownShortcutPlugin transformers={TRANSFORMERS} /> : null}
          {!readOnly ? (
            <OnChangePlugin
              onChange={(editorState: EditorState) => {
                onChange(lexicalStateToDocument(editorState, document));
              }}
            />
          ) : null}
        </div>
      </div>
    </LexicalComposer>
  );
}

export const EntityNoteEditor = forwardRef<EntityNoteEditorHandle, EntityNoteEditorProps>(function EntityNoteEditor({
  document,
  onChange,
  statusLabel,
  helperText,
  toolbarPreset = "full",
  showStats = true,
  readOnly = false,
}, ref) {
  const [mode, setMode] = useState<"rich" | "markdown">("rich");
  const [markdownDraft, setMarkdownDraft] = useState(document.markdown);
  const latestDocumentRef = useRef(document);

  useEffect(() => {
    setMarkdownDraft(document.markdown);
    latestDocumentRef.current = document;
  }, [document._id, document.latestRevision, document.markdown]);

  useImperativeHandle(
    ref,
    () => ({
      getCurrentDocument: () => latestDocumentRef.current,
    }),
    [],
  );

  const stats = useMemo(() => {
    const deferredBlocks = document.blocks?.length ?? 0;
    const words = document.plainText
      ? document.plainText.split(/\s+/g).filter(Boolean).length
      : 0;
    return { blocks: deferredBlocks, words };
  }, [document.blocks, document.plainText]);

  const handleMarkdownChange = (value: string) => {
    if (readOnly) return;
    setMarkdownDraft(value);
    const nextDocument = {
      ...document,
      markdown: value,
      plainText: stripMarkdown(value),
      lexicalState: undefined,
      blocks: markdownToBlocks(value),
    };
    latestDocumentRef.current = nextDocument;
    onChange(nextDocument);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-[rgba(15,23,42,0.08)] bg-white/80 p-1 dark:border-white/10 dark:bg-white/[0.04]">
          <button
            type="button"
            onClick={() => setMode("rich")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              mode === "rich"
                ? "bg-[#d97757] text-white"
                : "text-content-muted hover:text-content"
            }`}
          >
            Editor
          </button>
          <button
            type="button"
            onClick={() => setMode("markdown")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              mode === "markdown"
                ? "bg-[#d97757] text-white"
                : "text-content-muted hover:text-content"
            }`}
          >
            Markdown
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-content-muted">
          {showStats ? (
            <>
              <span>{stats.blocks} blocks</span>
              <span>{stats.words} words</span>
            </>
          ) : null}
          {statusLabel ? <span>{statusLabel}</span> : null}
        </div>
      </div>

      {mode === "rich" ? (
        <LexicalDocumentEditor
          key={`rich-${document._id ?? "draft"}-${document.latestRevision}-${markdownDraft.length}`}
          document={{
            ...document,
            markdown: markdownDraft,
            lexicalState: document.lexicalState,
          }}
          readOnly={readOnly}
          toolbarPreset={toolbarPreset}
          onChange={(nextDocument) => {
            setMarkdownDraft(nextDocument.markdown);
            latestDocumentRef.current = nextDocument;
            onChange(nextDocument);
          }}
        />
      ) : (
        <Suspense
          fallback={
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white transition-colors focus-within:border-gray-300 dark:border-white/10 dark:bg-white/[0.02] dark:focus-within:border-white/20">
              <div className="flex min-h-[360px] items-center justify-center text-sm text-content-muted">
                Loading markdown editor...
              </div>
            </div>
          }
        >
          <EntityMarkdownEditor
            value={markdownDraft}
            onChange={handleMarkdownChange}
            readOnly={readOnly}
          />
        </Suspense>
      )}

      {helperText ? <p className="text-sm leading-6 text-content-muted">{helperText}</p> : null}
    </div>
  );
});

export default EntityNoteEditor;
