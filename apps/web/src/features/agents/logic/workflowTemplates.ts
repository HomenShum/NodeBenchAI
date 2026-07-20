/**
 * workflowTemplates.ts
 *
 * Persona-Driven Workflow Templates for Deep Agent 2.0
 *
 * Each template defines:
 * 1. Sourcing: Parallel wide-net data gathering
 * 2. Kill Chain: Fast prune criteria
 * 3. Enrichment: Deep parallel analysis for survivors
 * 4. Output: Final synthesis format
 */

import type { WorkflowTemplate, Persona } from "../types/reasoningGraph";

// ============================================================================
// J.P. Morgan Commercial Banking Template
// ============================================================================

export const JPM_BANKER_TEMPLATE: WorkflowTemplate = {
  id: "jpm-commercial-prospecting",
  name: "Commercial Banking Prospecting",
  description: "Morning routine for Middle Market & Innovation Economy bankers",
  personaId: "jpm-banker",

  triggers: [
    "find seed deals",
    "morning prospecting",
    "find funded startups",
    "deal sourcing",
    "find series a companies",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "fortune-term-sheet",
        source: "Fortune Term Sheet",
        prompt: "Scan Fortune Term Sheet for Seed/Series A rounds announced in the last 48 hours. Extract company name, amount, lead investor, sector.",
      },
      {
        id: "axios-pro-rata",
        source: "Axios Pro Rata",
        prompt: "Scan Axios Pro Rata for recent funding announcements. Focus on AI, Fintech, Life Sciences. Extract company details.",
      },
      {
        id: "techcrunch",
        source: "TechCrunch",
        prompt: "Scan TechCrunch funding news for Seed and Series A rounds. Prioritize enterprise SaaS and healthcare tech.",
      },
      {
        id: "strictlyvc",
        source: "StrictlyVC",
        prompt: "Scan StrictlyVC newsletter for fresh funding rounds. Note any companies with notable founder backgrounds.",
      },
    ],
    max_candidates: 30,
  },

  verification_criteria: [
    {
      id: "sector_fit",
      label: "Sector Fit",
      prompt: "Is the sector AI, Fintech, Life Sciences, Enterprise SaaS, or Healthcare? (Exclude Crypto, Gaming, Consumer Social)",
      required: true,
    },
    {
      id: "geo_fit",
      label: "Geography",
      prompt: "Is HQ in US, UK, EU, or Canada?",
      required: true,
    },
    {
      id: "deal_size",
      label: "Deal Size",
      prompt: "Is the funding round > $2M? (Exclude very small friends & family rounds)",
      required: true,
    },
    {
      id: "stage_fit",
      label: "Stage Fit",
      prompt: "Is this Seed, Seed+, or Series A? (Exclude later stages where relationships are set)",
      required: false,
      weight: 0.7,
    },
  ],

  enrichment_tasks: [
    {
      id: "founder_pedigree",
      label: "Founder Pedigree",
      prompt: `Research the founders:
1. Academic background (Ivy League, top engineering schools, MBA programs)
2. Previous employers (Ex-FAANG, Ex-Goldman, Ex-McKinsey, Ex-Stripe)
3. Serial founder status (previous exits via M&A or IPO)
4. Any JPM alumni network connections`,
      icon: "Users",
      color: "blue",
    },
    {
      id: "technical_moat",
      label: "Technical Moat & Compliance",
      prompt: `Research IP and regulatory status:
1. Patents filed (USPTO, Google Patents)
2. For Biotech: FDA status, Clinical Trial phase
3. For SaaS/Fintech: SOC2, GDPR compliance, financial licenses
4. Any proprietary technology or trade secrets mentioned`,
      icon: "Shield",
      color: "purple",
    },
    {
      id: "network_map",
      label: "Network & Influence",
      prompt: `Map the circle of influence:
1. Lead investor identity (Sequoia, a16z, Flagship, etc.)
2. Board members and advisors
3. Existing relationships JPM might leverage
4. Mutual connections in the network`,
      icon: "Network",
      color: "amber",
    },
    {
      id: "financial_fit",
      label: "Financial & Banking Fit",
      prompt: `Assess banking opportunity:
1. Estimated burn rate based on funding and headcount
2. Current banking relationship (Mercury, Brex, SVB, etc.)
3. Treasury management needs
4. Potential for full-service commercial relationship`,
      icon: "DollarSign",
      color: "green",
    },
  ],

  output_format: "shortlist_with_outreach_hooks",
  output_prompt: `Create a banker's shortlist with personalized outreach hooks.
For each qualified company, provide:
1. Company snapshot (name, sector, funding, location)
2. Founder highlight (best credential)
3. Moat highlight (IP or regulatory status)
4. Connection hook (lead VC or mutual connection)
5. Suggested opening line for outreach email`,
};

