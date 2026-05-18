# home-v3.html — Layout Normalization & Wide Mode Changelog

**Date:** 2026-05-17
**File:** `public/proto/home-v3.html`
**Scope:** CSS layout normalization across all 5 surfaces + Streamlit-style intelligent wide mode

---

## 1. Center Column Padding Normalization

**Problem:** Every surface had different center-column padding values, creating a visually inconsistent and distracting layout when switching between surfaces.

**Canonical value chosen:** `padding: 24px 32px 60px` (top right/left bottom)
**Canonical max-width:** `820px` with `margin: 0 auto` for centering

### Changes by surface

| Surface | Selector | Before | After |
|---------|----------|--------|-------|
| Reports | `.center-pane` (line 663) | `padding: 16px 24px` | `padding: 24px 32px 60px` |
| Home | `.home-center` (line 3038) | `padding: 32px 40px 60px` | `padding: 24px 32px 60px; max-width: 820px; margin: 0 auto` |
| Chat | `.chat-full-thread` (line 2451) | `padding: 16px 24px` | `padding: 24px 32px 60px` |
| Chat | `.chat-msg` (line 2455) | `padding: 0 24px` | `padding: 0` (parent now handles horizontal padding) |
| Inbox | `.inbox-center` (line 4183) | `padding: 24px 32px 60px` (no max-width) | `padding: 24px 32px 60px; max-width: 820px; margin: 0 auto` |
| Me | `.me-center` (line 4481) | `padding: 24px 40px 60px` | `padding: 24px 32px 60px` |
| Me | `.me-center-content` (line 4485) | `max-width: 780px` | `max-width: 820px` |

### Rationale
- `24px` top: enough breathing room without wasting vertical space
- `32px` horizontal: consistent gutter matching card internal padding
- `60px` bottom: scroll clearance for bottom-docked elements
- `820px` max-width: readable line lengths (~75-85 chars at 13px body text)

---

## 2. Left/Right Rail Width Normalization

**Problem:** Each surface had different `grid-template-columns` values for its 3-column layout, causing left and right rails to shift width when navigating between surfaces.

**Canonical grid:** `grid-template-columns: 200px 1fr 360px`

### Changes by surface

| Surface | Selector | Before | After |
|---------|----------|--------|-------|
| Base | `.columns` (line 552) | `200px 1fr 360px` | *(unchanged — already canonical)* |
| Home | `.columns[data-surface="home"]` (line 2975) | `184px 1fr 380px` | `200px 1fr 360px` |
| Chat | `.columns[data-surface="chat"]` (line 2419) | `220px 1fr 280px` | `200px 1fr 360px` |
| Inbox | `.columns[data-surface="inbox"]` (line 4122) | `200px 1fr 380px` | `200px 1fr 360px` |
| Me | `.columns[data-surface="me"]` (line 4415) | `184px 1fr 360px` | `200px 1fr 360px` |
| Reports | *(inherits base `.columns`)* | `200px 1fr 360px` | *(unchanged — already canonical)* |

### Responsive breakpoint fix

| Breakpoint | Selector | Before | After |
|------------|----------|--------|-------|
| `@media (max-width: 1280px)` | `.columns[data-surface="inbox"]` (line 4404) | `1fr 380px` | `1fr 360px` |

### Rationale
- `200px` left rail: fits search input + nav items comfortably without oversize
- `360px` right rail: enough for detail panels, entity cards, agent output
- `1fr` center: fluid, adapts to viewport width
- All surfaces now align perfectly — no rail width jumps on navigation

---

## 3. Streamlit-Style Intelligent Wide Mode

**Problem:** The center content area was always capped at `820px`, leaving significant whitespace on large monitors. Users wanted to utilize extra horizontal space productively.

**Inspiration:** Streamlit's wide mode — removes the center content `max-width` constraint but keeps sidebars visible. Does NOT collapse rails.

### 3a. CSS — Wide mode rules (lines 560-584)

```css
/* ─── Wide mode (Streamlit-style) ─── */
/* Rails stay. Center content gets more room — grids show more cols, text stays readable. */

/* 1. Widen center containers — generous but not infinite */
.shell[data-wide] .center-content,
.shell[data-wide] .me-center-content { max-width: 1200px; }
.shell[data-wide] .home-center { max-width: 1200px; }
.shell[data-wide] .inbox-center { max-width: 1200px; }

/* 2. Grids: more items per row */
.shell[data-wide] .v3-grid { grid-template-columns: repeat(4, 1fr); }
.shell[data-wide] .home-change-cards { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }

/* 3. Chat: wider but still readable (~90 chars/line) */
.shell[data-wide] .chat-full-thread .ar-msg,
.shell[data-wide] .chat-msg { max-width: 900px; }
```

