# Artifact Types Research

Deep research on multi-data-source artifact types for an intelligence platform.
Covers reference products, artifact taxonomy, pasted-data patterns, live data
feeding, and design inspiration.

*Researched 2026-05-15.*

---

## Section A: Reference Products

### 1. Observable HQ
Data loaders run at build time (server-side), JavaScript cells are reactive
in the browser. Spreadsheet-style dataflow where changing one parameter
cascades through all dependent visualizations instantly.
**Takeaway:** Markdown + embedded reactive JS + build-time data separation
is the right pattern for intelligence artifacts.

### 2. Hex
Multi-language notebooks (SQL + Python + no-code) with AI agent that
generates analyses. Published "data apps" from notebooks.
**Takeaway:** AI-generated analysis notebooks becoming interactive apps
is a viable product pattern.

### 3. Evidence.dev
"BI as code" -- SQL inline in Markdown, rendered as interactive charts.
DuckDB WASM in-browser for client-side OLAP queries. Git-versioned,
deployable as static sites.
**Takeaway:** SQL embedded in markdown + interactive charts + static HTML
deploy is directly applicable to agent-generated artifacts.

### 4. Claude Live Artifacts (April 2026)
MCP connections to Calendar, Gmail, Slack, Notion, Shopify. Persistent
storage up to 20MB. Live data refresh on every open. VM-based execution.
**Takeaway:** Direct competitor reference. NodeBench differentiator is
entity graph as native data source (not generic MCP connections).

### 5. v0.dev / v0.app
AI-generated React components. Full-stack sandbox runtime. Multi-page apps.
6M+ developers. Database integrations (Snowflake, AWS).

### 6. Retool
100+ pre-built components binding to 50+ data sources. AI can generate
full apps from a prompt.
**Takeaway:** Pre-built component vocabulary for agent composition, not
raw HTML generation.

### 7. Quadratic
Spreadsheet cells with Python/SQL. Infinite canvas. 200K+ users at
Bloomberg, Apple, MIT.

### 8. Notion Dashboard Views (March 2026)
Database is a container holding multiple Data Sources. Chart views (bar,
line, donut) directly on top of databases.

### 9. Airtable Interfaces
AI-generated interface elements from natural language descriptions.

---

## Section B: Artifact Type Taxonomy (15 types)

| # | Type | Scale | Data Sources |
|---|------|-------|--------------|
| 1 | Portfolio Tiering Grid | 50-5000 companies | Entity signals, user-pasted tiering policy |
| 2 | Competitive Landscape Bubble | 10-50 entities | Funding, growth, market position signals |
| 3 | Signal Timeline / Changelog | 1-N entities | Change history, signal timestamps, news |
| 4 | Entity Comparison Matrix | 2-10 entities | Latest reports, structured signals, web data |
| 5 | Coverage Heatmap | 100+ entities | Report completeness, signal counts, staleness |
| 6 | Risk Radar / Spider Chart | 1-10 entities | Risk signals, regulatory, sentiment |
| 7 | Funding / Capital Flow Sankey | N investors/companies | Funding rounds, investor relationships |
| 8 | Entity Relationship Network | N entities | Graph edges, co-occurrence, executive overlap |
| 9 | Technology Adoption Curve | N technologies | Tech signals, hiring, patent filings |
| 10 | Diligence Scorecard | 1 entity | Structured diligence output, citations |
| 11 | Sector Performance Treemap | 1000+ entities | Sector classifications, market data |
| 12 | Alert / Anomaly Feed | N entities | Signal change detection, anomaly scoring |
| 13 | Custom Policy Classifier | 50-5000 entities | User-pasted policy + entity signals |
| 14 | Executive Movement Tracker | N entities | Team/executive signals, hiring data |
| 15 | Weekly Intelligence Briefing | Portfolio-wide | 7-day signal aggregation, delta analysis |

### Why artifact > prose at each scale

- **50+ entities**: Prose is useless. Interactive filtering, sorting,
  color-coded coverage status is instantly scannable.
- **Temporal patterns**: Acceleration, clustering, seasonal cycles are
  invisible in prose. Zoomable timelines are essential.
- **Multi-dimensional comparison**: Dense tabular comparison with
  conditional formatting enables scanning 20+ dimensions simultaneously.
- **Network topology**: Clusters, bridges, isolated nodes are impossible
  to describe in text. Interactive graph exploration is essential.
