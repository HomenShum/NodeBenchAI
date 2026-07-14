/**
 * Storybook stories for the AI Elements consumer layer (AiConversation + AiPromptInput).
 * Proves the primitives render the app's real `UIMessage` part shape end-to-end:
 * text (markdown + code), reasoning, tool calls, and sources — inheriting the
 * terracotta/glass DNA from the shadcn CSS variables.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UIMessage } from "ai";

import { AiConversation } from "./AiConversation";
import { AiPromptInput } from "./AiPromptInput";

// Story fixtures. Cast is intentional: hand-authored UIMessage samples, not
// production data — the generic UIMessage union is impractical to spell out inline.
const messages = [
  {
    id: "m1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Compare Anthropic and OpenAI's latest models for **coding** — which should I default to?",
      },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        text: "The user wants a coding-focused comparison. I'll weigh the two current flagships on SWE-bench-style tasks, latency, and price, then give a default recommendation rather than a hedge.",
      },
      {
        type: "tool-web_search",
        toolCallId: "call_1",
        state: "output-available",
        input: { query: "Claude Opus 4.8 vs GPT-5.6 coding benchmark 2026" },
        output: {
          results: [
            { title: "DeepSWE leaderboard", score: "73% vs 70%" },
            { title: "Independent latency test", p50_ms: 820 },
          ],
        },
      },
      {
        type: "text",
        text: [
          "Here's the short version:",
          "",
          "| Model | Coding (DeepSWE) | Latency p50 | Best for |",
          "|---|---|---|---|",
          "| Opus 4.8 | 70% | ~0.8s | multi-file refactors |",
          "| GPT-5.6-sol | 73% | ~1.1s | gnarly root-cause |",
          "",
          "```ts",
          "// Default to Opus for interactive edits; escalate hard bugs to GPT-5.6-sol.",
          "const model = task.isDeepSWE ? 'gpt-5.6-sol' : 'claude-opus-4-8';",
          "```",
          "",
          "**Recommendation:** default to Opus 4.8 for day-to-day edits; route adversarial, multi-file root-cause work to GPT-5.6-sol.",
        ].join("\n"),
      },
      {
        type: "source-url",
        sourceId: "s1",
        url: "https://deepswe.datacurve.ai",
        title: "DeepSWE leaderboard",
      },
      {
        type: "source-url",
        sourceId: "s2",
        url: "https://www.anthropic.com/news",
        title: "Anthropic — model updates",
      },
    ],
  },
] as unknown as UIMessage[];

const meta: Meta<typeof AiConversation> = {
  title: "AI Elements/AiConversation",
  component: AiConversation,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "80vh", maxWidth: 760, margin: "0 auto", padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AiConversation>;

export const RichThread: Story = {
  args: { messages, streamingMessageId: null },
};

export const Streaming: Story = {
  args: { messages, streamingMessageId: "m2" },
};

export const Empty: Story = {
  args: { messages: [] },
};

export const PromptInput: StoryObj<typeof AiPromptInput> = {
  render: () => (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <AiPromptInput
        status="ready"
        onSend={(text, files) => {
          // eslint-disable-next-line no-console
          console.log("send", { text, files });
        }}
      />
    </div>
  ),
};
