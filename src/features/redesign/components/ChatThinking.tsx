/**
 * ChatThinking — pre-stream "agent reasoning" indicator.
 *
 * Renders the gap between user submit and the first answer chars. Mirrors the
 * Claude / ChatGPT / parity-studio pattern of showing live progress so the chat
 * never looks frozen.
 *
 * Steps cycle through provided phases at ~600ms each. Last visible phase persists
 * until the parent unmounts this component (when the real answer arrives).
 */

import { useEffect, useState } from "react";

interface ChatThinkingProps {
  /** Phases to cycle through, e.g. ["Routing to Claude Sonnet…", "Reading 4 sources…"] */
  phases?: string[];
  /** Optional override for the active phase if the parent already knows what step is running */
  activePhase?: string;
}

const DEFAULT_PHASES = [
  "Routing to model…",
  "Recalling memory…",
  "Reading sources…",
  "Drafting answer…",
];

export function ChatThinking({ phases = DEFAULT_PHASES, activePhase }: ChatThinkingProps) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (activePhase) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % phases.length), 700);
    return () => window.clearInterval(id);
  }, [phases.length, activePhase]);

  const label = activePhase ?? phases[idx];

  return (
    <div className="rd-chat-msg rd-chat-msg--assistant" aria-live="polite">
      <div className="rd-chat-msg__avatar rd-chat-msg__avatar--thinking" aria-hidden="true">✦</div>
      <div className="rd-chat-thinking">
        <span className="rd-chat-thinking__dots" aria-hidden="true">
          <span /><span /><span />
        </span>
        <span className="rd-chat-thinking__label">{label}</span>
      </div>
    </div>
  );
}
