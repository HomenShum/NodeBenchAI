# Context Runtime Architecture Review

**Reviewed:** 2026-05-16
**Source spec:** User-provided 14-section Context Runtime design
**Method:** 4 parallel subagent deep review (architecture critique, implementation phasing, citation validation, codebase inventory)

---

## Verdict

The spec's **core insight is correct and should be preserved**: bounded heaps at every retrieval stage, parallel lane racing, and deferred LLM verification. This prevents the unbounded-context-window problem that kills agent reliability.

The spec's **core risk is over-architecture before data**: 12-weight scoring with no training data, 5-tier verification with no usage patterns, weekly self-improvement cron with no baseline to drift from, and clustering logic for a system that currently has demo fixtures.

**Ship the primitive. Defer the framework.**

---

## P0 Findings (address before building)

### P0-1: Cold start is the structural blind spot
With no graph, no cached verifications, no usage data, and no reports, 4 of 6 retrieval lanes return empty. The system degenerates to Typesense + Convex lookup with a 12-signal scorer that has meaningful values for maybe 2 signals.

**Fix:** Define an explicit "bootstrap mode" that bypasses scoring/clustering/verification and does direct retrieval + single-pass LLM synthesis until data density thresholds are met (e.g., 200+ entities, 50+ reports, 1000+ claims).

### P0-2: The 12-weight scoring formula is a 12-parameter random number generator
Without labeled relevance judgments, the weights (intent_match 0.20, entity_match 0.18, semantic_match 0.14, etc.) are arbitrary. The spec assigns intent 11% more than entity with no justification.

**Fix:** Ship with 3 signals only: intent match, entity match, recency. Use binary relevance feedback from user clicks/agent actions. Grow features only when you have logs showing where ranking fails.

### P0-3: First-card <2s SLO contradicts the pipeline depth
The spec promises "first card <2s" while requiring candidates to pass through per-lane heaps, merge to global top-80, cluster into 5 groups, then score with a 12-signal formula. That pipeline has at minimum 3 synchronization barriers before anything renders.

**Fix:** Stream the first card from the fastest lane (Convex direct lookup or memo cache) without waiting for merge/cluster/score. Background lanes enrich after initial render. The SLO applies to the fast path, not the full pipeline.

### P0-4: The bottleneck hypothesis is untested
The plan assumes retrieval quality is the bottleneck. If the real bottleneck is entity extraction quality (garbage in, garbage out), then Phase 1-2 improvements plateau fast.

**Fix:** Before building anything, run the existing eval harness on 20 queries where you manually provide perfect entity data. If scores jump 30%+, extraction is the bottleneck, not retrieval. This test takes 2 hours and determines the entire build order.

---

## P1 Findings (fix during implementation)

### P1-1: Heap sizes are cosmetic
50/20/50/30/30/10 merging to 80 merging to 20 are arbitrary round numbers with no empirical basis. The real question: what is the marginal value of candidate 50 vs candidate 20 in each lane?

**Recommendation:** Start with each lane returning its best 10, merge to 30, promote top 12 to LLM. Tune only after measuring recall loss.

### P1-2: Verification tier routing is undefined
The gap between tier 2 (lightweight model) and tier 3 (strong LLM judge) has no confidence threshold. Also missing: a "skip verification entirely" fast path for exact matches.

**Recommendation:** Define explicit promotion rules: promote to LLM judge if (a) claim confidence < 0.7 AND (b) business impact > medium AND (c) not cached verified. Everything else stays at tier 0-1.

### P1-3: Cache invalidation strategy is missing
The spec proposes cache types (entity_resolution_cache, report_context_cache, etc.) and a versioned key format but doesn't address: when caches are invalidated, what happens on stale reads, or how cache poisoning is prevented.

**Recommendation:** Ship with TTL-based caches (5-minute entity, 15-minute report, 1-hour source). Add version-based invalidation only when you observe stale-read bugs.

### P1-4: Error budget is absent
What happens when Typesense is down? Convex queries timeout? Graph is stale? No degradation strategy.

**Recommendation:** Each retrieval lane must have a fallback. Typesense down -> Convex fulltext. Graph stale -> skip graph lane, reduce merge heap. Budget: 1 lane failure = acceptable, 2 lane failures = degraded mode with user notice, 3+ = fallback to direct LLM with no context enrichment.

### P1-5: Typesense is a new infra dependency with unclear hosting
Self-hosted adds ops surface you can't afford. Cloud is the only sane option. Sync strategy: Convex action on entity/report mutations pushing to Typesense via HTTP with idempotent upserts.

**Recommendation:** Typesense Cloud. Fallback to Convex built-in search if Typesense is unavailable. Never make Typesense the only read path.

---

## P2 Findings (defer or simplify)

### P2-1: Clustering is premature
Grouping 200 candidates into 5 topic clusters before verification assumes (a) 200+ candidates per query, (b) meaningful topic separation, and (c) a clustering algorithm that runs in <100ms. Current data density doesn't produce 200 candidates.

**Defer** until retrieval lanes reliably return 50+ candidates per query.

### P2-2: Weekly self-improvement cron is Phase 5 for a reason
The cron assumes enough telemetry, eval coverage, and architecture stability to detect drift. The coding-agent PR proposer assumes patterns worth automating. Neither exists yet.

**Defer** until 30+ logged eval runs showing real drift patterns. Ship the eval logging infrastructure (structured JSON per run in a Convex table) as Phase 1 telemetry.

### P2-3: DuckDB/SQL analytics layer adds infra for offline-only value
SQL/DuckDB for batch analytics, eval joins, cost reporting. Useful but not user-facing.

**Defer** until Phase 2 is stable. Use Convex queries for initial eval storage.

