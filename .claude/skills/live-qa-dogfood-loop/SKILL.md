---
when: user says "run live QA", "dogfood loop", "QA judge", "gemini QA", "visual QA", "live QA loop"
description: Gemini 3 Pro-powered self-evaluating QA judge loop for live app surfaces
related_rules: [gemini_qa_loop, flywheel_continuous, dogfood_verification, analyst_diagnostic]
---

# Live QA Dogfood Loop

Self-conducting improvement loop that uses Gemini 3 Pro vision to screenshot, judge, fix, and re-judge all 5 app surfaces until top-market quality.

## Quick start

```bash
# Ensure dev server is running on port 5191
npm run dev

# Run the QA judge (single pass)
GEMINI_API_KEY=$(grep GEMINI_API_KEY .env.local | cut -d= -f2) \
  node scripts/ui/liveQaJudge.mjs --baseURL=http://127.0.0.1:5191

# Results land in .tmp/live-qa-judge/<timestamp>/
# History tracked in .tmp/live-qa-history.json
```

## What the judge evaluates

8 screenshot captures per run:
1. **home** — `/?surface=home` (desktop 1440x900)
2. **home-interaction** — after clicking first card on home
3. **chat** — `/?surface=chat` with a pre-loaded query + lens
4. **reports** — `/?surface=reports`
5. **reports-interaction** — after clicking first report card
6. **nudges** — `/?surface=nudges`
7. **me** — `/?surface=me`
8. **mobile-home** — `/?surface=home` at 375x812

Each screenshot is sent to Gemini 3 Pro (`gemini-3-pro-preview`) with a structured prompt requesting:
- Per-surface score (1-10)
- Strengths (what works)
- Issues with severity (P1/P2/P3), category, description, fix, and element

## Scoring

```
Grade S: 95+ (top market quality)
Grade A: 90-94
Grade B: 80-89
Grade C: 70-79
Grade D: 60-69
```

## Self-improvement loop protocol

### Phase 1: Run judge, capture baseline
```bash
node scripts/ui/liveQaJudge.mjs --baseURL=http://127.0.0.1:5191
```

### Phase 2: Fix P1s first (each P1 = ~6 points)
- Read `.tmp/live-qa-judge/<latest>/gemini-judge-response.json`
- For each P1: trace root cause (not symptom), fix the cause
- Common P1 patterns:
  - **Toast overlap** — adjust Sonner position or z-index in `src/main.tsx`
  - **Unreadable text** — increase contrast: `--rd-ink-faint` -> `--rd-ink-soft`
  - **Broken layout** — check CSS grid/flex alignment

### Phase 3: Fix P2s (each P2 = ~2 points)
- **Low contrast** — darken `--text-muted` / brighten `--rd-ink-faint` in dark mode
- **Badge urgency** — increase border opacity + add subtle glow for act-now badges
- **Mobile viewport** — compact or make dismissible promo cards
- **Button states** — distinct disabled (opacity 0.35 + grayscale) vs active states

### Phase 4: Fix P3s (each P3 = ~1 point)
- Typography alignment, spacing, label wording
- Card height standardization
- Section header weight

### Phase 5: Re-run and compare
```bash
node scripts/ui/liveQaJudge.mjs --baseURL=http://127.0.0.1:5191
cat .tmp/live-qa-history.json  # Compare scores across runs
```

### Phase 6: Loop until Grade S
- If 3 consecutive rounds without improvement: change strategy
- Expand scenarios (add more interaction states)
- Target: 0 P1s, 0 P2s, score 95+

## Key files

| File | Purpose |
|------|---------|
| `scripts/ui/liveQaJudge.mjs` | Streamlined QA judge script |
| `.tmp/live-qa-judge/` | Screenshots + Gemini responses per run |
| `.tmp/live-qa-history.json` | Score history across runs |
| `src/main.tsx` | Sonner toaster configuration |
| `src/index.css` | Global `--text-muted` contrast tokens |
| `src/features/redesign/tokens.css` | Redesign `--rd-ink-*` contrast tokens |
| `src/features/redesign/primitives.css` | Component-level styling |

## Gemini model configuration

- **Primary**: `gemini-3-pro-preview` (vision analysis)
- **API key**: `GEMINI_API_KEY` from `.env.local`
- **Cost**: ~$0.05-0.10 per run (8 screenshots)
- **Variance**: Expect +/- 3 points between identical builds

## Common fix patterns

### Contrast (most common issue)
```css
/* Before — fails WCAG AA */
--rd-ink-faint: #62666d;   /* 3.4:1 ratio */
/* After — meets WCAG AA */
--rd-ink-faint: #787d85;   /* 4.6:1 ratio */
```

### Toast positioning
```tsx
// Before — overlaps chat input
<SonnerToaster position="bottom-center" />
// After — clears all bottom UI
<SonnerToaster position="top-center" />
```

### Badge urgency
```tsx
// Before — subtle, same weight as FYI
"border-[rgba(217,119,87,0.32)] bg-[rgba(217,119,87,0.10)]"
// After — visually urgent with glow
"border-[rgba(217,119,87,0.48)] bg-[rgba(217,119,87,0.18)] shadow-[0_0_6px_rgba(217,119,87,0.15)]"
```

### Disabled button clarity
```tsx
// Before — ambiguous (0.6 opacity)
opacity: text.trim() ? 1 : 0.6,
// After — clearly disabled
opacity: text.trim() ? 1 : 0.35,
filter: text.trim() ? "none" : "grayscale(0.6)",
```

## Anti-patterns
- Fixing symptoms without tracing root cause
- Weakening the judge prompt to improve scores
- Removing screenshots from the capture set
- Declaring done at Grade B ("good enough")
- Single-fix runs (batch 3+ fixes before re-running)