// ============================================================================
// Venture Capital (Early Stage) Template
// ============================================================================

export const VC_EARLY_STAGE_TEMPLATE: WorkflowTemplate = {
  id: "vc-early-stage-sourcing",
  name: "Early Stage Deal Sourcing",
  description: "Find thesis-matching startups before competitors",
  personaId: "vc-partner",

  triggers: [
    "find thesis matches",
    "deal sourcing",
    "find pre-seed companies",
    "scout startups",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "hacker-news",
        source: "Hacker News",
        prompt: "Scan Show HN and top stories for early-stage startups with traction signals. Look for GitHub stars, user testimonials.",
      },
      {
        id: "product-hunt",
        source: "Product Hunt",
        prompt: "Scan Product Hunt launches for products with high engagement. Focus on developer tools and B2B SaaS.",
      },
      {
        id: "twitter-signals",
        source: "Twitter/X",
        prompt: "Scan tech Twitter for founders announcing launches or hitting milestones. Look for organic virality.",
      },
    ],
    max_candidates: 50,
  },

  verification_criteria: [
    {
      id: "valuation_fit",
      label: "Valuation",
      prompt: "Is implied valuation likely < $15M? (Early enough for meaningful ownership)",
      required: true,
    },
    {
      id: "no_tier1_lead",
      label: "Not Preempted",
      prompt: "Is there no Tier 1 VC (Sequoia, a16z, Benchmark) already on cap table?",
      required: true,
    },
    {
      id: "thesis_match",
      label: "Thesis Match",
      prompt: "Does it match fund thesis (AI infrastructure, developer tools, fintech)?",
      required: true,
    },
  ],

  enrichment_tasks: [
    {
      id: "traction_signals",
      label: "Traction Signals",
      prompt: "Research traction: GitHub stars, NPM downloads, Discord members, Twitter followers, testimonials.",
      icon: "TrendingUp",
      color: "green",
    },
    {
      id: "team_background",
      label: "Team Background",
      prompt: "Research founders: Ex-Stripe, Ex-OpenAI, Ex-Meta. Technical depth. Previous startup experience.",
      icon: "Users",
      color: "blue",
    },
    {
      id: "market_timing",
      label: "Market Timing",
      prompt: "Assess market timing: Is there a catalyst? New regulation? Platform shift? Adjacent success?",
      icon: "Clock",
      color: "purple",
    },
  ],

  output_format: "deal_memo",
  output_prompt: "Create a one-page deal memo for IC discussion.",
};

// ============================================================================
// CTO / Tech Lead Vendor Assessment Template
// ============================================================================

