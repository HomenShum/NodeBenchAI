/**
 * Ship Demo Day - Persona-Based End-to-End Test Suite
 *
 * Tests NodeBench from the perspective of 6 professional roles
 * at the AI Agents in Prod - Ship Demo Day event (April 23, 2026).
 *
 * Event Context:
 * - Companies: Vercel, ElevenLabs, WunderGraph, Comet/Opik, InsForge, Bland AI, Google DeepMind
 * - Audience: Builders, early founders, AI agent engineers
 * - Activities: Workshops, live demos, networking
 *
 * Personas:
 * 1. Senior Staff QA Engineer - Reliability, edge cases, verification
 * 2. AI Agent Engineer - Tool calling, multi-turn, MCP integration
 * 3. Product Engineer - API design, documentation, integration patterns
 * 4. Investor - Company intelligence, funding data, market positioning
 * 5. CEO/CTO - Strategic synthesis, competitive analysis, decisions
 * 6. Marketing/Sales - Narrative generation, positioning, pitch quality
 */

import { test, expect, type Page, TestInfo } from '@playwright/test';
import { join } from 'path';
import { mkdirSync } from 'fs';

const OUT_DIR = join(process.cwd(), 'tests', 'fixtures', 'screenshots', 'persona-ship-demo-day');

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA - Event Context
// ═══════════════════════════════════════════════════════════════════════════

