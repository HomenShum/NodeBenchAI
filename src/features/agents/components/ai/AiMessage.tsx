/**
 * AiMessage — canonical renderer for a single AI SDK `UIMessage`, built entirely
 * on Vercel AI Elements primitives (Message / Reasoning / Tool / Sources).
 *
 * This is the thin component that replaces the hand-rolled standard-part rendering
 * in FastAgentPanel.UIMessageBubble. It handles the STANDARD AI SDK part types
 * (text, reasoning, tool calls, source-url). NodeBench-specific `data-*` parts
 * (visual citations, media galleries, memory pills, selection cards) are NOT
 * handled here — callers pass a `renderCustomPart` hook so the domain renderers
 * stay where they belong and the honesty contract (live streaming) is preserved.
 *
 * Pattern: AI Elements message rendering (parts switch)
 * Prior art: Vercel AI Elements — https://elements.ai-sdk.dev/components/message
 */
import type { ReactNode } from "react";
import type { UIMessage } from "ai";

import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";

type MessagePart = UIMessage["parts"][number];

export interface AiMessageProps {
  message: UIMessage;
  /** True while this message is the one currently streaming from the model. */
  isStreaming?: boolean;
  /**
   * Escape hatch for NodeBench-specific parts (types starting with `data-`, or any
   * type this renderer does not natively handle). Return a node to render it, or
   * `null`/`undefined` to skip. Keeps domain renderers out of the primitive layer.
   */
  renderCustomPart?: (part: MessagePart, index: number, message: UIMessage) => ReactNode;
}

const isToolPart = (type: string): boolean =>
  type === "dynamic-tool" || type.startsWith("tool-");

export function AiMessage({
  message,
  isStreaming = false,
  renderCustomPart,
}: AiMessageProps) {
  const parts: MessagePart[] = message.parts ?? [];

  // Collect source-url parts so we can render one collapsible Sources block.
  const sourceParts = parts.filter((p) => p.type === "source-url");

  return (
    <Message from={message.role}>
      <MessageContent>
        {parts.map((part, i) => {
          const key = `${message.id}-${i}`;

          if (part.type === "text") {
            if (!part.text) return null;
            return <MessageResponse key={key}>{part.text}</MessageResponse>;
          }

          if (part.type === "reasoning") {
            if (!part.text) return null;
            return (
              <Reasoning key={key} isStreaming={isStreaming}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );
          }

          if (isToolPart(part.type)) {
            // A tool part is always a ToolUIPart | DynamicToolUIPart at runtime;
            // the UIMessage union just can't narrow across a `.startsWith` check.
            const tool = part as ToolPart;
            return (
              <Tool key={key}>
                {tool.type === "dynamic-tool" ? (
                  <ToolHeader
                    type="dynamic-tool"
                    toolName={tool.toolName}
                    state={tool.state}
                  />
                ) : (
                  <ToolHeader type={tool.type} state={tool.state} />
                )}
                <ToolContent>
                  <ToolInput input={tool.input} />
                  <ToolOutput output={tool.output} errorText={tool.errorText} />
                </ToolContent>
              </Tool>
            );
          }

          // Source-url parts are aggregated below, not rendered inline.
          if (part.type === "source-url") return null;

          // Anything else (NodeBench data-* parts, file parts, etc.) is delegated.
          return renderCustomPart ? (
            <div key={key}>{renderCustomPart(part, i, message)}</div>
          ) : null;
        })}

        {sourceParts.length > 0 && (
          <Sources>
            <SourcesTrigger count={sourceParts.length} />
            <SourcesContent>
              {sourceParts.map((part, i) => {
                const src = part as { url: string; title?: string };
                return (
                  <Source
                    key={`${message.id}-src-${i}`}
                    href={src.url}
                    title={src.title ?? src.url}
                  />
                );
              })}
            </SourcesContent>
          </Sources>
        )}
      </MessageContent>
    </Message>
  );
}
