import { describe, expect, it } from "vitest";

import { createNotebookActionPatch } from "./notebookActionEngine";

describe("NotebookActionEngine", () => {
  it("organizes event captures into entity-backed notebook sections", () => {
    const patch = createNotebookActionPatch("organize_notes", {
      reportId: "ship-demo-day",
      captures: [
        {
          captureId: "cap.1",
          rawText:
            "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
        },
        {
          captureId: "cap.2",
          rawText:
            "Jordan from Northstar Robotics mentioned warehouse automation pilots and asked for an intro.",
        },
      ],
    });

    expect(patch.proposedBlockChanges).toHaveLength(2);
    expect(patch.proposedEntityChanges.map((entity) => entity.name)).toEqual([
      "Orbital Labs",
      "Northstar Robotics",
    ]);
    expect(patch.proposedBlockChanges[0]).toMatchObject({
      kind: "insert_section",
      title: "Orbital Labs",
      sourceCaptureIds: ["cap.1"],
    });
    expect(patch.runTrace.map((step) => step.label)).toContain("Group captures");
  });

  it("creates a dossier skeleton from selected report text", () => {
    const patch = createNotebookActionPatch("create_dossier", {
      reportId: "demo-day",
      selectedText:
        "Orbital Labs builds voice-agent evaluation infrastructure for healthcare calls.",
    });

    expect(patch.summary).toContain("Orbital Labs");
    expect(patch.proposedEntityChanges[0]).toMatchObject({
      kind: "upsert_entity",
      entityKey: "orbital-labs",
      name: "Orbital Labs",
    });
    expect(patch.proposedBlockChanges.map((block) => block.title)).toEqual([
      "Orbital Labs overview",
      "Claims to verify",
      "Next actions",
    ]);
  });

  it("extracts follow-ups from selected text and capture text", () => {
    const patch = createNotebookActionPatch("extract_followups", {
      reportId: "ship-demo-day",
      selectedText:
        "Ask Alex about pilot criteria. Draft a healthcare design-partner intro.",
      captures: [
        {
          captureId: "cap.1",
          rawText: "Orbital Labs wants healthcare design partners. Verify the seed claim.",
        },
      ],
    });

    expect(patch.proposedFollowUpChanges.length).toBeGreaterThanOrEqual(3);
    expect(patch.proposedFollowUpChanges.map((item) => item.priority)).toContain("high");
    expect(patch.runTrace.map((step) => step.label)).toEqual([
      "Scan notebook",
      "Create follow-ups",
    ]);
  });

  it("audits unsupported claims into needs-review proposals", () => {
    const patch = createNotebookActionPatch("audit_claims", {
      reportId: "ship-demo-day",
      claims: [
        {
          id: "claim.verified",
          claim: "Orbital Labs has public launch evidence.",
          evidenceIds: ["src.1"],
          status: "verified",
        },
        {
          id: "claim.field-note",
          claim: "Orbital Labs is seed stage.",
          evidenceIds: [],
          status: "field_note",
        },
      ],
    });

    expect(patch.proposedClaimChanges).toEqual([
      expect.objectContaining({
        claimId: "claim.field-note",
        status: "needs_review",
        reason: expect.stringContaining("no evidence ids"),
      }),
    ]);
  });

  it("creates explanation links as confirmation-gated edge proposals", () => {
    const patch = createNotebookActionPatch("link_concepts", {
      reportId: "ship-demo-day",
      selectedText:
        "Orbital Labs to voice-agent eval trend because healthcare calls need measurable quality gates.",
    });

    expect(patch.requiresConfirmation).toBe(true);
    expect(patch.proposedEdgeChanges[0]).toMatchObject({
      fromKey: "orbital-labs",
      toKey: "voice-agent-eval-trend",
      edgeType: "RELATED_TO",
    });
    expect(patch.proposedBlockChanges[0]).toMatchObject({
      kind: "insert_callout",
      title: "Explanation link",
    });
  });

  it("clones reusable report structures without inventing new facts", () => {
    const patch = createNotebookActionPatch("clone_structure", {
      reportId: "new-company",
      template: {
        templateId: "company-dossier-v1",
        sections: [
          { title: "Overview", body: "Company summary." },
          { title: "Evidence", body: "Source-backed claims." },
        ],
      },
    });

    expect(patch.proposedBlockChanges).toEqual([
      {
        kind: "clone_section",
        sourceTemplateId: "company-dossier-v1",
        title: "Overview",
        body: "Company summary.",
      },
      {
        kind: "clone_section",
        sourceTemplateId: "company-dossier-v1",
        title: "Evidence",
        body: "Source-backed claims.",
      },
    ]);
    expect(patch.runTrace[1].detail).toContain("Copied structure only");
  });
});
