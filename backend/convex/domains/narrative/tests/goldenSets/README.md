# DRANE Golden Sets

This directory holds **authorable benchmark suites** for DRANE/Newsroom QA.

## Files

- `drane_golden_set.schema.json`: JSON Schema for golden-set suites (suite authoring contract).
- `suites/`: Source-of-truth JSON suites (benchmarks).
- `generatedCases.ts`: Generated Convex runtime module (no filesystem reads in actions).

## What "audit-complete" means (non-code deliverable)

Engineering controls (determinism, replay, stable IDs, immutable evidence, traces, QA gates) are necessary but not sufficient. Audit teams will also require:

- A **stratified benchmark corpus** (typically 200–500+ items).
- **Expected persisted-output assertions** at meaningful granularity (dedup decisions, update chains, claim→evidence bindings).
- A lightweight **dataset governance record** (owners, adjudication policy, refresh cadence).

## Commands

- Generate audit corpus suite JSON: `npm run golden:generate`
- Compile suites to Convex runtime module: `npm run golden:build`
- Verify generated output is up to date: `npm run golden:check`

## Runner

The deterministic QA runner lives in `convex/domains/narrative/tests/qaFramework.ts` and evaluates **persisted outputs** keyed by `workflowId`.

