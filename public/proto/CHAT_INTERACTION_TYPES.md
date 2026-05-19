# Chat Interaction Types — Display Behavior Matrix

Reference catalog for all chat interaction types in `home-v3.html`.
Each entry documents the CSS classes, HTML structure, visual behavior, and user affordances.

---

## 1. Quick Q&A (Factual Answer)

**User intent:** Single factual question expecting a concise answer.

| Property | Value |
|----------|-------|
| User bubble | `.chat-msg.chat-msg--user > .chat-user-bubble` |
| Agent response | `.chat-msg.chat-msg--agent` with `.chat-inline-answer` |
| Agent trace | `.chat-step` (single step) |
| Key CSS | `.chat-inline-answer { font-size:13px; font-weight:550; }` |
| Source badge | `.chat-answer-source { font-size:10px; color:var(--accent); }` |
| Visual | No card, no border accent. Inline bold answer with small source tag. Fastest visual footprint. |
| Affordances | Source link clickable. No action buttons. |

```html
<div class="chat-msg chat-msg--user"><div class="chat-user-bubble">...</div></div>
<div class="chat-msg chat-msg--agent">
  <div class="chat-step"><span class="chat-step-icon">...</span> ...</div>
  <p class="chat-inline-answer">Answer text <span class="chat-answer-source">Source</span></p>
</div>
```

---

## 2. Comparison Table

**User intent:** Side-by-side comparison of 2+ entities on multiple dimensions.

| Property | Value |
|----------|-------|
| User bubble | `.chat-msg.chat-msg--user > .chat-user-bubble` |
| Agent response | `.chat-msg.chat-msg--agent` (prose intro) + `.chat-comparison` (table) |
| Agent trace | `.chat-step` (multi-step with cost) |
| Key CSS | `.chat-comparison { border:1px solid var(--line-faint); border-radius:var(--r); }` |
| Table header | `th { font-size:9px; uppercase; letter-spacing:0.06em; }` |
| Value colors | `.val-hi` (green), `.val-mid` (yellow), `.val-lo` (red) |
| Visual | Full-width table card. Color-coded values for quick scanning. |
| Affordances | Table is scrollable on overflow. Preview button on associated changes block. |

```html
<div class="chat-comparison">
  <table>
    <tr><th></th><th>Entity A</th><th>Entity B</th></tr>
    <tr><td>Dimension</td><td class="val-hi">Good</td><td class="val-lo">Bad</td></tr>
  </table>
</div>
```

---

## 3. Proactive Alert (Agent-Initiated)

**User intent:** None — agent pushes an alert based on a monitored condition.

| Property | Value |
|----------|-------|
| Agent message | `.ar-msg.ar-msg--agent.ar-msg--alert` |
| Badge | `.ar-msg-alert-badge` with pulsing dot `::before` |
| Border | Left: `2px solid #fbbf24` (amber) |
| Animation | `@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }` on badge dot |
| Changes block | `.chat-changes` with signal counts |
| Visual | Amber left border + pulsing amber dot = urgency without alarm. Distinguished from user-requested content. |
| Affordances | Preview button opens artifact panel. Dismiss button available. |

```html
<div class="ar-msg ar-msg--agent ar-msg--alert">
  <div class="ar-msg-alert-badge">ALERT</div>
  <div class="ar-msg-text"><p>Alert explanation...</p></div>
</div>
<div class="chat-changes">...</div>
```

---

## 4. Error / Partial Failure

**User intent:** Batch operation where some items succeed and some fail.

| Property | Value |
|----------|-------|
| Agent message | `.ar-msg.ar-msg--agent.ar-msg--error` |
| Badge | `.ar-msg-error-badge { color:#ef4444; }` |
| Border | Left: `2px solid #ef4444` (red) |
| Result card | `.chat-partial-result` with `.chat-partial-item` rows |
| Success items | `.chat-partial-ok { color:var(--green); }` with checkmark |
| Failure items | `.chat-partial-fail { color:#ef4444; }` with ✗ |
| Retry notice | `.chat-partial-retry { color:#fbbf24; font-style:italic; }` |
| Visual | Red left border on agent message. Card below shows each item with pass/fail icon. Retry info in amber italic. |
| Affordances | Retry notices include scheduled time or action needed. |

```html
<div class="ar-msg ar-msg--agent ar-msg--error">
  <div class="ar-msg-error-badge">PARTIAL FAILURE</div>
  <div class="ar-msg-text"><p>Explanation...</p></div>
</div>
<div class="chat-partial-result">
  <div class="chat-partial-item chat-partial-ok">&#10003; Success item</div>
  <div class="chat-partial-item chat-partial-fail">&#10007; Failed item</div>
  <div class="chat-partial-retry">  Scheduled retry: ...</div>
</div>
```

---