export const CTO_VENDOR_TEMPLATE: WorkflowTemplate = {
  id: "cto-vendor-assessment",
  name: "Vendor Risk Assessment",
  description: "Evaluate third-party tools and services for security and reliability",
  personaId: "cto",

  triggers: [
    "vendor assessment",
    "evaluate tool",
    "security review",
    "should we use",
    "compare vendors",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "official-docs",
        source: "Official Documentation",
        prompt: "Review official documentation for security practices, compliance certifications, and architecture.",
      },
      {
        id: "community-signals",
        source: "Community Feedback",
        prompt: "Scan HN, Reddit, and Twitter for user experiences, outages, and complaints.",
      },
      {
        id: "security-reports",
        source: "Security Databases",
        prompt: "Check CVE database, security advisories, and any published audit reports.",
      },
    ],
    max_candidates: 5,
  },

  verification_criteria: [
    {
      id: "soc2",
      label: "SOC2 Compliance",
      prompt: "Does the vendor have SOC2 Type II certification?",
      required: true,
    },
    {
      id: "uptime",
      label: "Uptime SLA",
      prompt: "Does the vendor offer 99.9%+ uptime SLA with documented track record?",
      required: true,
    },
    {
      id: "no_critical_cve",
      label: "No Critical CVEs",
      prompt: "Are there any unpatched critical CVEs in the last 12 months?",
      required: true,
    },
  ],

  enrichment_tasks: [
    {
      id: "security_posture",
      label: "Security Posture",
      prompt: "Deep dive on security: encryption at rest/transit, access controls, incident response, penetration testing.",
      icon: "Shield",
      color: "red",
    },
    {
      id: "reliability",
      label: "Reliability",
      prompt: "Check DownDetector history, status page, and any public postmortems.",
      icon: "Activity",
      color: "green",
    },
    {
      id: "data_handling",
      label: "Data Handling",
      prompt: "Review data processing agreement, subprocessors list, GDPR compliance, data residency options.",
      icon: "Database",
      color: "blue",
    },
  ],

  output_format: "risk_matrix",
  output_prompt: "Create a risk matrix with go/no-go recommendation.",
};

// ============================================================================
// Research Analyst Template
// ============================================================================

export const RESEARCH_ANALYST_TEMPLATE: WorkflowTemplate = {
  id: "research-analyst-deep-dive",
  name: "Company Deep Dive",
  description: "Comprehensive research for investment or competitive analysis",
  personaId: "research-analyst",

  triggers: [
    "research",
    "deep dive",
    "analyze company",
    "competitive analysis",
    "market research",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "sec-filings",
        source: "SEC EDGAR",
        prompt: "Pull latest 10-K, 10-Q, and 8-K filings. Extract key financials and risk factors.",
      },
      {
        id: "news-coverage",
        source: "News Sources",
        prompt: "Scan Bloomberg, Reuters, WSJ for recent coverage. Note sentiment and key events.",
      },
      {
        id: "patent-landscape",
        source: "USPTO",
        prompt: "Map patent portfolio and recent filings. Identify technology moats.",
      },
    ],
    max_candidates: 1,
  },

  verification_criteria: [
    {
      id: "data_availability",
      label: "Data Available",
      prompt: "Is sufficient public data available for analysis?",
      required: true,
    },
  ],

  enrichment_tasks: [
    {
      id: "financial_analysis",
      label: "Financial Analysis",
      prompt: "Analyze revenue growth, margins, cash flow, and key ratios.",
      icon: "BarChart",
      color: "green",
    },
    {
      id: "competitive_position",
      label: "Competitive Position",
      prompt: "Map competitive landscape, market share, and differentiation.",
      icon: "Target",
      color: "blue",
    },
    {
      id: "leadership_team",
      label: "Leadership Team",
      prompt: "Profile C-suite and board. Note tenure, background, and compensation.",
      icon: "Users",
      color: "purple",
    },
    {
      id: "risk_factors",
      label: "Risk Factors",
      prompt: "Identify key risks: regulatory, competitive, operational, financial.",
      icon: "AlertTriangle",
      color: "red",
    },
  ],

  output_format: "deal_memo",
  output_prompt: "Create an investment memo with thesis, risks, and recommendation.",
};

// ============================================================================
// Product Manager Template
// ============================================================================

