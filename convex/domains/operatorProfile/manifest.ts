/**
 * Operator manifest contract.
 *
 * This is the backend shape behind the Me page's editable USER.md memory file.
 * The markdown document remains the durable source of truth; these helpers
 * parse the durable document into runtime objects for "multiple me" workflows.
 */

export type ManifestPermission =
  | "use_in_chat"
  | "use_in_reports"
  | "use_in_exports"
  | "private_only"
  | "disabled";

export interface StyleProfileManifest {
  id: string;
  label: string;
  version: string;
  confidence: number;
  sourceCount: number;
  voice: string;
  sectionOrder: string[];
  sourcePreferences: string[];
  recommendationPhrases: string[];
  riskLens: string[];
  permissions: ManifestPermission[];
}

export interface GoldenSetArtifact {
  id: string;
  title: string;
  artifactType: "memo" | "report" | "prompt" | "conversation" | "manager_feedback" | "other";
  extractionConfidence: number;
  provenance: string;
  accepted: boolean;
}

export interface RubricSection {
  id: string;
  title: string;
  required: boolean;
  sourceRule: string;
  scoringDimension: string;
}

export interface RubricDefinition {
  id: string;
  title: string;
  description: string;
  sections: RubricSection[];
  requiredFields: string[];
  sourceRules: string[];
  scoringDimensions: string[];
}

export interface MemoryPatchProposal {
  id: string;
  targetSection: string;
  proposedMarkdown: string;
  reason: string;
  confidence: number;
  approvalRequired: boolean;
  sourceType: "chat" | "report" | "event_capture" | "notebook_edit" | "export" | "explicit_remember";
}

export interface OperatorManifest {
  schemaVersion: "operator_manifest.v1";
  personalContextNotebook: string;
  styleProfile: StyleProfileManifest;
  goldenSet: GoldenSetArtifact[];
  rubricLibrary: RubricDefinition[];
  memoryUpdatePolicy: {
    explicitRemember: "auto_save";
    lowRiskPreference: "suggest_with_undo";
    privacyBudgetConnectorsSharing: "approval_required";
  };
  permissionsBySection: Record<string, ManifestPermission[]>;
}

export interface ChatMultiplyHandoff {
  handoffType: "chat_to_batch";
  sourceThreadId?: string;
  prompt: string;
  universeId: string;
  styleProfileId: string;
  rubricId: string;
  sourcePolicy: string[];
  sampleSize: number;
  fullBatchSize?: number;
  qaThresholds: {
    minCitationCoverage: number;
    minRubricCompleteness: number;
    requireHumanApprovalForLowConfidence: boolean;
  };
  runControls: {
    label: "Run on a list";
    primaryAction: "Multiply";
    mode: "sample_first";
    killSwitchRequired: boolean;
  };
}

export const PERSONAL_CONTEXT_NOTEBOOK_SECTIONS = [
  "Background",
  "Current priorities",
  "Projects I am building",
  "Companies, people, and markets I care about",
  "Communication style",
  "Evidence preferences",
  "CRM / export preferences",
  "Privacy boundaries",
  "Things NodeBench should not assume",
] as const;

const DEFAULT_STYLE_PROFILE: StyleProfileManifest = {
  id: "founder_banker_lens_v1",
  label: "Style Profile: Founder / banker lens",
  version: "v1",
  confidence: 0.75,
  sourceCount: 0,
  voice: "Concise, evidence-led, banker-memo cadence. Start with the recommendation.",
  sectionOrder: ["Short answer", "Why it matters", "Evidence", "Risks / unknowns", "Next action"],
  sourcePreferences: ["primary sources", "SEC filings", "company pages", "credible press", "uploaded examples"],
  recommendationPhrases: ["prioritize", "monitor", "deprioritize", "needs review"],
  riskLens: ["market ambiguity", "revenue quality", "founder background", "financing stage"],
  permissions: ["use_in_chat", "use_in_reports", "private_only"],
};

export const DEFAULT_GOLDEN_SET_POLICY = {
  minimumAcceptedExamples: 3,
  recommendedExamples: 10,
  requiredArtifactFields: ["title", "artifactType", "extractionConfidence", "provenance", "accepted"],
  approvalFlow: ["upload", "extract_patterns", "review_diff", "accept_or_edit", "pin_sections"],
} as const;

