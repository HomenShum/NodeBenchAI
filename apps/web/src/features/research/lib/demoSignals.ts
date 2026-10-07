/**
 * demoSignals.ts — Deterministic date-seeded demo signals for the Research Hub.
 *
 * When no Convex backend data is available, these signals make the digest
 * feel fresh on every visit without requiring a real data source.
 *
 * Determinism guarantee: same calendar date always produces the same signals.
 * Variation guarantee: different dates produce different signal selections.
 */

// ── Signal Pool ─────────────────────────────────────────────────────────────

interface DemoSignal {
  title: string;
  source: string;
  timestamp: number; // will be overwritten to match the requested date
  relevanceScore: number;
  entities: string[];
  category: 'regulation' | 'model-release' | 'funding' | 'enterprise' | 'open-source';
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

/**
 * 25 signals, 5 per category.  Rotate through them using the day-of-year
 * so the digest changes daily but stays realistic.
 */
const SIGNAL_POOL: DemoSignal[] = [
  // ── AI Regulation ────────────────────────────────────────────────────────
  {
    title: "EU AI Act enforcement begins for high-risk foundation models",
    source: "Reuters",
    timestamp: 0,
    relevanceScore: 0.94,
    entities: ["European Commission", "OpenAI", "Anthropic"],
    category: "regulation",
    sentiment: "neutral",
  },
  {
    title: "US Senate committee advances bipartisan AI disclosure bill",
    source: "Politico",
    timestamp: 0,
    relevanceScore: 0.88,
    entities: ["US Senate", "NIST"],
    category: "regulation",
    sentiment: "neutral",
  },
  {
    title: "China releases updated generative AI governance framework",
    source: "South China Morning Post",
    timestamp: 0,
    relevanceScore: 0.85,
    entities: ["CAC", "Baidu", "Alibaba"],
    category: "regulation",
    sentiment: "bearish",
  },
  {
    title: "California proposes mandatory AI watermarking for synthetic media",
    source: "TechCrunch",
    timestamp: 0,
    relevanceScore: 0.82,
    entities: ["California Legislature", "Google DeepMind"],
    category: "regulation",
    sentiment: "neutral",
  },
  {
    title: "UK AI Safety Institute publishes frontier model evaluation protocol",
    source: "Financial Times",
    timestamp: 0,
    relevanceScore: 0.90,
    entities: ["UK AISI", "Anthropic", "Google DeepMind"],
    category: "regulation",
    sentiment: "bullish",
  },

  // ── Model Releases ───────────────────────────────────────────────────────
  {
    title: "Anthropic ships Claude 4 with extended thinking and tool use improvements",
    source: "Anthropic Blog",
    timestamp: 0,
    relevanceScore: 0.97,
    entities: ["Anthropic", "Claude"],
    category: "model-release",
    sentiment: "bullish",
  },
  {
    title: "Google launches Gemini 2.5 Pro with native multimodal reasoning",
    source: "Google AI Blog",
    timestamp: 0,
    relevanceScore: 0.95,
    entities: ["Google", "Gemini"],
    category: "model-release",
    sentiment: "bullish",
  },
  {
    title: "Meta releases Llama 4 Scout and Maverick with 10M context windows",
    source: "Meta AI Blog",
    timestamp: 0,
    relevanceScore: 0.93,
    entities: ["Meta", "Llama"],
    category: "model-release",
    sentiment: "bullish",
  },
  {
    title: "Mistral publishes Codestral specialized for agentic code generation",
    source: "Mistral Blog",
    timestamp: 0,
    relevanceScore: 0.86,
    entities: ["Mistral", "Codestral"],
    category: "model-release",
    sentiment: "bullish",
  },
  {
    title: "DeepSeek-V3 demonstrates reasoning parity on MATH and GPQA benchmarks",
    source: "arXiv",
    timestamp: 0,
    relevanceScore: 0.89,
    entities: ["DeepSeek", "GPQA"],
    category: "model-release",
    sentiment: "neutral",
  },

  // ── Startup Funding ──────────────────────────────────────────────────────
  {
    title: "Cognition AI raises $175M Series B for autonomous software engineering",
    source: "Bloomberg",
    timestamp: 0,
    relevanceScore: 0.91,
    entities: ["Cognition AI", "Devin"],
    category: "funding",
    sentiment: "bullish",
  },
  {
    title: "Cohere closes $500M round at $5.5B valuation for enterprise AI",
    source: "The Information",
    timestamp: 0,
    relevanceScore: 0.88,
    entities: ["Cohere"],
    category: "funding",
    sentiment: "bullish",
  },
  {
    title: "Poolside raises $500M for AI coding with reinforcement learning",
    source: "Forbes",
    timestamp: 0,
    relevanceScore: 0.85,
    entities: ["Poolside"],
    category: "funding",
    sentiment: "bullish",
  },
  {
    title: "Glean raises $260M for enterprise AI search at $4.6B valuation",
    source: "TechCrunch",
    timestamp: 0,
    relevanceScore: 0.83,
    entities: ["Glean"],
    category: "funding",
    sentiment: "bullish",
  },
  {
    title: "Harvey AI secures $100M Series C for legal AI assistant platform",
    source: "WSJ",
    timestamp: 0,
    relevanceScore: 0.80,
    entities: ["Harvey AI"],
    category: "funding",
    sentiment: "bullish",
  },

  // ── Enterprise Adoption ──────────────────────────────────────────────────
  {
    title: "JPMorgan deploys LLM-powered research assistant across 60,000 analysts",
    source: "Bloomberg",
    timestamp: 0,
    relevanceScore: 0.92,
    entities: ["JPMorgan", "Morgan Stanley"],
    category: "enterprise",
    sentiment: "bullish",
  },
  {
    title: "Walmart integrates agentic AI for supply chain optimization",
    source: "WSJ",
    timestamp: 0,
    relevanceScore: 0.87,
    entities: ["Walmart"],
    category: "enterprise",
    sentiment: "bullish",
  },
  {
    title: "McKinsey reports 72% of Fortune 500 now use AI in core workflows",
    source: "McKinsey Global Institute",
    timestamp: 0,
    relevanceScore: 0.90,
    entities: ["McKinsey"],
    category: "enterprise",
    sentiment: "bullish",
  },
  {
    title: "Salesforce Agentforce handles 25% of customer service tickets autonomously",
    source: "Salesforce Earnings Call",
    timestamp: 0,
    relevanceScore: 0.84,
    entities: ["Salesforce", "Agentforce"],
    category: "enterprise",
    sentiment: "bullish",
  },
  {
    title: "Deutsche Bank pilots AI agent for trade compliance review",
    source: "Financial Times",
    timestamp: 0,
    relevanceScore: 0.81,
    entities: ["Deutsche Bank"],
    category: "enterprise",
    sentiment: "neutral",
  },

  // ── Open Source ───────────────────────────────────────────────────────────
  {
    title: "LangChain v0.3 ships native MCP support for tool orchestration",
    source: "GitHub",
    timestamp: 0,
    relevanceScore: 0.89,
    entities: ["LangChain", "MCP"],
    category: "open-source",
    sentiment: "bullish",
  },
  {
    title: "Hugging Face crosses 1M public model checkpoints on the Hub",
    source: "Hugging Face Blog",
    timestamp: 0,
    relevanceScore: 0.86,
    entities: ["Hugging Face"],
    category: "open-source",
    sentiment: "bullish",
  },
  {
    title: "vLLM 0.7 achieves 2x throughput improvement for speculative decoding",
    source: "GitHub",
    timestamp: 0,
    relevanceScore: 0.83,
    entities: ["vLLM"],
    category: "open-source",
    sentiment: "bullish",
  },
  {
    title: "Ollama adds native function calling support for local models",
    source: "Ollama Blog",
    timestamp: 0,
    relevanceScore: 0.80,
    entities: ["Ollama"],
    category: "open-source",
    sentiment: "bullish",
  },
  {
    title: "CrewAI and AutoGen merge agent orchestration standards proposal",
    source: "GitHub Discussions",
    timestamp: 0,
    relevanceScore: 0.78,
    entities: ["CrewAI", "AutoGen", "Microsoft"],
    category: "open-source",
    sentiment: "neutral",
  },
];

// ── Deterministic seeded selection ──────────────────────────────────────────

/** Simple deterministic hash from a date string to a number. */
function dateSeed(date: Date): number {
  const str = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Seeded shuffle (Fisher-Yates with deterministic seed). */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = ((s * 1664525 + 1013904223) & 0x7fffffff);
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface DemoSignalResult {
  title: string;
  source: string;
  timestamp: number;
  relevanceScore: number;
  entities: string[];
  category: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface DemoBriefResult {
  dateString: string;
  signals: DemoSignalResult[];
  signalCount: number;
  sourceCount: number;
  entityCount: number;
  lastUpdated: string;
  /** One-line headline for the "Today's Signal" card on the landing page. */
  headline: string;
  headlineCategory: string;
}

/**
 * Return 5 realistic demo signals for the given date.
 *
 * Guarantees:
 * - Deterministic: same date -> same signals.
 * - At least 3 categories represented.
 * - Counts vary slightly day-to-day for the live feel.
 */
export function getDemoSignalsForDate(date: Date): DemoBriefResult {
  const seed = dateSeed(date);
  const shuffled = seededShuffle(SIGNAL_POOL, seed);

  // Pick 5 signals ensuring category diversity (take first of each category, then fill)
  const seen = new Set<string>();
  const picked: DemoSignal[] = [];

  for (const sig of shuffled) {
    if (picked.length >= 5) break;
    if (!seen.has(sig.category)) {
      seen.add(sig.category);
      picked.push(sig);
    }
  }
  // Fill remaining slots
  for (const sig of shuffled) {
    if (picked.length >= 5) break;
    if (!picked.includes(sig)) {
      picked.push(sig);
    }
  }

  // Stamp timestamps: stagger backwards from "now" on the given date
  const baseTs = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    8, 0, 0,
  ).getTime();

  const signals: DemoSignalResult[] = picked.map((sig, i) => ({
    ...sig,
    timestamp: baseTs - i * 3600_000, // 1 hour apart
  }));

  // Compute aggregate counts with seed-based micro-variance
  const allEntities = new Set(signals.flatMap((s) => s.entities));
  const allSources = new Set(signals.map((s) => s.source));

  // Small variance on entity/source counts so repeat visitors notice change
  const variance = (seed % 3) + 1; // 1-3

  const dateString = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const lastUpdated = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return {
    dateString,
    signals,
    signalCount: signals.length + variance,
    sourceCount: allSources.size + variance,
    entityCount: allEntities.size + variance,
    lastUpdated,
    headline: signals[0].title,
    headlineCategory: signals[0].category,
  };
}

/**
 * Returns a daily-rotating "Today's Signal" headline for the landing page.
 * Uses day-of-week to cycle through the 5 categories.
 */
export function getTodaySignalForLanding(date: Date): {
  headline: string;
  category: string;
  source: string;
  signalCount: number;
  sourceCount: number;
  entityCount: number;
  dateString: string;
} {
  const brief = getDemoSignalsForDate(date);
  return {
    headline: brief.headline,
    category: brief.headlineCategory,
    source: brief.signals[0].source,
    signalCount: brief.signalCount,
    sourceCount: brief.sourceCount,
    entityCount: brief.entityCount,
    dateString: brief.dateString,
  };
}
