/**
 * NemoClaw Agent Runner
 *
 * Core execution loop: user message → intent classification → tool-calling loop → response.
 * Supports tiered models (nano for routing, mini for execution, full for synthesis).
 * Uses OpenRouter free tier (Nemotron, Qwen, DeepSeek) or Claude API as backend.
 */

import { desktopTools } from './desktopControl.js';
import { videoTools } from './videoCapture.js';
import { processTools } from './processControl.js';
import { codebaseTools } from './codebaseContext.js';

// Model configuration — multi-provider with adaptive tier selection
interface ModelConfig {
  provider: 'openrouter' | 'anthropic' | 'openai' | 'gemini';
  routingModel: string;
  apiKey: string;
  baseUrl: string;
}

// All available providers and their API keys
interface ProviderKeys {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  openrouter?: string;
}

function detectProviderKeys(): ProviderKeys {
  return {
    anthropic: process.env.ANTHROPIC_API_KEY?.startsWith('sk-ant-') ? process.env.ANTHROPIC_API_KEY : undefined,
    openai: process.env.OPENAI_API_KEY?.startsWith('sk-') ? process.env.OPENAI_API_KEY : undefined,
    gemini: process.env.GEMINI_API_KEY?.length ? process.env.GEMINI_API_KEY : undefined,
    openrouter: process.env.OPENROUTER_API_KEY?.length ? process.env.OPENROUTER_API_KEY : undefined,
  };
}

