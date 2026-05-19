# Graph + Trace UX Research Synthesis

Consolidated findings from 3 parallel research agents (behavioral psychology,
competitive analysis, agent context presentation). Produced 2026-05-15.

---

## Executive Summary: 5 Design Decisions

1. **Default to lists, not graphs.** Notion, Linear, Perplexity, Elicit all hide
   the graph and show filtered lists. Graph on demand, scoped to 1-2 hops.
   Roam/Obsidian graph views are explicitly described by users as "practically
   useless" at scale. (Competitive analysis)

2. **Pre-filter before render.** Neo4j Bloom Perspectives = our server modes.
   Let users save named lenses. Cap visible nodes at 200-500. (Competitive)

3. **Agent trace = collapsible tree, not DAG.** Three tiers with progressive
   disclosure. Summary first, detail on demand. Timing bars. (All three agents)

4. **Graph context selection is the most important trace node.** It determines
   the agent's belief boundary, evidence boundary, and blind spots. Must be
   visible, expandable, and overridable. (Agent context research)

5. **Clustered view must pass the 5-second test.** Processable using only
   pre-attentive visual features (color, size, shape) in under 5 seconds.
   Every node carries exactly one quantified information gap. (Behavioral)

---

## Behavioral Psychology Thresholds

### Working Memory (Cowan 2001, Halford et al. 2005)
- 4±1 independent chunks when rehearsal prevented
- Relational complexity bounded at 4 simultaneous relations
- **Rule:** Visible clusters = 3-5 nodes each, max 4 clusters at a time

### Information Foraging (Pirolli & Card 1999, Chi et al. 2001)
- Users make patch-leaving decisions in 2-4 seconds based on scent
- 15-30% visible-to-total ratio is optimal (Furnas 1986)
- Users abandon after 2 failed navigation steps
- **Rule:** Every node needs 2-line scent preview (type + recent signal + count)

### Progressive Disclosure (Krug 2014, Tidwell 2010)
- Each tier halves user participation (100% → 50% → 25% → 12%)
- 3 tiers max for mainstream users
- Animated transitions improve comprehension 20% (Heer & Robertson 2007)
- **Rule:** Tier 1 = clustered (everyone), Tier 2 = focus (50%), Tier 3 = expanded (25%)

### Dual-Process (Kahneman 2011, Healey & Enns 2012)
- Pre-attentive features processed in <200ms (color, size, shape)
- Label reading = serial at 200-250ms per item
- **Rule:** Clustered mode = System 1 (shape/color/size only). Focus = System 1+2. Expanded = System 2.

### Trust Calibration (Joslyn & LeClerc 2012, Fernandes et al. 2018)
- Icon arrays > pie charts > numeric for untrained users
- Red-yellow-green creates false binary (Hullman et al. 2019)
- 5-tier scale maps well: very low / low / medium / high / very high (Budescu et al. 2014)
- **Rule:** Encode as fill opacity (20/40/60/80/100%), numeric on hover only. Call it "evidence strength" not "confidence."

### Curiosity Gaps (Loewenstein 1994, Golman & Loewenstein 2018)
- Quantified gaps 2-3x more effective than vague indicators
- Curiosity strongest at moderate confidence (Kang et al. 2009)
- **Rule:** Each node shows "[3 new signals]" not a generic "new" dot

### Node-Link vs Matrix (Ghoniem et al. 2005, Okoe et al. 2019)
- Node-link superior under 50 nodes for all tasks
- 50+ nodes: matrix wins for edge detection; hybrid (NodeTrix) for mixed
- **Rule:** Node-link for all three modes. Semantic zoom at upper bounds.

---

## Competitive Product Patterns

