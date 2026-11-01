/**
 * Research writing tools — AI-powered academic paper polishing, translation,
 * logic checking, and reviewer simulation.
 *
 * Adapted from battle-tested prompts in awesome-ai-research-writing
 * (https://github.com/Leey21/awesome-ai-research-writing) — used at MSRA,
 * Bytedance Seed, SH AI Lab, and top Chinese universities.
 *
 * Provider fallback: Gemini → OpenAI → Anthropic (same as llmTools.ts)
 */

import type { McpTool } from "../types.js";

// ─── Provider detection (mirrored from llmTools.ts) ─────────────────────────

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
          config: { maxOutputTokens: maxTokens ?? 2048, temperature: temperature ?? 0.3 },
        });
        const text = typeof result.text === "string" ? result.text : "";
        const usage = result.usageMetadata;
        return {
          response: text,
          model,
          tokensUsed: { input: usage?.promptTokenCount ?? 0, output: usage?.candidatesTokenCount ?? 0 },
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
          max_tokens: maxTokens ?? 2048,
          temperature: temperature ?? 0.3,
        });
        const text = result.choices?.[0]?.message?.content ?? "";
        return {
          response: text,
          model,
          tokensUsed: { input: result.usage?.prompt_tokens ?? 0, output: result.usage?.completion_tokens ?? 0 },
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
          max_tokens: maxTokens ?? 2048,
          system: system ?? "",
          messages: [{ role: "user", content: prompt }],
          // No temperature: Claude 4.7+/5.x answer 400 to non-default sampling.
        });
        const text = result.content.filter((b) => b.type === "text").map((b) => (b as any).text as string).join("");
        return {
          response: text,
          model,
          tokensUsed: { input: result.usage?.input_tokens ?? 0, output: result.usage?.output_tokens ?? 0 },
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

function noProvider() {
  return {
    error: true,
    message: "No LLM provider available. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.",
  };
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export const researchWritingTools: McpTool[] = [
  {
    name: "polish_academic_text",
    description:
      "Deep-polish academic text for top-venue quality (NeurIPS, ICLR, ICML, ACL). Handles English and Chinese papers. Fixes grammar, enhances clarity, enforces formal academic tone, removes contractions and AI-style vocabulary. Preserves LaTeX commands, citations, and math. Returns polished text + modification log.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The academic text to polish" },
        targetVenue: {
          type: "string",
          enum: ["NeurIPS", "ICLR", "ICML", "ACL", "AAAI", "CVPR", "general"],
          description: "Target venue for style calibration (default: general)",
        },
        language: {
          type: "string",
          enum: ["en", "zh"],
          description: "Language of the input text (default: en)",
        },
      },
      required: ["text"],
    },
    handler: async (args: Record<string, unknown>) => {
      const text = String(args.text ?? "");
      const venue = String(args.targetVenue ?? "general");
      const lang = String(args.language ?? "en");
      if (!text.trim()) return { error: true, message: "text is required" };

      const provider = await getProvider();
      if (!provider) return noProvider();

      const system = lang === "zh"
        ? `You are a senior Chinese academic editor for top CS journals. Rewrite the input into polished, formal Chinese academic prose. Rules: (1) Output pure text — no Markdown bold/italic. (2) Use full-width Chinese punctuation. (3) Replace colloquial phrasing with formal academic language. (4) Preserve English technical terms (Transformer, CNN, etc.) without forced translation. Output Part 1 [Refined Text] and Part 2 [Review Comments] only.`
        : `You are a senior academic editor for ${venue} papers. Deep-polish the input to publication standard. Rules: (1) No bold/italic/quotes in LaTeX. (2) No dashes (—) — use clauses or appositions. (3) No \\item lists — use coherent paragraphs. (4) Present tense for methods and conclusions. (5) Remove contractions (it's → it is). (6) Use common precise words, avoid obscure vocabulary. (7) Preserve all \\cite{}, \\ref{}, math ($...$). (8) Escape special chars (% → \\%, _ → \\_). Output Part 1 [LaTeX] and Part 2 [Translation] and Part 3 [Modification Log] only.`;

      const start = Date.now();
      try {
        const result = await provider.call({ system, prompt: text.slice(0, 12000), maxTokens: 4096, temperature: 0.2 });
        return {
          polishedText: result.response,
          venue,
          language: lang,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return { error: true, message: `Polish failed: ${err.message ?? String(err)}`, latencyMs: Date.now() - start };
      }
    },
  },

  {
    name: "translate_academic",
    description:
      "Translate academic text between Chinese and English, preserving LaTeX commands, citations, equations, and technical terminology. Returns translated text plus a terminology dictionary for consistency checking across sections.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The text to translate" },
        from: { type: "string", enum: ["en", "zh"], description: "Source language" },
        to: { type: "string", enum: ["en", "zh"], description: "Target language" },
        domain: { type: "string", description: "Research domain for terminology, e.g. 'computer vision', 'NLP', 'reinforcement learning'" },
      },
      required: ["text", "from", "to"],
    },
    handler: async (args: Record<string, unknown>) => {
      const text = String(args.text ?? "");
      const from = String(args.from ?? "");
      const to = String(args.to ?? "");
      const domain = String(args.domain ?? "computer science");
      if (!text.trim() || !from || !to) return { error: true, message: "text, from, and to are required" };
      if (from === to) return { error: true, message: "Source and target language must differ" };

      const provider = await getProvider();
      if (!provider) return noProvider();

      const system = from === "zh" && to === "en"
        ? `You are an expert academic translator (Chinese → English) specializing in ${domain}. Translate the Chinese draft into polished English academic prose. Rules: (1) Rigorous logic, precise wording, concise and coherent. Use common words, avoid obscure terms. (2) No dashes (—). Use clauses or appositions. (3) No \\item lists. (4) Remove AI flavor. (5) Use present tense for methods/conclusions. (6) Escape LaTeX special chars (% → \\%, _ → \\_). Preserve math ($...$). Output: Part 1 [LaTeX]: English text only. Part 2 [Translation]: Chinese back-translation for verification. Part 3 [Terminology]: JSON dict of key term translations.`
        : `You are an expert academic translator (English → Chinese) specializing in ${domain}. Translate the LaTeX snippet into fluent Chinese. Rules: (1) Delete all \\cite{}, \\ref{}, \\label{}. (2) For \\textbf{text}, \\emph{text}, translate only the inner text. (3) Convert math to readable text (e.g. $\\alpha$ → alpha, \\frac{a}{b} → a/b). (4) Strict direct translation — do not polish or optimize. (5) Maintain sentence order for easy cross-referencing. Output: Part 1 [Translation]: Pure Chinese text. Part 2 [Terminology]: JSON dict of key terms.`;

      const start = Date.now();
      try {
        const result = await provider.call({ system, prompt: text.slice(0, 12000), maxTokens: 4096, temperature: 0.2 });
        return {
          translation: result.response,
          direction: `${from} → ${to}`,
          domain,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return { error: true, message: `Translation failed: ${err.message ?? String(err)}`, latencyMs: Date.now() - start };
      }
    },
  },

  {
    name: "compress_or_expand_text",
    description:
      "Precisely compress or expand academic text by a target word count. Compress mode: remove filler words, convert clauses to phrases, passive to active. Expand mode: add logical connectors, explicit reasoning, implicit conclusions. Preserves all core information and LaTeX formatting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The academic text to adjust" },
        mode: { type: "string", enum: ["compress", "expand"], description: "Whether to shorten or lengthen the text" },
        targetDelta: { type: "number", description: "Target word count change (default: 10 words)" },
      },
      required: ["text", "mode"],
    },
    handler: async (args: Record<string, unknown>) => {
      const text = String(args.text ?? "");
      const mode = String(args.mode ?? "");
      const delta = Number(args.targetDelta ?? 10);
      if (!text.trim() || !mode) return { error: true, message: "text and mode are required" };

      const provider = await getProvider();
      if (!provider) return noProvider();

      const system = mode === "compress"
        ? `You are a top academic editor specializing in conciseness. Reduce the text by approximately ${delta} words. Rules: (1) Preserve ALL core information, technical details, and experimental parameters. (2) Convert clauses to phrases, passive to active where shorter. (3) Remove filler ("in order to" → "to"). (4) Keep LaTeX clean — no bold/italic/dashes. (5) Escape special chars. Output: Part 1 [LaTeX]: compressed text. Part 2 [Translation]: Chinese back-translation. Part 3 [Modification Log]: what was removed/shortened.`
        : `You are a top academic editor specializing in logical depth. Expand the text by approximately ${delta} words. Rules: (1) Do NOT add filler or repeat content. (2) Make implicit conclusions explicit. (3) Add necessary logical connectors (Furthermore, Notably). (4) Upgrade simple descriptions to precise academic expressions. (5) Keep LaTeX clean. Output: Part 1 [LaTeX]: expanded text. Part 2 [Translation]: Chinese back-translation. Part 3 [Modification Log]: what was added and why.`;

      const start = Date.now();
      const originalWords = text.split(/\s+/).length;
      try {
        const result = await provider.call({ system, prompt: text.slice(0, 12000), maxTokens: 4096, temperature: 0.2 });
        return {
          adjustedText: result.response,
          mode,
          targetDelta: delta,
          originalWordCount: originalWords,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return { error: true, message: `${mode} failed: ${err.message ?? String(err)}`, latencyMs: Date.now() - start };
      }
    },
  },

  {
    name: "remove_ai_signatures",
    description:
      "Detect and remove AI-generated writing signatures from academic text. First runs pattern matching for known AI vocabulary (leverage, delve, tapestry, mechanical connectors), then uses LLM to rewrite flagged sections naturally. Returns cleaned text and a list of AI patterns found.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The text to de-AI-ify" },
      },
      required: ["text"],
    },
    handler: async (args: Record<string, unknown>) => {
      const text = String(args.text ?? "");
      if (!text.trim()) return { error: true, message: "text is required" };

      // Phase 1: Pattern-match known AI signatures
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\b(leverage|leveraging|leveraged)\b/gi, label: "leverage → use" },
        { regex: /\b(delve|delving|delves)\b/gi, label: "delve → investigate/examine" },
        { regex: /\btapestry\b/gi, label: "tapestry → context/landscape" },
        { regex: /\b(utilize|utilizing|utilization)\b/gi, label: "utilize → use" },
        { regex: /\b(furthermore|moreover|additionally),?\s/gi, label: "mechanical connector" },
        { regex: /\bit is worth noting that\b/gi, label: "filler phrase" },
        { regex: /\bfirst and foremost\b/gi, label: "filler phrase" },
        { regex: /\bin conclusion,?\s/gi, label: "mechanical transition" },
        { regex: /\bplays a (?:crucial|pivotal|vital) role\b/gi, label: "cliche" },
        { regex: /\b(comprehensive|robust|holistic|multifaceted)\b/gi, label: "AI-overused adjective" },
        { regex: /\bIt is important to (?:note|emphasize|highlight)\b/gi, label: "filler" },
        { regex: /\b(realm|landscape|paradigm)\b/gi, label: "AI-overused noun" },
      ];

      const detectedPatterns: Array<{ pattern: string; count: number; label: string }> = [];
      for (const { regex, label } of patterns) {
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
          detectedPatterns.push({ pattern: matches[0], count: matches.length, label });
        }
      }

      // Phase 2: LLM rewrite if patterns found
      if (detectedPatterns.length === 0) {
        return {
          cleanedText: text,
          patternsFound: 0,
          detectedPatterns: [],
          verdict: "No significant AI signatures detected. Text appears natural.",
        };
      }

      const provider = await getProvider();
      if (!provider) {
        return {
          cleanedText: text,
          patternsFound: detectedPatterns.length,
          detectedPatterns,
          verdict: "AI patterns detected but no LLM provider available for rewrite. Manual review recommended.",
        };
      }

      const system = `You are a senior academic editor removing AI-generated writing patterns. Rewrite the text to sound natural and human-authored. Rules: (1) Replace overused words: leverage→use, delve→investigate, utilize→use, tapestry→context, etc. (2) Remove mechanical connectors (First and foremost, It is worth noting). Let sentences connect through logical flow. (3) Reduce dashes (—). Use commas, parentheses, or clauses. (4) No bold/italic emphasis in academic text. (5) If the text is already natural in parts, preserve those parts exactly. (6) Output Part 1 [LaTeX]: rewritten text. Part 2 [Modification Log]: what changed and why. If minimal changes needed, say so.`;

      const start = Date.now();
      try {
        const result = await provider.call({ system, prompt: text.slice(0, 12000), maxTokens: 4096, temperature: 0.3 });
        return {
          cleanedText: result.response,
          patternsFound: detectedPatterns.length,
          detectedPatterns,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return {
          cleanedText: text,
          patternsFound: detectedPatterns.length,
          detectedPatterns,
          error: true,
          message: `Rewrite failed: ${err.message ?? String(err)}`,
        };
      }
    },
  },

  {
    name: "check_paper_logic",
    description:
      "Check academic text for logical issues: contradictions between statements, undefined terms, terminology inconsistency, and Chinglish patterns. Uses a high-tolerance threshold — only flags issues that genuinely impede comprehension. Returns structured issues with severity and location.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The academic text to check" },
        checkType: {
          type: "string",
          enum: ["contradictions", "terminology", "grammar", "all"],
          description: "Type of logic check (default: all)",
        },
      },
      required: ["text"],
    },
    handler: async (args: Record<string, unknown>) => {
      const text = String(args.text ?? "");
      const checkType = String(args.checkType ?? "all");
      if (!text.trim()) return { error: true, message: "text is required" };

      const provider = await getProvider();
      if (!provider) return noProvider();

      const system = `You are an academic proofreader performing a final "red-line review" of a near-final manuscript. CRITICAL: Assume the draft has been through multiple revisions and is high quality. Only flag issues that BLOCK reader comprehension.

Check dimensions:
${checkType === "contradictions" || checkType === "all" ? "- Fatal logic: completely contradictory statements across sections" : ""}
${checkType === "terminology" || checkType === "all" ? "- Terminology consistency: core concepts renamed without explanation" : ""}
${checkType === "grammar" || checkType === "all" ? "- Severe grammar: Chinglish or structural errors that make meaning unclear" : ""}

Rules:
(1) Do NOT flag style preferences or "could be better" suggestions.
(2) Do NOT suggest word replacements that are merely "more elegant."
(3) If no real issues exist, output: [检测通过，无实质性问题] / [No substantive issues found]

Output format: If issues found, return a JSON array:
[{"location":"paragraph/section","issue":"description","severity":"critical|high|medium","suggestion":"fix"}]
If no issues: {"passed":true,"message":"No substantive issues found"}`;

      const start = Date.now();
      try {
        const result = await provider.call({ system, prompt: text.slice(0, 12000), maxTokens: 2048, temperature: 0.1 });

        let parsed: unknown;
        try {
          const cleaned = result.response.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = { rawResponse: result.response };
        }

        return {
          result: parsed,
          checkType,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return { error: true, message: `Logic check failed: ${err.message ?? String(err)}`, latencyMs: Date.now() - start };
      }
    },
  },

  {
    name: "generate_academic_caption",
    description:
      "Generate academic figure or table captions following top-venue conventions. Handles Title Case for noun phrases, Sentence case for full sentences. Removes filler (no 'This figure shows...'). Returns both short and detailed caption versions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "What the figure/table shows — describe content, axes, data" },
        figureType: { type: "string", enum: ["figure", "table"], description: "Whether this is a figure or table caption" },
        style: {
          type: "string",
          enum: ["title_case", "sentence_case", "auto"],
          description: "Capitalization style (default: auto — noun phrases get Title Case, sentences get Sentence case)",
        },
      },
      required: ["description", "figureType"],
    },
    handler: async (args: Record<string, unknown>) => {
      const description = String(args.description ?? "");
      const figureType = String(args.figureType ?? "figure");
      const style = String(args.style ?? "auto");
      if (!description.trim()) return { error: true, message: "description is required" };

      const provider = await getProvider();
      if (!provider) return noProvider();

      const system = figureType === "table"
        ? `You are a senior academic editor writing table captions. Rules: (1) Use standard patterns: "Comparison with...", "Ablation study on...", "Results on...". (2) Avoid: showcase, depict. Use: show, compare, present. (3) Noun phrases → Title Case, no period. Full sentences → Sentence case, with period. (4) Do NOT include "Table 1:" prefix. (5) Escape LaTeX special chars (%, _, &). Preserve math ($...$). Output: {"short":"brief caption","detailed":"extended caption with methodology notes"}`
        : `You are a senior academic editor writing figure captions. Rules: (1) Start directly with content — NO "This figure shows" or "This diagram illustrates". (2) Noun phrases → Title Case, no period. Full sentences → Sentence case, with period. (3) Escape LaTeX special chars (%, _, &). Preserve math ($...$). (4) Do NOT include "Figure 1:" prefix. Output: {"short":"brief caption","detailed":"extended caption with methodology notes"}`;

      const start = Date.now();
      try {
        const result = await provider.call({ system, prompt: description.slice(0, 4000), maxTokens: 1024, temperature: 0.2 });

        let parsed: unknown;
        try {
          const cleaned = result.response.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = { short: result.response.trim(), detailed: result.response.trim() };
        }

        return {
          caption: parsed,
          figureType,
          style,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return { error: true, message: `Caption generation failed: ${err.message ?? String(err)}`, latencyMs: Date.now() - start };
      }
    },
  },

  {
    name: "analyze_experiment_data",
    description:
      "Analyze experiment data (CSV or JSON) and generate publication-ready analysis paragraphs. Uses \\paragraph{Conclusion} + analysis structure. Strict: all conclusions must be grounded in the provided data — no fabrication. Returns LaTeX or Markdown formatted analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        data: { type: "string", description: "Experiment data as CSV text or JSON string" },
        goal: { type: "string", description: "What you want the analysis to demonstrate, e.g. 'our method outperforms baselines on all metrics'" },
        format: { type: "string", enum: ["latex", "markdown"], description: "Output format (default: latex)" },
      },
      required: ["data", "goal"],
    },
    handler: async (args: Record<string, unknown>) => {
      const data = String(args.data ?? "");
      const goal = String(args.goal ?? "");
      const format = String(args.format ?? "latex");
      if (!data.trim() || !goal.trim()) return { error: true, message: "data and goal are required" };

      const provider = await getProvider();
      if (!provider) return noProvider();

      const system = `You are a senior data scientist writing experiment analysis for a top-tier CS conference paper. Rules:
(1) Data truthfulness: ALL conclusions must strictly come from the provided data. Never fabricate numbers, exaggerate improvements, or invent phenomena.
(2) No simple "accounting" (Method A is 0.5, B is 0.6). Focus on comparisons, trends, and insights.
(3) Analysis targets: effectiveness (SOTA comparison), sensitivity, efficiency trade-offs, ablation contributions.
(4) ${format === "latex" ? "Use \\paragraph{Conclusion Title} + analysis paragraph structure. No \\textbf or \\emph. Escape special chars (%, _, &). Separate conclusion blocks with blank lines." : "Use ### Conclusion Title + analysis paragraph structure."}
(5) If data shows no clear advantage, describe honestly — do not force a positive narrative.

Output: Part 1 [Analysis]: The formatted analysis. Part 2 [Translation]: Chinese back-translation for verification.`;

      const prompt = `Goal: ${goal}\n\nExperiment Data:\n${data.slice(0, 8000)}`;

      const start = Date.now();
      try {
        const result = await provider.call({ system, prompt, maxTokens: 4096, temperature: 0.2 });
        return {
          analysis: result.response,
          format,
          goal,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return { error: true, message: `Analysis failed: ${err.message ?? String(err)}`, latencyMs: Date.now() - start };
      }
    },
  },

  {
    name: "review_paper_as_reviewer",
    description:
      "Simulate a peer reviewer evaluating a paper for a top venue. Default: harsh mode with rejection mindset — only strong contributions change the verdict. Returns structured review: summary, strengths, critical weaknesses, rating (1-10), and strategic revision advice.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The paper text (abstract + sections, or full paper)" },
        venue: { type: "string", description: "Target venue, e.g. 'ICML 2026', 'NeurIPS 2025', 'ICLR 2026'" },
        strictness: {
          type: "string",
          enum: ["lenient", "moderate", "harsh"],
          description: "Review strictness (default: harsh)",
        },
      },
      required: ["text", "venue"],
    },
    handler: async (args: Record<string, unknown>) => {
      const text = String(args.text ?? "");
      const venue = String(args.venue ?? "");
      const strictness = String(args.strictness ?? "harsh");
      if (!text.trim() || !venue.trim()) return { error: true, message: "text and venue are required" };

      const provider = await getProvider();
      if (!provider) return noProvider();

      const strictnessPrompt = strictness === "harsh"
        ? "Default attitude: assume rejection unless the paper's strengths are compelling enough to change your mind. Skip pleasantries — cut directly to core flaws."
        : strictness === "moderate"
          ? "Balanced approach: acknowledge strengths but do not shy from pointing out weaknesses."
          : "Constructive approach: focus on helping authors improve. Still flag critical issues.";

      const system = `You are a senior reviewer for ${venue}, known for rigorous and precise reviews. ${strictnessPrompt}

Review dimensions:
- Originality: real breakthrough or incremental?
- Rigor: math sound? experiments fair (baselines complete)? ablations support claims?
- Consistency: do intro claims match experimental evidence?

Rules:
(1) Be SPECIFIC. Not "experiments insufficient" but "missing robustness evaluation on ImageNet-C".
(2) No lists for complex arguments — use coherent paragraphs.
(3) Keep LaTeX clean.

Output format:
Part 1 [Review]:
- Summary: one-sentence core contribution
- Strengths: 1-2 genuinely valuable points
- Weaknesses (Critical): 3-5 issues that could cause rejection
- Rating: X/10 (top 5% = 8+)

Part 2 [Strategic Advice]:
- What experiments to add, which logic to rewrite, how to reduce reviewer attack surface
- Use clear, actionable language`;

      const start = Date.now();
      try {
        const result = await provider.call({ system, prompt: text.slice(0, 12000), maxTokens: 4096, temperature: 0.3 });
        return {
          review: result.response,
          venue,
          strictness,
          provider: provider.name,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return { error: true, message: `Review failed: ${err.message ?? String(err)}`, latencyMs: Date.now() - start };
      }
    },
  },
];
