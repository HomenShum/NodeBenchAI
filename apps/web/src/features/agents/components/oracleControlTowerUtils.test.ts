import { describe, expect, it } from "vitest";
import {
  formatCompactNumber,
  formatUsd,
  getCrossCheckPresentation,
  getDogfoodPresentation,
  getInstitutionalVerdictPresentation,
} from "./oracleControlTowerUtils";

describe("oracleControlTowerUtils", () => {
  it("maps cross-check states to stable UI labels", () => {
    expect(getCrossCheckPresentation("aligned").label).toBe("Aligned");
    expect(getCrossCheckPresentation("drifting").questLabel).toBe("Debuff detected");
    expect(getCrossCheckPresentation("violated").label).toBe("Violated");
    expect(getCrossCheckPresentation(undefined).label).toBe("Untracked");
  });

  it("maps dogfood verdicts to builder-friendly summaries", () => {
    expect(getDogfoodPresentation("pass").label).toBe("Review clear");
    expect(getDogfoodPresentation("watch").label).toBe("Review watch");
    expect(getDogfoodPresentation("fail").label).toBe("Review blocked");
    expect(getDogfoodPresentation("missing").label).toBe("No review evidence");
  });

  it("maps institutional verdicts to readable signals", () => {
    expect(getInstitutionalVerdictPresentation("institutional_memory_aligned").label).toContain("aligned");
    expect(getInstitutionalVerdictPresentation("institutional_hallucination_risk").label).toContain("risk");
    expect(getInstitutionalVerdictPresentation("watch").label).toBe("Watch the loop");
  });

  it("formats numeric budget values safely", () => {
    expect(formatUsd()).toBe("$0.00");
    expect(formatUsd(1.239)).toBe("$1.24");
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(12_300)).toMatch(/12(\.|,)3?K/i);
  });
});
