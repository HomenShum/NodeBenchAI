/**
 * Orchestrator actions for Examples B, C, D from the operator-console spec:
 *
 *   B — CRM cleanup (financial_data_cleanup)
 *   C — Covenant compliance (covenant_compliance)
 *   D — Variance analysis (variance_analysis)
 *
 * All three use the same shared backbone (runOps + sandbox + validators)
 * established in orchestrator.ts and types.ts. Math runs in JS sandbox,
 * sources ride along on every extracted field, validations surface
 * findings verbatim — same invariants as the AT&T example.
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

import {
  computeLeverageRatio,
  checkCompliance,
  computeVariance,
} from "./sandbox";
import { validateExtraction, type FieldSpec } from "./validators";
import { CRM_FIXTURE } from "./fixtures/crmFixture";
import { COVENANT_FIXTURE } from "./fixtures/covenantFixture";
import { VARIANCE_FIXTURE } from "./fixtures/varianceFixture";
import type {
  ApprovalRequestPayload,
  ArtifactPayload,
  CalculationPayload,
  EvidencePayload,
  ExtractedField,
  ExtractionPayload,
  ResultPayload,
  RunBriefPayload,
  ToolCallPayload,
  ValidationPayload,
} from "./types";

const STEP_PACING_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classifyStatus(
  confidence: number,
): ExtractedField["status"] {
  if (confidence >= 0.9) return "verified";
  if (confidence >= 0.5) return "needs_review";
  return "unresolved";
}

/* ================================================================== */
/* EXAMPLE B — CRM CLEANUP                                            */
/* ================================================================== */