### P2-4: Graph phase requires entity density that doesn't exist
The 19-node prototype graph is a fixture. Production requires entity extraction on every ingest + a backfill pipeline. Graph traversal only outperforms keyword search above ~200 nodes.

**Defer** Phase 3 until entity density reaches 200+ nodes. Build the extraction pipeline as a background ingest job during Phase 2.

---

## Citation Grounding

| Citation | Accuracy | Relevance | Application | Note |
|----------|----------|-----------|-------------|------|
| LightRAG (arXiv:2410.05779) | 4/5 | 4/5 | 3/5 | Correctly characterized but under-applied. Spec should specify which dual-level retrieval mechanism it borrows. |
| E2GraphRAG (arXiv:2505.24226) | 4/5 | 4/5 | 3/5 | Entity-to-chunk index idea is relevant but spec doesn't show concrete implementation mapping. |
| ASI-Evolve (arXiv:2603.29640) | 5/5 | 3/5 | 2/5 | Accurately described but the weekly cron is a loose analogy, not an implementation. Closest to cargo-culting. |
| Meta/Moltbook (Reuters) | 5/5 | 3/5 | 2/5 | Factually correct but governance inference is a stretch. Moltbook was a social network for agents, not a governance layer. |

**Overall:** Accuracy 4.5, Relevance 3.5, Application 2.5. The spec leans toward name-dropping rather than deep application.

---

## Existing Infrastructure Inventory

| Capability | Status | Key Files | Notes |
|------------|--------|-----------|-------|
| Search route | EXISTS | `server/routes/search.ts` | 4-layer grounding pipeline, entity extraction, web search, Gemini extraction |
| Convex schema | EXISTS | `convex/schema.ts` | Reports, entities, edges, claims, sources, notebooks, threads, captures |
| Graph traversal | PARTIAL | `packages/mcp-local/src/tools/` | MCP tools for entity traversal, co-occurrence edges, but no bounded ring traversal |
| Eval harness | EXISTS | `packages/mcp-local/src/benchmarks/searchQualityEval.ts` | 100+ query corpus, 18 categories, Gemini judge |
| Telemetry | PARTIAL | `convex/domains/agents/traceTypes.ts` | Per-run trace audit, tool health metrics, but no per-query scoring logs |
| Caching | PARTIAL | Various | Source pack cache, memo cache in search route, no structured cache layer |
| Verification | PARTIAL | `server/routes/search.ts` | `isGrounded()` claim filter, retrieval confidence threshold, but no tiered verification |
| Streaming | EXISTS | Agent panel + scratchpad | Real-time scratchpad streaming, step timeline, parallel task timeline |
| Typesense | MISSING | None | No Typesense integration. Search is Convex queries + web search + Gemini extraction |
| Candidate scoring | PARTIAL | `server/routes/search.ts` | Basic retrieval confidence (high/medium/low), no weighted multi-signal scoring |
| Clustering | MISSING | None | No candidate grouping or topic clustering |

---

## Recommended Build Order (90-day window)

### Phase 0.5: Prove the primitive (Week 1)
Build a `CandidateHeap` class that wraps the existing search route results. One file, one class. Scores against 3 static signals (recency, source authority, query similarity). Wire behind a feature flag on `/api/search`. Prove it by showing eval harness score delta on the existing 100-query corpus.

**Deliverable:** One PR, one metric, no new infrastructure.

### Phase 1: Scoring runtime + deterministic verification (Weeks 2-4)
- `ContextRouter` with 3 retrieval lanes (Convex lookup, existing search, memo cache)
- `ScoringWeights` with 3-4 signals, hardcoded initially
- Deterministic verification tier (schema validation, source URL liveness, duplicate detection)
- Structured telemetry logging (JSON per query in Convex `eval_runs` table)

### Phase 2: Typesense instant search (Weeks 5-8)
- Typesense Cloud setup with 4 collections (entities, reports, sources, claims)
- Convex -> Typesense sync actions on mutations
- Cmd+K and @reference powered by Typesense multi_search
- Agent retrieval lane added to ContextRouter
- Source matching verification tier (claim-to-snippet overlap via Typesense)

### Phase 2.5: Entity extraction pipeline (Weeks 6-8, parallel with Phase 2)
- Entity extraction on every report/capture ingest
- Backfill from existing entity slugs and report co-occurrence
- Write edges to Convex `entity_edges` table
- Target: 200+ nodes before Phase 3

### Phase 3: Graph retrieval + remaining verification (Weeks 9-12, only if density threshold met)
- Bounded ring traversal over entity graph
- Graph neighborhood cache
- Lightweight model verification tier
- LLM judge only for promoted claims (>= medium impact + < 0.7 confidence)

### Deferred (Q3+)
- Clustering
- Weekly self-improvement cron
- DuckDB analytics
- Full 12-signal scoring model
- Human approval queue

---

## Counter-model to test first

Before building anything:

```
Run eval harness on 20 queries with manually-provided perfect entity data.
If scores jump 30%+: extraction is the bottleneck, not retrieval.
  -> Promote Phase 2.5 to Phase 0.5
  -> Demote scoring runtime to Phase 2
If scores don't jump: retrieval quality is the bottleneck.
  -> Proceed with the plan above
```

This test takes 2 hours and determines the entire build order.

---

## Architecture sentence (revised)

> NodeBench uses parallel context routing with bounded heaps at every stage. Each chat turn races memo cache, Convex, and search in parallel, with Typesense added when deployed. Candidates are scored into bounded heaps with 3-4 signals, and only promoted to LLM verification when impact is high and confidence is low. Convex remains the source of truth, Typesense powers snappy UI search, and structured eval logging enables data-driven tuning of scoring weights over time. Complexity is added only when logs show where ranking fails.