- **Classification at scale**: The intersection of user-defined rules and
  system-held data, rendered as filterable/sortable output.

---

## Section C: The "Pasted Data" Pattern

### UX flow: paste CSV --> classified visualization

1. **Paste/upload** -- Accept CSV/TSV/unstructured lists. Auto-detect
   delimiter and schema.
2. **Preview + schema confirmation** -- Show first 10 rows with detected
   column types. Let user rename/retype columns.
3. **Specify classification rule** -- User types tiering policy (natural
   language, CSV of rules, or formal DSL).
4. **Cross-reference with entity graph** -- Fuzzy-match company names
   against tracked entities. Show match confidence.
5. **Render classified view** -- Interactive tiered table with inline
   rule-match explanations. Export options.

### Entity graph matching approach

- **Exact match** on normalized company names (lowercase, strip Inc/LLC)
- **Fuzzy match** using Levenshtein distance or TF-IDF
- **Enrichment match** using known aliases, parent companies, subsidiaries
- **Confidence scoring** per row, flag ambiguous matches for user review
- **Unmatched** -- offer to create entity stubs or exclude

### Visualizations for 1000+ classified items

- **Treemap** -- Sectors as parents, companies as leaves. Handles 5000+.
- **Heatmap grid** -- Rows = companies, columns = criteria. Virtual scroll.
- **Filterable table** -- AG Grid / TanStack Table handles 100K+ rows.
- **Sunburst chart** -- Hierarchical drill-down. Good for distribution.

---

## Section D: Live Data Feeding Pattern

### Recommended: postMessage protocol

The parent (NodeBench app) sends data to the artifact iframe via
`window.postMessage`. The artifact listens and renders.

```typescript
type ArtifactMessage =
  | { type: 'init', entities: EntitySnapshot[], metadata: ArtifactMetadata }
  | { type: 'update', entityId: string, signals: Signal[] }
  | { type: 'filter', criteria: FilterCriteria }
  | { type: 'request_data', query: DataQuery }
```

**Why postMessage:**
- Works with `sandbox` attribute on iframe
- No CORS issues
- Sub-millisecond latency
- Supports two-way communication
- No build step required
- 20-40% better Core Web Vitals vs iframe src reloading

### Other patterns (ordered by complexity)

| Pattern | When to use | Tradeoff |
|---------|-------------|----------|
| postMessage | Default. Host has the data. | Requires host app. |
| srcdoc injection | Self-contained, offline. | Full re-render on change. |
| Polling | Standalone artifact, API access. | Latency = interval. |
| WebSocket | Real-time, high-frequency. | Overkill for intelligence. |

---

## Section E: Design Inspiration

### Bloomberg Terminal principles
- **Dock-and-link**: Changing security in one panel updates all linked
  panels via "security groups."
- **Information density**: Every pixel carries information. Dark backgrounds,
  high-contrast data, minimal chrome.
- **Page metaphor**: Multiple layouts switchable like browser tabs. Shareable.

### Strategy framework visuals
- **BCG Matrix**: 2x2, bubble size = revenue. Universally understood.
- **GE McKinsey Matrix**: 3x3 with composite weighted axes. 73% of
  Fortune 500 use ML to continuously update (as of 2026).

### Portfolio tiering interfaces
- **Finviz treemap**: 8000+ stocks, color = performance, drill-down.
- **TradingView heatmap**: Color-coded grids, interactive hover.
- **Bloomberg PORT**: Filterable tables with inline sparklines.

### Design DNA for NodeBench artifacts
1. Dark background (`--bg-primary: #151413`), high-contrast data
2. Information density over whitespace -- analysts want density
3. Glass card DNA (`border-white/[0.06] bg-white/[0.02]`) for sub-panels
4. Terracotta `#d97757` for interactive/selected states
5. JetBrains Mono for data, Manrope for labels
6. `@media print` light background variant for board decks

---

## Sources

- Observable HQ, Hex, Evidence.dev, Streamlit, Retool, Quadratic
- Claude Live Artifacts (April 2026), v0.dev/v0.app
- Notion Dashboard Views (March 2026), Airtable Interface Designer
- Bloomberg Terminal UX, BCG/GE McKinsey matrices
- Finviz treemap, D3 hierarchy, Highcharts, Kumu
- Grafana/Metabase/Superset embedding patterns
- web.dev sandboxed iframes, postMessage communication
