import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUBRIC_LIBRARY,
  buildStyleSkillMarkdown,
  createChatMultiplyHandoff,
  createRedesignUniverseUpsertArgs,
  parseOperatorManifestMarkdown,
  proposeMemoryPatch,
  toRedesignDocumentPatchProposal,
  toRedesignStyleProfileUpsertArgs,
} from "./manifest";

describe("operator manifest", () => {
  const markdown = `# USER.md

## Personal Context Notebook
### Background
Founder and former startup banking operator.

### Communication style
Concise banker memos.

## Style Profile
- Concise banker brief with recommendation first (91% confidence)
- Short answer
- Why it matters
- Evidence
- Risks / unknowns
- Next action

## Golden Set
- Anthropic diligence memo (93% confidence)
- Manager feedback on Mercor report (88% confidence)

## Rubric Library
- Startup banking coverage
- AI devtools screen
`;

  it("parses editable USER.md memory into durable multiple-me primitives", () => {
    const manifest = parseOperatorManifestMarkdown(markdown);

    expect(manifest.schemaVersion).toBe("operator_manifest.v1");
    expect(manifest.personalContextNotebook).toContain("Founder and former startup banking operator");
    expect(manifest.styleProfile.label).toContain("Style Profile");
    expect(manifest.styleProfile.confidence).toBe(0.91);
    expect(manifest.goldenSet).toHaveLength(2);
    expect(manifest.goldenSet[0]).toMatchObject({
      title: "Anthropic diligence memo",
      extractionConfidence: 0.93,
      accepted: true,
    });
    expect(manifest.rubricLibrary).toHaveLength(2);
    expect(manifest.rubricLibrary[0].title).toContain("Rubric Library");
    expect(manifest.permissionsBySection["Golden Set"]).toContain("private_only");
  });

  it("falls back to safe default rubrics and exports style.skill.md", () => {
    const manifest = parseOperatorManifestMarkdown("# USER.md\n");

    expect(manifest.rubricLibrary).toEqual(DEFAULT_RUBRIC_LIBRARY);
    expect(manifest.memoryUpdatePolicy.privacyBudgetConnectorsSharing).toBe("approval_required");

    const styleSkill = buildStyleSkillMarkdown(manifest);
    expect(styleSkill).toContain("## Voice");
    expect(styleSkill).toContain("## Section structure");
    expect(styleSkill).toContain("source_count:");
  });

  it("adapts USER.md style and rubrics into the official PR 240 S5 contracts", () => {
    const manifest = parseOperatorManifestMarkdown(markdown);
    const styleArgs = toRedesignStyleProfileUpsertArgs(manifest, "synthetic-qa-model");
    const universeArgs = createRedesignUniverseUpsertArgs({
      name: "Healthcare AI Coverage",
      entityIds: ["orbital-labs", "mercuror"],
      rubric: manifest.rubricLibrary[0],
      styleId: "style_profile_id",
      monitoring: true,
      monitoringMinutes: 1440,
    });

    expect(styleArgs).toMatchObject({
      slug: "founder_banker_lens_v1",
      modelUsed: "synthetic-qa-model",
    });
    expect(styleArgs.recommendationPhrasings).toContain("prioritize");
    expect(styleArgs.provenance[0]).toMatchObject({
      label: "Anthropic diligence memo",
      weightPct: expect.any(Number),
    });
    expect(universeArgs).toMatchObject({
      name: "Healthcare AI Coverage",
      slug: "healthcare-ai-coverage",
      rubric: manifest.rubricLibrary[0].id,
      monitoring: true,
      entityIds: ["orbital-labs", "mercuror"],
    });
  });

  it("creates a sample-first chat-to-batch handoff from one prompt", () => {
    const handoff = createChatMultiplyHandoff({
      sourceThreadId: "thread_orbital",
      prompt: "Research Orbital Labs and tell me if I should follow up.",
      universeId: "universe_healthcare_ai",
      styleProfileId: "founder_banker_lens_v3",
      rubricId: "banker_coverage_screen",
      fullBatchSize: 250,
    });

    expect(handoff.handoffType).toBe("chat_to_batch");
    expect(handoff.contractVersion).toBe("redesign.s5.v1");
    expect(handoff.targetTables).toMatchObject({
      universe: "redesignUniverses",
      styleProfile: "styleProfiles",
      reviewPatch: "redesignDocumentPatches",
      batchRun: "batchAutopilotRuns",
    });
    expect(handoff.sampleSize).toBe(3);
    expect(handoff.fullBatchSize).toBe(250);
    expect(handoff.runControls.label).toBe("Run on a list");
    expect(handoff.runControls.primaryAction).toBe("Multiply");
    expect(handoff.runControls.mode).toBe("sample_first");
    expect(handoff.qaThresholds.requireHumanApprovalForLowConfidence).toBe(true);
  });

  it("requires approval for sensitive self-updating memory patches", () => {
    const lowRisk = proposeMemoryPatch({
      targetSection: "Communication style",
      proposedMarkdown: "- Prefer concise banker memos.",
      reason: "Repeated edits shortened memo output.",
      confidence: 0.84,
      sourceType: "chat",
    });
    const sensitive = proposeMemoryPatch({
      targetSection: "Privacy boundaries",
      proposedMarkdown: "- Share event notes with team by default.",
      reason: "User changed sharing in export.",
      confidence: 0.9,
      sourceType: "export",
    });

    expect(lowRisk.approvalRequired).toBe(false);
    expect(sensitive.approvalRequired).toBe(true);

    const proposal = toRedesignDocumentPatchProposal({
      documentId: "doc_123",
      patch: lowRisk,
      html: "<p>Prefer concise banker memos.</p>",
      batchAutopilotRunId: "bar_123",
    });
    expect(proposal).toMatchObject({
      documentId: "doc_123",
      source: "chat",
      label: "Communication style",
      batchAutopilotRunId: "bar_123",
    });
  });
});
