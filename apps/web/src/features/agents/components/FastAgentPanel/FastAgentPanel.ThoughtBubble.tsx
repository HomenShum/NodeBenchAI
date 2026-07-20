// src/components/FastAgentPanel/FastAgentPanel.ThoughtBubble.tsx
// Component for displaying agent reasoning/thinking

import type { ReactNode } from 'react';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface ThoughtBubbleProps {
  thought: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Reduced-motion-safe thinking label. Mirrors the reasoning primitive's
 * default message logic but without the animated <Shimmer>, so the component
 * still honors prefers-reduced-motion after migrating off the previous
 * `motion-safe:animate-spin` spinner guard.
 */
function staticThinkingMessage(isStreaming: boolean, duration?: number): ReactNode {
  if (isStreaming || duration === 0) {
    return <span>Thinking...</span>;
  }
  if (duration === undefined) {
    return <span>Thought for a few seconds</span>;
  }
  return <span>Thought for {duration} seconds</span>;
}

/**
 * ThoughtBubble - Displays agent's reasoning between tasks
 * Shows the "why" behind agent actions for transparency
 */
export function ThoughtBubble({
  thought,
  isStreaming = false,
  className,
}: ThoughtBubbleProps) {
  // Preserve the original reduced-motion guard: when the user prefers reduced
  // motion, suppress the primitive's animated shimmer thinking indicator.
  const reducedMotion = useReducedMotion();

  if (!thought) return null;

  return (
    <Reasoning className={className} isStreaming={isStreaming}>
      <ReasoningTrigger
        getThinkingMessage={reducedMotion ? staticThinkingMessage : undefined}
      />
      <ReasoningContent>{thought}</ReasoningContent>
    </Reasoning>
  );
}
