# Graph Hierarchy — Node & Edge Architecture (home-v3.html)

Exhaustive documentation of the hierarchical graph system in the Reports
surface Graph view. Covers node types, edge types, visual vocabulary,
peek card behavior, interactive flows, and force simulation tuning.

Tested: 2026-05-15 | Surface: Reports > Graph | File: home-v3.html

---

## Design Principle

**First-principle hierarchy**: Entity is the root object a user investigates.
Reports are analyses derived from one entity. Artifacts are rendered HTML
outputs generated from a report. Portfolios and Briefs are cross-entity
containers that also produce artifacts. The graph makes this hierarchy
visually navigable and click-through.

---

## Node Types (6 total)

| Type | Icon | Fill | Border | Size | Label Style |
|------|------|------|--------|------|-------------|
| `company` | (none) | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | weight-based (6-10) | 11px Manrope, white |
| `person` | (none) | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | weight-based (4-6) | 11px Manrope, white |
| `investor` | (none) | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | weight-based (5-7) | 11px Manrope, white |
| `brief` | (none) | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | weight-based (5) | 11px Manrope, white |
| `portfolio` | **P** | `rgba(167,139,250,0.15)` | `#a78bfa` (violet) | weight-based (6) | 11px Manrope, white |
| `report` | **R** | `rgba(96,165,250,0.15)` | `#60a5fa` (blue) | weight-based (4) | 11px Manrope, white |
| `artifact` | **V** | `rgba(217,119,87,0.15)` | `#d97757` (terracotta) | weight-based (3) | 9px JetBrains Mono, terracotta |

### Visual Vocabulary

- **Size** communicates importance — entities are largest, artifacts smallest
- **Color** communicates type family — terracotta = output, blue = analysis, violet = portfolio
- **Icon letter** distinguishes new node types from legacy entity nodes
- **Font** distinguishes artifacts (monospace = code/file) from entities (sans-serif = names)
- Artifact labels show `.html` extension and subtitle shows `artifactType` (e.g., "comparison")

---

## Edge Types (8 total)

### Hierarchy edges (vertical: parent → child)

| Type | Stroke Color | Dash Pattern | Width | Semantic | Distance |
|------|-------------|-------------|-------|----------|----------|
| `funding` | `#d97757` | solid | 1.0 | Entity funded by Investor | 130px |
| `competition` | `rgba(255,255,255,0.12)` | solid | 1.0 | Entity competes with Entity | 130px |
| `integration` | `rgba(255,255,255,0.12)` | `4 2` | 1.0 | Entity integrates with Entity | 130px |
| `has_report` | `#d97757` | solid | 0.9 | Entity/Brief owns Report | 70px |
| `has_artifact` | `#d97757` | `3 2` | 0.7 | Report/Brief/Portfolio owns Artifact | 55px |
| `covers` | `rgba(255,255,255,0.12)` | `1 2` | 0.5 | Portfolio covers Entity | 110px |

### Lateral edges (cross-artifact: causation & correlation)

| Type | Stroke Color | Dash Pattern | Width | Semantic | Distance |
|------|-------------|-------------|-------|----------|----------|
| `causes` | `#f472b6` (rose) | solid | 0.8 | Artifact A's data drives changes in Artifact B | 95px |
| `correlates_with` | `#f59e0b` (amber) | `4 3` | 0.6 | Artifact A's data moves with Artifact B's data | 105px |

### Visual Rules

- **Solid terracotta** = ownership (entity → report)
- **Dashed terracotta** = derivation (report → artifact)
- **Dotted faint** = coverage relationship (portfolio → entity)
- **Solid rose** = causation (artifact → artifact, directional)
- **Dashed amber** = correlation (artifact ↔ artifact, bidirectional)
- **Shorter distance** = tighter visual clustering (artifacts orbit reports, reports orbit entities)

### Causation vs Correlation

