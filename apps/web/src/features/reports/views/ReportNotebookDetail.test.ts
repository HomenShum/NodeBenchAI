import { describe, expect, it } from "vitest";
import {
  buildNotebookActionContext,
  buildNotebookActionMutationPatch,
  buildNotebookActionPatchHtml,
  buildReportNotebookContent,
  type SavedReportSnapshot,
  type SavedReportSection,
  type SavedReportTruthSection,
} from "./ReportNotebookDetail";
import { createNotebookActionPatch } from "@/features/notebook/lib/notebookActionEngine";

describe("buildReportNotebookContent", () => {
  it("Scenario: owner-edited notebookHtml is the source of truth — wins over sections", () => {
    const saved: SavedReportSnapshot = {
      title: "Stripe diligence",
      summary: "Top moves",
      notebookHtml: "<h2>Custom owner edit</h2><p>Annotated insights.</p>",
      sections: [{ title: "Should not render", body: "Should not render either" }],
    };
    const html = buildReportNotebookContent(null, "fallback name", saved);
    expect(html).toContain("Custom owner edit");
    expect(html).toContain("Annotated insights");
    expect(html).not.toContain("Should not render");
  });

  it("Scenario: saved report with structured sections — renders each title + body as paragraphs", () => {
    const saved: SavedReportSnapshot = {
      title: "Mercor hiring",
      summary: "Series B prep",
      sections: [
        { id: "s1", title: "Velocity", body: "7 new eng roles in 24h.\n\nUp 40% WoW.", status: "verified" },
        { id: "s2", title: "Implication", body: "Runway extends to Q1 2027.", status: "verified" },
      ],
    };
    const html = buildReportNotebookContent(null, "Mercor", saved);
    expect(html).toContain("<h3>Velocity</h3>");
    expect(html).toContain("7 new eng roles in 24h");
    expect(html).toContain("Up 40% WoW");
    expect(html).toContain("<h3>Implication</h3>");
    expect(html).toContain("Runway extends");
  });

  it("Scenario: saved report falls back to compiledAnswerV2.truthSections when sections are empty", () => {
    const saved: SavedReportSnapshot = {
      title: "DISCO",
      sections: [],
      compiledAnswerV2: {
        truthSections: [
          {
            id: "ts1",
            title: "Regulatory",
            sentences: [
              { sentenceId: "se1", text: "SOC 2 Type II GA in EU." },
              { sentenceId: "se2", text: "Flips prior needs-review stance." },
            ],
          },
        ],
      },
    };
    const html = buildReportNotebookContent(null, "DISCO", saved);
    expect(html).toContain("<h3>Regulatory</h3>");
    expect(html).toContain("SOC 2 Type II GA in EU.");
    expect(html).toContain("Flips prior needs-review stance");
  });

  it("Scenario: saved report has no body, no sections, no compiled — shows empty-body explanation", () => {
    const saved: SavedReportSnapshot = {
      title: "Empty report",
      summary: "",
    };
    const html = buildReportNotebookContent(null, "Empty report", saved);
    expect(html).toContain("Empty report");
    expect(html).toContain("does not yet have a written answer");
  });

  it("Scenario: adversarial — XSS-shaped fields in metadata are escaped (sections + summary + query)", () => {
    const saved: SavedReportSnapshot = {
      title: "<img src=x onerror=alert(1)>",
      summary: "<script>alert('xss')</script>",
      query: "& how does it < behave >",
      sections: [
        { title: "<svg/onload=alert(2)>", body: "<iframe>nope</iframe>" },
      ],
    };
    const html = buildReportNotebookContent(null, "fallback", saved);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<svg/onload");
    expect(html).not.toContain("<iframe>");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; how does it &lt; behave &gt;");
    expect(html).toContain("&lt;svg/onload");
  });

  it("Scenario: notebookHtml is trusted verbatim — backend is responsible for sanitization (server-of-truth)", () => {
    // Verifies we don't double-escape an already-saved owner edit.
    const saved: SavedReportSnapshot = {
      title: "ignored",
      notebookHtml: "<h2>Already escaped &amp; safe</h2>",
    };
    const html = buildReportNotebookContent(null, "x", saved);
    expect(html).toContain("&amp; safe");
    expect(html).not.toContain("&amp;amp;");
  });

  it("Scenario: section with whitespace-only title or body — filtered out, not rendered as empty noise", () => {
    const sections: SavedReportSection[] = [
      { title: "  ", body: "  " },
      { title: "Real", body: "Real body" },
      { title: "", body: "" },
    ];
    const saved: SavedReportSnapshot = { title: "Mixed", sections };
    const html = buildReportNotebookContent(null, "Mixed", saved);
    expect(html).toContain("Real");
    expect(html).toContain("Real body");
    // No empty <h3></h3> shells.
    expect(html).not.toMatch(/<h3>\s*<\/h3>/);
  });

  it("Scenario: truthSection with empty sentence list — title-only renders, no broken paragraph stubs", () => {
    const truthSections: SavedReportTruthSection[] = [
      { title: "Title only", sentences: [] },
      { title: "Has content", sentences: [{ text: "Real sentence." }] },
    ];
    const saved: SavedReportSnapshot = {
      title: "Mixed truth",
      compiledAnswerV2: { truthSections },
    };
    const html = buildReportNotebookContent(null, "Mixed truth", saved);
    expect(html).toContain("Title only");
    expect(html).toContain("Real sentence");
    expect(html).not.toMatch(/<p>\s*<\/p>/);
  });

  it("Scenario: many sections (>5) — all render, no silent slicing of saved data", () => {
    const sections: SavedReportSection[] = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      title: `Section ${i + 1}`,
      body: `Body ${i + 1}`,
    }));
    const saved: SavedReportSnapshot = { title: "Many", sections };
    const html = buildReportNotebookContent(null, "Many", saved);
    for (let i = 1; i <= 8; i++) {
      expect(html).toContain(`Section ${i}`);
      expect(html).toContain(`Body ${i}`);
    }
  });

  it("Scenario: section body with embedded blank line — paragraph split renders multiple <p>", () => {
    const saved: SavedReportSnapshot = {
      title: "Split body",
      sections: [{ title: "S", body: "First.\n\nSecond.\n\nThird." }],
    };
    const html = buildReportNotebookContent(null, "Split body", saved);
    const paragraphs = html.match(/<p>/g) ?? [];
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("First.");
    expect(html).toContain("Second.");
    expect(html).toContain("Third.");
  });

  it("Scenario: only title (no summary, query, sections, compiled) — renders heading + empty-body explanation", () => {
    const saved: SavedReportSnapshot = { title: "Bare title" };
    const html = buildReportNotebookContent(null, "Bare title", saved);
    expect(html).toContain("Bare title");
    expect(html).toContain("does not yet have a written answer");
  });

  it("Scenario: notebookHtml whitespace-only string — does NOT take precedence (treated as absent)", () => {
    const saved: SavedReportSnapshot = {
      title: "Has sections",
      notebookHtml: "    \n  ",
      sections: [{ title: "Sec", body: "Body" }],
    };
    const html = buildReportNotebookContent(null, "Has sections", saved);
    expect(html).toContain("Sec");
    expect(html).toContain("Body");
    expect(html.trim()).not.toBe("");
  });

  it("Scenario: starter workspace fixture (no real saved report) — renders the starter sections", () => {
    const fakeWorkspace = {
      entity: { name: "Starter Co", summary: "demo", reportCount: 1 },
      note: { content: "field note" },
      latest: {
        title: "Latest brief",
        sections: [
          { title: "Signals", body: "Signal copy" },
          { title: "Risks", body: "Risk copy" },
        ],
      },
      evidence: [],
    } as any;
    const html = buildReportNotebookContent(fakeWorkspace, "Starter Co");
    expect(html).toContain("Latest brief");
    expect(html).toContain("Signals");
    expect(html).toContain("Signal copy");
    expect(html).toContain("Risks");
  });

  it("Scenario: no data, no fixture — renders neutral notebook stub (no white void)", () => {
    const html = buildReportNotebookContent(null, "New report");
    expect(html).toContain("New report");
    expect(html).toContain("notebook");
    expect(html).toContain("Workspace surface");
  });

  it("Scenario: structured sections take precedence over compiledAnswerV2 when both present", () => {
    const saved: SavedReportSnapshot = {
      title: "Dual sources",
      sections: [{ title: "From sections", body: "Sections wins" }],
      compiledAnswerV2: {
        truthSections: [
          { title: "From compiled", sentences: [{ text: "Compiled loses" }] },
        ],
      },
    };
    const html = buildReportNotebookContent(null, "Dual sources", saved);
    expect(html).toContain("From sections");
    expect(html).toContain("Sections wins");
    expect(html).not.toContain("From compiled");
    expect(html).not.toContain("Compiled loses");
  });
});

