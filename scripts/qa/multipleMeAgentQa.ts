/**
 * Multiple-me agent QA
 *
 * Backend-oriented judge for the "multiple me with audit rails" thesis.
 * This does not screenshot UI. It gathers repository evidence for the durable
 * product primitives, asks Gemini to judge coverage, then asks Gemini for a
 * fix-loop backlog based only on the judged gaps.
 *
 * Usage:
 *   npx tsx scripts/qa/multipleMeAgentQa.ts
 *   npx tsx scripts/qa/multipleMeAgentQa.ts --out .tmp/multiple-me-agent-qa/run1
 *
 * Env:
 *   GEMINI_API_KEY, GOOGLE_AI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY
 */

import { GoogleGenAI, Type } from "@google/genai";
import { config as loadEnv } from "dotenv";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const PRIMARY_MODEL = "gemini-3.1-pro-preview";
const FALLBACK_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
];

type Status = "pass" | "partial" | "fail";

interface CliArgs {
  outputDir: string;
}

interface EvidenceItem {
  id: string;
  file: string;
  summary: string;
  snippets: string[];
}

interface DeterministicCheck {
  id: string;
  label: string;
  status: Status;
  evidence: string[];
  missing: string[];
}

interface JudgeCriterion {
  id: string;
  label: string;
  status: Status;
  confidence: number;
  evidence: string[];
  missing: string[];
  requiredFix: string;
}

interface JudgeResult {
  modelUsed: string;
  overallStatus: Status;
  score: number;
  summary: string;
  criteria: JudgeCriterion[];
  criticalGaps: string[];
  recommendedNextRun: string;
  rawResponseText: string;
}

interface FixBacklogItem {
  priority: "p0" | "p1" | "p2" | "p3";
  title: string;
  ownerSurface: "backend" | "agent" | "frontend" | "database" | "qa";
  filesToInspect: string[];
  acceptanceCriteria: string[];
  testCommand: string;
}

interface FixPlanResult {
  modelUsed: string;
  summary: string;
  backlog: FixBacklogItem[];
  runbook: string[];
  rawResponseText: string;
}

const TARGET_SPEC = `
NodeBench target thesis:
High-performing users can already do high-quality research manually. The product must scale their judgment across many entities without quality collapse.

Required product primitives:
1. Style Profile: durable analyst voice / style.skill.md style manifest.
2. Golden Set: user uploads or examples that derive a private style profile.
3. Rubric Library: reusable sections, required fields, source rules, scoring dimensions.
4. Universe: entity lists / coverage sets.
5. Batch Run: apply prompt + rubric + style across many entities.
6. Review Queue: QA lane for weak sources, style mismatch, missing fields, low confidence.
7. Audit Rails: claim-level citations, evidence, source refs, QA scoring, approvals, budget safety.
8. Reports: coverage library of universes -> reports -> claims.
9. Chat: single entity answer plus "multiply this" / run on list handoff.
10. Inbox: batch output review, agent suggestions, captures, watchlist nudges, approvals.
11. Me: style profile, Golden Set, Rubric Library, editable memory notebook.
12. Home: new visitor style gallery, repeat visitor coverage command center.
13. Public style gallery: six starter styles - gs.banker.brief, yc.investor.memo, stratechery.analysis, bessemer.scorecard, buffett.plainenglish, firstround.casestudy.
14. Style inference: opt-in sampling of conversations/uploads, extraction to style.skill.md draft, user accept/edit/pin.
15. Agent backend workflow: deterministic checks plus real LLM judge, persisted/auditable results, explicit fix-loop backlog.
`;

const REQUIRED_CRITERIA = [
  ["style_profile", "Style Profile is durable and visible"],
  ["golden_set", "Golden Set examples can drive private style extraction"],
  ["rubric_library", "Rubric Library is modeled separately from prose style"],
  ["universe", "Universe entity lists are first-class"],
  ["batch_run", "Batch Run applies one prompt/rubric/style across many entities"],
  ["review_queue", "Review Queue triages batch outputs by reason"],
  ["audit_rails", "Audit rails cover claims, evidence, citations, approvals, budget"],
  ["reports_coverage", "Reports act as coverage library with claims and exports"],
  ["chat_multiply", "Chat can multiply a single prompt across a list"],
  ["inbox_review", "Inbox owns uncertainty, approvals, and batch-output review"],
  ["me_manifest", "Me owns style, Golden Set, rubrics, editable memory"],
  ["home_states", "Home distinguishes new visitor gallery from repeat command center"],
  ["public_styles", "Six public starter styles are present as reusable manifests"],
  ["style_inference", "Style inference has backend policy and acceptance loop"],
  ["qa_fix_loop", "Real LLM judge plus fix-loop workflow exists"],
] as const;

