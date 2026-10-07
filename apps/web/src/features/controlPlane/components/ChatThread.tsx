/**
 * ChatThread — scrollable conversation container.
 *
 * Renders a list of ChatMessage entries with auto-scroll to latest.
 * Shows "New conversation" button to reset.
 */

import { memo, useEffect, useRef } from "react";
import { MessageSquarePlus } from "lucide-react";
import { ChatMessage, type ChatEntry } from "./ChatMessage";

interface ChatThreadProps {
  entries: ChatEntry[];
  onFollowUp: (query: string) => void;
  onViewProfile?: (entry: ChatEntry) => void;
  onNewConversation: () => void;
}

export const ChatThread = memo(function ChatThread({
  entries,
  onFollowUp,
  onViewProfile,
  onNewConversation,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-6 mt-6">
      {/* New conversation button */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex items-center gap-1.5 rounded-full border border-edge/40 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-content-muted hover:text-content hover:border-edge/60 transition-colors"
        >
          <MessageSquarePlus className="h-3 w-3" />
          New conversation
        </button>
      </div>

      {/* Messages */}
      {entries.map((entry, i) => (
        <ChatMessage
          key={entry.id}
          entry={entry}
          onFollowUp={onFollowUp}
          onViewProfile={onViewProfile}
          isLatest={i === entries.length - 1}
        />
      ))}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
});

export default ChatThread;
