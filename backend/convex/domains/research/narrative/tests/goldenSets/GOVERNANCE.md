# Golden Set Governance (DRANE/Newsroom)

This document defines the minimum governance controls required for the DRANE/Newsroom golden sets to be audit-defensible.

## Scope

- Applies to all suites under `convex/domains/narrative/tests/goldenSets/suites/`.
- The suite JSON is the source of truth; `generatedCases.ts` is a compiled artifact.

## Roles

- **Owners**: Named in each suite’s `governance.owners`.
- **Labelers/Authors**: Create or update cases, including expected persisted-output assertions.
- **Adjudicators**: Resolve disputes between labelers and approve promotions.
- **Maintainers**: Run CI gates and cut suite versions.

## Versioning & Change Control

- Suites are versioned by `suiteId` + `version`.
- Any change that affects:
  - stable-ID derivation inputs,
  - dedup decision expectations,
  - claim/evidence requirements,
  - or expected persisted outputs,
  must bump the suite `version`.
- `generatedCases.ts` must be regenerated from suites via `npm run golden:build`.

## Case Requirements (what auditors will expect)

Each case must be able to produce a reproducible “repro pack” via `workflowId`:

- Deterministic inputs (`scout.injectedNewsItems`).
- Expected persisted outputs (counts and/or item-level matchers).
- Decision-surface coverage for:
  - dedup outcomes (create/skip/link_update),
  - claim→evidence bindings,
  - trace snapshot completeness (config hash, digests, etc.).

## Adjudication Policy (v1)

- Each case is reviewed by at least **2 labelers**.
- Disagreements are resolved by an adjudicator who records:
  - the final expected assertions,
  - and the rationale for any “interpretation”/“prediction” labeling expectations.

## Inter-Annotator Agreement (IAA)

Minimum targets (recorded per suite in `governance`):

- Overall κ ≥ 0.6
- High-risk strata κ ≥ 0.7

High-risk strata include: contradiction-heavy, low-credibility/satire, and update-chain cases.

## Promotion Gates

To promote a suite version to the “audit lane”:

- `npm run golden:check` passes.
- Deterministic QA suite passes on CI:
  - repeatability (same inputs → same persisted outputs),
  - stable ID/version compliance,
  - claim coverage and unsupported-claim thresholds,
  - expected persisted-output assertions.
- Any failures must be triaged and either fixed in code, fixed in expectations, or explicitly marked as an expected failure with documented rationale.

## Refresh Cadence & Drift

- Suites should be refreshed on a fixed cadence (e.g., every 30 days) and after major pipeline changes.
- When behavior changes are intended:
  - bump suite version,
  - add new cases for the new behavior,
  - keep prior versions for historical comparability.