const EVIDENCE_FILES = [
  {
    id: "product_schema",
    file: "convex/domains/product/schema.ts",
    patterns: [
      "productReports",
      "productClaims",
      "productClaimSupports",
      "productClaimReviews",
      "productReportExports",
      "productReportExportRows",
      "productEventWorkspaces",
      "productEventRunRecords",
      "productNudges",
      "productProfileSummaries",
      "productContextItems",
      "productActivityLedger",
      "notebookHtml",
    ],
  },
  {
    id: "root_schema",
    file: "convex/schema.ts",
    patterns: [
      "operatorProfiles",
      "agentRuns",
      "agentWriteEvents",
      "agentBudgets",
      "dogfoodJudgeRuns",
      "dogfoodFixAttempts",
      "evalRuns",
      "evalResults",
      "rubricEvolutions",
      "agentScratchpads",
      "researchJobs",
      "researchSessions",
      "researchMemory",
      "claims",
      "claimEvidence",
    ],
  },
  {
    id: "operator_profile",
    file: "convex/domains/operatorProfile/mutations.ts",
    patterns: ["markdown", "operatorProfiles", "profile", "document", "parse"],
  },
  {
    id: "operator_manifest",
    file: "convex/domains/operatorProfile/manifest.ts",
    patterns: [
      "StyleProfileManifest",
      "GoldenSetArtifact",
      "RubricDefinition",
      "Personal Context Notebook",
      "Golden Set",
      "Rubric Library",
      "ChatMultiplyHandoff",
      "Run on a list",
      "Multiply",
      "Batch",
      "MemoryPatchProposal",
      "approvalRequired",
      "toRedesignStyleProfileUpsertArgs",
      "createRedesignUniverseUpsertArgs",
      "toRedesignDocumentPatchProposal",
      "redesign.s5.v1",
    ],
  },
  {
    id: "redesign_style_profile",
    file: "convex/domains/redesign/styleProfile.ts",
    patterns: ["styleProfiles", "getActive", "upsert", "setActive", "provenance", "modelUsed"],
  },
  {
    id: "redesign_universes",
    file: "convex/domains/redesign/universes.ts",
    patterns: ["redesignUniverses", "entityIds", "styleId", "rubric", "setMonitoring"],
  },
  {
    id: "redesign_document_patches",
    file: "convex/domains/redesign/documentPatches.ts",
    patterns: ["redesignDocumentPatches", "listPending", "propose", "accept", "reject", "batchAutopilotRunId"],
  },
  {
    id: "redesign_batch_hook",
    file: "src/features/redesign/hooks/useBatchLive.ts",
    patterns: ["getRecentRuns", "ActiveBatchRun", "styleName", "rubric", "universeName"],
  },
  {
    id: "operator_queries",
    file: "convex/domains/operatorProfile/queries.ts",
    patterns: ["getProfileByUserId", "operatorProfiles", "document"],
  },
  {
    id: "batch_autopilot",
    file: "convex/domains/operations/batchAutopilot/runner.ts",
    patterns: ["batch", "operatorProfile", "ctx.run", "artifact", "approval"],
  },
  {
    id: "diligence_judge",
    file: "server/pipeline/diligenceJudge.ts",
    patterns: ["capturedSources", "latencyWithinBudget", "reportsToolCalls", "reportsTokenCounts", "verdict"],
  },
  {
    id: "diligence_llm_judge",
    file: "convex/domains/product/diligenceLlmJudgeRuns.ts",
    patterns: ["scoreVerdictWithLlm", "recordLlmJudgeRun", "status", "scored", "parse_error", "request_failed"],
  },
  {
    id: "agent_judge",
    file: "convex/domains/evaluation/agentRunJudge.ts",
    patterns: ["judgeAgentRun", "evidenceCited", "noHallucination", "budgetRespected", "noForbiddenActions"],
  },
  {
    id: "qa_script",
    file: "scripts/qa/redesignAgentQa.ts",
    patterns: ["Gemini", "responseSchema", "findings", "scoreOverall", "fix", "personas"],
  },
  {
    id: "redesign_fixtures",
    file: "src/features/redesign/fixtures.ts",
    patterns: [
      "memoStyles",
      "gs.banker.brief",
      "yc.investor.memo",
      "stratechery.analysis",
      "bessemer.scorecard",
      "buffett.plainenglish",
      "firstround.casestudy",
      "inferredStyleProvenance",
      "reports",
      "inboxItems",
    ],
  },
  {
    id: "home_surface",
    file: "src/features/redesign/surfaces/HomeSurface.tsx",
    patterns: ["Style", "memo", "publicResearch", "continueWorking", "watchlist", "memoryPulse"],
  },
  {
    id: "chat_surface",
    file: "src/features/redesign/surfaces/ChatSurface.tsx",
    patterns: ["Run on a list", "Multiply", "Compare across list", "Batch", "UniversalComposer"],
  },
  {
    id: "reports_surface",
    file: "src/features/redesign/surfaces/ReportsSurface.tsx",
    patterns: ["Brief", "Explore", "Chat", "style", "density", "Bulk", "universe"],
  },
  {
    id: "inbox_surface",
    file: "src/features/redesign/surfaces/InboxSurface.tsx",
    patterns: ["approval", "confidence", "review", "Captures", "Watchlist", "Batch"],
  },
  {
    id: "me_surface",
    file: "src/features/redesign/surfaces/MeSurface.tsx",
    patterns: ["Style Profile", "Golden", "Rubric", "Personal Context Notebook", "Accept", "Reject"],
  },
  {
    id: "roadmap",
    file: "docs/architecture/REDESIGN_ROADMAP.md",
    patterns: ["Style Profile", "Golden Set", "Rubric Library", "Universe", "Batch Run", "Review Queue", "multiple me"],
  },
  {
    id: "package_scripts",
    file: "package.json",
    patterns: ["qa:redesign", "dogfood:loop", "dogfood:verify", "eval:capability"],
  },
];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    outputDir: path.resolve(".tmp/multiple-me-agent-qa", new Date().toISOString().replace(/[:.]/g, "-")),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      args.outputDir = path.resolve(argv[++i]);
    }
  }
  return args;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase();
}

