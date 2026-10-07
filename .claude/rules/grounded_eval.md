# Grounded Eval — Anti-Hallucination Pipeline

4-layer grounding architecture for entity intelligence. Based on arxiv:2510.24476 (RAG + reasoning + agentic systems), Deepchecks claim-level verification, and Google Vertex AI grounding pipeline research.

## When to activate
- After any change to search route entity extraction or Gemini prompts
- When NO_HALLUCINATION failures exceed 10% of eval corpus
- When adding new entity enrichment sources
- User says "fix hallucination", "ground the output", "verify claims"

## 4-Layer Architecture

### Layer 1: Retrieval Confidence Threshold
Before extraction, check source quality:
- **high**: 3+ source snippets — proceed with full extraction
- **medium**: 1-2 snippets — extract conservatively, flag as limited
- **low**: 0 snippets — return "insufficient data" template, do NOT generate

Implementation: `retrievalConfidence` in `workers/node/routes/search.ts`

### Layer 2: Claim-Level Grounding Filter
After Gemini extraction, verify each claim against source text:
- `isGrounded(claim)`: check word overlap between claim and source corpus
- Reject claims with ZERO overlap (truly fabricated)
- Keep directional claims ("growing", "competitive") — these are synthesis, not hallucination
- Track `ungroundedFiltered` count in grounding metadata

Implementation: `isGrounded()` function in company_search branch

### Layer 3: Grounded Judge
Pass grounding metadata to the eval judge for context-aware verification:
- Judge receives `retrievalConfidence`, `snippetCount`, `groundedSignals`, `ungroundedFiltered`
- NO_HALLUCINATION criterion: fail ONLY for fabricated specific facts (dollar amounts, dates, percentages)
- Synthesis and inference are EXPECTED behavior — not hallucination
- Keep judge prompt clean — don't overload with grounding rules (causes variance)

Implementation: `callGeminiJudge()` in `searchQualityEval.ts`

### Layer 4: Citation Chain
Every signal, change, and risk carries a `sourceIdx` linking to the source snippet:
- Enables user-facing "verify this claim" functionality
- Enables dev-side audit of which sources support which claims
- `sourceSnippets` array in grounding metadata provides the lookup table

Implementation: `sourceIdx` field on signals, changes, risks in response

## Separation of Concerns
- **Structural checks** (deterministic): retrieval confidence, grounding filter, citation chain
- **LLM judge** (stochastic): semantic quality — USEFUL, RELEVANT, ACTIONABLE, ROLE_APPROPRIATE
- **Never** overload the LLM judge with grounding verification — causes variance and regression

## Judge Calibration Rules
- Directional claims are NOT hallucinations ("revenue growth" without a specific number)
- Synthesis across sources is the PRODUCT, not a bug
- Default/placeholder signals indicate "needs more data" — not hallucination
- When uncertain, PASS — false negatives on hallucination < blocking real signals
- If judge variance exceeds 10% across runs, use majority vote (3x calls)

## Key files
- `workers/node/routes/search.ts` — Layers 1-2 and 4 (retrieval, filter, citations)
- `packages/mcp-local/src/benchmarks/searchQualityEval.ts` — Layer 3 (grounded judge)
- `packages/mcp-local/src/benchmarks/llmJudgeEval.ts` — Chain coherence criterion

## Related rules
- `eval_flywheel` — the eval loop
- `self_building_loop` — self-diagnosing infrastructure gaps
- `analyst_diagnostic` — root cause before fix
- `agentic_reliability` — 8-point checklist
- `telemetry_trajectory` — trace visualization