// Model tiers — the routing model picks both tier AND provider
// Priority: Gemini Flash (cheapest) → OpenRouter free → Haiku → GPT-4o-mini
const MODEL_TIERS: Record<string, Record<string, { model: string; baseUrl: string }>> = {
  // Latest models as of March 2026
  // Gemini model IDs verified against generativelanguage.googleapis.com/v1beta/models
  free: {
    gemini:     { model: 'gemini-3.1-flash-lite-preview',          baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    openai:     { model: 'gpt-5.4-nano',                           baseUrl: 'https://api.openai.com/v1' },
    openrouter: { model: 'nvidia/nemotron-3-super-120b-a12b',      baseUrl: 'https://openrouter.ai/api/v1' },
    anthropic:  { model: 'claude-haiku-4-5-20251001',              baseUrl: 'https://api.anthropic.com/v1' },
  },
  mid: {
    gemini:     { model: 'gemini-3.1-flash-lite-preview',          baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    openai:     { model: 'gpt-5.4-mini',                           baseUrl: 'https://api.openai.com/v1' },
    anthropic:  { model: 'claude-sonnet-4-6',                      baseUrl: 'https://api.anthropic.com/v1' },
    openrouter: { model: 'qwen/qwen3-235b-a22b:free',             baseUrl: 'https://openrouter.ai/api/v1' },
  },
  full: {
    anthropic:  { model: 'claude-opus-4-6',                        baseUrl: 'https://api.anthropic.com/v1' },
    openai:     { model: 'gpt-5.4',                                baseUrl: 'https://api.openai.com/v1' },
    gemini:     { model: 'gemini-3.1-pro-preview',                 baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    openrouter: { model: 'deepseek/deepseek-r1:free',             baseUrl: 'https://openrouter.ai/api/v1' },
  },
};

// Pick the best available provider for a tier
function pickModel(tier: string, keys: ProviderKeys): { provider: string; model: string; baseUrl: string; apiKey: string } | null {
  const tierModels = MODEL_TIERS[tier];
  if (!tierModels) return null;

  // Try each provider in priority order for this tier
  for (const [provider, config] of Object.entries(tierModels)) {
    const key = keys[provider as keyof ProviderKeys];
    if (key) {
      return { provider, model: config.model, baseUrl: config.baseUrl, apiKey: key };
    }
  }
  return null;
}

// Intent schema for LLM classification
const INTENT_SCHEMA = {
  desktop_control: 'User wants to click, type, scroll, or interact with the desktop',
  screenshot: 'User wants to see what is on screen',
  video: 'User wants to record video or capture action sequence',
  app_control: 'User wants to launch, switch, or control an application',
  code: 'User wants to read, write, search, or modify code',
  browser: 'User wants to navigate, search, or interact with a browser',
  command: 'User wants to run a shell command',
  question: 'User is asking a question that can be answered from context',
  complex: 'Multi-step task requiring planning and multiple tool calls',
};

// All available tools for the agent
const ALL_TOOLS = {
  ...desktopTools,
  ...videoTools,
  ...processTools,
  ...codebaseTools,
};

// Tool schema for LLM consumption
function getToolSchemas() {
  return Object.entries(ALL_TOOLS).map(([name, tool]) => ({
    type: 'function' as const,
    function: {
      name,
      description: tool.description,
      parameters: { type: 'object', properties: {} }, // Simplified — real impl would have full schemas
    },
  }));
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  images?: string[]; // base64 images for multimodal
}

interface AgentResponse {
  text: string;
  images?: string[];
  videoPath?: string;
  toolsUsed: string[];
  turnCount: number;
  intent: string;
  model?: string;
}

export class NemoClawAgent {
  private config: ModelConfig;
  private keys: ProviderKeys;
  private conversationHistory: Message[] = [];
  private maxTurns = 50;
  private workspacePath: string;

  constructor(options: {
    workspacePath?: string;
    maxTurns?: number;
  } = {}) {
    // Auto-detect ALL available providers
    this.keys = detectProviderKeys();
    const available = Object.entries(this.keys).filter(([_, v]) => v).map(([k]) => k);

    if (available.length === 0) {
      console.warn('[nemoclaw] WARNING: No API keys found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY');
    } else {
      console.log(`[nemoclaw] Available providers: ${available.join(', ')}`);
    }

    // Pick cheapest available for routing (Gemini Flash > Haiku > GPT-4.1-mini)
    const router = pickModel('free', this.keys);
    this.config = {
      provider: (router?.provider || 'anthropic') as any,
      routingModel: router?.model || 'claude-haiku-4-5-20251001',
      apiKey: router?.apiKey || '',
      baseUrl: router?.baseUrl || 'https://api.anthropic.com/v1',
    };

    console.log(`[nemoclaw] Router: ${this.config.routingModel} (${this.config.provider})`);

    this.workspacePath = options.workspacePath || process.cwd();
    if (options.maxTurns) this.maxTurns = options.maxTurns;

    // System prompt with workspace context
    this.conversationHistory.push({
      role: 'system',
      content: this.buildSystemPrompt(),
    });
  }

  private buildSystemPrompt(): string {
    return `You are NemoClaw, a local autonomous agent that controls the user's laptop.
You can see the screen (via screenshots), click, type, scroll, launch apps, run commands,
read/write code, record video, and more.

WORKSPACE: ${this.workspacePath}
PLATFORM: Windows 11
CAPABILITIES:
- Desktop: screenshot, click, type, hotkey, scroll, drag, find image on screen
- Video: record screen, capture action spans (before/during/after), extract key frames
- Apps: launch/switch Chrome, VSCode, Claude Code, Terminal, any Windows app
- Code: read files, search code, list project structure, run commands
- Process: list/kill processes, clipboard, focus windows

RULES:
1. Take ONE screenshot when you need to see the screen. Do NOT take multiple screenshots in a row.
2. For click actions: screenshot → identify target → click. That's 1 screenshot, not more.
3. After completing an action, respond with your findings. Do NOT keep calling tools in a loop.
4. For code tasks, read the relevant files before making changes.
5. Be proactive — don't wait for step-by-step instructions.
6. If a task fails, try ONE alternative approach. If that fails too, report the issue.
7. NEVER call the same tool more than 3 times in one response. If you've called screenshot 3 times, STOP and respond.

SELF-DIRECTION:
- Never ask "should I continue?" — just respond with results.
- Produce multiple approaches with tradeoffs when appropriate.
- Judge your own output quality.
- The user should NOT have to feed you frameworks — find methods yourself.`;
  }

  /**
   * Classify user intent AND pick the optimal model tier.
   * The routing model (Haiku / free Nemotron) decides both in one call.
   */
  async classifyIntent(message: string): Promise<{ intent: string; tier: 'free' | 'mid' | 'full' }> {
    const intentStr = Object.entries(INTENT_SCHEMA)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');

    try {
      const response = await this.callModel(this.config.routingModel, [
        {
          role: 'system',
          content: `You are a router. Given a user message, output TWO things on separate lines:
1. Intent: one of these keys:
${intentStr}
2. Tier: which model tier this task needs:
- free: simple actions (screenshot, click, open app, read file, quick questions)
- mid: moderate tasks (multi-step interactions, code search, summarization)
- full: complex tasks (deep research, multi-file analysis, planning, creative writing, debugging)

Respond with EXACTLY two lines:
intent_key
tier_key`
        },
        { role: 'user', content: message },
      ], 50);

      const lines = response.trim().toLowerCase().split('\n').map(l => l.trim().replace(/[^a-z_]/g, ''));
      const intent = INTENT_SCHEMA.hasOwnProperty(lines[0]) ? lines[0] : 'complex';
      const tier = (['free', 'mid', 'full'].includes(lines[1]) ? lines[1] : 'mid') as 'free' | 'mid' | 'full';

      console.log(`[nemoclaw] Route: intent=${intent}, tier=${tier} (${MODEL_TIERS[tier].label})`);
      return { intent, tier };
    } catch (e) {
      console.error('[nemoclaw] Classification failed:', e);
      return { intent: 'complex', tier: 'mid' }; // Safe default
    }
  }

  /**
   * Main execution loop
   */
  async run(userMessage: string, images?: string[]): Promise<AgentResponse> {
    // Classify intent AND let the router pick the model tier
    const { intent, tier } = await this.classifyIntent(userMessage);

    // Add user message to history
    const userMsg: Message = { role: 'user', content: userMessage };
    if (images?.length) userMsg.images = images;
    this.conversationHistory.push(userMsg);

    // Select best available model from the tier the router chose
    const picked = pickModel(tier, this.keys);
    if (!picked) {
      return { text: 'No API keys available for any provider. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY.', images: undefined, videoPath: undefined, toolsUsed: [], turnCount: 0, intent, model: 'none' };
    }
    const model = picked.model;
    // Temporarily switch config to the picked provider for this run
    const savedConfig = { ...this.config };
    this.config.provider = picked.provider as any;
    this.config.apiKey = picked.apiKey;
    this.config.baseUrl = picked.baseUrl;
    console.log(`[nemoclaw] Executing with ${picked.provider}/${picked.model} (tier: ${tier})`);

    // Tool-calling loop
    let turn = 0;
    const toolsUsed: string[] = [];
    const collectedImages: string[] = [];
    let videoPath: string | undefined;
    const toolCallCounts = new Map<string, number>(); // Circuit breaker: track per-tool call count

    while (turn < this.maxTurns) {
      const response = await this.callModelWithTools(model, this.conversationHistory);

      // Circuit breaker: if any single tool called 3+ times, HARD STOP the loop
      const maxToolCalls = Math.max(...[0, ...Array.from(toolCallCounts.values())]);
      if (maxToolCalls >= 3) {
        console.log(`[nemoclaw] Circuit breaker: tool called ${maxToolCalls}x, forcing synthesis`);
        return {
          text: response.text || `Completed. Used tools: ${[...new Set(toolsUsed)].join(', ')}`,
          images: collectedImages.length > 0 ? collectedImages.slice(0, 3) : undefined, // Max 3 images
          videoPath,
          toolsUsed: [...new Set(toolsUsed)],
          turnCount: turn,
          intent,
          model: `${picked.provider}/${picked.model}`,
        };
      }

      if (response.toolCalls?.length) {
        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          const tool = ALL_TOOLS[toolName as keyof typeof ALL_TOOLS];

          if (!tool) {
            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: Unknown tool "${toolName}". Available tools: ${Object.keys(ALL_TOOLS).join(', ')}`,
            });
            continue;
          }

          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await (tool.fn as any)(...Object.values(args));
            toolsUsed.push(toolName);
            toolCallCounts.set(toolName, (toolCallCounts.get(toolName) || 0) + 1);

            // Collect images from results (keep separate from conversation)
            if (result?.base64) collectedImages.push(result.base64);
            if (result?.screenshot?.base64) collectedImages.push(result.screenshot.base64);
            if (result?.videoPath) videoPath = result.videoPath;
            if (result?.frames) {
              for (const f of result.frames) {
                if (f.base64) collectedImages.push(f.base64);
              }
            }

            // Strip base64 from result before putting in conversation history
            // (base64 images are 1MB+ and would blow up LLM context)
            const sanitizedResult = JSON.parse(JSON.stringify(result, (key, value) => {
              if (key === 'base64' && typeof value === 'string' && value.length > 500) {
                return `[image: ${Math.round(value.length * 3 / 4 / 1024)}KB]`;
              }
              return value;
            }));

            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(sanitizedResult, null, 2).slice(0, 5000),
            });
          } catch (e: any) {
            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error executing ${toolName}: ${e.message}`,
            });
          }
        }

        // Add assistant's tool call message to history
        this.conversationHistory.push({
          role: 'assistant',
          content: response.text || '',
          tool_calls: response.toolCalls,
        });

        turn++;

        // Synthesis nudge near turn limit
        const nudgeAt = Math.max(Math.floor(this.maxTurns * 0.05), 5);
        if (turn === this.maxTurns - nudgeAt) {
          this.conversationHistory.push({
            role: 'system',
            content: 'You are running low on turns. Begin synthesizing your findings into a final response.',
          });
        }
      } else {
        // No more tool calls — final response
        return {
          text: response.text,
          images: collectedImages.length > 0 ? collectedImages : undefined,
          videoPath,
          toolsUsed,
          model: `${MODEL_TIERS[tier].label} (${model})`,
          turnCount: turn,
          intent,
        };
      }
    }

    // Forced synthesis on turn limit
    return {
      text: 'Reached turn limit. Here is what was accomplished: ' +
        toolsUsed.map(t => `- ${t}`).join('\n'),
      images: collectedImages.length > 0 ? collectedImages : undefined,
      videoPath,
      toolsUsed,
      turnCount: turn,
      intent,
    };
  }

  /**
   * Call LLM API — routes to correct provider automatically
   */
  private async callModel(model: string, messages: Message[], maxTokens: number = 4096): Promise<string> {
    const provider = this.config.provider;
    if (provider === 'anthropic') return this.callAnthropic(model, messages, maxTokens);
    if (provider === 'gemini') return this.callGemini(model, messages, maxTokens);
    // openai and openrouter share the same OpenAI-compatible API format
    return this.callOpenAICompatible(model, messages, maxTokens);
  }

  private async callModelWithTools(model: string, messages: Message[]): Promise<{
    text: string;
    toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    const toolSchemas = getToolSchemas();
    const provider = this.config.provider;
    if (provider === 'anthropic') return this.callAnthropicWithTools(model, messages, toolSchemas);
    if (provider === 'gemini') return this.callGeminiWithTools(model, messages, toolSchemas);
    return this.callOpenAICompatibleWithTools(model, messages, toolSchemas);
  }

  // ── Anthropic ──────────────────────────────────────────────────

  private async callAnthropic(model: string, messages: Message[], maxTokens: number): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, system: systemMsg?.content,
        messages: nonSystemMsgs.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
      }),
    });
    const data = await response.json() as any;
    if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
    return data.content?.[0]?.text || '';
  }

  private async callAnthropicWithTools(model: string, messages: Message[], tools: ReturnType<typeof getToolSchemas>): Promise<{ text: string; toolCalls?: any[] }> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 4096, system: systemMsg?.content,
        tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
        messages: nonSystemMsgs.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
      }),
    });
    const data = await response.json() as any;
    if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
    const textBlocks = data.content?.filter((b: any) => b.type === 'text') || [];
    const toolBlocks = data.content?.filter((b: any) => b.type === 'tool_use') || [];
    return {
      text: textBlocks.map((b: any) => b.text).join('\n'),
      toolCalls: toolBlocks.length > 0 ? toolBlocks.map((b: any) => ({ id: b.id, function: { name: b.name, arguments: JSON.stringify(b.input) } })) : undefined,
    };
  }

  // ── OpenAI-compatible (OpenAI, OpenRouter) ─────────────────────

  private async callOpenAICompatible(model: string, messages: Message[], maxTokens: number): Promise<string> {
    const baseUrl = this.config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: messages.map(m => ({ role: m.role, content: m.content })) }),
    });
    const data = await response.json() as any;
    if (data.error) throw new Error(`${this.config.provider}: ${data.error.message}`);
    return data.choices?.[0]?.message?.content || '';
  }

  private async callOpenAICompatibleWithTools(model: string, messages: Message[], tools: ReturnType<typeof getToolSchemas>): Promise<{ text: string; toolCalls?: any[] }> {
    const baseUrl = this.config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model, messages: messages.map(m => ({ role: m.role, content: m.content })), tools }),
    });
    const data = await response.json() as any;
    if (data.error) throw new Error(`${this.config.provider}: ${data.error.message}`);
    const choice = data.choices?.[0];
    return { text: choice?.message?.content || '', toolCalls: choice?.message?.tool_calls };
  }

  // ── Gemini ─────────────────────────────────────────────────────

  private async callGemini(model: string, messages: Message[], maxTokens: number): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const contents = nonSystemMsgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      }
    );
    const data = await response.json() as any;
    if (data.error) throw new Error(`Gemini: ${data.error.message}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  private async callGeminiWithTools(model: string, messages: Message[], tools: ReturnType<typeof getToolSchemas>): Promise<{ text: string; toolCalls?: any[] }> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const contents = nonSystemMsgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const geminiTools = [{ functionDeclarations: tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
          tools: geminiTools,
        }),
      }
    );
    const data = await response.json() as any;
    if (data.error) throw new Error(`Gemini: ${data.error.message}`);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts = parts.filter((p: any) => p.text);
    const fnParts = parts.filter((p: any) => p.functionCall);
    return {
      text: textParts.map((p: any) => p.text).join('\n'),
      toolCalls: fnParts.length > 0
        ? fnParts.map((p: any, i: number) => ({ id: `gemini_${i}`, function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) } }))
        : undefined,
    };
  }

  /**
   * Reset conversation (keep system prompt)
   */
  reset(): void {
    this.conversationHistory = [this.conversationHistory[0]];
  }

  /**
   * Get conversation summary for persistence
   */
  getSummary(): { messageCount: number; toolsUsed: string[] } {
    const toolMsgs = this.conversationHistory.filter(m => m.role === 'tool');
    return {
      messageCount: this.conversationHistory.length,
      toolsUsed: [...new Set(toolMsgs.map(m => m.tool_call_id || ''))],
    };
  }
}
