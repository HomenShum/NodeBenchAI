# NodeBench AI — Documentation

**Last consolidated:** 2026-04-19

NodeBench is an open-source (MIT) **founder-intelligence MCP**. One-line install `claude mcp add nodebench` turns any Claude-compatible agent into a founder-diligence workflow. See [`https://www.nodebenchai.com`](https://www.nodebenchai.com) for the product.

This docs directory is designed as a **golden-standard reference** — structure, conventions, and reference attributions are deliberate so that future contributors (students, colleagues, and our own future selves) can navigate confidently.

## How this tree is organized

```
docs/
├── README.md               ← you are here
├── architecture/           ← the 13 canonical specs (the "what" and "why")
│   └── README.md           ← architecture index
├── guides/                 ← how-to for builders
├── decisions/              ← ADRs (architecture decision records)
├── changelog/              ← release notes, rolling CHANGELOG
└── archive/                ← superseded content, read-only, provenance-only
    └── 2026-q1/
        └── INDEX.md
```

## Where to start

- **New to the codebase?** → [`architecture/README.md`](architecture/README.md), then [`architecture/AGENT_PIPELINE.md`](architecture/AGENT_PIPELINE.md).
- **Building a diligence block?** → [`architecture/DILIGENCE_BLOCKS.md`](architecture/DILIGENCE_BLOCKS.md) + [`guides/adding-a-diligence-block.md`](guides/adding-a-diligence-block.md).
- **Security questions?** → [`architecture/USER_FEEDBACK_SECURITY.md`](architecture/USER_FEEDBACK_SECURITY.md) + [`../.claude/rules/agentic_reliability.md`](../.claude/rules/agentic_reliability.md).
- **Running locally?** → [`guides/local-development.md`](guides/local-development.md).
- **What shipped when?** → [`changelog/`](changelog/).
- **Historical context?** → [`archive/2026-q1/INDEX.md`](archive/2026-q1/INDEX.md).

## Conventions — non-negotiable

Graph/search/agent-context work should start with
[`architecture/GRAPH_SEARCH_AGENT_CONTEXT.md`](architecture/GRAPH_SEARCH_AGENT_CONTEXT.md)
before changing report graphs, search packets, or agent context wiring.

Every new architecture document follows a **strict template** so the golden-standard goal holds:

```markdown
# <Title>

**Status:** Living · Last reviewed <YYYY-MM-DD>
**Owner:** <team or person>
**Supersedes:** <list of archived files this replaces>

## TL;DR
## Prior art — what we borrowed, and from whom
## Invariants
## Architecture
## Data model
## Failure modes
## How to extend
## Related docs
## Changelog
```

Prior-art attribution is mandatory. If a design borrows a pattern from Anthropic / Manus / Cognition / Reflexion / a research paper / another company's product, it must be cited.

## Why docs/ was recently slimmed

On 2026-04-19, we consolidated this tree from 1,864 files / 336 MB down to a focused canonical set. Binary assets (demo video/audio, agent-setup iPhone captures) moved off the repo drive to `D:\NodeBench-Assets\`. Benchmark JSONs moved to [`benchmarks/history/`](../benchmarks/history/). Historical markdowns moved to [`archive/2026-q1/`](archive/2026-q1/). 124 architecture MDs consolidated into 13 canonical docs under [`architecture/`](architecture/).

See [`archive/2026-q1/INDEX.md`](archive/2026-q1/INDEX.md) for what moved where and why.

## Contributing to this tree

1. **Does a living doc already cover your topic?** If yes, extend it — don't add a new file.
2. **New architectural pattern?** Follow the template, cite prior art, add to [`architecture/README.md`](architecture/README.md) index.
3. **New task record or completion?** That goes in [`changelog/`](changelog/), not as a top-level doc.
4. **Superseding an old doc?** Move it to `archive/` via `git mv` (never delete), add its path to the new doc's `Supersedes:` list.

Binary assets do not belong in this tree. Use `.tmp/` (gitignored) or an external location like `D:\NodeBench-Assets\`.
