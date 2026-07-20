import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchTrace, type TraceStep } from "./SearchTrace";

const trace: TraceStep[] = [
  { step: "classify_query", durationMs: 12, status: "ok", detail: "parsed" },
  { step: "build_context_bundle", durationMs: 24, status: "ok", detail: "loaded memory" },
  { step: "tool_call", tool: "web_search", durationMs: 63, status: "ok", detail: "searched the web" },
  { step: "judge", durationMs: 18, status: "ok", detail: "validated claims" },
  { step: "assemble_response", durationMs: 15, status: "ok", detail: "built final answer" },
];

describe("SearchTrace", () => {
  it("groups the user trace into hierarchical stages", () => {
    render(
      <SearchTrace
        trace={trace}
        latencyMs={132}
        classification="founder_packet"
        sourceRefs={[{ type: "web", href: "https://example.com", status: "cited" }]}
        mode="user"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /how we got this answer/i }));

    expect(screen.getByText("You asked")).toBeInTheDocument();
    expect(screen.getByText("We loaded context")).toBeInTheDocument();
    expect(screen.getByText("We explored evidence")).toBeInTheDocument();
    expect(screen.getByText("We checked the work")).toBeInTheDocument();
    expect(screen.getByText("We assembled the answer")).toBeInTheDocument();
    expect(screen.getByText("Live web evidence")).toBeInTheDocument();
  });
});
