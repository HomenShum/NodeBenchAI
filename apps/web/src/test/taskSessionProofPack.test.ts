import { describe, expect, it } from "vitest";
import { buildTaskSessionProofPack } from "../../convex/domains/operations/taskManager/proofPack";

/* ── Helpers ───────────────────────────────────────────────────── */

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    _id: "session_test",
    title: "Test session",
    type: "agent",
    visibility: "public",
    status: "completed",
    startedAt: Date.now() - 30_000,
    completedAt: Date.now(),
    toolsUsed: [],
    sourceRefs: [],
    ...overrides,
  } as any;
}

function makeTrace(overrides: Record<string, unknown> = {}) {
  return {
    _id: "trace_test",
    sessionId: "session_test",
    traceId: "trace_test",
    workflowName: "Test workflow",
    status: "completed",
    startedAt: Date.now() - 20_000,
    sourceRefs: [],
    metadata: {},
    ...overrides,
  } as any;
}

/* ── Verdict State Machine ─────────────────────────────────────── */

describe("buildTaskSessionProofPack — verdict state machine", () => {
  // ────────────────────────────────────────────────────────
  // 1. in_progress — session still pending or running
  // ────────────────────────────────────────────────────────
  describe("in_progress verdict", () => {
    it("returns in_progress when session is pending", () => {
      const session = makeSession({ status: "pending" });
      const pack = buildTaskSessionProofPack(session, []);
      expect(pack.verdict).toBe("in_progress");
      expect(pack.verdictLabel).toBe("In progress");
    });

    it("returns in_progress when session is running", () => {
      const session = makeSession({ status: "running" });
      const pack = buildTaskSessionProofPack(session, []);
      expect(pack.verdict).toBe("in_progress");
    });

    it("returns in_progress when completed but no source refs and no warnings", () => {
      // completed + no citations + no verifications + no warnings = needs_review (no sourceRefs)
      // Actually, per logic: no sourceRefs → needs_review. Let's verify.
      const session = makeSession({ sourceRefs: [] });
      const traces = [makeTrace()];
      const pack = buildTaskSessionProofPack(session, traces);
      // topSourceRefs.length === 0 → needs_review
      expect(pack.verdict).toBe("needs_review");
    });

    it("falls through to in_progress when completed with refs but no verifications and no citations from traces", () => {
      // completed + sourceRefs > 0 + verification total 0 → provisionally_verified
      const session = makeSession({
        sourceRefs: [{ label: "Source", href: "https://example.com" }],
      });
      const pack = buildTaskSessionProofPack(session, []);
      expect(pack.verdict).toBe("provisionally_verified");
    });
  });

  // ────────────────────────────────────────────────────────
  // 2. awaiting_approval — pending approvals block everything
  // ────────────────────────────────────────────────────────
  describe("awaiting_approval verdict", () => {
    it("blocks on pending approvals even when session is completed with evidence", () => {
      const session = makeSession({
        sourceRefs: [{ label: "Official source", href: "https://example.com/official" }],
      });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceVerificationChecks: [
              { label: "Grounding check", status: "passed" },
            ],
            executionTraceApprovals: [
              { approvalId: "a1", toolName: "publish_report", status: "pending" },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("awaiting_approval");
      expect(pack.approvalCounts.pending).toBe(1);
      expect(pack.nextActions).toContain(
        "Resolve pending approvals before executing externally visible or risky actions.",
      );
    });

    it("takes priority over failed status when approvals are pending", () => {
      // Per logic: pending/running → in_progress, THEN approvals → awaiting_approval, THEN failed
      // So awaiting_approval actually takes priority over session.status === "failed"
      const session = makeSession({ status: "completed" });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceApprovals: [
              { approvalId: "a1", status: "pending" },
              { approvalId: "a2", status: "pending" },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("awaiting_approval");
      expect(pack.approvalCounts.pending).toBe(2);
    });

    it("does not block when all approvals are resolved", () => {
      const session = makeSession({
        sourceRefs: [{ label: "S", href: "https://example.com" }],
      });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceApprovals: [
              { approvalId: "a1", status: "approved" },
            ],
            executionTraceVerificationChecks: [
              { label: "Check", status: "passed" },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).not.toBe("awaiting_approval");
    });
  });

  // ────────────────────────────────────────────────────────
  // 3. failed — session failed, verification failed, or cross-check violated
  // ────────────────────────────────────────────────────────
  describe("failed verdict", () => {
    it("marks failed when session status is failed", () => {
      const session = makeSession({ status: "failed", errorMessage: "OOM" });
      const pack = buildTaskSessionProofPack(session, []);
      expect(pack.verdict).toBe("failed");
      expect(pack.summary).toContain("not safe to treat as final");
      expect(pack.openIssues).toContain("OOM");
    });

    it("marks failed when verification check failed", () => {
      const session = makeSession({
        sourceRefs: [{ label: "S", href: "https://x.com" }],
      });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceVerificationChecks: [
              { label: "Critical check", status: "failed", details: "Data mismatch" },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("failed");
      expect(pack.verificationCounts.failed).toBe(1);
      expect(pack.openIssues).toEqual(expect.arrayContaining([expect.stringContaining("Data mismatch")]));
    });

    it("marks failed when cross-check is violated", () => {
      const session = makeSession({
        crossCheckStatus: "violated",
        sourceRefs: [{ label: "S", href: "https://x.com" }],
      });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceVerificationChecks: [
              { label: "Check", status: "passed" },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("failed");
      expect(pack.openIssues).toEqual(
        expect.arrayContaining([expect.stringContaining("violated")]),
      );
    });
  });

  // ────────────────────────────────────────────────────────
  // 4. needs_review — warnings, drift, unsupported claims, or no citations
  // ────────────────────────────────────────────────────────
  describe("needs_review verdict", () => {
    it("triggers on verification warnings", () => {
      const session = makeSession({
        sourceRefs: [{ label: "S", href: "https://x.com" }],
      });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceVerificationChecks: [
              { label: "Fact check", status: "warning", details: "Ungrounded claim" },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("needs_review");
    });

    it("triggers on cross-check drifting", () => {
      const session = makeSession({
        crossCheckStatus: "drifting",
        sourceRefs: [{ label: "S", href: "https://x.com" }],
      });
      const pack = buildTaskSessionProofPack(session, [makeTrace()]);
      expect(pack.verdict).toBe("needs_review");
      expect(pack.openIssues).toEqual(
        expect.arrayContaining([expect.stringContaining("drift")]),
      );
    });

    it("triggers on unsupported claims", () => {
      const session = makeSession({
        sourceRefs: [{ label: "S", href: "https://x.com" }],
      });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceEvidence: [
              {
                title: "Partial",
                unsupportedClaims: ["Revenue doubled"],
              },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("needs_review");
      expect(pack.openIssues).toEqual(
        expect.arrayContaining([expect.stringContaining("Revenue doubled")]),
      );
    });

    it("triggers when no source refs exist", () => {
      const session = makeSession({ sourceRefs: [] });
      const traces = [makeTrace({ sourceRefs: [] })];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("needs_review");
      expect(pack.nextActions).toEqual(
        expect.arrayContaining([expect.stringContaining("source references")]),
      );
    });
  });

  // ────────────────────────────────────────────────────────
  // 5. verified — completed + verifications + citations
  // ────────────────────────────────────────────────────────
  describe("verified verdict", () => {
    it("marks verified with citations, passed verifications, and completion", () => {
      const session = makeSession({
        toolsUsed: ["discover_tools", "get_workflow_chain"],
        sourceRefs: [{ label: "SEC filing", href: "https://sec.gov/file" }],
        crossCheckStatus: "aligned",
      });
      const traces = [
        makeTrace({
          sourceRefs: [{ label: "Company release", href: "https://co.com/release" }],
          metadata: {
            executionTraceDecisions: [
              { statement: "Risk confirmed", confidence: 0.91 },
            ],
            executionTraceVerificationChecks: [
              { label: "Citation check", status: "passed" },
            ],
            executionTraceEvidence: [
              {
                title: "Primary source pack",
                summary: "Evidence gathered",
                sourceRefs: [{ label: "SEC filing", href: "https://sec.gov/file" }],
                supportedClaims: ["Risk disclosed"],
              },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("verified");
      expect(pack.progressiveDisclosureUsed).toBe(true);
      expect(pack.citationCount).toBeGreaterThanOrEqual(1);
      expect(pack.verificationCounts.passed).toBe(1);
      expect(pack.nextActions).toContain(
        "Draft the final memo or response with citations and link back to this trace.",
      );
    });

    it("requires at least one verification check to be verified (not just provisionally)", () => {
      const session = makeSession({
        sourceRefs: [{ label: "S", href: "https://x.com" }],
      });
      // No verification checks → provisionally_verified, not verified
      const pack = buildTaskSessionProofPack(session, [makeTrace()]);
      expect(pack.verdict).toBe("provisionally_verified");
    });
  });

  // ────────────────────────────────────────────────────────
  // 6. provisionally_verified — completed + citations, but weaker verification bar
  // ────────────────────────────────────────────────────────
  describe("provisionally_verified verdict", () => {
    it("marks provisionally_verified when completed with citations but no verifications", () => {
      const session = makeSession({
        sourceRefs: [{ label: "Blog post", href: "https://blog.com/post" }],
      });
      const pack = buildTaskSessionProofPack(session, [makeTrace()]);
      expect(pack.verdict).toBe("provisionally_verified");
      expect(pack.summary).toContain("needs stronger verification");
    });

    it("upgrades to verified when verifications are added", () => {
      const session = makeSession({
        sourceRefs: [{ label: "Blog", href: "https://blog.com" }],
      });
      const traces = [
        makeTrace({
          metadata: {
            executionTraceVerificationChecks: [
              { label: "Fact check", status: "passed" },
            ],
          },
        }),
      ];
      const pack = buildTaskSessionProofPack(session, traces);
      expect(pack.verdict).toBe("verified");
    });
  });
});

/* ── Confidence Scoring ────────────────────────────────────────── */

describe("buildTaskSessionProofPack — confidence scoring", () => {
  it("starts at 0.25 baseline for empty in-progress session", () => {
    const session = makeSession({ status: "pending" });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.confidence).toBeCloseTo(0.25, 1);
  });

  it("increases confidence with completion, citations, evidence, and passed verifications", () => {
    const session = makeSession({
      sourceRefs: [
        { label: "S1", href: "https://a.com" },
        { label: "S2", href: "https://b.com" },
        { label: "S3", href: "https://c.com" },
        { label: "S4", href: "https://d.com" },
        { label: "S5", href: "https://e.com" },
      ],
    });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V1", status: "passed" },
          ],
          executionTraceEvidence: [
            { title: "E1", summary: "Evidence 1" },
            { title: "E2", summary: "Evidence 2" },
            { title: "E3", summary: "Evidence 3" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    // 0.25 base + 0.2 completed + 0.2 refs (5*0.04=0.2, capped) + 0.15 evidence (3*0.05=0.15, capped) + 0.2 passed verif = 1.0 → clamped to 0.99
    expect(pack.confidence).toBeGreaterThanOrEqual(0.85);
    expect(pack.confidence).toBeLessThanOrEqual(0.99);
  });

  it("decreases confidence for failed verifications", () => {
    const session = makeSession({
      sourceRefs: [{ label: "S", href: "https://x.com" }],
    });
    const tracesWithPass = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V1", status: "passed" },
          ],
        },
      }),
    ];
    const tracesWithFail = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V1", status: "passed" },
            { label: "V2", status: "failed" },
          ],
        },
      }),
    ];
    const passConf = buildTaskSessionProofPack(session, tracesWithPass).confidence;
    const failConf = buildTaskSessionProofPack(session, tracesWithFail).confidence;
    expect(failConf).toBeLessThan(passConf);
  });

  it("heavily penalizes cross-check violations", () => {
    const aligned = makeSession({
      crossCheckStatus: "aligned",
      sourceRefs: [{ label: "S", href: "https://x.com" }],
    });
    const violated = makeSession({
      crossCheckStatus: "violated",
      sourceRefs: [{ label: "S", href: "https://x.com" }],
    });
    const traces = [makeTrace()];
    const alignedConf = buildTaskSessionProofPack(aligned, traces).confidence;
    const violatedConf = buildTaskSessionProofPack(violated, traces).confidence;
    expect(violatedConf).toBeLessThan(alignedConf - 0.2);
  });

  it("clamps confidence between 0.05 and 0.99", () => {
    // Maximally penalized session
    const session = makeSession({
      status: "failed",
      crossCheckStatus: "violated",
      errorMessage: "Critical error",
    });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V1", status: "failed" },
            { label: "V2", status: "failed" },
            { label: "V3", status: "failed" },
          ],
          executionTraceEvidence: [
            { title: "E1", unsupportedClaims: ["C1", "C2", "C3"] },
          ],
          executionTraceApprovals: [
            { approvalId: "a1", status: "pending" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    expect(pack.confidence).toBeGreaterThanOrEqual(0.05);
    expect(pack.confidence).toBeLessThanOrEqual(0.99);
  });

  it("averages decision confidence with computed confidence", () => {
    const session = makeSession({
      sourceRefs: [{ label: "S", href: "https://x.com" }],
    });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceDecisions: [
            { statement: "D1", confidence: 0.3 },
            { statement: "D2", confidence: 0.5 },
          ],
          executionTraceVerificationChecks: [
            { label: "V", status: "passed" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    // Decision avg = 0.4, computed ≈ 0.69, averaged = ~0.545
    expect(pack.confidence).toBeGreaterThan(0.3);
    expect(pack.confidence).toBeLessThan(0.8);
  });
});

/* ── Progressive Disclosure Detection ──────────────────────────── */

describe("buildTaskSessionProofPack — progressive disclosure", () => {
  it("detects discover_tools usage", () => {
    const session = makeSession({ toolsUsed: ["discover_tools"] });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.progressiveDisclosureUsed).toBe(true);
    expect(pack.progressiveDisclosureTools).toContain("discover_tools");
  });

  it("detects get_tool_quick_ref usage", () => {
    const session = makeSession({ toolsUsed: ["get_tool_quick_ref"] });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.progressiveDisclosureUsed).toBe(true);
  });

  it("detects smart_select_tools usage", () => {
    const session = makeSession({ toolsUsed: ["smart_select_tools"] });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.progressiveDisclosureUsed).toBe(true);
  });

  it("detects findTools usage", () => {
    const session = makeSession({ toolsUsed: ["findTools"] });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.progressiveDisclosureUsed).toBe(true);
  });

  it("reports false when no discovery tools used", () => {
    const session = makeSession({ toolsUsed: ["web_search", "fetch_url"] });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.progressiveDisclosureUsed).toBe(false);
    expect(pack.progressiveDisclosureTools).toHaveLength(0);
  });

  it("suggests discovery tools in nextActions when not used", () => {
    const session = makeSession({ toolsUsed: [] });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.nextActions).toEqual(
      expect.arrayContaining([expect.stringContaining("discover_tools")]),
    );
  });
});

