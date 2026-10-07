#!/usr/bin/env node
/**
 * Sentinel Swarm Orchestrator — Parallel diagnostic specialists
 *
 * Spawns 3 specialist agents in parallel for faster diagnosis:
 *   1. Visual Sentinel  — screenshots, Gemini QA, design lint, dogfood
 *   2. Structural Sentinel — build, TypeScript, imports, bundle
 *   3. Behavioral Sentinel — E2E, voice, a11y, interactions
 *
 * Then serializes the fix phase (one agent at a time to avoid conflicts).
 *
 * Usage:
 *   node scripts/sentinel/swarm.mjs                    # full swarm run
 *   node scripts/sentinel/swarm.mjs --diagnose-only    # parallel diagnosis, no fixes
 *   node scripts/sentinel/swarm.mjs --max-iterations 3 # limit fix iterations
 *
 * This script generates Claude Code swarm prompts — it does NOT spawn agents directly.
 * Feed these prompts to Claude Code's Task/Teammate system.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { SENTINEL_FIX_PROMPT_RELATIVE, appSourcePath } from './paths.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SENTINEL_DIR = join(ROOT, '.sentinel');
const PROMPTS_DIR = join(SENTINEL_DIR, 'swarm-prompts');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const diagnoseOnly = args.includes('--diagnose-only');
const maxIterations = (() => {
  const idx = args.indexOf('--max-iterations');
  return idx >= 0 ? parseInt(args[idx + 1]) || 5 : 5;
})();

mkdirSync(PROMPTS_DIR, { recursive: true });

// ── Specialist Prompts ───────────────────────────────────────────────────────

const VISUAL_SENTINEL = `
# Visual Sentinel — Design & Screenshot Quality

You are the Visual Sentinel. Your job is to verify the visual quality of every view in NodeBench AI.

## Your Probes
1. Run: \`node scripts/ui/designLinter.mjs --json\`
   - Parse violations, focus on high-severity
   - Check color token compliance, typography, focus rings
2. Run: \`node scripts/overstory/ci-qa-check.mjs\`
   - Verify dogfood artifacts exist and are fresh
3. Check: \`public/dogfood/qa-results.json\`
   - Read Gemini QA scores
   - Flag any criteria below 70/100
4. Scan for:
   - Hardcoded hex colors in ${appSourcePath()} (grep for #[0-9a-f]{6})
   - bg-white / text-black without dark mode variant
   - Missing prefers-reduced-motion checks on animations

## Output Format
Write your findings to: .sentinel/visual-diagnosis.json
Schema:
{
  "agent": "visual-sentinel",
  "timestamp": "<ISO>",
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "color|typography|motion|dogfood|visual-qa",
      "symptom": "<what's wrong>",
      "rootCause": "<why>",
      "affectedFiles": ["<path>"],
      "suggestedFix": "<what to do>"
    }
  ]
}

## Rules
- Read-only. Do NOT modify any files.
- Be specific: include file paths and line numbers.
- Prioritize high-severity issues that affect multiple views.
`;

const STRUCTURAL_SENTINEL = `
# Structural Sentinel — Build & Code Quality

You are the Structural Sentinel. Your job is to verify the structural integrity of the codebase.

## Your Probes
1. Run: \`npx tsc --noEmit --pretty false 2>&1 | head -100\`
   - Collect all TypeScript errors
   - Classify by error code (TS2345, TS2322, etc.)
2. Check imports:
   - Search for circular imports: files that import each other
   - Search for dead imports: imported but unused symbols
3. Check bundle:
   - If dist/ exists, find chunks > 500KB
   - Check for duplicate dependencies in node_modules
4. Verify file structure:
   - Every view in ${appSourcePath('features/')} has matching E2E test
   - Every hook in ${appSourcePath('hooks/')} is imported somewhere
   - No orphan files (created but never imported)

## Output Format
Write your findings to: .sentinel/structural-diagnosis.json
Same schema as Visual Sentinel but categories: build|import|bundle|structure

## Rules
- Read-only. Do NOT modify any files.
- Focus on issues that BLOCK the build or cause runtime errors.
- TypeScript errors are always CRITICAL severity.
`;

const BEHAVIORAL_SENTINEL = `
# Behavioral Sentinel — E2E & Interaction Quality

You are the Behavioral Sentinel. Your job is to verify that every interaction in NodeBench AI works correctly.

## Your Probes
1. Run: \`npx playwright test --reporter=json --project=chromium 2>&1\`
   - Collect all test failures
   - Read test-results.json for structured results
2. Voice coverage:
   - Read ${appSourcePath('hooks/useVoiceIntentRouter.ts')}
   - Read ${appSourcePath('hooks/useCockpitRouting.ts')}
   - Cross-reference: every MainView must have a voice alias
   - Every voice command must have an E2E test in evals/e2e/voice-input.spec.ts
3. Accessibility:
   - grep for buttons without aria-label
   - grep for interactive elements < 44px (w-8 h-8 or smaller)
   - Check skip links exist (${appSourcePath('components/SkipLinks.tsx')})
   - Verify focus management on view transitions
4. Keyboard navigation:
   - Check keyboard handlers across ${appSourcePath()} cover the active views
   - Verify Escape closes modals/panels
   - Check tab order makes sense (no tabIndex > 0)

## Output Format
Write your findings to: .sentinel/behavioral-diagnosis.json
Same schema but categories: e2e|voice|a11y|keyboard

## Rules
- Read-only. Do NOT modify any files.
- E2E failures are HIGH severity.
- Missing voice coverage is MEDIUM severity.
- A11y violations are MEDIUM severity (HIGH if they block screen readers).
`;

const FIXER_PROMPT = `
# Sentinel Fixer — Autonomous Fix Agent

You are the Sentinel Fixer. You receive a merged diagnosis from 3 specialist agents and fix issues in priority order.

## Input
Read these diagnosis files:
- .sentinel/visual-diagnosis.json
- .sentinel/structural-diagnosis.json
- .sentinel/behavioral-diagnosis.json
- .sentinel/diagnoses.json (from Layer 2 deterministic analysis)

## Merge & Triage
1. Combine all findings into a single list
2. Deduplicate by affected file + symptom
3. Sort: CRITICAL > HIGH > MEDIUM > LOW, then by blast radius
4. Cap at 10 fixes per iteration

## Fix Protocol
For each issue (highest priority first):

1. **Read** every affected file before modifying
2. **Understand** the root cause — trace upstream, don't bandaid
3. **Fix** with minimal changes
4. **Verify** immediately:
   - Build issues: \`npx tsc --noEmit\`
   - E2E issues: \`npx playwright test <file> --project=chromium\`
   - Design issues: \`node scripts/ui/designLinter.mjs --json\`
   - Voice issues: re-read the file and verify
5. **Commit or revert**: if verify passes, continue. If fails, revert with \`git checkout -- <file>\`

## Iteration
After fixing all issues in one pass:
1. Re-run: \`node scripts/sentinel/runner.mjs --json\`
2. Re-run: \`node scripts/sentinel/diagnose.mjs --json\`
3. If new failures: fix those too (up to ${maxIterations} iterations)
4. If stuck on same issue 3x: mark as BLOCKED and skip

## Output
Write: .sentinel/fix-report.json
{
  "iterations": N,
  "fixed": [{ "id": "diag-001", "file": "...", "action": "..." }],
  "blocked": [{ "id": "diag-005", "reason": "..." }],
  "remaining": N
}
`;

// ── Write Prompts ────────────────────────────────────────────────────────────

const prompts = {
  'visual-sentinel.md': VISUAL_SENTINEL,
  'structural-sentinel.md': STRUCTURAL_SENTINEL,
  'behavioral-sentinel.md': BEHAVIORAL_SENTINEL,
  'fixer.md': FIXER_PROMPT,
};

for (const [name, content] of Object.entries(prompts)) {
  writeFileSync(join(PROMPTS_DIR, name), content.trim() + '\n');
}

// ── Generate Orchestration Script ────────────────────────────────────────────

const orchestrationInstructions = `
# Sentinel Swarm — Orchestration Instructions

## How to Run This Swarm

### Option A: Claude Code TeammateTool (recommended)

\`\`\`javascript
// 1. Create team
Teammate({ operation: "spawnTeam", team_name: "sentinel" })

// 2. Spawn 3 diagnosis specialists in parallel
Task({ team_name: "sentinel", name: "visual-sentinel", subagent_type: "Explore",
  prompt: fs.readFileSync('.sentinel/swarm-prompts/visual-sentinel.md', 'utf8'),
  run_in_background: true })

Task({ team_name: "sentinel", name: "structural-sentinel", subagent_type: "Explore",
  prompt: fs.readFileSync('.sentinel/swarm-prompts/structural-sentinel.md', 'utf8'),
  run_in_background: true })

Task({ team_name: "sentinel", name: "behavioral-sentinel", subagent_type: "Explore",
  prompt: fs.readFileSync('.sentinel/swarm-prompts/behavioral-sentinel.md', 'utf8'),
  run_in_background: true })

// 3. Wait for all 3 to complete (check inboxes)
// 4. Spawn fixer (serial, not parallel — it modifies files)
Task({ team_name: "sentinel", name: "fixer", subagent_type: "general-purpose",
  prompt: fs.readFileSync('.sentinel/swarm-prompts/fixer.md', 'utf8') })

// 5. Cleanup
Teammate({ operation: "requestShutdown", target_agent_id: "visual-sentinel" })
Teammate({ operation: "requestShutdown", target_agent_id: "structural-sentinel" })
Teammate({ operation: "requestShutdown", target_agent_id: "behavioral-sentinel" })
Teammate({ operation: "requestShutdown", target_agent_id: "fixer" })
Teammate({ operation: "cleanup" })
\`\`\`

### Option B: Sequential (no swarm infra needed)

\`\`\`bash
# Phase 1: Test
node scripts/sentinel/runner.mjs

# Phase 2: Diagnose
node scripts/sentinel/diagnose.mjs

# Phase 3: Feed to Claude Code as a single agent
# Use ${SENTINEL_FIX_PROMPT_RELATIVE} as the prompt
\`\`\`

### Option C: npm scripts

\`\`\`bash
npm run sentinel              # full pipeline: test → diagnose → report
npm run sentinel:test         # Layer 1 only
npm run sentinel:diagnose     # Layer 2 only
npm run sentinel:report       # print latest report
\`\`\`

## Swarm Architecture

\`\`\`
                 ┌─────────────────────┐
                 │   Sentinel Leader    │
                 │ (runner.mjs +        │
                 │  diagnose.mjs)       │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
    ┌─────────▼──┐  ┌──────▼──────┐  ┌──▼──────────┐
    │   Visual   │  │ Structural  │  │ Behavioral  │
    │  Sentinel  │  │  Sentinel   │  │  Sentinel   │
    │            │  │             │  │             │
    │ - design   │  │ - tsc       │  │ - E2E       │
    │ - dogfood  │  │ - imports   │  │ - voice     │
    │ - gemini   │  │ - bundle    │  │ - a11y      │
    │ - motion   │  │ - structure │  │ - keyboard  │
    └─────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
          └────────┬───────┘                │
                   │  merge + triage        │
                   ├────────────────────────┘
                   ▼
          ┌────────────────┐
          │  Sentinel Fixer │
          │  (serial, 1    │
          │   agent only)  │
          │                │
          │  fix → verify  │
          │  → fix → verify│
          │  (max 5 iters) │
          └────────┬───────┘
                   │
                   ▼
          ┌────────────────┐
          │  Final Report   │
          │  .sentinel/     │
          └────────────────┘
\`\`\`

## Generated: ${new Date().toISOString()}
`;

writeFileSync(join(PROMPTS_DIR, 'ORCHESTRATION.md'), orchestrationInstructions.trim() + '\n');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('=== Sentinel Swarm Prompts Generated ===\n');
console.log('Files:');
for (const name of Object.keys(prompts)) {
  console.log(`  .sentinel/swarm-prompts/${name}`);
}
console.log(`  .sentinel/swarm-prompts/ORCHESTRATION.md\n`);
console.log(`Diagnosis mode: ${diagnoseOnly ? 'DIAGNOSE ONLY' : 'FULL (diagnose + fix)'}`);
console.log(`Max iterations: ${maxIterations}`);
console.log('\nTo run: follow instructions in .sentinel/swarm-prompts/ORCHESTRATION.md');
