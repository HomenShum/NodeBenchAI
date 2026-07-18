# NodeBench production live-agent depth audit

Date: 2026-07-16  
Mode: AUTHORIZED PRODUCTION  
Surface: https://www.nodebenchai.com/redesign/chat  
Receipt: https://www.nodebenchai.com/redesign/chat/r/36imyvtrf0d3

## Live runs

### Anonymous fail-closed probe

- The public session accepted the prompt locally but did not call a model.
- Visible terminal state: `Live chat is not running` and `Sign in with an email-backed account before running live research.`
- This path incurred no model usage and accurately exposed the current report context.

### Authenticated research run

Prompt:

> Production QA run 2026-07-16: Using the attached Daily Brief, return exactly two bullets: (1) the strongest supported claim with its best source, and (2) one concrete review gap. Do not write, share, approve, or modify any data.

Observed receipt:

- Status: complete
- Tier: Deep dive
- Provider: `google-gemini`
- Model: `gemini-3.1-pro-preview`
- Tokens: 1,406
- Latency: 14.6s
- Estimated cost: $0.0001 (`<$0.01` in the message chrome)
- Receipt suffix: `s6kqrf`
- Reads: 6 selected context items, 12 source refs
- Writes: Review mode, no automatic shared writes
- Evidence: 6 rows; 5 cached references and 1 fetched source blocked because its quote was not confirmed
- Tool receipts: `classify_query`, `build_context_bundle`, `gemini_synthesis`, `bind_evidence`

The output did not honor `exactly two bullets`; the runtime always rendered its five-section answer packet. The claimed "best source" was represented by coarse cached labels such as `Setup` and `Rising Action`, not a claim-adjacent source URL.

### Reload-recovery run

Prompt:

> Production recovery QA run 2026-07-16: From the attached Daily Brief, identify one unresolved claim and return only its title. Do not write, share, approve, or modify any data.

Pre-reload state:

- Status: Running
- Receipt suffix: `72n990`
- Same bounded read/write scope as the first run

Post-reload state:

- At 1.2s the route briefly showed the empty first-run composer.
- By 3.5s the same prompt and receipt suffix `72n990` were restored.
- Terminal receipt: `gemini-3.1-pro-preview`, 1,387 tokens, 14.8s, estimated $0.0001.
- Reproducible answer route `/redesign/chat/r/36imyvtrf0d3` rendered the persisted prompt, answer, evidence warnings, model, tier, latency, cost, and deterministic-hash explanation.
- The answer again ignored `return only its title` by adding the fixed Why useful, Evidence, Risks, and Next action sections.

## Adversarial and responsive findings

### P1: double-click submit immediately cancels the new run

The first click changes the same button from `Run research` to `Stop`. The second click of a normal double-click lands on the new Stop control and cancels the just-created run. Production rendered `Run cancelled. Any in-flight provider stream was aborted at the next cooperative checkpoint.` Only one cancelled turn was created; no duplicate paid completion was observed.

Source mechanism on `origin/main`: `UniversalComposer.tsx` conditionally swaps the submit button for `Cancel active run` in the same slot whenever `streaming` becomes true. The control needs a cancel-arming delay/debounce or a spatially distinct cancel affordance.

### P1 regression: authenticated mobile wide mode collapses chat to 70px

At a 390x844 viewport with the persisted wide-mode flag:

- `.rd-shell__main`: 390px wide, computed grid `70px 320px`
- `main#main-content`: 70px wide
- `.rd-chat-workspace`: 70px wide with `overflow-x: hidden`
- Composer dock: x=0, width=371.906px
- Textarea: x=23, width=325.906px, y=725.75
- Latest article: x=73, width=269.906px, bottom=591.78
- Document horizontal overflow: false, demonstrating that an overflow boolean alone misses the clipping
- Console errors: 0; mojibake: 0

The rendered mobile screenshot showed a mostly blank viewport with only a thin clipped strip of the composer. Root cause: the high-specificity wide-mode rule in `primitives.css` keeps `grid-template-columns: minmax(0, 1fr) 320px`; the lower-specificity mobile rule cannot override it, so the main column receives the remaining 70px.

### P1: exact output constraints lose to the fixed memo template

`convex/domains/redesign/chatRuns.ts` hardcodes the Gemini system prompt to exactly five headings: Short answer, Why it matters, Evidence, Risks / unknowns, and Next action. User requests such as `exactly two bullets` and `return only its title` therefore cannot control the response shape even when content is otherwise valid.

### P1: preflight withholds provider/model

Before submit, the UI disclosed Deep dive, possible paid use, selected context, and no automatic writes. It explicitly said `Provider names appear in the trace, not here.` The receipt later disclosed model/provider correctly, but the preflight did not satisfy the exact provider/model disclosure contract.

### P1: evidence lineage is too coarse for "best source"

The run exposed model, provider, tokens, cost, tool receipts, and claim checks. However, five evidence rows were cached section labels without public URLs, while the only fetched URL was blocked as unsupported. This is honest degradation, but it cannot substantiate the answer's phrase `strongest supported claim with its best source`.

## Regression sweep

- PASS after hard reload: fabricated Active/Recent/Archived chat rail absent.
- PASS: no inert New thread control on the current deployed route.
- PASS: clean first-run route makes the composer the hero and hides the idle inspector.
- REGRESSED: authenticated mobile transcript/composer geometry under persisted wide mode.
- NOT EXERCISED: FastAgent-only skip-link and attachment-removal focus paths were not rendered by the production redesign routes used in this pass.

## Journey verdicts

- A0 Smoke: PASS after hard reload
- A1 Private creation: SKIPPED (outside this live-run slice)
- A2 Live AI action: FAIL (real run and receipt succeeded; exact preflight and response-shape contracts failed)
- A3 Provenance audit: PASS with limitation (receipt and warnings visible; cached lineage coarse)
- A4 Output/share: PASS for reproducible answer link; other exports not invoked
- A5 Themes/access: FAIL (authenticated mobile wide-mode collapse)
- A6 Adversarial: FAIL (double-click cancels); PASS reload recovery and anonymous fail-closed path
- A7 Agentic depth: PARTIAL (durable run and four tool receipts, no visible inspect/repair iteration)

## Bar scores

`B1=1 B2=1 B3=2 B4=2 B5=2 B6=1 B7=2 B8=1 B9=1 B10=1 B11=1` (15/22)

## Depth scores for exercised dimensions

- D1=1: multiple receipts, but no repair/inspect receipt consuming a prior result
- D2=1: cached source packet and honest unsupported-source block; no claim-level fresh retrieval lineage
- D3=1: same durable run recovered and completed after reload; transient empty-state flash and retry-from-stage not exercised
- D6=1: turn survives reload; no visible memory edit/delete/disable surface in this journey
- D7=1: Auto/tier routing works; no provider/model preflight, spend cap, or fallback policy
- D10=1: visible claim checks and blocked evidence; fixed response template violates explicit output constraints
- D4, D5, D8, D9, D11: NOT TESTED in this bounded run

## Next release order

1. Fix the mobile wide-mode specificity bug and add a persisted-wide 390px regression capture.
2. Prevent submit-to-stop double-click fallthrough.
3. Let explicit response-shape constraints override or bypass the five-section memo renderer.
4. Disclose resolved provider/model before the paid submit.
5. Require a URL-backed evidence row before labeling a claim as the strongest supported claim/best source.