export const PRODUCT_MANAGER_TEMPLATE: WorkflowTemplate = {
  id: "pm-competitive-intel",
  name: "Competitive Intelligence",
  description: "Track competitor features, pricing, and positioning",
  personaId: "product-manager",

  triggers: [
    "competitor analysis",
    "feature comparison",
    "what is competitor doing",
    "pricing research",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "product-pages",
        source: "Product Pages",
        prompt: "Analyze competitor product pages, pricing tiers, and feature lists.",
      },
      {
        id: "changelog",
        source: "Changelogs",
        prompt: "Review recent changelog entries and release notes. What are they building?",
      },
      {
        id: "reviews",
        source: "Review Sites",
        prompt: "Analyze G2, Capterra reviews. What do users love/hate?",
      },
    ],
    max_candidates: 10,
  },

  verification_criteria: [
    {
      id: "direct_competitor",
      label: "Direct Competitor",
      prompt: "Is this a direct competitor in our market segment?",
      required: true,
    },
  ],

  enrichment_tasks: [
    {
      id: "feature_matrix",
      label: "Feature Matrix",
      prompt: "Build feature-by-feature comparison matrix.",
      icon: "Grid",
      color: "blue",
    },
    {
      id: "pricing_analysis",
      label: "Pricing Analysis",
      prompt: "Compare pricing models, tiers, and value proposition.",
      icon: "DollarSign",
      color: "green",
    },
    {
      id: "messaging",
      label: "Messaging & Positioning",
      prompt: "Analyze how they position themselves, key claims, and target audience.",
      icon: "MessageSquare",
      color: "purple",
    },
  ],

  output_format: "comparison_table",
  output_prompt: "Create a competitive comparison table with strategic recommendations.",
};

// ============================================================================
// CFO Template
// ============================================================================

export const CFO_TEMPLATE: WorkflowTemplate = {
  id: "cfo-financial-analysis",
  name: "Financial Analysis & Risk",
  description: "Financial modeling, risk assessment, and treasury decisions",
  personaId: "cfo",

  triggers: [
    "financial analysis",
    "cash flow",
    "treasury",
    "risk assessment",
    "vendor payment terms",
    "credit analysis",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "financial-statements",
        source: "Financial Statements",
        prompt: "Analyze income statement, balance sheet, and cash flow. Focus on key ratios.",
      },
      {
        id: "credit-ratings",
        source: "Credit Agencies",
        prompt: "Check Moody's, S&P, Fitch ratings and outlooks if available.",
      },
      {
        id: "market-data",
        source: "Market Data",
        prompt: "Review stock performance, debt pricing, and credit spreads.",
      },
    ],
    max_candidates: 5,
  },

  verification_criteria: [
    {
      id: "financial_data_quality",
      label: "Financial Data Quality",
      prompt: "Are audited financials or reliable estimates available?",
      required: true,
    },
    {
      id: "liquidity_threshold",
      label: "Liquidity Threshold",
      prompt: "Does the entity meet minimum liquidity requirements?",
      required: false,
      weight: 0.8,
    },
  ],

  enrichment_tasks: [
    {
      id: "ratio_analysis",
      label: "Ratio Analysis",
      prompt: "Calculate and interpret key financial ratios: liquidity, leverage, profitability.",
      icon: "BarChart",
      color: "blue",
    },
    {
      id: "cash_flow_model",
      label: "Cash Flow Model",
      prompt: "Project cash flows and identify potential stress scenarios.",
      icon: "TrendingUp",
      color: "green",
    },
    {
      id: "counterparty_risk",
      label: "Counterparty Risk",
      prompt: "Assess creditworthiness and potential exposure.",
      icon: "Shield",
      color: "red",
    },
  ],

  output_format: "risk_matrix",
  output_prompt: "Create a financial risk assessment with recommendations.",
};

// ============================================================================
// M&A Analyst Template
// ============================================================================

