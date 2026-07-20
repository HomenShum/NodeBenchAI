/**
 * Financial Operator Console — orchestrator.
 *
 * Runs the full chat sequence for a financial workflow:
 *   create run → run_brief → locate sources → extract → validate →
 *   compute (sandbox) → evidence → artifact → approval / result.
 *
 * Each transition is one mutation, so the live query in the UI streams
 * the steps in as they land. Math runs in the deterministic JS sandbox
 * (NOT in the LLM). Sources, confidence, and validation findings are
 * surfaced verbatim — no hidden reasoning, no fake VERIFIED labels.
 *
 * Pattern: orchestrator-workers (Anthropic — Building Effective Agents).
 *   Orchestrator: this action.
 *   Workers: extractors.ts (data acquisition), sandbox.ts (compute),
 *            validators.ts (schema/unit/range checks).
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

import {
  extractTaxAndDebtInputs,
  locateSectionsForTaxAndDebt,
  gatherEvidenceForTaxAndDebt,
} from "./extractors";
import { validateExtraction, type FieldSpec } from "./validators";
import {
  computeETR,
  computeAfterTaxCostOfDebt,
} from "./sandbox";
import type {
  ApprovalRequestPayload,
  ArtifactPayload,
  CalculationPayload,
  EvidencePayload,
  ExtractionPayload,
  ResultPayload,
  RunBriefPayload,
  ToolCallPayload,
  ValidationPayload,
} from "./types";

const STEP_PACING_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TAX_AND_DEBT_SPEC: FieldSpec[] = [
  {
    fieldName: "Income before income taxes",
    expectedUnit: "USD_millions",
    required: true,
    sanityRange: { min: 0, max: 5_000_000 },
  },
  {
    fieldName: "Income tax expense",
    expectedUnit: "USD_millions",
    required: true,
    sanityRange: { min: 0, max: 1_000_000 },
  },
  {
    fieldName: "Weighted average debt rate",
    expectedUnit: "decimal",
    required: true,
    sanityRange: { min: 0, max: 0.5 },
  },
];

/**
 * Demo orchestrator: runs the full AT&T 10-K → ETR + after-tax cost of debt
 * sequence. Returns the runId so the UI can subscribe to its step stream.
 *
 * For the MVP this runs end-to-end with the bundled fixture; future revs
 * can point at a real PDF reader by swapping `extractTaxAndDebtInputs`
 * for an action that reads from the documents domain.
 */
