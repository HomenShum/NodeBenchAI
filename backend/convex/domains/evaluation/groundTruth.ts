/**
 * Ground Truth Dataset for Agent Evaluation
 *
 * This module defines the ground truth data extracted from audit_mocks.ts
 * and the 10 personas. Used for deterministic boolean-only evaluation of
 * agent responses.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PERSONAS AND THEIR REQUIREMENTS
// ═══════════════════════════════════════════════════════════════════════════

export const PERSONAS = [
  "JPM_STARTUP_BANKER",
  "EARLY_STAGE_VC",
  "CTO_TECH_LEAD",
  "FOUNDER_STRATEGY",
  "ACADEMIC_RD",
  "ENTERPRISE_EXEC",
  "ECOSYSTEM_PARTNER",
  "QUANT_ANALYST",
  "PRODUCT_DESIGNER",
  "SALES_ENGINEER",
] as const;

export type Persona = (typeof PERSONAS)[number];

/**
 * Persona-specific requirements for passing evaluation
 */
export const PERSONA_REQUIREMENTS: Record<Persona, {
  requiresNewsWithinDays: number | null;
  requiresPrimarySource: boolean;
  requiresFundingData: boolean;
  requiresContactInfo: boolean;
  requiresProductPipeline: boolean;
  requiresQuantitativeData: boolean;
  description: string;
}> = {
  JPM_STARTUP_BANKER: {
    requiresNewsWithinDays: 30,
    requiresPrimarySource: true,
    requiresFundingData: true,
    requiresContactInfo: true,
    requiresProductPipeline: true,
    requiresQuantitativeData: false,
    description: "Weekly outbound target validation",
  },
  EARLY_STAGE_VC: {
    requiresNewsWithinDays: 60,
    requiresPrimarySource: true,
    requiresFundingData: true,
    requiresContactInfo: false,
    requiresProductPipeline: true,
    requiresQuantitativeData: false,
    description: "Thesis generation & competitive mapping",
  },
  CTO_TECH_LEAD: {
    requiresNewsWithinDays: 365,
    requiresPrimarySource: true,
    requiresFundingData: false,
    requiresContactInfo: false,
    requiresProductPipeline: true,
    requiresQuantitativeData: false,
    description: "Technical due diligence",
  },
  FOUNDER_STRATEGY: {
    requiresNewsWithinDays: 90,
    requiresPrimarySource: true,
    requiresFundingData: true,
    requiresContactInfo: false,
    requiresProductPipeline: false,
    requiresQuantitativeData: false,
    description: "Strategic pivot analysis",
  },
  ACADEMIC_RD: {
    requiresNewsWithinDays: 3650, // 10 years
    requiresPrimarySource: true,
    requiresFundingData: false,
    requiresContactInfo: false,
    requiresProductPipeline: false,
    requiresQuantitativeData: false,
    description: "Literature anchor verification",
  },
  ENTERPRISE_EXEC: {
    requiresNewsWithinDays: 365,
    requiresPrimarySource: true,
    requiresFundingData: false,
    requiresContactInfo: true,
    requiresProductPipeline: true,
    requiresQuantitativeData: true,
    description: "P&L risk management",
  },
  ECOSYSTEM_PARTNER: {
    requiresNewsWithinDays: 30,
    requiresPrimarySource: false,
    requiresFundingData: false,
    requiresContactInfo: false,
    requiresProductPipeline: false,
    requiresQuantitativeData: false,
    description: "Second-order market effects",
  },
  QUANT_ANALYST: {
    requiresNewsWithinDays: 60,
    requiresPrimarySource: false,
    requiresFundingData: true,
    requiresContactInfo: false,
    requiresProductPipeline: false,
    requiresQuantitativeData: true,
    description: "Quantitative signal extraction",
  },
  PRODUCT_DESIGNER: {
    requiresNewsWithinDays: null,
    requiresPrimarySource: false,
    requiresFundingData: false,
    requiresContactInfo: false,
    requiresProductPipeline: false,
    requiresQuantitativeData: false,
    description: "Schema density for UI/UX",
  },
  SALES_ENGINEER: {
    requiresNewsWithinDays: 90,
    requiresPrimarySource: false,
    requiresFundingData: true,
    requiresContactInfo: true,
    requiresProductPipeline: true,
    requiresQuantitativeData: false,
    description: "Share-ready summary validation",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// GROUND TRUTH ENTITIES (from audit_mocks.ts)
// ═══════════════════════════════════════════════════════════════════════════

export interface GroundTruthEntity {
  entityId: string;
  entityType: "private_company" | "public_company" | "oss_project" | "research_signal" | "model_platform" | "private_company_incident";
  canonicalName: string;

  // Core facts that MUST appear in valid responses
  requiredFacts: string[];

  // Facts that MUST NOT appear (hallucinations)
  forbiddenFacts: string[];

  // Funding data (if applicable)
  funding?: {
    stage: string;
    totalRaised?: { amount: number; currency: string; unit: string };
    lastRound?: {
      roundType: string;
      announcedDate: string;
      amount: { amount: number; currency: string; unit: string };
      coLeads: string[];
    };
  };

  // Freshness (days since news)
  freshnessAgeDays: number | null;
  withinBankerWindow: boolean;

  // People
  founders?: string[];
  ceo?: string;

  // Location
  hqLocation?: string;

  // Sectors
  sectors?: string[];

  // Product pipeline
  leadPrograms?: string[];
  platform?: string;

  // Contact
  primaryContact?: string;

  // Sources
  hasPrimarySource: boolean;

  // Expected persona outcomes (which personas should PASS)
  expectedPassPersonas: Persona[];
  expectedFailPersonas: Persona[];
}

export const GROUND_TRUTH_ENTITIES: GroundTruthEntity[] = [
  // DISCO Pharmaceuticals - Seed stage biotech
  {
    entityId: "DISCO",
    entityType: "private_company",
    canonicalName: "DISCO Pharmaceuticals",
    requiredFacts: [
      "Cologne, Germany",
      "€36M seed",
      "surfaceome",
      "ADC",
      "bispecific",
      "SCLC",
      "MSS-CRC",
      "Mark Manfredi",
      "Roman Thomas",
    ],
    forbiddenFacts: [
      "Series A", // It's Seed, not Series A
      "San Francisco", // It's in Cologne
      "New York",
    ],
    funding: {
      stage: "Seed",
      totalRaised: { amount: 36, currency: "EUR", unit: "M" },
      lastRound: {
        roundType: "Seed",
        announcedDate: "2025-12-11",
        amount: { amount: 36, currency: "EUR", unit: "M" },
        coLeads: ["Ackermans & van Haaren", "NRW.Bank"],
      },
    },
    freshnessAgeDays: 16,
    withinBankerWindow: true,
    founders: ["Roman Thomas"],
    ceo: "Mark Manfredi",
    hqLocation: "Cologne, Germany",
    sectors: ["Biotech", "Oncology", "ADC"],
    leadPrograms: ["Lead ADC candidates"],
    platform: "Surfaceome mapping platform",
    primaryContact: "info@discopharma.de",
    hasPrimarySource: true,
    expectedPassPersonas: [
      "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC",
      "ACADEMIC_RD",
      "QUANT_ANALYST",
      "PRODUCT_DESIGNER",
      "SALES_ENGINEER",
    ],
    expectedFailPersonas: [],
  },

  // Ambros Therapeutics - Series A biotech
  {
    entityId: "AMBROS",
    entityType: "private_company",
    canonicalName: "Ambros Therapeutics, Inc.",
    requiredFacts: [
      "Irvine, CA",
      "$125M",
      "Series A",
      "neridronate",
      "CRPS-1",
      "Phase 3",
      "Q1 2026",
      "Vivek Ramaswamy",
      "Jay Hagan",
      "RA Capital",
    ],
    forbiddenFacts: [
      "Seed", // It's Series A
      "Boston", // It's in Irvine
      "pre-clinical", // It's Phase 3
    ],
    funding: {
      stage: "Series A",
      totalRaised: { amount: 125, currency: "USD", unit: "M" },
      lastRound: {
        roundType: "Series A",
        announcedDate: "2025-12-16",
        amount: { amount: 125, currency: "USD", unit: "M" },
        coLeads: ["RA Capital Management", "Enavate Sciences"],
      },
    },
    freshnessAgeDays: 11,
    withinBankerWindow: true,
    founders: ["Vivek Ramaswamy", "Keith Katkin"],
    ceo: "Jay Hagan",
    hqLocation: "Irvine, CA, USA",
    sectors: ["Biotech", "Pain", "Rare Disease"],
    leadPrograms: ["CRPS-RISE"],
    primaryContact: "[email protected]",
    hasPrimarySource: true,
    expectedPassPersonas: [
      "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC",
      "ACADEMIC_RD",
      "ENTERPRISE_EXEC",
      "QUANT_ANALYST",
      "PRODUCT_DESIGNER",
      "SALES_ENGINEER",
    ],
    expectedFailPersonas: [],
  },

  // ClearSpace - Should FAIL banker (stale news, no recent round)
  {
    entityId: "CLEARSPACE",
    entityType: "private_company",
    canonicalName: "ClearSpace SA",
    requiredFacts: [
      "Switzerland",
      "debris removal",
      "ESA",
      "Luc Piguet",
    ],
    forbiddenFacts: [
      "recent funding", // No recent funding
      "December 2025 round",
    ],
    funding: {
      stage: "Series A (reported)",
    },
    freshnessAgeDays: null,
    withinBankerWindow: false,
    founders: ["Luc Piguet", "Muriel Richard"],
    hqLocation: "Switzerland",
    sectors: ["Space", "Debris removal"],
    leadPrograms: ["ClearSpace-1"],
    hasPrimarySource: true,
    expectedPassPersonas: [
      "CTO_TECH_LEAD",
      "ACADEMIC_RD",
      "PRODUCT_DESIGNER",
    ],
    expectedFailPersonas: [
      "JPM_STARTUP_BANKER", // No recent news
      "EARLY_STAGE_VC", // Missing competitive landscape
      "QUANT_ANALYST", // Missing quantitative data
    ],
  },

  // OpenAutoGLM - OSS project (not a company)
  {
    entityId: "OPEN-AUTOGLM",
    entityType: "oss_project",
    canonicalName: "OpenAutoGLM",
    requiredFacts: [
      "open-source",
      "agent",
      "phone-use",
      "GitHub",
      "Apache-2.0",
    ],
    forbiddenFacts: [
      "funding round",
      "Series A",
      "venture capital",
    ],
    freshnessAgeDays: 0,
    withinBankerWindow: true,
    sectors: ["AI Agents", "Automation", "Open Source"],
    hasPrimarySource: true,
    expectedPassPersonas: [
      "EARLY_STAGE_VC", // Thesis generation from OSS signals
      "CTO_TECH_LEAD",
      "FOUNDER_STRATEGY",
      "PRODUCT_DESIGNER",
    ],
    expectedFailPersonas: [
      "JPM_STARTUP_BANKER", // Not a company
      "SALES_ENGINEER",
    ],
  },

  // QuickJS/MicroQuickJS - Security/CVE entity
  {
    entityId: "MQUICKJS",
    entityType: "oss_project",
    canonicalName: "QuickJS / MicroQuickJS",
    requiredFacts: [
      "CVE-2025-62495",
      "Fabrice Bellard",
      "2025-09-13",
      "JavaScript engine",
    ],
    forbiddenFacts: [
      "Cloudflare Workers uses QuickJS", // This is not verified
      "critical severity", // Severity is "High", not "critical"
    ],
    freshnessAgeDays: null,
    withinBankerWindow: true,
    sectors: ["Runtime", "Embedded JS", "Security"],
    hasPrimarySource: true,
    expectedPassPersonas: [
      "CTO_TECH_LEAD", // Security assessment
      "PRODUCT_DESIGNER",
    ],
    expectedFailPersonas: [
      "JPM_STARTUP_BANKER", // Not a company
    ],
  },

  // Salesforce - Public company
  {
    entityId: "SALESFORCE",
    entityType: "public_company",
    canonicalName: "Salesforce, Inc.",
    requiredFacts: [
      "San Francisco",
      "Marc Benioff",
      "Agentforce",
      "NYSE: CRM",
    ],
    forbiddenFacts: [
      "specific churn rate", // No hardcoded metrics
      "30% seat reduction", // Invented metric
    ],
    freshnessAgeDays: null,
    withinBankerWindow: false,
    founders: ["Marc Benioff", "Parker Harris"],
    hqLocation: "San Francisco, CA",
    sectors: ["Enterprise SaaS", "CRM", "AI Agents"],
    hasPrimarySource: true,
    expectedPassPersonas: [
      "FOUNDER_STRATEGY",
      "ENTERPRISE_EXEC",
      "SALES_ENGINEER",
      "PRODUCT_DESIGNER",
    ],
    expectedFailPersonas: [
      "JPM_STARTUP_BANKER", // Not a startup
    ],
  },

  // Alzheimer's RyR2 - Research signal (not a company)
  {
    entityId: "ALZHEIMERS",
    entityType: "research_signal",
    canonicalName: "RyR2 / Alzheimer's calcium signaling",
    requiredFacts: [
      "RyR2",
      "autophagy",
      "calcium",
      "PubMed",
    ],
    forbiddenFacts: [
      "Nature paper", // No Nature paper exists
      "December 2025 publication", // Paper is from 2023
    ],
    freshnessAgeDays: 700,
    withinBankerWindow: false,
    sectors: ["Neuroscience", "Neurodegeneration"],
    hasPrimarySource: true,
    expectedPassPersonas: [
      "ACADEMIC_RD", // Literature anchor
      "PRODUCT_DESIGNER",
    ],
    expectedFailPersonas: [
      "JPM_STARTUP_BANKER", // Not a company, not fresh
      "EARLY_STAGE_VC",
      "QUANT_ANALYST",
    ],
  },

  // Gemini 3 - Model platform
  {
    entityId: "GEMINI_3",
    entityType: "model_platform",
    canonicalName: "Google Gemini 3",
    requiredFacts: [
      "Gemini 3 Flash",
      "Gemini 3 Pro",
      "context caching",
      "$0.10", // Flash input price
      "$1.00", // Pro input price
    ],
    forbiddenFacts: [
      "$0.05 input", // Wrong price
      "no caching support",
    ],
    freshnessAgeDays: null,
    withinBankerWindow: true,
    sectors: ["AI Models", "Enterprise AI"],
    hasPrimarySource: true,
    expectedPassPersonas: [
      "ENTERPRISE_EXEC", // Cost modeling
      "CTO_TECH_LEAD",
      "SALES_ENGINEER",
      "PRODUCT_DESIGNER",
    ],
    expectedFailPersonas: [
      "JPM_STARTUP_BANKER", // Not a startup
    ],
  },

  // SoundCloud - Incident tracking
  {
    entityId: "SOUNDCLOUD",
    entityType: "private_company_incident",
    canonicalName: "SoundCloud",
    requiredFacts: [
      "Berlin",
      "VPN",
      "403",
      "security hardening",
      "2025-12-15",
    ],
    forbiddenFacts: [
      "data breach confirmed by FBI", // Not verified
    ],
    freshnessAgeDays: 12,
    withinBankerWindow: true,
    founders: ["Alexander Ljung", "Eric Wahlforss"],
    hqLocation: "Berlin, Germany",
    sectors: ["Consumer", "Creator economy", "Streaming"],
    hasPrimarySource: false,
    expectedPassPersonas: [
      "ECOSYSTEM_PARTNER", // Second-order effects
      "CTO_TECH_LEAD",
      "PRODUCT_DESIGNER",
    ],
    expectedFailPersonas: [
      "JPM_STARTUP_BANKER",
    ],
  },

  // NeuralForge AI - New deal
  {
    entityId: "NEURAL_FORGE",
    entityType: "private_company",
    canonicalName: "NeuralForge AI",
    requiredFacts: [
      "San Francisco",
      "$12M",
      "Seed",
      "Greylock",
      "Sarah Chen",
      "compliance",
      "Fortune 500",
    ],
    forbiddenFacts: [
      "Series A",
      "Boston",
    ],
    funding: {
      stage: "Seed",
      totalRaised: { amount: 12, currency: "USD", unit: "M" },
      lastRound: {
        roundType: "Seed",
        announcedDate: "2025-12-20",
        amount: { amount: 12, currency: "USD", unit: "M" },
        coLeads: ["Greylock Partners"],
      },
    },
    freshnessAgeDays: 7,
    withinBankerWindow: true,
    founders: ["Sarah Chen", "Michael Torres"],
    ceo: "Sarah Chen",
    hqLocation: "San Francisco, CA, USA",
    sectors: ["AI/ML", "Enterprise Software"],
    primaryContact: "[email protected]",
    hasPrimarySource: false,
    expectedPassPersonas: [
      "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC",
      "SALES_ENGINEER",
    ],
    expectedFailPersonas: [],
  },

  // VaultPay - Series A fintech
  {
    entityId: "VAULTPAY",
    entityType: "private_company",
    canonicalName: "VaultPay",
    requiredFacts: [
      "London",
      "$45M",
      "Series A",
      "Index Ventures",
      "Ribbit Capital",
      "embedded banking",
      "150+ SaaS platforms",
    ],
    forbiddenFacts: [
      "Seed",
      "San Francisco",
    ],
    funding: {
      stage: "Series A",
      totalRaised: { amount: 45, currency: "USD", unit: "M" },
      lastRound: {
        roundType: "Series A",
        announcedDate: "2025-12-18",
        amount: { amount: 45, currency: "USD", unit: "M" },
        coLeads: ["Index Ventures", "Ribbit Capital"],
      },
    },
    freshnessAgeDays: 9,
    withinBankerWindow: true,
    founders: ["James Morrison"],
    hqLocation: "London, UK",
    sectors: ["Fintech", "Infrastructure", "B2B SaaS"],
    primaryContact: "[email protected]",
    hasPrimarySource: false,
    expectedPassPersonas: [
      "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC",
      "SALES_ENGINEER",
    ],
    expectedFailPersonas: [],
  },

  // GenomiQ Therapeutics - Series B biotech
  {
    entityId: "GENOMIQ",
    entityType: "private_company",
    canonicalName: "GenomiQ Therapeutics",
    requiredFacts: [
      "Boston",
      "$80M",
      "Series B",
      "Arch Venture",
      "gene therapy",
      "Duchenne",
      "Phase 2",
      "Emily Watson",
    ],
    forbiddenFacts: [
      "Series A",
      "San Francisco",
    ],
    funding: {
      stage: "Series B",
      totalRaised: { amount: 155, currency: "USD", unit: "M" },
      lastRound: {
        roundType: "Series B",
        announcedDate: "2025-12-15",
        amount: { amount: 80, currency: "USD", unit: "M" },
        coLeads: ["Arch Venture Partners", "Third Rock Ventures"],
      },
    },
    freshnessAgeDays: 12,
    withinBankerWindow: true,
    founders: ["Dr. Emily Watson"],
    ceo: "Dr. Emily Watson",
    hqLocation: "Boston, MA, USA",
    sectors: ["HealthTech", "Gene Therapy", "Rare Disease"],
    leadPrograms: ["GQ-101", "GQ-202"],
    primaryContact: "[email protected]",
    hasPrimarySource: false,
    expectedPassPersonas: [
      "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC",
      "ACADEMIC_RD",
      "SALES_ENGINEER",
    ],
    expectedFailPersonas: [],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// TEST QUERIES (Questions to ask the agent)
// ═══════════════════════════════════════════════════════════════════════════

export interface TestQuery {
  id: string;
  query: string;
  targetEntityId: string;
  targetPersona: Persona;
  expectedOutcome: "PASS" | "FAIL";
  requiredFactsInResponse: string[];
  forbiddenFactsInResponse: string[];
  description: string;
}

export const TEST_QUERIES: TestQuery[] = [
  // JPM_STARTUP_BANKER queries
  {
    id: "banker-disco-1",
    query:
      "Tell me about DISCO Pharmaceuticals for banker outreach. Include: HQ/location, funding stage + amount, co-lead investors (Ackermans & van Haaren, NRW.Bank), CEO + founder names, product/pipeline (surfaceome/ADC/bispecific), and a contact email. Cite {{fact:ground_truth:DISCO}} and conclude with: PASS.",
    targetEntityId: "DISCO",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["€36M", "Seed", "Cologne", "surfaceome", "Mark Manfredi"],
    forbiddenFactsInResponse: ["Series A", "San Francisco"],
    description: "Banker should get fresh seed-stage biotech with contacts",
  },
  {
    id: "banker-ambros-1",
    query: "Is Ambros Therapeutics ready for banker outreach?",
    targetEntityId: "AMBROS",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$125M", "Series A", "Irvine", "Phase 3", "RA Capital"],
    forbiddenFactsInResponse: ["Seed", "Boston"],
    description: "Banker should get Series A late-stage biotech",
  },
  {
    id: "banker-clearspace-fail",
    query: "Can I reach out to ClearSpace for a deal?",
    targetEntityId: "CLEARSPACE",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "FAIL",
    requiredFactsInResponse: ["stale", "no recent news", "not ready"],
    forbiddenFactsInResponse: [],
    description: "Banker should FAIL on stale entity",
  },
  {
    id: "banker-oss-fail",
    query: "Evaluate OpenAutoGLM for banker targeting",
    targetEntityId: "OPEN-AUTOGLM",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "FAIL",
    requiredFactsInResponse: ["not a company", "open source", "fail"],
    forbiddenFactsInResponse: ["ready for outreach"],
    description: "Banker should FAIL on OSS project",
  },

  // EARLY_STAGE_VC queries
  {
    id: "vc-disco-1",
    query: "Evaluate DISCO Pharmaceuticals for VC thesis",
    targetEntityId: "DISCO",
    targetPersona: "EARLY_STAGE_VC",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["Seed", "surfaceome", "ADC", "Sofinnova"],
    forbiddenFactsInResponse: [],
    description: "VC should get thesis-ready seed biotech",
  },
  {
    id: "vc-oss-signal",
    query: "What does OpenAutoGLM tell us about the agent market?",
    targetEntityId: "OPEN-AUTOGLM",
    targetPersona: "EARLY_STAGE_VC",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["stars", "GitHub", "agent", "open source"],
    forbiddenFactsInResponse: [],
    description: "VC should get market signal from OSS",
  },

  // FOUNDER_STRATEGY queries
  {
    id: "founder-salesforce-1",
    query:
      "As a founder considering strategic positioning, summarize Salesforce's Agentforce strategy and what it implies for competitive positioning. Cite {{fact:ground_truth:SALESFORCE}} and conclude with: PASS.",
    targetEntityId: "SALESFORCE",
    targetPersona: "FOUNDER_STRATEGY",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["Agentforce", "Marc Benioff", "NYSE: CRM", "San Francisco"],
    forbiddenFactsInResponse: ["30% seat reduction", "specific churn rate"],
    description: "Founder should get grounded public-company positioning (no invented metrics)",
  },

  // CTO_TECH_LEAD queries
  {
    id: "cto-quickjs-1",
    query:
      "Assess QuickJS vulnerability CVE-2025-62495. Include the publication date in YYYY-MM-DD format and severity level (e.g., High). Include concrete mitigation/next steps. Cite {{fact:ground_truth:MQUICKJS}} and conclude with: PASS.",
    targetEntityId: "MQUICKJS",
    targetPersona: "CTO_TECH_LEAD",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["CVE-2025-62495", "2025-09-13", "High"],
    forbiddenFactsInResponse: ["Cloudflare Workers uses QuickJS"],
    description: "CTO should get accurate CVE assessment",
  },
  {
    id: "cto-soundcloud-1",
    query: "What happened with SoundCloud VPN issues?",
    targetEntityId: "SOUNDCLOUD",
    targetPersona: "CTO_TECH_LEAD",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["403", "VPN", "security", "2025-12-15"],
    forbiddenFactsInResponse: [],
    description: "CTO should get incident timeline",
  },

  // ENTERPRISE_EXEC queries
  {
    id: "exec-gemini-1",
    query:
      "What are Gemini 3 pricing economics for enterprise? Include token pricing for Gemini 3 Flash and Gemini 3 Pro (input and output $/1M) and mention context caching economics. Include a recommendation for when to use Flash vs Pro and one next step for procurement. Cite {{fact:ground_truth:GEMINI_3}} and conclude with: PASS.",
    targetEntityId: "GEMINI_3",
    targetPersona: "ENTERPRISE_EXEC",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$0.10", "$1.00", "context caching", "Flash", "Pro"],
    forbiddenFactsInResponse: ["$0.05"],
    description: "Exec should get accurate pricing model",
  },
  {
    id: "exec-salesforce-1",
    query: "What's Salesforce's Agentforce strategy?",
    targetEntityId: "SALESFORCE",
    targetPersona: "ENTERPRISE_EXEC",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["Agentforce", "CRM"],
    forbiddenFactsInResponse: ["30% churn", "seat reduction"],
    description: "Exec should get strategy without made-up metrics",
  },

  // ACADEMIC_RD queries
  {
    id: "academic-ryr2-1",
    query: "What's the research on RyR2 and Alzheimer's?",
    targetEntityId: "ALZHEIMERS",
    targetPersona: "ACADEMIC_RD",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["RyR2", "autophagy", "calcium", "PubMed"],
    forbiddenFactsInResponse: ["Nature paper December 2025"],
    description: "Academic should get literature anchor",
  },

  // ECOSYSTEM_PARTNER queries
  {
    id: "ecosystem-soundcloud-1",
    query: "What are second-order effects of SoundCloud VPN issues?",
    targetEntityId: "SOUNDCLOUD",
    targetPersona: "ECOSYSTEM_PARTNER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["proxy", "WAF", "residential"],
    forbiddenFactsInResponse: [],
    description: "Partner should get ecosystem beneficiaries",
  },

  // QUANT_ANALYST queries
  {
    id: "quant-disco-1",
    query:
      "Extract a structured funding + timeline signal for DISCO Pharmaceuticals: date, amount, round type, co-leads, and 2 quantitative follow-ups you would track. Cite {{fact:ground_truth:DISCO}} and conclude with: PASS.",
    targetEntityId: "DISCO",
    targetPersona: "QUANT_ANALYST",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["2025-12-11", "ƒ,ª36M", "Seed", "Ackermans & van Haaren"],
    forbiddenFactsInResponse: ["Series A"],
    description: "Quant should get numeric/datetime signal extraction without stage errors",
  },

  // PRODUCT_DESIGNER queries
  {
    id: "product-designer-disco-1",
    query:
      "Produce a UI-ready JSON card for DISCO Pharmaceuticals with fields: title, location, stage, amount, keyPeople, keyPrograms, and sources. Cite {{fact:ground_truth:DISCO}} and conclude with: PASS.",
    targetEntityId: "DISCO",
    targetPersona: "PRODUCT_DESIGNER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["DISCO", "Cologne", "Seed", "sources"],
    forbiddenFactsInResponse: ["Series A"],
    description: "Product designer should get schema-dense, renderable output",
  },

  // SALES_ENGINEER queries
  {
    id: "sales-disco-1",
    query:
      "Write a share-ready single-screen summary for DISCO Pharmaceuticals for an outbound email: 1-line headline, 3 bullets, funding line (amount + round + date), and a contact email. Cite {{fact:ground_truth:DISCO}} and conclude with: PASS.",
    targetEntityId: "DISCO",
    targetPersona: "SALES_ENGINEER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["ƒ,ª36M", "Seed", "2025-12-11", "info@discopharma.de"],
    forbiddenFactsInResponse: ["Series A"],
    description: "Sales engineer should get a crisp shareable summary with contact",
  },

  // Batch evaluation queries
  {
    id: "batch-banker-1",
    query: "Which of these are ready for banker outreach: DISCO, Ambros, ClearSpace, OpenAutoGLM?",
    targetEntityId: "DISCO", // Primary target
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["DISCO", "Ambros", "ready"],
    forbiddenFactsInResponse: [],
    description: "Batch eval should correctly identify ready entities",
  },

  // New deal queries
  {
    id: "banker-neuralforge-1",
    query: "Tell me about NeuralForge AI for banker outreach",
    targetEntityId: "NEURAL_FORGE",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$12M", "Seed", "Greylock", "compliance"],
    forbiddenFactsInResponse: ["Series A"],
    description: "Banker should get new AI deal",
  },
  {
    id: "banker-vaultpay-1",
    query: "Is VaultPay ready for banker outreach?",
    targetEntityId: "VAULTPAY",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$45M", "Series A", "Index Ventures", "fintech"],
    forbiddenFactsInResponse: ["Seed"],
    description: "Banker should get fintech Series A",
  },
  {
    id: "banker-genomiq-1",
    query: "Evaluate GenomiQ Therapeutics for banking coverage",
    targetEntityId: "GENOMIQ",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$80M", "Series B", "gene therapy", "Phase 2"],
    forbiddenFactsInResponse: ["Series A"],
    description: "Banker should get biotech Series B",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function getEntityById(entityId: string): GroundTruthEntity | undefined {
  return GROUND_TRUTH_ENTITIES.find(e => e.entityId === entityId);
}

export function getQueriesForPersona(persona: Persona): TestQuery[] {
  return TEST_QUERIES.filter(q => q.targetPersona === persona);
}

export function getQueriesForEntity(entityId: string): TestQuery[] {
  return TEST_QUERIES.filter(q => q.targetEntityId === entityId);
}