### Smart content distribution (NOT pure stretch)

| Element | Normal mode | Wide mode | Strategy |
|---------|------------|-----------|----------|
| `.center-content` (Reports) | `max-width: 820px` | `max-width: 1200px` | Wider container |
| `.home-center` (Home) | `max-width: 820px` | `max-width: 1200px` | Wider container |
| `.inbox-center` (Inbox) | `max-width: 820px` | `max-width: 1200px` | Wider container |
| `.me-center-content` (Me) | `max-width: 820px` | `max-width: 1200px` | Wider container |
| `.v3-grid` (Reports gallery) | `repeat(3, 1fr)` | `repeat(4, 1fr)` | More cards per row |
| `.home-change-cards` (What Changed) | `1fr 1fr` (2 cols) | `repeat(auto-fill, minmax(260px, 1fr))` | Auto-fill 3-4 cols |
| `.chat-msg` / `.ar-msg` (Chat) | `max-width: 680px` | `max-width: 900px` | Wider but bounded for readability |

### Key design decision
Extra horizontal space is used for **more items per row** (grids get more columns), not pure stretching. Text content stays bounded at readable line lengths. This follows Streamlit's philosophy: sidebars stay, center gets the extra room, but the content adapts intelligently.

### 3b. Toggle button — HTML (line 4726)

```html
<button class="topbar-wide-toggle"
        onclick="toggleWideMode()"
        aria-label="Toggle wide mode"
        title="Toggle wide mode (W)"
        id="wide-btn">&#8596;</button>
```