**Causation** is directional: A causes B. The peek card shows `CAUSES` on the
source artifact and `CAUSED BY` on the target artifact. Example: pricing
change (A) causes competitive matrix shift (B). The relationship has a
direction — removing A would prevent B from changing.

**Correlation** is bidirectional: A moves with B. The peek card shows
`CORRELATES` on both ends. Example: signal decay rate tracks with timeline
activity patterns. Neither causes the other — they share an underlying driver.

---

## Hierarchy Patterns (Real-World Use Cases)

### Pattern 1: Single-Entity Investigation (most common)

```
Entity (Anthropic)
  |
  +-- has_report --> Report (Coverage Memo)
  |                    |
  |                    +-- has_artifact --> Artifact (pricing-comparison.html)
  |
  +-- has_report --> Report (Signal Monitor)
                       |
                       +-- has_artifact --> Artifact (signal-decay.html)
```

**Use case**: User investigates one company. Agent produces reports (Coverage
Memo, Signal Monitor). Each report generates one or more artifacts (pricing
grids, signal charts). The graph shows entity at center, reports clustered
around it, artifacts as leaf nodes hanging off reports.

### Pattern 2: Competitive Analysis (cross-entity report)

```
Entity (Bug0)
  |
  +-- has_report --> Report (Competitive Analysis)
                       |
                       +-- has_artifact --> Artifact (feature-matrix.html)
```

**Use case**: User creates a competitive analysis report. The report belongs
to one entity (the subject) but its artifact (feature matrix) compares
multiple entities. The graph anchors the report to its subject entity.

### Pattern 3: Daily Brief (cross-entity container)

```
Brief (Daily Brief -- May ...)
  |
  +-- has_artifact --> Artifact (signal-timeline.html)
```

**Use case**: System generates a daily brief covering all monitored entities.
The brief produces timeline artifacts. In the graph, the brief node has no
parent entity — it floats as a standalone container with its artifact
children.

### Pattern 4: Portfolio Classification (cross-entity grouping)

```
Portfolio (AI Infrastructure)
  |
  +-- covers --> Entity (Anthropic)  [STRATEGIC]
  +-- covers --> Entity (OpenAI)     [STRATEGIC]
  +-- covers --> Entity (Bug0)       [WATCH]
  +-- covers --> Entity (Cohere)     [WATCH]
  |
  +-- has_artifact --> Artifact (portfolio-tiering.html)
```

**Use case**: User creates a portfolio/universe that groups entities by
investment tier. The portfolio produces a tiering artifact showing the
classification. In the graph, the portfolio node connects DOWN to entities
via `covers` edges (dotted, labeled Strategic/Watch) and to its artifact
via `has_artifact`.

### Pattern 5: Cross-Artifact Causation (knowledge graph)

```
Artifact (pricing-comparison.html)
  |
  +-- causes --> Artifact (feature-matrix.html)
  |                "Price shift reshapes competitive positioning"
  |
  +-- causes --> Artifact (portfolio-tiering.html)
                   "Price change triggers portfolio re-classification"
```

**Use case**: When one artifact's data changes, it triggers downstream effects
in other artifacts. Pricing repricing causes the competitive matrix to shift
and the portfolio tiering to re-classify. These are directional — the source
artifact drives the change in the target.

### Pattern 6: Cross-Artifact Correlation (shared signals)

```
Artifact (signal-decay.html) ↔ Artifact (signal-timeline.html)
  "Signal freshness tracks with timeline activity"

Artifact (feature-matrix.html) ↔ Artifact (signal-decay.html)
  "Competitive movement correlates with signal decay rate"
```

**Use case**: Two artifacts whose data moves together without one causing the
other. Signal decay rate and timeline activity share underlying market
dynamics. Competitive changes and signal freshness both reflect the same
market velocity. These are bidirectional — neither is the root cause.

### Relationship Map (all cross-artifact edges)

```
pricing-comparison ──causes──> feature-matrix ──correlates──> signal-decay
       |                                                          |
       +────causes────> portfolio-tiering        signal-timeline <─┘
                                                   (correlates)
```

