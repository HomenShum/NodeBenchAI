import { describe, expect, it } from "vitest";
import {
  assertTasteBenchCorrectionKind,
  assertTasteBenchEventCanAppend,
  assertTasteBenchOperationalEventType,
  assertTasteBenchOwner,
  assertTasteBenchScenarioId,
  buildTasteBenchBlindOrder,
  deriveTasteBenchRunState,
  isTasteBenchEvidenceEligible,
  normalizeBlindTasteBenchChoice,
  normalizeTasteBenchReason,
  validateTasteBenchDimensions,
} from "./tasteBenchPolicy";

describe("TasteBench policy", () => {
  it("accepts only fixed scenarios, rubric dimensions, and correction classes", () => {
    expect(() =>
      assertTasteBenchScenarioId("app-02-pre-delegation-packet"),
    ).not.toThrow();
    expect(() => assertTasteBenchScenarioId("invented-scenario")).toThrow(
      /unknown tastebench scenario/i,
    );

    expect(validateTasteBenchDimensions(["trust", "trust", "craft"])).toEqual([
      "trust",
      "craft",
    ]);
    expect(() => validateTasteBenchDimensions([])).toThrow(/at least one/i);
    expect(() => validateTasteBenchDimensions(["confidence"])).toThrow(
      /unknown tastebench dimension/i,
    );

    expect(() =>
      assertTasteBenchCorrectionKind("reduced_density"),
    ).not.toThrow();
    expect(() => assertTasteBenchCorrectionKind("made_it_pretty")).toThrow(
      /unknown tastebench correction/i,
    );
    expect(() =>
      assertTasteBenchOperationalEventType("approval_interrupted"),
    ).not.toThrow();
    expect(() =>
      assertTasteBenchOperationalEventType("clicked_something"),
    ).toThrow(/unknown tastebench operational/i);
    expect(
      normalizeTasteBenchReason(
        "  Clear hierarchy made the decision legible.  ",
      ),
    ).toBe("Clear hierarchy made the decision legible.");
    expect(() => normalizeTasteBenchReason("looks better")).toThrow(
      /explain the human judgment/i,
    );
  });

  it("requires scenario-bound, hashed, viewable media instead of summary-only rows", () => {
    const eligible = {
      prompt:
        "tastebench-scenario:app-02-pre-delegation-packet controlled capture",
      scenarioId: "app-02-pre-delegation-packet" as const,
      mediaUrl: "https://evidence.example/run.mp4",
      inputSha256: "a".repeat(64),
      summary: "A real QA packet",
    };
    expect(isTasteBenchEvidenceEligible(eligible)).toBe(true);
    expect(
      isTasteBenchEvidenceEligible({
        ...eligible,
        prompt: "generic dogfood capture",
      }),
    ).toBe(false);
    expect(
      isTasteBenchEvidenceEligible({
        ...eligible,
        prompt:
          "tastebench-scenario:app-02-pre-delegation-packet-extra controlled capture",
      }),
    ).toBe(false);
    expect(
      isTasteBenchEvidenceEligible({
        ...eligible,
        prompt:
          "tastebench-scenario:app-02-pre-delegation-packet tastebench-scenario:app-01-founder-weekly-reset",
      }),
    ).toBe(false);
    expect(isTasteBenchEvidenceEligible({ ...eligible, mediaUrl: null })).toBe(
      false,
    );
    expect(
      isTasteBenchEvidenceEligible({ ...eligible, inputSha256: undefined }),
    ).toBe(false);
    expect(
      isTasteBenchEvidenceEligible({ ...eligible, inputSha256: "not-a-sha" }),
    ).toBe(false);
    expect(isTasteBenchEvidenceEligible({ ...eligible, summary: "" })).toBe(
      false,
    );
  });

  it("persists a deterministic blind order and maps A/B to stored baseline/candidate choices", () => {
    const args = {
      baselineArtifactRef: "dogfoodQaRuns:baseline",
      candidateArtifactRef: "dogfoodQaRuns:candidate",
      salt: "owner:scenario:timestamp",
    };
    const first = buildTasteBenchBlindOrder(args);
    const replay = buildTasteBenchBlindOrder(args);
    expect(replay).toEqual(first);
    expect(new Set([first.slotA, first.slotB])).toEqual(
      new Set(["baseline", "candidate"]),
    );
    expect(normalizeBlindTasteBenchChoice("a", first.slotA)).toBe(first.slotA);
    expect(normalizeBlindTasteBenchChoice("b", first.slotA)).toBe(
      first.slotA === "baseline" ? "candidate" : "baseline",
    );
    expect(normalizeBlindTasteBenchChoice("tie", first.slotA)).toBe("tie");
    expect(normalizeBlindTasteBenchChoice("both_fail", first.slotA)).toBe(
      "both_fail",
    );
    expect(() =>
      buildTasteBenchBlindOrder({
        ...args,
        candidateArtifactRef: args.baselineArtifactRef,
      }),
    ).toThrow(/must be different/i);
  });

  it("rejects cross-owner access without disclosing which owner mismatched", () => {
    expect(() => assertTasteBenchOwner("user-a", "user-a")).not.toThrow();
    expect(() => assertTasteBenchOwner("user-a", "user-b")).toThrow(
      "TasteBench run not found",
    );
    expect(() => assertTasteBenchOwner(null, "user-a")).toThrow(
      "TasteBench run not found",
    );
  });

  it("allows append-only lifecycle events and never rewrites terminal state", () => {
    const started = [{ eventType: "run_started" as const, sequence: 1 }];
    expect(() => assertTasteBenchEventCanAppend([], started[0])).not.toThrow();
    expect(deriveTasteBenchRunState(started)).toBe("active");

    const comparison = { eventType: "run_completed" as const, sequence: 2 };
    expect(() =>
      assertTasteBenchEventCanAppend(started, comparison),
    ).not.toThrow();
    const completed = [...started, comparison];
    expect(deriveTasteBenchRunState(completed)).toBe("completed");

    const correction = {
      eventType: "correction_recorded" as const,
      sequence: 3,
    };
    expect(() =>
      assertTasteBenchEventCanAppend(completed, correction),
    ).not.toThrow();
    expect(() =>
      assertTasteBenchEventCanAppend(completed, {
        eventType: "run_completed",
        sequence: 3,
      }),
    ).toThrow(/already been completed/i);
    expect(() =>
      assertTasteBenchEventCanAppend(completed, {
        eventType: "run_abandoned",
        sequence: 3,
      }),
    ).toThrow(/cannot be abandoned/i);
    expect(() =>
      assertTasteBenchEventCanAppend(started, {
        eventType: "correction_recorded",
        sequence: 2,
      }),
    ).toThrow(/require a completed/i);
    expect(() =>
      assertTasteBenchEventCanAppend(started, {
        eventType: "approval_interrupted",
        sequence: 2,
      }),
    ).not.toThrow();
    expect(() =>
      assertTasteBenchEventCanAppend(started, {
        eventType: "run_abandoned",
        sequence: 4,
      }),
    ).toThrow(/sequence is not append-only/i);

    const abandoned = [
      ...started,
      { eventType: "run_abandoned" as const, sequence: 2 },
    ];
    expect(deriveTasteBenchRunState(abandoned)).toBe("abandoned");
    expect(() =>
      assertTasteBenchEventCanAppend(abandoned, {
        eventType: "correction_recorded",
        sequence: 3,
      }),
    ).toThrow(/immutable/i);
  });
});