export const MA_ANALYST_TEMPLATE: WorkflowTemplate = {
  id: "ma-target-screening",
  name: "M&A Target Screening",
  description: "Identify and evaluate potential acquisition targets",
  personaId: "ma-analyst",

  triggers: [
    "acquisition targets",
    "M&A pipeline",
    "target screening",
    "strategic acquisitions",
    "bolt-on acquisitions",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "industry-mapping",
        source: "Industry Research",
        prompt: "Map the sector landscape. Identify key players by market segment.",
      },
      {
        id: "deal-flow",
        source: "Deal Sources",
        prompt: "Check recent M&A activity, pending deals, and rumored transactions.",
      },
      {
        id: "company-database",
        source: "Company Database",
        prompt: "Identify private companies in target size range ($10M-$100M revenue).",
      },
      {
        id: "distressed-assets",
        source: "Distressed Situations",
        prompt: "Identify companies facing financial distress or strategic review.",
      },
    ],
    max_candidates: 15,
  },

  verification_criteria: [
    {
      id: "strategic_fit",
      label: "Strategic Fit",
      prompt: "Does the target align with our strategic priorities?",
      required: true,
    },
    {
      id: "size_fit",
      label: "Size Fit",
      prompt: "Is the target within acceptable size parameters?",
      required: true,
    },
    {
      id: "dealability",
      label: "Dealability",
      prompt: "Is the target likely to be acquirable? (ownership, willingness)",
      required: false,
      weight: 0.7,
    },
  ],

  enrichment_tasks: [
    {
      id: "valuation",
      label: "Preliminary Valuation",
      prompt: "Estimate value using comparable transactions and trading multiples.",
      icon: "DollarSign",
      color: "green",
    },
    {
      id: "synergies",
      label: "Synergy Analysis",
      prompt: "Identify revenue and cost synergy opportunities.",
      icon: "Target",
      color: "blue",
    },
    {
      id: "integration_risk",
      label: "Integration Risk",
      prompt: "Assess technology, culture, and operational integration challenges.",
      icon: "AlertTriangle",
      color: "amber",
    },
    {
      id: "ownership_structure",
      label: "Ownership & Control",
      prompt: "Map shareholders, board composition, and decision-makers.",
      icon: "Users",
      color: "purple",
    },
  ],

  output_format: "deal_memo",
  output_prompt: "Create an M&A screening memo with target ranking and recommendations.",
};

// ============================================================================
// Marketing Lead Template
// ============================================================================

export const MARKETING_LEAD_TEMPLATE: WorkflowTemplate = {
  id: "marketing-market-intel",
  name: "Market Intelligence",
  description: "Market trends, audience insights, and campaign inspiration",
  personaId: "marketing-lead",

  triggers: [
    "market trends",
    "audience research",
    "campaign ideas",
    "brand monitoring",
    "content inspiration",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "social-trends",
        source: "Social Media",
        prompt: "Analyze trending topics, hashtags, and viral content in our space.",
      },
      {
        id: "competitor-campaigns",
        source: "Competitor Marketing",
        prompt: "Review recent competitor campaigns, messaging, and positioning.",
      },
      {
        id: "industry-news",
        source: "Industry News",
        prompt: "Scan for industry announcements, events, and thought leadership.",
      },
    ],
    max_candidates: 20,
  },

  verification_criteria: [
    {
      id: "relevance",
      label: "Audience Relevance",
      prompt: "Is this relevant to our target audience?",
      required: true,
    },
    {
      id: "timeliness",
      label: "Timeliness",
      prompt: "Is this trend current and actionable?",
      required: false,
      weight: 0.8,
    },
  ],

  enrichment_tasks: [
    {
      id: "audience_sentiment",
      label: "Audience Sentiment",
      prompt: "Gauge audience reaction and sentiment around this topic.",
      icon: "MessageSquare",
      color: "pink",
    },
    {
      id: "content_angles",
      label: "Content Angles",
      prompt: "Generate content ideas and messaging angles we could use.",
      icon: "Sparkles",
      color: "purple",
    },
    {
      id: "channel_strategy",
      label: "Channel Strategy",
      prompt: "Recommend which channels would work best for this content.",
      icon: "Network",
      color: "blue",
    },
  ],

  output_format: "custom",
  output_prompt: "Create a market intelligence brief with actionable content opportunities.",
};

