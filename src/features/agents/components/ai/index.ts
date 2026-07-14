/**
 * NodeBench AI consumer layer — thin components built on Vercel AI Elements
 * primitives (src/components/ai-elements/*). Prefer these over the legacy
 * hand-rolled FastAgentPanel.* renderers; they consume the app's live
 * `UIMessage[]` shape directly and inherit the terracotta/glass DNA via the
 * shadcn CSS variables in src/index.css.
 */
export { AiMessage, type AiMessageProps } from "./AiMessage";
export { AiConversation, type AiConversationProps } from "./AiConversation";
export { AiPromptInput, type AiPromptInputProps } from "./AiPromptInput";
