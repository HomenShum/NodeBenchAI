/**
 * Real PDF extractors — production-grade replacements for the demo fixtures.
 *
 * Pattern: Claude / Gemini accept PDFs as document input directly, so we
 * skip the parse-text-then-prompt pipeline entirely. The PDF goes in,
 * structured JSON comes out. The model is constrained by an explicit
 * field schema and instructed never to fabricate values — if it can't
 * find a number, it returns null with confidence 0.
 *
 * Math runs in JS sandbox after extraction (sandbox.ts), per the
 * scratchpad-first invariant in .claude/rules/scratchpad_first.md.
 *
 * IMPORTANT: this is the production path. Fixtures (attFixture.ts etc)
 * remain as the deterministic demo path. The orchestrator can call
 * either one without changing its step-emission pattern.
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import Anthropic from "@anthropic-ai/sdk";

import {
  computeAfterTaxCostOfDebt,
  computeETR,
} from "./sandbox";
import { validateExtraction, type FieldSpec } from "./validators";
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

const STEP_PACING_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_PDF_BYTES = 20 * 1024 * 1024; // BOUND_READ — 20MB cap

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

interface ClaudeExtractedField {
  fieldName: string;
  value: number | null;
  unit: string;
  sourceRef: string;     // "10-K p.72" or similar
  excerpt: string;       // verbatim quote anchoring the value
  confidence: number;    // 0..1, model-reported
  notes?: string;
}

interface ClaudeExtractionResponse {
  fields: ClaudeExtractedField[];
  unresolvedFields: string[];
  modelConfidenceOverall: number;
}

const SYSTEM_PROMPT = `You extract financial values from SEC filings (10-K, 10-Q) for a deterministic operator console.

RULES:
1. NEVER fabricate or guess. If a value is not explicitly in the document, return null with confidence 0 and add it to unresolvedFields.
2. NEVER do math. Return raw values only. Effective tax rates and cost of debt are computed downstream in a JS sandbox.
3. Always cite the page number and a short verbatim excerpt for every value.
4. Confidence reflects how clearly the value is stated. 0.95+ = exact match in a labeled row. 0.70-0.94 = present but ambiguous unit/period. <0.70 = uncertain.
5. Units: report income statement values in USD_millions (e.g. 22450 means $22.45B). Report rates as decimal (e.g. 0.0542 for 5.42%).
6. Output JSON ONLY. No prose.`;

const FIELD_SCHEMA = `{
  "fields": [
    {
      "fieldName": string,            // Must match one of: ${TAX_AND_DEBT_SPEC.map((s) => JSON.stringify(s.fieldName)).join(", ")}
      "value": number | null,
      "unit": "USD_millions" | "decimal",
      "sourceRef": string,            // e.g. "10-K p.72"
      "excerpt": string,              // verbatim quote, max 200 chars
      "confidence": number,           // 0..1
      "notes": string | null
    }
  ],
  "unresolvedFields": string[],
  "modelConfidenceOverall": number
}`;

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY not configured for the Convex deployment. Set it via `npx convex env set ANTHROPIC_API_KEY ...`.",
    );
  }
  return key;
}

/**
 * Extract tax-and-debt inputs from a PDF stored in Convex `_storage`.
 *
 * Returns ExtractedField[] in the SAME shape the fixture extractor
 * returns, so the orchestrator can call either path without branching.
 */
