/**
 * Ship Demo Day - Persona-Based End-to-End Test Suite
 * Uses agent-browser for advanced browser automation
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

import { test, expect } from '@playwright/test';
import { AgentBrowser } from 'agent-browser';
import { join } from 'path';
import { mkdirSync } from 'fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
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

interface QueryScenario {
  text: string;
  expectedContains?: string[];
  lens?: string;
}

interface PersonaScenario {
  id: string;
  role: string;
  goal: string;
  queries: QueryScenario[];
  expectations: {
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
// AGENT BROWSER TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

test.describe.configure({ mode: 'serial' });

for (const viewport of VIEWPORTS) {
  for (const scenario of PERSONA_SCENARIOS) {
    test.describe(`AgentBrowser: ${scenario.role} @ ${viewport.name}`, () => {
      test(`${scenario.id}: ${scenario.goal}`, async ({}, testInfo) => {
        mkdirSync(OUT_DIR, { recursive: true });

        // Launch AgentBrowser with viewport
        const browser = await AgentBrowser.launch({
          headless: true,
          viewport: { width: viewport.width, height: viewport.height },
          slowMo: 200,
        });

        const results: Array<{
          query: string;
          responseLength: number;
          duration: number;
          passed: boolean;
          errors: string[];
        }> = [];

        try {
          // Navigate to app
          console.log(`\n🚀 [${scenario.role}] Starting test on ${viewport.name}`);
          await browser.goto(APP_URL);
          await browser.waitForTimeout(2000);

          // Screenshot initial state
          await browser.screenshot({
            path: join(OUT_DIR, `${scenario.id}-${viewport.name}-00-initial.png`),
          });

          // Handle sign-in if needed
          const anonymousButton = await browser.locator('button:has-text("Sign in anonymously")').first();
          if (await anonymousButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await anonymousButton.click();
            await browser.waitForTimeout(2000);
          }

          await browser.screenshot({
            path: join(OUT_DIR, `${scenario.id}-${viewport.name}-01-signed-in.png`),
          });

          // Navigate to chat
          await browser.goto(`${APP_URL}/?surface=chat`);
          await browser.waitForTimeout(1500);

          // Run each query
          for (let i = 0; i < scenario.queries.length; i++) {
            const query = scenario.queries[i];
            const startTime = Date.now();
            const errors: string[] = [];

            console.log(`\n📝 Query ${i + 1}: ${query.text.slice(0, 60)}...`);

            // Find and fill input
            const inputSelector = 'textarea[placeholder*="Ask"], textarea, input[type="text"]';
            const input = await browser.locator(inputSelector).last();

            if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) {
              errors.push('Input not visible');
              results.push({
                query: query.text.slice(0, 60),
                responseLength: 0,
                duration: Date.now() - startTime,
                passed: false,
                errors,
              });
              continue;
            }

            await input.fill(query.text);
            await browser.waitForTimeout(300);

            // Submit
            await input.press('Enter');
            await browser.waitForTimeout(500);

            // Wait for streaming with timeout
            const maxWait = (scenario.expectations.maxTimeSeconds || 30) * 1000;
            let waited = 0;
            let streamingComplete = false;

            while (!streamingComplete && waited < maxWait) {
              await browser.waitForTimeout(1000);
              waited += 1000;

              // Check if streaming indicator is gone
              const streamingIndicators = await browser.locator('[data-testid="streaming-indicator"], .streaming-indicator, .animate-pulse').count().catch(() => 0);
              if (streamingIndicators === 0) {
                streamingComplete = true;
              }
            }

            // Wait a bit more for final render
            await browser.waitForTimeout(1500);

            // Extract response
            const responseLocator = await browser.locator('[data-testid="message-content"], .message-content, [class*="prose"]').last();
            const responseText = await responseLocator.textContent({ timeout: 5000 }).catch(() => null);

            const duration = Date.now() - startTime;
            const responseLength = (responseText || '').length;

            // Validate response
            const minLength = scenario.expectations.minResponseLength || 100;
            const hasContent = responseLength >= minLength;
            const notApologetic = !(responseText || '').toLowerCase().includes('i apologize') &&
                                  !(responseText || '').toLowerCase().includes('i\'m sorry');

            if (!hasContent) {
              errors.push(`Response too short (${responseLength} < ${minLength})`);
            }
            if (!notApologetic) {
              errors.push('Response contains apology');
            }

            // Check expected content if specified
            if (query.expectedContains) {
              for (const expected of query.expectedContains) {
                if (!(responseText || '').toLowerCase().includes(expected.toLowerCase())) {
                  errors.push(`Missing expected content: "${expected}"`);
                }
              }
            }

            const passed = errors.length === 0;

            results.push({
              query: query.text.slice(0, 60),
              responseLength,
              duration,
              passed,
              errors,
            });

            console.log(`  Duration: ${duration}ms`);
            console.log(`  Length: ${responseLength} chars`);
            console.log(`  Passed: ${passed ? '✅' : '❌'}`);
            if (errors.length > 0) {
              console.log(`  Errors: ${errors.join(', ')}`);
            }

            // Screenshot
            await browser.screenshot({
              path: join(OUT_DIR, `${scenario.id}-${viewport.name}-0${i + 2}-query-${i + 1}.png`),
            });
          }

          // Summary
          const allPassed = results.every(r => r.passed);
          const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

          console.log(`\n=== ${scenario.role} Summary ===`);
          console.log(`Viewport: ${viewport.name}`);
          console.log(`Queries: ${results.length}`);
          console.log(`Passed: ${results.filter(r => r.passed).length}/${results.length}`);
          console.log(`Avg Duration: ${avgDuration.toFixed(0)}ms`);

          // Attach results
          await testInfo.attach(`${scenario.id}-${viewport.name}-results`, {
            body: JSON.stringify({
              persona: scenario.role,
              viewport: viewport.name,
              results,
              summary: {
                allPassed,
                avgDuration,
                totalQueries: results.length,
                passedQueries: results.filter(r => r.passed).length,
              },
            }, null, 2),
            contentType: 'application/json',
          });

          expect(allPassed, `Persona ${scenario.role} had failing queries`).toBe(true);

        } finally {
          await browser.close();
        }
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-PERSONA COMPARISON TEST
// ═══════════════════════════════════════════════════════════════════════════

test.describe('AgentBrowser: Cross-Persona Comparison', () => {
  test('Compare responses across personas for same query', async ({}, testInfo) => {
    const sharedQuery = 'What is the competitive landscape for AI agent infrastructure companies?';

    const browser = await AgentBrowser.launch({
      headless: true,
      viewport: { width: 1440, height: 900 },
    });

    const comparison: Record<string, { length: number; duration: number; preview: string }> = {};

    try {
      await browser.goto(APP_URL);
      await browser.waitForTimeout(2000);

      // Sign in
      const anonButton = await browser.locator('button:has-text("Sign in anonymously")').first();
      if (await anonButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await anonButton.click();
        await browser.waitForTimeout(2000);
      }

      // Test each persona lens
      for (const scenario of PERSONA_SCENARIOS.slice(0, 3)) {
        console.log(`\n🧪 Testing ${scenario.role} lens...`);

        await browser.goto(`${APP_URL}/?surface=chat&lens=${scenario.queries[0].lens || 'founder'}`);
        await browser.waitForTimeout(1500);

        const start = Date.now();

        const input = await browser.locator('textarea').last();
        await input.fill(sharedQuery);
        await input.press('Enter');

        // Wait for response
        await browser.waitForTimeout(10000);

        const response = await browser.locator('[class*="prose"]').last().textContent().catch(() => 'No response');
        const duration = Date.now() - start;

        comparison[scenario.role] = {
          length: response.length,
          duration,
          preview: response.slice(0, 200),
        };

        console.log(`  Length: ${response.length}, Duration: ${duration}ms`);
      }

      await testInfo.attach('cross-persona-comparison', {
        body: JSON.stringify(comparison, null, 2),
        contentType: 'application/json',
      });

    } finally {
      await browser.close();
    }
  });
});
