import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";

type EntityNoteMarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

export default function EntityNoteMarkdownEditor({
  value,
  onChange,
  readOnly = false,
}: EntityNoteMarkdownEditorProps) {
  return (
    <div
      data-testid="entity-note-markdown-input"
      className="overflow-hidden rounded-[26px] border border-[rgba(15,23,42,0.08)] bg-white/88 dark:border-white/10 dark:bg-black/22"
    >
      <CodeMirror
        value={value}
        height="360px"
        extensions={[markdownLanguage()]}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLineGutter: false,
        }}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={readOnly ? undefined : onChange}
        className="nb-markdown-editor"
      />
    </div>
  );
}
