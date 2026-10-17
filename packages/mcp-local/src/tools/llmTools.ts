/**
 * LLM tools — Direct model calling and structured extraction.
 * Bridges the gap between methodology tools (which track) and action tools (which do).
 *
 * - call_llm: Call any available model via env API keys, get response + metrics
 * - extract_structured_data: LLM-powered JSON extraction from unstructured text
 *
 * Provider fallback: Gemini → OpenAI → Anthropic (same pattern as web_search)
 */

import type { McpTool } from "../types.js";

// ─── Provider detection ──────────────────────────────────────────────────────

interface LlmProvider {
  name: string;
  available: boolean;
  call: (args: { system?: string; prompt: string; maxTokens?: number; temperature?: number }) => Promise<{
    response: string;
    model: string;
    tokensUsed: { input: number; output: number };
  }>;
}

async function getGeminiProvider(): Promise<LlmProvider | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    return {
      name: "gemini",
      available: true,
      call: async ({ system, prompt, maxTokens, temperature }) => {
        const model = "gemini-3-flash";
        const result = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: system ? `${system}\n\n${prompt}` : prompt }] }],
          config: {
            maxOutputTokens: maxTokens ?? 1024,
            temperature: temperature ?? 0.7,
          },
        });
        const text = typeof result.text === "string" ? result.text : "";
        const usage = result.usageMetadata;
        return {
          response: text,
          model,
          tokensUsed: {
            input: usage?.promptTokenCount ?? 0,
            output: usage?.candidatesTokenCount ?? 0,
          },
        };
      },
    };
  } catch {
    return null;
  }
}

async function getOpenAIProvider(): Promise<LlmProvider | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI();
    return {
      name: "openai",
      available: true,
      call: async ({ system, prompt, maxTokens, temperature }) => {
        const model = "gpt-5-mini";
        const messages: Array<{ role: "system" | "user"; content: string }> = [];
        if (system) messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });
        const result = await client.chat.completions.create({
          model,
          messages,
          max_tokens: maxTokens ?? 1024,
          temperature: temperature ?? 0.7,
        });
        const text = result.choices?.[0]?.message?.content ?? "";
        return {
          response: text,
          model,
          tokensUsed: {
            input: result.usage?.prompt_tokens ?? 0,
            output: result.usage?.completion_tokens ?? 0,
          },
        };
      },
    };
  } catch {
    return null;
  }
}

async function getAnthropicProvider(): Promise<LlmProvider | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();
    return {
      name: "anthropic",
      available: true,
      call: async ({ system, prompt, maxTokens, temperature }) => {
        const model = "claude-haiku-4-5-20251001";
        const result = await client.messages.create({
          model,
          max_tokens: maxTokens ?? 1024,
          system: system ?? "",
          messages: [{ role: "user", content: prompt }],
          // No temperature: Claude 4.7+/5.x answer 400 to non-default sampling.
        });
        const text = result.content
          .filter((b) => b.type === "text")
          .map((b) => (b as any).text as string)
          .join("");
        return {
          response: text,
          model,
          tokensUsed: {
            input: result.usage?.input_tokens ?? 0,
            output: result.usage?.output_tokens ?? 0,
          },
        };
      },
    };
  } catch {
    return null;
  }
}