### What works (steal these)
| Product | Pattern | Steal for NodeBench |
|---------|---------|---------------------|
| Perplexity | Inline numbered citations + source cards | Claims carry [1][2] markers linked to source panel |
| Linear | Filtered lists + saved views + "12 hidden" badge | Reports default = filtered list, not graph |
| Scite | Supporting/contrasting/mentioning edge classification | Type source→claim edges semantically |
| Neo4j Bloom | Named Perspectives as pre-filtered lenses | Let users save mode+filter combos as reusable lenses |
| Palantir | Chainable "Search Around" = investigation trail | Agent phases = Search Around hops in the trace |
| Notion | Relations surfaced as columns, not graph viz | For 34 reports, relation columns beat graph |
| Claude Code | Collapsible tool-call transcripts | 3-tier trace with progressive collapse |
| Consensus | Evidence meter (% support vs contradict) | Confidence meter per entity from all sources |

### What fails (avoid these)
| Product | Anti-pattern | Lesson |
|---------|-------------|--------|
| Roam/Obsidian | Global graph view as primary nav | "Practically useless" — users ignore it |
| Neo4j Bloom | 10k node physics layout | Hairball above 200-500 visible |
| Devin | Real-time streaming of agent thinking | Polarizing — power users love it, casual users anxious |
| Notion | Relations limited to 1-hop | Need transitive closure for deep investigations |

---

## Agent Context Presentation

### Context transparency (Amershi et al. 2019, Liao et al. 2020)
- Show confidence and scope at glance level, detail on demand
- Explanation completeness has diminishing returns past 3-5 items
- **Rule:** "Graph context resolved" node shows 1 sentence. Expand reveals scored list.

### "Why this, not that?" (Miller 2019)
- Contrastive explanations ("X because A, not Y because B") beat causal chains
- **Rule:** Default = sentence-form ("Included 3 funding reports, excluded 21 older ones"). Expert toggle = scored table.

### Budget visibility (Horvitz 1999)
- Budget indicators help when users can ACT on them, create anxiety when they cannot
- **Rule:** Show qualitative ("Focused context" / "Rich context" / "Near capacity"), raw numbers only in expert view.

### Dual-audience trace
- Live mode: timeline, nodes appear as completed, current pulses, collapsed summaries
- Audit mode: full DAG, filterable, timing waterfall, click-to-expand
- **Rule:** Auto-switch: live during execution, audit after completion. Manual toggle for power users.

### Memory vs perception distinction (Kim et al. 2018)
- Users calibrate trust better distinguishing "what system knew" from "what it just found"
- **Rule:** Memory nodes (graph context) = muted border + "Known" label. Perception nodes (web search) = accent border + "New" label.

### Human override (Horvitz 1999, Amershi et al. 2019)
- Pre-execution editing beats post-execution correction
- **Rule:** After graph resolution, 3-second auto-proceed with "Edit context" option. Post-execution: "Include next time" / "Less relevant" as preference signals.

---

## Implementation Priority

### P0 — Already done
- [x] Graph context resolved as first-class trace node (prototype)
- [x] Three-tier progressive disclosure (outputs → phases → tool calls)
- [x] Server-bounded neighborhood queries (PR #362)
- [x] Cross-surface handoff (trace → artifact, trace → reports)
- [x] nodeAttentionScore + reasonSelected data model (per-node score, reason, tier)

### P1 — Next sprint
- [ ] contextRef shape passed from chat runtime to agent backend
- [ ] Agent records `resolve_report_graph_context` as trace step
- [ ] Wire attention scores to live Convex data (replace prototype fixtures)
- [ ] Surface attention/reason in peek card (subtle, not overlay chrome)
- [ ] Graph → trace panel deep link (node click opens relevant trace step)

### P2 — Following sprint
- [ ] Named lenses (saved mode+filter combos)
- [ ] Scite-style edge classification (confirms/contradicts/mentions)
- [ ] Dual-mode trace (live timeline vs audit DAG auto-switch)
- [ ] Pre-execution "Edit context" intervention point
- [ ] Curiosity gap badges ("[3 new signals]" on graph nodes)

### P3 — Scale preparation
- [ ] Sigma.js / WebGL renderer for 200+ visible nodes
- [ ] Semantic zoom (peripheral nodes collapse to summary)
- [ ] Precomputed layouts for common query patterns
- [ ] Graph-as-search-index (Convex edge tables for indexed traversal)
