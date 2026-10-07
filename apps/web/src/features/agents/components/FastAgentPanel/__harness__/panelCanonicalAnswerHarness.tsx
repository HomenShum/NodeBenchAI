/**
 * Dev-only visual harness for Phases B + C of docs/design/ONE_CHAT_INTERFACE.md.
 *
 * Renders exactly what FastAgentUIMessageBubble returns for ADOPTED turns
 * (`<PanelCanonicalAnswer {...buildCanonicalAnswerProps(...)} />`) using the
 * real adapter chain (convexToUIParts → describeCanonicalAnswerFit →
 * buildCanonicalAnswerProps) over fixture messages — no Convex providers
 * required, no production route touched. Phase C added a markdown-rich
 * adopted turn (proseFormat="markdown", streamdown prose row) below the
 * plain adopted turn, plus the ported read-aloud/delete toolbar actions.
 * Served only by the Vite dev server:
 *   npx vite --port 4189
 *   → /src/features/agents/components/FastAgentPanel/__harness__/panel-canonical-answer-harness.html
 *
 * This file is imported by nothing in the app; it exists so screenshots of
 * the adopted anatomy can be captured and reviewed as evidence.
 */
import { createRoot } from "react-dom/client";
// The app's Tailwind entry — without it the streamdown table/code chrome and
// inline marks render unstyled, which made the Phase C evidence captures
// misrepresent the in-app look (recorded as a caveat in that manifest).
import "../../../../../index.css";
import type { UIMessage } from "@convex-dev/agent/react";
import { convexToUIParts } from "../adapters/convexToUIParts";
import {
  buildCanonicalAnswerProps,
  describeCanonicalAnswerFit,
} from "../adapters/canonicalAnswer";
import { PanelCanonicalAnswer } from "../PanelCanonicalAnswer";

const fixture = {
  id: "harness-message-1",
  key: "harness-thread-0-0",
  order: 0,
  stepOrder: 0,
  status: "success",
  agentName: "coordinator",
  role: "assistant",
  _creationTime: Date.now() - 4 * 60_000,
  model: "gemini-3.5-flash",
  text: "Acme closed a $40M Series B led by Meridian and is hiring across its platform team. The round follows two quarters of enterprise pilots converting to paid contracts, and the founders say the new capital goes to compliance certifications first.",
  parts: [
    {
      type: "text",
      text: "Acme closed a $40M Series B led by Meridian and is hiring across its platform team. The round follows two quarters of enterprise pilots converting to paid contracts, and the founders say the new capital goes to compliance certifications first.",
    },
    {
      type: "tool-webSearch",
      toolCallId: "call-1",
      state: "output-available",
      input: { query: "Acme Series B funding" },
      output:
        "Acme announced a $40M Series B on Monday, led by Meridian Capital with participation from existing investors.",
    },
    {
      type: "tool-fetchPage",
      toolCallId: "call-2",
      state: "output-error",
      input: { url: "https://example.com/blocked" },
      errorText: "publisher blocked the fetch",
    },
    {
      type: "source-url",
      sourceId: "src-1",
      url: "https://example.com/acme-series-b",
      title: "Acme raises $40M Series B",
    },
    {
      type: "source-url",
      sourceId: "src-2",
      url: "https://example.com/acme-hiring",
      title: "Acme platform hiring push",
    },
    {
      type: "reasoning",
      text: "Checked the two most recent coverage items and the careers page before writing the summary.",
    },
  ],
} as unknown as UIMessage;

const MARKDOWN_TEXT = [
  "## What changed at Acme",
  "",
  "Acme closed its **$40M Series B** and published the migration guide:",
  "",
  "- Lead investor: [Meridian Capital](https://example.com/meridian)",
  "- Platform team headcount doubles this quarter",
  "- Compliance certifications land first",
  "",
  "| Metric | Before | After |",
  "| --- | --- | --- |",
  "| ARR | $6M | $11M |",
  "| Pilots converted | 4 | 11 |",
  "",
  "```ts",
  "const runway = raise / burnRate; // 31 months",
  "```",
].join("\n");

const markdownFixture = {
  id: "harness-message-2",
  key: "harness-thread-0-1",
  order: 1,
  stepOrder: 0,
  status: "success",
  agentName: "coordinator",
  role: "assistant",
  _creationTime: Date.now() - 2 * 60_000,
  model: "gemini-3.5-flash",
  text: MARKDOWN_TEXT,
  parts: [
    { type: "text", text: MARKDOWN_TEXT },
    {
      type: "tool-webSearch",
      toolCallId: "call-md-1",
      state: "output-available",
      input: { query: "Acme migration guide" },
      output: "Acme published its platform migration guide on Tuesday.",
    },
    {
      type: "source-url",
      sourceId: "src-md-1",
      url: "https://example.com/acme-migration-guide",
      title: "Acme migration guide",
    },
  ],
} as unknown as UIMessage;

function AdoptedTurn({
  label,
  message,
}: {
  label: string;
  message: UIMessage;
}) {
  const uiParts = convexToUIParts(message);
  const fit = describeCanonicalAnswerFit(uiParts, message);
  const mapped = buildCanonicalAnswerProps(uiParts, message);
  return (
    <section style={{ marginBottom: 32 }}>
      <p
        data-testid={`harness-fit-${label}`}
        style={{ fontFamily: "monospace", fontSize: 12 }}
      >
        [{label}] adoptable={String(fit.adoptable)} proseFormat={mapped.proseFormat}{" "}
        reasons=[{fit.reasons.join("; ")}]
      </p>
      <PanelCanonicalAnswer
        {...mapped}
        onRegenerate={() => console.log("regenerate", label)}
        onReadAloud={() => console.log("read aloud", label)}
        onDelete={() => console.log("delete", label)}
      />
    </section>
  );
}

function Harness() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <AdoptedTurn label="plain" message={fixture} />
      <AdoptedTurn label="markdown" message={markdownFixture} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
