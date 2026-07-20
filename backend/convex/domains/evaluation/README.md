# Agent Evaluation Suite

A deterministic, boolean-only evaluation framework for testing agent responses against ground truth data derived from `audit_mocks.ts` and the 10 persona quality gates.

## Overview

This evaluation suite provides:

1. **Ground Truth Dataset** - Verified facts for 12 entities with required/forbidden facts
2. **Boolean-Only Scoring** - 19 factors scored as TRUE/FALSE, no partial credit
3. **Persona-Specific Thresholds** - Different passing criteria for each persona
4. **Test Harness** - Run evaluations via Convex actions or Playwright tests

## Quick Start

### Run Mock Evaluation (Framework Testing)

```bash
npx tsx scripts/run-agent-eval.ts --mock
```

### Run Live Evaluation (Against Actual Agent)

Uses anonymous session with 5 free queries/day:

```bash
# Run all queries
npx tsx scripts/run-live-eval.ts

# Run specific query
npx tsx scripts/run-live-eval.ts --query banker-disco-1

# Filter by persona
npx tsx scripts/run-live-eval.ts --persona JPM_STARTUP_BANKER

# Limit number of queries
npx tsx scripts/run-live-eval.ts --limit 3

# Verbose output (show response snippets)
npx tsx scripts/run-live-eval.ts --verbose
```

### Run Playwright Tests

```bash
# Framework validation tests
npx playwright test agent-eval-suite.spec.ts

# Live agent tests (requires running Convex)
npx playwright test agent-eval-suite.spec.ts --grep "Live"
```

## Ground Truth Entities

| Entity | Type | Location | Funding | Freshness | Banker PASS |
|--------|------|----------|---------|-----------|-------------|
| DISCO Pharmaceuticals | Private Company | Cologne, Germany | €36M Seed | ✓ Fresh | ✓ |
| Ambros Therapeutics | Private Company | Irvine, CA | $125M Series A | ✓ Fresh | ✓ |
| ClearSpace | Private Company | Switzerland | N/A | ✗ Stale | ✗ |
| OpenAutoGLM | OSS Project | - | N/A | ✓ Fresh | ✗ (not a company) |
| QuickJS | OSS Project | - | N/A | - | ✗ (not a company) |
| Salesforce | Public Company | San Francisco | Public | - | ✗ (not a startup) |
| NeuralForge AI | Private Company | San Francisco | $12M Seed | ✓ Fresh | ✓ |
| VaultPay | Private Company | London | $45M Series A | ✓ Fresh | ✓ |
| GenomiQ Therapeutics | Private Company | Boston | $80M Series B | ✓ Fresh | ✓ |

## 10 Persona Quality Gates

Each persona has specific requirements:

| Persona | Freshness | Primary Source | Funding | Contact | Pipeline |
|---------|-----------|----------------|---------|---------|----------|
| JPM_STARTUP_BANKER | ≤30 days | ✓ | ✓ | ✓ | ✓ |
| EARLY_STAGE_VC | ≤60 days | ✓ | ✓ | - | ✓ |
| CTO_TECH_LEAD | ≤365 days | ✓ | - | - | ✓ |
| FOUNDER_STRATEGY | ≤90 days | ✓ | ✓ | - | - |
| ACADEMIC_RD | ≤10 years | ✓ | - | - | - |
| ENTERPRISE_EXEC | ≤365 days | ✓ | - | ✓ | ✓ |
| ECOSYSTEM_PARTNER | ≤30 days | - | - | - | - |
| QUANT_ANALYST | ≤60 days | - | ✓ | - | - |
| PRODUCT_DESIGNER | - | - | - | - | - |
| SALES_ENGINEER | ≤90 days | - | ✓ | ✓ | ✓ |

## Boolean Evaluation Factors

All 19 factors are TRUE/FALSE only:

### Core Content
- `containsRequiredFacts` - Response includes all required facts
- `noForbiddenFacts` - Response excludes all forbidden facts
- `correctEntityType` - Correctly identifies entity type
- `correctLocation` - Mentions correct HQ location

### Funding
- `correctFundingStage` - Correct stage (Seed, Series A, etc.)
- `correctFundingAmount` - Correct amount (€36M, $125M, etc.)
- `correctInvestors` - Mentions at least one correct investor

### Freshness
- `acknowledgesFreshness` - Stale entities marked as stale
- `freshnessWithinPersonaWindow` - Meets persona's freshness requirement

### People
- `mentionsFounders` - Mentions at least one founder
- `mentionsCEO` - Mentions CEO if known

### Sources
- `citesPrimarySources` - Includes source citations
- `noFabricatedURLs` - No made-up URLs
- `noFabricatedMetrics` - No invented confidence scores

### Persona-Specific
- `meetsPersonaRequirements` - Meets all persona requirements
- `correctOutcome` - PASS when should PASS, FAIL when should FAIL

### Response Quality
- `isCoherent` - Response is not garbled
- `isActionable` - Contains actionable information
- `noHallucinations` - No facts contradicting ground truth

## Critical Factors (Must Pass)

