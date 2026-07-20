/**
 * llmProvider.ts — Unified LLM provider abstraction with fallback rotation.
 *
 * Three providers: Gemini (default), Claude (fallback), OpenAI (fallback).
 * Selection strategy:
 *   - Classification: Gemini 3.1 Flash Lite Preview
 *   - Analysis: Gemini 3 Flash Preview -> Claude Haiku 4.5 -> OpenAI GPT-5.4 Mini
 *   - Deep diligence: Claude Sonnet 4.6 -> Gemini 3.1 Pro Preview (if keys available)
 *
 * Configuration via env vars:
 *   - GEMINI_API_KEY (required for primary)
 *   - ANTHROPIC_API_KEY (optional, enables Claude fallback)
 *   - OPENAI_API_KEY (optional, enables OpenAI fallback)
 *   - LLM_PROVIDER_PRIORITY=gemini,claude,openai (optional override)
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface ClassificationResult {
  type: string;
  entity?: string;
  entities?: string[];
  lens: string;
}

export interface AnalysisResult {
  summary: string;
  signals: Array<{ name: string; direction: string; impact: string }>;
  changes: Array<{ description: string; date: string | null }>;
  risks: Array<{ title: string; description: string }>;
  nextActions: Array<{ action: string }>;
}

export interface LLMProvider {
  readonly name: string;
  readonly available: boolean;
  classify(query: string, lens: string): Promise<ClassificationResult>;
  analyze(query: string, lens: string, context: string): Promise<AnalysisResult>;
}

// ─── Provider: Gemini ────────────────────────────────────────────────

class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly available: boolean;
  private apiKey: string;

  constructor() {
    this.apiKey = (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : "") ?? "";
    this.available = !!this.apiKey;
  }

  async classify(query: string, lens: string): Promise<ClassificationResult> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Classify this search query for NodeBench entity intelligence.
Return JSON only: {"type":"company_search"|"competitor"|"multi_entity"|"weekly_reset"|"pre_delegation"|"important_change"|"plan_proposal"|"general","entity":"primary entity or null","entities":["e1","e2"],"lens":"${lens}"}

Query: "${query}"` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(7_000),
      },
    );
    if (!response.ok) throw new Error(`Gemini classify failed: ${response.status}`);
    const data = await response.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Gemini classify: no JSON in response");
    const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;
    return { type: parsed.type || "general", entity: parsed.entity, entities: parsed.entities, lens: parsed.lens || lens };
  }

  async analyze(query: string, lens: string, context: string): Promise<AnalysisResult> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Analyze this query and context. User is a ${lens}. Query: "${query}"

CONTEXT:
${context.slice(0, 3000)}

Return ONLY valid JSON:
{"summary":"2-3 sentence analysis","signals":[{"name":"insight","direction":"up|down|neutral","impact":"high|medium|low"}],"changes":[{"description":"development","date":"YYYY-MM-DD or null"}],"risks":[{"title":"risk","description":"evidence"}],"nextActions":[{"action":"recommended step"}]}

RULES: Only include facts grounded in the context. If data is thin, return fewer items.` }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1200, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`Gemini analyze failed: ${response.status}`);
    const data = await response.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Gemini analyze: no JSON in response");
    return JSON.parse(jsonMatch[0].replace(/,\s*([\]}])/g, "$1")) as AnalysisResult;
  }
}

// ─── Provider: Claude ────────────────────────────────────────────────

class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  readonly available: boolean;
  private apiKey: string;

  constructor() {
    this.apiKey = (typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : "") ?? "";
    this.available = !!this.apiKey;
  }

  async classify(query: string, lens: string): Promise<ClassificationResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 200,
        messages: [{ role: "user", content: `Classify this search query. Return JSON only: {"type":"company_search"|"competitor"|"multi_entity"|"weekly_reset"|"pre_delegation"|"important_change"|"plan_proposal"|"general","entity":"primary entity or null","entities":["e1"],"lens":"${lens}"}

Query: "${query}"` }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Claude classify failed: ${response.status}`);
    const data = await response.json() as any;
    const text = data?.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude classify: no JSON in response");
    const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;
    return { type: parsed.type || "general", entity: parsed.entity, entities: parsed.entities, lens: parsed.lens || lens };
  }

  async analyze(query: string, lens: string, context: string): Promise<AnalysisResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content: `Analyze this query and context. User is a ${lens}. Query: "${query}"

CONTEXT:
${context.slice(0, 3000)}

Return ONLY valid JSON:
{"summary":"2-3 sentence analysis","signals":[{"name":"insight","direction":"up|down|neutral","impact":"high|medium|low"}],"changes":[{"description":"development","date":"YYYY-MM-DD or null"}],"risks":[{"title":"risk","description":"evidence"}],"nextActions":[{"action":"recommended step"}]}

RULES: Only include facts grounded in the context. If data is thin, return fewer items.` }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Claude analyze failed: ${response.status}`);
    const data = await response.json() as any;
    const text = data?.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude analyze: no JSON in response");
    return JSON.parse(jsonMatch[0].replace(/,\s*([\]}])/g, "$1")) as AnalysisResult;
  }
}

// ─── Provider: OpenAI ────────────────────────────────────────────────

class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly available: boolean;
  private apiKey: string;

  constructor() {
    this.apiKey = (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : "") ?? "";
    this.available = !!this.apiKey;
  }

  async classify(query: string, lens: string): Promise<ClassificationResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: `Classify this search query. Return JSON: {"type":"company_search"|"competitor"|"multi_entity"|"weekly_reset"|"pre_delegation"|"important_change"|"plan_proposal"|"general","entity":"primary entity or null","entities":["e1"],"lens":"${lens}"}

Query: "${query}"` }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`OpenAI classify failed: ${response.status}`);
    const data = await response.json() as any;
    const text = data?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as ClassificationResult;
    return { type: parsed.type || "general", entity: parsed.entity, entities: parsed.entities, lens: parsed.lens || lens };
  }

  async analyze(query: string, lens: string, context: string): Promise<AnalysisResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: `Analyze this query and context. User is a ${lens}. Query: "${query}"

CONTEXT:
${context.slice(0, 3000)}

Return ONLY valid JSON:
{"summary":"2-3 sentence analysis","signals":[{"name":"insight","direction":"up|down|neutral","impact":"high|medium|low"}],"changes":[{"description":"development","date":"YYYY-MM-DD or null"}],"risks":[{"title":"risk","description":"evidence"}],"nextActions":[{"action":"recommended step"}]}

RULES: Only include facts grounded in the context. If data is thin, return fewer items.` }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`OpenAI analyze failed: ${response.status}`);
    const data = await response.json() as any;
    const text = data?.choices?.[0]?.message?.content ?? "";
    return JSON.parse(text) as AnalysisResult;
  }
}

// ─── Provider Registry ──────────────────────────────────────────────

const providers: LLMProvider[] = [new GeminiProvider(), new ClaudeProvider(), new OpenAIProvider()];

function getProviderPriority(): string[] {
  const envPriority = (typeof process !== "undefined" ? process.env?.LLM_PROVIDER_PRIORITY : "") ?? "";
  if (envPriority) return envPriority.split(",").map((s) => s.trim()).filter(Boolean);
  return ["gemini", "claude", "openai"];
}

/**
 * Get the first available provider from the priority list.
 */
