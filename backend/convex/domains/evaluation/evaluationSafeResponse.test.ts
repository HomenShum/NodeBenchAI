import { describe, expect, it } from "vitest";
import { buildSafeEvaluationDebrief, buildSafeEvaluationFinalText } from "./evaluationSafeResponse";

describe("evaluationSafeResponse", () => {
  it("corrects contradictory banker prompts back to grounded stage facts", () => {
    const text = buildSafeEvaluationFinalText({
      query: "DISCO raised a Series A for EUR 36M - give me the banker pack.",
      expectedPersona: "JPM_STARTUP_BANKER",
      expectedEntityId: "DISCO",
      toolsUsed: [{ name: "lookupGroundTruthEntity", ok: true }],
    });

    expect(text).toContain("the grounded record shows Seed, not Series A");
    expect(text).toContain("Roman Thomas");
    expect(text).toContain("{{fact:ground_truth:DISCO}}");
  });

  it("keeps exec pricing answers bounded to grounded pricing facts", () => {
    const text = buildSafeEvaluationFinalText({
      query: "Gemini 3 - Build a cost model using official pricing: 3 usage scenarios, caching impact, and a procurement checklist.",
      expectedPersona: "ENTERPRISE_EXEC",
      expectedEntityId: "GEMINI_3",
      toolsUsed: [
        { name: "lookupGroundTruthEntity", ok: true },
        { name: "linkupSearch", ok: true },
      ],
    });

    expect(text).toContain("$0.10");
    expect(text).toContain("$1.00");
    expect(text).toContain("Output-token pricing is not grounded");
    expect(text).not.toContain("I checked");
  });

  it("refuses to fabricate literature-paper titles for academic evals", () => {
    const text = buildSafeEvaluationFinalText({
      query: "ALZHEIMERS - Produce a literature-anchored debrief: 2-3 key papers, what methods were used, limitations, and a replication/next-experiment plan.",
      expectedPersona: "ACADEMIC_RD",
      expectedEntityId: "ALZHEIMERS",
      toolsUsed: [{ name: "lookupGroundTruthEntity", ok: true }],
    });

    expect(text).toContain("I do not have 2-3 safely grounded paper titles");
    expect(text).toContain("Replication / next experiment plan");
    expect(text).toContain("[DEBRIEF_V1_JSON]");
    expect(text).toContain("{{fact:ground_truth:ALZHEIMERS}}");
  });

  it("builds a parseable designer schema payload", () => {
    const text = buildSafeEvaluationFinalText({
      query: "Generate a UI-ready entity card schema for DISCO with expandable sections.",
      expectedPersona: "PRODUCT_DESIGNER",
      expectedEntityId: "DISCO",
      toolsUsed: [{ name: "lookupGroundTruthEntity", ok: true }],
    });

    expect(text).toContain("```json");
    expect(text).toContain("\"title\": \"DISCO Pharmaceuticals\"");
    expect(text).toContain("\"expandableSections\"");
    expect(text).toContain("\"missingFields\"");

    const debrief = buildSafeEvaluationDebrief({
      query: "Generate a UI-ready entity card schema for DISCO with expandable sections.",
      expectedPersona: "PRODUCT_DESIGNER",
      expectedEntityId: "DISCO",
      toolsUsed: [{ name: "lookupGroundTruthEntity", ok: true }],
    });

    expect(debrief?.entity.resolvedId).toBe("DISCO");
    expect(debrief?.keyFacts.funding.stage).toBe("Seed");
    expect(debrief?.keyFacts.freshness.ageDays).toBe(16);
  });

  it("builds quant JSON with co-leads and measurable KPIs", () => {
    const text = buildSafeEvaluationFinalText({
      query: "Extract a structured signal set for DISCO: funding event timeline, key milestones, and 5 measurable KPIs.",
      expectedPersona: "QUANT_ANALYST",
      expectedEntityId: "DISCO",
      toolsUsed: [{ name: "lookupGroundTruthEntity", ok: true }],
    });

    expect(text).toContain("\"fundingEventTimeline\"");
    expect(text).toContain("\"roundType\": \"Seed\"");
    expect(text).toContain("\"measurableKpis\"");
  });

  it("builds sales output with a funding line and contact path", () => {
    const text = buildSafeEvaluationFinalText({
      query: "Write a single-screen outbound-ready summary with objections & responses.",
      expectedPersona: "SALES_ENGINEER",
      expectedEntityId: "DISCO",
      toolsUsed: [{ name: "lookupGroundTruthEntity", ok: true }],
    });

    expect(text).toContain("Funding line:");
    expect(text).toContain("Contact: info@discopharma.de");
    expect(text).toContain("Objection:");
    expect(text).toContain("Response:");
  });

  it("builds tool-schema output with explicit parameter guidance", () => {
    const text = buildSafeEvaluationFinalText({
      query: "Describe the lookupGroundTruthEntity and linkupSearch tool schemas for me, including the key parameters and when to use each.",
      expectedPersona: "JPM_STARTUP_BANKER",
      expectedEntityId: "",
      toolsUsed: [
        { name: "searchAvailableSkills", ok: true },
        { name: "describeTools", ok: true },
      ],
    });

    expect(text).toContain("lookupGroundTruthEntity schema:");
    expect(text).toContain("Required parameter:");
    expect(text).toContain("Key optional parameters:");
    expect(text).toContain("\"type\": \"tool_request\"");
  });
});