function extractContext(lines: string[], index: number, radius = 2): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines
    .slice(start, end)
    .map((line, offset) => `${String(start + offset + 1).padStart(4, " ")}: ${line}`)
    .join("\n");
}

async function gatherEvidence(): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];
  for (const source of EVIDENCE_FILES) {
    if (!(await pathExists(source.file))) {
      evidence.push({
        id: source.id,
        file: source.file,
        summary: "missing file",
        snippets: [],
      });
      continue;
    }

    const text = await fs.readFile(source.file, "utf8");
    const lines = text.split(/\r?\n/);
    const haystackLines = lines.map(normalizeForSearch);
    const snippets: string[] = [];
    const matched = new Set<string>();

    for (const pattern of source.patterns) {
      const needle = pattern.toLowerCase();
      const idx = haystackLines.findIndex((line) => line.includes(needle));
      if (idx >= 0) {
        matched.add(pattern);
        snippets.push(`MATCH ${pattern}\n${extractContext(lines, idx)}`);
      }
    }

    evidence.push({
      id: source.id,
      file: source.file,
      summary: `matched ${matched.size}/${source.patterns.length}: ${Array.from(matched).join(", ") || "none"}`,
      snippets: snippets.slice(0, 14),
    });
  }
  return evidence;
}

function includesEvidence(evidence: EvidenceItem[], fileId: string, term: string): boolean {
  const item = evidence.find((e) => e.id === fileId);
  if (!item) return false;
  const blob = `${item.summary}\n${item.snippets.join("\n")}`.toLowerCase();
  return blob.includes(term.toLowerCase());
}

