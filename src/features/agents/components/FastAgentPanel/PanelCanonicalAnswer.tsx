/**
 * PanelCanonicalAnswer — Phase B of docs/design/ONE_CHAT_INTERFACE.md.
 *
 * The FastAgentPanel mount point for the canonical `ChatAssistantMessage`
 * (the ONE assistant-turn anatomy from Phase A). The flagship component's
 * styles are `[data-redesign]`-scoped and normally imported by RedesignShell;
 * the panel can render outside that shell, so this wrapper imports the same
 * stylesheets (idempotent side-effect imports) and provides its own
 * `[data-redesign]` scope, mirroring the host app's dark/light theme so the
 * canonical message never clashes with the panel chrome around it.
 *
 * All data mapping lives in `adapters/canonicalAnswer.ts` under the honesty
 * rule: nothing the panel runtime did not produce is fabricated here.
 */

import { useEffect, useState } from "react";
import { ChatAssistantMessage } from "@/features/redesign/components/ChatAssistantMessage";
import type { CanonicalAnswerProps } from "./adapters/canonicalAnswer";
import "@/features/redesign/tokens.css";
import "@/features/redesign/primitives.css";
import "@/features/redesign/agent-workspace.css";

function useHostTheme(): "dark" | "light" {
  const readTheme = (): "dark" | "light" =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);
  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
    // readTheme is stable (module-scope logic, no captured state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return theme;
}

export interface PanelCanonicalAnswerProps extends CanonicalAnswerProps {
  onRegenerate?: () => void;
  /** Phase C ports of the legacy bubble action bar. */
  onDelete?: () => void;
  onReadAloud?: () => void;
}

export function PanelCanonicalAnswer({
  packet,
  toolCalls,
  workingNotesMarkdown,
  createdAt,
  receiptTierLabel,
  proseFormat,
  onRegenerate,
  onDelete,
  onReadAloud,
}: PanelCanonicalAnswerProps) {
  const theme = useHostTheme();
  return (
    <div
      data-redesign
      data-redesign-theme={theme}
      data-testid="panel-canonical-answer"
      // The scope carries the redesign paper background; keep it transparent
      // so the canonical message sits on the panel's own surface.
      style={{ background: "transparent" }}
    >
      <ChatAssistantMessage
        packet={packet}
        tier="auto"
        variant="panel"
        receiptTierLabel={receiptTierLabel}
        proseFormat={proseFormat}
        toolCalls={toolCalls.length > 0 ? toolCalls : undefined}
        workingNotesMarkdown={workingNotesMarkdown}
        createdAt={createdAt}
        onRegenerate={onRegenerate ? () => onRegenerate() : undefined}
        onDelete={onDelete}
        onReadAloud={onReadAloud}
      />
    </div>
  );
}

export default PanelCanonicalAnswer;