export const runAttCostOfDebtDemo = action({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"financialOperatorRuns"> }> => {
    const goal =
      "Calculate AT&T 2024 effective tax rate and after-tax cost of debt with traceable sources.";

    // 1. Create the run
    const runId: Id<"financialOperatorRuns"> = await ctx.runMutation(
      api.domains.financialOperator.runOps.createRun,
      {
        userId: args.userId,
        threadId: args.threadId,
        taskType: "financial_metric_extraction",
        goal,
        files: [
          { name: "att_10k_2024.pdf", kind: "pdf" },
          { name: "income_statement.png", kind: "image" },
        ],
        totalSteps: 8,
      },
    );

    // 2. Plan
    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "planning",
    });
    const briefPayload: RunBriefPayload = {
      goal,
      numberedSteps: [
        "Locate the relevant filing sections",
        "Extract required financial values into a schema",
        "Validate the inputs (schema, units, sanity range)",
        "Run the calculation in a deterministic sandbox",
        "Verify sources and prepare a reviewable artifact",
      ],
      estimatedDurationMs: 6000,
      outputFormat: "Notebook + source-backed calculation",
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "run_brief",
      status: "complete",
      title: "Plan",
      payload: briefPayload,
    });

    // 3. Run
    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "running",
    });

    // 3a. Locate sections (tool_call card)
    await sleep(STEP_PACING_MS);
    const locateStart = Date.now();
    const sections = locateSectionsForTaxAndDebt();
    const locatePayload: ToolCallPayload = {
      toolName: "document.locate_sections",
      inputSummary:
        "AT&T 10-K, target terms: income before taxes, income tax expense, weighted average debt rate",
      outputSummary: sections
        .map((s) => `${s.label}: page ${s.page}`)
        .join("; "),
      rawArgs: {
        docId: "att_10k_2024.pdf",
        targets: [
          "income before income taxes",
          "income tax expense",
          "weighted average interest rate",
        ],
      },
      rawResult: { sections },
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Locate filing sections",
      payload: locatePayload,
      durationMs: Date.now() - locateStart,
    });

    // 3b. Extract values (tool_call + extraction cards)
    await sleep(STEP_PACING_MS);
    const extractStart = Date.now();
    const { fields } = extractTaxAndDebtInputs();
    const extractToolPayload: ToolCallPayload = {
      toolName: "finance.extract_tax_and_debt_inputs",
      inputSummary: "Read sections p.72 (income statement) + p.118 (debt footnote)",
      outputSummary: `${fields.length} fields extracted, ${fields.filter((f) => f.status === "needs_review").length} flagged for review`,
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "tool_call",
      status: "complete",
      title: "Extract financial inputs",
      payload: extractToolPayload,
      durationMs: Date.now() - extractStart,
    });

    await sleep(STEP_PACING_MS);
    const extractionPayload: ExtractionPayload = {
      schemaName: "tax_and_debt_inputs",
      fields,
      totalFound: fields.length,
      needsReviewCount: fields.filter((f) => f.status === "needs_review").length,
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "extraction",
      status: extractionPayload.needsReviewCount > 0 ? "needs_review" : "complete",
      title: "Extracted values",
      payload: extractionPayload,
    });

    // 3c. Validate
    await sleep(STEP_PACING_MS);
    const validation = validateExtraction({
      fields,
      spec: TAX_AND_DEBT_SPEC,
    });
    const validationPayload: ValidationPayload = {
      schemaPassed: validation.schemaPassed,
      unitsNormalized: validation.unitsNormalized,
      findings: validation.findings,
      checksRun: validation.checksRun,
      checksPassed: validation.checksPassed,
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "validation",
      status: validation.schemaPassed ? "complete" : "error",
      title: "Validate inputs",
      payload: validationPayload,
    });

    // 3d. Compute (deterministic sandbox)
    await sleep(STEP_PACING_MS);
    const ibt = (fields.find((f) => f.fieldName === "Income before income taxes")
      ?.value ?? 0) as number;
    const ite = (fields.find((f) => f.fieldName === "Income tax expense")
      ?.value ?? 0) as number;
    const debtRate = (fields.find((f) => f.fieldName === "Weighted average debt rate")
      ?.value ?? 0) as number;

    const etrResult = computeETR({
      incomeBeforeTaxes: ibt,
      incomeTaxExpense: ite,
    });
    const afterTaxResult = computeAfterTaxCostOfDebt({
      preTaxDebtRate: debtRate,
      effectiveTaxRate: etrResult.outputs.etr,
    });

    const calcPayload: CalculationPayload = {
      formulaLabel: "Effective tax rate + after-tax cost of debt",
      formulaText: [etrResult.formulaText, afterTaxResult.formulaText].join("\n"),
      inputs: {
        incomeBeforeTaxes: ibt,
        incomeTaxExpense: ite,
        preTaxDebtRate: debtRate,
      },
      outputs: {
        effectiveTaxRate: etrResult.outputs.etr,
        afterTaxCostOfDebt: afterTaxResult.outputs.afterTaxCostOfDebt,
      },
      formattedOutputs: {
        effectiveTaxRate: etrResult.formattedOutputs.etr,
        afterTaxCostOfDebt: afterTaxResult.formattedOutputs.afterTaxCostOfDebt,
      },
      sandboxKind: "js_pure",
      computedAt: Date.now(),
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "calculation",
      status: "complete",
      title: "Sandbox calculation",
      payload: calcPayload,
    });

    // 3e. Evidence
    await sleep(STEP_PACING_MS);
    const anchors = gatherEvidenceForTaxAndDebt();
    const evidencePayload: EvidencePayload = {
      anchors,
      totalSources: anchors.length,
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "evidence",
      status: "complete",
      title: "Source anchors",
      payload: evidencePayload,
    });

    // 3f. Artifact (notebook + PR draft)
    await sleep(STEP_PACING_MS);
    const artifactPayload: ArtifactPayload = {
      kind: "notebook",
      label: "AT&T 2024 After-Tax Cost of Debt",
      description:
        "Notebook with extracted inputs, sandbox calculation, source table, and reviewer notes.",
      diffSummary: [
        "Added financial report markdown",
        "Added deterministic calculation script",
        "Added source table",
      ],
    };
    await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
      runId,
      kind: "artifact",
      status: "complete",
      title: "Notebook artifact",
      payload: artifactPayload,
    });

    // 3g. Approval gate (one of the fields needs review → ask user)
    await sleep(STEP_PACING_MS);
    const needsReviewFieldNames = fields
      .filter((f) => f.status === "needs_review")
      .map((f) => f.fieldName);

    if (needsReviewFieldNames.length > 0) {
      const approvalPayload: ApprovalRequestPayload = {
        question: `Approve calculation despite ${needsReviewFieldNames.length} low-confidence input?`,
        context: `Flagged: ${needsReviewFieldNames.join(", ")}. Calculation runs deterministically; approval records who signed off and locks the artifact.`,
        options: [
          { id: "approve", label: "Approve calculation", description: "Lock the notebook and mark this run verified." },
          { id: "narrow", label: "Re-extract debt footnote", description: "Run a tighter extractor over p.118 only." },
          { id: "override", label: "Override with manual value", description: "Replace 5.42% with a user-entered figure." },
          { id: "reject", label: "Reject", description: "Mark this run as failed; no artifact saved." },
        ],
        consequences: {
          approve: "Run status → completed, artifact locked.",
          narrow: "New tool_call step appended; calc re-runs with refined value.",
          override: "Field value replaced; calc re-runs.",
          reject: "Run status → rejected; artifact discarded.",
        },
      };
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "approval_request",
        status: "pending",
        title: "Reviewer approval needed",
        payload: approvalPayload,
      });
      await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
        runId,
        status: "awaiting_approval",
      });
    } else {
      // Happy path — no review flags, finalize directly.
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "result",
        status: "complete",
        title: "Result",
        payload: buildResultPayload(calcPayload),
      });
      await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
        runId,
        status: "completed",
        finalSummary: buildResultPayload(calcPayload).headline,
      });
    }

    return { runId };
  },
});

