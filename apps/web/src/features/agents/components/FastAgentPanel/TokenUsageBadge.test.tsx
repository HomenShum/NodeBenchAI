import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TokenUsageBadge } from "./TokenUsageBadge";

describe("TokenUsageBadge", () => {
  it("shows runtime token counts without inventing a client-side cost", () => {
    render(
      <TokenUsageBadge
        inputTokens={1250}
        outputTokens={420}
        model="runtime-model"
      />,
    );

    const badge = screen.getByTitle("Runtime token usage (runtime-model)");
    expect(badge).toHaveTextContent("1.3K↓");
    expect(badge).toHaveTextContent("420↑");
    expect(badge).not.toHaveTextContent("$");
    expect(badge).not.toHaveAttribute("title", expect.stringMatching(/est\.|\$/i));
  });
});
