/**
 * Slash Command Extension for RichNotebookEditor.
 *
 * Pattern: TipTap Suggestion plugin triggering on `/`.
 * Kit parity: docs/design/nodebench-ai-design-system/ui_kits/nodebench-workspace/Notebook.jsx
 *   - 8 items: Heading, Claim block, Embed card, Citation, Ask a question,
 *     Continue writing, Rewrite w/ sources, Draft email
 *   - Arrow/Enter/Escape keyboard navigation
 *   - Filtered by typed query
 *
 * Prior art:
 *   - TipTap Suggestion utility — https://tiptap.dev/docs/editor/api/utilities/suggestion
 *   - NovelAI, Notion slash menus
 */
import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions } from "@tiptap/suggestion";

export type SlashItem = {
  key: string;
  label: string;
  hint: string;
  accent?: boolean;
  command: (args: { editor: Editor; range: Range }) => void;
};

export const SLASH_ITEMS: SlashItem[] = [
  {
    key: "h2",
    label: "Heading",
    hint: "h2",
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 2 })
        .run();
    },
  },
  {
    key: "claim",
    label: "Claim block",
    hint: "claim",
    accent: true,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "nbClaim",
          attrs: {
            statement: "New claim — edit me.",
            support: 0,
            conflict: 0,
            evidence: [],
            open: true,
          },
        })
        .run();
    },
  },
  {
    key: "card",
    label: "Embed card",
    hint: "card",
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent(
          '<blockquote><p><strong>Embedded card</strong> — live-linked artifact.</p></blockquote>',
        )
        .run();
    },
  },
  {
    key: "cite",
    label: "Citation",
    hint: "cite",
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent('<sup class="nb-cite">[cite]</sup>')
        .run();
    },
  },
  {
    key: "ask",
    label: "Ask a question",
    hint: "ask",
    accent: true,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent("<p><em>Ask: </em></p>")
        .run();
    },
  },
  {
    key: "cont",
    label: "Continue writing",
    hint: "cont",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
    },
  },
  {
    key: "rew",
    label: "Rewrite w/ sources",
    hint: "rew",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
    },
  },
  {
    key: "email",
    label: "Draft email",
    hint: "email",
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent(
          "<p><strong>Subject:</strong> </p><p>Hi,</p><p></p><p>Best,</p>",
        )
        .run();
    },
  },
];

export type SlashRendererHandle = {
  onStart: (props: unknown) => void;
  onUpdate: (props: unknown) => void;
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
  onExit: () => void;
};

export type CreateSlashExtensionOptions = {
  render: () => SlashRendererHandle;
};

export function createSlashCommandExtension(
  options: CreateSlashExtensionOptions,
) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      const suggestion: Omit<SuggestionOptions<SlashItem>, "editor"> = {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        items: ({ query }) => {
          const q = query.toLowerCase();
          if (!q) return SLASH_ITEMS;
          return SLASH_ITEMS.filter((it) =>
            it.label.toLowerCase().includes(q),
          );
        },
        render: options.render,
      };
      return [
        Suggestion({
          editor: this.editor,
          ...suggestion,
        }),
      ];
    },
  });
}