/**
 * Decision-recorder: applied when the user clicks an approval button.
 * Adds a result/follow-up step and locks the run.
 */
export const recordApprovalDecision = action({
  args: {
    runId: v.id("financialOperatorRuns"),
    stepId: v.id("financialOperatorSteps"),
    optionId: v.union(
      v.literal("approve"),
      v.literal("reject"),
      v.literal("override"),
      v.literal("narrow"),
      v.literal("rerun"),
    ),
  },
  handler: async (ctx, args) => {
    const decisionStatus =
      args.optionId === "approve"
        ? "approved"
        : args.optionId === "reject"
          ? "rejected"
          : "complete";
    await ctx.runMutation(api.domains.financialOperator.runOps.updateStepStatus, {
      stepId: args.stepId,
      status: decisionStatus,
      payloadPatch: { selectedOptionId: args.optionId },
    });

    // Find the calculation step to build a result summary.
    const steps = await ctx.runQuery(
      api.domains.financialOperator.runOps.listSteps,
      { runId: args.runId },
    );
    const calcStep = steps.find((s) => s.kind === "calculation");
    const calcPayload = (calcStep?.payload ?? null) as CalculationPayload | null;

    if (args.optionId === "approve" && calcPayload) {
      const result = buildResultPayload(calcPayload);
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId: args.runId,
        kind: "result",
        status: "complete",
        title: "Result (approved)",
        payload: result,
      });
      await ctx.runMutation(
        api.domains.financialOperator.runOps.updateRunStatus,
        {
          runId: args.runId,
          status: "completed",
          finalSummary: result.headline,
          artifacts: [
            {
              kind: "notebook",
              label: "AT&T 2024 After-Tax Cost of Debt",
            },
          ],
        },
      );
    } else if (args.optionId === "reject") {
      await ctx.runMutation(
        api.domains.financialOperator.runOps.updateRunStatus,
        {
          runId: args.runId,
          status: "rejected",
          finalSummary: "Reviewer rejected — artifact not saved.",
        },
      );
    } else {
      // narrow / override / rerun → in this MVP we just record the decision.
      // A real impl would dispatch a follow-up extractor here.
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId: args.runId,
        kind: "tool_call",
        status: "pending",
        title: `Follow-up requested: ${args.optionId}`,
        payload: {
          toolName: `finance.${args.optionId}_followup`,
          inputSummary: "Queued — implementation pending in this MVP.",
        } satisfies ToolCallPayload,
      });
    }
  },
});

function buildResultPayload(calc: CalculationPayload): ResultPayload {
  return {
    headline: `AT&T 2024 effective tax rate: ${calc.formattedOutputs?.effectiveTaxRate ?? "n/a"}; after-tax cost of debt: ${calc.formattedOutputs?.afterTaxCostOfDebt ?? "n/a"}.`,
    prose:
      "Implied 2024 effective tax rate is computed from income before taxes and income tax expense on the consolidated statement of income. After-tax cost of debt uses the weighted average interest rate from the long-term debt footnote and the computed ETR. All math executed deterministically in a JS sandbox.",
    metrics: {
      "Effective tax rate": String(calc.formattedOutputs?.effectiveTaxRate ?? ""),
      "After-tax cost of debt": String(
        calc.formattedOutputs?.afterTaxCostOfDebt ?? "",
      ),
    },
    openIssues: ["Debt-footnote source confidence is below threshold; reviewer note attached."],
    nextActions: [
      { id: "open_notebook", label: "Open notebook", kind: "open" },
      { id: "view_sources", label: "View sources", kind: "open" },
      { id: "export_csv", label: "Export CSV", kind: "export" },
      { id: "ask_followup", label: "Ask follow-up", kind: "follow_up" },
    ],
  };
}