async function getProvider(): Promise<LlmProvider | null> {
  return (await getGeminiProvider()) ?? (await getOpenAIProvider()) ?? (await getAnthropicProvider());
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const llmTools: McpTool[] = [
  {
    name: "call_llm",
    description:
      "Call an LLM model directly and get the response with metrics (tokens, latency). Uses available API keys: Gemini → OpenAI → Anthropic. Useful for eval-driven workflows, model comparison, structured analysis, and any task where the agent needs an LLM call as a step in its pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The user prompt to send" },
        system: { type: "string", description: "Optional system prompt" },
        maxTokens: { type: "number", description: "Max output tokens (default: 1024)" },
        temperature: { type: "number", description: "Temperature 0-1 (default: 0.7)" },
      },
      required: ["prompt"],
    },
    handler: async (args: { prompt: string; system?: string; maxTokens?: number; temperature?: number }) => {
      const start = Date.now();

      const provider = await getProvider();
      if (!provider) {
        return {
          error: true,
          message: "No LLM provider available. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.",
          providers: {
            gemini: !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_AI_API_KEY,
            openai: !!process.env.OPENAI_API_KEY,
            anthropic: !!process.env.ANTHROPIC_API_KEY,
          },
        };
      }

      try {
        const result = await provider.call({
          system: args.system,
          prompt: args.prompt,
          maxTokens: args.maxTokens,
          temperature: args.temperature,
        });

        return {
          response: result.response,
          model: result.model,
          provider: provider.name,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return {
          error: true,
          message: `LLM call failed: ${err.message ?? String(err)}`,
          provider: provider.name,
          latencyMs: Date.now() - start,
        };
      }
    },
  },

  {
    name: "extract_structured_data",
    description:
      "Extract structured JSON data from unstructured text using an LLM. Provide the text and a description of the fields you want extracted. Returns validated JSON matching your schema. Useful for turning research findings, web pages, or documents into structured data.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The unstructured text to extract data from" },
        fields: {
          type: "string",
          description:
            "Description of fields to extract, e.g. 'company_name (string), funding_amount (number), round_type (string), investors (array of strings)'",
        },
        context: { type: "string", description: "Optional context about what this text is and what to focus on" },
      },
      required: ["text", "fields"],
    },
    handler: async (args: { text: string; fields: string; context?: string }) => {
      const start = Date.now();

      const provider = await getProvider();
      if (!provider) {
        return {
          error: true,
          message: "No LLM provider available. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.",
        };
      }

      const system = `You are a data extraction assistant. Extract structured data from the provided text and return ONLY valid JSON. No explanation, no markdown, just the JSON object.`;

      const prompt = [
        args.context ? `Context: ${args.context}` : null,
        `Extract these fields: ${args.fields}`,
        "",
        "Text to extract from:",
        args.text.slice(0, 8000), // Cap input to avoid token limits
        "",
        "Return ONLY a JSON object with the extracted fields. Use null for fields that cannot be determined from the text.",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const result = await provider.call({ system, prompt, maxTokens: 2048, temperature: 0.1 });

        // Parse the JSON response
        let data: unknown;
        try {
          // Strip markdown code blocks if present
          const cleaned = result.response.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
          data = JSON.parse(cleaned);
        } catch {
          return {
            error: true,
            message: "LLM response was not valid JSON",
            rawResponse: result.response.slice(0, 500),
            provider: provider.name,
            latencyMs: Date.now() - start,
          };
        }

        return {
          data,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return {
          error: true,
          message: `Extraction failed: ${err.message ?? String(err)}`,
          provider: provider.name,
          latencyMs: Date.now() - start,
        };
      }
    },
  },

  {
    name: "benchmark_models",
    description:
      "Run the same prompt against multiple LLM providers and compare responses. Returns side-by-side results with latency, token usage, and a summary. Useful for model selection, quality comparison, and cost analysis.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The prompt to send to all models" },
        system: { type: "string", description: "Optional system prompt" },
        maxTokens: { type: "number", description: "Max output tokens per model (default: 512)" },
        temperature: { type: "number", description: "Temperature 0-1 (default: 0.7)" },
      },
      required: ["prompt"],
    },
    handler: async (args: { prompt: string; system?: string; maxTokens?: number; temperature?: number }) => {
      const providers: Array<{ name: string; getter: () => Promise<LlmProvider | null> }> = [
        { name: "gemini", getter: getGeminiProvider },
        { name: "openai", getter: getOpenAIProvider },
        { name: "anthropic", getter: getAnthropicProvider },
      ];

      const results: Array<{
        provider: string;
        model: string;
        response: string;
        tokensUsed: { input: number; output: number };
        latencyMs: number;
        error?: string;
      }> = [];

      for (const { name, getter } of providers) {
        const provider = await getter();
        if (!provider) continue;

        const start = Date.now();
        try {
          const result = await provider.call({
            system: args.system,
            prompt: args.prompt,
            maxTokens: args.maxTokens ?? 512,
            temperature: args.temperature,
          });
          results.push({
            provider: name,
            model: result.model,
            response: result.response,
            tokensUsed: result.tokensUsed,
            latencyMs: Date.now() - start,
          });
        } catch (err: any) {
          results.push({
            provider: name,
            model: "unknown",
            response: "",
            tokensUsed: { input: 0, output: 0 },
            latencyMs: Date.now() - start,
            error: err.message ?? String(err),
          });
        }
      }

      if (results.length === 0) {
        return {
          error: true,
          message: "No LLM providers available. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.",
        };
      }

      const fastest = results.reduce((a, b) => (a.latencyMs < b.latencyMs ? a : b));
      const totalTokens = results.reduce((s, r) => s + r.tokensUsed.input + r.tokensUsed.output, 0);

      return {
        results,
        modelsCompared: results.length,
        fastest: { provider: fastest.provider, model: fastest.model, latencyMs: fastest.latencyMs },
        totalTokensUsed: totalTokens,
        summary: `Compared ${results.length} model(s). Fastest: ${fastest.provider} (${fastest.model}) at ${fastest.latencyMs}ms.`,
      };
    },
  },
];