export const DEFAULT_RUBRIC_LIBRARY: RubricDefinition[] = [
  {
    id: "banker_coverage_screen",
    title: "Rubric Library: Banker coverage screen",
    description: "Screens companies for relationship value, source quality, risks, and next action.",
    sections: [
      section("executive_read", "Executive read", true, "At least two source-backed claims", "clarity"),
      section("business_overview", "Business overview", true, "Company or product source required", "business_model"),
      section("traction_signals", "Traction and commercial signals", true, "Cite funding, hiring, customer, or usage evidence", "traction"),
      section("risks_unknowns", "Risks and unknowns", true, "Flag missing or weak evidence explicitly", "risk"),
      section("recommended_action", "Recommended action", true, "Use prioritize / monitor / deprioritize / needs review", "judgment"),
    ],
    requiredFields: ["entity", "recommendation", "source_count", "citation_coverage", "next_action"],
    sourceRules: ["cite funding claims", "cite traction claims", "separate fact from inference"],
    scoringDimensions: ["rubric_completeness", "citation_coverage", "style_match", "source_quality"],
  },
  {
    id: "vc_investor_memo",
    title: "Rubric Library: VC investor memo",
    description: "Evaluates why now, team, market, product, traction, risks, and follow-up diligence.",
    sections: [
      section("recommendation", "Recommendation", true, "State conviction before detail", "judgment"),
      section("why_now", "Why now", true, "Connect category timing to external evidence", "market_timing"),
      section("team", "Team", true, "Founder background source preferred", "team"),
      section("market", "Market", true, "Use cited market or category evidence", "market"),
      section("diligence_questions", "Follow-up diligence questions", true, "Every unknown becomes a question", "next_steps"),
    ],
    requiredFields: ["entity", "thesis", "risks", "diligence_questions", "recommendation"],
    sourceRules: ["prefer primary sources", "mark uncited private estimates as needs_review"],
    scoringDimensions: ["thesis_strength", "evidence_quality", "risk_handling", "next_step_quality"],
  },
];

function section(id: string, title: string, required: boolean, sourceRule: string, scoringDimension: string): RubricSection {
  return { id, title, required, sourceRule, scoringDimension };
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|$(?!\\n))`, "mi"));
  return match?.[1]?.trim() ?? "";
}

function parseList(sectionText: string): string[] {
  return sectionText
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

function parseConfidence(text: string, fallback: number): number {
  const percent = text.match(/(\d{1,3})\s*%/);
  if (!percent) return fallback;
  const raw = Number(percent[1]) / 100;
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : fallback;
}

function parseGoldenSet(sectionText: string): GoldenSetArtifact[] {
  const rows = parseList(sectionText);
  return rows.map((row, index) => ({
    id: `golden_${index + 1}`,
    title: row.replace(/\s*\([^)]*\)\s*$/, ""),
    artifactType: row.toLowerCase().includes("feedback")
      ? "manager_feedback"
      : row.toLowerCase().includes("prompt")
        ? "prompt"
        : row.toLowerCase().includes("conversation")
          ? "conversation"
          : "memo",
    extractionConfidence: parseConfidence(row, 0.8),
    provenance: row,
    accepted: !/\breject(ed)?\b/i.test(row),
  }));
}

export function parseOperatorManifestMarkdown(markdown: string): OperatorManifest {
  const notebook = extractMarkdownSection(markdown, "Personal Context Notebook");
  const styleSection = extractMarkdownSection(markdown, "Style Profile");
  const goldenSetSection = extractMarkdownSection(markdown, "Golden Set");
  const rubricSection = extractMarkdownSection(markdown, "Rubric Library");

  const styleBullets = parseList(styleSection);
  const goldenSet = parseGoldenSet(goldenSetSection);
  const rubricTitles = parseList(rubricSection);
  const rubricLibrary = rubricTitles.length > 0
    ? rubricTitles.map((title, index) => ({
        ...DEFAULT_RUBRIC_LIBRARY[index % DEFAULT_RUBRIC_LIBRARY.length],
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `rubric_${index + 1}`,
        title: `Rubric Library: ${title}`,
      }))
    : DEFAULT_RUBRIC_LIBRARY;

  return {
    schemaVersion: "operator_manifest.v1",
    personalContextNotebook: notebook || PERSONAL_CONTEXT_NOTEBOOK_SECTIONS.map((heading) => `### ${heading}\n`).join("\n"),
    styleProfile: {
      ...DEFAULT_STYLE_PROFILE,
      confidence: parseConfidence(styleSection, goldenSet.length > 0 ? 0.85 : DEFAULT_STYLE_PROFILE.confidence),
      sourceCount: goldenSet.length,
      voice: styleBullets[0] ?? DEFAULT_STYLE_PROFILE.voice,
      sectionOrder: styleBullets.length > 1 ? styleBullets.slice(0, 5) : DEFAULT_STYLE_PROFILE.sectionOrder,
    },
    goldenSet,
    rubricLibrary,
    memoryUpdatePolicy: {
      explicitRemember: "auto_save",
      lowRiskPreference: "suggest_with_undo",
      privacyBudgetConnectorsSharing: "approval_required",
    },
    permissionsBySection: {
      "Personal Context Notebook": ["use_in_chat", "use_in_reports", "private_only"],
      "Style Profile": ["use_in_chat", "use_in_reports"],
      "Golden Set": ["use_in_reports", "private_only"],
      "Rubric Library": ["use_in_chat", "use_in_reports", "use_in_exports"],
      "Privacy boundaries": ["private_only"],
    },
  };
}

