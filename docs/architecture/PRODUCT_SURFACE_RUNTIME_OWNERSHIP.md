# Product Surface Runtime Ownership

Last updated: 2026-05-26

This note exists to prevent the exact confusion that happened around PRs #380 and #381: a PR title can say "proto chat" or "live context runtime" while the code only changes one of several chat-looking surfaces. Always identify the route and owning files before claiming product parity.

## Route Ownership

| Product surface | Public route | Primary files | Runtime responsibility |
| --- | --- | --- | --- |
| NodeBench current redesign | `/redesign`, `/redesign/reports`, `/redesign/chat`, `/redesign/inbox`, `/redesign/me` | `src/features/redesign/RedesignShell.tsx`, `src/features/redesign/surfaces/*`, `src/features/redesign/components/RightInspector.tsx` | Main product UI. Chat uses `useRedesignChatRun`; Reports uses live artifacts, graph neighborhoods, and a report runtime inspector. |
| NodeBench cockpit / ExactKit | `/?surface=chat`, `/?surface=reports`, etc. | `src/layouts/ActiveSurfaceHost.tsx`, `src/features/designKit/exact/ExactKit.tsx` | Compatibility and visual-regression cockpit. Do not treat changes here as `/redesign` changes. |
| ScratchNode public event room | `https://scratchnode.live/`, `/e/:slug`, `/docs` | `public/proto/home-v5.html`, `public/proto/docs.html`, `convex/events.ts`, `api/scratchnode-config.js`, `vercel.json` host rewrites | Anonymous event-room product with Convex chat, sourced `/ask`, private notes, FAQ, host claim, and wiki publish. It is not the NodeBench redesign app. |
| NodeBench workspace | `/redesign/workspace?...` | `src/features/redesign/surfaces/WorkspaceSurface.tsx` | Separate workspace surface for a selected report identity. It is not a sixth main web tab. |

## Current Runtime Contract

The shared architecture sentence is:

```text
parallel context routing -> scored planning -> progressive execution -> layered verification -> report/notebook persistence
```

For the current redesign:

- `/redesign/chat` owns the active chat runtime UI. It must expose context used, retrieval/tool decisions, verification, cost/latency, write proposals, and approval state through `RightInspector`.
- `/redesign/reports` owns the report-library/runtime-inspector view. The right rail should describe the selected report's bounded graph/context packet, source coverage, claim verification, notebook patch state, and safe-write posture.
- The Reports graph must stay a human-facing bounded graph. It can expose richer agent context packets, but it should not render the whole graph universe.

For the ExactKit cockpit:

- `/?surface=chat` is still real and should stay auth-honest.
- It is not the route users are evaluating when they say the redesigned product page is wrong.
- Any PR that only touches `src/features/designKit/exact/ExactKit.tsx` must say that it changed the cockpit, not `/redesign/chat`.

For ScratchNode:

- `home-v5.html` is the live event-room shell.
- `convex/events.ts` is the public event backend.
- Public `/ask` currently composes sourced answers deterministically from the public event corpus. If an LLM-backed agent is added later, name the boundary clearly so "agent" does not hide deterministic behavior.
- Private notes stay in `userNotes` and must not be read by `askAgent` or public wiki publishing.

## Required Start Checklist

Before implementing UI or runtime work:

1. Run `git fetch origin main --prune`.
2. Work from a clean worktree based on `origin/main`.
3. Name the target route first: `/redesign/chat`, `/redesign/reports`, `/?surface=chat`, or `scratchnode.live/e/:slug`.
4. Inspect the owning files listed above before editing.
5. Add or update tests that assert the target route's DOM markers.

## DOM Markers To Keep Stable

| Marker | Meaning |
| --- | --- |
| `[data-testid="right-inspector"][data-agent-runtime-surface="redesign-chat"]` | Current redesign Chat runtime inspector. |
| `[data-testid="reports-runtime-inspector"][data-agent-runtime-surface="redesign-reports"]` | Current redesign Reports runtime inspector. |
| `[data-testid="exact-web-chat-stream"]` | ExactKit cockpit chat surface at `/?surface=chat`. |
| `document.body.dataset.snLive === "true"` | ScratchNode public room connected to Convex runtime. |

## Review Rule

If a PR says "live runtime", "proto parity", "home-v5", "redesign", or "scratchnode", the reviewer should ask:

```text
Which route changed, and which route was verified in the browser?
```

Do not merge vague runtime claims without a route-specific test or screenshot.
