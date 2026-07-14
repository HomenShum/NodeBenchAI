/**
 * AiConversation — auto-scrolling message list built on AI Elements `Conversation`
 * (stick-to-bottom) + `AiMessage`. Consumes the app's live `UIMessage[]` directly,
 * so it drops into any Convex-streamed thread without a data-shape adapter.
 *
 * Pattern: AI Elements conversation container
 * Prior art: Vercel AI Elements — https://elements.ai-sdk.dev/components/conversation
 */
import type { ReactNode } from "react";
import type { UIMessage } from "ai";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";

import { AiMessage } from "./AiMessage";

type MessagePart = UIMessage["parts"][number];

export interface AiConversationProps {
  messages: UIMessage[];
  /** id of the message currently streaming, so its reasoning stays expanded. */
  streamingMessageId?: string | null;
  emptyState?: ReactNode;
  className?: string;
  renderCustomPart?: (part: MessagePart, index: number, message: UIMessage) => ReactNode;
}

export function AiConversation({
  messages,
  streamingMessageId,
  emptyState,
  className,
  renderCustomPart,
}: AiConversationProps) {
  return (
    <Conversation className={className}>
      <ConversationContent>
        {messages.length === 0
          ? emptyState ?? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No messages yet. Start a conversation.
              </div>
            )
          : messages.map((message) => (
              <AiMessage
                key={message.id}
                message={message}
                isStreaming={message.id === streamingMessageId}
                renderCustomPart={renderCustomPart}
              />
            ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