const EVENT_COMPANIES = {
  vercel: {
    name: 'Vercel',
    description: 'Frontend cloud platform, Next.js maintainers',
    speakers: ['Guillermo Rauch'],
    workshop: 'Next.js + AI SDK',
  },
  elevenlabs: {
    name: 'ElevenLabs',
    description: 'Voice AI platform for synthetic speech',
    speakers: ['Mati Staniszewski'],
    useCase: 'Voice agents, narration, dubbing',
  },
  wundergraph: {
    name: 'WunderGraph',
    description: 'API composition and developer platform',
    speakers: ['Ahmet Soormally'],
    workshop: 'API-first development',
  },
  comet: {
    name: 'Comet / Opik',
    description: 'LLM observability and evaluation platform',
    speakers: ['Vincent Koc'],
    focus: 'Agent monitoring, tracing, evaluation',
  },
  insforge: {
    name: 'InsForge',
    description: 'Insurance infrastructure platform',
    speakers: ['Hang H.'],
    role: 'Co-Founder & CEO',
  },
  bland: {
    name: 'Bland AI',
    description: 'Conversational AI for phone calls',
    speakers: ['Maggie Jones'],
    role: 'Senior FDE',
  },
  deepmind: {
    name: 'Google DeepMind',
    description: 'AI research and applied AI',
    featured: true,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

interface PersonaScenario {
  id: string;
  role: string;
  goal: string;
  queries: Array<{
    text: string;
    expectedContains?: string[];
    lens?: string;
  }>;
  expectations: {
    toolCalls?: string[];
    minResponseLength?: number;
    maxTimeSeconds?: number;
  };
}

const PERSONA_SCENARIOS: PersonaScenario[] = [
  {
    id: 'qa-engineer',
    role: 'Senior Staff QA Engineer',
    goal: 'Verify agent reliability and edge case handling',
    queries: [
      {
        text: 'Test the Vercel AI SDK adapter in NodeBench - what edge cases should I watch for?',
        expectedContains: ['Vercel', 'adapter', 'edge'],
        lens: 'founder',
      },
      {
        text: 'How does the multi-turn conversation handler deal with context window limits?',
        expectedContains: ['context', 'window', 'limit'],
        lens: 'founder',
      },
      {
        text: 'Verify funding data accuracy for InsForge - what sources back the claims?',
        expectedContains: ['source', 'funding', 'InsForge'],
        lens: 'investor',
      },
    ],
    expectations: {
      toolCalls: ['search', 'verify'],
      minResponseLength: 100,
      maxTimeSeconds: 30,
    },
  },
  {
    id: 'ai-agent-engineer',
    role: 'AI Agent Engineer',
    goal: 'Evaluate tool calling, streaming, and MCP integration',
    queries: [
      {
        text: 'How does ElevenLabs voice integration work in NodeBench? Show me the implementation pattern.',
        expectedContains: ['ElevenLabs', 'voice', 'integration'],
        lens: 'founder',
      },
      {
        text: 'What MCP tools are available for WunderGraph API composition?',
        expectedContains: ['MCP', 'WunderGraph', 'API'],
        lens: 'founder',
      },
      {
        text: 'What is the latency budget for streaming responses in the Fast Agent Panel?',
        expectedContains: ['latency', 'streaming', 'budget'],
        lens: 'founder',
      },
    ],
    expectations: {
      toolCalls: ['search', 'describe'],
      minResponseLength: 150,
      maxTimeSeconds: 25,
    },
  },
  {
    id: 'product-engineer',
    role: 'Product Engineer',
    goal: 'Understand API design and integration patterns',
    queries: [
      {
        text: 'What APIs does NodeBench expose for external integrations? Show me the OpenAPI spec or endpoints.',
        expectedContains: ['API', 'endpoint', 'integration'],
        lens: 'founder',
      },
      {
        text: 'How would I integrate Comet/Opik observability into my custom agent?',
        expectedContains: ['Comet', 'Opik', 'observability'],
        lens: 'founder',
      },
      {
        text: 'Document the research pipeline architecture - what are the main components?',
        expectedContains: ['research', 'pipeline', 'component'],
        lens: 'founder',
      },
    ],
    expectations: {
      toolCalls: ['search', 'describe'],
      minResponseLength: 200,
      maxTimeSeconds: 30,
    },
  },
  {
    id: 'investor',
    role: 'Investor',
    goal: 'Evaluate company intelligence and market positioning',
    queries: [
      {
        text: 'Who are the key players in AI agent infrastructure? Compare Vercel, ElevenLabs, and WunderGraph.',
        expectedContains: ['Vercel', 'ElevenLabs', 'WunderGraph'],
        lens: 'investor',
      },
      {
        text: 'Compare funding stages: InsForge vs Bland AI - who has raised more and at what stage?',
        expectedContains: ['funding', 'InsForge', 'Bland AI'],
        lens: 'investor',
      },
      {
        text: 'Market landscape for voice AI companies - how does ElevenLabs position vs competitors?',
        expectedContains: ['ElevenLabs', 'voice', 'market'],
        lens: 'investor',
      },
    ],
    expectations: {
      toolCalls: ['search', 'compare'],
      minResponseLength: 250,
      maxTimeSeconds: 35,
    },
  },
  {
    id: 'ceo-cto',
    role: 'CEO/CTO',
    goal: 'Strategic synthesis and competitive analysis',
    queries: [
      {
        text: 'Strategic positioning: Where does NodeBench fit in the AI agent stack vs competitors like Vercel and WunderGraph?',
        expectedContains: ['positioning', 'stack', 'competitor'],
        lens: 'founder',
      },
      {
        text: 'Risk assessment for AI agent market timing - is now the right time to build?',
        expectedContains: ['risk', 'market', 'timing'],
        lens: 'founder',
      },
      {
        text: 'Competitive analysis: How does Ship Demo Day lineup position the AI agent ecosystem?',
        expectedContains: ['competitive', 'ecosystem', 'analysis'],
        lens: 'founder',
      },
    ],
    expectations: {
      toolCalls: ['search', 'analyze'],
      minResponseLength: 300,
      maxTimeSeconds: 40,
    },
  },
  {
    id: 'marketing-sales',
    role: 'Marketing/Sales',
    goal: 'Narrative generation and positioning',
    queries: [
      {
        text: 'Generate a positioning narrative for AI agent founders attending Ship Demo Day.',
        expectedContains: ['narrative', 'founder', 'agent'],
        lens: 'founder',
      },
      {
        text: 'Create talking points for pitching NodeBench to Vercel developers.',
        expectedContains: ['Vercel', 'developer', 'pitch'],
        lens: 'founder',
      },
      {
        text: 'Draft a LinkedIn post about learnings from Ship Demo Day workshops.',
        expectedContains: ['Ship Demo Day', 'workshop', 'learning'],
        lens: 'founder',
      },
    ],
    expectations: {
      toolCalls: ['search', 'generate'],
      minResponseLength: 200,
      maxTimeSeconds: 30,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// VIEWPORT CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════════

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'mobile-iphone14', width: 390, height: 844 },
  { name: 'mobile-ipad', width: 768, height: 1024 },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function signInIfNeeded(page: Page) {
  const anonymousButton = page.getByRole('button', { name: /sign in anonymously/i }).first();
  if (await anonymousButton.count()) {
    await anonymousButton.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#main-content', { state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1000);
    return;
  }

  const cta = page.getByTestId('dogfood-sign-in');
  if (!(await cta.isVisible({ timeout: 3000 }).catch(() => false))) {
    return;
  }

  await cta.click();
  await page.waitForTimeout(500);

  const modalAnonymousButton = page.getByRole('button', { name: /sign in anonymously/i }).first();
  if (await modalAnonymousButton.count()) {
    await modalAnonymousButton.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#main-content', { state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1000);
  }
}

async function submitQuery(page: Page, query: string, lens?: string) {
  // Navigate to chat
  await page.goto('/?surface=chat', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(800);

  // Find input and submit
  const input = page.locator('[data-testid="chat-input"], textarea[placeholder*="Ask"], textarea').first();
  await input.fill(query);
  await page.waitForTimeout(300);

  const submitButton = page.locator('button[type="submit"], button[aria-label*="send"]').first();
  await submitButton.click();

  // Wait for streaming to start
  await page.waitForTimeout(500);
}

async function captureScreenshot(page: Page, name: string, testInfo: TestInfo) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

function assertResponseQuality(response: string, expectations: PersonaScenario['expectations']) {
  const checks: { passed: boolean; label: string; detail: string }[] = [];

  // Length check
  if (expectations.minResponseLength) {
    const passed = response.length >= expectations.minResponseLength;
    checks.push({
      passed,
      label: 'Minimum Length',
      detail: `${response.length} chars (min: ${expectations.minResponseLength})`,
    });
  }

  // Content checks - ensure it's not empty/generic
  const hasContent = response.length > 50 && !response.includes('I apologize');
  checks.push({
    passed: hasContent,
    label: 'Has Meaningful Content',
    detail: hasContent ? 'Response contains substance' : 'Response appears empty or apologetic',
  });

  return checks;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

test.describe.configure({ mode: 'parallel' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nodebench-onboarded', '1');
    localStorage.setItem('nodebench-theme', JSON.stringify({ mode: 'dark' }));
  });
});

// Run each persona scenario on desktop and mobile
for (const viewport of VIEWPORTS) {
  for (const scenario of PERSONA_SCENARIOS) {
    test.describe(`Persona: ${scenario.role} @ ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`${scenario.id}: ${scenario.goal}`, async ({ page }, testInfo) => {
        // Sign in
        await signInIfNeeded(page);
        await captureScreenshot(page, `${scenario.id}-signed-in`, testInfo);

        const results: Array<{
          query: string;
          responseLength: number;
          checks: ReturnType<typeof assertResponseQuality>;
          duration: number;
        }> = [];

        // Run each query for this persona
        for (const query of scenario.queries) {
          const startTime = Date.now();

          await submitQuery(page, query.text, query.lens);

          // Wait for response
          const maxWait = (scenario.expectations.maxTimeSeconds || 30) * 1000;
          await page.waitForTimeout(2000); // Initial streaming

          // Wait for streaming to complete or timeout
          let streamingComplete = false;
          const checkInterval = 500;
          let waited = 2000;

          while (!streamingComplete && waited < maxWait) {
            await page.waitForTimeout(checkInterval);
            waited += checkInterval;

            // Check if streaming indicator is gone
            const streamingIndicator = await page.locator('[data-testid="streaming-indicator"], .streaming, [class*="animate-pulse"]').count();
            if (streamingIndicator === 0) {
              streamingComplete = true;
            }
          }

          // Extract response text
          const responseLocator = page.locator('[data-testid="message-content"], .message-content, [class*="prose"]').last();
          const responseText = await responseLocator.textContent({ timeout: 5000 }).catch(() => 'No response captured');

          const duration = Date.now() - startTime;

          // Quality assertions
          const checks = assertResponseQuality(responseText || '', scenario.expectations);

          results.push({
            query: query.text.slice(0, 60) + '...',
            responseLength: (responseText || '').length,
            checks,
            duration,
          });

          // Capture per-query screenshot
          await captureScreenshot(page, `${scenario.id}-query-${results.length}`, testInfo);

          // Log results
          console.log(`\n[${scenario.role}] Query ${results.length}:`);
          console.log(`  Duration: ${duration}ms`);
          console.log(`  Length: ${(responseText || '').length} chars`);
          console.log(`  Checks: ${checks.filter(c => c.passed).length}/${checks.length} passed`);
        }

        // Final assertions
        const allPassed = results.every(r => r.checks.every(c => c.passed));
        const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

        console.log(`\n=== ${scenario.role} Summary ===`);
        console.log(`Viewport: ${viewport.name}`);
        console.log(`Queries: ${results.length}`);
        console.log(`Avg Duration: ${avgDuration.toFixed(0)}ms`);
        console.log(`All Passed: ${allPassed}`);

        // Attach results to test report
        await testInfo.attach('persona-results', {
          body: JSON.stringify({
            persona: scenario.role,
            viewport: viewport.name,
            results,
            summary: {
              allPassed,
              avgDuration,
              totalQueries: results.length,
            },
          }, null, 2),
          contentType: 'application/json',
        });

        // Soft assertions - don't fail on first issue
        expect(allPassed, 'Some quality checks failed').toBe(true);
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-PERSONA COMPARISON TEST
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Cross-Persona: Same Query, Different Lenses', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Compare responses: 
