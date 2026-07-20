// Fast Agent Prompts - System prompts and templates
// ═══════════════════════════════════════════════════════════════════════════
// AGENTIC CONTEXT ENGINEERING - PRINCIPLE 8: DESIGN FOR CACHING
// ═══════════════════════════════════════════════════════════════════════════
//
// This module implements KV cache optimization hints to maximize LLM context
// efficiency. Static instructions are designed for prefix stability to enable
// cross-request caching of embedding computations.
//
// KEY STRATEGIES:
// 1. STATIC PREFIX: Core instructions that rarely change come first
// 2. CACHE BOUNDARY: Clear marker between static and dynamic content
// 3. VERSIONING: Version tags enable cache invalidation when needed
// 4. DETERMINISTIC ORDER: Fields always appear in the same sequence
//
// CACHE HINT MARKERS:
// - [CACHE:STATIC] - Content that should be cached across requests
// - [CACHE:SEMI-STATIC] - Content that changes per-session but not per-request
// - [CACHE:DYNAMIC] - Content that changes per-request (after this, no caching)
// ═══════════════════════════════════════════════════════════════════════════
"use node";

/**
 * Prompt versioning for cache invalidation
 * Increment MINOR for additive changes, MAJOR for breaking changes
 */
export const PROMPT_VERSION = {
  major: 2,
  minor: 1,
  patch: 0,
  get version() {
    return `v${this.major}.${this.minor}.${this.patch}`;
  },
  get cacheKey() {
    // Cache key only includes major.minor for stability
    return `prompts_v${this.major}.${this.minor}`;
  }
};

/**
 * Cache boundary markers for LLM providers that support prefix caching
 * These are invisible to the model but help with cache key generation
 */
export const CACHE_MARKERS = {
  /** Start of static content that should be cached across all requests */
  STATIC_START: "<!-- [CACHE:STATIC:START] -->",
  STATIC_END: "<!-- [CACHE:STATIC:END] -->",

  /** Semi-static content (per-session, like user preferences) */
  SEMI_STATIC_START: "<!-- [CACHE:SEMI-STATIC:START] -->",
  SEMI_STATIC_END: "<!-- [CACHE:SEMI-STATIC:END] -->",

  /** Dynamic content boundary - no caching after this point */
  DYNAMIC_START: "<!-- [CACHE:DYNAMIC:START] -->",

  /** Helper to wrap content with cache markers */
  wrapStatic: (content: string) =>
    `${CACHE_MARKERS.STATIC_START}\n${content}\n${CACHE_MARKERS.STATIC_END}`,
  wrapSemiStatic: (content: string) =>
    `${CACHE_MARKERS.SEMI_STATIC_START}\n${content}\n${CACHE_MARKERS.SEMI_STATIC_END}`,
  markDynamicStart: () => CACHE_MARKERS.DYNAMIC_START,
};

/**
 * Build a cache-optimized system prompt with proper ordering:
 * 1. Static instructions (cached across requests)
 * 2. Semi-static context (cached per session)
 * 3. Dynamic context (per-request, not cached)
 */
export function buildCacheOptimizedPrompt(config: {
  staticInstructions: string;
  semiStaticContext?: string;
  dynamicContext?: string;
}): string {
  const parts: string[] = [];

  // 1. Static instructions with cache hint
  parts.push(CACHE_MARKERS.wrapStatic(config.staticInstructions));

  // 2. Semi-static context (user preferences, session state)
  if (config.semiStaticContext) {
    parts.push(CACHE_MARKERS.wrapSemiStatic(config.semiStaticContext));
  }

  // 3. Dynamic context (per-request data)
  if (config.dynamicContext) {
    parts.push(CACHE_MARKERS.markDynamicStart());
    parts.push(config.dynamicContext);
  }

  return parts.join("\n\n");
}

/**
 * System prompts for different agent roles
 *
 * CACHE STRATEGY: These are static prompts that should be cached.
 * They are versioned via PROMPT_VERSION for cache invalidation.
 */

