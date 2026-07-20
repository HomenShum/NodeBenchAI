/**
 * Ship Demo Day 2026 - Real-World Test Fixtures
 *
 * Event: AI Agents in Prod - Ship Demo Day
 * Date: April 23, 2026
 * Location: 717 Market St #100, San Francisco, CA
 *
 * These fixtures provide real-world test scenarios for persona-based evaluation.
 * Maps to existing PersonaId values: CTO_TECH_LEAD, EARLY_STAGE_VC, FOUNDER_STRATEGY, JOURNALIST, JPM_STARTUP_BANKER
 */

// ═══════════════════════════════════════════════════════════════════════════
// EVENT COMPANIES
// ═══════════════════════════════════════════════════════════════════════════

export const SHIP_DEMO_DAY_COMPANIES = {
  vercel: {
    name: "Vercel",
    slug: "vercel",
    description: "Frontend cloud platform, Next.js maintainers",
    category: "infrastructure",
    speakers: ["Guillermo Rauch"],
    workshop: "Next.js + AI SDK",
    url: "https://vercel.com",
  },
  elevenlabs: {
    name: "ElevenLabs",
    slug: "elevenlabs",
    description: "Voice AI platform for synthetic speech",
    category: "voice-ai",
    speakers: ["Mati Staniszewski"],
    useCase: "Voice agents, narration, dubbing",
    url: "https://elevenlabs.io",
  },
  wundergraph: {
    name: "WunderGraph",
    slug: "wundergraph",
    description: "API composition and developer platform",
    category: "api-tools",
    speakers: ["Ahmet Soormally"],
    workshop: "API-first development",
    url: "https://wundergraph.com",
  },
  comet: {
    name: "Comet / Opik",
    slug: "comet-ml",
    description: "LLM observability and evaluation platform",
    category: "observability",
    speakers: ["Vincent Koc"],
    focus: "Agent monitoring, tracing, evaluation",
    url: "https://www.comet.com",
  },
  insforge: {
    name: "InsForge",
    slug: "insforge",
    description: "Insurance infrastructure platform",
    category: "vertical-saas",
    speakers: ["Hang H."],
    speakerRole: "Co-Founder & CEO",
    url: "https://insforge.com",
  },
  bland: {
    name: "Bland AI",
    slug: "bland-ai",
    description: "Conversational AI for phone calls",
    category: "voice-ai",
    speakers: ["Maggie Jones"],
    speakerRole: "Senior FDE",
    url: "https://bland.ai",
  },
  deepmind: {
    name: "Google DeepMind",
    slug: "deepmind",
    description: "AI research and applied AI",
    category: "research",
    featured: true,
    url: "https://deepmind.google",
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

export interface TestScenario {
  id: string;
  personaId: "CTO_TECH_LEAD" | "EARLY_STAGE_VC" | "FOUNDER_STRATEGY" | "JOURNALIST" | "JPM_STARTUP_BANKER";
  caseName: string;
  query: string;
  expectedContains?: string[];
  minResponseLength?: number;
  maxTimeSeconds?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA SCENARIOS FOR EVENT
// ═══════════════════════════════════════════════════════════════════════════

// QA/Technical validation scenarios - mapped to JPM_STARTUP_BANKER (technical + risk-aware)
export const QA_ENGINEER_SCENARIOS: TestScenario[] = [
  {
    id: "qa-vercel-adapter",
    personaId: "JPM_STARTUP_BANKER",
    caseName: "Vercel AI SDK Adapter Edge Cases",
    query: "Test the Vercel AI SDK adapter in NodeBench - what edge cases should I watch for with streaming responses?",
    expectedContains: ["Vercel", "adapter", "streaming"],
    minResponseLength: 150,
    maxTimeSeconds: 30,
  },
  {
    id: "qa-context-window",
    personaId: "JPM_STARTUP_BANKER",
    caseName: "Multi-turn Context Window Handling",
    query: "How does the multi-turn conversation handler deal with context window limits when discussing ElevenLabs pricing?",
    expectedContains: ["context", "window", "limit"],
    minResponseLength: 100,
    maxTimeSeconds: 25,
  },
  {
    id: "qa-insforge-funding",
    personaId: "JPM_STARTUP_BANKER",
    caseName: "InsForge Funding Data Verification",
    query: "Verify funding data accuracy for InsForge - what sources back the claims about their seed round?",
    expectedContains: ["source", "funding", "InsForge"],
    minResponseLength: 100,
    maxTimeSeconds: 30,
  },
];

// AI Agent Engineer scenarios - mapped to CTO_TECH_LEAD
export const AI_AGENT_ENGINEER_SCENARIOS: TestScenario[] = [
  {
    id: "ai-elevenlabs-integration",
    personaId: "CTO_TECH_LEAD",
    caseName: "ElevenLabs Voice Integration Pattern",
    query: "How does ElevenLabs voice integration work in NodeBench? Show me the implementation pattern for adding voice to an agent.",
    expectedContains: ["ElevenLabs", "voice", "integration"],
    minResponseLength: 200,
    maxTimeSeconds: 30,
  },
  {
    id: "ai-wundergraph-mcp",
    personaId: "CTO_TECH_LEAD",
    caseName: "WunderGraph MCP Tool Availability",
    query: "What MCP tools are available for WunderGraph API composition? Can I use them to build a unified API gateway?",
    expectedContains: ["MCP", "WunderGraph", "API"],
    minResponseLength: 150,
    maxTimeSeconds: 25,
  },
  {
    id: "ai-latency-budget",
    personaId: "CTO_TECH_LEAD",
    caseName: "Fast Agent Panel Latency Budget",
    query: "What is the latency budget for streaming responses in the Fast Agent Panel? How does it handle backpressure?",
    expectedContains: ["latency", "streaming", "budget"],
    minResponseLength: 150,
    maxTimeSeconds: 25,
  },
];

// Investor scenarios - mapped to EARLY_STAGE_VC
export const INVESTOR_SCENARIOS: TestScenario[] = [
  {
    id: "inv-ai-infrastructure-landscape",
    personaId: "EARLY_STAGE_VC",
    caseName: "AI Agent Infrastructure Key Players",
    query: "Who are the key players in AI agent infrastructure? Compare Vercel, ElevenLabs, and WunderGraph in terms of market positioning.",
    expectedContains: ["Vercel", "ElevenLabs", "WunderGraph"],
    minResponseLength: 250,
    maxTimeSeconds: 35,
  },
  {
    id: "inv-funding-comparison",
    personaId: "EARLY_STAGE_VC",
    caseName: "InsForge vs Bland AI Funding Comparison",
    query: "Compare funding stages: InsForge vs Bland AI - who has raised more and at what stage? What's their valuation?",
    expectedContains: ["funding", "InsForge", "Bland AI"],
    minResponseLength: 200,
    maxTimeSeconds: 30,
  },
  {
    id: "inv-voice-ai-market",
    personaId: "EARLY_STAGE_VC",
    caseName: "Voice AI Market Landscape",
    query: "Market landscape for voice AI companies - how does ElevenLabs position vs competitors like Bland AI and PlayHT?",
    expectedContains: ["ElevenLabs", "voice", "market"],
    minResponseLength: 250,
    maxTimeSeconds: 35,
  },
];

// CEO/CTO scenarios - mapped to FOUNDER_STRATEGY
export const CEO_CTO_SCENARIOS: TestScenario[] = [
  {
    id: "ceo-strategic-positioning",
    personaId: "FOUNDER_STRATEGY",
    caseName: "NodeBench Strategic Positioning",
    query: "Strategic positioning: Where does NodeBench fit in the AI agent stack vs competitors like Vercel and WunderGraph?",
    expectedContains: ["positioning", "stack", "competitor"],
    minResponseLength: 300,
    maxTimeSeconds: 40,
  },
  {
    id: "ceo-market-timing",
    personaId: "FOUNDER_STRATEGY",
    caseName: "AI Agent Market Timing Risk Assessment",
    query: "Risk assessment for AI agent market timing - is now the right time to build? What are the risks of being too early or too late?",
    expectedContains: ["risk", "market", "timing"],
    minResponseLength: 300,
    maxTimeSeconds: 40,
  },
  {
    id: "ceo-ecosystem-analysis",
    personaId: "FOUNDER_STRATEGY",
    caseName: "Ship Demo Day Ecosystem Analysis",
    query: "Competitive analysis: How does Ship Demo Day lineup position the AI agent ecosystem? What patterns do you see?",
    expectedContains: ["competitive", "ecosystem", "analysis"],
    minResponseLength: 300,
    maxTimeSeconds: 40,
  },
];

// Product Engineer scenarios - mapped to CTO_TECH_LEAD
export const PRODUCT_ENGINEER_SCENARIOS: TestScenario[] = [
  {
    id: "prod-api-external",
    personaId: "CTO_TECH_LEAD",
    caseName: "NodeBench External API Documentation",
    query: "What APIs does NodeBench expose for external integrations? Show me the OpenAPI spec or endpoints for creating artifacts programmatically.",
    expectedContains: ["API", "endpoint", "integration"],
    minResponseLength: 200,
    maxTimeSeconds: 30,
  },
  {
    id: "prod-comet-integration",
    personaId: "CTO_TECH_LEAD",
    caseName: "Comet/Opik Observability Integration",
    query: "How would I integrate Comet/Opik observability into my custom agent? Show me the tracing setup.",
    expectedContains: ["Comet", "Opik", "observability"],
    minResponseLength: 200,
    maxTimeSeconds: 30,
  },
  {
    id: "prod-research-pipeline",
    personaId: "CTO_TECH_LEAD",
    caseName: "Research Pipeline Architecture",
    query: "Document the research pipeline architecture - what are the main components and how do they communicate?",
    expectedContains: ["research", "pipeline", "component"],
    minResponseLength: 250,
    maxTimeSeconds: 35,
  },
];

// Marketing/Sales scenarios - mapped to JOURNALIST (content creation focused)
export const MARKETING_SALES_SCENARIOS: TestScenario[] = [
  {
    id: "mkt-positioning-narrative",
    personaId: "JOURNALIST",
    caseName: "AI Agent Founder Positioning Narrative",
    query: "Generate a positioning narrative for AI agent founders attending Ship Demo Day. What should their one-liner be?",
    expectedContains: ["narrative", "founder", "agent"],
    minResponseLength: 200,
    maxTimeSeconds: 30,
  },
  {
    id: "mkt-vercel-pitch",
    personaId: "JOURNALIST",
    caseName: "Vercel Developer Pitch Points",
    query: "Create talking points for pitching NodeBench to Vercel developers. What would resonate with their audience?",
    expectedContains: ["Vercel", "developer", "pitch"],
    minResponseLength: 200,
    maxTimeSeconds: 30,
  },
  {
    id: "mkt-linkedin-post",
    personaId: "JOURNALIST",
    caseName: "Ship Demo Day Learnings Post",
    query: "Draft a LinkedIn post about learnings from Ship Demo Day workshops. What would get engagement from the AI community?",
    expectedContains: ["Ship Demo Day", "workshop", "learning"],
    minResponseLength: 200,
    maxTimeSeconds: 30,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// ALL SCENARIOS COMBINED
// ═══════════════════════════════════════════════════════════════════════════

export const ALL_SHIP_DEMO_DAY_SCENARIOS: TestScenario[] = [
  ...QA_ENGINEER_SCENARIOS,
  ...AI_AGENT_ENGINEER_SCENARIOS,
  ...INVESTOR_SCENARIOS,
  ...CEO_CTO_SCENARIOS,
  ...PRODUCT_ENGINEER_SCENARIOS,
  ...MARKETING_SALES_SCENARIOS,
];

// ═══════════════════════════════════════════════════════════════════════════
// VIEWPORT CONFIGURATIONS FOR TESTING
// ═══════════════════════════════════════════════════════════════════════════

export const TEST_VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1920", width: 1920, height: 1080 },
  { name: "mobile-iphone14", width: 390, height: 844 },
  { name: "mobile-ipad", width: 768, height: 1024 },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// SUCCESS CRITERIA
// ═══════════════════════════════════════════════════════════════════════════

export const SUCCESS_CRITERIA = {
  minResponseLength: 150,
  maxResponseTimeSeconds: 30,
  requiredSources: 2,
  minConfidenceScore: 0.7,
} as const;