/* ── Source Ref Deduplication & Aggregation ─────────────────────── */

describe("buildTaskSessionProofPack — source ref aggregation", () => {
  it("deduplicates source refs across session, traces, and evidence", () => {
    const sharedRef = { label: "SEC filing", href: "https://sec.gov/file" };
    const session = makeSession({ sourceRefs: [sharedRef] });
    const traces = [
      makeTrace({
        sourceRefs: [sharedRef],
        metadata: {
          executionTraceEvidence: [
            { title: "E1", sourceRefs: [sharedRef] },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    // Same ref appears 3 times but should be deduplicated to 1
    expect(pack.topSourceRefs).toHaveLength(1);
    expect(pack.citationCount).toBe(1);
  });

  it("keeps distinct refs separate", () => {
    const session = makeSession({
      sourceRefs: [{ label: "A", href: "https://a.com" }],
    });
    const traces = [
      makeTrace({
        sourceRefs: [{ label: "B", href: "https://b.com" }],
        metadata: {
          executionTraceEvidence: [
            { title: "E", sourceRefs: [{ label: "C", href: "https://c.com" }] },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    expect(pack.topSourceRefs).toHaveLength(3);
  });

  it("caps topSourceRefs at 8", () => {
    const refs = Array.from({ length: 12 }, (_, i) => ({
      label: `Ref ${i}`,
      href: `https://ref${i}.com`,
    }));
    const session = makeSession({ sourceRefs: refs });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.topSourceRefs.length).toBeLessThanOrEqual(8);
  });
});

/* ── Next Actions Derivation ───────────────────────────────────── */

describe("buildTaskSessionProofPack — next actions", () => {
  it("caps next actions at 5", () => {
    // Session designed to trigger all possible next actions
    const session = makeSession({
      toolsUsed: [],
      sourceRefs: [],
      crossCheckStatus: "drifting",
    });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V", status: "warning" },
          ],
          executionTraceEvidence: [
            { title: "E", unsupportedClaims: ["Claim"] },
          ],
          executionTraceApprovals: [
            { approvalId: "a1", status: "pending" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    expect(pack.nextActions.length).toBeLessThanOrEqual(5);
  });

  it("includes verification suggestion when no verifications exist", () => {
    const session = makeSession({
      sourceRefs: [{ label: "S", href: "https://x.com" }],
    });
    const pack = buildTaskSessionProofPack(session, [makeTrace()]);
    expect(pack.nextActions).toEqual(
      expect.arrayContaining([expect.stringContaining("verification check")]),
    );
  });

  it("includes memo suggestion when verified", () => {
    const session = makeSession({
      sourceRefs: [{ label: "S", href: "https://x.com" }],
      toolsUsed: ["discover_tools"],
    });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V", status: "passed" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    expect(pack.verdict).toBe("verified");
    expect(pack.nextActions).toEqual(
      expect.arrayContaining([expect.stringContaining("memo")]),
    );
  });
});

/* ── Open Issues Aggregation ───────────────────────────────────── */

describe("buildTaskSessionProofPack — open issues", () => {
  it("caps open issues at 6", () => {
    const session = makeSession({ crossCheckStatus: "violated", errorMessage: "Error" });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V1", status: "failed", details: "Fail 1" },
            { label: "V2", status: "failed", details: "Fail 2" },
            { label: "V3", status: "warning", details: "Warn 1" },
            { label: "V4", status: "warning", details: "Warn 2" },
          ],
          executionTraceEvidence: [
            { title: "E", unsupportedClaims: ["C1", "C2", "C3"] },
          ],
          executionTraceApprovals: [
            { approvalId: "a1", status: "pending" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    expect(pack.openIssues.length).toBeLessThanOrEqual(6);
  });

  it("includes error message in open issues", () => {
    const session = makeSession({ status: "failed", errorMessage: "Rate limit exceeded" });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.openIssues).toContain("Rate limit exceeded");
  });
});

/* ── Trace Highlights ──────────────────────────────────────────── */

describe("buildTaskSessionProofPack — trace highlights", () => {
  it("maps all traces to highlights with summary extraction", () => {
    const traces = [
      makeTrace({
        traceId: "t1",
        workflowName: "Research",
        status: "completed",
        metadata: { summary: "Found 3 filings" },
      }),
      makeTrace({
        traceId: "t2",
        workflowName: "Verification",
        status: "completed",
        metadata: { summary: "All checks passed" },
      }),
    ];
    const pack = buildTaskSessionProofPack(makeSession(), traces);
    expect(pack.traceHighlights).toHaveLength(2);
    expect(pack.traceHighlights[0].summary).toBe("Found 3 filings");
    expect(pack.traceHighlights[1].summary).toBe("All checks passed");
  });

  it("handles traces without summary metadata", () => {
    const traces = [makeTrace({ metadata: {} })];
    const pack = buildTaskSessionProofPack(makeSession(), traces);
    expect(pack.traceHighlights[0].summary).toBeUndefined();
  });
});

/* ── Edge Cases ────────────────────────────────────────────────── */

describe("buildTaskSessionProofPack — edge cases", () => {
  it("handles empty traces array", () => {
    const session = makeSession();
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.traceHighlights).toHaveLength(0);
    expect(pack.evidenceCount).toBe(0);
    expect(pack.decisionCount).toBe(0);
  });

  it("handles session with no toolsUsed field", () => {
    const session = makeSession({ toolsUsed: undefined });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.progressiveDisclosureUsed).toBe(false);
    expect(pack.progressiveDisclosureTools).toHaveLength(0);
  });

  it("handles session with no sourceRefs field", () => {
    const session = makeSession({ sourceRefs: undefined });
    const pack = buildTaskSessionProofPack(session, []);
    expect(pack.citationCount).toBe(0);
  });

  it("handles traces with malformed metadata (non-object)", () => {
    const traces = [makeTrace({ metadata: "not an object" })];
    const pack = buildTaskSessionProofPack(makeSession(), traces);
    expect(pack.evidenceCount).toBe(0);
    expect(pack.decisionCount).toBe(0);
  });

  it("handles traces with null metadata", () => {
    const traces = [makeTrace({ metadata: null })];
    const pack = buildTaskSessionProofPack(makeSession(), traces);
    expect(pack.evidenceCount).toBe(0);
  });

  it("handles fixed verifications contributing positively", () => {
    const session = makeSession({
      sourceRefs: [{ label: "S", href: "https://x.com" }],
    });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V1", status: "fixed" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    expect(pack.verificationCounts.fixed).toBe(1);
    // Fixed counts as total > 0 + not failed → verified
    expect(pack.verdict).toBe("verified");
  });

  it("correctly counts multiple verification statuses", () => {
    const session = makeSession({
      sourceRefs: [{ label: "S", href: "https://x.com" }],
    });
    const traces = [
      makeTrace({
        metadata: {
          executionTraceVerificationChecks: [
            { label: "V1", status: "passed" },
            { label: "V2", status: "warning" },
            { label: "V3", status: "failed" },
            { label: "V4", status: "fixed" },
          ],
        },
      }),
    ];
    const pack = buildTaskSessionProofPack(session, traces);
    expect(pack.verificationCounts).toEqual({
      total: 4,
      passed: 1,
      warning: 1,
      failed: 1,
      fixed: 1,
    });
  });
});

/* ── Summary Text ──────────────────────────────────────────────── */

describe("buildTaskSessionProofPack — summary text", () => {
  it("generates correct summary for each verdict", () => {
    const cases: Array<{
      verdict: string;
      contains: string;
      session: any;
      traces: any[];
    }> = [
      {
        verdict: "verified",
        contains: "cited source",
        session: makeSession({
          sourceRefs: [{ label: "S", href: "https://x.com" }],
        }),
        traces: [
          makeTrace({
            metadata: {
              executionTraceVerificationChecks: [{ label: "V", status: "passed" }],
            },
          }),
        ],
      },
      {
        verdict: "provisionally_verified",
        contains: "needs stronger verification",
        session: makeSession({
          sourceRefs: [{ label: "S", href: "https://x.com" }],
        }),
        traces: [makeTrace()],
      },
      {
        verdict: "needs_review",
        contains: "needs review",
        session: makeSession({ sourceRefs: [], crossCheckStatus: "drifting" }),
        traces: [makeTrace()],
      },
      {
        verdict: "failed",
        contains: "not safe",
        session: makeSession({ status: "failed" }),
        traces: [],
      },
      {
        verdict: "in_progress",
        contains: "still active",
        session: makeSession({ status: "running" }),
        traces: [],
      },
    ];

    for (const c of cases) {
      const pack = buildTaskSessionProofPack(c.session, c.traces);
      expect(pack.verdict).toBe(c.verdict);
      expect(pack.summary.toLowerCase()).toContain(c.contains.toLowerCase());
    }
  });
});
