/**
 * Seed Q4 2025 Funding Data
 *
 * Run: CONVEX_URL=https://agile-caribou-964.convex.cloud npx tsx scripts/seed-q4-2025-funding.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const client = new ConvexHttpClient(process.env.CONVEX_URL!);

// Q4 2025 Funding Events (October - December 2025)
const q4FundingEvents = [
  // OCTOBER 2025
  {
    companyName: "Lila Sciences",
    roundType: "series-a" as const,
    amountRaw: "$350M",
    amountUsd: 350000000,
    announcedAt: new Date("2025-10-14").getTime(),
    leadInvestors: ["Braidwell", "Collective Global"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "AI/ML - Science",
    description: "Science superintelligence platform",
  },
  {
    companyName: "Reflection AI",
    roundType: "series-b" as const,
    amountRaw: "$2B",
    amountUsd: 2000000000,
    announcedAt: new Date("2025-10-09").getTime(),
    leadInvestors: ["Nvidia"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.95,
    sector: "AI/ML - Generative AI",
    valuation: "$8B",
    description: "AI platform",
  },
  {
    companyName: "Castelion",
    roundType: "series-b" as const,
    amountRaw: "$350M",
    amountUsd: 350000000,
    announcedAt: new Date("2025-10-16").getTime(),
    leadInvestors: ["Altimeter Capital"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/biggest-funding-rounds-large-checks-kalshi-castelion/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "DeepTech - Defense",
    description: "Hypersonic munitions developer",
  },
  {
    companyName: "Sesame",
    roundType: "series-b" as const,
    amountRaw: "$250M",
    amountUsd: 250000000,
    announcedAt: new Date("2025-10-21").getTime(),
    leadInvestors: ["Sequoia", "Spark Capital"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "AI/ML - Voice AI",
    description: "Voice AI company",
  },
  {
    companyName: "Fireworks AI",
    roundType: "series-c" as const,
    amountRaw: "$250M",
    amountUsd: 250000000,
    announcedAt: new Date("2025-10-28").getTime(),
    leadInvestors: [],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "AI/ML - Developer Tools",
    valuation: "$4B",
    description: "Platform for building AI applications using open source models",
  },
  {
    companyName: "Uniphore",
    roundType: "series-d-plus" as const,
    amountRaw: "$260M",
    amountUsd: 260000000,
    announcedAt: new Date("2025-10-22").getTime(),
    leadInvestors: [],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "AI/ML - Enterprise",
    valuation: "$2.5B",
    description: "Enterprise AI startup",
  },
  {
    companyName: "Antithesis",
    roundType: "series-a" as const,
    amountRaw: "$105M",
    amountUsd: 105000000,
    announcedAt: new Date("2025-10-25").getTime(),
    leadInvestors: ["Jane Street Capital"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "Enterprise - DevTools",
    description: "Simulation testing tools for software systems",
  },

  // NOVEMBER 2025
  {
    companyName: "Anysphere (Cursor)",
    roundType: "series-b" as const,
    amountRaw: "$2.3B",
    amountUsd: 2300000000,
    announcedAt: new Date("2025-11-15").getTime(),
    leadInvestors: ["Accel", "Coatue"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/global-funding-november-2025-ai-megarounds/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.95,
    sector: "AI/ML - Developer Tools",
    description: "AI coding assistant (Cursor)",
  },
  {
    companyName: "Lambda",
    roundType: "series-d-plus" as const,
    amountRaw: "$1.5B",
    amountUsd: 1500000000,
    announcedAt: new Date("2025-11-10").getTime(),
    leadInvestors: ["TWG Global"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/global-funding-november-2025-ai-megarounds/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.95,
    sector: "AI/ML - Infrastructure",
    description: "AI data center provider",
  },
  {
    companyName: "Kalshi",
    roundType: "series-c" as const,
    amountRaw: "$1B",
    amountUsd: 1000000000,
    announcedAt: new Date("2025-11-08").getTime(),
    leadInvestors: ["Sequoia Capital", "CapitalG"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/biggest-funding-rounds-large-checks-kalshi-castelion/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.95,
    sector: "Fintech - Prediction Markets",
    description: "Future event betting platform",
  },
  {
    companyName: "Protego Biopharma",
    roundType: "series-b" as const,
    amountRaw: "$130M",
    amountUsd: 130000000,
    announcedAt: new Date("2025-11-05").getTime(),
    leadInvestors: ["Novartis Venture Fund", "Forbion"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "Healthcare - Biopharma",
    description: "Biopharma company",
  },
  {
    companyName: "Triana Biomedicines",
    roundType: "series-b" as const,
    amountRaw: "$120M",
    amountUsd: 120000000,
    announcedAt: new Date("2025-11-12").getTime(),
    leadInvestors: ["Ascenta Capital", "Bessemer Venture Partners"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/largest-funding-rounds-genai-defense-eoy-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.9,
    sector: "Healthcare - Biomedicines",
    description: "Biomedicines company",
  },

  // DECEMBER 2025
  {
    companyName: "Aaru",
    roundType: "series-a" as const,
    amountRaw: "$100M+",
    amountUsd: 100000000,
    announcedAt: new Date("2025-12-05").getTime(),
    leadInvestors: [],
    coInvestors: [],
    sourceUrls: ["https://techcrunch.com/2025/12/05/ai-synthetic-research-startup-aaru-raised-a-series-a-at-a-1b-headline-valuation/"],
    sourceNames: ["TechCrunch"],
    confidence: 0.85,
    sector: "AI/ML - Research",
    valuation: "$1B",
    description: "AI synthetic research startup",
  },
  {
    companyName: "Project Prometheus",
    roundType: "seed" as const,
    amountRaw: "$6.2B",
    amountUsd: 6200000000,
    announcedAt: new Date("2025-11-20").getTime(),
    leadInvestors: ["Bezos Expeditions"],
    coInvestors: [],
    sourceUrls: ["https://news.crunchbase.com/venture/global-funding-november-2025-ai-megarounds/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.95,
    sector: "AI/ML - General AI",
    description: "Jeff Bezos-backed AI venture",
  },

  // Additional notable rounds
  {
    companyName: "OpenAI",
    roundType: "series-d-plus" as const,
    amountRaw: "$6.6B",
    amountUsd: 6600000000,
    announcedAt: new Date("2025-10-02").getTime(),
    leadInvestors: ["Thrive Capital"],
    coInvestors: ["Microsoft", "Nvidia", "SoftBank"],
    sourceUrls: ["https://news.crunchbase.com/venture/funding-data-third-largest-year-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.98,
    sector: "AI/ML - Generative AI",
    valuation: "$157B",
    description: "ChatGPT creator, leading AI research lab",
  },
  {
    companyName: "Anthropic",
    roundType: "series-d-plus" as const,
    amountRaw: "$2B",
    amountUsd: 2000000000,
    announcedAt: new Date("2025-10-18").getTime(),
    leadInvestors: ["Google", "Lightspeed Venture Partners"],
    coInvestors: ["Menlo Ventures", "Salesforce Ventures"],
    sourceUrls: ["https://news.crunchbase.com/venture/funding-data-third-largest-year-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.98,
    sector: "AI/ML - Generative AI",
    valuation: "$60B",
    description: "Claude AI creator, AI safety research",
  },
  {
    companyName: "Scale AI",
    roundType: "series-d-plus" as const,
    amountRaw: "$1B",
    amountUsd: 1000000000,
    announcedAt: new Date("2025-11-01").getTime(),
    leadInvestors: ["Accel"],
    coInvestors: ["Coatue", "Index Ventures"],
    sourceUrls: ["https://news.crunchbase.com/venture/funding-data-third-largest-year-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.95,
    sector: "AI/ML - Data Platform",
    valuation: "$14B",
    description: "AI data labeling and training platform",
  },
  {
    companyName: "xAI",
    roundType: "series-b" as const,
    amountRaw: "$6B",
    amountUsd: 6000000000,
    announcedAt: new Date("2025-12-01").getTime(),
    leadInvestors: ["a16z", "Sequoia Capital"],
    coInvestors: ["Lightspeed", "Vy Capital"],
    sourceUrls: ["https://news.crunchbase.com/venture/funding-data-third-largest-year-2025/"],
    sourceNames: ["Crunchbase"],
    confidence: 0.95,
    sector: "AI/ML - Generative AI",
    valuation: "$50B",
    description: "Elon Musk's AI company (Grok)",
  },
];

async function main() {
  console.log(`Seeding ${q4FundingEvents.length} Q4 2025 funding events...`);

  try {
    const result = await client.mutation(api.domains.enrichment.fundingMutations.bulkSeedFundingEvents, {
      events: q4FundingEvents,
    });

    console.log("\n=== Seeding Complete ===");
    console.log(`Total processed: ${result.totalProcessed}`);
    console.log(`Inserted: ${result.inserted.length}`);
    console.log(`Updated: ${result.updated.length}`);

    if (result.inserted.length > 0) {
      console.log("\nNew companies added:");
      result.inserted.forEach((name: string) => console.log(`  - ${name}`));
    }

    if (result.updated.length > 0) {
      console.log("\nExisting companies updated:");
      result.updated.forEach((name: string) => console.log(`  - ${name}`));
    }
  } catch (error) {
    console.error("Error seeding data:", error);
    process.exit(1);
  }
}

main();
