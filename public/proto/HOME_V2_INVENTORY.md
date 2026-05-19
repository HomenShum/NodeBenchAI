# Home v2 HTML Architecture Inventory

**Purpose**: Complete reference for replicating home-v2.html patterns in home-v3.html.

## 1. CSS CUSTOM PROPERTIES (Design Tokens)

### Color System - Light Mode (:root)
```
--paper: #faf9f7              (page background)
--panel: #ffffff              (primary surface)
--ink: #1a1916                (primary text)
--accent: #d97757             (brand orange)
--accent-soft: rgba(217,119,87,0.10)
--accent-tint: rgba(217,119,87,0.06)
--green: #1f7a3a
--green-bg: #e8f7ee
--blue: #2348b8
--blue-bg: #e8efff
--amber: #b26200
--amber-bg: #fff3e0
--line-faint: rgba(21,20,15,0.05)
--line: rgba(21,20,15,0.10)
```

### Spacing & Sizing
```
--r-sm: 6px          (small radius)
--r: 10px            (default radius)
--r-lg: 16px         (large radius)
--r-pill: 999px      (fully rounded)
```

### Typography
```
--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
--mono: 'JetBrains Mono', monospace
--ease: cubic-bezier(0.16, 1, 0.3, 1)
```

## 2. LAYOUT STRUCTURE

### Top-Level Shell
```html
<div class="shell" data-surface="home|reports|chat|inbox|me">
  <header class="topbar">...</header>
  <div class="columns">
    <aside class="col col-left">...</aside>
    <main class="col col-center">...</main>
    <aside class="col col-right">...</aside>
  </div>
</div>
```

### Key Classes
```
.shell: height: 100dvh; display: flex; flex-direction: column;
.columns: grid-template-columns: 184px 1fr 400px;
.col-center: padding: 28px 48px 60px; max-width: 820px;
```

## 3. SURFACE SWITCHING (data-surface / data-sp)

**Mechanism**: Hide all surfaces by default, show matching data-sp when parent data-surface matches.

```css
.surface-panel, .surface-flex { display: none !important; }

[data-surface="home"] .surface-flex[data-sp="home"],
[data-surface="reports"] .surface-flex[data-sp="reports"],
[data-surface="chat"] .surface-flex[data-sp="chat"],
[data-surface="inbox"] .surface-flex[data-sp="inbox"],
[data-surface="me"] .surface-flex[data-sp="me"] { 
  display: flex !important; 
}
```

## 4. LEFT RAIL (184px) - Navigation

### Classes
```
.rail-section: margin-bottom: 16px;
.rail-header: flex row; padding: 4px 8px; 11px, 600 weight;
.rail-header__chevron: transition: transform 120ms;
.rail-header__count: margin-left: auto;
.rail-divider: height: 1px; background: var(--line-faint); margin: 8px;
.left-nav-item: flex row; gap: 8px; padding: 7px 10px; 13px font;
.left-nav-item.active: background: var(--accent-soft);
.left-nav-badge: margin-left: auto; 11px font;
```

## 5. CENTER PANE - Main Content

### Hero Section
```
.hero-tagline: 14px, 500 weight, uppercase
.hero-big: 52px, 800 weight, max-width 640px
.hero-sub: 15px, line-height 1.55
```

### Twin Cards Grid
```
.twin-cards: grid-template-columns: 1fr 1fr; gap: 16px;
.card: padding: 24px; border-radius: var(--r-lg); background: var(--panel-elevated);
.card-kicker: 10px, 700 weight, uppercase, color: var(--accent);
.card-title: 24px, 700 weight;
.card-body: 14px, var(--ink-mute), line-height 1.55;
```

### Report Cards (2-column)
```
.rn-grid: grid-template-columns: 1fr 1fr; gap: 12px;
.rn-card: border: 1px solid var(--line-faint); border-left: 3px solid transparent;
.rn-card[data-status="verified"]: border-left-color: var(--green);
.rn-card[aria-selected="true"]: border-color: var(--accent);
.rn-head: flex row; padding: 12px 14px 0;
.rn-icon: 24px square; background: var(--accent-soft);
.rn-title: 13px, 600 weight, ellipsis;
.rn-status: 9px, 600 weight, pill; padding: 2px 7px;
.rn-more: 24px button; opacity: 0; opacity: 1 on hover;
.rn-body: padding: 4px 14px 0;
.rn-summary: 12px, var(--ink-mute);
.rn-tag: 9px, 500 weight; padding: 2px 7px;
.rn-health: padding: 8px 14px 10px; border-top: 1px solid var(--line-faint);
```

### Queue Component
```
.queue-head: flex row; space-between;
.lane-tabs: flex row; gap: 3px;
.lane-tab: 11px, 590 weight; pill shape;
.lane-tab.active: background: var(--accent); color: #fff;
.q-selected: border: 1px solid var(--accent-soft); padding: 18px 22px;
.q-list: border: 1px solid var(--line-faint);
.q-item: grid-template-columns: 28px 52px 1fr auto;
.q-item:nth-child(odd): background: var(--panel);
.q-item:nth-child(even): background: var(--paper-warm);
.q-rank: 12px, 700 weight; text-align: center;
.q-badge: padding: 2px 8px; pill; 9px, 700 weight;
.q-title: 13px, 590 weight; ellipsis;
```

## 6. RIGHT RAIL (400px) - Agent Panel