- `pricing-comparison.html`: 2 outbound causations
- `feature-matrix.html`: 1 inbound causation + 1 correlation
- `signal-decay.html`: 2 correlations
- `signal-timeline.html`: 1 correlation
- `portfolio-tiering.html`: 1 inbound causation

---

## Peek Card Behavior (per node type)

### Entity Peek Card

| Section | Content |
|---------|---------|
| Header | Entity name + VERIFIED/STALE badge |
| SOURCES | Source count + named sources |
| FRESHNESS | Last update timestamp |
| VERIFIED | Claim verification count |
| COVERAGE | Tag badges (sector/topic) |
| Summary | 1-2 bullet signal summaries |
| **REPORTS** | **Lists child reports with REPORT badge (clickable)** |
| Actions | Open notebook, Compare, Refresh |

### Report Peek Card

| Section | Content |
|---------|---------|
| Header | Report name + VERIFIED/REVIEW badge |
| HIERARCHY | **Parent chain: Entity -> Report** |
| SOURCES | Source count + generation method |
| FRESHNESS | Last update timestamp |
| VERIFIED | Cross-reference status |
| COVERAGE | Tag badges |
| Summary | 1-line report finding |
| **ARTIFACTS** | **Lists child artifacts with type badge (clickable)** |
| Actions | Open report, Regenerate |

### Artifact Peek Card

| Section | Content |
|---------|---------|
| Header | Filename + type badge (COMPARISON/MATRIX/DECAY/etc.) |
| **HIERARCHY** | **Full parent chain: Entity -> Report -> Artifact** |
| SOURCES | "Derived from [parent report]" |
| FRESHNESS | Generation method |
| VERIFIED | Content description |
| COVERAGE | Entity tags if multi-entity |
| Preview data | Key data from the artifact content |
| Actions | **Open preview** (opens artifact panel), Edit, Share |

### Portfolio Peek Card

| Section | Content |
|---------|---------|
| Header | Portfolio name + VERIFIED badge |
| SOURCES | Entity count + sector count |
| FRESHNESS | Policy application date |
| VERIFIED | Classification completeness |
| COVERAGE | Sector tag badges |
| Summary | Tier breakdown counts |
| **ARTIFACTS** | **Lists child artifacts with type badge** |
| **COVERS (N ENTITIES)** | **Lists covered entities with STRATEGIC/WATCH tier** |
| Actions | Open workbench, Re-classify |

### Brief Peek Card

| Section | Content |
|---------|---------|
| Header | Brief title + date |
| **ARTIFACTS** | **Lists child artifacts** |
| Actions | Open brief |

---

## Interactive Flows

### Flow 1: Artifact Node -> Open Preview -> Artifact Panel

```
1. User clicks artifact node in graph
2. Peek card appears with hierarchy breadcrumb and "Open preview" button
3. User clicks "Open preview"
4. peek.addEventListener delegates to [data-graph-open-artifact] handler
5. Handler calls switchSurface('chat') to navigate to chat surface
6. Handler calls window.openArtifact(originSurface, artifactKey)
7. Artifact panel opens with live preview of the HTML artifact
8. origin-surface stored so Back button returns to Reports
```

**Verified**: pricing-comparison.html opens correctly via this flow.

### Flow 2: Report Node -> Focus Child Artifact

```
1. User clicks report node in graph
2. Peek card shows ARTIFACTS section with clickable rows
3. User clicks artifact row
4. [data-graph-focus] handler centers graph on the artifact node
5. Artifact node's peek card appears
```

### Flow 3: Entity Node -> Focus Child Report

```
1. User clicks entity node in graph
2. Peek card shows REPORTS section with clickable rows
3. User clicks report row
4. [data-graph-focus] handler centers graph on the report node
5. Report node's peek card appears
```

### Flow 4: Portfolio Node -> Focus Covered Entity

