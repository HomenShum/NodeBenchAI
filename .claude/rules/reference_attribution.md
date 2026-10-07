# Reference Attribution

Use this rule any time you borrow an architectural pattern, protocol, or
convention from another system or paper.

## Mandate

**Every borrowed pattern cites its source in BOTH the module header comment
AND the relevant `docs/architecture/` doc.** This keeps the repo honest, helps
students trace back to prior art, and prevents silent "we invented this."

## Prior art

- Linux kernel — `CREDITS` file tracking contribution origins
- RFC convention — "Prior art" section in every standards doc
- ADR format — explicit "Considered alternatives" with citations
- Anthropic docs — every Claude Code feature links the research it implements

## Protocol

### In the code (module header)

```typescript
/**
 * <Module purpose in one sentence.>
 *
 * Pattern: <name of the pattern, e.g. "Orchestrator-Workers">
 * Prior art:
 *   - Anthropic: Building Effective Agents (2024)
 *     https://www.anthropic.com/research/building-effective-agents
 *   - Manus AI virtual workspace — task-scoped scratchpad
 *
 * See: docs/architecture/<RELEVANT_DOC>.md
 */
```

### In the doc (`docs/architecture/<NAME>.md`)

Every doc that formalizes a borrowed pattern starts with a **Prior art**
section listing:

- The original source (author, year, URL if public)
- What specifically was borrowed (not "inspired by" — actual mechanism)
- What we adapted or improved (if anything)

## When the source is vague or multi-rooted

Name each source you can trace, with specificity. "Inspired by agent frameworks"
is not acceptable. "Borrowed from Anthropic's orchestrator-workers pattern;
parallel fan-out shape from LangGraph; per-task budget envelope from Cognition
Devin" is.

## When you invented it

Say so plainly. "NodeBench-original: compaction step that re-derives MEMORY.md
from topic files rather than persisting it directly." Honest > embellished.

## What this rule enforces

- New architecture docs have a "Prior art" section or the PR is rejected
- New workers/node/pipeline/ or backend/convex/domains/ modules have a file header comment linking their doc
- When copying a Claude Code skill, cite `.claude/skills/<origin>` in the new skill's frontmatter

## Anti-patterns

- "Inspired by" without specifying what was inspired
- Copying a pattern without reading the original source
- Omitting citation because it feels unoriginal ("everyone knows this")
- Citing only the most recent source when the pattern has a deeper history
- Fake attributions (don't cite a paper you haven't read)

## Related

- [orchestrator_workers.md](orchestrator_workers.md) — pattern with extensive prior art
- [scratchpad_first.md](scratchpad_first.md) — pattern with extensive prior art
- [layered_memory.md](layered_memory.md) — pattern with extensive prior art

## Why this matters for a golden-standard open-source repo

Students, colleagues, and future-us should be able to:
1. Find a pattern in this codebase
2. Trace it to the canonical external source
3. Read the original paper/doc
4. Understand what this repo adapted and why

Without attribution, the repo looks like a pile of "clever ideas" with no
grounding. With attribution, it's a teaching tool.

## Canonical reference

This rule is its own canonical reference. There's no separate `docs/architecture/`
doc for attribution — that would be recursive.