export const runCrmCleanupDemo = action({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"financialOperatorRuns"> }> => {
    const goal =
      "Clean and dedupe a 387-row prospect list, enrich with sector/HQ/last round, and export CRM-ready CSV.";

    const runId: Id<"financialOperatorRuns"> = await ctx.runMutation(
      api.domains.financialOperator.runOps.createRun,
      {
        userId: args.userId,
        threadId: args.threadId,
        taskType: "financial_data_cleanup",
        goal,
        files: CRM_FIXTURE.meta.files.map((f) => ({ name: f.name, kind: f.kind })),
        totalSteps: 9,
      },
    );

    // 1. Plan
    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "planning",
    });
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "run_brief",
      status: "complete",
      title: "Plan",
      payload: {
        goal,
        numberedSteps: [
          "Inspect files (1 spreadsheet + 3 PDFs)",
          "Profile spreadsheet schema",
          "Extract company mentions from PDFs",
          "Resolve duplicates",
          "Enrich missing fields",
          "Validate CRM CSV schema",
          "Export CSV",
        ],
        estimatedDurationMs: 5000,
        outputFormat: "CRM-ready CSV + low-confidence review queue",
      } satisfies RunBriefPayload,
    });

    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "running",
    });

    // 2. Inspect files
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Inspect uploaded files",
      payload: {
        toolName: "files.inspect",
        inputSummary: "1 spreadsheet (3 sheets) + 3 investor PDFs (86 pages)",
        outputSummary: `Sheets: ${CRM_FIXTURE.meta.spreadsheetSheets.join(", ")} · ${CRM_FIXTURE.entityExtraction.companiesFound} company mentions detected`,
      } satisfies ToolCallPayload,
    });

    // 3. Profile spreadsheet
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Profile spreadsheet schema",
      payload: {
        toolName: "spreadsheet.profile",
        inputSummary: "prospects.xlsx → Raw Leads sheet",
        outputSummary: `${CRM_FIXTURE.profile.rowCount} rows; missing fields: ${CRM_FIXTURE.profile.missingFields.join(", ")}`,
      } satisfies ToolCallPayload,
    });

    // 4. Extract entities from PDFs
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Extract company mentions from PDFs",
      payload: {
        toolName: "document.extract_entities",
        inputSummary: "3 investor packets (86 pages)",
        outputSummary: `${CRM_FIXTURE.entityExtraction.companiesFound} companies, ${CRM_FIXTURE.entityExtraction.fundingEventsFound} funding events, ${CRM_FIXTURE.entityExtraction.locationsFound} locations`,
      } satisfies ToolCallPayload,
    });

    // 5. Dedup → extraction card showing merge groups
    await sleep(STEP_PACING_MS);
    const dedupFields: ExtractedField[] = CRM_FIXTURE.dedup.mergedExamples.map(
      (m) => ({
        fieldName: m.canonical,
        value: `${m.merged.length} variants merged`,
        unit: "rows",
        sourceRef: `dedup pass — ${m.merged.join(" / ")}`,
        confidence: 0.93,
        status: classifyStatus(0.93),
      }),
    );
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "extraction",
      status: "complete",
      title: "Dedup merge groups",
      payload: {
        schemaName: "company_dedup_groups",
        fields: dedupFields,
        totalFound: CRM_FIXTURE.dedup.mergedExamples.length,
        needsReviewCount: 0,
      } satisfies ExtractionPayload,
    });

    // 6. Calculation: dedup ratio
    await sleep(STEP_PACING_MS);
    const dedupRatio =
      (CRM_FIXTURE.dedup.originalRows - CRM_FIXTURE.dedup.dedupedRows) /
      CRM_FIXTURE.dedup.originalRows;
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "calculation",
      status: "complete",
      title: "Dedup ratio",
      payload: {
        formulaLabel: "Duplicate-row reduction",
        formulaText:
          "dedup_ratio = (original_rows - deduped_rows) / original_rows",
        inputs: {
          originalRows: CRM_FIXTURE.dedup.originalRows,
          dedupedRows: CRM_FIXTURE.dedup.dedupedRows,
        },
        outputs: { dedupRatio, mergedRows: CRM_FIXTURE.dedup.originalRows - CRM_FIXTURE.dedup.dedupedRows },
        formattedOutputs: {
          dedupRatio: `${(dedupRatio * 100).toFixed(1)}%`,
          mergedRows: `${CRM_FIXTURE.dedup.originalRows - CRM_FIXTURE.dedup.dedupedRows} rows`,
        },
        sandboxKind: "js_pure",
        computedAt: Date.now(),
      } satisfies CalculationPayload,
    });

    // 7. Enrichment → extraction card
    await sleep(STEP_PACING_MS);
    const enrichmentFields: ExtractedField[] =
      CRM_FIXTURE.enrichment.sampleEnriched.map((e) => ({
        fieldName: e.company,
        value: `${e.sector} · ${e.hq} · ${e.lastRound}`,
        unit: "company_profile",
        sourceRef: "company.enrich_profile",
        confidence: 0.91,
        status: classifyStatus(0.91),
      }));
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "extraction",
      status: "needs_review",
      title: "Enriched company profiles",
      payload: {
        schemaName: "crm_enrichment",
        fields: enrichmentFields,
        totalFound: CRM_FIXTURE.enrichment.recordsUpdated,
        needsReviewCount:
          CRM_FIXTURE.enrichment.lowConfidenceRecords +
          CRM_FIXTURE.enrichment.unresolvedRecords,
      } satisfies ExtractionPayload,
    });

    // 8. Validation
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "validation",
      status: "complete",
      title: "CRM CSV schema",
      payload: {
        schemaPassed: CRM_FIXTURE.csvValidation.failedRows === 0,
        unitsNormalized: true,
        findings: [
          {
            level: "info",
            message: `${CRM_FIXTURE.csvValidation.validRows} rows validated cleanly`,
          },
          {
            level: "warning",
            message: `${CRM_FIXTURE.csvValidation.warningRows} rows exportable with caveats (low-confidence enrichment)`,
          },
        ],
        checksRun:
          CRM_FIXTURE.csvValidation.validRows +
          CRM_FIXTURE.csvValidation.warningRows +
          CRM_FIXTURE.csvValidation.failedRows,
        checksPassed:
          CRM_FIXTURE.csvValidation.validRows +
          CRM_FIXTURE.csvValidation.warningRows,
      } satisfies ValidationPayload,
    });

    // 9. Artifact (CSV)
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "artifact",
      status: "complete",
      title: "CRM-ready CSV",
      payload: {
        kind: "csv",
        label: "crm_ready_company_list.csv",
        description: `${CRM_FIXTURE.dedup.dedupedRows} unique rows after dedup; ${CRM_FIXTURE.enrichment.recordsUpdated} enriched.`,
        diffSummary: [
          `Reduced from ${CRM_FIXTURE.dedup.originalRows} → ${CRM_FIXTURE.dedup.dedupedRows} rows`,
          `Enriched: ${CRM_FIXTURE.enrichment.recordsUpdated}`,
          `Needs review: ${CRM_FIXTURE.enrichment.lowConfidenceRecords + CRM_FIXTURE.enrichment.unresolvedRecords}`,
        ],
      } satisfies ArtifactPayload,
    });

    // 10. Result with low-confidence escape hatch
    await sleep(STEP_PACING_MS);
    const result: ResultPayload = {
      headline: `${CRM_FIXTURE.dedup.dedupedRows} CRM-ready rows; ${CRM_FIXTURE.enrichment.lowConfidenceRecords + CRM_FIXTURE.enrichment.unresolvedRecords} flagged for review.`,
      prose:
        "Dedup merged duplicate company variants by domain + name similarity. Enrichment added sector, HQ, and last funding round per record. The low-confidence subset is exportable but should be sampled before being trusted in outreach.",
      metrics: {
        "Final rows": String(CRM_FIXTURE.dedup.dedupedRows),
        "Dedup reduction": `${(dedupRatio * 100).toFixed(1)}%`,
        "Needs review": String(
          CRM_FIXTURE.enrichment.lowConfidenceRecords +
            CRM_FIXTURE.enrichment.unresolvedRecords,
        ),
      },
      openIssues: [
        `${CRM_FIXTURE.enrichment.unresolvedRecords} companies could not be enriched and need manual investigation.`,
      ],
      nextActions: [
        { id: "download_csv", label: "Download CSV", kind: "export" },
        { id: "review_low_conf", label: "Review low-confidence rows", kind: "open" },
        { id: "save_to_crm", label: "Save to CRM", kind: "approve" },
      ],
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "result",
      status: "complete",
      title: "Result",
      payload: result,
    });
    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "completed",
      finalSummary: result.headline,
    });

    return { runId };
  },
});

