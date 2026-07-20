import type { ChangeEvent, KeyboardEvent } from "react";
import { Sparkles, Send } from "lucide-react";

export interface PlannerAiBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  quickActions: Array<{ label: string; text: string }>;
  onQuickPrompt: (text: string) => void;
}

export function PlannerAiBar({
  prompt,
  onPromptChange,
  onSend,
  quickActions,
  onQuickPrompt,
}: PlannerAiBarProps) {
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onPromptChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const openChatPanel = () => {
    try {
      window.dispatchEvent(new CustomEvent("ai:openPanel"));
    } catch {
      // no-op
    }
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-edge bg-surface flex-1">
          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <input
            value={prompt}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent… (e.g., ‘Plan my week’)"
            className="w-full bg-transparent outline-none text-sm text-content placeholder-content-muted"
          />
        </div>

        <button
          type="button"
          onClick={onSend}
          className="btn-primary-sm px-3 py-2 text-sm flex items-center gap-2"
          title="Send"
          aria-label="Send message to AI assistant"
        >
          <Send className="h-4 w-4" />
          <span className="hidden sm:inline">Ask</span>
        </button>

        <button
          type="button"
          onClick={openChatPanel}
          className="px-3 py-2 text-sm rounded-md text-content-secondary hover:text-content hover:bg-surface-hover border border-edge"
          title="Open AI Chat"
        >
          Open Chat
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {quickActions.map((qa) => (
          <button
            type="button"
            key={qa.label}
            onClick={() => onQuickPrompt(qa.text)}
            className="px-2.5 py-1.5 rounded-full text-xs border border-edge text-content-secondary hover:text-content hover:bg-surface-hover"
            title={qa.text}
          >
            {qa.label}
          </button>
        ))}
      </div>
    </div>
  );
}