describe("web report notebook actions", () => {
  it("Scenario: live captures and claims are converted into action-engine context", () => {
    const context = buildNotebookActionContext({
      reportId: "ship-demo-day",
      reportName: "Ship Demo Day",
      summary: "Event intelligence",
      selectedText: "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
      starterWorkspace: null,
      workspaceSnapshot: {
        captures: [
          {
            captureKey: "capture.1",
            rawText: "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
            extractedEntityKeys: ["person.alex", "company.orbital-labs"],
          },
        ],
        claims: [
          {
            claimKey: "claim.1",
            claim: "Orbital Labs is seed-stage.",
            status: "needs_evidence",
            evidenceKeys: [],
          },
        ],
      },
    });

    expect(context.captures).toHaveLength(1);
    expect(context.captures?.[0]?.captureId).toBe("capture.1");
    expect(context.claims).toHaveLength(1);
    expect(context.claims?.[0]?.status).toBe("needs_review");
  });

  it("Scenario: manual action context becomes a proposal-only capture when no live captures exist", () => {
    const context = buildNotebookActionContext({
      reportId: "starter-market",
      reportName: "Market report",
      summary: "Market map",
      selectedText: "Met Alex from Orbital Labs. Voice agent eval infra.",
      starterWorkspace: null,
      workspaceSnapshot: null,
    });

    expect(context.captures).toHaveLength(1);
    expect(context.captures?.[0]).toMatchObject({
      captureId: "manual.starter-market",
      rawText: "Met Alex from Orbital Labs. Voice agent eval infra.",
    });
  });


  it("Scenario: organize_notes patch renders insertable notebook HTML with traceability", () => {
    const patch = createNotebookActionPatch("organize_notes", {
      reportId: "ship-demo-day",
      selectedText: "",
      captures: [
        {
          captureId: "capture.1",
          rawText: "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
        },
      ],
    });
    const html = buildNotebookActionPatchHtml(patch);

    expect(html).toContain("Notebook action:");
    expect(html).toContain("Orbital Labs");
    expect(html).toContain("Run trace");
    expect(html).toContain("Entity changes");
  });

  it("Scenario: audit_claims patch renders nb_claim blocks that TipTap can parse", () => {
    const patch = createNotebookActionPatch("audit_claims", {
      reportId: "ship-demo-day",
      claims: [
        {
          id: "claim.orbital-seed",
          claim: "Orbital Labs is seed-stage.",
          status: "field_note",
          evidenceIds: [],
        },
      ],
    });
    const html = buildNotebookActionPatchHtml(patch);

    expect(html).toContain('data-type="nb-claim"');
    expect(html).toContain('data-statement="Orbital Labs is seed-stage."');
    expect(html).toContain('data-conflict="1"');
  });

  it("Scenario: accepted action mutation payload excludes editor-only block HTML", () => {
    const patch = createNotebookActionPatch("organize_notes", {
      reportId: "ship-demo-day",
      captures: [
        {
          captureId: "capture.1",
          rawText: "Met Alex from Orbital Labs. Voice agent eval infra.",
        },
      ],
    });
    const payload = buildNotebookActionMutationPatch(patch);

    expect(payload.action).toBe("organize_notes");
    expect(payload.proposedEntityChanges).toHaveLength(1);
    expect(payload.proposedFollowUpChanges).toEqual([]);
    expect("proposedBlockChanges" in payload).toBe(false);
  });
});
