import { describe, it, expect } from 'vitest';

// Gated live E2E with dynamic branching via eval node
const hasLLM = !!(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY);
const hasLinkup = !!(process.env.LINKUP_API_KEY || process.env.NEXT_PUBLIC_LINKUP_API_KEY);
const live = process.env.LIVE_E2E === '1' && hasLLM && hasLinkup;

if (!live) {
  describe.skip('orchestrator live eval e2e (dynamic branching)', () => {});
} else {
  describe('orchestrator live eval e2e (dynamic branching)', () => {
    it(
      'spawns new nodes via eval (structured tool) and completes end-to-end',
      async () => {
        // Use non-literal specifiers so Vite doesn't try to resolve them during transform.
        const orchestratorModule = '../../' + 'agents/core/orchestrator';
        const traceModule = '../../' + 'agents/core/trace';
        const searchModule = '../../' + 'agents/tools/search';
        const openaiModule = '../../' + 'agents/tools/openai';
        const structuredModule = '../../' + 'agents/tools/structured';
        const [{ orchestrate }, { Trace }, { searchTool }, { answerTool }, { structuredTool }] = await Promise.all([
          import(/* @vite-ignore */ orchestratorModule as any),
          import(/* @vite-ignore */ traceModule as any),
          import(/* @vite-ignore */ searchModule as any),
          import(/* @vite-ignore */ openaiModule as any),
          import(/* @vite-ignore */ structuredModule as any),
        ]);

        const demoRoot = `${process.cwd()}/agents/app/demo_scenarios`;

        const tools: any = {
          'web.search': searchTool({ root: demoRoot }),
          'answer': answerTool,
          'structured': structuredTool,
        };

        // Start with only an eval node. The LLM is instructed to return pass=false and add s1(search) -> a1(answer)
        const topic = 'Summarize the latest about Anthropic and Dario Amodei fundraising';
        const graph = {
          nodes: [
            {
              id: 'plan',
              kind: 'eval',
              label: 'Plan',
              prompt:
                [
                  'You are a strict planning tool that MUST return JSON matching the provided schema.',
                  'For the given topic, set pass=false and propose addNodes and addEdges to build a tiny graph:',
                  '- Add node s1: kind="search", label="Web Research", prompt="{{topic}}"',
                  '- Add node a1: kind="answer", label="Write brief", prompt="Write a concise brief based on: {{channel:s1.last}}"',
                  '- Add a single edge from s1 to a1',
                  'Do not include removeNodes or removeEdges. Use the exact ids s1 and a1.',
                  'Only return the JSON object that matches the schema; no extra commentary.',
                ].join('\n'),
            },
          ],
          edges: [],
        } as const;

        const trace = new Trace();
        const out = await orchestrate({ taskSpec: { goal: topic, type: 'ad-hoc', graph } as any, tools, trace, data: {} });

        expect(out.success).toBe(true);
        expect(typeof out.result).toBe('string');
        expect((out.result || '').length).toBeGreaterThan(0);

        // We expect that eval produced new nodes and they were executed
        const m = out.metrics as Record<string, any> | undefined;
        expect(m && typeof m === 'object').toBe(true);
        // The plan node ran, and dynamic nodes should be present
        expect(Object.keys(m || {})).toEqual(expect.arrayContaining(['plan', 's1', 'a1']));
      },
      150_000,
    );
  });
}