```
1. User clicks portfolio node in graph
2. Peek card shows COVERS section with entity rows + tier labels
3. User clicks entity row
4. [data-graph-focus] handler centers graph on the entity node
5. Entity node's peek card appears
```

---

## Force Simulation Tuning

### Link Distance (shorter = tighter clustering)

| Edge Type | Distance | Rationale |
|-----------|----------|-----------|
| `has_artifact` | 55px | Artifacts orbit tightly around parent report |
| `has_report` | 70px | Reports cluster near parent entity |
| `covers` | 110px | Coverage is a loose grouping, not tight containment |
| Default (funding, competition, integration) | 130px | Entity-to-entity relationships are the widest |

### Charge Strength (weaker = less repulsion, tighter groups)

| Node Type | Strength | Rationale |
|-----------|----------|-----------|
| `artifact` | -120 | Minimal repulsion, artifacts stay near parents |
| `report` | -200 | Moderate repulsion, reports don't overlap but stay grouped |
| Default (entity, portfolio, brief) | -420 | Strong repulsion, entities spread for readability |

### Result

The simulation naturally produces a visual hierarchy where:
- Entities are the largest, most spread nodes
- Reports cluster around their parent entity
- Artifacts hang off reports as small leaf nodes
- Portfolios float in an outer orbit connected to entities by thin dotted lines

---

## Helper Functions

### `getChildren(id)` — returns direct children

```javascript
// Traverses links where source === id AND type is has_report, has_artifact, or covers
// Returns: [{ node, edgeType, edgeLabel }]
```

Used by peek card to populate REPORTS / ARTIFACTS / COVERS sections.

### `getParent(id)` — returns direct parent

```javascript
// Traverses links where target === id AND type is has_report or has_artifact
// Returns: { node, edgeType } or null
```

Used by peek card to build hierarchy breadcrumb chain.

---

## Artifact Registry (wired to graph)

| Node ID | artifactKey | artifactType | Parent Report | Parent Entity |
|---------|-------------|-------------|--------------|---------------|
| `art-pricing` | `pricing-comparison.html` | comparison | Coverage Memo | Anthropic |
| `art-matrix` | `feature-matrix.html` | matrix | Competitive Analysis | Bug0 |
| `art-decay` | `signal-decay.html` | decay | Signal Monitor | Anthropic |
| `art-timeline` | `signal-timeline.html` | dashboard | (none -- Brief child) | Daily Brief |
| `art-tiering` | `portfolio-tiering.html` | tiering | (none -- Portfolio child) | AI Infrastructure |

All 5 artifacts verified to open in artifact panel via `window.openArtifact()`.

---

## Legend Entries

| Entry | Visual | Meaning |
|-------|--------|---------|
| Funding | Solid terracotta line | Investment/funding relationship |
| Competition | Solid faint line | Competitive relationship |
| Integration | Dashed faint line | Technical integration |
| **Report** | **Solid terracotta line (narrower)** | **Entity owns report** |
| **Artifact** | **Dashed terracotta line (thinnest)** | **Report/container produces artifact** |

---

## Test Results (Interactive Hierarchy)