export function buildStyleSkillMarkdown(manifest: OperatorManifest): string {
  const style = manifest.styleProfile;
  return [
    "---",
    `name: ${style.id}`,
    `description: ${style.label}`,
    `confidence: ${style.confidence}`,
    `source_count: ${style.sourceCount}`,
    "---",
    "",
    "## Voice",
    style.voice,
    "",
    "## Section structure",
    ...style.sectionOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Source preferences",
    ...style.sourcePreferences.map((item) => `- ${item}`),
    "",
    "## Risk lens",
    ...style.riskLens.map((item) => `- ${item}`),
    "",
    "## Recommendation phrasing",
    ...style.recommendationPhrases.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function createChatMultiplyHandoff(args: {
  sourceThreadId?: string;
  prompt: string;
  universeId: string;
  styleProfileId: string;
  rubricId: string;
  fullBatchSize?: number;
  sourcePolicy?: string[];
}): ChatMultiplyHandoff {
  return {
    handoffType: "chat_to_batch",
    sourceThreadId: args.sourceThreadId,
    prompt: args.prompt,
    universeId: args.universeId,
    styleProfileId: args.styleProfileId,
    rubricId: args.rubricId,
    sourcePolicy: args.sourcePolicy ?? ["memory_first", "public_sources", "claim_level_citations"],
    sampleSize: 3,
    fullBatchSize: args.fullBatchSize,
    qaThresholds: {
      minCitationCoverage: 0.85,
      minRubricCompleteness: 0.9,
      requireHumanApprovalForLowConfidence: true,
    },
    runControls: {
      label: "Run on a list",
      primaryAction: "Multiply",
      mode: "sample_first",
      killSwitchRequired: true,
    },
  };
}

export function proposeMemoryPatch(args: {
  targetSection: string;
  proposedMarkdown: string;
  reason: string;
  confidence: number;
  sourceType: MemoryPatchProposal["sourceType"];
}): MemoryPatchProposal {
  const approvalRequired =
    /privacy|budget|connector|sharing|crm|send email/i.test(args.targetSection) ||
    ["export"].includes(args.sourceType);

  return {
    id: `mem_patch_${Math.abs(hashString(`${args.targetSection}:${args.proposedMarkdown}`))}`,
    targetSection: args.targetSection,
    proposedMarkdown: args.proposedMarkdown,
    reason: args.reason,
    confidence: Math.max(0, Math.min(1, args.confidence)),
    approvalRequired,
    sourceType: args.sourceType,
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash;
}