function deterministicChecks(evidence: EvidenceItem[]): DeterministicCheck[] {
  const checks: DeterministicCheck[] = [];
  const add = (
    id: string,
    label: string,
    passTests: boolean[],
    partialTests: boolean[],
    evidenceLines: string[],
    missing: string[],
  ) => {
    const status: Status = passTests.every(Boolean)
      ? "pass"
      : partialTests.some(Boolean)
        ? "partial"
        : "fail";
    checks.push({ id, label, status, evidence: evidenceLines.filter(Boolean), missing: status === "pass" ? [] : missing });
  };

  add(
    "public_styles",
    "Six public starter styles",
    [
      includesEvidence(evidence, "redesign_fixtures", "gs.banker.brief"),
      includesEvidence(evidence, "redesign_fixtures", "yc.investor.memo"),
      includesEvidence(evidence, "redesign_fixtures", "stratechery.analysis"),
      includesEvidence(evidence, "redesign_fixtures", "bessemer.scorecard"),
      includesEvidence(evidence, "redesign_fixtures", "buffett.plainenglish"),
      includesEvidence(evidence, "redesign_fixtures", "firstround.casestudy"),
    ],
    [includesEvidence(evidence, "redesign_fixtures", "memoStyles")],
    ["src/features/redesign/fixtures.ts has memoStyles starter pack evidence"],
    ["Expected all six style ids in a reusable manifest"],
  );

  add(
    "reports_coverage",
    "Reports preserve reusable memory with claims/evidence/export",
    [
      includesEvidence(evidence, "product_schema", "productReports"),
      includesEvidence(evidence, "product_schema", "productClaims"),
      includesEvidence(evidence, "product_schema", "productClaimSupports"),
      includesEvidence(evidence, "product_schema", "productReportExports"),
    ],
    [
      includesEvidence(evidence, "product_schema", "productReports"),
      includesEvidence(evidence, "product_schema", "productClaims"),
    ],
    ["convex/domains/product/schema.ts includes productReports/productClaims/productClaimSupports/productReportExports"],
    ["Need report -> universe grouping and review status if not present"],
  );

  add(
    "audit_rails",
    "Audit rails cover evidence, judge, approvals, and budget",
    [
      includesEvidence(evidence, "diligence_judge", "capturedSources"),
      includesEvidence(evidence, "diligence_llm_judge", "scoreVerdictWithLlm"),
      includesEvidence(evidence, "agent_judge", "budgetRespected"),
      includesEvidence(evidence, "root_schema", "agentBudgets"),
    ],
    [
      includesEvidence(evidence, "diligence_judge", "capturedSources"),
      includesEvidence(evidence, "diligence_llm_judge", "recordLlmJudgeRun"),
      includesEvidence(evidence, "agent_judge", "noHallucination"),
    ],
    ["diligenceJudge, diligenceLlmJudgeRuns, agentRunJudge, and schema budget/audit primitives found"],
    ["Need tie these rails to style/universe/batch runs if missing"],
  );

  add(
    "me_manifest",
    "Me owns operator memory and manifest",
    [
      includesEvidence(evidence, "operator_profile", "markdown"),
      includesEvidence(evidence, "operator_profile", "operatorProfiles"),
      includesEvidence(evidence, "operator_manifest", "Personal Context Notebook"),
      includesEvidence(evidence, "operator_manifest", "StyleProfileManifest"),
      includesEvidence(evidence, "operator_manifest", "GoldenSetArtifact"),
      includesEvidence(evidence, "operator_manifest", "RubricDefinition"),
      includesEvidence(evidence, "redesign_style_profile", "styleProfiles"),
    ],
    [
      includesEvidence(evidence, "operator_profile", "operatorProfiles"),
      includesEvidence(evidence, "me_surface", "Style Profile"),
    ],
    ["operatorProfile domain plus operator manifest evidence found"],
    ["Need explicit style.skill.md, Golden Set, and Rubric Library backend linkage if missing"],
  );

  add(
    "batch_run",
    "Batch run applies one judgment process across many entities",
    [
      includesEvidence(evidence, "batch_autopilot", "batch"),
      includesEvidence(evidence, "redesign_batch_hook", "getRecentRuns"),
      includesEvidence(evidence, "root_schema", "researchJobs"),
      includesEvidence(evidence, "operator_manifest", "ChatMultiplyHandoff"),
      includesEvidence(evidence, "operator_manifest", "redesign.s5.v1"),
    ],
    [
      includesEvidence(evidence, "batch_autopilot", "batch"),
      includesEvidence(evidence, "product_schema", "productRunEvents"),
    ],
    ["batchAutopilot/productEventRunRecords/researchJobs evidence found"],
    ["Need explicit BatchRun object with styleProfileId, rubricId, universeId, QA thresholds"],
  );

  add(
    "review_queue",
    "Review queue exists for weak sources, missing fields, approvals",
    [
      includesEvidence(evidence, "product_schema", "productClaimReviews"),
      includesEvidence(evidence, "product_schema", "productNudges"),
      includesEvidence(evidence, "inbox_surface", "approval"),
      includesEvidence(evidence, "redesign_document_patches", "redesignDocumentPatches"),
    ],
    [
      includesEvidence(evidence, "product_schema", "productClaimReviews"),
      includesEvidence(evidence, "inbox_surface", "confidence"),
    ],
    ["productClaimReviews/productNudges plus Inbox review cues found"],
    ["Need batch-output review lanes and keyboard triage if missing"],
  );

  add(
    "qa_fix_loop",
    "Real LLM judge and fix-loop workflow",
    [
      includesEvidence(evidence, "qa_script", "Gemini"),
      includesEvidence(evidence, "qa_script", "responseSchema"),
      includesEvidence(evidence, "package_scripts", "dogfood:loop"),
      includesEvidence(evidence, "root_schema", "dogfoodFixAttempts"),
    ],
    [
      includesEvidence(evidence, "qa_script", "Gemini"),
      includesEvidence(evidence, "package_scripts", "qa:redesign"),
    ],
    ["Gemini QA script, dogfood loop script, and dogfood fix attempt schema evidence found"],
    ["Need backend thesis-specific judge if UI screenshot QA is the only coverage"],
  );

  return checks;
}

