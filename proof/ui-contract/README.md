# UI Contract — Visual Evidence

This directory is the append-only evidence store for NodeBench UI migrations.
It is governed by [`../UI_CONTRACT.md`](../UI_CONTRACT.md); the machine-readable
companion is [`src/design/designSystem.ts`](../../../src/design/designSystem.ts).

## Runtime surface contracts (`surfaces/`)

`surfaces/*.contract.json` are **executable** surface contracts — the third
layer beside the static design manifest (designSystem.ts) and this evidence
store. Each declares a surface's anchors, computed-geometry invariants, theme
wiring (the storage key + attribute the shell actually reads), and
deep-link-forced states with copy that must agree with reality.

`tests/e2e/ui-contract-runner.spec.ts` executes every manifest against the
live DOM per theme x viewport (Tier B runs it per-PR against the preview).
Adding a surface means adding a manifest — no new spec code. Vision QA
(Gemini loop, screenshot review) stays for taste; everything objectively
checkable belongs in a contract here instead.

Why this layer exists — two shipped failures no other layer could catch:
the 2026-07-16 mobile collapse (computed `70px 320px` invisible to overflow
booleans and CSS-source string guards) and the 2026-07-17 discovery that
every "dark" QA capture since #561 was a light render because the capture
spec wrote a theme key the shell no longer read. Both are now contract
clauses (`geometry`, `theme.storageKey`).

At the current `origin/main` boundary through PR #527, this directory contains
the protocol and schema only. No dated proof folder is present, so this document
does not claim screenshots, QA findings, an Agentic UI Bar score, preview
verification, or production-live verification.

## Evidence states

Record each state independently:

| State | Minimum evidence |
|---|---|
| source merged | canonical main SHA and PR |
| checks verified | exact command, result, and tested SHA |
| visual proof complete | real before/after files plus schema-valid manifest |
| preview verified | normal product route, preview URL/build, browser assertions |
| production live verified | post-merge production URL, deployed revision/bundle, browser assertions |

Never promote one state based on another. A build is not a live check; a
screenshot is not a deployment check; a branch SHA is not the canonical main
SHA after squash merge.

## Folder convention

```text
ui-contract/
  README.md
  manifest.schema.json
  YYYYMMDD-<slice>/
    manifest.json
    before-<surface>-<WxH>.png
    after-<surface>-<WxH>.png
    <surface>-qa.json              # optional, only when actually produced
```

Useful viewports include desktop `1456x940` or `1280x900` and mobile `390x844`.
Capture light and dark only where those states are actually exercised.

## Capture protocol

1. Start from a clean worktree at the exact baseline or candidate revision.
2. Build and serve the real app:
   `npm run build && npx vite preview --host 127.0.0.1 --port 4173`.
3. Drive the normal product path to the reachable changed region. Preserve web
   navigation as `Home - Reports - Chat - Inbox - Me`; Workspace remains a
   separate deployed surface.
4. Capture before and after from the stated revisions. Do not substitute a
   static mock, story, or unrelated route for a live product seam.
5. If a scorer is run, store its actual receipt. If it is not run, omit the
   receipt and score; never invent a score or finding.
6. Write `manifest.json`, validate it against `manifest.schema.json`, and ensure
   every referenced file exists before linking the folder from UI_CONTRACT.
7. If claiming preview or production state, separately record the URL, deployed
   revision/bundle evidence, browser assertions, and console result.

Dead or unreachable exports may have source/test evidence, but must not be
described as live. In particular, a CollapsibleAgentProgress unit render or
successful build is not proof that the component rendered in production.

## Proof integrity rules

- Never create placeholder PNGs, empty receipts, synthetic manifests, or copied
  screenshots solely to satisfy the folder convention.
- Never cite a path that does not exist.
- Never reuse a result from a different SHA without labeling it historical.
- Keep domain and proof cards visible in any chat capture; do not replace live
  Convex data with fixtures to make a screenshot easier.
- Redact secrets and private content without changing the functional state being
  verified.

## Manifest shape

See [`manifest.schema.json`](manifest.schema.json). Minimal example:

```json
{
  "schema": "nodebench-ui-contract-v1",
  "capturedAt": "2026-07-14T00:00:00.000Z",
  "slice": "ai-elements-example",
  "app": "nodebench-ai",
  "localServer": "http://127.0.0.1:4173",
  "policy": "before/after proof for a behavior-preserving migration",
  "commitBefore": "<real baseline SHA>",
  "commitAfter": "<real candidate SHA>",
  "pages": [
    {
      "id": "fast-agent-panel-chat",
      "label": "Agent chat",
      "purpose": "reachable migrated region under normal product navigation",
      "route": "/?surface=ask",
      "viewport": { "width": 1456, "height": 940 },
      "theme": "dark",
      "before": "before-fast-agent-panel-chat-1456x940.png",
      "after": "after-fast-agent-panel-chat-1456x940.png"
    }
  ]
}
```
