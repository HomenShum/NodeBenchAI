import { DEFAULT_PIPELINE_MODEL_SELECTION } from "@/shared/llm/pipelineModelRoutes";

export type FirstImpressionHorizon = "today" | "week" | "month";

export type FirstImpressionCard = {
  id: string;
  audience: string;
  title: string;
  horizon: FirstImpressionHorizon;
  prompt: string;
  proofPoints: string[];
  exportTargets: string[];
};

export type BackgroundResearchRequest = {
  pipelineKind: "research";
  spec: string;
  title: string;
  modelId: string;
  ownerKey?: string;
  forceFresh: boolean;
  linkupDepth: "standard";
};

export const FIRST_IMPRESSION_HORIZONS: Array<{
  id: FirstImpressionHorizon;
  label: string;
  note: string;
}> = [
  { id: "today", label: "Today", note: "meeting or field note" },
  { id: "week", label: "This week", note: "compare options" },
  { id: "month", label: "This month", note: "track and export" },
];

export const FIRST_IMPRESSION_CARDS: FirstImpressionCard[] = [
  {
    id: "teacher-relocation-vibes",
    audience: "Teacher",
    title: "Relocation and school culture read",
    horizon: "today",
    prompt:
      "Research a school, principal, district, and nearby staff culture before a relocation conversation. Include reviews, salary clues, commute, public signals, and what to ask current teachers.",
    proofPoints: ["reviews and scattered forums", "salary and district context", "questions to ask people"],
    exportTargets: ["Apple Notes", "Notion", "OneNote"],
  },
  {
    id: "banker-meeting-prep",
    audience: "Banker",
    title: "One-page meeting prep",
    horizon: "today",
    prompt:
      "Create a banker-style one-page prep memo on a company and its key people. Include business model, investors, recent signals, risks, questions, and source-backed claims.",
    proofPoints: ["company brief", "people and investor edges", "meeting questions"],
    exportTargets: ["CRM CSV", "Linear", "Notion"],
  },
  {
    id: "founder-market-diligence",
    audience: "Founder",
    title: "Customer, competitor, and product diligence",
    horizon: "week",
    prompt:
      "Research a product category, competitors, buyer pain, founder public footprint, pricing signals, and evidence-backed wedge. Turn it into a report with sources and follow-ups.",
    proofPoints: ["competitor cluster", "buyer pain signals", "follow-up plan"],
    exportTargets: ["ChatGPT", "Notion", "Markdown"],
  },
  {
    id: "culture-salary-scan",
    audience: "Everyone",
    title: "Culture, salary, and reputation scan",
    horizon: "week",
    prompt:
      "Gather scattered public context about an organization or person: salary ranges, culture reviews, news, public footprint, concerns, and what is unsupported or stale.",
    proofPoints: ["culture and compensation clues", "unsupported claim audit", "source freshness"],
    exportTargets: ["Apple Notes", "OneNote", "CSV"],
  },
  {
    id: "watchlist-monthly-refresh",
    audience: "Operator",
    title: "Track the entity and nudge on changes",
    horizon: "month",
    prompt:
      "Create a watchlist-style monthly refresh for this entity. Track new public signals, stale sources, claim changes, and the next action packet for export.",
    proofPoints: ["monthly deltas", "stale source list", "exportable action packet"],
    exportTargets: ["Linear", "CRM CSV", "Markdown"],
  },
];

export function getFirstImpressionCards(horizon: FirstImpressionHorizon) {
  return FIRST_IMPRESSION_CARDS.filter((card) => card.horizon === horizon);
}

export function createBackgroundResearchRequest({
  query,
  fallbackPrompt,
  title,
  ownerKey,
}: {
  query: string;
  fallbackPrompt: string;
  title?: string;
  ownerKey?: string;
}): BackgroundResearchRequest {
  const spec = query.trim() || fallbackPrompt.trim();
  const resolvedTitle = title?.trim() || (spec.length > 72 ? `${spec.slice(0, 69).trim()}...` : spec);
  return {
    pipelineKind: "research",
    spec,
    title: resolvedTitle,
    modelId: DEFAULT_PIPELINE_MODEL_SELECTION,
    forceFresh: true,
    linkupDepth: "standard",
    ...(ownerKey ? { ownerKey } : {}),
  };
}