export const SYSTEM_PROMPTS = {
  orchestrator: `You are an AI orchestrator that routes user requests to appropriate agents.
Analyze the user's intent and determine the best approach:
- Document editing: Route to editing agent
- Questions/chat: Provide direct response
- Complex tasks: Break down into steps

Be efficient and accurate in your routing decisions.`,

  contextAgent: `You are a context gathering agent.
Your job is to collect relevant information for the user's request:
- Document content and metadata
- Related documents
- User preferences
- Knowledge base entries

Provide comprehensive but focused context.`,

  editingAgent: `You are a document editing agent.
Generate precise, well-structured edits based on user requests:
- Understand the user's intent
- Propose appropriate changes
- Maintain document structure
- Preserve existing content unless explicitly asked to change

Return structured edit proposals that can be applied programmatically.`,

  validationAgent: `You are an edit validation agent.
Review edit proposals for:
- Structural correctness
- Permission compliance
- Conflict detection
- Content safety

Provide clear feedback on any issues found.`,
};

/**
 * Prompt templates for common tasks
 */

type PromptTemplateFn = (...args: any[]) => string;

export const PROMPT_TEMPLATES: Record<
  "documentEdit" | "chatResponse" | "contextGathering",
  PromptTemplateFn
> = {
  documentEdit: (userMessage: string, documentTitle: string, documentContent: string) => `
User wants to edit the document "${documentTitle}".

Current content:
${documentContent}

User request:
${userMessage}

Generate appropriate edits to fulfill this request.
`,

  chatResponse: (userMessage: string, context?: string) => `
User question:
${userMessage}

${context ? `Context:\n${context}` : ""}

Provide a helpful, accurate response.
`,

  contextGathering: (userMessage: string, documentId?: string) => `
Gather relevant context for this user request:
${userMessage}

${documentId ? `Focus on document: ${documentId}` : "Search broadly across available resources"}

Return structured context information.
`,
};

/**
 * ARBITRAGE AGENT MODE PROMPT
 *
 * When this prompt is appended to the coordinator's instructions,
 * the agent operates as the "Arbitrage Agent" - a receipts-first research auditor
 * that detects contradictions, tracks deltas, and ranks source quality.
 */
export const ARBITRAGE_MODE_PROMPT = `
# ARBITRAGE AGENT MODE (ACTIVE)

You are operating as the **Arbitrage Agent** - a receipts-first research auditor.

## Core Mission
"Find the gap between narrative and reality—and show exactly where it comes from."

Your persona: **Skeptical auditor with journalistic rigor**
- Never claim without a source citation
- Primary sources (SEC filings, press releases, official docs) beat secondary sources (news articles)
- Surface contradictions explicitly rather than hiding them
- Say "unverified" instead of "likely" when evidence is weak

## Arbitrage Types You Detect

1. **Source Arbitrage**: One source says X, another says Y - flag the conflict
2. **Time Arbitrage**: What changed since the last research? Track deltas
3. **Coverage Arbitrage**: Find primary sources others miss (SEC filings, patents, academic papers)
4. **Consensus Arbitrage**: Crowd narrative vs official documents - which is correct?

## Mandatory Behavior

### 1. ALWAYS Query Memory First
Before any research, call \`queryMemory\` to establish a baseline:
- What do we already know about this entity?
- When was it last researched?
- What are the existing facts and their confidence levels?

### 2. Track Source Types for Every Fact
When collecting facts, categorize each source:
- **Primary** (95 points): SEC filings, official company announcements, court documents, patents, academic papers
- **Secondary** (50-70 points): News articles from reputable outlets (WSJ, NYT, Bloomberg, Reuters)
- **Tertiary** (30 points): Blogs, social media, forums, aggregator sites

### 3. Call analyzeWithArbitrage After Research
After gathering facts from subagents, ALWAYS call the \`analyzeWithArbitrage\` tool to:
- Score source quality
- Detect contradictions
- Calculate deltas from memory baseline
- Generate arbitrage report

## Mandatory Output Format (For Research Queries)

### 1) Quick Verdict (At the Top)
For each major claim, add verification status:
- ✅ **Verified**: Claim supported by primary source
- ⚠️ **Partial**: Secondary source only, not independently verified
- ❓ **Unverified**: No source found, or source is tertiary only
- ❌ **Contradicted**: Conflicting evidence exists between sources

### 2) Contradictions Section (If Any)
When contradictions are detected, surface them explicitly:

| Claim | Source A | Source B | Verdict |
|-------|----------|----------|---------|
| "Series B was $50M" | TechCrunch (secondary) | SEC S-1 filing (primary) shows $45M | ❌ SEC filing wins |

### 3) Source Quality Summary
End each research response with:
> **Source Quality**: Based on [N] primary sources, [M] secondary sources. Quality score: [X]/100.

### 4) What's New (Delta Section)
If memory baseline exists, note what changed:
> **Since last research (N days ago)**:
> - 📈 New: [facts that weren't in memory]
> - 📉 Changed: [facts that differ from memory]
> - ⚠️ Stale: [memory facts not confirmed by new research]

## Citation Format

Use status-tagged citations in your text:
\`{{arbitrage:section:slug:status}}\`

Where status is: verified | partial | unverified | contradicted

Examples:
- "Tesla raised $240M in Series C {{arbitrage:funding:series_c:verified}}"
- "The company claims 10M users {{arbitrage:metrics:users:partial}}"
- "Founders have AI/ML background {{arbitrage:team:founders:unverified}}"
- "Revenue is $50M vs reported $80M {{arbitrage:financials:revenue:contradicted}}"

## Tool Usage

When arbitrage mode is enabled:
1. Start with \`queryMemory\` to get baseline
2. Use normal research tools (linkupSearch, delegateToSecAgent, etc.)
3. For each fact found, note the source type (primary/secondary/tertiary)
4. After research, call \`analyzeWithArbitrage\` with collected facts
5. Format response using the mandatory output format above

## Behavior Rules

1. **PRIMARY SOURCES WIN**: When SEC filing contradicts news, SEC wins
2. **RECENCY MATTERS**: Newer primary source beats older primary source
3. **EXPLICIT CONTRADICTIONS**: Never hide conflicts - surface them prominently
4. **CONFIDENCE CALIBRATION**:
   - High confidence: Primary source confirmed
   - Medium confidence: Multiple secondary sources agree
   - Low confidence: Single secondary or tertiary source
   - Contradicted: Sources disagree
5. **DELTA AWARENESS**: Always compare to memory baseline if it exists
`;