### Core Structure
```
.ar: display: flex; flex-direction: column; height: 100%;
.ar[data-width="expanded"]: width: 560px;
.ar[data-width="collapsed"]: width: 48px;

.ar-search: padding: 12px 14px 8px;
.ar-search__input: width: 100%; padding: 7px 10px 7px 30px;
                   border: 1px solid var(--line); border-radius: var(--r);
                   background: var(--paper-warm);

.ar-ctx: flex row; padding: 6px 14px 10px;
.ar-ctx__chip: 10px; padding: 2px 8px; pill; background: var(--muted);
.ar-ctx__chip--active: background: var(--accent-soft);

.ar-body: flex: 1; overflow-y: auto;

.ar-section: padding: 10px 14px; border-bottom: 1px solid var(--line-faint);
.ar-section__head: 10px, 600 weight, uppercase;
.ar-section__count: 10px, right-aligned;

.ar-action: flex row; gap: 8px; padding: 6px 8px; 12px font;
.ar-action:hover: background: var(--accent-tint);
.ar-action__icon: 22px square; background: var(--accent-soft);
```

### Agent Head & Context
```
.ar-agent-head: padding: 12px 14px 10px;
.ar-agent-head__dot: 7px circle; background: var(--green);
.ar-agent-head__label: 13px, 600 weight;
.ar-agent-head__expand: 24px button;

.ar-pills: flex row; padding: 8px 14px;
.ar-pill: 10px; padding: 3px 8px; pill; background: var(--panel);
.ar-pill--page: background: color-mix(in srgb, var(--accent) 6%, var(--panel));
```

### Chat & Messages
```
.ar-thread: padding: 10px 14px; flex: 1; overflow-y: auto;

.ar-msg: font-size: 12px; padding: 8px 10px; border-radius: 10px; max-width: 92%;
.ar-msg--user: align-self: flex-end; background: var(--accent-soft);
.ar-msg--agent: align-self: flex-start; background: var(--muted);
.ar-msg__lead: 13px, 560 weight;
.ar-msg__detail: 11.5px; color: var(--ink-mute);
.ar-msg__tool: 9px, monospace; padding: 1px 5px;
```

### Composer
```
.ar-composer: padding: 0; border-top: 1px solid var(--line-faint);

.ar-composer__pills: flex row; padding: 10px 14px 0;
.ar-composer__pill: 9px; padding: 2px 7px; pill;

.ar-composer__input: flex: 1; padding: 10px 12px;
                     border: 1px solid var(--line);
                     border-radius: var(--r); min-height: 42px;

.ar-composer__send: 32px circle; background: var(--accent); color: #fff;
```

## 7. SHARED COMPONENTS

### Buttons
```
.btn: font-size: 12px; font-weight: 590; padding: 7px 16px;
      border-radius: var(--r-pill); border: 1px solid var(--line);
      background: var(--panel); cursor: pointer;

.btn-primary: background: var(--ink-strong); color: var(--paper);
```

### Icons & Badge Patterns
```
Icon box: 18-24px square, border-radius var(--r-sm) or 50%,
          background var(--accent-soft), color var(--accent-strong),
          display: grid; place-items: center;

Badge/Tag: 9-10px font, 600-700 weight, 2px 7px padding,
           pill radius, color-coded by data-* attribute
```

## 8. RESPONSIVE BREAKPOINTS

```css
@media (max-width: 1100px) {
  .columns { grid-template-columns: 1fr; }
  .col-left, .col-right { display: none !important; }
}

@media (max-width: 760px) {
  .mobile-nav { display: flex; /* bottom bar */ }
  .col-center { padding-bottom: 72px !important; }
}

@media (max-width: 640px) {
  .col-center { padding: 20px 16px 100px; }
  .hero-big { font-size: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
```

## 9. ACCESSIBILITY

### Skip Link
```html
<a class="skip-link" href="#main-content">Skip to main content</a>
```

### Semantic HTML
- <header class="topbar"> for top nav
- <main class="col col-center" id="main-content" tabindex="-1">
- <aside> for left/right rails
- <button> for all controls
- <nav> for navigation

### ARIA
- ria-label on icon-only buttons
- ria-expanded on collapsibles
- ria-selected on cards
- ole="region" on landmarks

## 10. THEME SWITCHING

```javascript
function toggleTheme() {
  const shell = document.getElementById('shell');
  const isDark = shell.getAttribute('data-theme') === 'dark';
  shell.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}
```

```css
[data-theme="dark"] {
  --paper: #0f1011;
  --panel: #1c1d1f;
  /* ...override all vars... */
}
```

## 11. KEY NAMING CONVENTIONS

### Classes (BEM)
- Blocks: .card, .rn-card, .ar-agent-head
- Elements: .card-title, .rn-card__title
- Modifiers: .btn-primary, [data-status="verified"]
- States: .active, .open, [aria-selected="true"]

### Data Attributes
- [data-surface="home|reports|chat|inbox|me"]
- [data-sp="home"] — surface panel
- [data-status="verified|review|stale"]
- [data-tone="green|amber|blue"]
- [data-color="blue|green|amber|red"]
- [data-lane="Act|Read|Wait|File"]
- [data-width="expanded|collapsed"]
- [data-theme="light|dark"]

## 12. ANIMATIONS

- Default: 	ransition: all 120ms or 140ms
- Easing: ar(--ease) = cubic-bezier(0.16, 1, 0.3, 1)
- Micro: 100ms for hover
- Rotate: 	ransform: rotate(90deg) with 	ransition: transform 120ms

