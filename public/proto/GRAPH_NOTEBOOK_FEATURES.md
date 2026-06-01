# Graph Notebook Features — home-v3.html Prototype

Implemented in `public/proto/home-v3.html` as pure HTML/CSS/JS.
These features are the prototype for the expandable graph notebook
described in `docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md`.

## Prior art

- **Roam Research** — bidirectional backlinks, block references, outliner-first editing
- **Notion** — `@mention` inline references with hover previews
- **Obsidian** — local graph view, backlinks panel

---

## 1. Source Citation Popovers

**What:** Clicking `[src:N]` badges shows a positioned popover with source metadata.

**Behavior:**
- Click `[src:1]` -> popover appears near the badge
- Shows: title, URL (linked), excerpt, date + type
- Click elsewhere or another interactive element -> popover dismisses
- Only one popover active at a time (`activeSrcPop` singleton)

**Key function:** `showSourcePop(badge)` (~line 8038)

**Data:** `SOURCE_DATA` object keyed by source number:
```javascript
SOURCE_DATA = {
  1: { title, url, excerpt, date, type },
  ...
}
```

**Dismiss fix:** `toggleMentionExpand()` and `toggleWikiExpand()` both
clean up `activeSrcPop` at entry, preventing stale popovers when
`stopPropagation` blocks the document-level dismiss listener.

---

## 2. Mention Expansion (@entity)

**What:** Clicking `@Company` or `@Person` chips expands an inline entity
reference block below the mention.

**Chip types:**
- `@Company` — terracotta accent (`var(--accent)`)
- `@Person` — purple (`#a78bfa`)

**Expansion block contains:**
- Entity header: avatar + name + type + source count + claim count + status badge
- Summary paragraph
- Cited claims with `[src:N]` badges (clickable — opens source popovers)
- Graph edges: relation type + entity name (e.g., "competes with @Google DeepMind")
- Action buttons: "Expand with agent", "Open report", "N backlinks"

**Key function:** `toggleMentionExpand(mention)` (~line 7891)

**Data:** `MENTION_DATA` object keyed by entity ID:
```javascript
MENTION_DATA = {
  anthropic: { name, type, summary, claims[], edges[], backlinks },
  openai: { ... },
  ...
}
```

---

## 3. Wiki Link Expansion ([[topic]])

**What:** Clicking `[[topic]]` links expands an inline topic reference with
definition and related entities.

**Styling:** Cyan accent border-left, diamond icon header.

**Expansion block contains:**
- Topic name with diamond icon
- Close button
- Definition/description paragraph
- Related references section (analytical context from the notebook)
- Topic tags as pill buttons

**Key function:** `toggleWikiExpand(mention)` (~line 8099)

**Data:** `WIKI_DATA` object keyed by topic slug:
```javascript
WIKI_DATA = {
  'pricing-power': { name, definition, references[], tags[] },
  'cap-table-analysis': { ... },
  ...
}
```

---

## 4. Recursive Agent Expansion

**What:** Clicking "Expand with agent" inside a mention expansion block
triggers a simulated 4-step agent deep dive.

**Simulation steps (timed progression):**
1. "Searching Linkup for {entity}..." (0.8s)
2. "Fetching 3 pages (Reuters, TechCrunch, Bloomberg)..." (1.2s)
3. "Extracted 6 new claims, 2 verified..." (1s)
4. "Expansion complete - 4 new claims added" (final state)

**New claims appended** with `[src:new]` badges and green "new" tags.

**Depth limiting:** `MAX_EXPAND_DEPTH = 3` prevents infinite recursion
when expanded entities contain clickable mentions.

**Key function:** Inside `toggleMentionExpand()`, the "Expand with agent"
button onclick handler.

---

## 5. Backlinks Section

**What:** Below the notebook content, a backlinks section shows all entities
and reports that reference the current entity.

**Relation types:** MENTIONS, COMPETES, CITES, FOUNDER_OF, RELATED

**Each backlink shows:**
- Title (report or entity name)
- Excerpt with context
- Relation type badge (color-coded)

---

## 6. Right Rail — Entity Context Card

**What:** Fills the dead space at the top of the right rail `.ar-thread`
with an entity summary card.

**Contains:**
- Entity avatar + name + verified badge
- Type line (e.g., "AI safety . San Francisco . Series E")
- 4-metric grid: Claims verified, Sources, Last refreshed, Confidence
- Connected entities with color-coded relationship dots

**CSS classes:** `.ar-entity-ctx`, `.ar-entity-ctx-avatar`,
`.ar-entity-ctx-metrics`, `.ar-entity-ctx-graph`, `.ar-entity-ctx-edges`

---

## 7. Right Rail — Entity-Contextual Chat

**What:** The right rail chat thread is contextual to the open notebook entity.

**Contains:**
- System event: "Notebook opened . Anthropic"
- Agent: "Report health: strong" with tool badges
- User: "Are any claims at risk of going stale?"
- Agent: "2 claims expiring soon" with freshness details
- Action chips: "Refresh expiring sources", "Verify all claims", "Export memo"
- System event: "9 mentions . 5 backlinks"

**Input placeholder:** "Ask about Anthropic..."

---

## Event Delegation Architecture

All interactive elements use event delegation from a single document-level
listener. Key coordination:

- `e.stopPropagation()` on source badges prevents document click from
  immediately dismissing the popover
- Mention/wiki handlers explicitly clean up `activeSrcPop` before expanding
- Each expansion type uses a `data-expanded` attribute to track toggle state
- Expansion blocks are inserted via `insertAdjacentHTML('afterend', html)`

---

## Design Tokens

| Element | Color | CSS |
|---------|-------|-----|
| @Company mention | Terracotta | `var(--accent)` / `#d97757` |
| @Person mention | Purple | `#a78bfa` |
| [[wiki]] link | Cyan | `#67e8f9` |
| #tag | Grey | `var(--ink-faint)` |
| [src:N] badge | Muted | `var(--line-faint)` bg |
| Entity context card | Glass | `color-mix(in srgb, var(--ink) 3%, transparent)` |
| Verified badge | Green | `var(--green)` |

---

## File

All implementation is in `public/proto/home-v3.html` (single-file prototype).
Architecture spec for React/Convex migration: `docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md`.
