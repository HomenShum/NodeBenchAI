import {
  InHouseProductDirectionSchema,
  type InHouseProductDirection,
} from "../types/inHouseProductDirection";

export const TESTS_ASSURED_PRODUCT_DIRECTION: InHouseProductDirection = InHouseProductDirectionSchema.parse({
  meta: {
    analysis_id: "ihpd_tests_assured_001",
    subject_company: "Tests Assured",
    analysis_type: "in_house_product_direction",
    generated_at: "2026-03-11T12:00:00Z",
    confidence_level: "high",
    requested_focus: "Credible in-house product direction after Meta-related work",
    analyst_mode: "nodebench",
  },
  executive_answer: {
    recommended_direction:
      "Build an Agentic QA + DeviceOps platform for mobile, XR, wearables, and sensor/camera-driven workflows.",
    why_best_fit:
      "This is the most credible extension of Tests Assured's public positioning in immersive-tech QA, cameras/sensors, mobile companion apps, and AI-driven automation. It productizes work patterns already adjacent to the company's visible brand without forcing a public identity pivot into robotics.",
    what_to_avoid:
      "Do not publicly position the company as a robotics company or world-model training company before there is a visible portfolio to support that claim.",
    confidence_level: "high",
  },
  public_evidence: {
    publicly_supported_facts: [
      {
        statement: "Tests Assured publicly positions itself around immersive-tech QA including AR/VR/MR/XR.",
        confidence: 0.97,
        source_refs: [{ label: "Tests Assured website", source_type: "company_website" }],
      },
      {
        statement:
          "Its service areas include cameras and sensors testing, data capture systems testing, identity/security testing, tracking validation, and mobile companion application testing.",
        confidence: 0.95,
        source_refs: [{ label: "Tests Assured services page", source_type: "company_website" }],
      },
      {
        statement: "The company markets an AI-driven automation platform and unified dashboard framing.",
        confidence: 0.91,
        source_refs: [{ label: "Tests Assured automation materials", source_type: "company_website" }],
      },
      {
        statement: "Public-facing material supports a broad Meta-related relationship.",
        confidence: 0.82,
        source_refs: [
          { label: "PR Newswire reference", source_type: "press_release" },
          { label: "Tests Assured customer/brand references", source_type: "company_website" },
        ],
      },
    ],
    publicly_supported_but_limited: [
      {
        claim: "Tests Assured worked with Meta on relevant programs.",
        what_is_supported:
          "Public materials indicate a relationship and side-channel evidence suggests Meta-adjacent device/testing work.",
        what_is_missing:
          "Exact contract scope, deliverables, internal tool ownership, and whether a specific agentic QA product was delivered.",
      },
    ],
    not_established_by_public_evidence: [
      "A specific formal contract for agentic QA automation for Meta mobile apps.",
      "A public portfolio proving a robotics-company identity.",
    ],
    truth_boundary:
      "Public evidence supports a Meta-related relationship and strong immersive/device QA expertise, but does not establish the exact deliverable described.",
  },
  reputation_profile: {
    current_visible_brand_identity: [
      "immersive-tech QA company",
      "wearables/device validation company",
      "automation-capable test operations partner",
    ],
    proven_competence_zones: [
      "XR / AR / VR / MR testing",
      "camera and sensor validation",
      "mobile companion app testing",
      "real-device hardware/software boundary testing",
      "AI-assisted automation",
      "bug triage, dogfooding, and data collection workflows",
    ],
    adjacent_signals: [
      {
        signal: "Public work patterns suggest dogfooding operations, data collection, and feedback loops.",
        why_it_matters: "These are strong precursors to DeviceOps and test operations tooling.",
      },
      {
        signal: "Public language and hiring imply internal framework and automation work.",
        why_it_matters: "This supports productization of internal execution infrastructure.",
      },
    ],
    reputation_risk_if_mispositioned: {
      stretch_identity: "robotics company",
      likely_customer_questions: [
        "What prior work proves this?",
        "Why this pivot?",
        "How is this connected to your demonstrated expertise?",
      ],
    },
  },
  reference_models: {
    category_expectations: [
      "autonomous exploration and test generation",
      "stateful user/account environments",
      "scalable execution and reproducibility",
      "verified closed-loop generation/execution/refinement",
    ],
    relevant_reference_implementations: [
      {
        name: "Sapienz-style UI-driven automated exploration",
        what_it_demonstrates: "Exploration, test harvesting, and UI-first automated testing at scale.",
        why_it_matters_here:
          "It provides a credible conceptual anchor for agentic QA without claiming equivalence.",
      },
      {
        name: "Rich-state synthetic population testing",
        what_it_demonstrates:
          "Stateful test populations and environments for better coverage and fault discovery.",
        why_it_matters_here:
          "It highlights that deeper QA requires solving the state problem, not just UI flows.",
      },
      {
        name: "Multimodal mobile agents",
        what_it_demonstrates: "Vision-assisted planning and execution on mobile experiences.",
        why_it_matters_here:
          "It aligns with the idea of remote device control plus visual validation.",
      },
    ],
    nodebench_interpretation:
      "A credible agentic product should include exploration, state, execution evidence, and verification rather than just LLM-generated scripts.",
  },
  credibility_filter: {
    high_credibility_build_directions: [
      {
        direction: "Agentic QA execution engine for mobile, XR, and wearables",
        rationale: "Direct extension of current public positioning and automation claims.",
      },
      {
        direction: "DeviceOps / DogfoodOps platform for hardware-first teams",
        rationale: "Matches operational signals around dogfooding, data collection, and bug triage.",
      },
      {
        direction: "Vision-assisted real-device testing and evidence capture",
        rationale: "Fits camera/sensor testing and reproducibility needs.",
      },
    ],
    medium_credibility_exploratory_directions: [
      {
        direction: "Hardware-in-the-loop lab automation for specific workflows",
        rationale: "Plausible, but requires careful framing and customer-specific proof.",
      },
      {
        direction: "Controlled remote-agent orchestration for device fleets",
        rationale: "Strong adjacency, but needs trust/security posture to be product-ready.",
      },
    ],
    low_credibility_stretch_directions: [
      {
        direction: "General robotics company positioning",
        rationale: "Creates an identity mismatch relative to visible portfolio.",
      },
      {
        direction: "Robotic world-model training pipeline as core public product",
        rationale: "Too far from current reputation and difficult to defend in near-term sales.",
      },
    ],
  },
  product_options: [
    {
      option_id: "opt_a",
      name: "Agentic QA Execution Engine",
      fit_level: "best_fit",
      what_it_is:
        "A system that observes state, plans tests, executes on real devices/emulators, learns from failures, and produces actionable replayable bug artifacts.",
      core_capabilities: [
        "UI/device state observation",
        "intent-driven execution",
        "adaptive repair or self-healing",
        "evidence packs with screenshots, logs, traces, video, and replay transcript",
      ],
      why_it_fits: [
        "Direct extension of current automation language",
        "Matches mobile, XR, wearables, and sensors domains",
        "Supports a believable Meta-adjacent story without overclaiming",
      ],
      customer_value: [
        "reduce flaky E2E test effort",
        "cut manual regression cost",
        "improve reproducibility for device workflows",
        "increase quality of failure artifacts",
      ],
      defensibility:
        "This product does not require a new identity; it productizes existing QA and automation strengths.",
    },
    {
      option_id: "opt_b",
      name: "DogfoodOps + Data Collection Platform",
      fit_level: "strong_adjacent",
      what_it_is:
        "A platform for managing device inventory, dogfooding missions, telemetry capture, issue intake, and data collection for hardware-first teams.",
      core_capabilities: [
        "device inventory and rollout management",
        "structured dogfood missions",
        "issue intake and deduplication",
        "telemetry and dataset capture pipelines",
      ],
      why_it_fits: [
        "Matches public signals around dogfooding, data collection, and operational QA",
        "Extends hardware-adjacent validation capabilities into a sticky workflow product",
      ],
      customer_value: [
        "better coordination of hardware test programs",
        "improved data collection discipline",
        "faster issue triage and prioritization",
      ],
      defensibility:
        "Creates an operational moat and aligns with how hardware-first teams actually work.",
    },
    {
      option_id: "opt_c",
      name: "Physical Interaction Automation as QA Infrastructure",
      fit_level: "stretch_adjacent",
      what_it_is:
        "Calibrated physical interaction rigs with vision verification and reproducible lab orchestration for cases where software-only input injection misses real failures.",
      core_capabilities: [
        "calibrated tap/gesture/button rig",
        "synchronized video verification",
        "integration into the execution engine",
      ],
      why_it_fits: [
        "Still lives at the hardware/software seam",
        "Can be framed as QA infrastructure rather than robotics identity",
      ],
      customer_value: [
        "repeatable hardware-touch testing",
        "coverage of device edge cases that software-only simulation misses",
      ],
      correct_framing: "Position as hardware-in-the-loop QA infrastructure, not a robotics pivot.",
      risks: [
        "easy for prospects to perceive as an unjustified robotics pivot",
        "higher build complexity and lower near-term sales clarity",
      ],
      when_justified:
        "Only after strong traction with software-first and ops-first QA products, or for specific customer demand.",
    },
  ],
  final_recommendation: {
    nodebench_recommendation:
      "Build a unified Agentic QA + DeviceOps platform, with physical automation as an optional later add-on.",
    suggested_product_shape: [
      {
        layer_name: "Agentic QA execution engine",
        role: "software-first core value and fastest path to credible demos",
      },
      {
        layer_name: "DeviceOps / DogfoodOps layer",
        role: "operational and data workflow differentiation for hardware-centric clients",
      },
      {
        layer_name: "Physical interaction automation add-on",
        role: "premium capability for specific edge cases where software-only testing is insufficient",
      },
    ],
    why_this_structure_works: [
      "aligns with current public reputation",
      "addresses real customer pain points",
      "creates a path into deeper automation without identity mismatch",
    ],
    what_this_avoids: [
      "random robotics pivot",
      "fake pedigree claims",
      "selling an R&D fantasy instead of an adjacent productized capability",
    ],
  },
  phased_build_plan: [
    {
      phase_id: "phase_1",
      name: "Mobile + companion-app agentic testing MVP",
      goal: "Ship a reliable intent-driven test runtime for Android/iOS with strong observability.",
      build_items: [
        "execution runtime for real devices and emulators",
        "test-intent format and planner",
        "failure artifact and replay system",
      ],
      credible_claim_after_phase:
        "We automate touch workflows and real-device validation across mobile and connected-device experiences.",
    },
    {
      phase_id: "phase_2",
      name: "Stateful test users and environments",
      goal: "Solve the state problem that commodity UI automation misses.",
      build_items: [
        "synthetic accounts and permissions",
        "seeded content and test worlds",
        "safe test-universe environment controls",
      ],
      why_it_matters: "Enables deeper coverage and more realistic fault discovery.",
    },
    {
      phase_id: "phase_3",
      name: "XR / wearables extensions",
      goal: "Extend the same engine into the company's strongest visible reputation zone.",
      build_items: [
        "gesture / controller / gaze / spatial input abstractions",
        "sensor-heavy data capture and evaluation workflows",
        "XR-specific evidence and reproducibility",
      ],
    },
    {
      phase_id: "phase_4",
      name: "Physical interaction rigs",
      goal: "Handle edge cases where software-only simulation fails.",
      build_items: [
        "calibrated tap/gesture/button rig",
        "synchronized video verification",
        "orchestration integration",
      ],
      only_do_this_if: "Specific customer demand justifies it.",
    },
  ],
  customer_pain_points: {
    likely_pain_points: [
      "flaky real-device workflows",
      "expensive manual regression for XR/mobile/wearables",
      "hard-to-reproduce sensor/camera bugs",
      "poor evidence capture during escalations",
      "weak operational tooling for dogfooding and device fleets",
    ],
    sales_note:
      "Validate these in scoped engineering conversations rather than assuming uniform need across customers.",
  },
  security_trust_requirements: {
    requirements: [
      {
        requirement: "strict sandboxing of automation and remote-control tools",
        why_it_matters: "Prevents unsafe execution and reduces customer security objections.",
      },
      {
        requirement: "signed or verifiable extensions",
        why_it_matters: "Reduces supply-chain and plugin trust risk.",
      },
      {
        requirement: "explicit approvals for destructive actions",
        why_it_matters: "Creates safer enterprise adoption path.",
      },
      {
        requirement: "audit logs and replayability",
        why_it_matters: "Supports trust, debugging, and compliance.",
      },
      {
        requirement: "clean separation between customer data and agent reasoning context",
        why_it_matters: "Protects sensitive data and improves enterprise fit.",
      },
    ],
    trust_framing:
      "Security and traceability should be positioned as part of the product identity, not as an afterthought.",
  },
  defensible_narrative: {
    narrative_arc: [
      "The company has already worked on complex hardware/software experience validation.",
      "Those engagements repeatedly exposed automation, reproducibility, and test-operations bottlenecks.",
      "Internal tooling emerged around execution, data capture, triage, and reproducibility.",
      "The company is now productizing those patterns into an Agentic QA + DeviceOps platform.",
      "Physical automation is a method within QA infrastructure where needed, not a separate robotics identity.",
    ],
    example_answer:
      "Our core work has been validating complex consumer device experiences across XR, wearables, companion apps, sensors, and connectivity. We repeatedly saw teams struggle with reproducibility, real-device coverage, and operational QA overhead. We built internal automation and test-ops workflows to address that, and we are now productizing them into an Agentic QA + DeviceOps platform. Where physical repeatability matters, we add hardware-in-the-loop style automation, but this is fundamentally QA infrastructure, not a random pivot into robotics.",
  },
  limitations: [
    "Public evidence supports a Meta-related relationship, but not the exact contract scope described.",
    "Resume-level and side-channel evidence is supportive, not contractual proof.",
    "Reference systems from Meta and research literature are directionally useful, not evidence that the company has already built equivalent systems.",
    "Final direction should be validated through customer scoping with engineers.",
  ],
  final_output_block: {
    short_recommendation:
      "Tests Assured should build a unified Agentic QA + DeviceOps platform for mobile, XR, wearables, and sensor/camera-driven workflows. This is the most credible extension of its public reputation and avoids the customer skepticism that would come from branding the company as a robotics player too early.",
    best_fit_product_name: "Agentic QA + DeviceOps Platform",
    best_positioning_line: "End-to-end QA infrastructure for complex device experiences.",
    best_do_not_say: "We pivoted into robotics.",
    confidence: "high",
  },
});