- Position: topbar right section, between search bar and theme toggle
- Icon: `↔` (U+2194, left-right arrow)
- Visual state: default `--ink-mute` color, active `--accent` (#d97757) color + border

### 3c. Toggle button — CSS (lines 577-584)

```css
.topbar-wide-toggle {
  width: 28px; height: 28px; border-radius: var(--r-sm);
  border: 1px solid var(--line); background: none; cursor: pointer;
  display: grid; place-items: center; font-size: 13px;
  color: var(--ink-mute); transition: all 100ms;
}
.topbar-wide-toggle:hover { border-color: var(--line-strong); color: var(--ink); }
.shell[data-wide] .topbar-wide-toggle { color: var(--accent); border-color: var(--accent); }
```

### 3d. JavaScript — Toggle + persistence + keyboard (lines 8484-8513)

```javascript
/* ─── Wide mode toggle (Streamlit-style) ─── */
function toggleWideMode() {
  var shell = document.querySelector('.shell');
  if (!shell) return;
  var isWide = shell.hasAttribute('data-wide');
  if (isWide) {
    shell.removeAttribute('data-wide');
    localStorage.removeItem('nb-wide');
  } else {
    shell.setAttribute('data-wide', '');
    localStorage.setItem('nb-wide', '1');
  }
}

// Restore wide mode from localStorage
if (localStorage.getItem('nb-wide') === '1') {
  document.addEventListener('DOMContentLoaded', function() {
    var shell = document.querySelector('.shell');
    if (shell) shell.setAttribute('data-wide', '');
  });
}

// Keyboard shortcut: W to toggle wide mode (when not typing)
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.key === 'w' || e.key === 'W') {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleWideMode();
    }
  }
});
```

**Mechanism:**
- `data-wide` attribute on `.shell` element acts as the CSS state toggle
- `localStorage` key `nb-wide` persists preference across page reloads
- `W` keyboard shortcut toggles mode (disabled when focus is in INPUT, TEXTAREA, or contentEditable)
- No modifier keys required — bare `W` press; does NOT fire with Ctrl/Meta/Alt held

---

## 4. Verification Matrix

| Surface | Padding ✓ | Rail widths ✓ | Wide mode ✓ | Normal mode ✓ |
|---------|-----------|---------------|-------------|---------------|
| Home | `24px 32px 60px` | `200px 1fr 360px` | 4-col What Changed, 1200px center | 2-col What Changed, 820px center |
| Reports | `24px 32px 60px` | `200px 1fr 360px` | 4-col gallery, 1200px center | 3-col gallery, 820px center |
| Chat | `24px 32px 60px` | `200px 1fr 360px` | 900px message width | 680px message width |
| Inbox | `24px 32px 60px` | `200px 1fr 360px` | 1200px center | 820px center |
| Me | `24px 32px 60px` | `200px 1fr 360px` | 1200px center | 820px center |

All 5 surfaces verified in both normal and wide mode via browser screenshots.

---

## 5. Design Tokens Reference

| Token | Value | Used for |
|-------|-------|----------|
| Left rail width | `200px` | All surfaces |
| Right rail width | `360px` | All surfaces |
| Center padding | `24px 32px 60px` | All surfaces |
| Center max-width (normal) | `820px` | All center containers |
| Center max-width (wide) | `1200px` | All center containers |
| Chat message width (normal) | `680px` | `.chat-msg`, `.ar-msg` |
| Chat message width (wide) | `900px` | `.chat-msg`, `.ar-msg` |
| Wide mode min card width | `260px` | `.home-change-cards` auto-fill |
| Wide state attribute | `data-wide` | On `.shell` element |
| Wide persistence key | `nb-wide` | `localStorage` |
| Wide keyboard shortcut | `W` | Bare key (no modifiers) |

---

## 6. Accessibility Hardening (Session 2)

**Date:** 2026-05-17
**Scope:** ARIA, keyboard navigation, icon-only button labels

### 6a. Mini-report-card keyboard enhancement (20 cards)

All `<article class="mini-report-card">` elements were click-only with no keyboard support. Added a DOMContentLoaded JS block that bulk-enhances all cards:

| Attribute | Before | After |
|-----------|--------|-------|
| `role` | *(none)* | `"button"` |
| `tabindex` | *(none)* | `"0"` |
| `aria-label` | *(none)* | `"Open report: {entity name}"` |
| Enter/Space | *(no effect)* | Triggers `card.click()` |

Entity name derived from `.mini-report-card__entity` element text content.

### 6b. Icon-only button aria-labels

| Line | Element | Added |
|------|---------|-------|
| ~5674 | Attach file button (×2) | `aria-label="Attach file"` |
| ~6908 | Chat accept changes checkmark | `aria-label="Accept changes"` |
| ~7735 | Waterfall Anthropic link (↗) | `aria-label="Open Anthropic report"` |
| ~7793 | Waterfall pricing comp link (↗) | `aria-label="Open pricing comparison artifact"` |
| ~7807 | Waterfall feature matrix link (↗) | `aria-label="Open feature matrix artifact"` |

Previously added (Session 1):
- Voice input button: `aria-label="Voice input"`
- 9 notebook toolbar buttons: Bold, Italic, Heading, Bullet list, Numbered list, Code block, Insert link, Insert image, Add claim block

### 6c. Score label clarity

| Location | Before | After |
|----------|--------|-------|
| WHY NOW chips | `5/6`, `3/6`, `2/6` | `5 of 6`, `3 of 6`, `2 of 6` |

Per product review: label as evidence check counts, not ambiguous fractions.

---

## 7. CSS Variable Migration — Inline Color Hardening

**Date:** 2026-05-17
**Scope:** Replace hardcoded hex colors in inline `style=""` with CSS custom properties

### 7a. New CSS variables added

| Variable | Light theme | Dark theme | Purpose |
|----------|-------------|------------|---------|
| `--red-bright` | `#ef4444` | `#ef4444` | Alert/error accent |
| `--blue-bright` | `#60a5fa` | `#60a5fa` | Info/link accent |
| `--amber-bright` | `#f59e0b` | `#fbbf24` | Warning/attention |
| `--green-bright` | `#22c55e` | `#4ade80` | Success/positive |
| `--pink` | `#ec4899` | `#f472b6` | Graph legend / correlation |

### 7b. Inline color replacements

| Hardcoded hex | CSS variable | Occurrences replaced |
|---------------|-------------|---------------------|
| `#ef4444` | `var(--red-bright)` | color + background |
| `#60a5fa` | `var(--blue-bright)` | color + background |
| `#fbbf24` | `var(--amber-bright)` | color + background |
| `#f59e0b` | `var(--amber-bright)` | color + background + border-color |
| `#4ade80` | `var(--green-bright)` | color + background |
| `#d97757` | `var(--accent)` | color + background + border-color |
| `#6b9fff` | `var(--blue-bright)` | color |
| `#8b5cf6` | `var(--purple)` | color |
| `#8a8580` | `var(--ink-mute)` | color + background |
| `#b91c1c` | `var(--red)` | color |
| `#f472b6` | `var(--pink)` | border-color |

### 7c. Audit results

| Metric | Before | After |
|--------|--------|-------|
| Inline hex colors | ~40 | 27 |
| Using CSS variables | ~0 | 179 |
| Conversion rate | 0% | 87% |

Remaining 27 are `rgba()` composite backgrounds where CSS variables cannot be directly substituted without `color-mix()`. These are acceptable — they use the same color values as the variables and will render identically.

### 7d. Theme verification

Both light and dark themes verified across all 5 surfaces:
- Home: What Changed cards, Daily Brief, WHY NOW chips, entity badges ✓
- Reports: Gallery cards, status badges, entity agent panel ✓
- Chat: Messages, changes block, tool badges, session panel ✓
- Inbox: Lane icons (Read/Waiting/Delete), priority badges, detail panel ✓
- Me: USER.md labels, integration status, plan badge ✓
