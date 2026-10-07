# Eval Flywheel — Self-Judging Search Quality Loop

Continuous self-improving eval loop for the NodeBench search pipeline. The system judges itself, diagnoses failures, fixes them, and loops until 100%.

## When to activate
- After any change to `workers/node/routes/search.ts` or search-related tools
- User says "run eval", "flywheel", "judge loop", "reach 100%"
- After completing any implementation sprint touching search, entity enrichment, or result rendering
- Automatically after deploying search changes

## Judge model
- **Gemini 3.1 Flash Lite Preview** (`gemini-3.1-flash-lite-preview`)
- API key: `GEMINI_API_KEY` from `.env.local` or Convex env
- Fallback: `gemini-2.5-flash-lite-preview`

## Protocol

### Phase 1: Run eval harness
```bash
GEMINI_API_KEY=$(grep GEMINI_API_KEY .env.local | cut -d= -f2) \
  npx tsx packages/mcp-local/src/benchmarks/searchQualityEval.ts \
  --base-url=http://localhost:5191
```

### Phase 2: Diagnose failures
1. Read the eval report — identify failing categories and criteria
2. For each failing criterion (USEFUL_ANSWER, RELEVANT_ENTITY, ACTIONABLE_SIGNALS, ROLE_APPROPRIATE, RISK_AWARENESS, NEXT_STEPS, NO_HALLUCINATION):
   - Trace upstream: which search branch produced the failing result?
   - What data source was empty or generic?
   - Was the entity correctly extracted?
   - Did web_search return real data?
   - Did Gemini extraction produce structured signals?
3. Group failures by root cause, not by symptom

### Phase 3: Fix root causes
Priority order:
1. **Data quality** — web_search returning empty/generic → improve query templates, add Linkup fallback
2. **Entity resolution** — wrong entity extracted → fix regex patterns, add possessive/descriptor stripping
3. **Multi-entity** — comparison queries treated as single entity → add entity splitting
4. **Lens shaping** — same output regardless of role → add lens-specific templates
5. **Latency** — timeout causing empty results → tune timeouts, add caching

### Phase 4: Re-run and compare
- Run eval again after fixes
- Compare: did structural pass rate improve? Did Gemini pass rate improve?
- Check for regressions in previously passing categories
- If score decreased in any category: revert that specific fix

### Phase 5: Grow corpus
After reaching 95%+ on current corpus:
- Add 5-10 new queries targeting weak spots
- Add new categories (e.g., `temporal` for time-aware queries, `cross_domain` for cross-entity analysis)
- Add adversarial queries (misspellings, ambiguous entities, overlapping names)
- Re-run and target 100% on expanded corpus

### Phase 6: Loop
- Never stop at "good enough"
- If 3 consecutive rounds show no improvement: change strategy (different search provider, different extraction prompt, structural refactor)
- Track cumulative progress in eval-results/ directory

## 4-Layer Grounding Pipeline
See `grounded_eval.md` for full details. Summary:
1. **Retrieval confidence threshold** — high/medium/low based on snippet count
2. **Claim-level grounding filter** — `isGrounded()` rejects fabricated claims
3. **Grounded judge** — passes grounding metadata to Gemini for context-aware verification
4. **Citation chain** — `sourceIdx` on each signal/risk/change links to source snippet

**Separation of concerns**: structural checks (deterministic) handle grounding verification. LLM judge (stochastic) handles semantic quality. Never overload the judge with grounding rules.

## Judge Variance Mitigation
The Gemini judge is stochastic — same query can get different scores across runs.
- If variance > 10% across runs: use majority vote (3x calls, take consensus)
- Keep judge prompt SHORT and focused — long prompts increase variance
- Test judge changes on the full corpus before committing — regressions in previously-passing categories indicate prompt bloat

## Eval Corpus (100+ queries, 18 categories)
| Category | Count | Tests |
|----------|-------|-------|
| weekly_reset | 6 | founder weekly briefing |
| pre_delegation | 4 | agent handoff packets |
| important_change | 4 | what changed since last session |
| company_search | 10 | entity intelligence (Anthropic, Shopify, etc.) |
| competitor | 4 | multi-entity comparison (vs queries) |
| own_entity | 6 | "my company" queries |
| multi_entity | 4 | 3+ entity comparison |
| role_specific | 6 | one per lens |
| upload_context | 4 | meeting transcripts, documents |
| edge_case | 5 | empty, SQL injection, long input |
| temporal | 6 | time-aware queries |
| cross_domain | 6 | cross-entity analysis |
| adversarial | 8 | typos, single-word, ambiguous |
| diligence | 6 | deep company teardowns |
| action_oriented | 6 | "build me a...", "generate a..." |
| niche_entity | 6 | obscure companies |
| multi_turn | 6 | context-dependent follow-ups |
| scenario | 6 | what-if, future-facing |

## Infrastructure blockers — research and fix
When eval fails due to infrastructure gaps:
1. **Missing search provider** — Check Convex env for LINKUP_API_KEY, fall back to Gemini grounding
2. **Gemini extraction fails** — Try OpenAI extraction, or simpler regex-based extraction
3. **Tool not found** — Check toolset loading, verify tool names match
4. **Timeout** — Tune Promise.race timeouts, add AbortController
5. **Rate limiting** — Add delays between eval queries, batch web_search calls
6. **Judge variance** — Run 3x majority vote, keep prompt short, test on full corpus

Always do deep research before declaring a blocker permanent. The system should build itself. See `self_building_loop.md`.

## Key files
- `packages/mcp-local/src/benchmarks/searchQualityEval.ts` — Eval harness (100+ queries, Gemini judge)
- `packages/mcp-local/src/benchmarks/llmJudgeEval.ts` — Chained pipeline eval (tool A → tool B)
- `workers/node/routes/search.ts` — Search route with 4-layer grounding pipeline
- `packages/mcp-local/src/tools/entityEnrichmentTools.ts` — Entity enrichment MCP tools
- `packages/mcp-local/src/tools/webTools.ts` — web_search implementation
- `backend/convex/tools/media/linkupSearch.ts` — Linkup search (Convex-side)

## Anti-patterns
- Declaring done at 80% because "the remaining 20% is hard"
- Inflating structural checks to mask Gemini judge failures
- Removing failing queries from the corpus instead of fixing them
- Hardcoding entity data to pass specific test cases
- Overloading the LLM judge prompt with grounding rules (causes variance)
- Weakening the judge to improve scores instead of improving the system

## Related rules
- `grounded_eval` — 4-layer anti-hallucination pipeline
- `self_building_loop` — self-diagnosing infrastructure gaps
- `flywheel_continuous` — continuous improvement loop
- `analyst_diagnostic` — root cause before fix
- `self_direction` — never wait, keep moving
- `scenario_testing` — realistic test scenarios
- `agentic_reliability` — 8-point checklist for agent infra
- `completion_traceability` — cite original request