/* ================================================================== */
/* EXAMPLE C — COVENANT COMPLIANCE                                    */
/* ================================================================== */

const COVENANT_INPUT_SPEC: FieldSpec[] = [
  { fieldName: "Total Debt", expectedUnit: "USD", required: true, sanityRange: { min: 0, max: 1e12 } },
  { fieldName: "Cash", expectedUnit: "USD", required: true, sanityRange: { min: 0, max: 1e12 } },
  { fieldName: "Adjusted EBITDA", expectedUnit: "USD", required: true, sanityRange: { min: 1, max: 1e12 } },
];

export const runCovenantComplianceDemo = action({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"financialOperatorRuns"> }> => {
    const goal = `Check ${COVENANT_FIXTURE.meta.borrower} against the leverage covenant in the credit agreement.`;

    const runId: Id<"financialOperatorRuns"> = await ctx.runMutation(
      api.domains.financialOperator.runOps.createRun,
      {
        userId: args.userId,
        threadId: args.threadId,
        taskType: "covenant_compliance",
        goal,
        files: [
          { name: COVENANT_FIXTURE.meta.creditAgreementFile, kind: "pdf" },
          { name: COVENANT_FIXTURE.meta.financialsFile, kind: "xlsx" },
        ],
        totalSteps: 9,
      },
    );

    // 1. Plan
    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "planning",
    });
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "run_brief",
      status: "complete",
      title: "Plan",
      payload: {
        goal,
        numberedSteps: [
          "Locate covenant + definition sections in credit agreement",
          "Extract covenant threshold and ratio definition",
          "Extract financial inputs from Q4 financials",
          "Validate inputs against covenant definitions",
          "Compute leverage ratio in sandbox",
          "Check compliance against threshold",
          "Produce reviewer-ready compliance memo",
        ],
        estimatedDurationMs: 5500,
        outputFormat: "Compliance memo with verdict + reviewer notes",
      } satisfies RunBriefPayload,
    });

    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "running",
    });

    // 2. Locate sections
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Locate covenant sections",
      payload: {
        toolName: "document.locate_sections",
        inputSummary: `${COVENANT_FIXTURE.meta.creditAgreementFile} → leverage covenant + EBITDA + debt definitions`,
        outputSummary: COVENANT_FIXTURE.sections
          .map((s) => `${s.label} (p.${s.page})`)
          .join("; "),
      } satisfies ToolCallPayload,
    });

    // 3. Extract covenant terms
    await sleep(STEP_PACING_MS);
    const covenantTermsFields: ExtractedField[] = [
      {
        fieldName: "Covenant name",
        value: COVENANT_FIXTURE.covenant.name,
        unit: "string",
        sourceRef: "Credit Agreement p.42",
        confidence: 0.97,
        status: "verified",
      },
      {
        fieldName: "Threshold",
        value: COVENANT_FIXTURE.covenant.threshold,
        unit: "ratio_x",
        sourceRef: "Credit Agreement p.42",
        confidence: 0.97,
        status: "verified",
      },
      {
        fieldName: "Ratio definition",
        value: COVENANT_FIXTURE.covenant.ratioType,
        unit: "string",
        sourceRef: "Credit Agreement p.87 + p.91",
        confidence: 0.93,
        status: "verified",
      },
    ];
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "extraction",
      status: "complete",
      title: "Covenant terms",
      payload: {
        schemaName: "covenant_terms",
        fields: covenantTermsFields,
        totalFound: covenantTermsFields.length,
        needsReviewCount: 0,
      } satisfies ExtractionPayload,
    });

    // 4. Extract financial inputs
    await sleep(STEP_PACING_MS);
    const inputFields: ExtractedField[] = [
      {
        fieldName: "Total Debt",
        value: COVENANT_FIXTURE.inputs.totalDebt.value,
        unit: "USD",
        sourceRef: COVENANT_FIXTURE.inputs.totalDebt.sourceRef,
        confidence: COVENANT_FIXTURE.inputs.totalDebt.confidence,
        status: classifyStatus(COVENANT_FIXTURE.inputs.totalDebt.confidence),
      },
      {
        fieldName: "Cash",
        value: COVENANT_FIXTURE.inputs.cash.value,
        unit: "USD",
        sourceRef: COVENANT_FIXTURE.inputs.cash.sourceRef,
        confidence: COVENANT_FIXTURE.inputs.cash.confidence,
        status: classifyStatus(COVENANT_FIXTURE.inputs.cash.confidence),
      },
      {
        fieldName: "Adjusted EBITDA",
        value: COVENANT_FIXTURE.inputs.adjustedEBITDA.value,
        unit: "USD",
        sourceRef: COVENANT_FIXTURE.inputs.adjustedEBITDA.sourceRef,
        confidence: COVENANT_FIXTURE.inputs.adjustedEBITDA.confidence,
        status: classifyStatus(COVENANT_FIXTURE.inputs.adjustedEBITDA.confidence),
        reviewNote:
          "EBITDA add-backs should be reviewed against the credit agreement's permitted-add-back schedule.",
      },
    ];
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "extraction",
      status: "needs_review",
      title: "Financial inputs",
      payload: {
        schemaName: "covenant_inputs",
        fields: inputFields,
        totalFound: inputFields.length,
        needsReviewCount: inputFields.filter((f) => f.status === "needs_review").length,
      } satisfies ExtractionPayload,
    });

    // 5. Validation
    await sleep(STEP_PACING_MS);
    const validation = validateExtraction({
      fields: inputFields,
      spec: COVENANT_INPUT_SPEC,
    });
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "validation",
      status: validation.schemaPassed ? "complete" : "error",
      title: "Validate covenant inputs",
      payload: validation satisfies ValidationPayload,
    });

    // 6. Compute leverage + compliance check
    await sleep(STEP_PACING_MS);
    const lev = computeLeverageRatio({
      totalDebt: COVENANT_FIXTURE.inputs.totalDebt.value,
      cash: COVENANT_FIXTURE.inputs.cash.value,
      ebitda: COVENANT_FIXTURE.inputs.adjustedEBITDA.value,
    });
    const compliance = checkCompliance({
      observedRatio: lev.outputs.ratio,
      threshold: COVENANT_FIXTURE.covenant.threshold,
      ratioName: "net_leverage",
    });
    const calcPayload: CalculationPayload = {
      formulaLabel: "Net leverage ratio + compliance gate",
      formulaText: [lev.formulaText, compliance.formulaText].join("\n"),
      inputs: {
        totalDebt: COVENANT_FIXTURE.inputs.totalDebt.value,
        cash: COVENANT_FIXTURE.inputs.cash.value,
        ebitda: COVENANT_FIXTURE.inputs.adjustedEBITDA.value,
        threshold: COVENANT_FIXTURE.covenant.threshold,
      },
      outputs: {
        netDebt: lev.outputs.netDebt,
        ratio: lev.outputs.ratio,
        threshold: COVENANT_FIXTURE.covenant.threshold,
        compliant: compliance.outputs.compliant,
        headroom: compliance.outputs.headroom,
      },
      formattedOutputs: {
        netDebt: lev.formattedOutputs.netDebt,
        ratio: lev.formattedOutputs.ratio,
        threshold: `${COVENANT_FIXTURE.covenant.threshold.toFixed(2)}x`,
        compliant: compliance.formattedOutputs.compliant,
        headroom: compliance.formattedOutputs.headroom,
      },
      sandboxKind: "js_pure",
      computedAt: Date.now(),
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "calculation",
      status: "complete",
      title: "Sandbox compute + compliance gate",
      payload: calcPayload,
    });

    // 7. Evidence
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "evidence",
      status: "complete",
      title: "Source anchors",
      payload: {
        anchors: COVENANT_FIXTURE.excerpts.map((e) => ({
          label: COVENANT_FIXTURE.sections.find((s) =>
            e.sourceRef.includes(`p.${s.page}`),
          )?.label ?? "Source",
          sourceRef: e.sourceRef,
          excerpt: e.excerpt,
        })),
        totalSources: COVENANT_FIXTURE.excerpts.length,
      } satisfies EvidencePayload,
    });

    // 8. Artifact
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "artifact",
      status: "complete",
      title: "Compliance memo",
      payload: {
        kind: "memo",
        label: `${COVENANT_FIXTURE.meta.borrower} — Q4 Leverage Covenant Review`,
        description:
          "Memo summarizes compliance verdict, computed ratio, threshold, and review items.",
        diffSummary: [
          `Verdict: ${compliance.outputs.compliant === 1 ? "Compliant" : "Breach"}`,
          `Observed ratio: ${lev.formattedOutputs.ratio} vs ${COVENANT_FIXTURE.covenant.threshold.toFixed(2)}x cap`,
          "Reviewer note: confirm EBITDA add-backs",
        ],
      } satisfies ArtifactPayload,
    });

    // 9. Result OR approval
    await sleep(STEP_PACING_MS);
    const isCompliant = compliance.outputs.compliant === 1;
    if (isCompliant) {
      const result: ResultPayload = {
        headline: `${COVENANT_FIXTURE.meta.borrower} compliant: ${lev.formattedOutputs.ratio} vs ${COVENANT_FIXTURE.covenant.threshold.toFixed(2)}x cap (${compliance.formattedOutputs.headroom} headroom).`,
        prose:
          "Net leverage was computed deterministically from total debt minus unrestricted cash, divided by adjusted EBITDA. EBITDA add-backs require human confirmation before this verdict is locked into the lender package.",
        metrics: {
          "Net debt": lev.formattedOutputs.netDebt,
          "Adjusted EBITDA": `$${(COVENANT_FIXTURE.inputs.adjustedEBITDA.value / 1_000_000).toFixed(1)}M`,
          "Leverage ratio": lev.formattedOutputs.ratio,
          "Covenant threshold": `${COVENANT_FIXTURE.covenant.threshold.toFixed(2)}x`,
          "Verdict": "Compliant",
        },
        openIssues: ["EBITDA add-backs require human confirmation before lender sign-off."],
        nextActions: [
          { id: "open_memo", label: "Open memo", kind: "open" },
          { id: "review_addbacks", label: "Review add-backs", kind: "open" },
          { id: "export_lender_pack", label: "Export lender summary", kind: "export" },
        ],
      };
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "result",
        status: "complete",
        title: "Result — compliant",
        payload: result,
      });
      await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
        runId,
        status: "completed",
        finalSummary: result.headline,
      });
    } else {
      // Breach → ask for explicit reviewer approval before sending notice.
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "approval_request",
        status: "pending",
        title: "Reviewer approval — covenant breach",
        payload: {
          question: "Approve formal breach notice to lender?",
          context: `Net leverage ${lev.formattedOutputs.ratio} exceeds ${COVENANT_FIXTURE.covenant.threshold.toFixed(2)}x cap.`,
          options: [
            { id: "approve", label: "Approve breach notice", description: "Generate lender notification." },
            { id: "narrow", label: "Re-extract EBITDA add-backs", description: "Tighter pass over add-back schedule." },
            { id: "reject", label: "Hold", description: "Do not send notice; leave run as needs_review." },
          ],
          consequences: {
            approve: "Generates lender notification + flags portfolio.",
            narrow: "Re-runs EBITDA extraction; recompute may bring ratio under cap.",
            reject: "Run held in awaiting-approval state.",
          },
        } satisfies ApprovalRequestPayload,
      });
      await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
        runId,
        status: "awaiting_approval",
      });
    }

    return { runId };
  },
});

