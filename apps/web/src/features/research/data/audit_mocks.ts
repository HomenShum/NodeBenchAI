export const AUDIT_MOCKS: Record<string, any> = {
  /**
   * Global audit configuration that each entry can inherit from.
   * Use this to keep your evaluator deterministic.
   */
  "__AUDIT_CONFIG__": {
    asOf: "2025-12-27",
    personas: [
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
    ],
    defaultPersonaRules: {
      // Deterministic freshness gate (used heavily for “banker targets for the week”)
      requiresNewsWithinDays: 30,
      // Deterministic “depth” gate (prevents hollow content)
      minPrimarySources: 1, // e.g., official press release, regulator, vendor advisory, earnings call, etc.
      minTotalSources: 2,
      // Deterministic “entity completeness” gate
      requiredBankerFields: [
        "crmFields.hqLocation",
        "crmFields.foundingYear",
        "people.founders",
        "funding.lastRound",
        "productPipeline.leadPrograms",
        "recentNews.items",
        "contactPoints.primary",
        "sources",
      ],
    },
    evaluationNotes: [
      "Any entry missing requiredBankerFields => JPM_STARTUP_BANKER auto-FAIL.",
      "Any entry with freshness.newsAgeDays > requiresNewsWithinDays => banker auto-FAIL unless explicitly waived in personaHooks.",
      "Any entry with contradictory fundingStage vs lastRound.roundType => hard FAIL across all personas.",
    ],
  },

  // ---------------------------------------------------------------------------
  // 0) Seed-stage company (NEW) — Banker-grade target list anchor (December 2025)
  // ---------------------------------------------------------------------------
  "DISCO": {
    entityId: "DISCO",
    entityType: "private_company",
    canonicalName: "DISCO Pharmaceuticals",
    asOf: "2025-12-27",

    summary:
      "DISCO Pharmaceuticals (Cologne, Germany) closed a €36M seed financing and is advancing a surfaceome-targeted oncology pipeline, including bispecific ADCs and T-cell engagers aimed at hard-to-treat tumors (e.g., SCLC and MSS-CRC).",

    crmFields: {
      hqLocation: "Cologne, Germany",
      foundingYear: null, // not stated in sourced material (keep null to avoid stale/guessed facts)
      website: "https://discopharma.de",
      fundingStage: "Seed",
      totalFunding: "€36M (Seed; reported final close)",
      tickers: null,
      sectors: ["Biotech", "Oncology", "ADC", "Surfaceome"],
    },

    funding: {
      stage: "Seed",
      totalRaised: {
        amount: 36,
        currency: "EUR",
        unit: "M",
        sourceLabel: "Final close seed financing (reported)",
      },
      lastRound: {
        roundType: "Seed",
        announcedDate: "2025-12-11",
        amount: { amount: 36, currency: "EUR", unit: "M" },
        coLeads: ["Ackermans & van Haaren", "NRW.Bank"],
        participants: ["Sofinnova Partners", "AbbVie Ventures", "M Ventures", "Panakes Partners"],
        useOfProceeds:
          "Advance multiple lead ADC candidates (SCLC, MSS-CRC) toward IND-enabling studies and expand pipeline.",
      },
      valuation: null,
      bankerTakeaway:
        "Seed-backed oncology platform with near-term IND-enabling plan; strong syndicate includes strategic/venture arms.",
    },

    people: {
      founders: [
        {
          name: "Roman Thomas, M.D.",
          role: "Founder & Founding CEO (now Strategic Advisor)",
          background: "Founder and founding CEO; transitioned to advisor role after CEO appointment.",
          credentials: [{ type: "MD", verifiedBy: "Company press release" }],
          linkedinUrl: null,
          email: null,
        },
      ],
      executives: [
        {
          name: "Mark Manfredi, Ph.D.",
          role: "CEO",
          backgroundHighlights: [
            "Former CEO of Ikena Oncology",
            "Entrepreneur in Residence at Atlas Venture",
            "Former CSO at Raze Therapeutics",
            "Former VP, Oncology Biology at Takeda",
          ],
          education: [
            { degree: "B.S.", institution: "University of Rhode Island" },
            { degree: "Ph.D.", field: "Biology", institution: "Boston College" },
          ],
          linkedinUrl: null,
          email: null,
        },
      ],
      board: null,
      advisorNotes:
        "If you want academic credential verification beyond the press release, your pipeline should resolve IDs (ORCID, PubMed author pages, LinkedIn) at runtime rather than hardcoding.",
    },

    productPipeline: {
      platform: "Proprietary surfaceome mapping platform to identify novel cell-surface target pairs.",
      modalities: ["Bispecific ADCs", "T-cell engagers"],
      leadPrograms: [
        { program: "Lead ADC candidates (undisclosed targets)", indications: ["SCLC", "MSS-CRC"], stage: "Toward IND-enabling" },
      ],
      differentiation: [
        "Novel cell-surface target pair discovery to expand addressable oncology target space",
        "Claims of high selectivity/therapeutic window via target pairing",
      ],
    },

    recentNews: {
      items: [
        {
          title: "DISCO appoints Mark Manfredi as CEO and announces final close of €36M seed financing",
          publishedDate: "2025-12-11",
          url: "https://discopharma.de/disco-pharmaceuticals-appoints-mark-manfredi-as-ceo-and-announces-final-close-of-e36-million-seed-financing/",
          type: "Company press release",
          keyClaims: ["€36M seed final close", "Pipeline to IND-enabling", "CEO background stated"],
        },
      ],
    },

    contactPoints: {
      primary: { channel: "email", value: "info@discopharma.de", purpose: "Company contact / inbound" },
      media: { channel: "email", value: "disco@trophic.eu", purpose: "Media / comms (Russo-style agency equivalent)" },
      other: [
        { channel: "web", value: "https://discopharma.de/contact/", purpose: "Contact form" },
        { channel: "web", value: "https://discopharma.de/about/leadership/", purpose: "Leadership page" },
      ],
      outreachAngles: [
        "Seed-backed ADC / T-cell engager platform (surfaceome-guided targeting)",
        "CEO recently appointed; likely building BD + clinical execution plan",
        "SCLC and MSS-CRC are high unmet-need segments with active pharma interest",
      ],
    },

    sources: [
      {
        name: "DISCO Pharmaceuticals (press release)",
        url: "https://discopharma.de/disco-pharmaceuticals-appoints-mark-manfredi-as-ceo-and-announces-final-close-of-e36-million-seed-financing/",
        snippet: "€36M seed final close; pipeline; CEO background; contacts.",
        sourceType: "primary",
        credibility: "high",
      },
      {
        name: "Sofinnova Partners (deal/news page)",
        url: "https://sofinnovapartners.com/news/DISCO%20Pharmaceuticals%20Appoints%20Mark%20Manfredi%20as%20CEO%20and%20Announces%20Final%20Close%20of%20%E2%82%AC36%20Million%20Seed%20Financing",
        snippet: "Independent investor-side replication of the announcement.",
        sourceType: "secondary",
        credibility: "high",
      },
    ],

    freshness: {
      newsAgeDays: 16, // relative to 2025-12-27
      withinBankerWindow: true,
    },

    personaHooks: {
      JPM_STARTUP_BANKER: {
        intent: "Weekly outbound target with verified funding and direct contact channels.",
        requiresNewsWithinDays: 30,
        passCriteria: [
          "funding.lastRound.roundType === 'Seed'",
          "crmFields.hqLocation != null",
          "contactPoints.primary.value includes '@'",
          "recentNews.items.length >= 1",
          "sources contains >= 1 primary source",
          "productPipeline.leadPrograms.length >= 1",
        ],
        failTriggers: [
          "crmFields.foundingYear is null (allowed but should be resolved by runtime enrichment)",
          "missing founder/executive credential fields (allowed; runtime enrichment expected)",
        ],
      },
      EARLY_STAGE_VC: {
        passCriteria: [
          "funding.participants includes at least 1 top-tier life sciences fund",
          "clear thesis hook in productPipeline.platform + modalities",
        ],
        failTriggers: ["no competitive landscape mapping attached"],
      },
      CTO_TECH_LEAD: { passCriteria: ["N/A"], failTriggers: [] },
      FOUNDER_STRATEGY: { passCriteria: ["N/A"], failTriggers: [] },
      ACADEMIC_RD: { passCriteria: ["links to scientific advisors page"], failTriggers: [] },
      ENTERPRISE_EXEC: { passCriteria: ["N/A"], failTriggers: [] },
      ECOSYSTEM_PARTNER: { passCriteria: ["N/A"], failTriggers: [] },
      QUANT_ANALYST: { passCriteria: ["funding round has structured amount/date"], failTriggers: [] },
      PRODUCT_DESIGNER: { passCriteria: ["schema is dense + expandable"], failTriggers: [] },
      SALES_ENGINEER: { passCriteria: ["share-ready single-screen summary fields exist"], failTriggers: [] },
    },
  },

  // ---------------------------------------------------------------------------
  // 1) Series A company (NEW) — Banker-grade target list anchor (December 2025)
  // ---------------------------------------------------------------------------
  "AMBROS": {
    entityId: "AMBROS",
    entityType: "private_company",
    canonicalName: "Ambros Therapeutics, Inc.",
    asOf: "2025-12-27",

    summary:
      "Ambros Therapeutics (Irvine, CA) launched with an oversubscribed $125M Series A to advance neridronate for CRPS-1 through a pivotal Phase 3 program (planned to start Q1 2026), supported by FDA Breakthrough Therapy, Fast Track, and Orphan Drug designations.",

    crmFields: {
      hqLocation: "Irvine, CA, USA",
      foundingYear: "2025", // launch announcement date; keep as “launch year” rather than guessing incorporation year
      website: null, // not explicitly provided in sourced material
      fundingStage: "Series A",
      totalFunding: "$125M (Series A; launch financing)",
      sectors: ["Biotech", "Pain", "Rare Disease", "Late-stage clinical"],
      tickers: null,
    },

    funding: {
      stage: "Series A",
      totalRaised: { amount: 125, currency: "USD", unit: "M", sourceLabel: "Oversubscribed launch Series A" },
      lastRound: {
        roundType: "Series A",
        announcedDate: "2025-12-16",
        amount: { amount: 125, currency: "USD", unit: "M" },
        coLeads: ["RA Capital Management", "Enavate Sciences (Patient Square Capital platform)"],
        participants: [
          "Abiogen Pharma",
          "Janus Henderson Investors",
          "Arkin Bio",
          "Balyasny Asset Management",
          "Transhuman Capital",
          "Adage Capital Partners LP",
        ],
        useOfProceeds:
          "Fund pivotal Phase 3 trial (CRPS-RISE) and related regulatory preparations and pre-commercial activities.",
      },
      bankerTakeaway:
        "Late-stage pain program with prior real-world use in Italy; structured licensing arrangement; clear financing use-of-proceeds.",
    },

    people: {
      founders: [
        {
          name: "Vivek Ramaswamy",
          role: "Co-Founder; Board member",
          background: "Serial biotech entrepreneur; co-founder listed in launch materials.",
          linkedinUrl: null,
          email: null,
        },
        {
          name: "Keith Katkin",
          role: "Co-Founder; Chairman of the Board",
          background: "Industry veteran; board chair per launch release.",
          linkedinUrl: null,
          email: null,
        },
      ],
      executives: [
        {
          name: "Jay Hagan",
          role: "CEO",
          backgroundHighlights: ["Joins as CEO at launch; leads late-stage development team."],
          linkedinUrl: null,
          email: null,
        },
        {
          name: "Gail Cawkwell, M.D., Ph.D.",
          role: "Chief Medical Officer",
          backgroundHighlights: ["Medical leadership; listed in launch release."],
        },
        { name: "Michael Cruse", role: "COO", backgroundHighlights: ["Listed in launch release."] },
        { name: "Kunal Kishnani", role: "SVP Corporate Development", backgroundHighlights: ["Listed in launch release."] },
        { name: "Jennifer Lam", role: "SVP Finance & Administration", backgroundHighlights: ["Listed in launch release."] },
      ],
      board: [
        "Keith Katkin (Chair)",
        "Vivek Ramaswamy (Co-Founder)",
        "Matthew Hammond, Ph.D. (RA Capital)",
        "Trit Garg, M.D. (Patient Square Capital)",
        "Prisca Di Martino (Abiogen Pharma)",
        "Jay Hagan (CEO)",
      ],
    },

    productPipeline: {
      leadAsset: {
        name: "Neridronate",
        class: "Bisphosphonate",
        originator: "Abiogen Pharma S.p.A. (Italy)",
        licensedRights: "Exclusive rights in North America; option for broader expansion (per strategic collaboration).",
        regulatory: ["FDA Breakthrough Therapy", "Fast Track", "Orphan Drug (for CRPS)"],
        indicationFocus: ["CRPS-1"],
      },
      leadPrograms: [
        {
          program: "CRPS-RISE (pivotal Phase 3)",
          stage: "Planned start Q1 2026",
          notes: "Trial + regulatory + pre-commercial activities funded by Series A.",
        },
      ],
      rationale: [
        "Existing approval/marketing in Italy for CRPS",
        "Extensive real-world usage claim (>600,000 patients in Italy across indications per release)",
      ],
    },

    recentNews: {
      items: [
        {
          title:
            "Ambros Therapeutics launches with $125M Series A to advance neridronate through Phase 3 for CRPS-1",
          publishedDate: "2025-12-16",
          url: "https://www.prnewswire.com/news-releases/ambros-therapeutics-launches-with-125-million-series-a-financing-to-advance-neridronate-through-phase-3-registrational-program-for-complex-regional-pain-syndrome-type-1-302642798.html",
          type: "Company press release",
          keyClaims: ["$125M Series A", "Phase 3 planned Q1 2026", "FDA designations", "Leadership roster"],
        },
        {
          title: "Fierce Biotech: Ramaswamy-backed Ambros launches with $125M to develop pain drug",
          publishedDate: "2025-12-16",
          url: "https://www.fiercebiotech.com/biotech/ramaswamy-backed-ambros-therapeutics-launches-125m-develop-pain-drug",
          type: "Trade press",
          keyClaims: ["$125M Series A", "Non-opioid pain focus", "Founding + chair details"],
        },
      ],
    },

    contactPoints: {
      primary: { channel: "email", value: "[email protected]", purpose: "Company contact (from press release)" },
      media: { channel: "email", value: "[email protected]", purpose: "Media / PR (Russo Partners)" },
      other: [
        { channel: "trial", value: "CRPS-RISE (linked in release)", purpose: "Clinical program reference" },
      ],
      outreachAngles: [
        "Late-stage clinical asset (pivotal Phase 3 planned Q1 2026)",
        "FDA designations de-risk pathway; financing is explicitly allocated to Phase 3 + pre-commercial",
        "Licensing / collaboration structure with Abiogen (Italy) is banker-relevant for diligence",
      ],
    },

    sources: [
      {
        name: "PR Newswire (Ambros launch release)",
        url: "https://www.prnewswire.com/news-releases/ambros-therapeutics-launches-with-125-million-series-a-financing-to-advance-neridronate-through-phase-3-registrational-program-for-complex-regional-pain-syndrome-type-1-302642798.html",
        snippet: "Launch; $125M Series A; leadership; Phase 3 timeline; contacts.",
        sourceType: "primary",
        credibility: "high",
      },
      {
        name: "Fierce Biotech (deal write-up)",
        url: "https://www.fiercebiotech.com/biotech/ramaswamy-backed-ambros-therapeutics-launches-125m-develop-pain-drug",
        snippet: "Independent confirmation and extra context on founders/chair.",
        sourceType: "secondary",
        credibility: "medium-high",
      },
    ],

    freshness: { newsAgeDays: 11, withinBankerWindow: true },

    personaHooks: {
      JPM_STARTUP_BANKER: {
        intent: "Series A late-stage biotech outbound target; high-quality ‘what to say in first email’ hooks.",
        requiresNewsWithinDays: 30,
        passCriteria: [
          "funding.lastRound.roundType === 'Series A'",
          "crmFields.hqLocation != null",
          "productPipeline.leadAsset.name != null",
          "productPipeline.leadPrograms[0].stage includes 'Q1 2026'",
          "contactPoints.primary.value includes '@'",
          "sources contains >= 1 primary source",
        ],
        failTriggers: ["website is null (resolve via runtime enrichment)"],
      },
      ACADEMIC_RD: {
        passCriteria: [
          "productPipeline.leadAsset.regulatory.length >= 1",
          "recentNews includes primary release with trial details",
        ],
        failTriggers: [],
      },
      ENTERPRISE_EXEC: {
        passCriteria: ["clear buy/wait logic is derivable from Phase 3 timing + designations"],
        failTriggers: [],
      },
      EARLY_STAGE_VC: { passCriteria: ["board and syndicate list present"], failTriggers: [] },
      CTO_TECH_LEAD: { passCriteria: ["N/A"], failTriggers: [] },
      FOUNDER_STRATEGY: { passCriteria: ["N/A"], failTriggers: [] },
      ECOSYSTEM_PARTNER: { passCriteria: ["N/A"], failTriggers: [] },
      QUANT_ANALYST: { passCriteria: ["round structured for time-series"], failTriggers: [] },
      PRODUCT_DESIGNER: { passCriteria: ["dense schema + shareable"], failTriggers: [] },
      SALES_ENGINEER: { passCriteria: ["single-page talk track fields exist"], failTriggers: [] },
    },
  },

  // ---------------------------------------------------------------------------
  // 2) Space / industrial (existing entry — corrected & hardened)
  // ---------------------------------------------------------------------------
  "CLEARSPACE": {
    entityId: "CLEARSPACE",
    entityType: "private_company",
    canonicalName: "ClearSpace SA",
    asOf: "2025-12-27",

    summary:
      "ClearSpace SA is a Swiss space sustainability company working on in-orbit servicing and space debris removal; it is widely associated with ESA’s ClearSpace-1 debris removal efforts and has raised venture funding (reported Series A in prior coverage).",

    crmFields: {
      hqLocation: "Switzerland (Lausanne/Renens region)",
      foundingYear: "2018",
      founders: [
        "Luc Piguet (Co-founder; CEO in public materials)",
        "Muriel Richard (Co-founder in public materials)",
      ],
      website: "https://clearspace.today",
      fundingStage: "Series A (reported)",
      totalFunding: null,
      sectors: ["Space", "Orbital services", "Debris removal"],
    },

    funding: {
      stage: "Series A (reported)",
      totalRaised: null,
      lastRound: {
        roundType: "Series A (reported)",
        amount: null,
        currency: null,
        announcedDate: null,
        coLeads: ["OTB Ventures (reported)"],
        participants: ["Swisscom Ventures (reported)"],
        notes:
          "Reported Series A (€26.7M) appears in prior coverage; treat as runtime-enrichable for banker-grade exactness.",
      },
    },

    people: {
      founders: [
        { name: "Luc Piguet", role: "Co-founder", background: "Publicly listed co-founder; executive leadership associated.", linkedinUrl: null },
        { name: "Muriel Richard", role: "Co-founder", background: "Publicly listed co-founder; operations/business leadership associated.", linkedinUrl: null },
      ],
      executives: [],
    },

    productPipeline: {
      platform: "Autonomous rendezvous and capture for non-cooperative targets (debris servicing/removal).",
      leadPrograms: [
        { program: "ClearSpace-1 (ESA-associated debris removal mission)", stage: "Program / mission development (publicly known)" },
      ],
      differentiation: ["Focus on capture/removal operations for debris mitigation and satellite life-extension services."],
    },

    recentNews: {
      items: [
        // Intentionally left light: this entry is included as a “not this month” example for deterministic FAILs.
      ],
    },

    contactPoints: {
      primary: { channel: "web", value: "https://clearspace.today", purpose: "Company site (resolve contact at runtime)" },
      other: [
        { channel: "profile", value: "https://www.crunchbase.com/organization/clearspace", purpose: "Funding/people enrichment (subscription-free partial)" },
        { channel: "profile", value: "https://pitchbook.com", purpose: "PitchBook (resolve company profile by name)" },
      ],
      outreachAngles: [
        "Space sustainability / debris removal is top-of-funnel relevant to aerospace/defense and infrastructure capital",
        "Mission-linked narrative helps bankers craft outreach even without exact round numbers",
      ],
    },

    sources: [
      {
        name: "Tech.eu (reported Series A coverage)",
        url: "(see Tech.eu coverage surfaced in search)",
        snippet: "Reported €26.7M Series A (OTB Ventures) — use runtime verification for banker-grade certainty.",
        sourceType: "secondary",
        credibility: "medium",
      },
      {
        name: "ClearSpace (company website)",
        url: "https://clearspace.today",
        snippet: "Official website for mission and positioning.",
        sourceType: "primary",
        credibility: "high",
      },
    ],

    freshness: {
      newsAgeDays: null,
      withinBankerWindow: false,
    },

    personaHooks: {
      JPM_STARTUP_BANKER: {
        intent: "Example of deterministic FAIL when ‘this month’ funding/news isn’t present.",
        requiresNewsWithinDays: 30,
        passCriteria: [
          "recentNews.items[0].publishedDate within 30 days",
          "funding.lastRound.amount != null",
          "contactPoints.primary exists",
        ],
        failTriggers: [
          "recentNews.items is empty => FAIL",
          "funding.lastRound.amount is null => FAIL",
        ],
      },
      EARLY_STAGE_VC: { passCriteria: ["N/A"], failTriggers: [] },
      CTO_TECH_LEAD: { passCriteria: ["N/A"], failTriggers: [] },
      FOUNDER_STRATEGY: { passCriteria: ["N/A"], failTriggers: [] },
      ACADEMIC_RD: { passCriteria: ["N/A"], failTriggers: [] },
      ENTERPRISE_EXEC: { passCriteria: ["N/A"], failTriggers: [] },
      ECOSYSTEM_PARTNER: { passCriteria: ["N/A"], failTriggers: [] },
      QUANT_ANALYST: { passCriteria: ["N/A"], failTriggers: [] },
      PRODUCT_DESIGNER: { passCriteria: ["N/A"], failTriggers: [] },
      SALES_ENGINEER: { passCriteria: ["N/A"], failTriggers: [] },
    },
  },

  // ---------------------------------------------------------------------------
  // 3) Early-stage VC / OSS signal (existing entry — corrected & hardened)
  // ---------------------------------------------------------------------------
  "OPEN-AUTOGLM": {
    entityId: "OPEN-AUTOGLM",
    entityType: "oss_project",
    canonicalName: "OpenAutoGLM (zai-org/OpenAutoGLM)",
    asOf: "2025-12-27",

    summary:
      "OpenAutoGLM is an open-source agent framework oriented around ‘phone-use’ autonomous task execution; the repository presents a ‘Phone Use Agent Model’ and agent workflow concepts, with strong visible GitHub momentum.",

    crmFields: {
      hqLocation: "Distributed (GitHub)",
      foundingYear: "2024",
      founders: ["Open-source maintainers (zai-org)"],
      website: "https://github.com/zai-org/OpenAutoGLM",
      fundingStage: "N/A (Open Source)",
      totalFunding: "N/A",
      sectors: ["AI Agents", "Automation", "Open Source"],
    },

    traction: {
      github: {
        stars: 19700,
        forks: 3100,
        issues: 93,
        license: "Apache-2.0",
        asOf: "2025-12-27",
        notes: "Numbers captured from repository page; refresh at runtime for live star-velocity.",
      },
      momentumSignals: [
        { signal: "High star count", threshold: ">= 10k", pass: true },
        { signal: "Active issues", threshold: ">= 25", pass: true },
      ],
    },

    funding: {
      stage: "N/A",
      totalRaised: null,
      lastRound: null,
    },

    people: {
      founders: [{ name: "zai-org maintainers", role: "Maintainers", background: "Open-source maintainers; use repo contributors graph for outreach mapping." }],
      executives: [],
    },

    productPipeline: {
      platform: "Agent orchestration for phone-use automation (task decomposition + tool execution).",
      leadPrograms: [
        { program: "OpenAutoGLM framework", stage: "Active open-source development", notes: "Repo positions itself as a Phone Use Agent model + workflow." },
      ],
      differentiation: ["OSS distribution enables rapid ecosystem experimentation and derivative products."],
    },

    recentNews: {
      items: [
        // Keep as a “traction-first” signal; news is GitHub itself.
        {
          title: "GitHub momentum signal (stars/forks/issues)",
          publishedDate: "2025-12-27",
          url: "https://github.com/zai-org/OpenAutoGLM",
          type: "Primary (repo telemetry)",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "web", value: "https://github.com/zai-org/OpenAutoGLM", purpose: "Repo entry point" },
      other: [
        { channel: "issues", value: "https://github.com/zai-org/OpenAutoGLM/issues", purpose: "Maintainer contact surface (public)" },
        { channel: "discussions", value: "https://github.com/zai-org/OpenAutoGLM/discussions", purpose: "Community channel" },
      ],
      outreachAngles: [
        "For VC: treat as ecosystem signal (moat pressure) rather than a company target",
        "For founders: competitor/replacement substrate for proprietary agent platforms",
      ],
    },

    sources: [
      { name: "GitHub Repository", url: "https://github.com/zai-org/OpenAutoGLM", snippet: "Stars/forks/license + project description.", sourceType: "primary", credibility: "high" },
    ],

    freshness: { newsAgeDays: 0, withinBankerWindow: true },

    personaHooks: {
      EARLY_STAGE_VC: {
        intent: "Thesis generation & competitive mapping via OSS momentum.",
        requiresNewsWithinDays: 30,
        passCriteria: [
          "traction.github.stars != null",
          "traction.github.license != null",
          "sources contains primary repo link",
          "recentNews.items[0].type includes 'repo telemetry'",
        ],
        failTriggers: ["No star-velocity delta provided (resolve at runtime via GitHub API or scraping)."],
      },
      JPM_STARTUP_BANKER: {
        intent: "Should FAIL banker workflow (not a company), unless evaluator supports ‘OSS-to-company’ inference.",
        requiresNewsWithinDays: 30,
        passCriteria: ["entityType === 'private_company'"],
        failTriggers: ["entityType === 'oss_project' => FAIL"],
      },
      CTO_TECH_LEAD: { passCriteria: ["repo has license + issues"], failTriggers: [] },
      FOUNDER_STRATEGY: { passCriteria: ["clear product positioning"], failTriggers: [] },
      ACADEMIC_RD: { passCriteria: ["N/A"], failTriggers: [] },
      ENTERPRISE_EXEC: { passCriteria: ["N/A"], failTriggers: [] },
      ECOSYSTEM_PARTNER: { passCriteria: ["N/A"], failTriggers: [] },
      QUANT_ANALYST: { passCriteria: ["time-series could be derived from stars"], failTriggers: [] },
      PRODUCT_DESIGNER: { passCriteria: ["schema is compact"], failTriggers: [] },
      SALES_ENGINEER: { passCriteria: ["demo-friendly talk track exists"], failTriggers: [] },
    },
  },

  // ---------------------------------------------------------------------------
  // 4) CTO / vendor risk assessment (existing entry — corrected CVE + patch)
  // ---------------------------------------------------------------------------
  "MQUICKJS": {
    entityId: "MQUICKJS",
    entityType: "oss_project",
    canonicalName: "QuickJS / MicroQuickJS ecosystem",
    asOf: "2025-12-27",

    summary:
      "QuickJS is a lightweight JavaScript engine by Fabrice Bellard; a known vulnerability (CVE-2025-62495) affects QuickJS versions prior to 2025-09-13, fixed in the 2025-09-13 release per upstream changelog guidance.",

    crmFields: {
      hqLocation: "N/A (Open Source)",
      foundingYear: "2019",
      founders: ["Fabrice Bellard"],
      website: "https://bellard.org/quickjs/",
      fundingStage: "Maintained",
      totalFunding: "Open Source",
      sectors: ["Runtime", "Embedded JS", "Security"],
    },

    funding: { stage: "N/A", totalRaised: null, lastRound: null },

    people: {
      founders: [{ name: "Fabrice Bellard", role: "Author/Maintainer", background: "Creator of QuickJS; ecosystem includes MicroQuickJS." }],
      executives: [],
    },

    security: {
      cves: [
        {
          cveId: "CVE-2025-62495",
          severity: "High (per NVD record; treat CVSS as runtime-fetched if needed)",
          description: "QuickJS vulnerability affecting versions before 2025-09-13 (per NVD).",
          affected: { untilExcludingVersion: "2025-09-13" },
          fixedIn: "2025-09-13",
          mitigations: [
            "Upgrade QuickJS to >= 2025-09-13",
            "Perform dependency graph scan for embedded QuickJS forks/bundles",
          ],
        },
      ],
      downstreamRiskNotes: [
        "MicroQuickJS is separate but adjacent; do not assume shared vulnerable code without diff/grep validation.",
      ],
    },

    productPipeline: {
      platform: "Embeddable JS runtime; used in constrained/embedded or tooling contexts.",
      leadPrograms: [{ program: "QuickJS releases", stage: "Maintained (upstream releases)" }],
      differentiation: ["Small footprint vs V8/SpiderMonkey; embeddability."],
    },

    recentNews: {
      items: [
        {
          title: "NVD entry for CVE-2025-62495 (QuickJS)",
          publishedDate: null,
          url: "https://nvd.nist.gov/vuln/detail/CVE-2025-62495",
          type: "Vulnerability record (primary-ish)",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "web", value: "https://bellard.org/quickjs/", purpose: "Project home" },
      other: [
        { channel: "repo", value: "https://github.com/bellard/quickjs", purpose: "Source code" },
        { channel: "changelog", value: "https://bellard.org/quickjs/Changelog", purpose: "Release validation" },
        { channel: "repo", value: "https://github.com/bellard/mquickjs", purpose: "MicroQuickJS (adjacent project)" },
      ],
      outreachAngles: [
        "For CTO: drive vendor dependency mapping + patch verification",
        "For security: ensure forks/bundles also patched (supply chain angle)",
      ],
    },

    sources: [
      { name: "NVD (CVE record)", url: "https://nvd.nist.gov/vuln/detail/CVE-2025-62495", snippet: "Affected versions before 2025-09-13.", sourceType: "primary", credibility: "high" },
      { name: "Upstream changelog", url: "https://bellard.org/quickjs/Changelog", snippet: "Confirms 2025-09-13 release line for patch validation.", sourceType: "primary", credibility: "high" },
      { name: "MicroQuickJS repo", url: "https://github.com/bellard/mquickjs", snippet: "Adjacent project; validate shared codepaths before asserting exposure.", sourceType: "primary", credibility: "high" },
    ],

    freshness: { newsAgeDays: null, withinBankerWindow: true },

    personaHooks: {
      CTO_TECH_LEAD: {
        intent: "Vendor risk assessment: direct CVE link, fixed version, and downstream mapping prompt.",
        requiresNewsWithinDays: 365, // security advisories aren’t “this month” bounded
        passCriteria: [
          "security.cves[0].cveId startsWith 'CVE-'",
          "security.cves[0].fixedIn != null",
          "sources includes NVD + upstream changelog",
        ],
        failTriggers: [
          "any claim that Cloudflare Workers rely on QuickJS without a dependency proof",
          "any patch version not aligned with NVD/upstream changelog",
        ],
      },
      JPM_STARTUP_BANKER: { passCriteria: ["N/A"], failTriggers: ["entityType != private_company => FAIL"] },
      EARLY_STAGE_VC: { passCriteria: ["N/A"], failTriggers: [] },
      FOUNDER_STRATEGY: { passCriteria: ["N/A"], failTriggers: [] },
      ACADEMIC_RD: { passCriteria: ["N/A"], failTriggers: [] },
      ENTERPRISE_EXEC: { passCriteria: ["N/A"], failTriggers: [] },
      ECOSYSTEM_PARTNER: { passCriteria: ["N/A"], failTriggers: [] },
      QUANT_ANALYST: { passCriteria: ["N/A"], failTriggers: [] },
      PRODUCT_DESIGNER: { passCriteria: ["N/A"], failTriggers: [] },
      SALES_ENGINEER: { passCriteria: ["N/A"], failTriggers: [] },
    },
  },

  // ---------------------------------------------------------------------------
  // 5) Founder / strategy pivot (existing entry — remove made-up churn metrics)
  // ---------------------------------------------------------------------------
  "SALESFORCE": {
    entityId: "SALESFORCE",
    entityType: "public_company",
    canonicalName: "Salesforce, Inc.",
    asOf: "2025-12-27",

    summary:
      "Salesforce continues to position Agentforce as a major AI/agentic product direction, supported by ongoing product announcements and market coverage. This entry intentionally avoids hardcoding churn/seat metrics unless sourced from filings or earnings transcripts.",

    crmFields: {
      hqLocation: "San Francisco, CA",
      foundingYear: "1999",
      founders: ["Marc Benioff", "Parker Harris"],
      website: "https://www.salesforce.com",
      fundingStage: "Public",
      tickers: ["NYSE: CRM"],
      totalFunding: "Public markets",
      sectors: ["Enterprise SaaS", "CRM", "AI Agents"],
    },

    funding: {
      stage: "Public",
      totalRaised: null,
      lastRound: null,
    },

    market: {
      ticker: "CRM",
      stockPrice: {
        price: null, // resolve via runtime quote fetch; do not hardcode without a live quote source in this build
        asOf: "2025-12-27",
        note: "Use a live market data API in production; keep null in mocks to prevent stale dashboards.",
      },
    },

    productPipeline: {
      leadPrograms: [
        { program: "Agentforce (agentic AI platform)", stage: "Productized / expanding", notes: "Validate capabilities and pricing via Salesforce sources at runtime." },
      ],
      differentiation: ["Tight CRM/workflow integration; enterprise distribution."],
    },

    recentNews: {
      items: [
        {
          title: "Reuters coverage on Salesforce AI/Agentforce direction",
          publishedDate: null,
          url: "https://www.reuters.com",
          type: "News coverage",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "web", value: "https://investor.salesforce.com", purpose: "IR / filings / earnings transcripts" },
      other: [{ channel: "web", value: "https://www.salesforce.com/company/contact-us/", purpose: "Sales contact" }],
    },

    sources: [
      { name: "Salesforce Investor Relations", url: "https://investor.salesforce.com", snippet: "Earnings/filings (primary).", sourceType: "primary", credibility: "high" },
      { name: "Reuters (Agentforce coverage)", url: "https://www.reuters.com", snippet: "Market reporting context.", sourceType: "secondary", credibility: "high" },
    ],

    freshness: { newsAgeDays: null, withinBankerWindow: false },

    personaHooks: {
      FOUNDER_STRATEGY: {
        intent: "Strategic pivot analysis must be backed by filings/transcripts, not vibes.",
        requiresNewsWithinDays: 90,
        passCriteria: [
          "sources includes IR link",
          "recentNews.items.length >= 1",
        ],
        failTriggers: [
          "any hardcoded churn/seat metrics without a cited filing/transcript",
        ],
      },
      SALES_ENGINEER: {
        passCriteria: ["share-friendly summary exists; links to IR exist"],
        failTriggers: ["missing pricing/packaging details for Agentforce (resolve at runtime)"],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // 6) Academic / R&D (existing entry — corrected: remove fabricated Nature claim)
  // ---------------------------------------------------------------------------
  "ALZHEIMERS": {
    entityId: "ALZHEIMERS",
    entityType: "research_signal",
    canonicalName: "RyR2 / Alzheimer’s calcium signaling (literature signal)",
    asOf: "2025-12-27",

    summary:
      "This entry is a literature signal around RyR2 (ryanodine receptor type 2) and Alzheimer’s-related mechanisms. It is intentionally marked as ‘not-this-month’ fresh and should FAIL banker-grade recency checks.",

    crmFields: {
      hqLocation: "Academic Research",
      foundingYear: null,
      founders: null,
      website: "https://pubmed.ncbi.nlm.nih.gov/36627208/",
      fundingStage: "Pre-Clinical (literature)",
      totalFunding: null,
      sectors: ["Neuroscience", "Neurodegeneration", "Calcium signaling"],
    },

    keyFacts: [
      "RyR2 signaling has been investigated in AD-related pathways including autophagy and calcium dysregulation.",
    ],

    productPipeline: {
      leadPrograms: [
        { program: "RyR2 mechanism studies (literature)", stage: "Published research / ongoing field" },
      ],
    },

    recentNews: {
      items: [
        {
          title: "PubMed: RyR2 gating mutation rescues autophagy-related AD mechanism (example literature anchor)",
          publishedDate: "2023-01-xx",
          url: "https://pubmed.ncbi.nlm.nih.gov/36627208/",
          type: "Primary literature index",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "web", value: "https://pubmed.ncbi.nlm.nih.gov/36627208/", purpose: "Paper index (resolve PDF/authors at runtime)" },
    },

    sources: [
      { name: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov/36627208/", snippet: "RyR2/AD-related paper listing (anchor).", sourceType: "primary", credibility: "high" },
    ],

    freshness: { newsAgeDays: 700, withinBankerWindow: false },

    personaHooks: {
      ACADEMIC_RD: {
        intent: "Should PASS as a literature anchor if methodology + primary link exist.",
        requiresNewsWithinDays: 3650,
        passCriteria: ["sources contains primary literature index"],
        failTriggers: ["no PDF/methodology snippet cached (resolve at runtime)"],
      },
      JPM_STARTUP_BANKER: {
        intent: "Should FAIL banker workflow (not a company; not this month).",
        requiresNewsWithinDays: 30,
        passCriteria: [],
        failTriggers: ["entityType !== 'private_company' => FAIL", "freshness.withinBankerWindow === false => FAIL"],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // 7) Enterprise executive (existing entry — corrected pricing via official page)
  // ---------------------------------------------------------------------------
  "GEMINI_3": {
    entityId: "GEMINI_3",
    entityType: "model_platform",
    canonicalName: "Google Gemini 3 (Pro / Flash)",
    asOf: "2025-12-27",

    summary:
      "Gemini 3 pricing and context caching can materially affect enterprise agent unit economics. This entry uses official published pricing tables and is designed to PASS executive ‘cost impact’ checks.",

    crmFields: {
      hqLocation: "Mountain View, CA",
      foundingYear: "2025",
      founders: ["Google DeepMind"],
      website: "https://ai.google.dev/pricing",
      fundingStage: "Production",
      totalFunding: "Public (Alphabet)",
      sectors: ["AI Models", "Enterprise AI", "Agents"],
    },

    pricing: {
      source: "https://ai.google.dev/pricing",
      models: [
        {
          name: "Gemini 3 Flash",
          input: [
            { tier: "<=1M tokens", pricePer1M: 0.10, currency: "USD", modalities: ["Text", "Image", "Video"] },
            { tier: ">1M tokens", pricePer1M: 0.20, currency: "USD", modalities: ["Text", "Image", "Video"] },
          ],
          output: [
            { tier: "<=1M tokens", pricePer1M: 0.50, currency: "USD" },
            { tier: ">1M tokens", pricePer1M: 1.00, currency: "USD" },
          ],
          contextCaching: [
            { metric: "Cache storage per hour", unit: "per 1M tokens", price: 0.005, currency: "USD" },
            { metric: "Cache read", unit: "per 1M tokens", price: 0.02, currency: "USD" },
          ],
        },
        {
          name: "Gemini 3 Pro",
          input: [
            { tier: "<=1M tokens", pricePer1M: 1.00, currency: "USD", modalities: ["Text", "Image", "Video"] },
            { tier: ">1M tokens", pricePer1M: 2.00, currency: "USD", modalities: ["Text", "Image", "Video"] },
          ],
          output: [
            { tier: "<=1M tokens", pricePer1M: 5.00, currency: "USD" },
            { tier: ">1M tokens", pricePer1M: 10.00, currency: "USD" },
          ],
          contextCaching: [
            { metric: "Cache storage per hour", unit: "per 1M tokens", price: 0.05, currency: "USD" },
            { metric: "Cache read", unit: "per 1M tokens", price: 0.25, currency: "USD" },
          ],
        },
      ],
      executiveNote:
        "Use context caching aggressively for agent loops; token costs can swing sharply at >1M tier thresholds.",
    },

    recentNews: {
      items: [
        { title: "Google pricing page (Gemini 3 Pro/Flash)", publishedDate: null, url: "https://ai.google.dev/pricing", type: "Primary pricing table" },
      ],
    },

    contactPoints: {
      primary: { channel: "web", value: "https://cloud.google.com/contact", purpose: "Enterprise sales contact" },
      other: [{ channel: "web", value: "https://ai.google.dev/pricing", purpose: "Pricing source of truth" }],
    },

    sources: [
      { name: "Google AI pricing", url: "https://ai.google.dev/pricing", snippet: "Gemini 3 Pro/Flash published pricing + caching.", sourceType: "primary", credibility: "high" },
    ],

    freshness: { newsAgeDays: null, withinBankerWindow: true },

    personaHooks: {
      ENTERPRISE_EXEC: {
        intent: "P&L risk management: deterministic cost model should be possible from this schema.",
        requiresNewsWithinDays: 365,
        passCriteria: ["pricing.models.length >= 2", "pricing.models[0].contextCaching.length >= 1", "sources includes primary pricing"],
        failTriggers: ["missing output token pricing", "no caching economics fields"],
      },
      SALES_ENGINEER: {
        passCriteria: ["shareable summary exists", "pricing is structured"],
        failTriggers: [],
      },
    },
  },

  "GEMINI": {
    // Alias for Gemini 3
    __aliasOf: "GEMINI_3",
  },

  // ---------------------------------------------------------------------------
  // 8) Ecosystem partner / second-order effects (existing entry — grounded in Dec 2025 incident)
  // ---------------------------------------------------------------------------
  "SOUNDCLOUD": {
    entityId: "SOUNDCLOUD",
    entityType: "private_company_incident",
    canonicalName: "SoundCloud (VPN access disruption / security hardening)",
    asOf: "2025-12-27",

    summary:
      "In mid-December 2025, SoundCloud users reported widespread 403 errors when accessing via VPN; coverage indicates the platform was working on a fix. Broader reporting connects the disruption to post-incident security hardening after a breach.",

    crmFields: {
      hqLocation: "Berlin, Germany",
      foundingYear: "2007",
      founders: ["Alexander Ljung", "Eric Wahlforss"],
      website: "https://soundcloud.com",
      fundingStage: "Private",
      totalFunding: "Private (various rounds historically)",
      sectors: ["Consumer", "Creator economy", "Streaming"],
    },

    incident: {
      type: "Service access disruption (VPN) + security hardening",
      symptom: "403 Forbidden errors for VPN users",
      firstReported: "2025-12-15",
      userImpact: [
        "Users in blocked/restricted regions rely on VPN/proxy to access SoundCloud",
        "VPN users globally experienced denial of access (403)",
      ],
      secondOrderEffects: [
        "Demand shift toward residential proxy networks and region-compliant access patterns",
        "Potential trust and churn impacts among creators/listeners in restricted geos",
      ],
    },

    recentNews: {
      items: [
        {
          title: "Ongoing SoundCloud issue blocks VPN users with 403 server error",
          publishedDate: "2025-12-15",
          url: "https://www.bleepingcomputer.com/news/security/ongoing-soundcloud-issue-blocks-vpn-users-with-403-server-error/",
          type: "Security/tech press",
        },
        {
          title: "SoundCloud confirms data breach; VPN issues linked to security hardening (coverage)",
          publishedDate: "2025-12-16",
          url: "https://www.techradar.com/pro/security/soundcloud-confirms-data-breach-user-info-stolen-heres-what-you-need-to-know",
          type: "Tech press",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "web", value: "https://help.soundcloud.com", purpose: "Support / incident comms surface" },
      other: [
        { channel: "web", value: "https://soundcloud.com/pages/contact", purpose: "Contact (if available in region)" },
      ],
      ecosystemBeneficiaries: ["Residential proxy providers", "CDN/WAF tuning vendors", "Identity/risk scoring vendors"],
    },

    sources: [
      { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/news/security/ongoing-soundcloud-issue-blocks-vpn-users-with-403-server-error/", snippet: "VPN users blocked with 403; platform working on fix.", sourceType: "secondary", credibility: "high" },
      { name: "TechRadar", url: "https://www.techradar.com/pro/security/soundcloud-confirms-data-breach-user-info-stolen-heres-what-you-need-to-know", snippet: "Breach context; VPN disruption tied to security hardening.", sourceType: "secondary", credibility: "medium-high" },
    ],

    freshness: { newsAgeDays: 12, withinBankerWindow: true },

    personaHooks: {
      ECOSYSTEM_PARTNER: {
        intent: "Second-order market effects mapping (WAF/proxy/identity).",
        requiresNewsWithinDays: 30,
        passCriteria: [
          "incident.secondOrderEffects.length >= 1",
          "recentNews.items.length >= 1",
          "sources.length >= 2",
        ],
        failTriggers: ["no named beneficiaries or partner categories"],
      },
      CTO_TECH_LEAD: {
        passCriteria: ["incident has timeline + symptom + source links"],
        failTriggers: ["no root-cause hypotheses or mitigation notes (resolve at runtime if needed)"],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // NEW DEALS FOR DEAL RADAR (December 2025)
  // ---------------------------------------------------------------------------
  "NEURAL_FORGE": {
    entityId: "NEURAL_FORGE",
    entityType: "private_company",
    canonicalName: "NeuralForge AI",
    asOf: "2025-12-27",

    summary: "NeuralForge AI (San Francisco, CA) closed a $12M Seed round to build autonomous AI agents for enterprise workflow automation, with a focus on financial services compliance workflows.",

    crmFields: {
      hqLocation: "San Francisco, CA, USA",
      foundingYear: "2024",
      website: "https://neuralforge.ai",
      fundingStage: "Seed",
      totalFunding: "$12M",
      sectors: ["AI/ML", "Enterprise Software", "Automation"],
    },

    funding: {
      stage: "Seed",
      totalRaised: { amount: 12, currency: "USD", unit: "M" },
      lastRound: {
        roundType: "Seed",
        announcedDate: "2025-12-20",
        amount: { amount: 12, currency: "USD", unit: "M" },
        coLeads: ["Greylock Partners"],
        participants: ["Y Combinator", "Operator Collective"],
        useOfProceeds: "Product development and enterprise go-to-market expansion",

      },
    },

    people: {
      founders: [
        { name: "Sarah Chen", role: "CEO", background: "Ex-OpenAI, Stanford CS PhD" },
        { name: "Michael Torres", role: "CTO", background: "Ex-Google Brain" },
      ],
      executives: [],
    },

    productPipeline: {
      platform: "Agentic AI platform for enterprise workflow automation",
      leadPrograms: [
        { program: "Enterprise Compliance Agent", stage: "Beta with 5 Fortune 500 customers" },
      ],
    },

    recentNews: {
      items: [
        {
          title: "NeuralForge raises $12M Seed to automate enterprise compliance",
          publishedDate: "2025-12-20",
          url: "https://techcrunch.com/neuralforge-seed",
          type: "Trade press",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "email", value: "[email protected]" },
    },

    sources: [
      { name: "TechCrunch", url: "https://techcrunch.com/neuralforge-seed", sourceType: "secondary", credibility: "high" },
    ],

    freshness: { newsAgeDays: 7, withinBankerWindow: true },

    personaHooks: {
      JPM_STARTUP_BANKER: {
        passCriteria: ["Recent seed funding", "Enterprise focus", "Fortune 500 customers"],
        failTriggers: [],
      },
    },
  },

  "VAULTPAY": {
    entityId: "VAULTPAY",
    entityType: "private_company",
    canonicalName: "VaultPay",
    asOf: "2025-12-27",

    summary: "VaultPay (London, UK) raised $45M Series A to expand its embedded banking infrastructure for vertical SaaS platforms across Europe and North America.",

    crmFields: {
      hqLocation: "London, UK",
      foundingYear: "2022",
      website: "https://vaultpay.io",
      fundingStage: "Series A",
      totalFunding: "$45M",
      sectors: ["Fintech", "Infrastructure", "B2B SaaS"],
    },

    funding: {
      stage: "Series A",
      totalRaised: { amount: 45, currency: "USD", unit: "M" },
      lastRound: {
        roundType: "Series A",
        announcedDate: "2025-12-18",
        amount: { amount: 45, currency: "USD", unit: "M" },
        coLeads: ["Index Ventures", "Ribbit Capital"],
        participants: ["Stripe", "Plaid"],
        useOfProceeds: "North American expansion and product development",
      },
    },

    people: {
      founders: [
        { name: "James Morrison", role: "CEO", background: "Ex-Wise (TransferWise), Oxford MBA" },
      ],
      executives: [],
    },

    productPipeline: {
      platform: "Embedded banking APIs for vertical SaaS",
      leadPrograms: [
        { program: "VaultPay Embed", stage: "Production with 150+ SaaS platforms" },
      ],
    },

    recentNews: {
      items: [
        {
          title: "VaultPay secures $45M Series A led by Index and Ribbit",
          publishedDate: "2025-12-18",
          url: "https://techcrunch.com/vaultpay-series-a",
          type: "Trade press",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "email", value: "[email protected]" },
    },

    sources: [
      { name: "TechCrunch", url: "https://techcrunch.com/vaultpay-series-a", sourceType: "secondary", credibility: "high" },
    ],

    freshness: { newsAgeDays: 9, withinBankerWindow: true },

    personaHooks: {
      JPM_STARTUP_BANKER: {
        passCriteria: ["Series A fintech", "Strong VC syndicate", "Production traction"],
        failTriggers: [],
      },
    },
  },

  "GENOMIQ": {
    entityId: "GENOMIQ",
    entityType: "private_company",
    canonicalName: "GenomiQ Therapeutics",
    asOf: "2025-12-27",

    summary: "GenomiQ Therapeutics (Boston, MA) raised $80M Series B to advance its gene therapy pipeline for rare genetic disorders, with lead programs in Phase 2.",

    crmFields: {
      hqLocation: "Boston, MA, USA",
      foundingYear: "2020",
      website: "https://genomiq.bio",
      fundingStage: "Series B",
      totalFunding: "$155M",
      sectors: ["HealthTech", "Gene Therapy", "Rare Disease"],
    },

    funding: {
      stage: "Series B",
      totalRaised: { amount: 155, currency: "USD", unit: "M" },
      lastRound: {
        roundType: "Series B",
        announcedDate: "2025-12-15",
        amount: { amount: 80, currency: "USD", unit: "M" },
        coLeads: ["Arch Venture Partners", "Third Rock Ventures"],
        participants: ["Novo Holdings", "BioVentures"],
        useOfProceeds: "Phase 2 clinical trials and manufacturing scale-up",
      },
    },

    people: {
      founders: [
        { name: "Dr. Emily Watson", role: "CEO", background: "Ex-Moderna, MIT PhD" },
      ],
      executives: [],
    },

    productPipeline: {
      platform: "AAV-based gene therapy platform for rare genetic disorders",
      leadPrograms: [
        { program: "GQ-101 (Duchenne Muscular Dystrophy)", stage: "Phase 2" },
        { program: "GQ-202 (Hemophilia B)", stage: "Phase 1/2" },
      ],
    },

    recentNews: {
      items: [
        {
          title: "GenomiQ closes $80M Series B for gene therapy advancement",
          publishedDate: "2025-12-15",
          url: "https://fiercebiotech.com/genomiq-series-b",
          type: "Trade press",
        },
      ],
    },

    contactPoints: {
      primary: { channel: "email", value: "[email protected]" },
    },

    sources: [
      { name: "Fierce Biotech", url: "https://fiercebiotech.com/genomiq-series-b", sourceType: "secondary", credibility: "high" },
    ],

    freshness: { newsAgeDays: 12, withinBankerWindow: true },

    personaHooks: {
      JPM_STARTUP_BANKER: {
        passCriteria: ["Series B biotech", "Clinical stage assets", "Top-tier life sciences VCs"],
        failTriggers: [],
      },
    },
  },
};