## 5. Multi-Turn Refinement

**User intent:** Iterative narrowing — user sends follow-ups to adjust prior output.

| Property | Value |
|----------|-------|
| Structure | Multiple `chat-msg--user` + `chat-msg--agent` pairs in sequence |
| Agent trace | Each response has its own `.chat-step` chain |
| Updated artifact | `.chat-changes` block with `+N / -N` line counts |
| Visual | No special styling — uses standard user/agent bubble alternation. The refinement is visible through conversational flow. |
| Affordances | Undo button on changes block. Preview button to see updated artifact. |
| Key behavior | Each agent response references the prior context. Changes block shows incremental diffs. |

```html
<div class="chat-msg chat-msg--user"><div class="chat-user-bubble">Narrow to X</div></div>
<div class="chat-msg chat-msg--agent"><div class="chat-step">...</div><p>Done...</p></div>
<div class="chat-msg chat-msg--user"><div class="chat-user-bubble">Also add Y</div></div>
<div class="chat-msg chat-msg--agent"><div class="chat-step">...</div><p>Added...</p></div>
<div class="chat-changes"><!-- updated artifact with diff counts --></div>
```

---

## 6. Document Generation (Memo)

**User intent:** Create a structured document (IC memo, report, brief).

| Property | Value |
|----------|-------|
| Agent trace | Multi-step: research → cross-reference → draft. `.chat-step` chain with cost |
| Changes block | `.chat-changes` with accent-tinted icon and "New document created" title |
| File ext badge | `.chat-changes-file-ext--doc` (doc-specific color) |
| Actions | "Dismiss" + "Open in Reports" (primary) |
| Visual | Standard agent response with longer multi-step trace showing depth of work. Changes card has warm accent icon tint (`rgba(217,119,87,0.1)`). |
| Affordances | Open in Reports navigates to full document editor. Dismiss removes the card. |

```html
<div class="chat-msg chat-msg--agent">
  <div class="chat-step">...</div><!-- multiple steps -->
  <p>Document description...</p>
</div>
<div class="chat-changes">
  <div class="chat-changes-head">
    <span class="chat-changes-icon" style="background:rgba(217,119,87,0.1);color:#d97757">&#9998;</span>
    <span class="chat-changes-title">New document created</span>
    ...
  </div>
</div>
```

---

## 7. Disambiguation / Clarification

**User intent:** Ambiguous query that matches multiple entities.

| Property | Value |
|----------|-------|
| Agent message | `.chat-msg.chat-msg--agent.chat-msg--clarification` |
| Border | Left: `2px solid var(--accent)` (terracotta) |
| Chips | `.chat-disambig-chips` flex container with `.chat-disambig-chip` buttons |
| Chip hover | `border-color:var(--accent); color:var(--accent); background:color-mix(...)` |
| Visual | Terracotta left border signals "needs input." Rounded pill chips with entity name + descriptor. |
| Affordances | Clicking a chip selects that entity and continues the conversation. |

```html
<div class="chat-msg chat-msg--agent chat-msg--clarification">
  <p>Found N entities matching "X". Which one?</p>
  <div class="chat-disambig-chips">
    <button class="chat-disambig-chip">Entity A &middot; Type</button>
    <button class="chat-disambig-chip">Entity B &middot; Type</button>
  </div>
</div>
```

---

## 8. Code / Data Export

**User intent:** Export structured data in a specific format (JSON, CSV, etc.).

| Property | Value |
|----------|-------|
| Agent response | `.chat-msg.chat-msg--agent` (prose) |
| Code block | `.chat-code-block` with `.chat-code-head` + `.chat-code-body` |
| Language badge | `.chat-code-lang { font-size:9px; uppercase; }` |
| Copy button | `.chat-code-copy` in header |
| Syntax colors | `.ck` (comment/gray), `.cs` (string/terracotta), `.cn` (number/blue), `.cv` (value/green) |
| Background | `#0c0c0d` (near-black, distinct from panel bg) |
| Visual | Dark code container with syntax highlighting. Monospace font. Horizontal scroll on overflow. |
| Affordances | Copy button copies content to clipboard. Language badge identifies format. |

```html
<div class="chat-code-block">
  <div class="chat-code-head">
    <span class="chat-code-lang">json</span>
    <button class="chat-code-copy">Copy</button>
  </div>
  <div class="chat-code-body">
    { <span class="cs">"key"</span>: <span class="cv">"value"</span>, <span class="cs">"n"</span>: <span class="cn">42</span> }
  </div>
</div>
```

---

## 9. Source Verification

**User intent:** Fact-check a specific claim against known sources.

