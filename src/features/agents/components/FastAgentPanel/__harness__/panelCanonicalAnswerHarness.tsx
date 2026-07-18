/**
 * Dev-only visual harness for Phase B of docs/design/ONE_CHAT_INTERFACE.md.
 *
 * Renders exactly what FastAgentUIMessageBubble returns for an ADOPTED turn
 * (`<PanelCanonicalAnswer {...buildCanonicalAnswerProps(...)} />`) using the
 * real adapter chain (convexToUIParts → describeCanonicalAnswerFit →
 * buildCanonicalAnswerProps) over a fixture message — no Convex providers
 * required, no production route touched. Served only by the Vite dev server:
 *   npx vite --port 4189
 *   → /src/features/agents/components/FastAgentPanel/__harness__/panel-canonical-answer-harness.html
 *
 * This file is imported by nothing in the app; it exists so screenshots of
 * the adopted anatomy can be captured and reviewed as evidence.
 */
import { createRoot } from "react-dom/client";
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

const uiParts = convexToUIParts(fixture);
const fit = describeCanonicalAnswerFit(uiParts, fixture);
const mapped = buildCanonicalAnswerProps(uiParts, fixture);

function Harness() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <p
        data-testid="harness-fit"
        style={{ fontFamily: "monospace", fontSize: 12 }}
      >
        adoptable={String(fit.adoptable)} reasons=[{fit.reasons.join("; ")}]
      </p>
      <PanelCanonicalAnswer
        {...mapped}
        onRegenerate={() => console.log("regenerate")}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