// ============================================================================
// HR/Talent Lead Template
// ============================================================================

export const TALENT_LEAD_TEMPLATE: WorkflowTemplate = {
  id: "talent-market-intel",
  name: "Talent Market Intelligence",
  description: "Compensation benchmarks, talent pipeline, and employer branding",
  personaId: "talent-lead",

  triggers: [
    "salary benchmarks",
    "talent pipeline",
    "hiring market",
    "competitor headcount",
    "employer branding",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "job-postings",
        source: "Job Boards",
        prompt: "Analyze competitor job postings. What roles, levels, and requirements?",
      },
      {
        id: "linkedin-data",
        source: "LinkedIn",
        prompt: "Track competitor headcount changes, new hires, and departures.",
      },
      {
        id: "glassdoor",
        source: "Glassdoor",
        prompt: "Review salary data, company ratings, and employee reviews.",
      },
      {
        id: "levels-fyi",
        source: "Levels.fyi",
        prompt: "Gather compensation data for target roles and levels.",
      },
    ],
    max_candidates: 10,
  },

  verification_criteria: [
    {
      id: "data_recency",
      label: "Data Recency",
      prompt: "Is the compensation/market data from the last 6 months?",
      required: true,
    },
    {
      id: "role_match",
      label: "Role Match",
      prompt: "Does this data match our target role and level?",
      required: true,
    },
  ],

  enrichment_tasks: [
    {
      id: "comp_analysis",
      label: "Compensation Analysis",
      prompt: "Analyze total compensation including equity, bonus, and benefits.",
      icon: "DollarSign",
      color: "green",
    },
    {
      id: "talent_flow",
      label: "Talent Flow",
      prompt: "Map where talent is coming from and going to in our space.",
      icon: "Users",
      color: "blue",
    },
    {
      id: "evp_analysis",
      label: "EVP Analysis",
      prompt: "Compare employer value propositions and perks.",
      icon: "Target",
      color: "purple",
    },
  ],

  output_format: "comparison_table",
  output_prompt: "Create a talent market analysis with compensation benchmarks and recommendations.",
};

// ============================================================================
// Business Development Template
// ============================================================================

export const BIZ_DEV_TEMPLATE: WorkflowTemplate = {
  id: "bizdev-partnership-scouting",
  name: "Partnership & Channel Scouting",
  description: "Identify and evaluate potential partners and channel relationships",
  personaId: "biz-dev",

  triggers: [
    "partnership opportunities",
    "channel partners",
    "integration partners",
    "reseller network",
    "strategic alliances",
  ],

  sourcing: {
    parallel_tasks: [
      {
        id: "ecosystem-mapping",
        source: "Ecosystem",
        prompt: "Map the partner ecosystem. Who are the key players and connectors?",
      },
      {
        id: "integration-landscape",
        source: "Integrations",
        prompt: "Identify companies with complementary products and active API programs.",
      },
      {
        id: "partnership-announcements",
        source: "Partnership News",
        prompt: "Track recent partnership announcements in our space.",
      },
    ],
    max_candidates: 20,
  },

  verification_criteria: [
    {
      id: "mutual_benefit",
      label: "Mutual Benefit",
      prompt: "Is there clear value for both parties?",
      required: true,
    },
    {
      id: "strategic_alignment",
      label: "Strategic Alignment",
      prompt: "Does this align with our go-to-market strategy?",
      required: true,
    },
    {
      id: "execution_capacity",
      label: "Execution Capacity",
      prompt: "Do they have the resources to be an effective partner?",
      required: false,
      weight: 0.6,
    },
  ],

  enrichment_tasks: [
    {
      id: "partner_profile",
      label: "Partner Profile",
      prompt: "Create detailed profile: company size, target market, go-to-market motion.",
      icon: "Building2",
      color: "blue",
    },
    {
      id: "integration_scope",
      label: "Integration Scope",
      prompt: "Define potential integration touchpoints and technical requirements.",
      icon: "Code2",
      color: "green",
    },
    {
      id: "deal_structure",
      label: "Deal Structure",
      prompt: "Outline potential partnership models: referral, reseller, technology.",
      icon: "Target",
      color: "amber",
    },
    {
      id: "relationship_map",
      label: "Relationship Map",
      prompt: "Identify mutual connections and warm introduction paths.",
      icon: "Network",
      color: "purple",
    },
  ],

  output_format: "shortlist_with_outreach_hooks",
  output_prompt: "Create a partnership prospect list with outreach angles and next steps.",
};