/* ================================================================== */
/* EXAMPLE D — VARIANCE ANALYSIS                                      */
/* ================================================================== */

export const runVarianceAnalysisDemo = action({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"financialOperatorRuns"> }> => {
    const goal = `Compare ${VARIANCE_FIXTURE.period} actuals vs budget; surface top variances; draft a CFO summary.`;

    const runId: Id<"financialOperatorRuns"> = await ctx.runMutation(
      api.domains.financialOperator.runOps.createRun,
      {
        userId: args.userId,
        threadId: args.threadId,
        taskType: "variance_analysis",
        goal,
        files: VARIANCE_FIXTURE.files.map((f) => ({ name: f.name, kind: f.kind })),
        totalSteps: 8,
      },
    );

    // 1. Plan
    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "planning",
    });
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "run_brief",
      status: "complete",
      title: "Plan",
      payload: {
        goal,
        numberedSteps: [
          "Inspect actuals + budget files",
          "Align chart of accounts",
          "Compute variance per account in sandbox",
          "Surface top favorable and unfavorable lines",
          "Pull qualitative driver context",
          "Draft CFO summary",
        ],
        estimatedDurationMs: 4500,
        outputFormat: "CFO-style variance memo",
      } satisfies RunBriefPayload,
    });

    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "running",
    });

    // 2. Inspect
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Inspect spreadsheets",
      payload: {
        toolName: "spreadsheet.inspect",
        inputSummary: VARIANCE_FIXTURE.files.map((f) => f.name).join(", "),
        outputSummary: `Periods: Jan/Feb/${VARIANCE_FIXTURE.period}; currency USD`,
      } satisfies ToolCallPayload,
    });

    // 3. Align accounts
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Align chart of accounts",
      payload: {
        toolName: "finance.align_accounts",
        inputSummary: "Match by accountName + accountCode",
        outputSummary: `Matched ${VARIANCE_FIXTURE.alignment.matchedAccounts}; ${VARIANCE_FIXTURE.alignment.unmatchedActuals + VARIANCE_FIXTURE.alignment.unmatchedBudget} need mapping review`,
      } satisfies ToolCallPayload,
    });

    // 4. Compute variance per line in sandbox
    await sleep(STEP_PACING_MS);
    const variances = VARIANCE_FIXTURE.lines.map((line) => {
      const r = computeVariance({ actual: line.actual, budget: line.budget });
      return { line, variance: r };
    });
    const topFavorable = variances
      .filter((v) => v.variance.outputs.variance > 0 && v.line.category === "revenue")
      .sort((a, b) => b.variance.outputs.variance - a.variance.outputs.variance)[0];
    const topUnfavorable = variances
      .filter((v) => v.variance.outputs.variance > 0 && v.line.category !== "revenue")
      .sort((a, b) => b.variance.outputs.variance - a.variance.outputs.variance)[0];

    const calcPayload: CalculationPayload = {
      formulaLabel: "Per-account variance",
      formulaText:
        "for each account: variance = actual - budget; variance_pct = variance / budget",
      inputs: { lineCount: VARIANCE_FIXTURE.lines.length },
      outputs: {
        topFavorableAmount: topFavorable?.variance.outputs.variance ?? 0,
        topUnfavorableAmount: topUnfavorable?.variance.outputs.variance ?? 0,
      },
      formattedOutputs: {
        topFavorableAmount: topFavorable?.variance.formattedOutputs.variance ?? "$0",
        topUnfavorableAmount: topUnfavorable?.variance.formattedOutputs.variance ?? "$0",
      },
      sandboxKind: "js_pure",
      computedAt: Date.now(),
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "calculation",
      status: "complete",
      title: "Variance computation",
      payload: calcPayload,
    });

    // 5. Top-variances extraction
    await sleep(STEP_PACING_MS);
    const topLines = [...variances]
      .sort(
        (a, b) =>
          Math.abs(b.variance.outputs.variance) - Math.abs(a.variance.outputs.variance),
      )
      .slice(0, 4);
    const varianceFields: ExtractedField[] = topLines.map((entry) => ({
      fieldName: entry.line.account,
      value: entry.variance.formattedOutputs.variance,
      unit: "USD_signed",
      sourceRef: `march_actuals.xlsx + fy_budget.xlsx (${entry.line.category})`,
      confidence: 0.97,
      status: "verified",
      reviewNote: entry.line.driverNote,
    }));
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "extraction",
      status: "complete",
      title: "Top variance lines",
      payload: {
        schemaName: "top_variance_lines",
        fields: varianceFields,
        totalFound: varianceFields.length,
        needsReviewCount: 0,
      } satisfies ExtractionPayload,
    });

    // 6. Driver search (tool_call)
    await sleep(STEP_PACING_MS);
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Pull driver context from notes",
      payload: {
        toolName: "notes.search_context",
        inputSummary: "Search board_notes + monthly_close_notes for top variance accounts",
        outputSummary: topLines
          .map((l) => `${l.line.account}: ${l.line.driverNote}`)
          .join(" · "),
      } satisfies ToolCallPayload,
    });

    // 7. Artifact (CFO summary)
    await sleep(STEP_PACING_MS);
    const summaryProse = topFavorable && topUnfavorable
      ? `${VARIANCE_FIXTURE.period} revenue finished ahead of budget, primarily driven by ${topFavorable.line.driverNote?.toLowerCase() ?? "favorable revenue mix"}. The main expense pressure came from ${topUnfavorable.line.account.toLowerCase()}, where ${topUnfavorable.line.driverNote?.toLowerCase() ?? "spend exceeded plan"}. Net impact remains favorable; infrastructure usage should be monitored before scaling additional workflows.`
      : "Variance memo drafted from current actuals.";
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "artifact",
      status: "complete",
      title: "CFO variance memo",
      payload: {
        kind: "memo",
        label: `${VARIANCE_FIXTURE.period} Variance Memo`,
        description: summaryProse,
        diffSummary: [
          `Top favorable: ${topFavorable?.line.account ?? "—"} ${topFavorable?.variance.formattedOutputs.variance ?? ""}`,
          `Top unfavorable: ${topUnfavorable?.line.account ?? "—"} ${topUnfavorable?.variance.formattedOutputs.variance ?? ""}`,
          `Unmatched accounts to map: ${VARIANCE_FIXTURE.alignment.unmatchedActuals + VARIANCE_FIXTURE.alignment.unmatchedBudget}`,
        ],
      } satisfies ArtifactPayload,
    });

    // 8. Result
    await sleep(STEP_PACING_MS);
    const result: ResultPayload = {
      headline: `${VARIANCE_FIXTURE.period} variance: revenue ${topFavorable?.variance.formattedOutputs.variance ?? "+$0"}; biggest cost overrun ${topUnfavorable?.line.account ?? "n/a"} (${topUnfavorable?.variance.formattedOutputs.variance ?? ""}).`,
      prose: summaryProse,
      metrics: {
        "Top favorable": topFavorable?.variance.formattedOutputs.variance ?? "$0",
        "Top favorable %": topFavorable?.variance.formattedOutputs.variancePct ?? "0%",
        "Top unfavorable": topUnfavorable?.variance.formattedOutputs.variance ?? "$0",
        "Top unfavorable %": topUnfavorable?.variance.formattedOutputs.variancePct ?? "0%",
      },
      openIssues:
        VARIANCE_FIXTURE.alignment.unmatchedActuals + VARIANCE_FIXTURE.alignment.unmatchedBudget > 0
          ? [`${VARIANCE_FIXTURE.alignment.unmatchedActuals + VARIANCE_FIXTURE.alignment.unmatchedBudget} unmatched accounts need mapping review before this memo is finalized.`]
          : [],
      nextActions: [
        { id: "open_memo", label: "Open variance memo", kind: "open" },
        { id: "review_unmatched", label: "Review unmatched accounts", kind: "open" },
        { id: "export_table", label: "Export variance table", kind: "export" },
        { id: "create_slide", label: "Create board slide", kind: "follow_up" },
      ],
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "result",
      status: "complete",
      title: "Result",
      payload: result,
    });
    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "completed",
      finalSummary: result.headline,
    });

    return { runId };
  },
});
