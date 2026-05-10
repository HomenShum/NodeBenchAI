/**
 * StreamingMarkdown — markdown rendering scenarios.
 *
 * Scenario: First-time visitor to /redesign sees pulse summaries
 *
 * Who:     A new visitor arriving at nodebenchai.com/redesign — sees §1
 *          "What moved today" populated with publicly-trending HN items
 *          whose `summaryMarkdown` field contains GitHub-flavored
 *          markdown (bold headers, paragraph breaks, occasional links).
 * What:    They expect bold to render as actual visual emphasis, NOT
 *          as literal `**asterisks**`.  This was the Bug 1 regression:
 *          renderPulseMarkdown split paragraphs but never rendered the
 *          markdown inside them — downstream JSX emitted raw text.
 * Scale:   N/A — single-render unit scope.  At scale the bug affected
 *          every visitor on every page load with public-trending fallback
 *          (the most common state for guests).
 * Duration: Short-running.  Render once and inspect the DOM.
 * Failure mode covered: literal `**` leaking through to the page.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StreamingMarkdown } from "./StreamingMarkdown";

describe("StreamingMarkdown — pulse summary rendering (Bug 1 regression)", () => {
  it("renders **bold** as a <strong> element instead of literal asterisks", () => {
    const { container } = render(
      <StreamingMarkdown text="**Bold text**\n\nPlain text" streaming={false} />,
    );

    // The bold span must materialize as a real <strong>.
    const strongs = container.querySelectorAll("strong");
    expect(strongs.length).toBeGreaterThanOrEqual(1);
    expect(strongs[0].textContent).toBe("Bold text");

    // The literal asterisks must NOT appear anywhere in rendered text.
    expect(container.textContent ?? "").not.toContain("**");
  });

  it("splits double-newline into separate <p> blocks", () => {
    const { container } = render(
      <StreamingMarkdown
        text={"**Bold text**\n\nPlain text"}
        streaming={false}
      />,
    );
    // Two separate paragraphs — bold (in its own <p>) and plain.
    const paras = container.querySelectorAll("p.rd-md__p");
    expect(paras.length).toBe(2);
    expect(paras[0].querySelector("strong")?.textContent).toBe("Bold text");
    expect(paras[1].textContent).toBe("Plain text");
  });

  it("renders the real-world HN pulse format (the exact bug screenshot)", () => {
    // Mirrors the format that landed in the user's screenshot:
    //   "**Stop MitM on the first SSH connection**"
    const { container } = render(
      <StreamingMarkdown
        text={"**Stop MitM on the first SSH connection**"}
        streaming={false}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe(
      "Stop MitM on the first SSH connection",
    );
    expect(container.textContent).not.toMatch(/\*\*/);
  });
});