// ============================================================================
// Template Registry
// ============================================================================

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  "jpm-commercial-prospecting": JPM_BANKER_TEMPLATE,
  "vc-early-stage-sourcing": VC_EARLY_STAGE_TEMPLATE,
  "cto-vendor-assessment": CTO_VENDOR_TEMPLATE,
  "research-analyst-deep-dive": RESEARCH_ANALYST_TEMPLATE,
  "pm-competitive-intel": PRODUCT_MANAGER_TEMPLATE,
  "cfo-financial-analysis": CFO_TEMPLATE,
  "ma-target-screening": MA_ANALYST_TEMPLATE,
  "marketing-market-intel": MARKETING_LEAD_TEMPLATE,
  "talent-market-intel": TALENT_LEAD_TEMPLATE,
  "bizdev-partnership-scouting": BIZ_DEV_TEMPLATE,
};

// ============================================================================
// Persona Registry
// ============================================================================

export const PERSONAS: Record<string, Persona> = {
  "jpm-banker": {
    id: "jpm-banker",
    name: "Commercial Banker",
    title: "Innovation Economy Banker",
    organization: "J.P. Morgan",
    icon: "Building2",
    color: "blue",
    priorities: [
      "Find seed-funded startups before competitors",
      "Identify JPM alumni network connections",
      "Assess treasury management needs",
    ],
    example_queries: [
      "Find seed deals from last 48 hours",
      "Morning prospecting report",
      "Which AI startups raised this week?",
    ],
    default_template_id: "jpm-commercial-prospecting",
  },
  "vc-partner": {
    id: "vc-partner",
    name: "VC Partner",
    title: "General Partner",
    organization: "Early Stage Fund",
    icon: "Rocket",
    color: "purple",
    priorities: [
      "Find thesis-matching companies early",
      "Avoid competing with Tier 1 VCs",
      "Identify breakout traction signals",
    ],
    example_queries: [
      "Find AI infra startups with GitHub traction",
      "What launched on Product Hunt this week?",
      "Scout developer tools pre-seed",
    ],
    default_template_id: "vc-early-stage-sourcing",
  },
  "cto": {
    id: "cto",
    name: "CTO",
    title: "Chief Technology Officer",
    organization: "Tech Company",
    icon: "Code2",
    color: "green",
    priorities: [
      "Ensure vendor security compliance",
      "Minimize operational risk",
      "Evaluate build vs buy decisions",
    ],
    example_queries: [
      "Should we use Vercel or AWS?",
      "Security review of Supabase",
      "Compare auth providers",
    ],
    default_template_id: "cto-vendor-assessment",
  },
  "research-analyst": {
    id: "research-analyst",
    name: "Research Analyst",
    title: "Equity Research Analyst",
    organization: "Investment Bank",
    icon: "LineChart",
    color: "amber",
    priorities: [
      "Deep financial analysis",
      "Competitive positioning",
      "Risk identification",
    ],
    example_queries: [
      "Deep dive on Tesla",
      "Analyze Nvidia's moat",
      "Research Anthropic",
    ],
    default_template_id: "research-analyst-deep-dive",
  },
  "product-manager": {
    id: "product-manager",
    name: "Product Manager",
    title: "Senior PM",
    organization: "SaaS Company",
    icon: "LayoutGrid",
    color: "pink",
    priorities: [
      "Understand competitor features",
      "Track market trends",
      "Identify product gaps",
    ],
    example_queries: [
      "What is Linear building?",
      "Compare us to Notion",
      "Pricing research on competitors",
    ],
    default_template_id: "pm-competitive-intel",
  },
  "cfo": {
    id: "cfo",
    name: "CFO",
    title: "Chief Financial Officer",
    organization: "Enterprise",
    icon: "DollarSign",
    color: "emerald",
    priorities: [
      "Cash flow optimization",
      "Risk management",
      "Vendor credit assessment",
    ],
    example_queries: [
      "Credit analysis on vendor",
      "Cash flow forecast",
      "Counterparty risk assessment",
    ],
    default_template_id: "cfo-financial-analysis",
  },
  "ma-analyst": {
    id: "ma-analyst",
    name: "M&A Analyst",
    title: "Corporate Development Analyst",
    organization: "Strategic Corp Dev",
    icon: "Target",
    color: "indigo",
    priorities: [
      "Identify acquisition targets",
      "Preliminary valuations",
      "Integration planning",
    ],
    example_queries: [
      "Find acquisition targets in fintech",
      "Bolt-on opportunities in healthcare",
      "Target screening for AI companies",
    ],
    default_template_id: "ma-target-screening",
  },
  "marketing-lead": {
    id: "marketing-lead",
    name: "Marketing Lead",
    title: "VP Marketing",
    organization: "Growth Company",
    icon: "MessageSquare",
    color: "rose",
    priorities: [
      "Market trend identification",
      "Competitive messaging",
      "Content opportunities",
    ],
    example_queries: [
      "What's trending in our space?",
      "Competitor campaign analysis",
      "Content ideas for Q1",
    ],
    default_template_id: "marketing-market-intel",
  },
  "talent-lead": {
    id: "talent-lead",
    name: "Talent Lead",
    title: "Head of Talent",
    organization: "Tech Company",
    icon: "Users",
    color: "cyan",
    priorities: [
      "Competitive compensation",
      "Talent pipeline health",
      "Employer branding",
    ],
    example_queries: [
      "Salary benchmarks for senior engineers",
      "Where are competitors hiring?",
      "Employer brand comparison",
    ],
    default_template_id: "talent-market-intel",
  },
  "biz-dev": {
    id: "biz-dev",
    name: "Biz Dev Lead",
    title: "VP Business Development",
    organization: "Platform Company",
    icon: "Network",
    color: "orange",
    priorities: [
      "Partnership opportunities",
      "Channel expansion",
      "Ecosystem mapping",
    ],
    example_queries: [
      "Find integration partners",
      "Channel partner opportunities",
      "Strategic alliance targets",
    ],
    default_template_id: "bizdev-partnership-scouting",
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Match a query to the best workflow template
 */
export function matchQueryToTemplate(query: string, personaId?: string): WorkflowTemplate | null {
  const queryLower = query.toLowerCase();

  // First try to match by persona default
  if (personaId && PERSONAS[personaId]) {
    const persona = PERSONAS[personaId];
    const template = WORKFLOW_TEMPLATES[persona.default_template_id];
    if (template) {
      // Check if any trigger matches
      if (template.triggers.some(t => queryLower.includes(t))) {
        return template;
      }
    }
  }

  // Then search all templates
  for (const template of Object.values(WORKFLOW_TEMPLATES)) {
    if (template.triggers.some(t => queryLower.includes(t))) {
      return template;
    }
  }

  return null;
}

/**
 * Get template by ID
 */
export function getTemplateById(templateId: string): WorkflowTemplate | null {
  return WORKFLOW_TEMPLATES[templateId] ?? null;
}

/**
 * Get persona by ID
 */
export function getPersonaById(personaId: string): Persona | null {
  return PERSONAS[personaId] ?? null;
}

/**
 * Get all available personas
 */
export function getAllPersonas(): Persona[] {
  return Object.values(PERSONAS);
}

/**
 * Get all available templates
 */
export function getAllTemplates(): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES);
}
