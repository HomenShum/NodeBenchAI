# Design Context — read before generating

Any change that touches user-visible UI (components, CSS, copy, motion,
icons, layout) MUST read these two files FIRST and conform to them:

1. `docs/design/PRODUCT.md` — register, users, voice, **anti-references**
   (what NodeBench must never look like)
2. `docs/design/DESIGN.md` — approved decisions ledger, each with its
   enforcement; plus the Start→Iterate→Polish→Maintain loop mapped to this
   repo's machinery

Pattern: impeccable.style/designing — `init` writes PRODUCT.md/DESIGN.md and
every later command reads both before generating. Ours adds teeth: a ledger
entry must name its guard/contract/lint, and agent briefs for UI work must
include both files in the agent's required reading.

## Hard rules distilled (the ones agents break most)

- Stroke-SVG icons only, `stroke="currentColor"` — never emoji (guard-tested)
- Every new animation/transition gets a `prefers-reduced-motion: reduce` flatten
- Prose leads; structure collapses; no memo furniture in conversation
- Honest empty over fake full — no badge/score/state without computation
- One accent (`--rd-accent` terracotta); motion settles once then rests
- New design decisions land in DESIGN.md WITH their enforcement, or they are
  not decisions

## When delegating UI work to subagents

Copy this into the brief: "Read docs/design/PRODUCT.md and
docs/design/DESIGN.md first; conform to the anti-references; any new
decision you make must be proposed as a DESIGN.md entry with enforcement."

## Related

- `reexamine_design_reduction` — earned complexity, kill jargon
- `product_design_dogfood` — verify in the running UI
- `.claude/rules/reference_attribution.md` — impeccable.style/designing is
  the cited prior art for the standing-context pattern
