/**
 * AiPromptInput — thin wrapper over AI Elements `PromptInput`. Uncontrolled by
 * default (PromptInput manages its own text + attachment state); the caller only
 * receives the final `{ text, files }` on submit, so it plugs straight into an
 * existing Convex `sendMessage` mutation without re-implementing input state.
 *
 * Pattern: AI Elements prompt input
 * Prior art: Vercel AI Elements — https://elements.ai-sdk.dev/components/prompt-input
 */
import type { ComponentProps, ReactNode } from "react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

type SubmitStatus = ComponentProps<typeof PromptInputSubmit>["status"];

export interface AiPromptInputProps {
  /** Called with the trimmed text and any attachments when the user submits. */
  onSend: (text: string, files: PromptInputMessage["files"]) => void;
  status?: SubmitStatus;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Extra controls rendered in the footer, left of the submit button. */
  footerStart?: ReactNode;
}

export function AiPromptInput({
  onSend,
  status = "ready",
  placeholder = "Ask NodeBench…",
  disabled,
  className,
  footerStart,
}: AiPromptInputProps) {
  return (
    <PromptInput
      className={className}
      onSubmit={(message) => {
        const text = message.text?.trim();
        if (!text) return;
        onSend(text, message.files);
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea placeholder={placeholder} disabled={disabled} />
      </PromptInputBody>
      <PromptInputFooter>
        {footerStart ?? <span />}
        <PromptInputSubmit status={status} disabled={disabled} />
      </PromptInputFooter>
    </PromptInput>
  );
}
