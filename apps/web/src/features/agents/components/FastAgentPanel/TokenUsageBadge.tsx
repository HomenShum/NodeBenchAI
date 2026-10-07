/**
 * TokenUsageBadge - Message-level token usage reported by the runtime.
 */

import React from "react";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface TokenUsageBadgeProps {
  inputTokens: number;
  outputTokens: number;
  model?: string;
  className?: string;
}

export function TokenUsageBadge({
  inputTokens,
  outputTokens,
  model,
  className = "",
}: TokenUsageBadgeProps) {
  if (inputTokens === 0 && outputTokens === 0) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-mono text-muted-foreground ${className}`}
      title={model ? `Runtime token usage (${model})` : "Runtime token usage"}
    >
      <span>{formatTokens(inputTokens)}&darr;</span>
      <span>{formatTokens(outputTokens)}&uarr;</span>
    </span>
  );
}

export default TokenUsageBadge;