async function extractTaxAndDebtFromPdf(
  pdfBase64: string,
): Promise<{
  fields: ExtractedField[];
  modelConfidenceOverall: number;
  unresolvedFields: string[];
}> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: `Extract these fields and return JSON in exactly this shape:\n${FIELD_SCHEMA}\n\nFields to extract:\n${TAX_AND_DEBT_SPEC.map((s) => `- ${s.fieldName} (${s.expectedUnit})`).join("\n")}`,
          },
        ],
      },
    ],
  });

  // Parse JSON from the first text block. Claude with system instruction
  // "Output JSON ONLY" returns a single text block with the JSON.
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude response had no text block");
  }
  const jsonText = block.text.trim();
  // Defensive: strip code fences if present.
  const cleaned = jsonText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: ClaudeExtractionResponse;
  try {
    parsed = JSON.parse(cleaned) as ClaudeExtractionResponse;
  } catch (e) {
    throw new Error(
      `Claude returned non-JSON (HONEST_STATUS — better to fail than fabricate). First 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }

  // Map Claude's response to our ExtractedField shape, classifying status.
  const fields: ExtractedField[] = parsed.fields.map((f) => ({
    fieldName: f.fieldName,
    value: f.value,
    unit: f.unit,
    sourceRef: f.sourceRef,
    confidence: typeof f.confidence === "number" ? f.confidence : 0,
    status:
      f.value === null
        ? "unresolved"
        : f.confidence >= 0.9
          ? "verified"
          : f.confidence >= 0.5
            ? "needs_review"
            : "unresolved",
    reviewNote: f.notes ?? undefined,
  }));

  return {
    fields,
    modelConfidenceOverall: parsed.modelConfidenceOverall ?? 0,
    unresolvedFields: parsed.unresolvedFields ?? [],
  };
}

/**
 * End-to-end real run: takes a PDF storageId, runs Claude extraction,
 * validates, computes in sandbox, emits the same typed step stream as
 * the fixture demo. This is the production path.
 *
 * Caller flow (typical): user uploads PDF → file goes to Convex
 * `_storage` → caller passes the resulting `Id<"_storage">` here.
 */
export const runRealCostOfDebtFromPdf = action({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
    pdfStorageId: v.id("_storage"),
    pdfFileName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"financialOperatorRuns"> }> => {
    const fileName = args.pdfFileName ?? "uploaded.pdf";
    const goal = `Extract ETR + after-tax cost of debt from ${fileName} (real PDF, Claude extraction, sandbox compute).`;

    // 1. Create run
    const runId: Id<"financialOperatorRuns"> = await ctx.runMutation(
      api.domains.financialOperator.runOps.createRun,
      {
        userId: args.userId,
        threadId: args.threadId,
        taskType: "financial_metric_extraction",
        goal,
        files: [{ name: fileName, kind: "pdf" }],
        totalSteps: 7,
      },
    );

    // 2. Plan
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
          "Fetch uploaded PDF from storage",
          "Send PDF to Claude with structured extraction schema",
          "Validate extracted fields (schema + units + range)",
          "Compute ETR + after-tax cost of debt in JS sandbox",
          "Surface source excerpts as evidence",
          "Emit a notebook artifact + reviewer summary",
        ],
        outputFormat: "Reviewable notebook + sandbox-locked calculation",
      } satisfies RunBriefPayload,
    });

    await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
      runId,
      status: "running",
    });

    try {
      // 3. Fetch PDF from storage
      await sleep(STEP_PACING_MS);
      const fetchStart = Date.now();
      const pdfBlob = await ctx.storage.get(args.pdfStorageId);
      if (!pdfBlob) {
        throw new Error(`PDF not found in storage: ${args.pdfStorageId}`);
      }
      const pdfBuffer = await pdfBlob.arrayBuffer();
      // BOUND_READ — refuse oversized PDFs to protect the LLM call + memory.
      if (pdfBuffer.byteLength > MAX_PDF_BYTES) {
        throw new Error(
          `PDF too large: ${pdfBuffer.byteLength} bytes (max ${MAX_PDF_BYTES}). Crop to the relevant sections first.`,
        );
      }
      const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "tool_call",
        status: "complete",
        title: "Fetch PDF from storage",
        payload: {
          toolName: "convex.storage.get",
          inputSummary: `storageId=${args.pdfStorageId}`,
          outputSummary: `${pdfBuffer.byteLength.toLocaleString()} bytes`,
        } satisfies ToolCallPayload,
        durationMs: Date.now() - fetchStart,
      });

      // 4. Extraction via Claude
      await sleep(STEP_PACING_MS);
      const extractStart = Date.now();
      const { fields, modelConfidenceOverall, unresolvedFields } =
        await extractTaxAndDebtFromPdf(pdfBase64);
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "tool_call",
        status: "complete",
        title: "Claude PDF extraction",
        payload: {
          toolName: "anthropic.messages.create (PDF input)",
          inputSummary: `${TAX_AND_DEBT_SPEC.length} target fields, structured-JSON schema`,
          outputSummary: `${fields.length} fields returned; overall confidence ${modelConfidenceOverall.toFixed(2)}; ${unresolvedFields.length} unresolved`,
        } satisfies ToolCallPayload,
        durationMs: Date.now() - extractStart,
      });

      const extractionPayload: ExtractionPayload = {
        schemaName: "tax_and_debt_inputs",
        fields,
        totalFound: fields.length,
        needsReviewCount: fields.filter((f) => f.status === "needs_review").length,
      };
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "extraction",
        status:
          extractionPayload.needsReviewCount > 0
            ? "needs_review"
            : fields.some((f) => f.status === "unresolved")
              ? "error"
              : "complete",
        title: "Extracted values",
        payload: extractionPayload,
      });

      // 5. Validation
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
        title: "Validate extraction",
        payload: validationPayload,
      });
      if (!validation.schemaPassed) {
        await ctx.runMutation(
          api.domains.financialOperator.runOps.updateRunStatus,
          {
            runId,
            status: "awaiting_approval",
          },
        );
        await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
          runId,
          kind: "approval_request",
          status: "pending",
          title: "Required fields missing — operator review",
          payload: {
            question: "Required fields could not be extracted. How should we proceed?",
            context: `Unresolved: ${unresolvedFields.join(", ") || "—"}. Sandbox cannot compute without these inputs.`,
            options: [
              { id: "narrow", label: "Re-extract with narrower section hints", description: "Re-prompt Claude with explicit page hints." },
              { id: "override", label: "Manual entry", description: "Operator types the missing values; sandbox compute proceeds." },
              { id: "reject", label: "Mark run failed", description: "No artifact saved." },
            ],
          } satisfies ApprovalRequestPayload,
        });
        return { runId };
      }

      // 6. Sandbox compute
      await sleep(STEP_PACING_MS);
      const ibt = (fields.find((f) => f.fieldName === "Income before income taxes")
        ?.value ?? 0) as number;
      const ite = (fields.find((f) => f.fieldName === "Income tax expense")
        ?.value ?? 0) as number;
      const debtRate = (fields.find((f) => f.fieldName === "Weighted average debt rate")
        ?.value ?? 0) as number;
      const etrR = computeETR({ incomeBeforeTaxes: ibt, incomeTaxExpense: ite });
      const atR = computeAfterTaxCostOfDebt({
        preTaxDebtRate: debtRate,
        effectiveTaxRate: etrR.outputs.etr,
      });
      const calcPayload: CalculationPayload = {
        formulaLabel: "Effective tax rate + after-tax cost of debt",
        formulaText: [etrR.formulaText, atR.formulaText].join("\n"),
        inputs: {
          incomeBeforeTaxes: ibt,
          incomeTaxExpense: ite,
          preTaxDebtRate: debtRate,
        },
        outputs: {
          effectiveTaxRate: etrR.outputs.etr,
          afterTaxCostOfDebt: atR.outputs.afterTaxCostOfDebt,
        },
        formattedOutputs: {
          effectiveTaxRate: etrR.formattedOutputs.etr,
          afterTaxCostOfDebt: atR.formattedOutputs.afterTaxCostOfDebt,
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

      // 7. Evidence (excerpts already on each ExtractedField via reviewNote / sourceRef)
      await sleep(STEP_PACING_MS);
      const anchors = fields
        .filter((f) => f.value !== null)
        .map((f) => ({
          label: f.fieldName,
          sourceRef: f.sourceRef,
          excerpt: f.reviewNote,
        }));
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

      // 8. Artifact + result
      await sleep(STEP_PACING_MS);
      const artifactPayload: ArtifactPayload = {
        kind: "notebook",
        label: `${fileName.replace(/\.pdf$/i, "")} — After-Tax Cost of Debt`,
        description:
          "Notebook with Claude-extracted inputs, sandbox-locked calculation, source excerpts, and reviewer notes.",
        diffSummary: [
          `Source: ${fileName}`,
          `Extraction: Claude (${fields.length} fields, ${unresolvedFields.length} unresolved)`,
          `Sandbox: deterministic JS (no LLM math)`,
        ],
      };
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "artifact",
        status: "complete",
        title: "Notebook artifact",
        payload: artifactPayload,
      });

      const result: ResultPayload = {
        headline: `${fileName}: ETR ${etrR.formattedOutputs.etr}; after-tax cost of debt ${atR.formattedOutputs.afterTaxCostOfDebt}.`,
        prose:
          "Values were extracted by Claude directly from the uploaded PDF (no intermediate parse). Math ran deterministically in JS sandbox. All values cite the source page; reviewer should verify excerpts before sign-off.",
        metrics: {
          "Effective tax rate": etrR.formattedOutputs.etr,
          "After-tax cost of debt": atR.formattedOutputs.afterTaxCostOfDebt,
          "Model confidence": modelConfidenceOverall.toFixed(2),
        },
        openIssues:
          unresolvedFields.length > 0
            ? [`${unresolvedFields.length} field(s) unresolved by extractor: ${unresolvedFields.join(", ")}`]
            : [],
        nextActions: [
          { id: "open_notebook", label: "Open notebook", kind: "open" },
          { id: "view_sources", label: "View sources", kind: "open" },
          { id: "ask_followup", label: "Ask follow-up", kind: "follow_up" },
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // HONEST_STATUS — surface the failure verbatim, never silently mark complete.
      await ctx.runMutation(api.domains.financialOperator.runOps.appendStep, {
        runId,
        kind: "tool_call",
        status: "error",
        title: "Extraction failed",
        payload: {
          toolName: "anthropic.messages.create (PDF input)",
          inputSummary: "PDF + structured-JSON schema",
          outputSummary: "—",
        } satisfies ToolCallPayload,
        errorMessage: msg,
      });
      await ctx.runMutation(api.domains.financialOperator.runOps.updateRunStatus, {
        runId,
        status: "error",
        errorMessage: msg,
      });
      return { runId };
    }
  },
});