function gitStatusShort(): string {
  const result = spawnSync("git", ["status", "--short", "--branch"], {
    encoding: "utf8",
    shell: true,
  });
  if (result.error) return `git status unavailable: ${result.error.message}`;
  return (result.stdout || result.stderr || "").trim();
}

function buildEvidencePacket(evidence: EvidenceItem[], checks: DeterministicCheck[]): string {
  const evidenceText = evidence
    .map((item) => {
      const snippets = item.snippets.join("\n\n").slice(0, 5000);
      return `## ${item.id}\nFile: ${item.file}\nSummary: ${item.summary}\n\n${snippets || "(no snippets)"}`;
    })
    .join("\n\n");

  const checksText = checks
    .map((check) => {
      return `- ${check.id}: ${check.status}\n  evidence: ${check.evidence.join("; ") || "none"}\n  missing: ${check.missing.join("; ") || "none"}`;
    })
    .join("\n");

  return `# Target spec\n${TARGET_SPEC}\n\n# Required criteria\n${REQUIRED_CRITERIA
    .map(([id, label]) => `- ${id}: ${label}`)
    .join("\n")}\n\n# Deterministic checks\n${checksText}\n\n# Repository evidence\n${evidenceText}\n\n# Git status\n${gitStatusShort()}`;
}

const JUDGE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overallStatus: { type: Type.STRING, enum: ["pass", "partial", "fail"] },
    score: { type: Type.NUMBER, description: "0-100 implementation coverage score" },
    summary: { type: Type.STRING },
    criteria: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          status: { type: Type.STRING, enum: ["pass", "partial", "fail"] },
          confidence: { type: Type.NUMBER },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
          missing: { type: Type.ARRAY, items: { type: Type.STRING } },
          requiredFix: { type: Type.STRING },
        },
        required: ["id", "label", "status", "confidence", "evidence", "missing", "requiredFix"],
      },
    },
    criticalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendedNextRun: { type: Type.STRING },
  },
  required: ["overallStatus", "score", "summary", "criteria", "criticalGaps", "recommendedNextRun"],
} as const;

const FIX_PLAN_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    backlog: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          priority: { type: Type.STRING, enum: ["p0", "p1", "p2", "p3"] },
          title: { type: Type.STRING },
          ownerSurface: { type: Type.STRING, enum: ["backend", "agent", "frontend", "database", "qa"] },
          filesToInspect: { type: Type.ARRAY, items: { type: Type.STRING } },
          acceptanceCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
          testCommand: { type: Type.STRING },
        },
        required: ["priority", "title", "ownerSurface", "filesToInspect", "acceptanceCriteria", "testCommand"],
      },
    },
    runbook: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["summary", "backlog", "runbook"],
} as const;