| Property | Value |
|----------|-------|
| Card | `.chat-verify-card` with `.chat-verify-claim` header |
| Rows | `.chat-verify-row` with badge + description + source |
| Badge: verified | `.chat-verify-badge--verified` green bg/border/text |
| Badge: partial | `.chat-verify-badge--partial` amber bg/border/text |
| Badge: contradicts | `.chat-verify-badge--unverified` red bg/border/text |
| Source label | `.chat-verify-source { font-family:var(--mono); }` |
| Visual | Card lists each source with color-coded verification status. Claim quoted at top. |
| Affordances | Each row is a scannable unit. Badge + source pair enables trust calibration. |

```html
<div class="chat-verify-card">
  <div class="chat-verify-claim">"Claim text"</div>
  <div class="chat-verify-row">
    <span class="chat-verify-badge chat-verify-badge--verified">verified</span>
    <span>Evidence text</span>
    <span class="chat-verify-source">SourceName</span>
  </div>
</div>
```

---

## 10. Scheduling / Monitoring

**User intent:** Set up an ongoing monitor or alert for a condition.

| Property | Value |
|----------|-------|
| Card | `.chat-schedule` with accent-tinted border and background |
| Icon | `.chat-schedule-icon` (clock emoji, flex-shrink:0) |
| Text | `.chat-schedule-text` with `<strong>` for key fields |
| Border | `1px solid color-mix(in srgb, var(--accent) 20%, transparent)` |
| Background | `color-mix(in srgb, var(--accent) 3%, transparent)` |
| Visual | Warm-tinted card distinct from data cards. Clock icon + structured details. |
| Affordances | Read-only confirmation. Future: edit/cancel controls. |

```html
<div class="chat-schedule">
  <div class="chat-schedule-icon">&#128337;</div>
  <div class="chat-schedule-text">
    <strong>Monitor active:</strong> Target<br>
    Frequency: ... &middot; Threshold: ... &middot; Alert: ...<br>
    Next check: ...
  </div>
</div>
```

---

## 11. Summary / Digest

**User intent:** Get a synthesized overview of recent activity.

| Property | Value |
|----------|-------|
| Agent trace | Multi-step synthesis trace with entity/signal counts |
| Changes block | `.chat-changes` with blue-tinted star icon |
| Icon tint | `background:rgba(96,165,250,0.1); color:#60a5fa` |
| Actions | "Share" + "Open digest" (primary) |
| Visual | Similar to document generation but with informational (blue) icon tint instead of action (terracotta). |
| Affordances | Share exports the digest. Open digest navigates to full report. |

```html
<div class="chat-changes">
  <div class="chat-changes-head">
    <span class="chat-changes-icon" style="background:rgba(96,165,250,0.1);color:#60a5fa">&#9733;</span>
    <span class="chat-changes-title">Weekly digest ready</span>
    <span class="chat-changes-summary"><span>N entities</span> <span class="chat-changes-count chat-changes-count--signals">N signals</span></span>
    <div class="chat-changes-actions">
      <button class="chat-changes-btn">Share</button>
      <button class="chat-changes-btn chat-changes-btn--primary">Open digest</button>
    </div>
  </div>
</div>
```

---

## 12. Follow-Up with Context Carry

**User intent:** Reference earlier conversation context in a new question.

| Property | Value |
|----------|-------|
| Agent trace | `.chat-step` with "Used context from N earlier messages" |
| Agent response | Standard `.chat-msg.chat-msg--agent` with `<em>` for emphasis |
| Visual | No special card or styling. The trace step explicitly calls out context reuse. Emphasis (`<em>`) highlights the new insight derived from cross-referencing. |
| Affordances | None specific — the value is in the response quality, not UI affordance. |
| Key behavior | Agent explicitly states which prior messages it referenced. Response synthesizes across multiple earlier data points. |

```html
<div class="chat-msg chat-msg--agent">
  <div class="chat-step"><span class="chat-step-icon">...</span> Used context from 3 earlier messages</div>
  <p>Based on the data we pulled earlier... <em>key insight</em>...</p>
</div>
```

---

## Shared Components

### User Bubble
```css
.chat-msg--user { display:flex; flex-direction:column; align-items:flex-end; padding:0 24px; }
.chat-user-bubble { background:color-mix(in srgb, var(--accent) 12%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 20%, transparent);
  border-radius:14px 14px 4px 14px; padding:8px 14px;
  font-size:13px; max-width:480px; }
```

### Agent Trace Steps
```css
.chat-step { display:flex; align-items:center; gap:5px; font-size:11px;
  color:var(--ink-faint); font-family:var(--mono); }
.chat-step-icon { font-size:8px; opacity:0.5; }
/* ▸ = active step, ◦ = summary/cost step */
```

### Changes Block (Artifact Card)
```css
.chat-changes { max-width:680px; width:100%; margin:8px auto 0; }
.chat-changes-head { display:flex; align-items:center; gap:8px; ... }
.chat-changes-btn--primary { background:var(--accent); color:white; }
/* Icon tints: terracotta = action/edit, blue = informational/digest */
```

