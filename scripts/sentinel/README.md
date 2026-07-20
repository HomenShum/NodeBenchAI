# Sentinel — Self-Testing, Self-Diagnosing, Self-Correcting

Three-layer autonomous quality system for NodeBench AI.

## Quick Start

```bash
# Full pipeline: test all probes → diagnose failures → print report
npm run sentinel

# Individual layers
npm run sentinel:test         # Layer 1: run 8 probes
npm run sentinel:diagnose     # Layer 2: analyze & triage failures
npm run sentinel:swarm        # Generate swarm prompts for parallel diagnosis
npm run sentinel:fix          # Show fix instructions
npm run sentinel:json         # JSON output for piping
```

## Architecture

```
Layer 1: SELF-TESTING (runner.mjs)
  8 probes run in sequence, each returns pass/fail/warn/skip:
  ┌──────────┬──────────┬──────────┬──────────┐
  │  build   │   e2e    │  design  │ dogfood  │
  │ tsc+vite │playwright│  linter  │  qa-gate │
  ├──────────┼──────────┼──────────┼──────────┤
  │  voice   │   a11y   │  visual  │   perf   │
  │ coverage │  static  │gemini-qa │  bundle  │
  └──────────┴──────────┴──────────┴──────────┘
  Output: .sentinel/latest.json (SentinelReport)

Layer 2: SELF-DIAGNOSING (diagnose.mjs)
  Pattern-matches failures → root-cause analysis → triage:
  - TypeScript errors → classify by TS code → suggest fix
  - E2E failures → classify by error type → map to source files
  - Design violations → parse linter output → identify tokens
  - Dogfood staleness → check artifact freshness
  - Voice gaps → cross-reference aliases vs views
  - A11y violations → identify touch target / aria issues
  Output: .sentinel/diagnoses.json (triaged DiagnosisItems)

Layer 3: SELF-CORRECTING (evals/prompts/sentinel-self-test.md)
  Autonomous agent prompt that:
  1. Runs Layer 1 + 2
  2. For each diagnosis (highest severity first):
     read → understand → fix → verify → next
  3. Re-runs probes after fixes
  4. Loops until green or budget exhausted (5 iterations)
```

## Swarm Mode

For large-scale issues, the swarm splits diagnosis across 3 parallel specialists:

```
┌────────────────┐  ┌──────────────────┐  ┌───────────────────┐
│ Visual Sentinel │  │Structural Sentinel│  │Behavioral Sentinel│
│ design + dogfood│  │  build + imports  │  │  e2e + voice +    │
│ + gemini QA     │  │  + bundle + deps  │  │  a11y + keyboard  │
└───────┬────────┘  └────────┬─────────┘  └────────┬──────────┘
        └──────────┬─────────┘                     │
                   ▼ merge + triage                │
            ┌──────┴─────────────────────────────┘
            ▼
     ┌─────────────┐
     │Sentinel Fixer│  (serial — one agent modifying files)
     └─────────────┘
```

Generate swarm prompts: `npm run sentinel:swarm`
Then follow `.sentinel/swarm-prompts/ORCHESTRATION.md`

## Report Schema

```typescript
SentinelReport {
  id: string              // "sentinel-{timestamp}"
  probes: ProbeResult[]   // 8 probe results
  diagnoses: DiagnosisItem[]  // triaged issues
  fixes: FixAttempt[]     // what was attempted
  summary: { total, passed, failed, warned, skipped }
  iterations: number      // fix-verify cycles completed
}
```

## Adding a New Probe

1. Write an `async function probeYourThing()` in `runner.mjs`
2. Return `{ probe, category, status, duration, summary, failures, meta }`
3. Add to `PROBES` array
4. Add matching `DIAGNOSTIC_PATTERNS` entry in `diagnose.mjs`
5. Add category to `PROBE_CATEGORIES` in `schema.mjs`

## Files

| File | Role |
|------|------|
| `scripts/sentinel/schema.mjs` | Shared types, report helpers, triage sort |
| `scripts/sentinel/runner.mjs` | Layer 1: run probes, generate report |
| `scripts/sentinel/diagnose.mjs` | Layer 2: pattern-match failures, root-cause |
| `scripts/sentinel/index.mjs` | Main entry: test → diagnose → report |
| `scripts/sentinel/swarm.mjs` | Generate swarm agent prompts |
| `evals/prompts/sentinel-self-test.md` | Layer 3: autonomous fixer agent prompt |
| `.sentinel/` | Ephemeral reports (gitignored) |
