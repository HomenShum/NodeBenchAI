import { describe, expect, it } from "vitest";

import {
  EVAL_SCORE_DIMENSIONS,
  MINIMUM_P0_EVAL_CASES,
  NODEBENCH_WORKFLOW_EVAL_BANK,
  NODEBENCH_WORKFLOW_EVAL_SUMMARY,
  WORKFLOW_LOOP_STAGES,
} from "./nodebenchWorkflowEvalBank";

const EXPECTED_P0_IDS = [
  "p0_001_research_company_follow_up",
  "p0_002_seen_company_before",
  "p0_006_chat_to_report",
  "p0_007_open_report_notebook",
  "p0_008_show_sources",
  "p0_009_export_crm_csv",
  "p0_011_start_event_context",
  "p0_012_capture_event_person_company",
  "p0_013_capture_second_company_same_event",
  "p0_014_capture_comparison_claim",
  "p0_015_rank_event_followups",
  "p0_016_post_event_memo",
  "p0_017_event_claims_need_verification",
  "p0_018_move_capture_event",
  "p0_019_compare_two_companies",
  "p0_022_person_public_footprint",
  "p0_023_confirm_uncertain_github",
  "p0_024_click_company_pill",
  "p0_025_click_person_pill",
  "p0_026_promote_entity_root",
  "p0_027_return_to_root",
  "p0_028_rewrite_notebook_section",
  "p0_029_followups_from_notebook",
  "p0_030_attach_source_claim",
  "notebook_012_resume_thread",
  "budget_001_memory_only",
  "budget_003_deep_approval",
  "budget_009_refresh_stale_only",
  "safety_001_prompt_injection",
  "safety_008_export_private_notes",
] as const;

describe("nodebench workflow eval bank", () => {
  it("keeps the minimum P0 suite at exactly 30 cases", () => {
    expect(MINIMUM_P0_EVAL_CASES).toHaveLength(30);
    expect(MINIMUM_P0_EVAL_CASES.map((testCase) => testCase.id)).toEqual(EXPECTED_P0_IDS);
  });

  it("keeps all case IDs and inputs unique", () => {
    const ids = NODEBENCH_WORKFLOW_EVAL_BANK.map((testCase) => testCase.id);
    const inputs = NODEBENCH_WORKFLOW_EVAL_BANK.map((testCase) => testCase.input);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(inputs).size).toBe(inputs.length);
  });

  it("requires every case to be scoreable and tied to the product loop", () => {
    const validStages = new Set<string>(WORKFLOW_LOOP_STAGES);
    const validDimensions = new Set<string>(EVAL_SCORE_DIMENSIONS);

    for (const testCase of NODEBENCH_WORKFLOW_EVAL_BANK) {
      expect(testCase.input.trim().length, testCase.id).toBeGreaterThan(0);
      expect(testCase.expectedBehavior.trim().length, testCase.id).toBeGreaterThan(0);
      expect(testCase.requiredStages.length, testCase.id).toBeGreaterThan(0);
      expect(testCase.primaryScoreDimensions.length, testCase.id).toBeGreaterThan(0);

      for (const stage of testCase.requiredStages) {
        expect(validStages.has(stage), `${testCase.id} invalid stage ${stage}`).toBe(true);
      }

      for (const dimension of testCase.primaryScoreDimensions) {
        expect(validDimensions.has(dimension), `${testCase.id} invalid dimension ${dimension}`).toBe(true);
      }
    }
  });

  it("covers every expanded category and every scoring dimension", () => {
    expect(NODEBENCH_WORKFLOW_EVAL_SUMMARY.categories).toEqual([
      "company_diligence",
      "event_capture",
      "export",
      "graph_traversal",
      "notebook",
      "p0_core_flow",
      "performance",
      "person_public_footprint",
      "safety_adversarial",
      "search_budget_cache",
      "workspace_agent",
    ]);

    const coveredDimensions = new Set(
      NODEBENCH_WORKFLOW_EVAL_BANK.flatMap((testCase) => testCase.primaryScoreDimensions),
    );

    for (const dimension of EVAL_SCORE_DIMENSIONS) {
      expect(coveredDimensions.has(dimension), `missing dimension ${dimension}`).toBe(true);
    }
  });
});
