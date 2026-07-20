---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.css"
related_: [dogfood_verification, product_design_dogfood, flywheel_continuous, analyst_diagnostic, completion_traceability]
---

# Gemini QA Loop — Automated UI/UX Quality Gate

Continuous dogfood loop using Gemini 3.1 Pro vision to score and fix UI/UX issues automatically.

## Pipeline Steps (in order)

```bash
# 1. Build production bundle
npx vite build

# 2. Ensure preview server is running (port 4173)
npx vite preview --host 127.0.0.1 --port 4173 &

# 3. Capture screenshots via e2e test
BASE_URL=http://127.0.0.1:4173 npx playwright test evals/e2e/full-ui-dogfood.spec.ts --project=chromium --workers=1

# 4. Publish screenshots to public/dogfood/
npm run dogfood:publish

# 5. Record walkthrough video
node scripts/ui/recordDogfoodWalkthrough.mjs --baseURL http://127.0.0.1:4173 --publish static

# 6. Run Gemini QA (sends screenshots + video to Gemini 3 Flash for scoring)
BASE_URL=http://127.0.0.1:4173 node scripts/ui/runDogfoodGeminiQa.mjs

# 7. Read results
# Score + summary printed to stdout
# Full JSON: .tmp/dogfood-gemini-qa/screens-qa.json and video-qa.json
# History: public/dogfood/qa-results.json
```

## Scoring Formula

```
Score = 100 - (P1_count × 6) - (P2_count × 2) - (P3_count × 1)
```

- **P0**: Blocks use (crash, blank page) — 10 points each
- **P1**: Major polish (low contrast, missing focus state, misleading UI, broken hierarchy) — 6 points each
- **P2**: Minor polish (spacing, inconsistent styling, empty state copy) — 2 points each
- **P3**: Nit (alignment, minor label wording) — 1 point each

## Fix Strategy Per Severity

### P1 Fixes (highest ROI — each fix recovers 6 points)
- **Low contrast text**: Check dark mode colors. Use `dark:text-gray-300` minimum (not gray-400/500/600).
- **Missing focus styling**: Add `focus-visible:ring-2 focus-visible:ring-blue-500` to interactive elements.
- **Missing visual hierarchy**: Add left border accent, font weight differentiation, or size stepping (sm → xs, not xs → xs).
- **Poor empty states**: Add icon, descriptive copy with action guidance, and CTA button.
- **Misleading labels**: Show exact price/data, add tooltips for ambiguous metrics.

### P2 Fixes (each fix recovers 2 points)
- **Inconsistent spacing**: Standardize gaps (gap-2, gap-3) across similar sections.
- **Date format inconsistency**: Use `month: 'short'` everywhere except page headers.
- **Icon contrast**: `dark:bg-indigo-500/25` minimum (not /10), icons `dark:text-indigo-300` minimum.
- **Menu capitalization**: Pick one (Title Case recommended) and apply everywhere.

### P3 Fixes (each fix recovers 1 point)
- **Alignment nits**: Check grid/flex alignment.
- **Label wording**: Shorten, remove jargon.

## Gemini Noise Management

Gemini QA is **noisy** — the same UI can score 44 or 62 on consecutive runs. Strategy:

1. **Batch fixes**: Apply 5+ fixes before re-running the pipeline. Single-fix runs waste API calls.
2. **Track P1 count trend**: The P1 count is more stable than the total score. Target: 0 P1s.
3. **Hallucination watch**: Gemini sometimes flags things that are already correct (e.g., a blue button it claims "blends in"). Cross-check with actual screenshots before fixing.
4. **Score trajectory**: Track across rounds. Expect ±8 point variance between identical builds.

## Model Configuration

### Pro/Flash Rotation (cost-optimized)
Pattern: **Pro → Flash → Flash → Flash → Pro → Flash → Flash → Flash → ...**

- `runCount % 4 === 0` → `gemini-3.1-pro-preview` (Pro run, deeper analysis, ~$0.10/run)
- `runCount % 4 !== 0` → `gemini-3-flash-preview` (Flash run, fast + cheap, ~$0.02/run)
- **Pro analysis persistence**: Pro run results are saved to DB and injected as reference context into subsequent Flash runs
- **Flash reconfirmation**: Flash runs receive the latest Pro analysis as "PRIOR EXPERT ANALYSIS" in their prompt, reconfirm which issues still exist, and add their own new findings
- **Fallback chains**: Pro → Flash → 2.5-Flash; Flash → 2.5-Flash

### Cost math
- 4-run cycle: 1 Pro ($0.10) + 3 Flash ($0.06) = **$0.16 per cycle** (vs $0.40 if all Pro)
- 60% cost reduction while maintaining Pro-quality baseline analysis

### Config files
- `backend/convex/domains/dogfood/screenshotQa.ts` — Screenshot QA action
- `backend/convex/domains/dogfood/videoQa.ts` — Video QA action
- `backend/convex/domains/dogfood/videoQaQueries.ts` — `getLatestProAnalysis` query for reference injection

## Multi-Variant Coverage

Screenshots are captured in 4 variants: dark-desktop, light-desktop, dark-mobile, light-mobile.
The QA prompt explicitly evaluates:
- **Dark/light theme parity**: text readable in both, no invisible elements, consistent borders
- **Mobile responsiveness**: no horizontal overflow, touch targets ≥44px, readable text at 390px

## Loop Protocol

```
while score < target:
    1. Read .tmp/dogfood-gemini-qa/screens-qa.json and video-qa.json
    2. List all P1s → fix each one (trace root cause first)
    3. List all P2s → fix easy wins (contrast, spacing, copy)
    4. npx vite build
    5. Run e2e + publish + rebuild + Gemini QA
    6. Read new score
    7. If 3 consecutive rounds without improvement → change strategy
```

## MCP Workflow

Agents can discover the full pipeline via: `get_workflow_chain gemini_qa`
This returns the step-by-step workflow chain with tool references and shell commands.

## Key Files

| File | Purpose |
|------|---------|
| `backend/convex/domains/dogfood/screenshotQa.ts` | Screenshot QA action (Gemini Flash + Jony Ive prompts) |
| `backend/convex/domains/dogfood/videoQa.ts` | Video QA action (Gemini Flash + Jony Ive prompts) |
| `scripts/ui/runDogfoodGeminiQa.mjs` | CLI orchestrator for QA pipeline |
| `scripts/ui/recordDogfoodWalkthrough.mjs` | Playwright video recorder |
| `scripts/ui/publishDogfoodGallery.mjs` | Screenshot publisher (variant-aware manifest) |
| `evals/e2e/full-ui-dogfood.spec.ts` | E2e 4-variant screenshot capture test |
| `public/dogfood/qa-results.json` | QA score history |
| `.tmp/dogfood-gemini-qa/*.json` | Latest QA results (screens + video) |
| `shared/llm/modelCatalog.ts` | Model catalog with Gemini defaults |