For overall PASS, these must ALL be TRUE:
1. `containsRequiredFacts`
2. `noForbiddenFacts`
3. `correctOutcome`
4. `isCoherent`
5. `noHallucinations`

## Passing Thresholds

- **Overall**: 75% of queries must pass
- **JPM_STARTUP_BANKER**: 80% (stricter for banker)
- **CTO_TECH_LEAD**: 80% (stricter for technical)
- **ACADEMIC_RD**: 80% (stricter for research)
- **Other personas**: 70-75%

## Files

```
convex/domains/evaluation/
├── groundTruth.ts      # Ground truth entities and test queries
├── booleanEvaluator.ts # Evaluation logic (19 boolean factors)
├── evalHarness.ts      # Convex actions for running evaluations
├── index.ts            # Module exports
└── README.md           # This file

convex/tools/evaluation/
└── groundTruthLookup.ts  # Agent tools for ground truth access

scripts/
└── run-agent-eval.ts   # CLI evaluation runner

tests/
└── agent-eval-suite.spec.ts  # Playwright tests
```

## Agent Integration

The coordinator agent has access to:

1. **`lookupGroundTruth`** - Check verified data for known entities
2. **`listGroundTruthEntities`** - List all entities in ground truth

When asked about evaluation entities, the agent should:
1. Call `lookupGroundTruth` first
2. Include all required facts from ground truth
3. Exclude all forbidden facts
4. Return correct PASS/FAIL outcome for persona

## Example Evaluation Query

**Query**: "Tell me about DISCO Pharmaceuticals for banker outreach"

**Expected Response Must Include**:
- €36M
- Seed
- Cologne
- surfaceome
- Mark Manfredi

**Must NOT Include**:
- Series A (wrong - it's Seed)
- San Francisco (wrong - it's Cologne)

**Expected Outcome**: PASS for JPM_STARTUP_BANKER

## Adding New Ground Truth Entities

To add a new entity:

1. Add to `GROUND_TRUTH_ENTITIES` in `groundTruth.ts`:
```typescript
{
  entityId: "NEW_ENTITY",
  entityType: "private_company",
  canonicalName: "New Entity Inc.",
  requiredFacts: ["fact1", "fact2"],
  forbiddenFacts: ["wrong_fact"],
  funding: { stage: "Seed", ... },
  freshnessAgeDays: 10,
  withinBankerWindow: true,
  expectedPassPersonas: ["JPM_STARTUP_BANKER"],
  expectedFailPersonas: [],
}
```

2. Add test queries to `TEST_QUERIES`:
```typescript
{
  id: "banker-newentity-1",
  query: "Tell me about New Entity for banker outreach",
  targetEntityId: "NEW_ENTITY",
  targetPersona: "JPM_STARTUP_BANKER",
  expectedOutcome: "PASS",
  requiredFactsInResponse: ["fact1", "fact2"],
  forbiddenFactsInResponse: ["wrong_fact"],
  description: "Banker should get fresh seed company",
}
```

3. Update `lookupGroundTruth` instructions if needed

## Continuous Testing Workflow

### Daily Automated Testing

The evaluation suite supports continuous testing with anonymous sessions:

```bash
# Add to CI/CD or cron job
npx tsx scripts/run-live-eval.ts --limit 5

# Check exit code: 0 = passing (≥75%), 1 = failing
echo $?
```

### Testing Modes

| Mode | Description | Usage |
|------|-------------|-------|
| **Mock** | Tests evaluation framework only | `--mock` flag |
| **Anonymous** | Live agent, 5 free queries/day per session | Default in `run-live-eval.ts` |
| **Authenticated** | Live agent, no limits, stored in DB | Via Convex action |
| **Batch** | Multiple queries in single run | Via `runBatchEvalAuthenticated` |

### Evaluation Run Storage

Live evaluations are stored in the `evaluationRuns` table:

- `sessionId` - Unique session identifier
- `userId` - Optional authenticated user
- `mode` - "anonymous" | "authenticated" | "batch"
- `status` - "running" | "completed" | "failed"
- `results` - Array of individual query results
- `summary` - Pass rate, threshold, isPassing

Query evaluation history:
```typescript
// Get recent runs
const runs = await ctx.runQuery(api.domains.evaluation.liveEval.getRecentEvalRuns, { limit: 10 });

// Get specific run status
const run = await ctx.runQuery(api.domains.evaluation.liveEval.getEvalRunStatus, { runId });
```

### Continuous Improvement Process

After each evaluation run:

1. Check `commonFailures` in summary
2. Identify patterns (e.g., "Missing founder information")
3. Update agent instructions or tools
4. Re-run evaluation
5. Document changes in CHANGELOG

### CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: Agent Evaluation
on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9 AM
  workflow_dispatch:

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Run Evaluation
        run: npx tsx scripts/run-live-eval.ts --limit 5
        env:
          CONVEX_URL: ${{ secrets.CONVEX_URL }}
```

Target: **≥75% overall pass rate** with **≥80% for JPM_STARTUP_BANKER**
