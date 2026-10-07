# The four authorities

The promotion loop borrows its expertise instead of restating it. Four maintained
sources, one per axis, and **a hard cap of four**: adding a fifth means deleting
one.

The reason is not tidiness. An agent given many overlapping style guides develops
conflicting taste — it can satisfy any one reviewer and no coherent product. One
authority per axis makes disagreements impossible to launder.

| Axis | Authority | Used for |
|------|-----------|----------|
| Implementation | Anthropic `frontend-design` | building and changing the interface |
| Interface review | Vercel Web Interface Guidelines | reviewing the interface against a maintained standard |
| Engineering quality | Addy Osmani `web-quality-skills` | accessibility, performance, Core Web Vitals |
| Verification | Playwright / Chrome DevTools | driving the real browser and capturing evidence |

## What the loop is NOT allowed to borrow

Taste about *this product's* domain. The authorities decide how an interface
should behave in general; they do not decide what NodeBenchAI is for. That lives in
`PRODUCT_GOAL.md` and the journeys, and it is the one thing a maintained skill
cannot supply.

## Precedence when two disagree

1. A binding invariant of the repo wins over any authority. If a guideline asks
   for something the product's trust rules forbid — animating a value that must
   not read as magnitude, inferring a number that must be measured — the
   invariant wins and the conflict is recorded.
2. Otherwise: verification beats review, and review beats preference. What the
   browser shows outranks what a guideline predicts.

## Installing them

These are referenced, not vendored. Pin them in the consuming repo's agent
configuration (plugin marketplace, `.claude/skills`, or the equivalent) rather
than copying their text — a vendored copy is a fork that stops receiving fixes,
and this whole design exists so the expertise stays maintained elsewhere.
