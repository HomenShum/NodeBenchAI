# Architecture — Canonical Index

**Last consolidated:** 2026-04-19

This folder holds the **13 canonical architecture documents** — the "what and why" of every major subsystem. If a concept has a home here, that home is the source of truth. Anything else that looks architectural but isn't in this list has been archived under [`../archive/2026-q1/architecture-superseded/`](../archive/2026-q1/architecture-superseded/).

## The 13 canonical docs

### Tier 1 — the core pipeline (detailed)

| Doc | Covers |
|---|---|
| [AGENT_PIPELINE.md](AGENT_PIPELINE.md) | Orchestrator-workers pattern · scratchpad-based working memory · telemetry trace · self-review · auto-feedback · the six-stage pipeline |
| [DILIGENCE_BLOCKS.md](DILIGENCE_BLOCKS.md) | Block contract (`DiligenceBlock<T>`) · 10 blocks enumerated · authority allowlists · legal fence · how to add a new block |
| [USER_FEEDBACK_SECURITY.md](USER_FEEDBACK_SECURITY.md) | 8-threat model (T1–T8) · layered controls · server-composed body invariant · preview-before-send |

### Tier 2 — sub-patterns invoked by the pipeline

| Doc | Covers |
|---|---|
| [SCRATCHPAD_PATTERN.md](SCRATCHPAD_PATTERN.md) | Write-revise-structure · per-run + per-entity layering · version-lock + drift detection |
| [PROSEMIRROR_DECORATIONS.md](PROSEMIRROR_DECORATIONS.md) | Decoration-first rendering · accept-to-convert · anchor points · collaborative safety |
| [AGENT_OBSERVABILITY.md](AGENT_OBSERVABILITY.md) | Live trace tree in chat · per-node metrics rollups · streaming via Convex reactivity |
| [SESSION_ARTIFACTS.md](SESSION_ARTIFACTS.md) | Live panel · wrap-up modal · pending strip · keep/dismiss/skip semantics |

### Tier 3 — feature-level architecture

| Doc | Covers |
|---|---|
| [FOUNDER_FEATURE.md](FOUNDER_FEATURE.md) | Founder as a detected trait · Me + Reports trickles · `/founder` smart routing |
| [REPORTS_AND_ENTITIES.md](REPORTS_AND_ENTITIES.md) | Reports grid · Entity page modes (Classic / Notebook / Live) · freshness tiering · owner-only actions |
| [AUTH_AND_SHARING.md](AUTH_AND_SHARING.md) | Public-by-default entity URLs · anonymous session fidelity · Gmail/GitHub claim flow · named-member invites |

### Tier 4 — cross-cutting

| Doc | Covers |
|---|---|
| [MCP_INTEGRATION.md](MCP_INTEGRATION.md) | 350-tool MCP server · progressive discovery · presets · CLI subcommands · install |
| [EVAL_AND_FLYWHEEL.md](EVAL_AND_FLYWHEEL.md) | Current eval harness · Karpathy-style flywheel **deferred** to v2 (trigger: 100 promoted + 20 rejection reasons) |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Glass card DNA · warm terracotta accent · Manrope + JetBrains Mono · state pills · freshness colors |

## Active addenda

These files are active architecture memos attached to current product loops. They
do not change the 13-doc canonical count until their content is consolidated.

| Doc | Covers |
|---|---|
| [GRAPH_SEARCH_AGENT_CONTEXT.md](GRAPH_SEARCH_AGENT_CONTEXT.md) | Graph/search/agent-context strategy - exact product questions preserved - node attention model - scale projection - human-vs-agent retrieval packets |

## How to navigate

- Each doc follows the same template: TL;DR · Prior art · Invariants · Architecture · Data model · Failure modes · How to extend · Related · Changelog.
- "Related" sections at the bottom of each doc link horizontally. Follow them.
- Every doc lists what it **supersedes** — older files moved to `archive/` with full provenance.

## What's NOT in this folder

The following live elsewhere:

- **Rules** that agents working in this repo must follow → [`../../.claude/rules/`](../../.claude/rules/)
- **Skills** (how-to reusables) → [`../../.claude/skills/`](../../.claude/skills/)
- **Guides** (contributor how-tos) → [`../guides/`](../guides/)
- **Changelog** → [`../changelog/`](../changelog/)
- **Benchmark data + history** → [`../../benchmarks/`](../../benchmarks/)

## Adding a new architecture doc

1. Confirm the topic is genuinely new — check existing docs first; extend if possible.
2. Follow the strict template (see [`../README.md`](../README.md)).
3. Cite prior art (company + pattern).
4. Add an entry to this README with a one-line description.
5. If superseding older docs, list them in your new doc's `Supersedes:` field and `git mv` them to `archive/`.

## Status of WIP files still in this folder

Alongside the 13 canonical docs, a small number of point-in-time working files may remain while their content is being absorbed (e.g., active build plans, notebook runbooks, migration specs). These are temporary — they'll either be consolidated into a canonical doc or moved to `archive/` when no longer current.

## Changelog

| Date | Change |
|---|---|
| 2026-05-15 | Added active addendum for graph/search/agent-context strategy and linked it from the architecture index |
| 2026-04-19 | Consolidated 124 architecture MDs → 13 canonical docs · established template · wrote this index |
