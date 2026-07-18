# NodeBench Agents declutter sweep

Production target: `https://www.nodebenchai.com/agents`

Scope: read-only visual audit of the Agents workspace and unopened-thread FastAgentPanel. No AI prompt was submitted and no product data was changed.

## Evidence

- `agents-desktop-light.png`, `agents-desktop-dark.png`
- `agents-tablet-light.png`, `agents-tablet-dark.png`
- `agents-mobile-light.png`, `agents-mobile-dark.png`
- `fast-panel-desktop-light.png`, `fast-panel-desktop-dark.png`
- `fast-panel-mobile-light.png`, `fast-panel-mobile-dark.png`

The six workspace captures rendered in UTF-8 with zero console errors, zero mojibake, and zero document-level horizontal overflow. Compact captures intentionally omit the desktop `NodeBench` label. Both emulated themes visibly rendered.

Machine observations:

- Desktop Agents DOM: 6,067 characters, 36 visible interactive elements, 27 visible buttons, and 11 visible headings.
- The public topic canvas contains two identical `Reply with exactly TIER_OK and nothing else.` headings.
- At `390x844`, the workspace command group occupies `y=204.5..431.5` (227px), while `TopicCanvasPanel` starts at `y=452.5` and is 3,381px tall.
- At `390px` wide, the `Roadmap` tab ends at `x=435.3`; roughly 45px is clipped despite document overflow reporting false.
- Empty FastAgentPanel exposes 11 visible buttons on desktop and 15 on mobile. Mobile adds a second four-command suggestion set above the composer.

## Findings

### 1. P1 — Passive onboarding dominates the live topic canvas

Evidence: `TopicCanvasPanel` renders the non-interactive pill-like spans `TOPIC-FIRST WORKSPACE` and `Topics, not sessions`, a two-sentence explanation, three metric cards, then three explainer cards (`Canvas memory`, `Hot-plug resources`, `Self-directed next move`) before live work. The two pills have no interactive ancestor although they look like controls. See all six workspace captures and `src/features/agents/components/TopicCanvasPanel.tsx`.

Smallest fix: remove the three explainer cards and the `Topics, not sessions` pseudo-control. Keep one compact status line: `6 topics · 0 with sources · 0 need attention`, with a quiet `What is a topic?` disclosure for first-time help.

### 2. P1 — Each topic card repeats a full three-column brochure

Evidence: every `article.rounded-2xl` repeats passive bordered blocks for `MEMORY`, `RESOURCES`, and `NEXT ACTION`, then repeats another explanatory footer before the only action, `Open trace`. On mobile the panel is 3,381px tall for six topics. See tablet/mobile captures.

Smallest fix: make each topic a compact row/card with title, status, timestamp, and one next action. Render memory/resources as inline metadata only when present; move prose to the trace/detail disclosure.

### 3. P1 — Duplicate topics are visually indistinguishable

Evidence: desktop shows two simultaneous cards titled exactly `Reply with exactly TIER_OK and nothing else.`, both labeled `Queued`, with the same summary and metadata. DOM count is two; neither card exposes time, model, run, or owner as a discriminator.

Smallest fix: dedupe by canonical thread/run identity before rendering. If both are legitimate, group them or add a compact timestamp plus run/model identity so repeated titles remain scannable.

### 4. P1 — Mobile hub tabs are clipped without an overflow affordance

Evidence: `nav[aria-label="Primary hubs"]` presents five equal-weight tabs. At 390px, `Roadmap` ends at `x=435.3` and is visibly cut off while the document claims no horizontal overflow. The scrollbar is deliberately hidden. See both mobile workspace captures.

Smallest fix: below `sm`, show only the active hub plus a chevron/overflow menu. A secondary choice should not consume a permanently clipped horizontal rail.

### 5. P1 — FastAgent empty state has two competing suggestion systems

Evidence: the panel first renders four large prompt cards (`What gaps...`, `Should I build...`, `weekly founder reset`, `competitors shipped`). Mobile then renders another four commands (`Daily Brief`, `Run Diligence`, `Compare`, `Market Scan`) above the composer. Empty mobile therefore exposes 15 buttons before any conversation. See `fast-panel-mobile-*.png`, `FastAgentPanel.tsx`, and `QuickCommandChips.tsx`.

Smallest fix: keep one suggestion system with at most three context-aware prompts, in one horizontally scrollable row beneath the composer. Delete the other starter grid.

### 6. P1 — Opening FastAgentPanel fires a large false-transition toast

Evidence: every fresh panel mount triggers `Switched to Agent Streaming mode`, obscuring the header on desktop and mobile before the user changes a mode. Root cause is the `useEffect(..., [chatMode])` in `FastAgentPanel.tsx`, which toasts on initial mount as well as real changes.

Smallest fix: suppress the first effect execution with a mounted ref, or move the toast into the explicit mode-change handler. Opening a panel should not announce a switch that did not happen.

### 7. P2 — Empty panel advertises a useless `Sources` destination

Evidence: the top `Answer / Sources` segmented control occupies a large band even when there is no thread, answer, or source. `Sources` cannot reveal useful content in the captured state.

Smallest fix: hide the segmented control until a response contains sources. In the empty state, make the composer the first focusable content after the header.

### 8. P2 — FastAgent explains itself four times before accepting intent

Evidence: the empty panel stacks `Same chat surface...`, `Workspace chat`, `Ask directly or pick a starting point`, and `Same conversation feel...`. The desktop drawer has substantial blank space; mobile pushes the composer to the bottom after this copy and the suggestion cards.

Smallest fix: retain `Ask NodeBench` in the header and one concise placeholder in the composer. Remove the badge, hero title, and both explanatory sentences.

### 9. P2 — Persistent shell chrome competes with task content

Evidence: desktop simultaneously shows `NODEBENCH / Agents`, the sidebar brand/tagline, `Ready · NodeBench`, a live clock, and the floating `Object-first mode` pill. The floating pill sits over the lower card/action region. See desktop captures and `CockpitLayout.tsx`.

Smallest fix: remove the bottom trace bar when idle, keep only one brand location, and move object/legacy layout selection into settings or the composer mode menu.

### 10. P2 — Borders and pills flatten hierarchy

Evidence: active hub, suggestion actions, composer, topic canvas, metrics, explainer blocks, topic cards, subcards, status chips, `Open trace`, mode selectors, FastAgent tabs, starter cards, command chips, and composer controls all use bordered rounded containers. Passive and actionable elements therefore receive nearly identical visual weight in both themes.

Smallest fix: reserve bordered surfaces for input, selection, warning, and the currently active item. Render passive summaries as typography/dividers, use one active-state cue instead of dot + ring + fill + shadow, and reduce nested radii by one level.

## Focused score

- B9 Visual craft: **1/2** — both themes are coherent and readable, but hierarchy is flattened by over-cardification and repeated explanation.
- B11 Progressive disclosure: **0/2** — first intent is surrounded by onboarding, duplicate suggestions, empty proof surfaces, and persistent operator chrome.

Recommended first sweep: findings 1, 2, 5, and 6. Together they remove the most vertical weight without changing backend contracts or runtime behavior.