| # | Test | Input | Expected | Result |
|---|------|-------|----------|--------|
| 1 | Artifact peek shows parent chain | Click art-pricing node | HIERARCHY: Anthropic -> Coverage Memo -> pricing-comparison.html | PASS |
| 2 | Artifact "Open preview" flow | Click "Open preview" on art-pricing peek | Switches to chat, opens artifact panel with pricing comparison | PASS |
| 3 | Report peek shows child artifacts | Click rpt-coverage node | ARTIFACTS section lists pricing-comparison.html | PASS |
| 4 | Report peek shows parent entity | Click rpt-coverage node | HIERARCHY: Anthropic -> Coverage Memo | PASS |
| 5 | Entity peek shows child reports | Click anthropic node | REPORTS section lists Coverage Memo + Signal Monitor | PASS |
| 6 | Portfolio peek shows child artifact | Click portfolio-ai node | ARTIFACTS section lists portfolio-tiering.html | PASS |
| 7 | Portfolio peek shows covered entities | Click portfolio-ai node | COVERS section lists 4 entities with STRATEGIC/WATCH tier | PASS |
| 8 | Portfolio covers has tier labels | Click portfolio-ai node | Anthropic=STRATEGIC, OpenAI=STRATEGIC, Bug0=WATCH, Cohere=WATCH | PASS |
| 9 | Artifact nodes use monospace font | Visual inspection | 9px JetBrains Mono, terracotta color | PASS |
| 10 | Report nodes show R icon | Visual inspection | Blue circle with white "R" text | PASS |
| 11 | Artifact nodes show V icon | Visual inspection | Terracotta circle with white "V" text | PASS |
| 12 | Portfolio nodes show P icon | Visual inspection | Violet circle with white "P" text | PASS |
| 13 | has_report edges solid terracotta | Visual inspection | Solid line, #d97757, width 0.9 | PASS |
| 14 | has_artifact edges dashed terracotta | Visual inspection | Dash pattern "3 2", #d97757, width 0.7 | PASS |
| 15 | covers edges dotted faint | Visual inspection | Dash pattern "1 2", rgba(255,255,255,0.12), width 0.5 | PASS |
| 16 | Force clustering hierarchy | Visual inspection | Artifacts near reports, reports near entities | PASS |
| 17 | Legend includes Report + Artifact | Visual inspection | Two new legend entries with correct line styles | PASS |
| 18 | Brief peek shows child artifact | Click brief node | ARTIFACTS section lists signal-timeline.html (DASHBOARD) | PASS |
| 19 | Brief peek has no parent chain | Click brief node | No HIERARCHY row (brief is a root container) | PASS |
| 20 | Brief peek shows cross-entity metadata | Click brief node | SOURCES: "Compiled from 5 tracked entities", COVERAGE includes Cross-entity | PASS |
| 21 | Artifact with outbound causation | Click art-pricing | CAUSATION section: feature-matrix (CAUSES) + portfolio-tiering (CAUSES) | PASS |
| 22 | Artifact with inbound causation | Click art-matrix | CAUSATION section: pricing-comparison (CAUSED BY) | PASS |
| 23 | Artifact with correlation | Click art-matrix | CORRELATION section: signal-decay (CORRELATES) | PASS |
| 24 | Both causation + correlation on one card | Click art-matrix | Shows CAUSATION + CORRELATION as separate sections | PASS |
| 25 | Causation edge solid rose in graph | Visual inspection | Solid #f472b6, width 0.8 | PASS |
| 26 | Correlation edge dashed amber in graph | Visual inspection | Dash "4 3", #f59e0b, width 0.6 | PASS |
| 27 | Legend shows Causes + Correlates | Visual inspection | Rose solid + amber dashed entries in legend bar | PASS |
| 28 | Relation row is clickable (focus target) | Click relation row | data-graph-focus navigates to target artifact node | PASS |
| 29 | Relation descriptions render | Zoom on peek card | Human-readable causal/correlation descriptions visible | PASS |

29/29 tests passed.

---

## Summary

The graph implements a layered visual knowledge graph:

- **7 node types** with distinct fill, border, icon, and font treatments
- **8 edge types**: 6 hierarchy + 2 lateral (causation, correlation)
- **6 real-world patterns**: single-entity, competitive, brief, portfolio, causation chain, correlation pair
- **4 interactive flows** (artifact open, focus child, focus parent, focus covered entity)
- **Peek cards adapt per node type** showing parent chain up + child list down + lateral relations
- **Cross-artifact intelligence**: causations (rose, directional) and correlations (amber, bidirectional) turn isolated artifacts into a connected knowledge web

The force simulation naturally groups children near parents via shorter link
distances and weaker charge strengths. Lateral edges use moderate distances
(95-105px) to keep related artifacts visible without collapsing the hierarchy.

Documented 2026-05-15. Companion to HOME_V3_STATE_MATRIX.md.