export function getProvider(preferred?: string): LLMProvider | null {
  if (preferred) {
    const p = providers.find((p) => p.name === preferred && p.available);
    if (p) return p;
  }
  const priority = getProviderPriority();
  for (const name of priority) {
    const p = providers.find((p) => p.name === name && p.available);
    if (p) return p;
  }
  return providers.find((p) => p.available) ?? null;
}

/**
 * Classify with fallback rotation: try each available provider in priority order.
 */
export async function classifyWithFallback(query: string, lens: string): Promise<ClassificationResult> {
  const priority = getProviderPriority();
  let lastError: Error | null = null;

  for (const name of priority) {
    const provider = providers.find((p) => p.name === name && p.available);
    if (!provider) continue;
    try {
      return await provider.classify(query, lens);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[llmProvider] ${name} classify failed, trying next:`, lastError.message);
    }
  }

  // All providers failed — return a basic regex fallback
  return { type: "general", lens };
}

/**
 * Analyze with fallback rotation.
 */
export async function analyzeWithFallback(query: string, lens: string, context: string): Promise<AnalysisResult | null> {
  const priority = getProviderPriority();
  let lastError: Error | null = null;

  for (const name of priority) {
    const provider = providers.find((p) => p.name === name && p.available);
    if (!provider) continue;
    try {
      return await provider.analyze(query, lens, context);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[llmProvider] ${name} analyze failed, trying next:`, lastError.message);
    }
  }

  return null;
}

/**
 * List available providers with status.
 */
export function listProviders(): Array<{ name: string; available: boolean }> {
  return providers.map((p) => ({ name: p.name, available: p.available }));
}
