/**
 * Local-only multiple-me agent QA.
 *
 * Safe fallback when external LLM judge execution is blocked. This script keeps
 * all evidence on the machine and scores repository coverage with explicit gates.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDirArg = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : `.tmp/multiple-me-agent-qa-local/${timestamp}`;
const outDir = path.resolve(outDirArg);

const evidenceFiles = [
  {
    id: "product_schema",
    file: "convex/domains/product/schema.ts",
    terms: [
      "productReports",
      "productClaims",
      "productClaimSupports",
      "productClaimReviews",
      "productReportExports",
      "productReportExportRows",
      "productEventWorkspaces",
      "productEventRunRecords",
      "productActivityLedger",
      "notebookHtml",
    ],
  },
  {
    id: "root_schema",
    file: "convex/schema.ts",
    terms: [
      "operatorProfiles",
      "agentRuns",
      "agentWriteEvents",
      "userBudgets",
      "dogfoodJudgeRuns",
      "dogfoodFixAttempts",
      "evalRuns",
      "evalResults",
      "rubricEvolutions",
      "researchJobs",
      "claims",
      "claimEvidence",
    ],
  },
  {
    id: "operator_profile",
    file: "convex/domains/operatorProfile/mutations.ts",
    terms: ["markdown", "operatorProfiles", "document", "parse"],
  },
  {
    id: "operator_manifest",
    file: "convex/domains/operatorProfile/manifest.ts",
    terms: [
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
    terms: ["styleProfiles", "getActive", "upsert", "setActive", "provenance", "modelUsed"],
  },
  {
    id: "redesign_universes",
    file: "convex/domains/redesign/universes.ts",
    terms: ["redesignUniverses", "entityIds", "styleId", "rubric", "setMonitoring"],
  },
  {
    id: "redesign_document_patches",
    file: "convex/domains/redesign/documentPatches.ts",
    terms: ["redesignDocumentPatches", "listPending", "propose", "accept", "reject", "batchAutopilotRunId"],
  },
  {
    id: "redesign_live_hooks",
    file: "src/features/redesign/hooks/useBatchLive.ts",
    terms: ["getRecentRuns", "ActiveBatchRun", "styleName", "rubric", "universeName"],
  },
  {
    id: "batch_autopilot",
    file: "convex/domains/operations/batchAutopilot/runner.ts",
    terms: ["batch", "operatorProfile", "approval"],
  },
  {
    id: "deterministic_judge",
    file: "server/pipeline/diligenceJudge.ts",
    terms: ["capturedSources", "latencyWithinBudget", "reportsToolCalls", "reportsTokenCounts", "verdict"],
  },
  {
    id: "llm_judge",
    file: "convex/domains/product/diligenceLlmJudgeRuns.ts",
    terms: ["scoreVerdictWithLlm", "recordLlmJudgeRun", "scored", "parse_error", "request_failed"],
  },
  {
    id: "agent_judge",
    file: "convex/domains/evaluation/agentRunJudge.ts",
    terms: ["judgeAgentRun", "evidenceCited", "noHallucination", "budgetRespected", "noForbiddenActions"],
  },
  {
    id: "style_fixtures",
    file: "src/features/redesign/fixtures.ts",
    terms: [
      "memoStyles",
      "gs.banker.brief",
      "yc.investor.memo",
      "stratechery.analysis",
      "bessemer.scorecard",
      "buffett.plainenglish",
      "firstround.casestudy",
      "inferredStyleProvenance",
    ],
  },
  {
    id: "home_surface",
    file: "src/features/redesign/surfaces/HomeSurface.tsx",
    terms: ["Style", "publicResearch", "continueWorking", "watchlist", "memoryPulse"],
  },
  {
    id: "chat_surface",
    file: "src/features/redesign/surfaces/ChatSurface.tsx",
    terms: ["Run on a list", "Multiply", "Compare across list", "Batch", "UniversalComposer"],
  },
  {
    id: "reports_surface",
    file: "src/features/redesign/surfaces/ReportsSurface.tsx",
    terms: ["Brief", "Explore", "Chat", "style", "density", "Bulk", "universe"],
  },
  {
    id: "inbox_surface",
    file: "src/features/redesign/surfaces/InboxSurface.tsx",
    terms: ["approval", "confidence", "review", "Captures", "Watchlist", "Batch"],
  },
  {
    id: "me_surface",
    file: "src/features/redesign/surfaces/MeSurface.tsx",
    terms: ["Style Profile", "Golden", "Rubric", "Personal Context Notebook", "Accept", "Reject"],
  },
  {
    id: "package_scripts",
    file: "package.json",
    terms: ["qa:redesign", "dogfood:loop", "dogfood:verify", "eval:capability"],
  },
];

function getStatus(required, partial = []) {
  if (required.every(Boolean)) return "pass";
  if ([...required, ...partial].some(Boolean)) return "partial";
  return "fail";
}

async function readText(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

function contextFor(text, term) {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((line) => line.toLowerCase().includes(term.toLowerCase()));
  if (idx < 0) return "";
  const start = Math.max(0, idx - 1);
  const end = Math.min(lines.length, idx + 2);
  return lines.slice(start, end).map((line, offset) => `${start + offset + 1}: ${line}`).join("\n");
}

async function gatherEvidence() {
  const evidence = {};
  for (const spec of evidenceFiles) {
    const text = await readText(spec.file);
    const matches = {};
    const snippets = [];
    for (const term of spec.terms) {
      const matched = text.toLowerCase().includes(term.toLowerCase());
      matches[term] = matched;
      if (matched) snippets.push(`MATCH ${term}\n${contextFor(text, term)}`);
    }
    evidence[spec.id] = {
      file: spec.file,
      exists: text.length > 0,
      matches,
      matchedCount: Object.values(matches).filter(Boolean).length,
      totalCount: spec.terms.length,
      snippets,
    };
  }
  return evidence;
}

function has(evidence, id, term) {
  return evidence[id]?.matches?.[term] === true;
}

function buildCriteria(evidence) {
  const c = [];
  const add = (id, label, required, partial, fix, evidenceText) => {
    const status = getStatus(required, partial);
    c.push({
      id,
      label,
      status,
      requiredPassed: required.filter(Boolean).length,
      requiredTotal: required.length,
      fix: status === "pass" ? "" : fix,
      evidence: evidenceText,
    });
  };

  add(
    "style_profile",
    "Style Profile is durable and visible",
    [
      has(evidence, "operator_profile", "operatorProfiles"),
      has(evidence, "operator_manifest", "StyleProfileManifest"),
      has(evidence, "redesign_style_profile", "styleProfiles"),
    ],
    [has(evidence, "me_surface", "Style Profile")],
    "Promote memoStyles/user.inferred into a persisted styleProfile or style.skill.md runtime object with version/provenance.",
    ["operatorProfile domain", "operator manifest", "Me surface style card"],
  );
  add(
    "golden_set",
    "Golden Set examples can drive private style extraction",
    [
      has(evidence, "operator_manifest", "GoldenSetArtifact"),
      has(evidence, "operator_manifest", "Golden Set"),
      has(evidence, "redesign_style_profile", "provenance"),
    ],
    [has(evidence, "style_fixtures", "memoStyles")],
    "Add Golden Set backend tables or fields for uploaded examples, extraction confidence, provenance, and accept/edit flow.",
    ["operator manifest Golden Set contract", "extraction confidence/provenance"],
  );
  add(
    "rubric_library",
    "Rubric Library is modeled separately from prose style",
    [
      has(evidence, "operator_manifest", "RubricDefinition"),
      has(evidence, "operator_manifest", "Rubric Library"),
      has(evidence, "redesign_universes", "rubric"),
    ],
    [has(evidence, "reports_surface", "style")],
    "Add a rubric library contract with sections, required fields, source rules, scoring dimensions, and styleProfile separation.",
    ["operator manifest Rubric Library contract", "rubric sections/source rules/scoring dimensions"],
  );
  add(
    "universe",
    "Universe entity lists are first-class",
    [has(evidence, "redesign_universes", "redesignUniverses"), has(evidence, "redesign_universes", "entityIds")],
    [has(evidence, "root_schema", "researchJobs")],
    "Add explicit universe objects or normalize productEventWorkspaces into reusable coverage universes with entity membership and status counts.",
    ["Reports surface universe string", "productEventWorkspaces"],
  );
  add(
    "batch_run",
    "Batch Run applies one prompt/rubric/style across many entities",
    [
      has(evidence, "batch_autopilot", "batch"),
      has(evidence, "root_schema", "researchJobs"),
      has(evidence, "operator_manifest", "redesign.s5.v1"),
    ],
    [has(evidence, "chat_surface", "Batch")],
    "Add BatchRun runtime contract with universeId, styleProfileId, rubricId, sourcePolicy, QA thresholds, live counts, kill switch.",
    ["batchAutopilot", "productEventRunRecords", "researchJobs"],
  );
  add(
    "review_queue",
    "Review Queue triages batch outputs by reason",
    [
      has(evidence, "product_schema", "productClaimReviews"),
      has(evidence, "inbox_surface", "review"),
      has(evidence, "redesign_document_patches", "redesignDocumentPatches"),
    ],
    [has(evidence, "product_schema", "productNudges")],
    "Add review item reason taxonomy for weak_source, style_mismatch, missing_field, low_confidence, approval_required.",
    ["productClaimReviews", "Inbox review/confidence"],
  );
  add(
    "audit_rails",
    "Audit rails cover claims, evidence, citations, approvals, budget",
    [
      has(evidence, "product_schema", "productClaims"),
      has(evidence, "product_schema", "productClaimSupports"),
      has(evidence, "deterministic_judge", "capturedSources"),
      has(evidence, "agent_judge", "budgetRespected"),
    ],
    [has(evidence, "root_schema", "userBudgets"), has(evidence, "llm_judge", "scoreVerdictWithLlm")],
    "Tie style/universe/batch outputs into existing claim/evidence/judge/budget ledgers with per-run audit ids.",
    ["claims/supports", "diligence judge", "agent budget judge"],
  );
  add(
    "reports_coverage",
    "Reports act as coverage library with claims and exports",
    [has(evidence, "product_schema", "productReports"), has(evidence, "product_schema", "productReportExports"), has(evidence, "reports_surface", "Brief")],
    [has(evidence, "product_schema", "notebookHtml")],
    "Add universe grouping and style chip metadata on durable reports, not only fixture cards.",
    ["productReports", "exports", "Brief/Explore/Chat"],
  );
  add(
    "chat_multiply",
    "Chat can multiply a single prompt across a list",
    [
      has(evidence, "operator_manifest", "ChatMultiplyHandoff"),
      has(evidence, "operator_manifest", "Run on a list"),
      has(evidence, "operator_manifest", "redesign.s5.v1"),
    ],
    [has(evidence, "chat_surface", "Compare across list"), has(evidence, "chat_surface", "UniversalComposer")],
    "Expose chat-to-batch handoff in runtime: prompt + style + current entity -> sample 3 -> full batch.",
    ["operator manifest chat-to-batch handoff"],
  );
  add(
    "inbox_review",
    "Inbox owns uncertainty, approvals, and batch-output review",
    [has(evidence, "inbox_surface", "approval"), has(evidence, "inbox_surface", "confidence"), has(evidence, "product_schema", "productClaimReviews")],
    [has(evidence, "inbox_surface", "Batch")],
    "Add batch-output review lane and keyboard/bulk actions to the durable inbox source.",
    ["Inbox approval/confidence", "productClaimReviews"],
  );
  add(
    "me_manifest",
    "Me owns style, Golden Set, rubrics, editable memory",
    [
      has(evidence, "operator_manifest", "StyleProfileManifest"),
      has(evidence, "operator_manifest", "GoldenSetArtifact"),
      has(evidence, "operator_manifest", "RubricDefinition"),
      has(evidence, "operator_manifest", "Personal Context Notebook"),
    ],
    [has(evidence, "operator_profile", "markdown")],
    "Wire Me manifest sections to backend profile/style/rubric/golden-set persistence and audit-safe patch proposals.",
    ["operator manifest contracts", "operatorProfile markdown"],
  );
  add(
    "home_states",
    "Home distinguishes new visitor gallery from repeat command center",
    [has(evidence, "home_surface", "Style"), has(evidence, "home_surface", "continueWorking"), has(evidence, "home_surface", "watchlist")],
    [has(evidence, "home_surface", "memoryPulse")],
    "Add explicit first-visit vs repeat-visitor state gate backed by localStorage plus user lastSeenAt.",
    ["Home style/watchlist/continueWorking"],
  );
  add(
    "public_styles",
    "Six public starter styles are present",
    [
      has(evidence, "style_fixtures", "gs.banker.brief"),
      has(evidence, "style_fixtures", "yc.investor.memo"),
      has(evidence, "style_fixtures", "stratechery.analysis"),
      has(evidence, "style_fixtures", "bessemer.scorecard"),
      has(evidence, "style_fixtures", "buffett.plainenglish"),
      has(evidence, "style_fixtures", "firstround.casestudy"),
    ],
    [has(evidence, "style_fixtures", "memoStyles")],
    "Move style fixtures into a reusable public style registry with source metadata and generation contract.",
    ["Six style ids in fixtures"],
  );
  add(
    "style_inference",
    "Style inference has backend policy and acceptance loop",
    [
      has(evidence, "style_fixtures", "inferredStyleProvenance"),
      has(evidence, "redesign_style_profile", "upsert"),
      has(evidence, "redesign_style_profile", "setActive"),
    ],
    [has(evidence, "operator_profile", "parse")],
    "Add opt-in style inference action that samples uploads/conversations, proposes style.skill.md diff, and requires accept/edit/pin for sensitive changes.",
    ["inferredStyleProvenance", "Accept/Reject UI evidence"],
  );
  add(
    "qa_fix_loop",
    "Real judge plus fix-loop workflow exists",
    [
      has(evidence, "llm_judge", "scoreVerdictWithLlm"),
      has(evidence, "agent_judge", "judgeAgentRun"),
      has(evidence, "package_scripts", "dogfood:loop"),
      has(evidence, "root_schema", "dogfoodFixAttempts"),
    ],
    [has(evidence, "package_scripts", "qa:redesign")],
    "Add this multiple-me backend QA harness to package scripts once external LLM execution is approved, and persist runs if needed.",
    ["LLM judge", "agent judge", "dogfood loop", "fix attempts"],
  );

  return c;
}

function makeBacklog(criteria) {
  return criteria
    .filter((item) => item.status !== "pass")
    .map((item) => {
      const priority = item.status === "fail" ? "p0" : "p1";
      const ownerSurface = ["style_profile", "golden_set", "rubric_library", "style_inference"].includes(item.id)
        ? "backend"
        : ["chat_multiply", "home_states"].includes(item.id)
          ? "agent"
          : "database";
      return {
        priority,
        title: `Close ${item.id}: ${item.label}`,
        ownerSurface,
        fix: item.fix,
        acceptanceCriteria: [
          `${item.id} has a durable runtime object or explicit adapter, not only fixture copy`,
          `The local QA criterion for ${item.id} returns pass`,
          `The change has a targeted test or deterministic script assertion`,
        ],
      };
    });
}

function renderMarkdown({ criteria, evidence, backlog, gitStatus }) {
  const pass = criteria.filter((c) => c.status === "pass").length;
  const partial = criteria.filter((c) => c.status === "partial").length;
  const fail = criteria.filter((c) => c.status === "fail").length;
  const score = Math.round((pass + partial * 0.5) / criteria.length * 100);
  const lines = [];
  lines.push("# Multiple-Me Agent QA - Local Safe Pass");
  lines.push("");
  lines.push("External Gemini judge execution was blocked by sandbox review because it would send repository-derived evidence to an external model. This report is the local deterministic fallback.");
  lines.push("");
  lines.push(`Score: **${score}/100**`);
  lines.push(`Criteria: ${pass} pass, ${partial} partial, ${fail} fail`);
  lines.push("");
  lines.push("## Criteria");
  lines.push("");
  lines.push("| Criterion | Status | Evidence | Fix |");
  lines.push("|---|---:|---|---|");
  for (const item of criteria) {
    lines.push(`| ${item.id} | ${item.status} | ${item.evidence.join("<br>")} | ${item.fix || "-"} |`);
  }
  lines.push("");
  lines.push("## Fix Loop Backlog");
  lines.push("");
  for (const item of backlog) {
    lines.push(`### ${item.priority.toUpperCase()} - ${item.title}`);
    lines.push(`Owner: ${item.ownerSurface}`);
    lines.push("");
    lines.push(item.fix);
    lines.push("");
    lines.push("Acceptance:");
    for (const ac of item.acceptanceCriteria) lines.push(`- ${ac}`);
    lines.push("");
  }
  lines.push("## Evidence Summary");
  lines.push("");
  for (const [id, item] of Object.entries(evidence)) {
    lines.push(`- ${id}: \`${item.file}\` - ${item.matchedCount}/${item.totalCount} terms`);
  }
  lines.push("");
  lines.push("## Git Status");
  lines.push("");
  lines.push("```text");
  lines.push(gitStatus || "(clean)");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const evidence = await gatherEvidence();
  const criteria = buildCriteria(evidence);
  const backlog = makeBacklog(criteria);
  const git = spawnSync("git", ["status", "--short", "--branch"], { encoding: "utf8", shell: true });
  const gitStatus = git.error
    ? `git status unavailable: ${git.error.message}`
    : (git.stdout || git.stderr || "").trim();
  const pass = criteria.filter((c) => c.status === "pass").length;
  const partial = criteria.filter((c) => c.status === "partial").length;
  const fail = criteria.filter((c) => c.status === "fail").length;
  const score = Math.round((pass + partial * 0.5) / criteria.length * 100);
  const result = {
    generatedAt: new Date().toISOString(),
    externalLlmJudge: {
      attempted: true,
      blocked: true,
      reason: "Sandbox reviewer denied external Gemini execution because repository-derived evidence would leave the workspace.",
    },
    score,
    counts: { pass, partial, fail },
    criteria,
    backlog,
    evidence,
    gitStatus,
  };
  await fs.writeFile(path.join(outDir, "results.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "findings.md"), renderMarkdown({ criteria, evidence, backlog, gitStatus }), "utf8");
  console.log(`Multiple-me local QA: ${score}/100 (${pass} pass, ${partial} partial, ${fail} fail)`);
  console.log(`Findings: ${path.join(outDir, "findings.md")}`);
  console.log(`JSON: ${path.join(outDir, "results.json")}`);
  if (fail > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
