import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const SourceRefSchema = z
  .object({
    label: z.string(),
    url: z.string().url().optional(),
    source_type: z
      .enum([
        "company_website",
        "press_release",
        "job_posting",
        "resume",
        "news_article",
        "research_paper",
        "conference_talk",
        "social_post",
        "other",
      ])
      .optional(),
  })
  .strict();

const EvidenceFactSchema = z
  .object({
    statement: z.string(),
    confidence: z.number().min(0).max(1),
    source_refs: z.array(SourceRefSchema),
    notes: z.string().optional(),
  })
  .strict();

const QualifiedClaimSchema = z
  .object({
    claim: z.string(),
    what_is_supported: z.string(),
    what_is_missing: z.string(),
    source_refs: z.array(SourceRefSchema).optional(),
  })
  .strict();

const SignalItemSchema = z
  .object({
    signal: z.string(),
    why_it_matters: z.string(),
    source_refs: z.array(SourceRefSchema).optional(),
  })
  .strict();

const ReferenceModelSchema = z
  .object({
    name: z.string(),
    what_it_demonstrates: z.string(),
    why_it_matters_here: z.string(),
    source_refs: z.array(SourceRefSchema).optional(),
  })
  .strict();

const CredibilityOptionSchema = z
  .object({
    direction: z.string(),
    rationale: z.string(),
  })
  .strict();

const ProductOptionSchema = z
  .object({
    option_id: z.string(),
    name: z.string(),
    fit_level: z.enum(["best_fit", "strong_adjacent", "stretch_adjacent"]),
    what_it_is: z.string(),
    core_capabilities: z.array(z.string()),
    why_it_fits: z.array(z.string()),
    customer_value: z.array(z.string()),
    defensibility: z.string().optional(),
    correct_framing: z.string().optional(),
    risks: z.array(z.string()).optional(),
    when_justified: z.string().optional(),
  })
  .strict();

const ProductLayerSchema = z
  .object({
    layer_name: z.string(),
    role: z.string(),
  })
  .strict();

const PhaseSchema = z
  .object({
    phase_id: z.string(),
    name: z.string(),
    goal: z.string(),
    build_items: z.array(z.string()),
    credible_claim_after_phase: z.string().optional(),
    why_it_matters: z.string().optional(),
    only_do_this_if: z.string().optional(),
  })
  .strict();

const SecurityRequirementSchema = z
  .object({
    requirement: z.string(),
    why_it_matters: z.string(),
  })
  .strict();

export const InHouseProductDirectionSchema = z
  .object({
    meta: z
      .object({
        analysis_id: z.string(),
        subject_company: z.string(),
        analysis_type: z.literal("in_house_product_direction"),
        generated_at: z.string().datetime(),
        confidence_level: z.enum(["high", "medium", "low"]),
        requested_focus: z.string().optional(),
        analyst_mode: z.string().optional(),
      })
      .strict(),
    executive_answer: z
      .object({
        recommended_direction: z.string(),
        why_best_fit: z.string(),
        what_to_avoid: z.string(),
        confidence_level: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    public_evidence: z
      .object({
        publicly_supported_facts: z.array(EvidenceFactSchema),
        publicly_supported_but_limited: z.array(QualifiedClaimSchema),
        not_established_by_public_evidence: z.array(z.string()),
        truth_boundary: z.string(),
      })
      .strict(),
    reputation_profile: z
      .object({
        current_visible_brand_identity: z.array(z.string()),
        proven_competence_zones: z.array(z.string()),
        adjacent_signals: z.array(SignalItemSchema),
        reputation_risk_if_mispositioned: z
          .object({
            stretch_identity: z.string(),
            likely_customer_questions: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    reference_models: z
      .object({
        category_expectations: z.array(z.string()),
        relevant_reference_implementations: z.array(ReferenceModelSchema),
        nodebench_interpretation: z.string(),
      })
      .strict(),
    credibility_filter: z
      .object({
        high_credibility_build_directions: z.array(CredibilityOptionSchema),
        medium_credibility_exploratory_directions: z.array(CredibilityOptionSchema),
        low_credibility_stretch_directions: z.array(CredibilityOptionSchema),
      })
      .strict(),
    product_options: z.array(ProductOptionSchema).min(1),
    final_recommendation: z
      .object({
        nodebench_recommendation: z.string(),
        suggested_product_shape: z.array(ProductLayerSchema),
        why_this_structure_works: z.array(z.string()),
        what_this_avoids: z.array(z.string()),
      })
      .strict(),
    phased_build_plan: z.array(PhaseSchema).min(1),
    customer_pain_points: z
      .object({
        likely_pain_points: z.array(z.string()),
        sales_note: z.string(),
      })
      .strict(),
    security_trust_requirements: z
      .object({
        requirements: z.array(SecurityRequirementSchema),
        trust_framing: z.string(),
      })
      .strict(),
    defensible_narrative: z
      .object({
        narrative_arc: z.array(z.string()),
        example_answer: z.string(),
      })
      .strict(),
    limitations: z.array(z.string()),
    final_output_block: z
      .object({
        short_recommendation: z.string(),
        best_fit_product_name: z.string(),
        best_positioning_line: z.string(),
        best_do_not_say: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
      })
      .strict(),
  })
  .strict();

export type InHouseProductDirection = z.infer<typeof InHouseProductDirectionSchema>;

export const IN_HOUSE_PRODUCT_DIRECTION_JSON_SCHEMA = zodToJsonSchema(InHouseProductDirectionSchema, {
  name: "NodeBenchInHouseProductDirection",
  target: "jsonSchema7",
  $refStrategy: "none",
});

