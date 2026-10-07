/**
 * Media Context Evaluation Scenarios
 *
 * These scenarios test:
 * 1. File upload context injection
 * 2. Multi-modal synthesis (file + web search)
 * 3. Image/PDF/video analysis integration
 */

import { v } from "convex/values";

// ============================================================================
// TYPES
// ============================================================================

export interface FileUploadSetup {
  type: string; // MIME type
  name: string;
  mockContent?: string;
  mockAnalysis?: string;
}

export interface MediaContextValidation {
  mustCallTools?: string[];
  mustNotCall?: string[];
  contextMustInclude?: string;
  outputMustReference?: string[];
  outputMustContain?: string[];
  mustSynthesizeFromMultipleSources?: boolean;
}

export interface MediaContextScenario {
  id: string;
  name: string;
  category: "file-upload" | "multi-modal" | "image-analysis" | "document-analysis";
  query: string;
  setup: {
    uploadFile?: FileUploadSetup;
    uploadFiles?: FileUploadSetup[];
    injectMemory?: {
      entity: string;
      facts: string[];
    };
  };
  validation: MediaContextValidation;
}

// ============================================================================
// FILE UPLOAD CONTEXT SCENARIOS
// ============================================================================

export const FILE_UPLOAD_SCENARIOS: MediaContextScenario[] = [
  {
    id: "media_pdf_analysis",
    name: "Media: PDF analysis with context injection",
    category: "file-upload",
    query: "Analyze this pitch deck and tell me if DISCO is a good banker target",
    setup: {
      uploadFile: {
        type: "application/pdf",
        name: "DISCO_Pitch_Deck.pdf",
        mockContent: "DISCO Pharmaceuticals\nSeed Round: €36M\nPlatform: Disc-Seq\nHQ: Cologne\nFounder: Fabian Niehaus",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile", "queryMemory"],
      contextMustInclude: "attachedFiles",
      outputMustReference: ["pitch deck", "DISCO", "Seed"],
    },
  },
  {
    id: "media_image_entity_extraction",
    name: "Media: Image analysis with entity extraction",
    category: "image-analysis",
    query: "Who are these people and what company are they from?",
    setup: {
      uploadFile: {
        type: "image/png",
        name: "team_photo.png",
        mockAnalysis: "Photo shows Fabian Niehaus (CEO) and team at laboratory setting with DISCO Pharmaceuticals branding visible",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["Fabian Niehaus", "CEO", "DISCO"],
    },
  },
  {
    id: "media_screenshot_analysis",
    name: "Media: Screenshot analysis",
    category: "image-analysis",
    query: "What does this dashboard show?",
    setup: {
      uploadFile: {
        type: "image/png",
        name: "dashboard_screenshot.png",
        mockAnalysis: "Financial dashboard showing Q4 2025 metrics: Revenue $2.3M, MRR growth 15%, 45 active customers, churn rate 2.1%",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["Revenue", "MRR", "customers"],
    },
  },
  {
    id: "media_sec_filing_pdf",
    name: "Media: SEC filing PDF analysis",
    category: "document-analysis",
    query: "Summarize the key risks from this 10-K filing",
    setup: {
      uploadFile: {
        type: "application/pdf",
        name: "TSLA_10K_2025.pdf",
        mockContent: "Tesla Inc 10-K Annual Report\nRisk Factors:\n- Supply chain concentration\n- Regulatory uncertainty\n- Competition from legacy automakers\n- Cybersecurity threats",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["risk", "supply chain", "regulatory"],
    },
  },
  {
    id: "media_csv_data_analysis",
    name: "Media: CSV data analysis",
    category: "document-analysis",
    query: "Analyze this funding data and identify trends",
    setup: {
      uploadFile: {
        type: "text/csv",
        name: "biotech_funding_2025.csv",
        mockContent: "Company,Round,Amount,Date\nDISCO,Seed,36000000,2025-11\nAmbros,SeriesA,125000000,2025-10\nGenomiQ,SeriesB,80000000,2025-09",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["funding", "trend"],
    },
  },
];

// ============================================================================
// MULTI-MODAL SYNTHESIS SCENARIOS
// ============================================================================

export const MULTI_MODAL_SCENARIOS: MediaContextScenario[] = [
  {
    id: "multi_modal_doc_plus_web",
    name: "Multi-Modal: Uploaded doc + web search synthesis",
    category: "multi-modal",
    query: "Compare this old memo's valuation to current news about DISCO's funding",
    setup: {
      uploadFile: {
        type: "application/pdf",
        name: "old_disco_memo.pdf",
        mockContent: "DISCO Pharmaceuticals Internal Memo (2024)\nEstimated valuation: €20M\nPre-seed stage\nEarly platform development",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile", "linkupSearch", "queryMemory"],
      outputMustContain: ["€20M", "€36M", "increased"],
      mustSynthesizeFromMultipleSources: true,
    },
  },
  {
    id: "multi_modal_image_plus_memory",
    name: "Multi-Modal: Image + memory synthesis",
    category: "multi-modal",
    query: "Is this the CEO we discussed earlier?",
    setup: {
      uploadFile: {
        type: "image/jpeg",
        name: "person_photo.jpg",
        mockAnalysis: "Professional headshot of middle-aged man, business attire, German newspaper interview backdrop",
      },
      injectMemory: {
        entity: "DISCO",
        facts: ["CEO: Fabian Niehaus", "HQ: Cologne, Germany"],
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile", "queryMemory"],
      outputMustContain: ["Fabian Niehaus", "CEO"],
      mustSynthesizeFromMultipleSources: true,
    },
  },
  {
    id: "multi_modal_multiple_files",
    name: "Multi-Modal: Multiple file comparison",
    category: "multi-modal",
    query: "Compare these two pitch decks and tell me which company is more investable",
    setup: {
      uploadFiles: [
        {
          type: "application/pdf",
          name: "company_a_deck.pdf",
          mockContent: "Company A\nSeries A: $50M\nRevenue: $2M ARR\nTeam: 30 people",
        },
        {
          type: "application/pdf",
          name: "company_b_deck.pdf",
          mockContent: "Company B\nSeed: $10M\nRevenue: $500K ARR\nTeam: 12 people",
        },
      ],
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["comparison", "investable"],
      mustSynthesizeFromMultipleSources: true,
    },
  },
  {
    id: "multi_modal_doc_plus_sec",
    name: "Multi-Modal: Document + SEC data",
    category: "multi-modal",
    query: "Cross-reference this investor deck with Tesla's latest SEC filings",
    setup: {
      uploadFile: {
        type: "application/pdf",
        name: "tesla_investor_deck.pdf",
        mockContent: "Tesla Investor Presentation Q4 2025\nDeliveries: 500K vehicles\nRevenue guidance: $30B\nNew factory announcements",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile", "delegateToSECAgent"],
      mustSynthesizeFromMultipleSources: true,
    },
  },
  {
    id: "multi_modal_video_plus_research",
    name: "Multi-Modal: Video analysis + entity research",
    category: "multi-modal",
    query: "Watch this product demo and tell me how it compares to competitors",
    setup: {
      uploadFile: {
        type: "video/mp4",
        name: "product_demo.mp4",
        mockAnalysis: "Product demonstration video showing AI-powered drug discovery platform. Key features: molecular simulation, binding prediction, 10x faster screening than traditional methods.",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile", "linkupSearch"],
      outputMustContain: ["competitor"],
      mustSynthesizeFromMultipleSources: true,
    },
  },
];

// ============================================================================
// SPECIALIZED MEDIA ANALYSIS SCENARIOS
// ============================================================================

export const SPECIALIZED_MEDIA_SCENARIOS: MediaContextScenario[] = [
  {
    id: "media_chart_extraction",
    name: "Media: Chart data extraction",
    category: "image-analysis",
    query: "Extract the data from this chart and summarize the trends",
    setup: {
      uploadFile: {
        type: "image/png",
        name: "revenue_chart.png",
        mockAnalysis: "Bar chart showing quarterly revenue: Q1: $1.2M, Q2: $1.5M, Q3: $1.8M, Q4: $2.3M. Clear upward trend with 25% average quarterly growth.",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["trend", "growth", "quarter"],
    },
  },
  {
    id: "media_org_chart",
    name: "Media: Org chart analysis",
    category: "image-analysis",
    query: "Who are the key executives in this org chart?",
    setup: {
      uploadFile: {
        type: "image/png",
        name: "org_chart.png",
        mockAnalysis: "Organization chart showing: CEO - Fabian Niehaus, CTO - Dr. Maria Schmidt, CFO - Thomas Weber, VP Research - Dr. Klaus Richter",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["CEO", "CTO", "CFO"],
    },
  },
  {
    id: "media_contract_review",
    name: "Media: Contract document review",
    category: "document-analysis",
    query: "Highlight the key terms and risks in this contract",
    setup: {
      uploadFile: {
        type: "application/pdf",
        name: "partnership_agreement.pdf",
        mockContent: "Partnership Agreement\nParties: DISCO Pharmaceuticals, Roche AG\nTerm: 5 years\nMilestone payments: Up to $500M\nExclusivity: Oncology indications only\nIP Rights: Joint ownership",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["terms", "milestone", "exclusivity"],
    },
  },
  {
    id: "media_presentation_slides",
    name: "Media: Presentation slides analysis",
    category: "document-analysis",
    query: "Summarize the key points from this investor presentation",
    setup: {
      uploadFile: {
        type: "application/pdf",
        name: "investor_pres.pdf",
        mockContent: "VaultPay Investor Presentation\nSlide 1: Market Opportunity - $50B TAM\nSlide 2: Product - AI-powered payments\nSlide 3: Traction - 200% YoY growth\nSlide 4: Team - Ex-Stripe, Ex-Square\nSlide 5: Ask - $45M Series A",
      },
    },
    validation: {
      mustCallTools: ["analyzeMediaFile"],
      outputMustContain: ["market", "traction", "team"],
    },
  },
];

// ============================================================================
// ALL MEDIA CONTEXT SCENARIOS
// ============================================================================

export const ALL_MEDIA_CONTEXT_SCENARIOS: MediaContextScenario[] = [
  ...FILE_UPLOAD_SCENARIOS,
  ...MULTI_MODAL_SCENARIOS,
  ...SPECIALIZED_MEDIA_SCENARIOS,
];

// ============================================================================
// SCENARIO VALIDATOR SCHEMA
// ============================================================================

export const mediaContextScenarioValidator = v.object({
  id: v.string(),
  name: v.string(),
  category: v.union(
    v.literal("file-upload"),
    v.literal("multi-modal"),
    v.literal("image-analysis"),
    v.literal("document-analysis")
  ),
  query: v.string(),
  setup: v.object({
    uploadFile: v.optional(
      v.object({
        type: v.string(),
        name: v.string(),
        mockContent: v.optional(v.string()),
        mockAnalysis: v.optional(v.string()),
      })
    ),
    uploadFiles: v.optional(
      v.array(
        v.object({
          type: v.string(),
          name: v.string(),
          mockContent: v.optional(v.string()),
          mockAnalysis: v.optional(v.string()),
        })
      )
    ),
    injectMemory: v.optional(
      v.object({
        entity: v.string(),
        facts: v.array(v.string()),
      })
    ),
  }),
  validation: v.object({
    mustCallTools: v.optional(v.array(v.string())),
    mustNotCall: v.optional(v.array(v.string())),
    contextMustInclude: v.optional(v.string()),
    outputMustReference: v.optional(v.array(v.string())),
    outputMustContain: v.optional(v.array(v.string())),
    mustSynthesizeFromMultipleSources: v.optional(v.boolean()),
  }),
});