function buildJudgePrompt(packet: string): string {
  return `You are the backend QA judge for NodeBench.

Judge whether the repository evidence covers the "multiple me with audit rails" thesis. Be strict:
- PASS means there is credible code/schema/workflow evidence for the primitive, not only copy or UI fixture text.
- PARTIAL means some relevant object exists but the target contract is incomplete.
- FAIL means mostly missing or only aspirational docs.
- Do not require all product UI to be done. This is backend/agent workflow coverage.
- Separate deterministic repository evidence from inferred intent.
- Use exactly the required criterion ids when possible.

Return JSON only.

${packet.slice(0, 60000)}`;
}

function buildFixPlanPrompt(judge: JudgeResult, checks: DeterministicCheck[]): string {
  return `You are planning the next backend fix loop for NodeBench.

Input: an LLM judge result plus deterministic checks. Build a concrete backlog to close the gaps. Do not propose broad redesign work. Prefer small backend or QA slices that make the next judge run more factual and enforceable.

Rules:
- P0: missing core primitive or judge cannot verify real backend coverage.
- P1: primitive exists only as fixture/docs, not durable runtime object.
- P2: runtime exists but not wired to audit/eval.
- P3: naming/docs/test coverage.
- Each acceptance criterion must be objectively testable.
- Include exact files to inspect or add, but do not invent a giant migration.

Judge result:
${JSON.stringify(judge, null, 2).slice(0, 40000)}

Deterministic checks:
${JSON.stringify(checks, null, 2).slice(0, 15000)}

Return JSON only.`;
}

