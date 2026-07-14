# UI Contract — Visual Evidence

Dated, append-only visual-contract evidence for NodeBench's UI migrations
(currently the AI Elements adoption). Governed by
[`../UI_CONTRACT.md`](../UI_CONTRACT.md); machine-readable companion is
[`src/design/designSystem.ts`](../../../src/design/designSystem.ts).

Pattern borrowed from NodeRoom's `docs/design/ui-contract/` — each capture is a
dated folder holding screenshots + a `manifest.json` describing what was shot,
plus (for migrations) before/after pairs and Gemini QA receipts.

## Folder convention

```
ui-contract/
  README.md                         ← this file (the protocol)
  manifest.schema.json              ← the manifest shape every capture folder follows
  YYYYMMDD-<slice>/                 ← one folder per capture session
    manifest.json                   ← required: what/where/how it was captured
    <surface>-<WxH>.png             ← source-design or "after" screenshots
    before-<surface>-<WxH>.png      ← (migration proof) the pre-change baseline
    after-<surface>-<WxH>.png       ← (migration proof) the post-change result
    <surface>-qa.json               ← (optional) Gemini QA receipt for that shot
```

Slug examples: `20260714-ai-elements-batch1`, `20260714-flagship-conversation`.
Viewports: desktop `1456x940` / `1280x900`, mobile `390x844`. Dark + light both
where theming changed.

## Capture protocol

1. Build + serve the real app (never a static mock):
   `npm run build && npx vite preview --host 127.0.0.1 --port 4173`.
2. Drive **normal product paths** to the migrated surface (the FastAgentPanel
   agent chat), in dark and light, desktop and mobile 390px.
3. Screenshot before (from `origin/main` or the pre-batch commit) and after.
   The repo's dogfood tooling already automates capture + publish:
   `npm run dogfood:full:local` (or `scripts/ui/recordDogfoodWalkthrough.mjs`).
4. (Optional but preferred) score with the Gemini QA loop
   (`scripts/ui/runDogfoodGeminiQa.mjs`) and drop the JSON receipt beside the shot.
5. Write `manifest.json` (schema below) and reference the folder from
   `UI_CONTRACT.md` → Migration Status.

## Proof requirement

A migration slice is not "shipped" until its `ui-contract/YYYYMMDD-*` folder
exists with before/after screenshots and a manifest, AND `UI_CONTRACT.md` links
it. Per `live_dom_verification`, screenshots alone do not prove "live" — pair
them with a live-path browser verification.

## Manifest shape

See [`manifest.schema.json`](manifest.schema.json). Minimal example:

```json
{
  "schema": "nodebench-ui-contract-v1",
  "capturedAt": "2026-07-14T00:00:00.000Z",
  "slice": "ai-elements-batch1",
  "app": "nodebench-ai",
  "localServer": "http://127.0.0.1:4173",
  "policy": "before/after proof for a behavior-preserving migration; production parity verified via normal product paths separately",
  "commitBefore": "776c4868~1",
  "commitAfter": "776c4868",
  "pages": [
    {
      "id": "fast-agent-panel-typing",
      "label": "Agent chat — streaming",
      "purpose": "shimmer + reasoning primitives during a live stream",
      "route": "/?surface=ask",
      "viewport": { "width": 1456, "height": 940 },
      "theme": "dark",
      "before": "before-fast-agent-panel-typing-1456x940.png",
      "after": "after-fast-agent-panel-typing-1456x940.png",
      "qa": "fast-agent-panel-typing-qa.json"
    }
  ]
}
```