### Sticky Composer
```css
.chat-composer { position:sticky; bottom:0; z-index:5;
  background:var(--panel); border-top:1px solid var(--line-faint); }
```

---

## Layout Rules

| Rule | Value |
|------|-------|
| Content max-width | `680px` (all content types) |
| Content centering | `margin: 0 auto` |
| Scroll context | Single scroll on `.chat-main` (not per-section) |
| User bubble max-width | `480px` (right-aligned) |
| Composer position | `sticky; bottom:0` (always visible) |
| Review panels (on chat) | `position:absolute; inset:0; z-index:20` (overlay within chat) |
| Review panels (cross-surface) | `position:fixed; top:0; right:0; bottom:0; z-index:51` (overlay on any surface) |
| Gap between messages | `12px` (within `.chat-full-thread`) |
| Interaction type spacing | `margin-top:16px` on first user bubble of each type |
| Chat header | `position:sticky; top:0; z-index:10; background:var(--panel)` |

---

## Close Button Behavior

All review panel close buttons use `×` (&#10005;) — not `←`.

The `←` back arrow lives in `.chat-main-head` and is **context-aware**:
1. If any `.chat-review.open` panel exists → closes the preview panel
2. If no preview is open → navigates back to thread list

Escape key closes any open review panel (works from any surface).

```html
<button class="chat-main-back" id="chat-context-back" aria-label="Back" title="Back to threads">&#8592;</button>
```

```css
.chat-main-back { width:28px; height:28px; border-radius:var(--r-sm);
  border:1px solid var(--line); background:none; cursor:pointer;
  display:grid; place-items:center; font-size:14px; color:var(--ink-mute); }
.chat-main-back:hover { border-color:var(--line-strong); color:var(--ink); background:var(--muted); }
```

---

## Cross-Surface Artifact Panel

Artifact previews can open from **any surface** (Reports, Home, etc.) without navigating to Chat.

| Property | Value |
|----------|-------|
| Trigger | Click `[data-artifact-card]` strip on any surface |
| Shell attribute | `.shell[data-artifact-open]` set on open, removed on close |
| Origin tracking | `#review-artifact[data-origin-surface]` stores the launching surface |
| Panel position | `position:fixed; top:0; right:0; bottom:0; width:var(--artifact-panel-width, 50%)` |
| Chat columns | `display:block !important; visibility:hidden` (layout-present but invisible) |
| Panel override | `visibility:visible; pointer-events:auto` (child overrides parent visibility) |
| On chat surface | Normal `position:absolute; z-index:20` (no fixed overlay needed) |
| Close methods | `×` button, Escape key, `←` back button (when on Chat) |
| Cleanup | `cleanupPanelClose()` removes `data-artifact-open`, `data-origin-surface`, `.open`, `.show-editor` |

**Key CSS technique:** A parent with `visibility:hidden` allows children to override with `visibility:visible`, unlike `display:none` which hides all descendants unconditionally. This lets the artifact panel (inside `.columns[data-surface="chat"]`) render as a fixed overlay while keeping the chat content invisible.

```css
/* Non-chat surface: chat columns are layout-present but invisible */
.shell[data-artifact-open] .columns[data-surface="chat"] {
  display:block !important; position:fixed; inset:0; z-index:50;
  pointer-events:none; visibility:hidden;
}
/* The artifact panel itself becomes visible */
.shell[data-artifact-open] .columns[data-surface="chat"] #review-artifact {
  visibility:visible; pointer-events:auto; z-index:51;
  position:fixed; top:0; right:0; bottom:0;
  width:var(--artifact-panel-width, 50%); min-width:320px;
}
/* Neutralizer: on chat surface, use normal layout */
.shell[data-active="chat"][data-artifact-open] .columns[data-surface="chat"] {
  display:grid !important; position:relative; visibility:visible; pointer-events:auto;
}
```

---

## Color Semantics

| Color | Hex | Meaning | Used in |
|-------|-----|---------|---------|
| Green | `var(--green)` / `#4ade80` | Success, verified, positive | Partial OK, verify badge, comparison `.val-hi` |
| Amber | `#fbbf24` | Warning, partial, pending | Alert border/badge, partial retry, verify partial, comparison `.val-mid` |
| Red | `#ef4444` | Error, failure, contradiction | Error border/badge, partial fail, verify unverified, comparison `.val-lo` |
| Terracotta | `var(--accent)` / `#d97757` | Action, user input, brand | User bubble, clarification border, schedule card, CTA buttons |
| Blue | `#60a5fa` | Informational, search, digest | Digest icon, code number values, trace search icon |
| Purple | `#a78bfa` | LLM/AI operations | Trace LLM step icon |