async function callGeminiJson<T>(args: {
  ai: GoogleGenAI;
  prompt: string;
  schema: unknown;
  label: string;
}): Promise<{ parsed: T; raw: string; model: string }> {
  const chain = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr: unknown = null;

  for (const model of chain) {
    try {
      console.log(`  -> ${args.label} via ${model}`);
      const started = Date.now();
      const response = await args.ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: args.schema as never,
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });
      const raw = response.text ?? "";
      const parsed = JSON.parse(raw) as T;
      console.log(`     ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return { parsed, raw, model };
    } catch (err) {
      lastErr = err;
      console.warn(`     failed: ${(err as Error).message}`);
    }
  }

  throw new Error(`All Gemini models failed for ${args.label}: ${(lastErr as Error)?.message ?? "unknown"}`);
}

function statusIcon(status: Status): string {
  if (status === "pass") return "PASS";
  if (status === "partial") return "PARTIAL";
  return "FAIL";
}

function renderMarkdown(args: {
  evidence: EvidenceItem[];
  checks: DeterministicCheck[];
  judge: JudgeResult;
  fixPlan: FixPlanResult;
  startedAt: Date;
  finishedAt: Date;
}): string {
  const { evidence, checks, judge, fixPlan, startedAt, finishedAt } = args;
  const elapsedSec = ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1);
  const statusCounts = judge.criteria.reduce<Record<Status, number>>(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { pass: 0, partial: 0, fail: 0 },
  );

  const lines: string[] = [];
  lines.push(`# Multiple-Me Agent QA`);
  lines.push("");
  lines.push(`Started: ${startedAt.toISOString()}`);
  lines.push(`Finished: ${finishedAt.toISOString()}`);
  lines.push(`Wall clock: ${elapsedSec}s`);
  lines.push(`Judge model: \`${judge.modelUsed}\``);
  lines.push(`Fix planner model: \`${fixPlan.modelUsed}\``);
  lines.push("");
  lines.push(`Overall: **${statusIcon(judge.overallStatus)}** - **${judge.score}/100**`);
  lines.push(`Criteria: ${statusCounts.pass} pass, ${statusCounts.partial} partial, ${statusCounts.fail} fail`);
  lines.push("");
  lines.push(judge.summary);
  lines.push("");

  if (judge.criticalGaps.length > 0) {
    lines.push("## Critical Gaps");
    lines.push("");
    for (const gap of judge.criticalGaps) lines.push(`- ${gap}`);
    lines.push("");
  }

  lines.push("## Criteria");
  lines.push("");
  lines.push("| Criterion | Status | Confidence | Missing | Required fix |");
  lines.push("|---|---:|---:|---|---|");
  for (const criterion of judge.criteria) {
    lines.push(
      `| ${criterion.id} | ${criterion.status} | ${criterion.confidence.toFixed(2)} | ${criterion.missing.join("<br>") || "-"} | ${criterion.requiredFix} |`,
    );
  }
  lines.push("");

  lines.push("## Fix Loop Backlog");
  lines.push("");
  lines.push(fixPlan.summary);
  lines.push("");
  for (const item of fixPlan.backlog) {
    lines.push(`### ${item.priority.toUpperCase()} - ${item.title}`);
    lines.push(`Owner: ${item.ownerSurface}`);
    lines.push(`Files: ${item.filesToInspect.map((f) => `\`${f}\``).join(", ") || "-"}`);
    lines.push("");
    lines.push("Acceptance:");
    for (const ac of item.acceptanceCriteria) lines.push(`- ${ac}`);
    lines.push("");
    lines.push(`Test: \`${item.testCommand}\``);
    lines.push("");
  }

  lines.push("## Runbook");
  lines.push("");
  for (const step of fixPlan.runbook) lines.push(`- ${step}`);
  lines.push("");

  lines.push("## Deterministic Checks");
  lines.push("");
  for (const check of checks) {
    lines.push(`- **${check.id}**: ${check.status}`);
    if (check.missing.length > 0) lines.push(`  - Missing: ${check.missing.join("; ")}`);
  }
  lines.push("");

  lines.push("## Evidence Files");
  lines.push("");
  for (const item of evidence) {
    lines.push(`- \`${item.file}\`: ${item.summary}`);
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_AI_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY, GOOGLE_AI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY is required.");
    process.exit(1);
  }

  const startedAt = new Date();
  await fs.mkdir(args.outputDir, { recursive: true });

  console.log("Multiple-me agent QA");
  console.log(`  Output: ${args.outputDir}`);

  const evidence = await gatherEvidence();
  const checks = deterministicChecks(evidence);
  const packet = buildEvidencePacket(evidence, checks);

  const ai = new GoogleGenAI({ apiKey });

  const judged = await callGeminiJson<Omit<JudgeResult, "modelUsed" | "rawResponseText">>({
    ai,
    prompt: buildJudgePrompt(packet),
    schema: JUDGE_RESPONSE_SCHEMA,
    label: "coverage judge",
  });

  const judge: JudgeResult = {
    ...judged.parsed,
    modelUsed: judged.model,
    rawResponseText: judged.raw,
  };

  const planned = await callGeminiJson<Omit<FixPlanResult, "modelUsed" | "rawResponseText">>({
    ai,
    prompt: buildFixPlanPrompt(judge, checks),
    schema: FIX_PLAN_RESPONSE_SCHEMA,
    label: "fix planner",
  });

  const fixPlan: FixPlanResult = {
    ...planned.parsed,
    modelUsed: planned.model,
    rawResponseText: planned.raw,
  };

  const finishedAt = new Date();

  const resultJson = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    targetSpec: TARGET_SPEC,
    requiredCriteria: REQUIRED_CRITERIA,
    deterministicChecks: checks,
    evidence,
    judge,
    fixPlan,
  };

  await fs.writeFile(path.join(args.outputDir, "results.json"), JSON.stringify(resultJson, null, 2), "utf8");
  await fs.writeFile(
    path.join(args.outputDir, "findings.md"),
    renderMarkdown({ evidence, checks, judge, fixPlan, startedAt, finishedAt }),
    "utf8",
  );
  await fs.writeFile(path.join(args.outputDir, "evidence-packet.md"), packet, "utf8");

  const pass = judge.criteria.filter((c) => c.status === "pass").length;
  const partial = judge.criteria.filter((c) => c.status === "partial").length;
  const fail = judge.criteria.filter((c) => c.status === "fail").length;

  console.log("");
  console.log(`Result: ${judge.overallStatus} ${judge.score}/100`);
  console.log(`Criteria: ${pass} pass, ${partial} partial, ${fail} fail`);
  console.log(`Findings: ${path.join(args.outputDir, "findings.md")}`);
  console.log(`JSON: ${path.join(args.outputDir, "results.json")}`);

  if (judge.overallStatus === "fail" || fail > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
