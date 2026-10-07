/**
 * Seed entity contexts with real test data
 * This populates the entityContexts table for the EntityProfilePage to display
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

// Sample entities with realistic data including CRM fields for deep profile
const SAMPLE_ENTITIES = [
  {
    entityName: "Anthropic",
    entityType: "company" as const,
    summary: "Anthropic is an AI safety company focused on building reliable, interpretable, and steerable AI systems. Founded in 2021 by former OpenAI researchers including Dario and Daniela Amodei, the company has rapidly grown to become a leader in AI safety research and large language model development.",
    keyFacts: [
      "Founded in 2021 by Dario Amodei and Daniela Amodei",
      "Raised $7.3B in total funding as of 2024",
      "Creator of Claude, a family of AI assistants",
      "Pioneered Constitutional AI training approach",
      "Headquartered in San Francisco, CA"
    ],
    sources: [
      { name: "Anthropic Official", url: "https://anthropic.com", snippet: "AI safety company building reliable AI" },
      { name: "TechCrunch", url: "https://techcrunch.com/anthropic", snippet: "Latest funding and product news" },
      { name: "Bloomberg", url: "https://bloomberg.com", snippet: "Financial coverage and valuation" }
    ],
    funding: {
      stage: "Series D",
      totalRaised: { amount: 7.3, unit: "B" },
      latestRound: { amount: 2, unit: "B", date: "2024-03" },
      investors: ["Google", "Salesforce", "Spark Capital", "Sound Ventures"],
      bankerTakeaway: "One of the most well-funded AI startups globally. Strategic investment from Google positions them as a key player in enterprise AI."
    },
    crmFields: {
      companyName: "Anthropic",
      description: "AI safety company building reliable, interpretable AI systems",
      headline: "Leading AI Safety Research Lab",
      hqLocation: "San Francisco, California, USA",
      city: "San Francisco",
      state: "California",
      country: "USA",
      website: "https://www.anthropic.com",
      email: "info@anthropic.com",
      phone: "",
      founders: ["Dario Amodei", "Daniela Amodei"],
      foundersBackground: "Former OpenAI VP of Research (Dario) and VP of Operations (Daniela). Both have deep expertise in AI alignment and scaling laws.",
      keyPeople: [
        { name: "Dario Amodei", title: "CEO" },
        { name: "Daniela Amodei", title: "President" },
        { name: "Tom Brown", title: "Co-Founder" },
        { name: "Chris Olah", title: "Co-Founder" },
        { name: "Jared Kaplan", title: "Co-Founder" }
      ],
      industry: "Artificial Intelligence",
      companyType: "Private",
      foundingYear: 2021,
      product: "Claude AI assistant family (Haiku, Sonnet, Opus)",
      targetMarket: "Enterprise, Developers, Consumers",
      businessModel: "API access, enterprise contracts, consumer subscription",
      fundingStage: "Series D",
      totalFunding: "$7.3B",
      lastFundingDate: "2024-03",
      investors: ["Google", "Salesforce", "Spark Capital", "Sound Ventures", "Menlo Ventures"],
      investorBackground: "Strategic investment from Google Cloud for enterprise distribution. Salesforce invested for AI CRM integration.",
      competitors: ["OpenAI", "Google DeepMind", "Cohere", "Meta AI"],
      competitorAnalysis: "Differentiated by safety-first approach and Constitutional AI. Competes with OpenAI on model capability but emphasizes reliability and interpretability.",
      fdaApprovalStatus: "",
      fdaTimeline: "",
      newsTimeline: [
        { date: "2024-03", headline: "Anthropic raises $2B in Series D led by Google", source: "TechCrunch" },
        { date: "2024-01", headline: "Claude 3 Opus achieves state-of-the-art on benchmarks", source: "Anthropic Blog" },
        { date: "2023-11", headline: "Amazon invests $4B in Anthropic", source: "Reuters" }
      ],
      recentNews: "Claude 3.5 Sonnet released with improved reasoning. Partnership with Amazon AWS expanded.",
      keyEntities: ["OpenAI", "Google", "Amazon"],
      researchPapers: ["Constitutional AI paper", "Scaling Laws research"],
      partnerships: ["Google Cloud", "Amazon AWS", "Salesforce"],
      completenessScore: 95,
      dataQuality: "verified" as const
    },
    freshness: {
      lastNewsDate: new Date().toISOString(),
      newsAgeDays: 1,
      isStale: false
    }
  },
  {
    entityName: "OpenAI",
    entityType: "company" as const,
    summary: "OpenAI is an AI research laboratory consisting of the for-profit OpenAI LP and the non-profit OpenAI Inc. Founded in December 2015, it has become one of the most influential AI companies in the world, creator of GPT-4, DALL-E, and ChatGPT.",
    keyFacts: [
      "Founded in 2015 by Sam Altman, Elon Musk, and others",
      "Valued at $80B+ after latest funding round",
      "Creator of ChatGPT with 100M+ weekly active users",
      "GPT-4 launched March 2023 with multimodal capabilities",
      "Microsoft strategic partnership worth $13B"
    ],
    sources: [
      { name: "OpenAI Blog", url: "https://openai.com/blog", snippet: "Official announcements and research" },
      { name: "Reuters", url: "https://reuters.com", snippet: "Business and financial reporting" },
      { name: "The Verge", url: "https://theverge.com", snippet: "Product launches and news" }
    ],
    funding: {
      stage: "Series E",
      totalRaised: { amount: 18, unit: "B" },
      latestRound: { amount: 6.6, unit: "B", date: "2024-10" },
      investors: ["Microsoft", "Thrive Capital", "Khosla Ventures", "Tiger Global"],
      bankerTakeaway: "The valuation leader in AI with Microsoft backing. Recent restructuring to for-profit model signals IPO ambitions."
    },
    freshness: {
      lastNewsDate: new Date().toISOString(),
      newsAgeDays: 0,
      isStale: false
    }
  },
  {
    entityName: "Google DeepMind",
    entityType: "company" as const,
    summary: "Google DeepMind is a British-American AI research laboratory and subsidiary of Alphabet Inc. Created in 2023 through the merger of DeepMind and Google Brain, it is focused on artificial general intelligence research and has produced breakthrough systems like AlphaFold and Gemini.",
    keyFacts: [
      "Formed from merger of DeepMind and Google Brain in 2023",
      "Created AlphaFold, solving protein structure prediction",
      "Developed Gemini family of multimodal AI models",
      "Led by Demis Hassabis, Nobel Prize winner 2024",
      "Over 3,000 researchers and engineers globally"
    ],
    sources: [
      { name: "DeepMind", url: "https://deepmind.google", snippet: "Research publications and news" },
      { name: "Nature", url: "https://nature.com", snippet: "Peer-reviewed research papers" },
      { name: "MIT Technology Review", url: "https://technologyreview.com", snippet: "AI research coverage" }
    ],
    funding: {
      stage: "Subsidiary",
      totalRaised: { amount: 0, unit: "B" },
      bankerTakeaway: "Fully owned by Alphabet. Key driver of Google's AI strategy and Gemini product line. Strategic moat in scientific AI applications."
    },
    freshness: {
      lastNewsDate: new Date().toISOString(),
      newsAgeDays: 2,
      isStale: false
    }
  },
  {
    entityName: "Sam Altman",
    entityType: "person" as const,
    summary: "Sam Altman is an American entrepreneur and investor, best known as the CEO of OpenAI. Previously president of Y Combinator, he has been a key figure in the AI industry and has advocated for both AI advancement and safety measures.",
    keyFacts: [
      "CEO of OpenAI since 2019",
      "Former President of Y Combinator (2014-2019)",
      "Co-founded Loopt, acquired by Green Dot for $43.4M",
      "Briefly ousted and reinstated as OpenAI CEO in Nov 2023",
      "Advocate for AI regulation and universal basic income"
    ],
    sources: [
      { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Sam_Altman", snippet: "Biography and career history" },
      { name: "Forbes", url: "https://forbes.com", snippet: "Business profile and net worth" },
      { name: "Time", url: "https://time.com", snippet: "Person of influence coverage" }
    ],
    freshness: {
      lastNewsDate: new Date().toISOString(),
      newsAgeDays: 0,
      isStale: false
    }
  },
  {
    entityName: "Dario Amodei",
    entityType: "person" as const,
    summary: "Dario Amodei is an Italian-American AI researcher and the CEO of Anthropic. Before founding Anthropic with his sister Daniela, he was VP of Research at OpenAI. He is known for his focus on AI safety and alignment research.",
    keyFacts: [
      "CEO and co-founder of Anthropic since 2021",
      "Former VP of Research at OpenAI",
      "PhD in Computational Neuroscience from Princeton",
      "Led development of Constitutional AI approach",
      "Sister Daniela Amodei is President of Anthropic"
    ],
    sources: [
      { name: "Anthropic", url: "https://anthropic.com/about", snippet: "Official biography" },
      { name: "The New York Times", url: "https://nytimes.com", snippet: "Profile and interviews" },
      { name: "Wired", url: "https://wired.com", snippet: "Tech industry coverage" }
    ],
    freshness: {
      lastNewsDate: new Date().toISOString(),
      newsAgeDays: 3,
      isStale: false
    }
  }
];

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  Seed Entity Contexts for EntityProfilePage               ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const client = new ConvexHttpClient(CONVEX_URL);

  console.log(`Seeding ${SAMPLE_ENTITIES.length} entities...\n`);

  for (const entity of SAMPLE_ENTITIES) {
    try {
      console.log(`  → ${entity.entityName} (${entity.entityType})...`);

      await client.mutation(api.domains.knowledge.entityContexts.storeEntityContext, {
        entityName: entity.entityName,
        entityType: entity.entityType,
        summary: entity.summary,
        keyFacts: entity.keyFacts,
        sources: entity.sources,
        funding: entity.funding,
        freshness: entity.freshness,
      });

      console.log(`    ✅ Stored successfully`);
    } catch (error) {
      console.error(`    ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Verify by querying a few entities
  for (const entity of SAMPLE_ENTITIES.slice(0, 3)) {
    try {
      const result = await client.query(api.domains.knowledge.entityContexts.getEntityContext, {
        entityName: entity.entityName,
        entityType: entity.entityType,
      });

      if (result) {
        console.log(`✅ ${entity.entityName}: Found with ${result.keyFacts?.length || 0} facts`);
      } else {
        console.log(`❌ ${entity.entityName}: Not found`);
      }
    } catch (error) {
      console.error(`❌ ${entity.entityName}: Query error - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\n✅ Entity seeding complete!");
  console.log("   Navigate to: http://localhost:5173/#entity/Anthropic");
  console.log("   Or: http://localhost:5173/#entity/OpenAI");
}

main().catch(console.error);
