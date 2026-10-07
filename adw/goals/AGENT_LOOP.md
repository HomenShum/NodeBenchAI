# The Agent Loop — research → patch → PR, with rails

The full closed loop a coding-agent run follows. Governed by [`GOVERNANCE.md`](GOVERNANCE.md) +
[`HARD_GATES.md`](HARD_GATES.md). Autonomy lives *inside a closed Goal Card*, never across the company.

```
1 Intake          founder gives fuzzy intent
2 Goal synthesis  → closed Goal Card (goals/<surface>/NNN-slug.md) + risk class
3 Reference scout  search ≤8 top references, capture evidence
4 Visual capture   screenshot/video current app + references
5 Compare          build a visual critique matrix
6 Scope reduce     smallest change that improves the core loop (≤3 UI changes)
7 Implement        edit on branch agent/<goal-id> (forbidden files untouched)
8 QA               tests + Playwright + screenshots/video + a11y + privacy invariants
9 PR               open PR with before/after assets + DoD checklist + risk class
10 Merge gate      auto-merge ONLY if risk class allows + checks pass (GOVERNANCE.md)
11 Housekeep       delete merged branch · update README/docs/changelog · close goal
```

## Reference budget (search patterns, don't browse forever)
```
≤ 8 references · ≤ 2 screenshots each · ≤ 20 min total · prefer official pages
extract reusable PATTERNS, not pixels · produce image/video evidence
```
| Category | Steal | Refs |
|---|---|---|
| Event join | low-friction setup, page clarity | Luma, Partiful |
| Live room code | code join, no account | Mentimeter, Jackbox |
| Live Q&A | question queue, upvote/moderation | Mentimeter, Slido |
| Agent workflow | calm task state, human+agent | Linear, ChatGPT/Codex |
| Public wiki | publishable artifact | Notion Sites, GitHub Discussions |
| Private notes | raw → useful notes | Granola, Notion |

Artifacts land in `goals/<goal>/references/` (ref + before + after screenshots, `walkthrough-after.mp4`)
plus a **Visual Comparison Matrix** (criterion · before · reference pattern · after · pass?).

## Agent prompt library (one narrow job each)

Copy these into Claude Code; chain them per the loop. Full bodies live in `goals/prompts/`.

- **Goal Synthesizer** — fuzzy intent → one closed Goal Card + non-goals + allowed/forbidden files +
  product invariants + reference categories + reviewable DoD + risk class. *Does not implement.*
- **Reference Scout + Visual Capture** — ≤8 refs, capture URL/desktop/mobile, 3 patterns to steal +
  2 to avoid each, map to ScratchNode; capture current app surfaces + a 30–60s before walkthrough.
- **Vision Critic** — compare against refs; be harsh; score 1–5 on: first-time clarity, event identity,
  join/code affordance, public/private clarity, /ask discoverability, answer-card trust, mobile thumb
  usability, modernity, density, screenshot virality. Output matrix + top-5 problems + smallest fix each
  + **final verdict: SHIP / PATCH / REDESIGN** (allowed to say "do nothing / cut features").
- **Scope Reducer** — pick ≤3 UI changes, reject the rest, name exact files + tests. Preference order:
  clarity > beauty · mobile > desktop · invariants > polish · fewer surfaces > more.
- **Implementation** — implement only the approved patch on `agent/<goal-id>`; no forbidden files; no new
  deps unless approved; preserve invariants; keep ScratchNode v5 single-column + mobile-first; run
  tests; capture after assets; write the PR body.
- **Housekeeper** (weekly) — list stale/merged branches, propose keep/archive/close/merge, check README
  accuracy + stale domain refs + screenshots + prototype-vs-prod labels + gated debug helpers; open a
  cleanup PR if needed. *Never* deletes unmerged branches without listing, never rewrites history.

## Visual QA criteria (assert in QA / the dogfood gate)
```
VIS-001 first-time user understands room purpose in 10s
VIS-002 room code visible + copyable
VIS-003 composer clearly says "Public room" or "Private note" (text, not icon-only)
VIS-004 /ask discoverable without docs
VIS-005 agent answer visibly nested under its parent /ask
VIS-006 trace says "no private notes used"
VIS-007 private mode creates NO public row
VIS-008 mobile tap targets usable (≥44px)
VIS-009 one primary action in the visual hierarchy
VIS-010 screenshot looks credible next to Partiful/Luma/Mentimeter-style refs
```
VIS-006/007 are release-blocker invariants (see HARD_GATES.md) — they gate at HIGH risk, never auto-shipped.

## Repo-presentation checks (the Housekeeper verifies)
```
README starts with product value · scratchnode.live canonical · no stale scratchnode.com links
home-v5 labelled "public viral prototype" · home-v4 labelled "spec proof"
release-blocker invariants documented · screenshots/GIFs present · .env.example · LICENSE · SECURITY.md
· CONTRIBUTING.md · demo/sim helpers gated behind ?debug=1
```
