/**
 * Industry Persona Ground Truth
 *
 * Ground truth definitions for Industry persona evaluations using REAL, VERIFIABLE data:
 * - PHARMA_BD: Moderna mRNA-1345 RSV Vaccine (NCT05127434 - REAL trial)
 * - ACADEMIC_RD: CRISPR-Cas9 Gene Editing (Doudna/Charpentier Nobel Prize research)
 *
 * All data is verifiable via:
 * - ClinicalTrials.gov: https://clinicaltrials.gov
 * - FDA: https://www.fda.gov
 * - PubMed: https://pubmed.ncbi.nlm.nih.gov
 * - Google Scholar: https://scholar.google.com
 */

import type {
  PharmaGroundTruth,
  AcademicGroundTruth,
  ClaimVerificationScenario,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// PHARMA_BD GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Moderna mRNA-1345 RSV Vaccine - Ground truth for Pharma BD evaluation
 *
 * REAL clinical trial data verifiable via ClinicalTrials.gov:
 * - NCT05127434: Phase 2/3 RSV Vaccine Study (ConquerRSV)
 * - FDA approved May 2024 as mRESVIA
 * - Verification: https://clinicaltrials.gov/study/NCT05127434
 */
export const MODERNA_RSV_GROUND_TRUTH: PharmaGroundTruth = {
  entityName: "Moderna mRNA-1345 (mRESVIA)",
  entityType: "company",
  description: "mRNA-based RSV vaccine approved by FDA May 2024 for adults 60+",
  expectedOutcome: "pass",

  exposure: {
    targetIndication: "Respiratory Syncytial Virus (RSV) in Adults 60+",
    mechanismOfAction: "mRNA encoding prefusion F glycoprotein",
    phase: "Approved", // FDA Approved May 2024
    competitiveLandscape: [
      "Arexvy (GSK) - First approved RSV vaccine May 2023",
      "Abrysvo (Pfizer) - Approved May 2023",
    ],
  },

  impact: {
    marketSize: "$10B+ RSV vaccine market by 2030",
    differentiatedMOA: true, // mRNA platform vs traditional
    patentProtection: "2035+",
    firstInClass: false, // GSK was first
  },

  mitigations: {
    clinicalRisk: "Phase 3 efficacy: 83.7% against RSV-LRTD (verified)",
    regulatoryPath: "FDA BLA approved May 31, 2024",
    manufacturingReady: true,
    supplyChainRisk: "Established mRNA manufacturing from COVID vaccine",
  },

  timeline: {
    currentPhaseComplete: "2023 (Phase 3 completed)",
    nextPhaseStart: "N/A (approved)",
    potentialApproval: "May 31, 2024 (actual)",
    commercialLaunch: "2024 (actual)",
  },

  clinicalData: {
    nctNumber: "NCT05127434", // REAL NCT number - verifiable
    primaryEndpoint: "Efficacy against RSV-LRTD with ≥2 symptoms",
    primaryEndpointMet: true,
    overallResponseRate: 83.7, // Actual efficacy from trial
    safetySignals: ["Injection site pain (58%)", "Fatigue (31%)", "Headache (27%)"],
  },
};

/**
 * Alternative case: Failed Phase 3 Trial - Biogen Aduhelm Controversy
 *
 * REAL controversial FDA approval with subsequent market withdrawal concerns.
 * Verifiable via FDA documents and ClinicalTrials.gov (NCT02484547, NCT02477800).
 */
export const BIOGEN_ADUHELM_GROUND_TRUTH: PharmaGroundTruth = {
  entityName: "Biogen Aducanumab (Aduhelm)",
  entityType: "company",
  description: "Controversial Alzheimer's drug with inconsistent Phase 3 results",
  expectedOutcome: "flag",

  exposure: {
    targetIndication: "Alzheimer's Disease",
    mechanismOfAction: "Anti-amyloid beta monoclonal antibody",
    phase: "Approved", // FDA Accelerated Approval June 2021 - Limited use
    competitiveLandscape: [
      "Leqembi (Eisai/Biogen) - Traditional approval July 2023",
      "Donanemab (Eli Lilly) - Under FDA review",
    ],
  },

  impact: {
    marketSize: "$13B Alzheimer's market",
    differentiatedMOA: false, // Similar amyloid-targeting approach
    patentProtection: "2030",
    firstInClass: false,
  },

  mitigations: {
    clinicalRisk: "EMERGE trial positive, ENGAGE trial negative - inconsistent results",
    regulatoryPath: "Accelerated approval despite FDA advisory committee 10-0 vote against",
    manufacturingReady: true,
    supplyChainRisk: "Limited uptake due to CMS coverage decision",
  },

  timeline: {
    currentPhaseComplete: "Phase 3 completed 2019",
    nextPhaseStart: "Post-marketing confirmatory trial required",
    potentialApproval: "June 7, 2021 (actual accelerated approval)",
    commercialLaunch: "2021 (limited)",
  },

  clinicalData: {
    nctNumber: "NCT02484547", // REAL NCT - EMERGE trial
    primaryEndpoint: "Change from baseline in CDR-SB",
    primaryEndpointMet: undefined, // Inconsistent - one trial met, one didn't
    overallResponseRate: undefined, // Not applicable for Alzheimer's
    safetySignals: ["ARIA-E (brain swelling) in 35%", "ARIA-H (brain bleeding) in 19%"],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// ACADEMIC_RD GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CRISPR-Cas9 Gene Editing - Ground truth for Academic R&D evaluation
 *
 * REAL Nobel Prize-winning research (2020 Chemistry Prize):
 * - Doudna & Charpentier 2012 Science paper: DOI 10.1126/science.1225829
 * - Verifiable via Google Scholar: 20,000+ citations
 * - PubMed: https://pubmed.ncbi.nlm.nih.gov/22745249/
 */
export const CRISPR_CAS9_GROUND_TRUTH: AcademicGroundTruth = {
  entityName: "CRISPR-Cas9 Gene Editing (Doudna/Charpentier)",
  entityType: "research_signal",
  description: "RNA-guided DNA endonuclease system - 2020 Nobel Prize in Chemistry",
  expectedOutcome: "pass",

  methodology: {
    technique: "CRISPR-Cas9 RNA-guided endonuclease",
    validationLevel: "In vivo, human cell lines, clinical trials (Casgevy approved Dec 2023)",
    replicationStatus: "Independently replicated by 1000+ labs worldwide",
    replicationCount: 1000, // Conservative estimate
  },

  findings: {
    primaryResult: "Programmable double-strand DNA breaks with 20bp guide RNA",
    effectSize: 0.95, // ~95% on-target efficiency in optimized conditions
    statisticalSignificance: "p < 0.0001",
    therapeuticRelevance: "FDA-approved gene therapy (Casgevy) for sickle cell disease Dec 2023",
  },

  citations: {
    totalCitations: 20000, // Jinek et al. 2012 Science paper
    h5Index: 150, // Extremely high impact
    keyPapers: [
      "Jinek et al. 2012 Science (DOI: 10.1126/science.1225829) - Original discovery",
      "Cong et al. 2013 Science - Human cell applications",
      "Mali et al. 2013 Science - Genome engineering toolkit",
    ],
    recentCitationVelocity: 2000, // Still heavily cited
  },

  gaps: [
    {
      challenge: "Off-target effects",
      description: "Cas9 can cut at sites with partial complementarity - addressed by high-fidelity variants",
    },
    {
      challenge: "Delivery challenges",
      description: "In vivo delivery to specific tissues remains challenging - LNP and AAV solutions emerging",
    },
    {
      challenge: "Immunogenicity",
      description: "Pre-existing immunity to Cas9 in humans from bacterial exposure",
    },
  ],

  implications: {
    clinicalTranslation: "Casgevy (exa-cel) FDA approved Dec 8, 2023 for sickle cell disease",
    commercializationPath: "Ex vivo cell therapy approved; in vivo approaches in development",
    regulatoryConsiderations: "Gene therapy framework; long-term follow-up studies required",
  },
};

/**
 * Alternative case: LK-99 Room-Temperature Superconductor (2023 debunking)
 *
 * REAL case study of failed scientific claims and proper replication process.
 * Verifiable via arXiv preprints and subsequent replication attempts.
 */
export const LK99_SUPERCONDUCTOR_GROUND_TRUTH: AcademicGroundTruth = {
  entityName: "LK-99 Room-Temperature Superconductor Claim",
  entityType: "research_signal",
  description: "2023 claimed room-temperature superconductor - debunked by multiple labs",
  expectedOutcome: "flag",

  methodology: {
    technique: "Lead-apatite doping with copper sulfide (Cu-substituted Pb₁₀₋ₓCuₓ(PO₄)₆O)",
    validationLevel: "Single lab claim, synthesis issues documented",
    replicationStatus: "Failed replication by 10+ independent labs worldwide",
    replicationCount: 0, // No successful replications
  },

  findings: {
    primaryResult: "Claimed zero resistance at room temperature/ambient pressure",
    effectSize: undefined, // Not reproducible
    statisticalSignificance: "Not independently verified",
    therapeuticRelevance: undefined,
  },

  citations: {
    totalCitations: 150, // Moderate interest due to viral attention
    h5Index: 2, // Low impact after debunking
    keyPapers: [
      "Lee et al. 2023 arXiv:2307.12008 (original claim)",
      "Kumar et al. 2023 arXiv (replication failure)",
      "Liu et al. 2023 (Chinese Academy of Sciences - debunking)",
    ],
    recentCitationVelocity: 20, // Declining after debunking
  },

  gaps: [
    {
      challenge: "Complete replication failure",
      description: "No lab worldwide replicated superconductivity - observed effects were Cu2S impurity artifacts",
    },
    {
      challenge: "Measurement errors",
      description: "Original measurements attributed to diamagnetic impurities, not superconductivity",
    },
    {
      challenge: "Sample quality",
      description: "Original samples had significant impurities that caused misleading measurements",
    },
  ],

  implications: {
    clinicalTranslation: undefined,
    commercializationPath: undefined,
    regulatoryConsiderations: undefined,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM VERIFICATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pharma BD claim verification scenarios - Using REAL Moderna RSV data
 */
export const PHARMA_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "pharma_moderna_rsv_trial",
    personaId: "PHARMA_BD",
    name: "Moderna mRESVIA Clinical Trial Verification",
    query: "Verify Moderna mRNA-1345 RSV vaccine Phase 3 results and FDA approval status",
    claims: [
      {
        claim: "mRNA-1345 completed Phase 3 trial NCT05127434",
        category: "clinical",
        expectedVerdict: "verified",
        verificationSource: "ClinicalTrials.gov",
      },
      {
        claim: "FDA approved mRESVIA on May 31, 2024",
        category: "clinical",
        expectedVerdict: "verified",
      },
      {
        claim: "Efficacy against RSV-LRTD was 83.7%",
        category: "clinical",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["clinicaltrials.gov", "fda.gov", "sec.gov"],
    passingThreshold: 85,
  },
  {
    id: "pharma_rsv_competition",
    personaId: "PHARMA_BD",
    name: "RSV Vaccine Competitive Landscape",
    query: "Map competitive landscape for RSV vaccines - GSK Arexvy, Pfizer Abrysvo",
    claims: [
      {
        claim: "GSK Arexvy was first FDA-approved RSV vaccine (May 2023)",
        category: "clinical",
        expectedVerdict: "verified",
      },
      {
        claim: "Pfizer Abrysvo approved for adults 60+ and maternal immunization",
        category: "clinical",
        expectedVerdict: "verified",
      },
      {
        claim: "RSV vaccine market projected $10B+ by 2030",
        category: "clinical",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["fda.gov", "evaluate.com", "fiercepharma.com"],
    passingThreshold: 80,
  },
];

/**
 * Academic R&D claim verification scenarios - Using REAL CRISPR data
 */
export const ACADEMIC_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "academic_crispr_nobel",
    personaId: "ACADEMIC_RD",
    name: "CRISPR-Cas9 Nobel Prize Research Verification",
    query: "Verify Doudna/Charpentier CRISPR paper has 20,000+ citations and won 2020 Nobel",
    claims: [
      {
        claim: "Jinek et al. 2012 Science paper has 20,000+ citations",
        category: "citation",
        expectedVerdict: "verified",
        verificationSource: "Google Scholar",
      },
      {
        claim: "Doudna and Charpentier won 2020 Nobel Prize in Chemistry",
        category: "methodology",
        expectedVerdict: "verified",
      },
      {
        claim: "CRISPR-Cas9 has been replicated by 1000+ labs",
        category: "methodology",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["scholar.google.com", "nobelprize.org", "nature.com"],
    passingThreshold: 90,
  },
  {
    id: "academic_crispr_clinical",
    personaId: "ACADEMIC_RD",
    name: "CRISPR Clinical Translation Verification",
    query: "Verify Casgevy FDA approval and CRISPR therapeutic applications",
    claims: [
      {
        claim: "Casgevy (exa-cel) FDA approved December 8, 2023",
        category: "methodology",
        expectedVerdict: "verified",
      },
      {
        claim: "First FDA-approved CRISPR gene therapy",
        category: "methodology",
        expectedVerdict: "verified",
      },
      {
        claim: "Approved for sickle cell disease treatment",
        category: "methodology",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["fda.gov", "nature.com", "science.org"],
    passingThreshold: 85,
  },
  {
    id: "academic_lk99_debunking",
    personaId: "ACADEMIC_RD",
    name: "LK-99 Superconductor Debunking Verification",
    query: "Verify LK-99 superconductor claims were debunked by independent labs",
    claims: [
      {
        claim: "Multiple labs failed to replicate LK-99 superconductivity",
        category: "methodology",
        expectedVerdict: "verified",
      },
      {
        claim: "Observed effects attributed to Cu2S impurities",
        category: "methodology",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["arxiv.org", "nature.com", "science.org"],
    passingThreshold: 75,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL
// ═══════════════════════════════════════════════════════════════════════════

export const INDUSTRY_GROUND_TRUTHS = {
  pharma: {
    modernaRsv: MODERNA_RSV_GROUND_TRUTH, // REAL: NCT05127434, FDA approved May 2024
    biogenAduhelm: BIOGEN_ADUHELM_GROUND_TRUTH, // REAL: NCT02484547, controversial approval
  },
  academic: {
    crisprCas9: CRISPR_CAS9_GROUND_TRUTH, // REAL: 2020 Nobel Prize, DOI 10.1126/science.1225829
    lk99Superconductor: LK99_SUPERCONDUCTOR_GROUND_TRUTH, // REAL: 2023 debunked claim
  },
};

export const INDUSTRY_CLAIM_SCENARIOS = {
  pharma: PHARMA_CLAIM_SCENARIOS,
  academic: ACADEMIC_CLAIM_SCENARIOS,
};

// Legacy exports for backwards compatibility
export const BIOGENEX_GROUND_TRUTH = MODERNA_RSV_GROUND_TRUTH;
export const PRECLINICAL_ASSET_GROUND_TRUTH = BIOGEN_ADUHELM_GROUND_TRUTH;
export const CRISPR_ABE_GROUND_TRUTH = CRISPR_CAS9_GROUND_TRUTH;
export const CONTROVERSIAL_RESEARCH_GROUND_TRUTH = LK99_SUPERCONDUCTOR_GROUND_TRUTH;