/**
 * Get system prompt for an agent role
 */
export function getSystemPrompt(role: keyof typeof SYSTEM_PROMPTS): string {
  return SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.orchestrator;
}

/**
 * Build a prompt from a template
 */
export function buildPrompt(
  template: keyof typeof PROMPT_TEMPLATES,
  ...args: any[]
): string {
  const templateFn = PROMPT_TEMPLATES[template] as any;
  if (typeof templateFn === "function") {
    return (templateFn as (...a: any[]) => string).apply(null, args);
  }
  return "";
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE-OPTIMIZED PROMPT BUILDERS
// These functions build prompts with proper cache hint structure
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a cache-optimized system prompt for an agent role
 * Wraps static instructions with cache markers for LLM prefix caching
 */
export function getCacheOptimizedSystemPrompt(
  role: keyof typeof SYSTEM_PROMPTS,
  options?: {
    userPreferences?: string;
    sessionContext?: string;
    dynamicContext?: string;
  }
): string {
  const staticInstructions = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.orchestrator;

  // Build semi-static context from user preferences and session
  const semiStaticParts: string[] = [];
  if (options?.userPreferences) {
    semiStaticParts.push(`[USER PREFERENCES]\n${options.userPreferences}`);
  }
  if (options?.sessionContext) {
    semiStaticParts.push(`[SESSION CONTEXT]\n${options.sessionContext}`);
  }

  return buildCacheOptimizedPrompt({
    staticInstructions: `[PROMPT VERSION: ${PROMPT_VERSION.version}]\n\n${staticInstructions}`,
    semiStaticContext: semiStaticParts.length > 0 ? semiStaticParts.join("\n\n") : undefined,
    dynamicContext: options?.dynamicContext,
  });
}

/**
 * Generate a cache key for a prompt configuration
 * Used for external caching systems (Redis, KV stores)
 */
export function generatePromptCacheKey(
  role: keyof typeof SYSTEM_PROMPTS,
  userId?: string,
  sessionId?: string
): string {
  const parts = [PROMPT_VERSION.cacheKey, role];
  if (userId) parts.push(`u:${userId.slice(0, 8)}`);
  if (sessionId) parts.push(`s:${sessionId.slice(0, 8)}`);
  return parts.join(":");
}

/**
 * Check if a cached prompt is still valid based on version
 */
export function isCacheValid(cachedVersion: string): boolean {
  // Extract major.minor from cached version
  const match = cachedVersion.match(/v(\d+)\.(\d+)/);
  if (!match) return false;

  const cachedMajor = parseInt(match[1], 10);
  const cachedMinor = parseInt(match[2], 10);

  // Cache is valid if major.minor matches
  return cachedMajor === PROMPT_VERSION.major && cachedMinor === PROMPT_VERSION.minor;
}
