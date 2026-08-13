/**
 * Meta tools — tool discovery and methodology guidance.
 * findTools helps agents discover what's available.
 * getMethodology teaches agents the development process.
 */

import { createRequire } from "node:module";
import type { McpTool } from "../types.js";

const _require = createRequire(import.meta.url);
function _isInstalled(pkg: string): boolean {
  try { _require.resolve(pkg); return true; } catch { return false; }
}

const METHODOLOGY_CONTENT: Record<string, Record<string, any>> = {
  verification: {
    title: "6-Phase Iterative Deep-Dive Verification Process",
    description:
      "Standard verification workflow for any non-trivial implementation. Run this before declaring any integration, migration, or protocol-level change done.",
    steps: [
      {
        phase: 1,
        name: "Context Gathering",
        description:
          "Launch parallel research into SDK/protocol specs, current codebase patterns, dispatcher/backend audits, and external API status. Use recon tools to structure this research.",
        tools: [
          "search_learnings",
          "run_recon",
          "check_framework_updates",
          "log_recon_finding",
        ],
        action:
          "Start with search_learnings for past issues. Call run_recon to structure your research (include projectContext for holistic view). Use check_framework_updates for known ecosystems. Log findings with log_recon_finding. Then call log_phase_findings with your context notes.",
      },
      {
        phase: 2,
        name: "Gap Analysis",
        description:
          "Compare findings against current implementation. Categorize each gap as CRITICAL/HIGH/MEDIUM/LOW.",
        tools: ["log_gap"],
        action:
          "Record each gap with severity, root cause, and fix strategy. Call log_phase_findings when complete.",
      },
      {
        phase: 3,
        name: "Implementation",
        description:
          "Fix CRITICAL and HIGH gaps first. Each fix is discrete and testable. Follow existing patterns.",
        tools: ["resolve_gap"],
        action:
          "Implement fixes, call resolve_gap for each. Call log_phase_findings when done.",
      },
      {
        phase: 4,
        name: "Testing & Validation",
        description:
          "Run tests at 5 layers: static (tsc), unit, integration, manual, live_e2e. ALL must pass.",
        tools: ["log_test_result", "run_closed_loop"],
        action:
          "Record each test with log_test_result. Use run_closed_loop for compile/lint/test cycle. Call log_phase_findings when all layers pass.",
      },
      {
        phase: 5,
        name: "Self-Closed-Loop Verification",
        description:
          "Parallel checks: spec compliance, functional correctness, argument compatibility. Any FAIL loops back to Phase 3.",
        tools: ["run_quality_gate"],
        action:
          "Run verification checks. If any fail, loop back to Phase 3. Call log_phase_findings with results.",
      },
      {
        phase: 6,
        name: "Document Learnings",
        description:
          "Record edge cases, gotchas, patterns discovered. This prevents future regressions.",
        tools: ["record_learning"],
        action:
          "Call record_learning for each discovery. Call log_phase_findings to complete the cycle.",
      },
    ],
    composesWith:
      "After completing, use promote_to_eval to feed test cases into the Eval loop.",
  },
  eval: {
    title: "Eval-Driven Development Loop",
    description:
      "Continuous improvement cycle. Changes only ship if evals improve — never on gut feel alone. The eval batch is the gatekeeper, not human intuition.",
    steps: [
      {
        step: 1,
        name: "Run Eval Batch",
        description:
          "Define test cases with input (prompt/scenario), intent (ground truth goal), and expected behavior.",
        tools: ["start_eval_run"],
        action: "Create an eval run with your test cases.",
      },
      {
        step: 2,
        name: "Execute & Record",
        description:
          "Run each test case. Record actual results, verdict (pass/fail/partial), telemetry, and judge notes.",
        tools: ["record_eval_result"],
        action:
          "For each case: execute it, then record what happened with record_eval_result.",
      },
      {
        step: 3,
        name: "Aggregate & Analyze",
        description:
          "Finalize the run. Compute pass rate, average score, failure patterns, and improvement suggestions.",
        tools: ["complete_eval_run"],
        action: "Call complete_eval_run to get aggregate scores.",
      },
      {
        step: 4,
        name: "Compare & Decide",
        description:
          "Compare against baseline. DEPLOY if improved, REVERT if regressed, INVESTIGATE if flat.",
        tools: ["compare_eval_runs"],
        action:
          "Call compare_eval_runs with baseline and candidate run IDs. Follow the recommendation.",
      },
      {
        step: 5,
        name: "Track Over Time",
        description:
          "Monitor eval history for drift. Regressions trigger verification investigations.",
        tools: ["list_eval_runs", "trigger_investigation"],
        action:
          "Use list_eval_runs to spot trends. If regression detected, call trigger_investigation.",
      },
    ],
    composesWith:
      "Regressions trigger 6-Phase Verification via trigger_investigation.",
  },
  flywheel: {
    title: "The AI Flywheel (Verification × Eval)",
    description:
      "The 6-Phase Verification (inner loop) and Eval-Driven Development (outer loop) are not separate processes — they are nested loops that reinforce each other. Every verification produces eval artifacts. Every eval regression triggers verification.",
    steps: [
      {
        name: "Inner → Outer (Verification feeds Evals)",
        items: [
          "Phase 4 test cases become eval batch test cases with known-good expected outputs",
          "Phase 5 PASS/FAIL checklists become eval scoring rubrics",
          "Phase 6 edge cases become adversarial eval cases targeting discovered failure modes",
        ],
        tools: ["promote_to_eval"],
      },
      {
        name: "Outer → Inner (Evals trigger Verification)",
        items: [
          "Tool calling inefficiency → Phase 2 gap analysis on that tool",
          "Eval scores regress after deploy → Full Phase 1-6 cycle (treat as production incident)",
          "New tool/prompt change suggested → Phase 3 implementation + Phase 4-5 validation",
          "Recurring failure pattern → Phase 1 deep dive into root cause",
        ],
        tools: ["trigger_investigation"],
      },
      {
        name: "When to use which",
        items: [
          "Building/changing a feature → Run 6-Phase Verification (Is this correct?)",
          "Measuring system quality over time → Run Eval loop (Is this better?)",
          "Both, always → They compound. Every 6-Phase run produces eval artifacts. Every eval regression triggers 6-Phase.",
        ],
        tools: ["get_flywheel_status"],
      },
      {
        name: "Mandatory Minimum Verification",
        items: [
          "Every non-trivial change MUST pass the 6-step mandatory flywheel before being declared done.",
          "This is the floor, not the ceiling. The full 6-Phase cycle is the gold standard.",
          "Only skip for trivial changes (typos, comments, config) with explicit justification.",
          'Call getMethodology("mandatory_flywheel") for the full 6-step checklist and the variety-check dead-code example.',
        ],
        tools: ["run_mandatory_flywheel"],
      },
    ],
  },
  ui_ux_qa: {
    title: "UI/UX QA Verification (Frontend Changes)",
    description:
      "After any implementation that touches frontend UI — new components, layout changes, interaction updates — run this QA process before declaring work done. Uses existing testing infrastructure: Vitest, Playwright, Storybook, Lighthouse.",
    steps: [
      {
        step: 1,
        name: "Component Verification",
        description:
          "Run component tests for changed files. Check for React render errors, missing props, broken imports.",
        tools: ["run_closed_loop"],
        action:
          "Run `npm run test:run` to execute Vitest component tests. Run compile + lint + test closed loop. FAIL if any component test fails.",
      },
      {
        step: 2,
        name: "Visual & Layout QA",
        description:
          "Capture screenshots at 3 breakpoints (375px mobile, 768px tablet, 1280px desktop) using capture_responsive_suite. Verify visual consistency with adjacent components. Run Storybook to check component in isolation.",
        tools: ["capture_responsive_suite", "capture_ui_screenshot", "get_gate_preset"],
        action:
          'Call capture_responsive_suite(url, label) to screenshot at mobile/tablet/desktop. Visually inspect each capture. Run `npm run storybook` for isolated view. Call get_gate_preset("ui_ux_qa") for the full rule checklist.',
      },
      {
        step: 3,
        name: "Accessibility Audit",
        description:
          "Verify keyboard navigation (Tab order, Enter/Space activation). Check aria-labels on interactive elements. Run Storybook a11y addon panel for automated axe checks. Run Lighthouse accessibility audit.",
        tools: ["run_quality_gate"],
        action:
          "Tab through the changed UI. Check Storybook's Accessibility panel for axe violations. Record results.",
      },
      {
        step: 4,
        name: "Interaction & State QA",
        description:
          "Test loading states, error states, empty states. Verify form validation and error messages. Check hover/focus/active states on interactive elements.",
        tools: ["log_test_result"],
        action:
          'Manually test each interaction state. Log results with log_test_result(layer: "manual"). FAIL if any async operation lacks loading/error/empty states.',
      },
      {
        step: 5,
        name: "E2E Smoke Test",
        description:
          "Run relevant Playwright tests. If no existing test covers the change, write one. Capture screenshot for visual reference using capture_ui_screenshot.",
        tools: ["log_test_result", "capture_ui_screenshot"],
        action:
          'Run `npm run test:e2e` for Playwright tests. Call capture_ui_screenshot for visual reference of the final state. Log results with log_test_result(layer: "live_e2e"). If no test exists, create one in tests/e2e/.',
      },
      {
        step: 6,
        name: "Record & Gate",
        description:
          "Run the ui_ux_qa quality gate with boolean results for all 8 rules. Record learnings for any UI gotchas discovered.",
        tools: ["run_quality_gate", "record_learning"],
        action:
          'Evaluate all 8 rules from the ui_ux_qa preset. Call run_quality_gate(gateName: "ui_ux_qa", rules: [...]) with your results. Call record_learning for any UI patterns or gotchas discovered.',
      },
    ],
    composesWith:
      "Use after Phase 3 (Implementation) of a verification cycle when the change involves frontend code. The ui_ux_qa gate result feeds into Phase 5 (Self-Verification).",
    commands: {
      component_tests: "npm run test:run",
      e2e_tests: "npm run test:e2e",
      storybook: "npm run storybook",
      bundle_analysis: "npm run perf:bundle",
    },
  },
  flywheel_ui_dogfood: {
    title: "Flywheel Mode: UI Dogfood + Walkthrough Video QA",
    description:
      "Continuous UI verification loop: capture a full walkthrough video + screenshots, run Gemini-based video/screenshot QA, fix root causes (5-whys), and re-capture evidence until the UI is stable, accessible, and performant. Do not stop at 'build passes' — ship dogfood evidence.",
    steps: [
      {
        step: 1,
        name: "Launch + Trajectory",
        description:
          "Start the dev server and publish a visible trajectory link in the UI within 60 seconds. The trajectory is the audit trail of iterations and evidence.",
        tools: ["record_learning"],
        action:
          "Start dev server. Ensure `/dogfood` shows the latest manifest + walkthrough. Record a learning if trajectory/evidence is missing.",
      },
      {
        step: 2,
        name: "Capture Evidence (Scribe + Video)",
        description:
          "Run a full route walkthrough capture (screens + interactions) so issues are visible and replayable.",
        tools: ["capture_responsive_suite", "capture_ui_screenshot"],
        action:
          "Run `npm run dogfood:full:local` to generate `public/dogfood/*` (gallery + walkthrough video + frames + scribe).",
      },
      {
        step: 3,
        name: "Gemini QA (Video + Screens)",
        description:
          "Use Gemini video/screenshot understanding to flag UI regressions: flashes, layout shift, focus traps, broken empty states, and performance jank.",
        tools: ["analyze_ui_screenshot"],
        action:
          "Run `npm run dogfood:qa:gemini` and review results in `/dogfood`. Convert actionable issues into deterministic fixes (no band-aids).",
      },
      {
        step: 4,
        name: "Root Cause + Fix (5 Whys)",
        description:
          "At each checkpoint, immediately seek issues and follow symptom → intermediate state → root cause. Fix the cause so the symptom is impossible.",
        tools: ["run_closed_loop", "record_learning"],
        action:
          "Do a 5-whys chain. Implement the smallest correct fix. Re-run `tsc` + build. Record learnings for any repeated failure mode.",
      },
      {
        step: 5,
        name: "Motion Safety (Seizure / Flash Policy)",
        description:
          "Remove or soften high-contrast flashes (large-area pulses/fades). Ship stable backgrounds and subtle loading states. Always honor prefers-reduced-motion.",
        tools: ["run_quality_gate"],
        action:
          "FAIL if any route shows full-viewport flashing/pulsing/fade transitions. Prefer per-view fallbacks and non-animated skeletons for large surfaces.",
      },
      {
        step: 6,
        name: "Poll + Adapt",
        description:
          "Poll every 60 seconds. After 3 consecutive failures on the same issue, change strategy (instrument, isolate, or rollback).",
        tools: ["record_learning"],
        action:
          "Keep iterating until the dogfood artifacts + QA runs show no new P0/P1 issues.",
      },
    ],
    commands: {
      capture: "npm run dogfood:full:local",
      gemini_qa: "npm run dogfood:qa:gemini",
      build: "npm run build",
      typecheck: "npx tsc --noEmit",
    },
  },
  agentic_vision: {
    title: "Agentic Vision (AI-Powered Visual Verification)",
    description:
      "Use AI vision models to analyze UI screenshots programmatically. The Discover-Capture-Analyze-Manipulate-Iterate-Gate loop provides automated visual QA that goes beyond what rule-based checks can catch. Gemini with code execution provides the richest analysis (zoom, crop, compute within the model). Falls back to GPT-5-mini, Claude, or OpenRouter vision.",
    steps: [
      {
        step: 1,
        name: "Discover",
        description:
          "Check what vision capabilities are available in the current environment. API keys and SDKs determine which providers can be used for visual analysis.",
        tools: ["discover_vision_env"],
        action:
          "Call discover_vision_env to see available providers. If none are available, set an API key (GEMINI_API_KEY recommended for agentic vision with code execution).",
      },
      {
        step: 2,
        name: "Capture",
        description:
          "Take screenshots of the UI at relevant viewports. Use capture_responsive_suite for comprehensive coverage or capture_ui_screenshot for a specific viewport.",
        tools: ["capture_ui_screenshot", "capture_responsive_suite"],
        action:
          "Call capture_responsive_suite(url, label) for 3-breakpoint coverage, or capture_ui_screenshot(url) for a single viewport. Both return base64 images inline + console errors.",
      },
      {
        step: 3,
        name: "Analyze",
        description:
          "Send the captured screenshot to a vision model for AI-powered analysis. The model evaluates layout, spacing, typography, color, accessibility, and component states. Gemini with code execution can zoom into regions, measure distances, and annotate issues autonomously.",
        tools: ["analyze_screenshot"],
        action:
          'Call analyze_screenshot(imageBase64) with the base64 data from step 2. Optionally provide a custom prompt for focused analysis (e.g., "Check if the navigation menu is accessible on mobile"). Gemini will use code execution to zoom, crop, and compute.',
      },
      {
        step: 4,
        name: "Manipulate (Optional)",
        description:
          "If the analysis identifies specific regions of concern, crop or annotate the screenshot for deeper inspection or documentation. Crop to isolate a component, annotate to mark issues.",
        tools: ["manipulate_screenshot"],
        action:
          "Call manipulate_screenshot with operation='crop' to extract a region, or operation='annotate' to mark issues with bounding boxes and labels. Feed cropped images back to analyze_screenshot for focused analysis.",
      },
      {
        step: 5,
        name: "Iterate",
        description:
          "If issues were found, fix the code, re-capture, and re-analyze. Repeat until the analysis shows no CRITICAL or HIGH issues. This is the closed loop.",
        tools: ["capture_ui_screenshot", "analyze_screenshot"],
        action:
          "Fix identified issues in code. Re-capture the same URL. Re-analyze. Compare before/after. Continue until the vision model reports clean results.",
      },
      {
        step: 6,
        name: "Gate",
        description:
          "Run the ui_ux_qa quality gate using the vision analysis results to inform your boolean evaluation of each gate rule.",
        tools: ["run_quality_gate", "get_gate_preset", "record_learning"],
        action:
          'Call get_gate_preset("ui_ux_qa") for the 8 rules. Use vision analysis results to evaluate each rule with evidence. Call run_quality_gate with boolean results. Record any visual patterns or gotchas as learnings.',
      },
    ],
    composesWith:
      "Use after capture_ui_screenshot or capture_responsive_suite to add AI-powered analysis. Combines with ui_ux_qa methodology (getMethodology('ui_ux_qa')) for comprehensive frontend verification.",
    providerPriority: {
      gemini:
        "Best choice. Code execution enables agentic vision — model can zoom, crop, measure, annotate within its reasoning loop. Set GEMINI_API_KEY.",
      openai:
        "GPT-5-mini provides strong vision analysis without code execution. Set OPENAI_API_KEY.",
      anthropic:
        "Claude provides detailed text analysis of visual elements. Set ANTHROPIC_API_KEY.",
      openrouter:
        "Routes to various vision models via OpenAI-compatible API. Fallback option. Set OPENROUTER_API_KEY.",
    },
  },
  quality_gates: {
    title: "Quality Gates (Boolean Check Pattern)",
    description:
      "Deterministic pre-action validation using boolean checks. Define rules, evaluate each one, aggregate into pass/fail. Built-in presets: engagement (content quality), code_review (implementation quality), deploy_readiness (pre-deploy checklist), ui_ux_qa (frontend UI/UX verification).",
    steps: [
      {
        step: 1,
        name: "Get Rules",
        description:
          "Use a built-in preset or define custom rules. Each rule has a name, description, and evaluation hint.",
        tools: ["get_gate_preset"],
        action:
          'Call get_gate_preset with "engagement", "code_review", or "deploy_readiness" to get rule definitions.',
      },
      {
        step: 2,
        name: "Evaluate",
        description:
          "Check each rule against your target (content, code, PR). Record boolean pass/fail for each.",
        tools: [],
        action:
          "Evaluate each rule yourself. Note which pass and which fail.",
      },
      {
        step: 3,
        name: "Record Results",
        description:
          "Submit rule results. The tool aggregates score and persists the run.",
        tools: ["run_quality_gate"],
        action:
          "Call run_quality_gate with your boolean results. Review failures.",
      },
      {
        step: 4,
        name: "Track Trends",
        description: "Monitor pass/fail trends over time for each gate.",
        tools: ["get_gate_history"],
        action: "Call get_gate_history to see if quality is improving.",
      },
    ],
  },
  closed_loop: {
    title: "Closed Loop Verification",
    description:
      "Local green loop: compile → lint → test → self-debug. Never present changes to anyone without a full green loop. If any step fails: read logs, hypothesize, fix, restart from the failed step.",
    steps: [
      {
        step: 1,
        name: "Compile",
        description: "Build clean. No errors.",
        action: "Run your build command (tsc, go build, cargo build, etc.)",
      },
      {
        step: 2,
        name: "Lint",
        description: "Style clean. No warnings.",
        action: "Run your linter (eslint, golint, clippy, etc.)",
      },
      {
        step: 3,
        name: "Test",
        description: "Run automated test suites. All must pass.",
        action: "Run your test suite (jest, pytest, go test, etc.)",
      },
      {
        step: 4,
        name: "Self-Debug",
        description:
          "If steps 1-3 fail: read logs, hypothesize root cause, fix, restart loop.",
        action:
          "Analyze failures, implement fix, go back to step 1. Repeat until green.",
      },
    ],
    composesWith:
      "Record the loop result with run_closed_loop. Use as part of Phase 4 in a verification cycle.",
  },
  learnings: {
    title: "Learnings (Persistent Knowledge Base)",
    description:
      "Store edge cases, gotchas, patterns, and regressions discovered during development. Search before starting new work to avoid repeating mistakes. Always record learnings after completing a verification cycle.",
    steps: [
      {
        step: 1,
        name: "Search Before You Start",
        description:
          "Before implementing anything, search for relevant learnings from past work. Use search_all_knowledge for a unified view across learnings, recon findings, and resolved gaps.",
        tools: ["search_learnings", "search_all_knowledge"],
        action:
          'Call search_all_knowledge with what you\'re about to work on (e.g. "convex http routing"). This searches learnings, recon findings, AND resolved gaps in one call.',
      },
      {
        step: 2,
        name: "Record As You Go",
        description:
          "When you discover an edge case, gotcha, or pattern, record it immediately.",
        tools: ["record_learning"],
        action:
          "Call record_learning with key, content, category, and tags.",
      },
      {
        step: 3,
        name: "Browse & Review",
        description:
          "Periodically review the knowledge base to refresh your understanding.",
        tools: ["list_learnings"],
        action:
          "Call list_learnings with a category filter to browse specific types of learnings.",
      },
    ],
    composesWith:
      "Learnings are recorded in Phase 6 of verification cycles. They feed into future Phase 1 context gathering.",
  },
  mandatory_flywheel: {
    title: "Mandatory AI Flywheel Testing (Minimum 6 Steps)",
    description:
      "After any non-trivial code change, feature addition, or bug fix, this verification process MUST be run before declaring work done. This is not optional. It catches production bugs that smoke tests miss.",
    steps: [
      {
        step: 1,
        name: "Static Analysis",
        description:
          "Type checking must pass with zero errors. tsc --noEmit, convex dev --once --typecheck=enable, or your stack's equivalent.",
        action: "Run all static analysis tools. Must be completely green.",
      },
      {
        step: 2,
        name: "Happy-Path Test",
        description:
          "Run the changed functionality with valid inputs and confirm expected output.",
        action:
          "Execute the main use case with known-good inputs. Verify output matches expectations exactly.",
      },
      {
        step: 3,
        name: "Failure-Path Test",
        description:
          "Test each failure mode the code is supposed to handle: invalid inputs, edge cases, error states.",
        action:
          "Send bad inputs, trigger error paths, test boundary conditions. Ensure errors are handled, not swallowed silently.",
      },
      {
        step: 4,
        name: "Gap Analysis",
        description:
          "Review code for dead code, unused variables, missing integrations, or logic that doesn't match stated intent.",
        action:
          "Read the implementation line-by-line. Look for: data fetched but never used, conditionals always true/false, missing error handling, incomplete features.",
      },
      {
        step: 5,
        name: "Fix and Re-Verify",
        description:
          "If any gap is found, fix it and re-run steps 1-3 FROM SCRATCH. Don't just re-run the failed step.",
        action:
          "Fix the gap, then restart from step 1. The full re-run catches cascading issues the fix might introduce.",
      },
      {
        step: 6,
        name: "Deploy and Document",
        description:
          "Deploy the verified fix. Document any gaps found and how they were resolved.",
        tools: ["record_learning"],
        action:
          "Deploy to production. Call record_learning for each gap discovered during this process.",
      },
    ],
    whenToSkip:
      "Only skip for trivial changes where blast radius is near zero: typo fixes, comment updates, config tweaks with no code execution impact. All other changes require all 6 steps.",
    realWorldExample: {
      title: "The Variety Check Dead-Code Bug",
      description:
        "The first deployment of the pre-post verification pipeline had a bug where the variety check fetched scheduled queue items but never actually compared entities against them (dead code). This was only caught because the flywheel process was run after the initial 'it works' smoke tests. Without it, the bug would have gone to production silently.",
      lesson:
        "Smoke tests show 'it runs' but not 'it works correctly'. Step 4 (Gap Analysis) catches logic bugs that type systems and basic tests miss. Step 5 (Fix and Re-Verify from scratch) catches cascading issues.",
    },
    tools: ["run_mandatory_flywheel"],
  },
  reconnaissance: {
    title: "Reconnaissance & Research (Structured Phase 1 Context Gathering)",
    description:
      "Before implementing or fixing anything, gather comprehensive context about BOTH external sources (latest SDK versions, API changes, known issues) AND internal context (existing codebase patterns, project architecture, team conventions). Structure this research as a trackable recon session.",
    steps: [
      {
        step: 1,
        name: "Start Recon Session",
        description:
          "Define what you're researching and why. Provide project context (tech stack, versions, architecture) for holistic analysis.",
        tools: ["run_recon"],
        action:
          "Call run_recon with target, description, and projectContext. If project context is unknown, the tool will suggest questions to ask.",
      },
      {
        step: 2,
        name: "Check Framework Sources",
        description:
          "Use pre-built source checklists for known ecosystems: anthropic, langchain, openai, google, mcp.",
        tools: ["check_framework_updates"],
        action:
          "Call check_framework_updates for each relevant ecosystem. Visit each source URL systematically.",
      },
      {
        step: 3,
        name: "Visit Sources & Record Findings",
        description:
          "Check each source systematically. Record EVERY relevant finding — both from external sources and from the existing codebase.",
        tools: ["log_recon_finding"],
        action:
          "For each discovery: call log_recon_finding. Categories: breaking_change, new_feature, deprecation, best_practice, dataset, benchmark, codebase_pattern, existing_implementation.",
      },
      {
        step: 4,
        name: "Aggregate & Prioritize",
        description:
          "Review all findings grouped by category. Prioritize: breaking changes > deprecations > existing implementations > new features.",
        tools: ["get_recon_summary", "search_all_knowledge"],
        action:
          "Call get_recon_summary with completeSession=true. Use search_all_knowledge to cross-reference with past learnings and resolved gaps. Use prioritized action items to inform gap analysis.",
      },
    ],
    composesWith:
      "Use at the start of Phase 1 (Context Gathering) in a verification cycle. Findings inform Phase 2 (Gap Analysis). Also call search_learnings to check past findings.",
    categories: {
      breaking_change: "Requires immediate action before deploying",
      deprecation: "Plan migration path, may break in future",
      new_feature: "Potential improvements or capabilities to leverage",
      best_practice: "Recommended patterns or approaches",
      dataset: "Useful datasets or benchmarks for evaluation",
      benchmark: "Performance or quality baselines to evaluate against",
      codebase_pattern: "Existing patterns in the project codebase",
      existing_implementation:
        "Code that already handles part of what you're building",
    },
  },
  project_ideation: {
    title: "Project Ideation & Validation Process",
    description:
      "Structured approach for validating project concepts before development. Captures requirements, constraints, success metrics, and competitive analysis. Use this before starting any new project or major feature.",
    steps: [
      {
        phase: 1,
        name: "Define Concept",
        description:
          "Define the problem, target users, and core value proposition. Search existing knowledge for similar past projects.",
        tools: ["record_learning", "search_all_knowledge"],
        action:
          "Document the problem statement and why it matters. Call search_all_knowledge to check for similar past projects or relevant learnings.",
      },
      {
        phase: 2,
        name: "Research Market",
        description:
          "Validate demand, find prior art, and understand the competitive landscape.",
        tools: ["web_search", "search_github", "research_job_market"],
        action:
          "Use web_search for market research. Call search_github to find similar projects. Use research_job_market to understand skill demand.",
      },
      {
        phase: 3,
        name: "Analyze Competition",
        description:
          "Study competitor implementations, understand patterns, and identify differentiation opportunities.",
        tools: ["fetch_url", "analyze_repo"],
        action:
          "Use fetch_url to read competitor docs. Call analyze_repo to understand their tech stack and patterns. Note what to adopt vs. differentiate.",
      },
      {
        phase: 4,
        name: "Define Requirements",
        description:
          "List functional and non-functional requirements with priority and rationale.",
        tools: ["log_recon_finding", "update_agents_md"],
        action:
          "Record each requirement with log_recon_finding. Update AGENTS.md with project requirements using update_agents_md.",
      },
      {
        phase: 5,
        name: "Plan Metrics",
        description:
          "Define measurable success criteria and create baseline eval test cases.",
        tools: ["start_eval_run"],
        action:
          "Create eval test cases that represent success. Call start_eval_run with initial baseline cases.",
      },
      {
        phase: 6,
        name: "Gate Approval",
        description:
          "Document findings, run quality gate, and mark project as ready or needs rework.",
        tools: ["run_quality_gate", "record_learning"],
        action:
          "Call run_quality_gate with ideation rules. Record key decisions with record_learning. Mark project as approved or needs iteration.",
      },
    ],
    composesWith:
      "Phase 1 (Concept) informs verification cycle planning. Success metrics feed directly into eval batches. Requirements inform AGENTS.md documentation.",
  },
  tech_stack_2026: {
    title: "Tech Stack & Dependency Management (2026)",
    description:
      "Systematic approach to evaluating, documenting, and maintaining technology choices. Ensures alignment with project goals and minimizes tech debt. Run periodically or when considering new dependencies.",
    steps: [
      {
        step: 1,
        name: "Inventory Current Stack",
        description:
          "Document all frameworks, libraries, and tools in use with versions and purposes.",
        tools: ["record_learning", "search_all_knowledge", "setup_local_env"],
        action:
          "Call setup_local_env to detect current environment. List every dependency with version, purpose, and maintenance status. Use search_all_knowledge to find past tech decisions.",
      },
      {
        step: 2,
        name: "Evaluate Against Goals",
        description:
          "Compare each component against current project requirements. Check for updates and breaking changes.",
        tools: ["check_framework_updates", "web_search"],
        action:
          "For each major dependency, call check_framework_updates for known ecosystems. Use web_search for latest release notes and migration guides.",
      },
      {
        step: 3,
        name: "Research Alternatives",
        description:
          "Research newer or better-suited alternatives. Compare features, community, performance.",
        tools: ["search_github", "analyze_repo", "fetch_url"],
        action:
          "Use search_github to find promising alternatives. Call analyze_repo to understand their architecture. Use fetch_url to read their documentation.",
      },
      {
        step: 4,
        name: "Plan Migrations",
        description:
          "For each desired change, outline migration steps and risk assessment.",
        tools: ["log_gap"],
        action:
          "Log each migration as a gap with complexity and risk level. Prioritize: breaking changes > critical perf gains > nice-to-haves.",
      },
      {
        step: 5,
        name: "Document Rationale",
        description:
          "Record why each tech choice was made and when to reconsider.",
        tools: ["record_learning", "update_agents_md"],
        action:
          "Call record_learning with decision rationale, trade-offs, and review frequency. Update AGENTS.md Tech Stack section with update_agents_md.",
      },
    ],
    composesWith:
      "Migrations discovered become verification cycles. Findings inform agentic vision setup (provider choices). Updates feed into AGENTS.md maintenance.",
  },
  telemetry_setup: {
    title: "Telemetry & Instrumentation Setup",
    description:
      "Establish observability for system behavior, performance, and quality metrics. Build dashboards and alerting for early problem detection.",
    steps: [
      {
        step: 1,
        name: "Define Metrics & Signals",
        description:
          "Identify what to measure: latency, errors, quality scores, user actions.",
        tools: ["record_learning"],
        action:
          "Document each metric's purpose, collection method, and alerting thresholds. Call record_learning to persist the instrumentation plan.",
      },
      {
        step: 2,
        name: "Instrument Code",
        description:
          "Add logging, tracing, and metric collection to key functions.",
        tools: ["log_test_result"],
        action:
          "Add telemetry calls at phase boundaries. Use log_test_result to capture execution metrics during development.",
      },
      {
        step: 3,
        name: "Aggregate & Visualize",
        description:
          "Set up dashboards and queries to view metric trends.",
        action:
          "Build dashboards in your observability tool (DataDog, Prometheus, CloudWatch). Include: pass rates, cycle times, tool latencies.",
      },
      {
        step: 4,
        name: "Define Alerts & SLOs",
        description:
          "Create alert rules and service-level objectives.",
        action:
          "Set alert thresholds for critical metrics. Define SLOs: eval pass rate >95%, verification cycle time <4 hours.",
      },
      {
        step: 5,
        name: "Review & Adjust",
        description:
          "Periodically review telemetry to catch patterns and adjust thresholds.",
        tools: ["search_learnings", "get_gate_history", "list_eval_runs"],
        action:
          "Weekly review of metric trends. Use get_gate_history and list_eval_runs as data sources. Adjust thresholds as system matures.",
      },
    ],
    composesWith:
      "Telemetry data enriches verification and eval outputs. Use get_gate_history and list_eval_runs as dashboard data sources.",
  },
  agents_md_maintenance: {
    title: "AGENTS.md Documentation Maintenance",
    description:
      "Keep AGENTS.md synchronized with actual agent implementations, tool updates, and deployment procedures. Single source of truth for agent setup and troubleshooting.",
    steps: [
      {
        step: 1,
        name: "Audit Current Documentation",
        description:
          "Review AGENTS.md against actual implementations. Flag mismatches.",
        tools: ["update_agents_md", "search_all_knowledge"],
        action:
          'Call update_agents_md({ operation: "read" }) to see current sections. Compare against actual code. Use search_all_knowledge to find recent learnings.',
      },
      {
        step: 2,
        name: "Identify Changes",
        description:
          "List all recent code changes that impact agent setup or deployment.",
        tools: ["search_github", "setup_local_env"],
        action:
          "Call setup_local_env to check current environment. Use search_github to find recent changes in relevant repos. Note new tools, changed schemas, breaking changes.",
      },
      {
        step: 3,
        name: "Update Sections",
        description:
          "Sync AGENTS.md sections: tool catalog, setup steps, environment variables.",
        tools: ["update_agents_md", "record_learning"],
        action:
          'Call update_agents_md({ operation: "update_section", section: "...", content: "..." }) for each outdated section. Record gotchas with record_learning.',
      },
      {
        step: 4,
        name: "Verify with Real Setup",
        description:
          "Test setup steps on a clean machine or CI environment.",
        tools: ["run_closed_loop"],
        action:
          "Follow AGENTS.md steps exactly. Run run_closed_loop to verify build/test pass. If failures, update docs or fix the process.",
      },
      {
        step: 5,
        name: "Version & Schedule",
        description:
          "Document when AGENTS.md was last updated. Schedule periodic reviews.",
        tools: ["record_learning"],
        action:
          'Add timestamp header to AGENTS.md. Call record_learning with category "documentation" to schedule monthly review.',
      },
    ],
    composesWith:
      "AGENTS.md is the source of truth for Phase 1 context gathering. Keep in sync with actual implementations and tool changes.",
  },
  agent_bootstrap: {
    title: "Agent Self-Bootstrap & Triple Verification System",
    description:
      "Comprehensive system for agents to self-discover infrastructure, run triple verification with authoritative sources, self-implement missing components, and generate their own instructions. Based on patterns from Anthropic, OpenAI, LangChain, and OpenClaw.",
    steps: [
      {
        step: 1,
        name: "Discover Existing Infrastructure",
        description:
          "Scan codebase for existing agent patterns: agent_loop, telemetry, evaluation, verification, multi_channel, self_learning, governance.",
        tools: ["discover_infrastructure"],
        action:
          'Call discover_infrastructure to see what exists and what\'s missing. Returns bootstrap plan for missing components.',
      },
      {
        step: 2,
        name: "Triple Verification",
        description:
          "Run 3-layer verification: V1 internal codebase analysis, V2 external authoritative source validation (Anthropic, OpenAI, LangChain docs), V3 synthesis with source citations.",
        tools: ["triple_verify"],
        action:
          'Call triple_verify(target, scope="full", includeWebSearch=true). Gets authoritative sources from tier1 (Anthropic, OpenAI, LangChain, MCP spec) and tier2 (community best practices).',
      },
      {
        step: 3,
        name: "Self-Implement Missing Components",
        description:
          "Bootstrap missing infrastructure using production-ready templates: agent loops, telemetry, eval harness, governance.",
        tools: ["self_implement"],
        action:
          'Call self_implement(component, dryRun=true) to preview. Then dryRun=false to create files. Supports: agent_loop, telemetry, evaluation, verification, multi_channel, self_learning, governance.',
      },
      {
        step: 4,
        name: "Generate Self-Instructions",
        description:
          "Create agent instructions in various formats that persist across sessions.",
        tools: ["generate_self_instructions"],
        action:
          'Call generate_self_instructions with format: "skills_md" (SKILL.md), "rules_md" (RULES.md), "guidelines", or "claude_md" (CLAUDE.md). Includes authoritative source citations.',
      },
      {
        step: 5,
        name: "Connect Information Channels",
        description:
          "Aggressive multi-channel information gathering: slack, telegram, discord, email, web, github, docs.",
        tools: ["connect_channels"],
        action:
          'Call connect_channels with query and channels array. Set aggressive=true to also check calendars, meeting notes, PR comments.',
      },
    ],
    authoritativeSources: {
      tier1_authoritative: [
        "https://www.anthropic.com/research/building-effective-agents",
        "https://openai.github.io/openai-agents-python/",
        "https://www.langchain.com/langgraph",
        "https://modelcontextprotocol.io/specification/2025-11-25",
      ],
      tier2_reliable: [
        "https://github.com/openclaw/openclaw",
        "https://developers.cloudflare.com/agents/",
        "https://opentelemetry.io/blog/2025/ai-agent-observability/",
      ],
    },
    composesWith:
      "Use after discover_infrastructure to bootstrap missing pieces. Run triple_verify before any deployment. Generate self-instructions to persist learnings across sessions.",
  },
  autonomous_maintenance: {
    title: "Autonomous Self-Maintenance & Risk-Tiered Execution",
    description:
      "Aggressive autonomous self-management with risk-aware execution. Implements 're-update before create' pattern, Ralph Wiggum stop-hooks, and OpenClaw directory scaffolding. Ensures agents proactively maintain infrastructure without destructive accidents.",
    steps: [
      {
        step: 1,
        name: "Assess Risk Before Action",
        description:
          "Before any non-trivial action, assess its risk tier. Low-risk actions auto-approve, medium-risk log and proceed, high-risk require confirmation.",
        tools: ["assess_risk"],
        action:
          'Call assess_risk(action) before executing. Follow recommendation: auto_approve → proceed, log_and_proceed → log then proceed, require_confirmation → stop and ask.',
      },
      {
        step: 2,
        name: "Re-Update Before Create",
        description:
          "Before creating any new file (especially instructions/documentation), check if updating an existing file is better. Prevents file sprawl and maintains single source of truth.",
        tools: ["decide_re_update"],
        action:
          'Call decide_re_update({ targetContent, contentType, existingFiles }). Follow recommendation: update_existing → edit that file, create_new → proceed with new file, merge → add to appropriate section.',
      },
      {
        step: 3,
        name: "Run Self-Maintenance Cycle",
        description:
          "Periodic self-checks: TypeScript compilation, documentation sync, tool count validation, test coverage, dependency freshness.",
        tools: ["run_self_maintenance"],
        action:
          'Call run_self_maintenance({ scope: "standard" }) regularly. Use scope="thorough" weekly. Set autoFix=true for low-risk auto-corrections.',
      },
      {
        step: 4,
        name: "Scaffold with OpenClaw Patterns",
        description:
          "When adding new infrastructure, use standardized directory scaffolding. Creates organized subdirectories with proper test structure.",
        tools: ["scaffold_directory"],
        action:
          'Call scaffold_directory({ component, dryRun: true }) to preview. Then dryRun=false to create. Follow with self_implement for code templates.',
      },
      {
        step: 5,
        name: "Autonomous Loop with Guardrails",
        description:
          "For multi-step autonomous tasks, use controlled loops with iteration limits, timeouts, and checkpoint saves.",
        tools: ["run_autonomous_loop"],
        action:
          'Call run_autonomous_loop({ goal, maxIterations: 5, maxDurationMs: 60000, stopOnFirstFailure: true }). Review results before proceeding to next phase.',
      },
    ],
    riskTiers: {
      low: "Reading, analyzing, searching, creating temp files — auto-approve",
      medium: "Writing local files, running tests, creating branches — log and proceed",
      high: "Pushing to remote, posting externally, deleting, modifying production — require confirmation",
    },
    patterns: {
      ralph_wiggum: "Stop-hooks prevent runaway autonomous loops. Always set maxIterations and maxDurationMs.",
      re_update_before_create: "Check if existing files should be updated rather than creating new ones. Maintains single source of truth.",
      openclaw_scaffolding: "Standardized directory structure with convex/domains/{component}/ pattern.",
    },
    composesWith:
      "Use alongside agent_bootstrap for complete autonomous infrastructure setup. Feeds into triple_verify for validation.",
  },
  parallel_agent_teams: {
    title: "Parallel Agent Teams — Multi-Agent Coordination",
    description:
      'Based on Anthropic\'s "Building a C Compiler with Parallel Claudes" (Feb 2026). Patterns for running multiple AI agents in parallel on a shared codebase: task locking to prevent duplicate work, role specialization, context window budget management, oracle-based testing, and progress tracking for fresh agent sessions. Reference: https://www.anthropic.com/engineering/building-c-compiler',
    steps: [
      {
        step: 1,
        name: "Orient — Check Parallel Status",
        description:
          "Every new agent session starts by checking what other agents are doing. Avoid duplicate work. Review blocked tasks that need fresh eyes.",
        tools: ["get_parallel_status", "list_agent_tasks"],
        action:
          "Call get_parallel_status to see active tasks, roles, failed oracle tests, and context budgets. Then call list_agent_tasks to see what's claimed.",
      },
      {
        step: 2,
        name: "Assign Role — Specialize",
        description:
          "Assign yourself a role. Specialization enables parallelism: implementer, dedup_reviewer, performance_optimizer, documentation_maintainer, code_quality_critic, test_writer, security_auditor.",
        tools: ["assign_agent_role", "get_agent_role"],
        action:
          'Call assign_agent_role({ role: "implementer", focusArea: "auth module" }). Each parallel agent should have a different role or focus area.',
      },
      {
        step: 3,
        name: "Claim Task — Lock Before Working",
        description:
          "Claim a task lock before starting work. This prevents two agents from solving the same problem. If another agent already claimed the task, pick a different one.",
        tools: ["claim_agent_task"],
        action:
          'Call claim_agent_task({ taskKey: "fix_auth_middleware", description: "Fix JWT validation" }). If conflict, pick another task.',
      },
      {
        step: 4,
        name: "Work — Monitor Context Budget",
        description:
          "Work on the task. Track context window usage to prevent pollution. Pre-compute summaries instead of dumping raw output. Log errors with ERROR prefix on same line for easy grep.",
        tools: ["log_context_budget"],
        action:
          "After reading large files or receiving large test output, call log_context_budget to track usage. Heed warnings about approaching limits.",
      },
      {
        step: 5,
        name: "Validate — Oracle Comparison",
        description:
          "Compare your output against a known-good reference (oracle). The oracle pattern enables parallel debugging: each failing comparison can be assigned to a different agent.",
        tools: ["run_oracle_comparison"],
        action:
          'Call run_oracle_comparison({ testLabel: "api_output", actualOutput: "...", expectedOutput: "...", oracleSource: "production_v2" }). Fix differences before committing.',
      },
      {
        step: 6,
        name: "Release — Handoff to Next Agent",
        description:
          "Release the task lock with a progress note. If blocked, mark as blocked so another agent can pick it up with context about what was tried.",
        tools: ["release_agent_task"],
        action:
          'Call release_agent_task({ taskKey: "fix_auth_middleware", status: "completed", progressNote: "Fixed JWT validation, added tests" }).',
      },
    ],
    keyPatterns: {
      task_locking:
        "File-based locks in Anthropic's implementation; SQLite-based locks in NodeBench. Prevents duplicate work when agents run in parallel.",
      role_specialization:
        "Different agents for different concerns: one implements features, one deduplicates code, one optimizes performance, one maintains docs, one reviews code quality.",
      context_pollution_prevention:
        "Test harnesses should NOT print thousands of useless bytes. Pre-compute summaries, use --fast sampling for large suites, log details to files.",
      time_blindness_mitigation:
        "Agents can't tell time. Print incremental progress infrequently. Include --fast option for 1-10% random sample of tests.",
      oracle_testing:
        "Use a known-good reference as an oracle. Compare outputs to identify which specific components are broken. Enables parallel debugging.",
      progress_files:
        "Maintain running docs of status, failed approaches, and remaining tasks. Fresh agent sessions read these to orient themselves.",
      bootstrap_external_repos:
        "When connected to another project that lacks parallel agent capabilities, use bootstrap_parallel_agents to auto-detect gaps and scaffold infrastructure. The tool scans 7 categories (task coordination, roles, oracle, context budget, progress files, AGENTS.md parallel section, git worktrees) and generates ready-to-use files. Follow the AI Flywheel closed loop: detect → scaffold → verify → fix → document.",
    },
    claudeCodeNativePath: {
      title: "Claude Code Native Parallel Subagents",
      description:
        "If you are using Claude Code (Anthropic's CLI), you already have parallel subagent support via the Task tool. NodeBench MCP adds coordination, tracking, and impact measurement on top of Claude Code's native parallelism.",
      howItWorks: [
        "1. The main Claude Code session is the COORDINATOR — it breaks work into independent tasks",
        "2. Each Task tool call spawns a SUBAGENT — a separate Claude instance with its own context",
        "3. Each subagent has access to the same NodeBench MCP tools (shared SQLite database)",
        "4. Subagents use claim_agent_task/release_agent_task to coordinate without conflicts",
        "5. The coordinator uses get_parallel_status to monitor progress across all subagents",
      ],
      exampleWorkflow: [
        "COORDINATOR: Break work into 3 independent tasks",
        "COORDINATOR: For each task, spawn a Task tool subagent with prompt:",
        '  "You have access to NodeBench MCP. First call claim_agent_task({ taskKey: \'fix_auth\' }), then do the work, then call release_agent_task with a progress note."',
        "COORDINATOR: Call get_parallel_status to see all subagent progress",
        "COORDINATOR: When all subagents complete, aggregate results and run quality gate",
      ],
      impact: "Prevents duplicate work across subagents, captures per-task learnings, enables oracle-based validation, tracks context budget per subagent",
    },
    whenToUseParallelTools: {
      description: "Parallel agent tools are NOT always needed. Use them ONLY when the situation calls for coordination.",
      useWhen: [
        "You are running 2+ agent sessions (Claude Code subagents, worktrees, or separate terminals)",
        "You need to prevent two agents from working on the same thing",
        "You want oracle-based testing to split failures into independent work items",
        "You are bootstrapping parallel agent infrastructure for an external project",
      ],
      doNotUseWhen: [
        "You are a single agent working sequentially — standard verification/eval tools are sufficient",
        "The task is simple enough for one agent to handle end-to-end",
        "You are not in a multi-agent or multi-session context",
      ],
    },
    impactPerStep: {
      orient: "IMPACT: Prevents wasted time re-doing work another agent already started or completed",
      assign_role: "IMPACT: Specialization enables parallelism — agents don't step on each other's toes",
      claim_task: "IMPACT: Zero duplicate work — each task is owned by exactly one agent",
      monitor_budget: "IMPACT: Prevents context window exhaustion that forces expensive session restarts",
      oracle_validate: "IMPACT: Catches regressions by comparing against known-good reference — each failure is an independent debuggable work item",
      release_handoff: "IMPACT: Progress notes ensure the next agent (or next session) doesn't restart from scratch",
    },
    bootstrapForExternalRepos: {
      description:
        "When nodebench-mcp detects that a target project repo does not have parallel agent infrastructure, it can automatically bootstrap it using the AI Flywheel closed loop.",
      steps: [
        "1. DETECT: Call bootstrap_parallel_agents({ projectRoot: '/path/to/their/repo', dryRun: true }) — scans 7 categories and returns gap report",
        "2. SCAFFOLD: Call bootstrap_parallel_agents({ projectRoot: '...', dryRun: false, techStack: 'TypeScript/React' }) — creates .parallel-agents/ dir, progress.md, roles.json, lock dirs, oracle dirs",
        "3. AGENTS.MD: Call generate_parallel_agents_md({ techStack: '...', projectName: '...', maxAgents: 4 }) — generates portable AGENTS.md section, paste into their repo",
        "4. VERIFY: Run the 6-step flywheel plan returned by bootstrap_parallel_agents — static analysis, happy path, conflict test, oracle test, gap re-scan, document",
        "5. FIX: If any flywheel step fails, fix and re-verify from step 1",
        "6. DOCUMENT: Call record_learning with patterns discovered during bootstrap",
      ],
    },
    authoritativeSource:
      "https://www.anthropic.com/engineering/building-c-compiler",
    composesWith:
      "Works with verification cycles (each agent runs its own), eval runs (aggregate across agents), and learnings (shared knowledge base). Task claims compose with the mandatory flywheel. bootstrap_parallel_agents works on ANY project directory — not just nodebench.",
  },
  self_reinforced_learning: {
    title: "Self-Reinforced Learning Loop",
    description:
      "Continuous self-improvement cycle for agents using the MCP. Tool calls are now auto-instrumented — every call is automatically logged with timing and status. The loop: Use tools → Auto-log → Analyze trajectories → Find gaps → Clean stale data → Synthesize recon → Recommend improvements → Apply → Re-analyze. Over time, the system gets smarter about the project's specific development patterns.",
    steps: [
      {
        step: 1,
        name: "Instrument",
        description:
          "Log tool calls during your workflow. Call log_tool_call after each tool invocation to record timing, status, and phase context.",
        tools: ["log_tool_call"],
        action:
          "After each tool call, call log_tool_call({ sessionId, toolName, durationMs, resultStatus, phase }). Group related calls under the same sessionId.",
      },
      {
        step: 2,
        name: "Analyze Trajectories",
        description:
          "Review tool usage patterns across sessions. Identify frequently used tools, error-prone tools, and sequential patterns (tool A always followed by tool B).",
        tools: ["get_trajectory_analysis"],
        action:
          "Call get_trajectory_analysis periodically or after a session completes. Review topTools, topPatterns, and errorProneTools.",
      },
      {
        step: 3,
        name: "Self-Evaluate",
        description:
          "Cross-reference all persisted data for a comprehensive health assessment. Check verification completion rates, gap resolution, eval trends, and knowledge growth.",
        tools: ["get_self_eval_report"],
        action:
          "Call get_self_eval_report to get the healthScore and grade. Focus on areas with low scores.",
      },
      {
        step: 4,
        name: "Get Recommendations",
        description:
          "Surface actionable improvements based on accumulated data. The system detects unused tools, missing quality gates, knowledge gaps, and process bottlenecks.",
        tools: ["get_improvement_recommendations"],
        action:
          "Call get_improvement_recommendations. Address high-priority items first. Record learnings for each fix.",
      },
      {
        step: 5,
        name: "Clean & Synthesize",
        description:
          "Clean up stale runs and synthesize recon findings into learnings. Orphaned eval runs and stale gaps skew health scores. Recon findings are ephemeral — convert them into searchable learnings.",
        tools: ["cleanup_stale_runs", "synthesize_recon_to_learnings"],
        action:
          "Call cleanup_stale_runs(dryRun=true) to preview, then dryRun=false to clean. Call synthesize_recon_to_learnings(dryRun=true) to preview conversions, then dryRun=false.",
      },
      {
        step: 6,
        name: "Apply & Re-Analyze",
        description:
          "Implement the top recommendations, then re-run the analysis to verify improvement. This closes the loop and makes the system progressively smarter.",
        tools: ["record_learning", "get_self_eval_report"],
        action:
          "Apply fixes, call record_learning for each insight, then re-run get_self_eval_report. Compare health scores before and after.",
      },
    ],
    composesWith:
      "Feeds into the AI Flywheel outer loop. Trajectory analysis informs eval case design. Recommendations trigger verification cycles. Learnings persist across sessions.",
  },
  academic_paper_writing: {
    title: "Academic Paper Writing — AI-Assisted Research Polishing",
    description:
      "Comprehensive academic writing workflow adapted from battle-tested prompts used at MSRA, Bytedance Seed, and top Chinese universities. Covers polishing, translation, compression, de-AI-ification, logic checking, caption generation, experiment analysis, and reviewer simulation. All tools use LLM provider fallback (Gemini → OpenAI → Anthropic).",
    steps: [
      {
        step: 1,
        name: "Polish Draft",
        description:
          "Deep-polish the draft for top-venue quality. Fix grammar, enforce formal academic tone, remove contractions and AI vocabulary. Preserve LaTeX, citations, and math.",
        tools: ["polish_academic_text"],
        action:
          'Call polish_academic_text({ text: "...", targetVenue: "NeurIPS", language: "en" }). Review the modification log in the response.',
      },
      {
        step: 2,
        name: "Remove AI Signatures",
        description:
          "Detect and rewrite AI-generated writing patterns (leverage, delve, tapestry, mechanical connectors). Two-phase: regex pattern match + LLM rewrite.",
        tools: ["remove_ai_signatures"],
        action:
          "Call remove_ai_signatures({ text: '...' }). Review detectedPatterns list and the rewritten text.",
      },
      {
        step: 3,
        name: "Check Logic",
        description:
          "High-threshold logic review: contradictions, undefined terms, terminology inconsistency, Chinglish. Only flags issues that genuinely block comprehension.",
        tools: ["check_paper_logic"],
        action:
          'Call check_paper_logic({ text: "...", checkType: "all" }). Fix any critical or high severity issues before proceeding.',
      },
      {
        step: 4,
        name: "Adjust Length",
        description:
          "Precisely compress or expand sections to meet page limits. Compression removes filler, expansion adds logical depth.",
        tools: ["compress_or_expand_text"],
        action:
          'Call compress_or_expand_text({ text: "...", mode: "compress", targetDelta: 50 }). Check word count change in response.',
      },
      {
        step: 5,
        name: "Generate Captions",
        description:
          "Create publication-ready figure and table captions following venue conventions. Both short and detailed versions.",
        tools: ["generate_academic_caption"],
        action:
          'Call generate_academic_caption({ description: "Comparison of model accuracy across 5 datasets", figureType: "table" }). Use the short version in the paper, detailed version in appendix.',
      },
      {
        step: 6,
        name: "Analyze Experiments",
        description:
          "Generate analysis paragraphs from experiment data. Strict: all conclusions grounded in provided data, no fabrication.",
        tools: ["analyze_experiment_data"],
        action:
          'Call analyze_experiment_data({ data: "<csv or json>", goal: "our method outperforms baselines", format: "latex" }).',
      },
      {
        step: 7,
        name: "Simulate Review",
        description:
          "Get a harsh peer review before submission. Identifies critical weaknesses and provides strategic revision advice.",
        tools: ["review_paper_as_reviewer"],
        action:
          'Call review_paper_as_reviewer({ text: "...", venue: "ICML 2026", strictness: "harsh" }). Address all critical weaknesses before submission.',
      },
      {
        step: 8,
        name: "Translate (if bilingual)",
        description:
          "Translate sections between Chinese and English preserving LaTeX, citations, and terminology consistency.",
        tools: ["translate_academic"],
        action:
          'Call translate_academic({ text: "...", from: "zh", to: "en", domain: "computer vision" }). Use the terminology dictionary for consistency across sections.',
      },
    ],
    composesWith:
      "Use after the 6-Phase Verification cycle completes a research implementation. Feed reviewer feedback into log_gap for tracking. Record writing patterns with record_learning.",
    sourceReference:
      "https://github.com/Leey21/awesome-ai-research-writing — 4000+ stars, MSRA/Bytedance/PKU",
  },
  agent_evaluation: {
    title: "Agent Evaluation — Test, Observe, Improve",
    description:
      "Systematic methodology for ensuring agents using NodeBench MCP perform as well or better than agents without it. Combines contract compliance scoring, trajectory analysis, eval benchmarks, and self-reinforced learning into a closed loop: run agent → score → identify gaps → fix prompt/contract → re-score. The key insight: agent quality is measurable using the same eval infrastructure NodeBench provides for code quality.",
    steps: [
      {
        step: 1,
        name: "Instrument the Agent Session",
        description:
          "Ensure every tool call is logged. NodeBench auto-instruments calls, but verify with log_tool_call if using external orchestrators. Group related calls under a sessionId.",
        tools: ["log_tool_call"],
        action:
          "Verify tool call logging is active. If using Claude Code, Windsurf, or Cursor — calls are auto-logged. For custom orchestrators, call log_tool_call({ sessionId, toolName, resultStatus }) after each tool invocation.",
      },
      {
        step: 2,
        name: "Score Contract Compliance",
        description:
          "Run the 6-dimension contract compliance checker. Scores: front-door protocol (25pts), self-setup (10pts), pre-implementation gates (15pts), parallel coordination (10pts), ship gates (30pts), tool efficiency (10pts). Total: 100pts.",
        tools: ["check_contract_compliance"],
        action:
          "Call check_contract_compliance({ sessionId }) after the agent task completes. Review violations and per-dimension scores. Target: Grade B (80+) for production agents.",
      },
      {
        step: 3,
        name: "Analyze Trajectory Patterns",
        description:
          "Identify tool usage patterns: which tools are used most, sequential bigrams (tool A → tool B), error rates, phase distribution. Patterns reveal whether the agent is using the methodology effectively.",
        tools: ["get_trajectory_analysis"],
        action:
          "Call get_trajectory_analysis({ sessionId }). Look for: (1) front-door tools appearing first, (2) low error rates, (3) ship-gate tools appearing last, (4) no redundant consecutive calls.",
      },
      {
        step: 4,
        name: "Run Eval Benchmarks",
        description:
          "Create eval test cases for specific agent behaviors. Test: does the agent search before coding? Does it recover from missing tools? Does it run all ship gates? Compare with/without the agent-contract prompt.",
        tools: ["start_eval_run", "record_eval_result", "complete_eval_run"],
        action:
          'Create eval cases: { input: "Fix a bug in auth module", intent: "Agent should search_all_knowledge first, then verify, then ship with gates" }. Record actual behavior. Compare pass rates.',
      },
      {
        step: 5,
        name: "Compare Before/After",
        description:
          "After changing the agent contract, prompt, or toolset — re-run eval and compare. Never ship a contract change without eval improvement.",
        tools: ["compare_eval_runs"],
        action:
          "Call compare_eval_runs({ baselineRunId, candidateRunId }). Only ship if the candidate shows improvement. If regression, investigate with trigger_investigation.",
      },
      {
        step: 6,
        name: "Self-Reinforce",
        description:
          "Cross-reference all data to generate improvement recommendations. Bank learnings. Clean stale data. The system gets smarter about agent patterns over time.",
        tools: ["get_self_eval_report", "get_improvement_recommendations", "record_learning"],
        action:
          "Call get_self_eval_report for the health dashboard. Call get_improvement_recommendations for actionable fixes. Record every agent evaluation insight as a learning.",
      },
    ],
    scoringDimensions: {
      front_door: "25pts — Did the agent call search_all_knowledge + getMethodology + discover_tools BEFORE implementation?",
      self_setup: "10pts — Did the agent resolve missing capabilities (errors → setup tools → retry)?",
      pre_implementation: "15pts — Did the agent run recon + risk assessment before changes?",
      parallel_coordination: "10pts — If parallel work, did the agent claim/release tasks with roles and budget tracking?",
      ship_gates: "30pts — Did the agent run tests + eval + quality gate + mandatory flywheel + record learning before declaring done?",
      tool_efficiency: "10pts — Low error rate, no redundant calls, good tool variety?",
    },
    gradeScale: {
      A: "90-100 — Exemplary: agent follows the full contract consistently",
      B: "80-89 — Good: minor gaps but fundamentally sound process",
      C: "70-79 — Acceptable: some dimensions need attention",
      D: "55-69 — Needs Improvement: significant contract violations",
      F: "0-54 — Non-Compliant: agent is not following the methodology",
    },
    whatToMeasure: {
      contract_compliance_score: "0-100 from check_contract_compliance — the primary metric",
      health_score: "From get_self_eval_report — broader system health across all artifacts",
      eval_pass_rate: "From complete_eval_run — percentage of agent behavior test cases passing",
      tool_error_rate: "From get_trajectory_analysis — percentage of tool calls that fail",
      knowledge_growth: "From search_all_knowledge — are learnings accumulating and being reused?",
      violation_trend: "From get_gate_history — are contract violations decreasing over time?",
    },
    hostFewerToolsArchitecture: {
      principle: "Give the agent 4 front-door meta-tools. All 129+ tools are discoverable on demand.",
      frontDoor: [
        "search_all_knowledge — Check what's known before doing anything",
        "getMethodology — Load the right process for the task",
        "discover_tools — Find the best tools for the job (multi-modal search with explain=true)",
        "get_workflow_chain — Get step-by-step tool sequence for the workflow",
      ],
      selfExtension: "If a capability is missing, the agent escalates: discover_tools → scaffold/bootstrap → smoke-test → proceed. The agent-contract prompt encodes this as a non-negotiable rule.",
      benefits: [
        "Small surface area (4 host tools) for easier safety and auditing",
        "Composable growth via discoverable tool inventory",
        "Better tool choice via multi-modal search + quickRef guidance",
        "Measurable via contract compliance scoring",
      ],
    },
    composesWith:
      "Run after every agent session. Feeds into the self-reinforced learning loop. Contract compliance scores become eval test cases. Violations trigger verification investigations.",
  },
  controlled_evaluation: {
    title: "Controlled Evaluation — Prove NodeBench MCP Makes Agents Better",
    description:
      "A rigorous evaluation framework based on Anthropic's agent eval methodology. Uses fixed task banks, ablation experiments (bare vs lite vs full), multi-trial statistics, and dual-axis scoring (outcome quality + process quality) to prove that NodeBench MCP improves agent performance with statistical confidence. References: Anthropic 'Demystifying evals for AI agents', 'Quantifying infrastructure noise in agentic coding evals', Accenture MCP-Bench, ModelScope MCPBench.",
    steps: [
      {
        step: 1,
        name: "Define 'Better' (Two Axes)",
        description:
          "Outcome quality: task success rate, regression rate, time-to-fix, bug escape rate. Process quality: structured recon, risk assessment, 3-layer tests, regression guards, quality gates, banked learnings. Both axes must improve for NodeBench to prove its value.",
        tools: ["create_task_bank", "get_gate_preset"],
        action:
          "Define measurable criteria for each axis. Load agent_comparison gate preset for the 10 boolean rules. Outcome = what users care about. Process = what NodeBench is meant to improve.",
      },
      {
        step: 2,
        name: "Build a Fixed Task Bank",
        description:
          "Create 30-200 real tasks (bugfixes, refactors, integrations, UI). Each task specifies: initial state, success criteria (deterministic), forbidden behaviors, time/token budget. This is the evaluation foundation.",
        tools: ["create_task_bank"],
        action:
          'Use get_workflow_chain("task_bank_setup") for the starter kit. Each task needs: taskId, category, difficulty, prompt, successCriteria[], forbiddenBehaviors[], timeBudgetMinutes. Categories: bugfix/refactor/integration/ui/security/performance/migration.',
      },
      {
        step: 3,
        name: "Run Ablations (Isolate MCP Value)",
        description:
          "For each task, run 5 conditions: (1) bare agent (no MCP), (2) NodeBench lite preset, (3) NodeBench full, (4) full but cold knowledge base, (5) full but quality gates disabled. Same model, same time budget, same infra. This isolates what each MCP component contributes.",
        tools: ["grade_agent_run"],
        action:
          "Run grade_agent_run with condition='bare', then 'lite', then 'full', then 'cold_kb', then 'no_gates' for the same taskId. Compare scores across conditions. The delta between bare and full is NodeBench's measured value.",
      },
      {
        step: 4,
        name: "Multi-Trial Statistics",
        description:
          "Run N trials per task (3-10) because agents are stochastic. Report: mean success, variance, best-of-N, average-of-N. Both matter — average-of-N for reliability, best-of-N for capability ceiling.",
        tools: ["grade_agent_run", "start_eval_run"],
        action:
          "Run grade_agent_run with trialNumber=1..N for each condition. The ablationComparison field in the response auto-aggregates mean scores across trials. Target: p<0.05 significance for bare vs full difference.",
      },
      {
        step: 5,
        name: "Mix Grader Types",
        description:
          "Deterministic graders: tests, lint, type-check, invariants, required-tool-call checks. Model graders: rubric scoring for code clarity, pairwise comparisons. Human spot-checks: sample 5-10% of runs. All three prevent Goodharting.",
        tools: ["run_quality_gate", "record_eval_result"],
        action:
          "Use run_quality_gate with agent_comparison preset for deterministic checks. Use record_eval_result with judgeNotes for model grading. Flag 5-10% of runs for human review with notes field.",
      },
      {
        step: 6,
        name: "Control Infrastructure Noise",
        description:
          "Agentic coding evals are sensitive to CPU/RAM/time limits — enough to swing results by percentage points. Pin deps, fix resource limits, record infra failures separately from model failures, track infra error rate as first-class metric.",
        tools: ["log_tool_call", "record_learning"],
        action:
          "Log infra errors with resultStatus='error' and phase='infra' to separate from model errors. Track infra_error_rate separately. Use containers with pinned deps for reproducibility.",
      },
      {
        step: 7,
        name: "Benchmark Tool Discovery (MCP-Specific)",
        description:
          "Since NodeBench adds a large tool layer, explicitly test: can the agent find the right tool? Can it call it correctly? Does it over-call tools and burn budget? Use tool-use scorecards alongside repo-based tasks.",
        tools: ["discover_tools", "get_trajectory_analysis", "check_contract_compliance"],
        action:
          "Run get_trajectory_analysis to measure: unique tools used, error rate, tool variety vs task type. Check contract_compliance front-door score. Compare tool discovery accuracy between bare (no discover_tools) and full (with discover_tools).",
      },
      {
        step: 8,
        name: "Production Observability",
        description:
          "Capture full traces (prompts, tool calls, outputs, diffs, test results, gate decisions, knowledge read/writes). Emit structured telemetry events. Build dashboards: pass rate by category, token/latency distributions, infra error rate, gate violation frequency, post-merge incidents.",
        tools: ["log_tool_call", "get_trajectory_analysis", "get_self_eval_report", "get_gate_history"],
        action:
          "Telemetry schema: recon_finding{severity,category}, risk_assessment{tier,rationale}, test_result{layer,pass,duration}, eval_case_added{count}, quality_gate{rule_id,pass}, knowledge_write{topic,confidence}. Track all via log_tool_call phases.",
      },
      {
        step: 9,
        name: "Promotion Strategy",
        description:
          "Treat NodeBench MCP like a model change: regression suite must stay ~100% pass, capability suite should trend upward, enforce budget envelope. Canary on 5-10% of tasks, compare incident rate vs control, expand only if it wins on BOTH outcome metrics AND cost.",
        tools: ["compare_eval_runs", "run_quality_gate", "record_learning"],
        action:
          "Gate releases on: (1) regression suite pass, (2) capability suite improvement, (3) budget within envelope, (4) no critical security vulnerabilities. Canary → verify → expand.",
      },
    ],
    ablationMatrix: {
      bare: "No NodeBench MCP — agent uses only host IDE tools. Baseline for comparison.",
      lite: "NodeBench lite preset (39 tools) — core methodology without flywheel/parallel.",
      full: "NodeBench full preset (134 tools) — everything including parallel, vision, web.",
      cold_kb: "NodeBench full but empty knowledge base — tests whether accumulated learnings matter.",
      no_gates: "NodeBench full but quality gates disabled — tests whether gates prevent regressions.",
    },
    scoringAxes: {
      outcome: {
        weight: "50pts",
        components: [
          "Criteria pass rate (40pts) — deterministic success checks from task bank",
          "Budget compliance (10pts) — within time and token budget",
          "Forbidden behavior penalty (-5 per violation, max -10)",
        ],
      },
      process: {
        weight: "50pts",
        components: [
          "Front-door protocol (12pts) — searched before coding, first call was discovery",
          "Recon + risk (10pts) — ran recon and assessed risk before changes",
          "Tests + gates (18pts) — ran tests, quality gate, mandatory flywheel, recorded learnings",
          "Efficiency (10pts) — low error rate, good tool variety",
        ],
      },
    },
    graderTypes: {
      deterministic: "Tests, lint, type-check, invariants, required-tool-call checks. Fast + objective. 80% of grading.",
      model: "Rubric scoring for code clarity, adherence to instructions, change risk. Pairwise comparisons (NodeBench vs bare). 15% of grading.",
      human: "Sample 5-10% of runs. Review diffs + traces. Prevents Goodharting on automated metrics. 5% of grading.",
    },
    infraControls: [
      "Run in containers with pinned deps (same Node.js, same packages)",
      "Fixed CPU/RAM per task with consistent enforcement",
      "Record infra failures separately from model failures",
      "Track infra_error_rate as first-class metric alongside model metrics",
      "Use deterministic seeds where possible (temperature=0 for reproducibility)",
    ],
    references: {
      anthropic_evals: "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents",
      infra_noise: "https://www.anthropic.com/engineering/infrastructure-noise",
      mcp_bench: "https://github.com/Accenture/mcp-bench",
      mcpbench: "https://github.com/modelscope/MCPBench",
      mcp_sec_bench: "https://arxiv.org/pdf/2508.13220",
      long_running: "https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents",
      parallel_agents: "https://www.anthropic.com/engineering/building-c-compiler",
    },
    composesWith:
      "Build on agent_evaluation for contract scoring. Use the verification methodology for per-task correctness. Feed results into self_reinforced_learning loop. Use parallel_agent_teams methodology for evaluating multi-agent handoffs.",
  },
  toon_format: {
    title: "TOON Format — Token-Oriented Object Notation",
    description:
      "TOON is a serialization format optimized for LLM token efficiency. It uses ~40% fewer tokens than JSON while achieving better accuracy (73.9% vs 69.7% on benchmarks). It combines YAML-style indentation for objects with CSV-style tabular arrays for uniform collections.",
    whenToUse: [
      "Preparing large data payloads for LLM calls (saves ~40% tokens = lower cost)",
      "Multi-agent handoffs where context budget is tight",
      "Returning structured results that will be consumed by another LLM",
      "Any workflow where token savings compound (e.g., iterative refinement loops)",
    ],
    whenNotToUse: [
      "Data consumed by non-LLM systems (JSON is more universally supported)",
      "Small payloads where savings are negligible (<100 tokens)",
      "When exact JSON round-trip fidelity is critical (TOON may reorder keys)",
    ],
    howItWorks: [
      "Objects use YAML-style indentation: key: value (one per line)",
      "Uniform arrays use CSV-style: [N]{field1,field2}: rows... (compact tabular format)",
      "Strings don't need quotes unless they contain special characters",
      "Numbers, booleans, null are literal values",
    ],
    example: {
      json: '[{"name":"log_gap","category":"verification","phase":"verify"},{"name":"resolve_gap","category":"verification","phase":"verify"}]',
      toon: '[2]{name,category,phase}:\n  log_gap,verification,verify\n  resolve_gap,verification,verify',
      savings: "~40% fewer characters, ~36% fewer tokens",
    },
    tools: ["toon_encode", "toon_decode"],
    cliFlag: "--toon — Auto-encode all tool responses in TOON format. Add to your MCP config for system-wide savings.",
    references: {
      spec: "https://github.com/toon-format/toon",
      npm: "https://www.npmjs.com/package/@toon-format/toon",
      article: "https://www.infoq.com/news/2025/11/toon-reduce-llm-cost-tokens/",
    },
  },
  seo_audit: {
    title: "SEO Audit Workflow",
    description:
      "Structured SEO audit for websites: technical SEO, content analysis, performance checks, WordPress detection, and actionable recommendations.",
    steps: [
      { tool: "seo_audit_url", action: "Analyze meta tags, headings, images, structured data" },
      { tool: "analyze_seo_content", action: "Check readability, keyword density, link ratios" },
      { tool: "check_page_performance", action: "Measure response time, compression, caching" },
      { tool: "check_wordpress_site", action: "Detect WordPress, assess security posture" },
      { tool: "scan_wordpress_updates", action: "Check plugins/themes for known vulnerabilities" },
    ],
    bestPractices: [
      "Run seo_audit_url first to get the overall score and identify priorities",
      "Use analyze_seo_content with targetKeyword for keyword-focused audits",
      "check_wordpress_site is security-focused — run it on any WordPress site before deployment",
      "Record findings with record_learning for cross-project SEO knowledge",
    ],
  },
  voice_bridge: {
    title: "Voice Bridge Implementation Guide",
    description:
      "End-to-end voice interface implementation: architecture patterns, STT/TTS/LLM options, latency optimization, and scaffold generation. Covers local, cloud, and hybrid deployments.",
    architecturePatterns: {
      local: "Whisper + Piper/macOS say — fully offline, best privacy, higher latency (2-5s)",
      cloud: "Deepgram + Cartesia/ElevenLabs — lowest latency (0.5-1.5s), requires API keys",
      hybrid: "Whisper local + cloud TTS — privacy for input, quality for output",
      browser: "Web Speech API — zero dependencies, browser-only, variable quality",
    },
    steps: [
      { tool: "design_voice_pipeline", action: "Get architecture recommendation based on requirements" },
      { tool: "analyze_voice_config", action: "Validate component compatibility and estimate costs" },
      { tool: "generate_voice_scaffold", action: "Generate starter code for chosen stack" },
      { tool: "benchmark_voice_latency", action: "Compare pipeline configurations side-by-side" },
    ],
    latencyBudget: {
      excellent: "<1s total round-trip — requires streaming STT + streaming TTS + fast LLM",
      good: "1-2s — achievable with cloud STT + streaming TTS",
      acceptable: "2-4s — local Whisper + cloud TTS",
      poor: ">4s — batch processing, no streaming",
    },
    keyInsights: [
      "Streaming is critical: STT streaming reduces perceived latency by 50-70%",
      "TTS is often the bottleneck — choose streaming TTS (Cartesia Sonic, Edge TTS)",
      "VAD (Voice Activity Detection) prevents unnecessary processing of silence",
      "Session context must survive compaction — use save_session_note for voice conversation history",
      "For production: implement interrupt handling (user speaks while TTS is playing)",
    ],
  },
  analyst_diagnostic: {
    title: "Analyst Diagnostic — Root Cause Over Bandaids",
    description:
      "Guide yourself like an analyst diagnosing the root cause, NOT a junior dev slapping on a bandaid. Mandatory for all bug work.",
    steps: [
      {
        step: 1,
        name: "Reproduce",
        description: "Confirm the exact failure mode before touching any code.",
        tools: ["search_all_knowledge"],
        action: "Check if this root cause is already known. If yes, apply the known fix. If no, proceed to step 2.",
      },
      {
        step: 2,
        name: "Trace Upstream",
        description: "Walk from symptom → intermediate state → root cause. Don't stop at the first error you see.",
        tools: ["run_recon", "log_recon_finding"],
        action: "Use recon tools to trace the chain. Log each intermediate finding.",
      },
      {
        step: 3,
        name: "Ask 'Why' 5 Times",
        description: "Each answer should go one level deeper into the system. If you can't get to 5, you haven't found the root cause yet.",
        action: "Document each 'why' level. The 5th answer is usually the real fix.",
      },
      {
        step: 4,
        name: "Fix the Cause",
        description: "The right fix makes the symptom impossible, not just invisible.",
        tools: ["resolve_gap"],
        action: "Implement the fix. It should address the root cause from step 3, not the symptom from step 1.",
      },
      {
        step: 5,
        name: "Verify No Sideways Shift",
        description: "Bandaids move bugs sideways. Check adjacent behavior to confirm the fix didn't introduce new issues.",
        tools: ["log_test_result", "run_closed_loop"],
        action: "Run tests. Check adjacent functionality. Confirm the bug can't recur.",
      },
      {
        step: 6,
        name: "Record the Root Cause",
        description: "Document what you found so the next person doesn't re-discover it.",
        tools: ["record_learning"],
        action: "Call record_learning with the root cause, not just the fix.",
      },
    ],
    redFlags: [
      "Adding try/catch that swallows errors without understanding them",
      "Adding ?. optional chaining to mask undefined instead of finding why it's undefined",
      "Adding 'as any' to silence type errors instead of fixing the type mismatch",
      "Adding timeouts/retries to paper over race conditions",
      "Deleting a failing test instead of fixing the code it tests",
      "'It works now' without understanding why it didn't before",
    ],
  },
  scenario_testing: {
    title: "Scenario-Based Testing — Real Human Behavior at Scale",
    description:
      "Tests that don't model real human behavior are false confidence. Every test must be scenario-based: start from a real user persona and goal, simulate realistic behavior, and verify at scale. Covers all behavior angles and both short-running (burst) and long-running (sustained) scenarios.",
    steps: [
      {
        step: 1,
        name: "Define the User Persona",
        description:
          "Who is the user in this scenario? First-timer, power user, distracted user, adversarial actor, mobile user on a slow network, or concurrent session? The persona determines which failure modes matter.",
        action:
          "Before writing any assertion, write: 'User: <persona>. Goal: <what they want to achieve>. Prior state: <what's already in the system>.' If you can't answer these, you don't have a test scenario yet.",
      },
      {
        step: 2,
        name: "Specify Action Sequence + Timing",
        description:
          "What does the user do, in what order, with what timing between actions? Rushed clicks differ from deliberate actions. Concurrent users produce race conditions that single-user tests miss entirely.",
        action:
          "Document: 'Actions: [step-by-step sequence with timing]. Concurrency: [1 user / N concurrent].' For concurrent scenarios, specify what overlaps and at what rate.",
      },
      {
        step: 3,
        name: "Set the Scale Axis",
        description:
          "A test that passes at 1 user is necessary but not sufficient. Define what happens at 10x and 100x. Single-user happy paths cannot catch connection pool exhaustion, rate limit throttling, lock contention, or thundering herd.",
        action:
          "For every scenario, write: 'Scale: 1x (baseline) / 10x (concurrent) / 100x (sustained).' If you only have the 1x case, the test suite has a known gap — document it.",
      },
      {
        step: 4,
        name: "Set the Duration Axis",
        description:
          "Short-running tests (burst/spike) and long-running tests (sustained load, state accumulation) catch different failure modes. A system that handles 10 requests in 1 second may fail after 10,000 requests over 30 minutes due to memory leaks, DB growth, stale caches, or token expiry.",
        action:
          "For each scenario, specify: 'Duration: single request / session-length / multi-day accumulation.' If you have only short-running coverage, add a long-running counterpart or mark the gap explicitly.",
      },
      {
        step: 5,
        name: "Cover All Behavior Angles",
        description:
          "Six required angles per feature: (1) happy path, (2) all sad paths, (3) concurrent access, (4) degraded conditions (slow network, auth expiry, partial API failures), (5) long-running accumulation (DB growth, stale cache), (6) adversarial inputs (injection, replay, unexpected payloads).",
        action:
          "Use a checklist: happy ✓ / sad paths ✓ / concurrent ✓ / degraded ✓ / long-running ✓ / adversarial ✓. Missing boxes are documented gaps, not implicit coverage.",
      },
      {
        step: 6,
        name: "Verify Side Effects, Not Just Return Values",
        description:
          "Assertions that only check return values miss the failure modes that matter in production: state changes, side effects, downstream consequences. Did the DB update? Did the cache invalidate? Did the audit log record? Did the notification fire?",
        action:
          "After every action assertion, add assertions for: state in the DB, downstream side effects, observable UI change, and any async consequences. If you can't assert them, add instrumentation.",
      },
    ],
    antiPatterns: [
      "Simple unit tests with no scenario context",
      "Tests that only cover the happy path",
      "Tests that mock everything and test nothing real",
      "Tests that pass at 1 user and are never run at 10+",
      "Hard-coded user state assumptions that won't hold in production",
      "'It passes in CI' declared without production-realistic data volume or concurrency",
      "Declaring a feature 'tested' after a single integration test with synthetic clean data",
      "Assertions only on return values — no state or side effect checks",
    ],
    scenarioAnatomy: {
      template:
        "Scenario: <name> | User: <persona> | Goal: <user goal> | Prior state: <system state before> | Actions: <sequence with timing> | Scale: <1x/10x/100x> | Duration: <single/session/multi-day> | Expected: <state + side effects + UI> | Edge cases: <degraded/adversarial/partial>",
      example:
        "Scenario: Power user submits form on slow 3G | User: power user, 50+ prior submissions, impatient | Goal: submit expense report | Prior state: DB has 10,000 existing reports, cache warm | Actions: fill form (5s), click submit, network drops to 3G mid-request, retry after 2s | Scale: 10 concurrent submitters | Duration: 30-minute session with 20 submissions | Expected: exactly-once submission, retry shows loading, no duplicate DB row, audit log entry | Edge cases: double-click, browser back mid-submit, session expiry at step 3",
    },
  },
  overview: {
    title: "NodeBench Development Methodology — Overview",
    description:
      "A dual-loop system for rigorous development. The inner loop (6-Phase Verification) ensures correctness. The outer loop (Eval-Driven Development) ensures improvement. Together they form the AI Flywheel.",
    steps: [
      {
        name: "Start here",
        description:
          "Call getMethodology with a specific topic to get detailed guidance.",
        topics: {
          verification:
            "6-Phase Verification — systematic correctness checking",
          eval: "Eval-Driven Development — measure improvement objectively",
          flywheel:
            "AI Flywheel — how the two loops compose and reinforce each other",
          mandatory_flywheel:
            "Mandatory Flywheel — 6-step minimum verification before declaring work done",
          reconnaissance:
            "Reconnaissance — structured research and context gathering for Phase 1",
          quality_gates:
            "Quality Gates — boolean check validation pattern",
          ui_ux_qa:
            "UI/UX QA — frontend verification after UI implementations",
          agentic_vision:
            "Agentic Vision — AI-powered visual verification using vision models (Gemini 3 Flash code execution, GPT-5-mini, Claude)",
          closed_loop:
            "Closed Loop — compile/lint/test/debug before presenting work",
          learnings:
            "Learnings — persistent knowledge base to prevent repeating mistakes",
          project_ideation:
            "Project Ideation — validate concepts before development with market research and competitive analysis",
          tech_stack_2026:
            "Tech Stack Management — evaluate and maintain technology choices for 2026",
          telemetry_setup:
            "Telemetry Setup — observability, instrumentation, and early problem detection",
          agents_md_maintenance:
            "AGENTS.md Maintenance — keep documentation synchronized with implementations",
          agent_bootstrap:
            "Agent Bootstrap — self-discover infrastructure, triple verification with authoritative sources, self-implement missing components",
          autonomous_maintenance:
            "Autonomous Maintenance — risk-tiered execution, re-update before create, self-maintenance cycles, OpenClaw scaffolding, Ralph Wiggum loops",
          parallel_agent_teams:
            "Parallel Agent Teams — task locking, role specialization, context budget management, oracle testing. Based on Anthropic's 'Building a C Compiler with Parallel Claudes' (Feb 2026)",
          self_reinforced_learning:
            "Self-Reinforced Learning — auto-instrumented trajectory analysis, self-evaluation reports, improvement recommendations, stale run cleanup, recon synthesis, closed-loop optimization",
          academic_paper_writing:
            "Academic Paper Writing — AI-assisted polishing, translation, de-AI-ification, logic checking, captions, experiment analysis, reviewer simulation. Based on awesome-ai-research-writing (4000+ stars, MSRA/Bytedance/PKU)",
          agent_evaluation:
            "Agent Evaluation — contract compliance scoring (6 dimensions, 100pts), trajectory analysis, eval benchmarks, host-fewer-tools architecture, self-reinforced improvement loop",
          controlled_evaluation:
            "Controlled Evaluation — fixed task banks, ablation experiments (bare/lite/full/cold_kb/no_gates), dual-axis scoring (outcome 50pts + process 50pts), multi-trial statistics, grader types, infra noise controls, promotion strategy. Based on Anthropic eval methodology.",
          toon_format:
            "TOON Format — Token-Oriented Object Notation for ~40% token savings on LLM payloads",
          seo_audit:
            "SEO Audit — technical SEO, content analysis, performance, WordPress security",
          voice_bridge:
            "Voice Bridge — STT/TTS/LLM pipeline design, scaffold generation, latency benchmarking",
          analyst_diagnostic:
            "Analyst Diagnostic — root-cause diagnosis over bandaids. Mandatory for all bug work: reproduce, trace upstream, ask 'why' 5 times, fix the cause not the symptom",
          scenario_testing:
            "Scenario-Based Testing — no shallow tests, real user personas, scale axis (1x/10x/100x), duration axis (burst + sustained), all behavior angles (happy/sad/adversarial/concurrent/degraded)",
        },
      },
      {
        name: "Quick start for first-time setup",
        sequence: [
          "1. bootstrap_project — Register your project (tech stack, architecture, conventions)",
          '2. getMethodology("overview") — See all available methodologies',
          "3. search_all_knowledge — Check if the knowledge base has relevant past findings",
        ],
      },
      {
        name: "Quick start for a new feature",
        sequence: [
          "1. search_all_knowledge — Check learnings, recon findings, and resolved gaps",
          "2. start_verification_cycle — Begin 6-phase process",
          "3. Follow phases 1-6 (guided by tool responses)",
          "4. record_learning — Capture what you discovered",
          "5. promote_to_eval — Turn findings into eval cases",
          "6. start_eval_run + compare_eval_runs — Verify improvement",
        ],
      },
      {
        name: "Quick start for checking quality",
        sequence: [
          "1. get_gate_preset — Get rules for your context",
          "2. Evaluate each rule",
          "3. run_quality_gate — Record results",
          "4. run_closed_loop — Ensure compile/lint/test pass",
        ],
      },
    ],
  },
};

export function createMetaTools(allTools: McpTool[]): McpTool[] {
  return [
    {
      name: "findTools",
      description:
        "Search available methodology tools by keyword or capability description. Returns matching tool names and descriptions. Use this to discover which tools are available for a task.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'What you want to do (e.g. "verify implementation", "track quality", "record edge case")',
          },
          category: {
            type: "string",
            enum: [
              "verification",
              "eval",
              "quality_gate",
              "learning",
              "flywheel",
              "reconnaissance",
              "ui_capture",
              "vision",
              "web",
              "github",
              "documentation",
              "bootstrap",
              "self_eval",
              "parallel_agents",
              "llm",
              "security",
              "platform",
              "research_writing",
              "boilerplate",
              "benchmark",
              "progressive_discovery",
              "meta",
            ],
            description: "Filter by tool category (optional)",
          },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const query = (args.query ?? "").toLowerCase();
        const category = args.category;

        // Category mapping
        const categoryMap: Record<string, string[]> = {
          verification: [
            "start_verification_cycle",
            "log_phase_findings",
            "log_gap",
            "resolve_gap",
            "log_test_result",
            "get_verification_status",
            "list_verification_cycles",
          ],
          eval: [
            "start_eval_run",
            "record_eval_result",
            "complete_eval_run",
            "compare_eval_runs",
            "list_eval_runs",
            "diff_outputs",
          ],
          quality_gate: [
            "run_quality_gate",
            "get_gate_preset",
            "get_gate_history",
            "run_closed_loop",
          ],
          learning: [
            "record_learning",
            "search_learnings",
            "list_learnings",
            "delete_learning",
          ],
          flywheel: [
            "get_flywheel_status",
            "promote_to_eval",
            "trigger_investigation",
            "run_mandatory_flywheel",
          ],
          reconnaissance: [
            "run_recon",
            "log_recon_finding",
            "get_recon_summary",
            "check_framework_updates",
            "search_all_knowledge",
            "bootstrap_project",
            "get_project_context",
          ],
          ui_capture: [
            "capture_ui_screenshot",
            "capture_responsive_suite",
          ],
          vision: [
            "discover_vision_env",
            "analyze_screenshot",
            "manipulate_screenshot",
            "diff_screenshots",
          ],
          web: [
            "web_search",
            "fetch_url",
          ],
          github: [
            "search_github",
            "analyze_repo",
            "monitor_repo",
          ],
          documentation: [
            "update_agents_md",
            "research_job_market",
            "setup_local_env",
            "generate_report",
          ],
          bootstrap: [
            "discover_infrastructure",
            "triple_verify",
            "self_implement",
            "generate_self_instructions",
            "connect_channels",
            "assess_risk",
            "decide_re_update",
            "run_self_maintenance",
            "scaffold_directory",
            "run_autonomous_loop",
            "run_tests_cli",
          ],
          self_eval: [
            "log_tool_call",
            "get_trajectory_analysis",
            "get_self_eval_report",
            "get_improvement_recommendations",
            "cleanup_stale_runs",
            "synthesize_recon_to_learnings",
            "check_contract_compliance",
            "create_task_bank",
            "grade_agent_run",
          ],
          parallel_agents: [
            "claim_agent_task",
            "release_agent_task",
            "list_agent_tasks",
            "assign_agent_role",
            "get_agent_role",
            "log_context_budget",
            "run_oracle_comparison",
            "get_parallel_status",
            "bootstrap_parallel_agents",
            "generate_parallel_agents_md",
          ],
          llm: [
            "call_llm",
            "extract_structured_data",
            "benchmark_models",
          ],
          security: [
            "scan_dependencies",
            "run_code_analysis", "scan_terminal_security"],
          platform: [
            "query_daily_brief",
            "query_funding_entities",
            "query_research_queue",
            "publish_to_queue",
          ],
          research_writing: [
            "polish_academic_text",
            "translate_academic",
            "compress_or_expand_text",
            "remove_ai_signatures",
            "check_paper_logic",
            "generate_academic_caption",
            "analyze_experiment_data",
            "review_paper_as_reviewer",
          ],
          boilerplate: [
            "scaffold_nodebench_project",
            "get_boilerplate_status",
          ],
          benchmark: [
            "start_autonomy_benchmark",
            "log_benchmark_milestone",
            "complete_autonomy_benchmark",
          ],
          progressive_discovery: [
            "discover_tools",
            "get_tool_quick_ref",
            "get_workflow_chain",
          ],
          meta: ["findTools", "getMethodology"],
        };

        let candidates = allTools;
        if (category && categoryMap[category]) {
          const names = new Set(categoryMap[category]);
          candidates = allTools.filter((t) => names.has(t.name));
        }

        const matches = candidates.filter((t) => {
          const text = `${t.name} ${t.description}`.toLowerCase();
          return query.split(/\s+/).some((word: string) => text.includes(word));
        });

        // Contextual recommendations: surface parallel tools only when relevant
        const parallelKeywords = ["parallel", "agent", "team", "multi-agent", "subagent", "concurrent", "worktree", "oracle", "lock", "coordinate", "role"];
        const queryHintsParallel = parallelKeywords.some((kw) => query.includes(kw));
        const parallelToolNames = new Set(categoryMap.parallel_agents);

        // Add contextual hint about parallel tools
        const contextHints: string[] = [];
        if (!queryHintsParallel && !category) {
          // Don't surface parallel tools unless the query is about parallel/agent work
          const filtered = matches.filter((t) => !parallelToolNames.has(t.name));
          if (filtered.length < matches.length) {
            contextHints.push(
              "Parallel agent tools are available but not shown (query didn't indicate multi-agent work). " +
              "Use findTools({ category: 'parallel_agents' }) or include 'parallel'/'agent'/'team' in your query to discover them."
            );
          }
          return {
            query,
            count: filtered.length,
            tools: filtered.map((t) => ({
              name: t.name,
              description: t.description,
            })),
            contextHints,
            tip: "Use category filter or specific keywords to narrow results. Call getMethodology('overview') for all available methodologies.",
          };
        }

        // When parallel tools ARE relevant, add Claude Code guidance
        if (queryHintsParallel || category === "parallel_agents") {
          contextHints.push(
            "Claude Code users: Use the Task tool to spawn parallel subagents, each with access to NodeBench MCP. " +
            "Each subagent calls claim_agent_task to lock work, assign_agent_role for specialization, and release_agent_task when done. " +
            "Call getMethodology('parallel_agent_teams') for the full workflow."
          );
        }

        return {
          query,
          count: matches.length,
          tools: matches.map((t) => ({
            name: t.name,
            description: t.description,
          })),
          contextHints,
          tip: "Use category filter or specific keywords to narrow results. Call getMethodology('overview') for all available methodologies.",
        };
      },
    },
    {
      name: "getMethodology",
      description:
        'Get step-by-step guidance for a development methodology. Topics: verification, eval, flywheel, mandatory_flywheel, reconnaissance, quality_gates, ui_ux_qa, flywheel_ui_dogfood, agentic_vision, closed_loop, learnings, project_ideation, tech_stack_2026, telemetry_setup, agents_md_maintenance, agent_bootstrap, autonomous_maintenance, parallel_agent_teams, self_reinforced_learning, academic_paper_writing, agent_evaluation, controlled_evaluation, scenario_testing, overview. Call with topic "overview" to see all available methodologies.',
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: [
              "verification",
              "eval",
              "flywheel",
              "mandatory_flywheel",
              "reconnaissance",
              "quality_gates",
              "ui_ux_qa",
              "flywheel_ui_dogfood",
              "agentic_vision",
              "closed_loop",
              "learnings",
              "project_ideation",
              "tech_stack_2026",
              "telemetry_setup",
              "agents_md_maintenance",
              "agent_bootstrap",
              "autonomous_maintenance",
              "parallel_agent_teams",
              "self_reinforced_learning",
              "academic_paper_writing",
              "agent_evaluation",
              "controlled_evaluation",
              "scenario_testing",
              "overview",
            ],
            description: "Which methodology to explain",
          },
        },
        required: ["topic"],
      },
      handler: async (args) => {
        const content = METHODOLOGY_CONTENT[args.topic];
        if (!content)
          throw new Error(
            `Unknown topic: ${args.topic}. Available: ${Object.keys(METHODOLOGY_CONTENT).join(", ")}`
          );

        return content;
      },
    },
    {
      name: "check_mcp_setup",
      description:
        "Comprehensive diagnostic wizard for the entire NodeBench MCP. Checks all env vars, API keys, optional npm packages, and external services across every domain. Returns a full readiness report with per-domain status and step-by-step setup instructions for anything missing. Run this FIRST to see what capabilities are available and what needs configuration.",
      inputSchema: {
        type: "object",
        properties: {
          domains: {
            type: "array",
            items: { type: "string" },
            description:
              "Specific domains to check (default: all). Options: web, vision, github, llm, embedding, email, flicker_detection, figma_flow, ui_capture, local_file, gaia_solvers",
          },
          test_connections: {
            type: "boolean",
            description:
              "Test reachability of Python servers (flicker on :8006, figma on :8007) and email SMTP/IMAP. Default: false",
          },
          generate_config: {
            type: "boolean",
            description:
              "Generate a complete MCP config snippet with all needed env vars (default: true)",
          },
          generate_setup: {
            type: "boolean",
            description:
              "Generate complete setup files that an agent can write to disk to self-enable every capability: .env.nodebench (env template), setup-nodebench.sh (bash), setup-nodebench.ps1 (powershell), docker-compose.nodebench.yml (Python servers). Default: false",
          },
        },
        required: [],
      },
      handler: async (args: any) => {
        const testConnections = args.test_connections === true;
        const generateConfig = args.generate_config !== false;
        const generateSetup = args.generate_setup === true;
        const targetDomains = args.domains as string[] | undefined;

        type Check = {
          item: string;
          status: "ok" | "missing" | "optional" | "installed" | "not_installed";
          value?: string;
          hint?: string;
        };
        type DomainReport = {
          domain: string;
          ready: boolean;
          status: "ready" | "partial" | "not_configured";
          checks: Check[];
          tools: string[];
          setupInstructions?: string[];
        };

        const reports: DomainReport[] = [];

        const envCheck = (name: string, hint?: string): Check => {
          const val = process.env[name];
          return {
            item: name,
            status: val ? "ok" : "missing",
            value: val ? `${val.substring(0, 4)}***` : undefined,
            hint: !val ? hint : undefined,
          };
        };
        const anyEnv = (...names: string[]) => names.some((n) => !!process.env[n]);
        const pkgCheck = (name: string): Check => ({
          item: `npm: ${name}`,
          status: _isInstalled(name) ? "installed" : "not_installed",
          hint: !_isInstalled(name) ? `npm install ${name}` : undefined,
        });
        const shouldCheck = (d: string) => !targetDomains || targetDomains.includes(d);

        // ── WEB ──
        if (shouldCheck("web")) {
          const checks = [
            envCheck("GEMINI_API_KEY", "Google AI key (free at https://aistudio.google.com/apikey)"),
            envCheck("OPENAI_API_KEY", "OpenAI key from https://platform.openai.com/api-keys"),
            envCheck("PERPLEXITY_API_KEY", "Perplexity key from https://www.perplexity.ai/settings/api"),
          ];
          const ok = anyEnv("GEMINI_API_KEY", "OPENAI_API_KEY", "PERPLEXITY_API_KEY");
          reports.push({
            domain: "web",
            ready: ok,
            status: ok ? "ready" : "not_configured",
            checks,
            tools: ["web_search", "fetch_url"],
            ...(!ok
              ? {
                  setupInstructions: [
                    "web_search needs at least ONE LLM API key.",
                    "Easiest: Get a free Gemini key at https://aistudio.google.com/apikey",
                    "Set GEMINI_API_KEY=your-key in your MCP config env vars.",
                    "fetch_url works without any API keys (raw HTTP fetch).",
                  ],
                }
              : {}),
          });
        }

        // ── VISION ──
        if (shouldCheck("vision")) {
          const pw = _isInstalled("playwright");
          const checks = [
            envCheck("GEMINI_API_KEY", "Needed for LLM-based image analysis"),
            envCheck("OPENAI_API_KEY", "Alternative: OpenAI vision models"),
            pkgCheck("playwright"),
          ];
          const hasLlm = anyEnv("GEMINI_API_KEY", "OPENAI_API_KEY");
          reports.push({
            domain: "vision",
            ready: hasLlm,
            status: hasLlm ? (pw ? "ready" : "partial") : "not_configured",
            checks,
            tools: ["discover_vision_env", "analyze_screenshot", "manipulate_screenshot", "diff_screenshots"],
            ...(!hasLlm
              ? {
                  setupInstructions: [
                    "Vision tools need an LLM API key for image analysis.",
                    "Set GEMINI_API_KEY or OPENAI_API_KEY.",
                    "Optional: npm install playwright && npx playwright install chromium",
                  ],
                }
              : !pw
                ? {
                    setupInstructions: [
                      "Vision LLM analysis is ready.",
                      "Optional: npm install playwright && npx playwright install chromium (for browser screenshots)",
                    ],
                  }
                : {}),
          });
        }

        // ── GITHUB ──
        if (shouldCheck("github")) {
          const checks = [envCheck("GITHUB_TOKEN", "Fine-grained token from https://github.com/settings/tokens")];
          const ok = !!process.env.GITHUB_TOKEN;
          reports.push({
            domain: "github",
            ready: ok,
            status: ok ? "ready" : "not_configured",
            checks,
            tools: ["search_github", "analyze_repo", "monitor_repo"],
            ...(!ok
              ? {
                  setupInstructions: [
                    "1. Go to https://github.com/settings/tokens",
                    "2. Generate fine-grained token with: Contents (read), Metadata (read)",
                    "3. Set GITHUB_TOKEN=ghp_your-token",
                  ],
                }
              : {}),
          });
        }

        // ── LLM ──
        if (shouldCheck("llm")) {
          const checks = [
            envCheck("ANTHROPIC_API_KEY", "From https://console.anthropic.com/settings/keys"),
            envCheck("OPENAI_API_KEY", "OpenAI key"),
            envCheck("GEMINI_API_KEY", "Google AI key (free tier)"),
          ];
          const ok = anyEnv("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY");
          reports.push({
            domain: "llm",
            ready: ok,
            status: ok ? "ready" : "not_configured",
            checks,
            tools: ["call_llm", "extract_structured_data", "benchmark_models"],
            ...(!ok
              ? {
                  setupInstructions: [
                    "call_llm needs at least ONE LLM API key.",
                    "ANTHROPIC_API_KEY (Claude), OPENAI_API_KEY (GPT), or GEMINI_API_KEY (Gemini, free).",
                    "Easiest: Get a free Gemini key at https://aistudio.google.com/apikey",
                  ],
                }
              : {}),
          });
        }

        // ── EMBEDDING ──
        if (shouldCheck("embedding")) {
          const hasHf = _isInstalled("@huggingface/transformers");
          const checks = [
            pkgCheck("@huggingface/transformers"),
            envCheck("GEMINI_API_KEY", "Fallback: Google text-embedding-004 (free)"),
            envCheck("OPENAI_API_KEY", "Fallback: OpenAI text-embedding-3-small"),
          ];
          const ok = hasHf || anyEnv("GEMINI_API_KEY", "OPENAI_API_KEY");
          reports.push({
            domain: "embedding",
            ready: ok,
            status: ok ? "ready" : "not_configured",
            checks,
            tools: ["discover_tools (semantic mode)"],
            ...(!ok
              ? {
                  setupInstructions: [
                    "Embedding search enhances discover_tools with semantic understanding.",
                    "Option 1 (recommended, free, local): npm install @huggingface/transformers",
                    "  Uses Xenova/all-MiniLM-L6-v2 (23MB INT8, no API key needed)",
                    "Option 2: Set GEMINI_API_KEY (free Google text-embedding-004)",
                    "Option 3: Set OPENAI_API_KEY (OpenAI text-embedding-3-small, paid)",
                    "Without embedding, discover_tools still works with keyword/fuzzy search.",
                  ],
                }
              : {}),
          });
        }

        // ── EMAIL ──
        if (shouldCheck("email")) {
          const checks = [
            envCheck("EMAIL_USER", "Your email address (e.g., agent@gmail.com)"),
            envCheck("EMAIL_PASS", "App password (NOT regular password)"),
          ];
          const ok = !!process.env.EMAIL_USER && !!process.env.EMAIL_PASS;
          reports.push({
            domain: "email",
            ready: ok,
            status: ok ? "ready" : "not_configured",
            checks,
            tools: ["send_email", "read_emails", "draft_email_reply", "check_email_setup"],
            ...(!ok
              ? {
                  setupInstructions: [
                    "For detailed per-provider setup, run check_email_setup instead.",
                    "Quick start (Gmail):",
                    "1. Enable 2FA at https://myaccount.google.com/security",
                    "2. Create app password at https://myaccount.google.com/apppasswords",
                    "3. Set EMAIL_USER=your.email@gmail.com",
                    "4. Set EMAIL_PASS=your-16-char-app-password",
                  ],
                }
              : {}),
          });
        }

        // ── FLICKER DETECTION ──
        if (shouldCheck("flicker_detection")) {
          const checks: Check[] = [
            { item: "Python FastAPI server (port 8006)", status: "optional", hint: "docker compose up flicker_detection" },
          ];
          let serverOk = false;
          if (testConnections) {
            try {
              const res = await fetch("http://localhost:8006/health", { signal: AbortSignal.timeout(3000) });
              serverOk = res.ok;
              checks[0] = { item: "Python FastAPI server (port 8006)", status: serverOk ? "ok" : "missing", hint: serverOk ? "Server running" : "Not reachable" };
            } catch {
              checks[0] = { item: "Python FastAPI server (port 8006)", status: "missing", hint: "Not reachable. Start with: docker compose up flicker_detection" };
            }
          }
          reports.push({
            domain: "flicker_detection",
            ready: testConnections ? serverOk : true,
            status: testConnections ? (serverOk ? "ready" : "not_configured") : "partial",
            checks,
            tools: ["start_flicker_analysis", "get_flicker_status", "get_flicker_results", "compare_flicker_runs", "detect_flicker_frames"],
            setupInstructions: [
              "Flicker detection requires a Python FastAPI server:",
              "1. cd python-mcp-servers",
              "2. docker compose up flicker_detection",
              "3. Server starts on port 8006",
              "4. Requires ffmpeg installed on the server",
              "Run check_mcp_setup with test_connections=true to verify.",
            ],
          });
        }

        // ── FIGMA FLOW ──
        if (shouldCheck("figma_flow")) {
          const checks: Check[] = [
            envCheck("FIGMA_ACCESS_TOKEN", "From https://www.figma.com/developers/api#access-tokens"),
            { item: "Python FastAPI server (port 8007)", status: "optional", hint: "docker compose up figma_flow" },
          ];
          let serverOk = false;
          if (testConnections) {
            try {
              const res = await fetch("http://localhost:8007/health", { signal: AbortSignal.timeout(3000) });
              serverOk = res.ok;
              checks[1] = { item: "Python FastAPI server (port 8007)", status: serverOk ? "ok" : "missing" };
            } catch {
              checks[1] = { item: "Python FastAPI server (port 8007)", status: "missing", hint: "Not reachable. Start with: docker compose up figma_flow" };
            }
          }
          const hasToken = !!process.env.FIGMA_ACCESS_TOKEN;
          reports.push({
            domain: "figma_flow",
            ready: hasToken && (testConnections ? serverOk : true),
            status: hasToken ? (testConnections ? (serverOk ? "ready" : "partial") : "partial") : "not_configured",
            checks,
            tools: ["analyze_figma_flow", "get_figma_flow_status", "get_figma_flow_results", "compare_figma_flows"],
            ...(!hasToken
              ? {
                  setupInstructions: [
                    "1. Go to https://www.figma.com/developers/api#access-tokens",
                    "2. Generate a personal access token",
                    "3. Set FIGMA_ACCESS_TOKEN=your-token",
                    "4. Start server: cd python-mcp-servers && docker compose up figma_flow (port 8007)",
                  ],
                }
              : {}),
          });
        }

        // ── UI CAPTURE ──
        if (shouldCheck("ui_capture")) {
          const pw = _isInstalled("playwright");
          reports.push({
            domain: "ui_capture",
            ready: pw,
            status: pw ? "ready" : "not_configured",
            checks: [pkgCheck("playwright")],
            tools: ["capture_ui_screenshot", "capture_responsive_suite"],
            ...(!pw
              ? {
                  setupInstructions: [
                    "1. npm install playwright",
                    "2. npx playwright install chromium",
                    "Uses headless Chromium to screenshot URLs at multiple breakpoints.",
                  ],
                }
              : {}),
          });
        }

        // ── LOCAL FILE ──
        if (shouldCheck("local_file")) {
          const deps = [
            { name: "linkedom", use: "HTML parsing" },
            { name: "pdf-parse", use: "PDF extraction" },
            { name: "read-excel-file", use: "Spreadsheet parsing" },
            { name: "sharp", use: "Image processing" },
            { name: "tesseract.js", use: "OCR (text from images)" },
            { name: "yauzl", use: "ZIP extraction" },
            { name: "papaparse", use: "CSV parsing" },
          ];
          const checks = deps.map((d) => ({
            ...pkgCheck(d.name),
            hint: _isInstalled(d.name) ? `Used for: ${d.use}` : `npm install ${d.name} (for: ${d.use})`,
          }));
          const count = deps.filter((d) => _isInstalled(d.name)).length;
          reports.push({
            domain: "local_file",
            ready: true,
            status: count === deps.length ? "ready" : count > 0 ? "partial" : "not_configured",
            checks,
            tools: ["parse_html_file", "parse_pdf_file", "parse_excel_file", "parse_csv_file", "ocr_image", "extract_zip", "read_local_file"],
            setupInstructions: [
              "Core file tools (read, stat, list) always work. Optional deps extend capabilities:",
              ...deps.filter((d) => !_isInstalled(d.name)).map((d) => `  npm install ${d.name} → ${d.use}`),
              deps.every((d) => _isInstalled(d.name))
                ? "All optional file deps installed!"
                : "Install all: npm install linkedom pdf-parse read-excel-file sharp tesseract.js yauzl papaparse",
            ],
          });
        }

        // ── GAIA SOLVERS ──
        if (shouldCheck("gaia_solvers")) {
          const checks = [
            envCheck("HF_TOKEN", "Hugging Face token from https://huggingface.co/settings/tokens"),
            pkgCheck("sharp"),
            pkgCheck("tesseract.js"),
          ];
          const hasToken = !!process.env.HF_TOKEN;
          const hasDeps = _isInstalled("sharp") && _isInstalled("tesseract.js");
          reports.push({
            domain: "gaia_solvers",
            ready: hasToken && hasDeps,
            status: hasToken && hasDeps ? "ready" : hasToken || hasDeps ? "partial" : "not_configured",
            checks,
            tools: ["solve_red_green_deviation_average_from_image", "solve_green_polygon_area_from_image", "read_image_ocr_text", "count_shapes_in_image", "solve_chessboard_fen", "measure_angles_in_image"],
            ...(!hasToken || !hasDeps
              ? {
                  setupInstructions: [
                    ...(!hasToken ? ["1. Get token at https://huggingface.co/settings/tokens", "2. Set HF_TOKEN=hf_your-token"] : []),
                    ...(!hasDeps ? ["3. npm install sharp tesseract.js"] : []),
                  ],
                }
              : {}),
          });
        }

        // ── Summary ──
        const readyCount = reports.filter((r) => r.ready).length;
        const partialCount = reports.filter((r) => r.status === "partial").length;
        const missingCount = reports.filter((r) => r.status === "not_configured").length;

        // ── MCP config snippet ──
        let configSnippet: string | undefined;
        if (generateConfig) {
          const envVars: Record<string, string> = {};
          for (const report of reports) {
            for (const check of report.checks) {
              if (check.status === "missing" && !check.item.startsWith("npm:") && !check.item.includes("server")) {
                envVars[check.item] = check.hint || "your-value-here";
              }
            }
          }
          if (Object.keys(envVars).length > 0) {
            configSnippet = JSON.stringify(
              {
                mcpServers: {
                  nodebench: {
                    command: "npx",
                    args: ["-y", "nodebench-mcp"],
                    env: Object.fromEntries(
                      Object.entries(envVars).map(([k, v]) => [k, process.env[k] || v])
                    ),
                  },
                },
              },
              null,
              2
            );
          }
        }

        // ── Setup file generation ──
        let setupFiles: Record<string, { filename: string; content: string; description: string }> | undefined;
        if (generateSetup) {
          // .env.nodebench — complete env var template
          const envTemplate = [
            "# ═══════════════════════════════════════════════════════════",
            "# NodeBench MCP — Environment Variables",
            "# Generated by check_mcp_setup. Fill in values and rename to .env",
            "# ═══════════════════════════════════════════════════════════",
            "",
            "# ── LLM / Web Search (at least ONE required) ──",
            `GEMINI_API_KEY=${process.env.GEMINI_API_KEY || ""}                  # Free at https://aistudio.google.com/apikey`,
            `OPENAI_API_KEY=${process.env.OPENAI_API_KEY || ""}                  # https://platform.openai.com/api-keys`,
            `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ""}            # https://console.anthropic.com/settings/keys`,
            `PERPLEXITY_API_KEY=${process.env.PERPLEXITY_API_KEY || ""}          # https://www.perplexity.ai/settings/api`,
            "",
            "# ── GitHub ──",
            `GITHUB_TOKEN=${process.env.GITHUB_TOKEN || ""}                      # Fine-grained: https://github.com/settings/tokens`,
            "",
            "# ── Email (SMTP/IMAP) ──",
            `EMAIL_USER=${process.env.EMAIL_USER || ""}                          # e.g. agent@gmail.com`,
            `EMAIL_PASS=${process.env.EMAIL_PASS || ""}                          # App password (NOT regular password)`,
            `EMAIL_SMTP_HOST=${process.env.EMAIL_SMTP_HOST || "smtp.gmail.com"}  # Default: smtp.gmail.com`,
            `EMAIL_SMTP_PORT=${process.env.EMAIL_SMTP_PORT || "465"}             # Default: 465 (TLS)`,
            `EMAIL_IMAP_HOST=${process.env.EMAIL_IMAP_HOST || "imap.gmail.com"}  # Default: imap.gmail.com`,
            `EMAIL_IMAP_PORT=${process.env.EMAIL_IMAP_PORT || "993"}             # Default: 993 (TLS)`,
            "",
            "# ── Figma ──",
            `FIGMA_ACCESS_TOKEN=${process.env.FIGMA_ACCESS_TOKEN || ""}          # https://www.figma.com/developers/api#access-tokens`,
            "",
            "# ── Hugging Face (GAIA solvers + local embeddings) ──",
            `HF_TOKEN=${process.env.HF_TOKEN || ""}                              # https://huggingface.co/settings/tokens`,
            "",
            "# ── Python servers (flicker detection + figma flow) ──",
            "# These are started via docker compose, not env vars.",
            "# See docker-compose.nodebench.yml for configuration.",
            "",
          ].join("\n");

          // setup-nodebench.sh — bash install script
          const bashScript = [
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            "",
            "# ═══════════════════════════════════════════════════════════",
            "# NodeBench MCP — Setup Script (bash)",
            "# Generated by check_mcp_setup",
            "# ═══════════════════════════════════════════════════════════",
            "",
            'echo "=== NodeBench MCP Setup ==="',
            'echo ""',
            "",
            "# Step 1: Install required dependencies",
            'echo "→ Installing required npm packages..."',
            "npm install @modelcontextprotocol/sdk @toon-format/toon",
            "",
            "# Step 2: Install optional dependencies for extended capabilities",
            'echo "→ Installing optional dependencies..."',
            'echo "  These unlock: HTML parsing, PDF extraction, Excel/CSV, OCR, images, ZIP, browser screenshots"',
            "npm install linkedom pdf-parse read-excel-file sharp tesseract.js yauzl papaparse || true",
            "",
            "# Step 3: Install embedding provider (local semantic search)",
            'echo "→ Installing local embedding model..."',
            'echo "  Enables semantic search in discover_tools (23MB model, no API key needed)"',
            "npm install @huggingface/transformers || true",
            "",
            "# Step 4: Install Playwright for browser-based tools",
            'echo "→ Installing Playwright + Chromium..."',
            "npm install playwright || true",
            "npx playwright install chromium || true",
            "",
            "# Step 5: Install LLM SDKs",
            'echo "→ Installing LLM SDKs..."',
            "npm install @anthropic-ai/sdk @google/genai openai || true",
            "",
            "# Step 6: Set up Python servers (optional)",
            'echo ""',
            'echo "→ Python servers (flicker detection + figma flow):"',
            'echo "  If you need these, run: docker compose -f docker-compose.nodebench.yml up -d"',
            "",
            "# Step 7: Environment variables",
            'echo ""',
            'echo "=== Setup Complete ==="',
            'echo ""',
            'echo "Next steps:"',
            'echo "  1. Copy .env.nodebench to .env and fill in your API keys"',
            'echo "  2. Add env vars to your MCP config (Claude Code / Cursor / etc)"',
            'echo "  3. Run: npx nodebench-mcp --preset full"',
            'echo "  4. Verify: call check_mcp_setup to see all domains"',
            "",
          ].join("\n");

          // setup-nodebench.ps1 — PowerShell install script
          const psScript = [
            "# ═══════════════════════════════════════════════════════════",
            "# NodeBench MCP — Setup Script (PowerShell)",
            "# Generated by check_mcp_setup",
            "# ═══════════════════════════════════════════════════════════",
            "",
            '$ErrorActionPreference = "Continue"',
            "",
            'Write-Host "=== NodeBench MCP Setup ===" -ForegroundColor Cyan',
            'Write-Host ""',
            "",
            "# Step 1: Required dependencies",
            'Write-Host "-> Installing required npm packages..." -ForegroundColor Yellow',
            "npm install @modelcontextprotocol/sdk @toon-format/toon",
            "",
            "# Step 2: Optional dependencies",
            'Write-Host "-> Installing optional dependencies..." -ForegroundColor Yellow',
            "npm install linkedom pdf-parse read-excel-file sharp tesseract.js yauzl papaparse 2>$null",
            "",
            "# Step 3: Embedding provider",
            'Write-Host "-> Installing local embedding model..." -ForegroundColor Yellow',
            "npm install @huggingface/transformers 2>$null",
            "",
            "# Step 4: Playwright",
            'Write-Host "-> Installing Playwright + Chromium..." -ForegroundColor Yellow',
            "npm install playwright 2>$null",
            "npx playwright install chromium 2>$null",
            "",
            "# Step 5: LLM SDKs",
            'Write-Host "-> Installing LLM SDKs..." -ForegroundColor Yellow',
            "npm install @anthropic-ai/sdk @google/genai openai 2>$null",
            "",
            "# Step 6: Python servers",
            'Write-Host ""',
            'Write-Host "-> Python servers (flicker detection + figma flow):" -ForegroundColor Yellow',
            'Write-Host "  If needed: docker compose -f docker-compose.nodebench.yml up -d"',
            "",
            'Write-Host ""',
            'Write-Host "=== Setup Complete ===" -ForegroundColor Green',
            'Write-Host ""',
            'Write-Host "Next steps:"',
            'Write-Host "  1. Copy .env.nodebench to .env and fill in your API keys"',
            'Write-Host "  2. Add env vars to your MCP config (Claude Code / Cursor / etc)"',
            'Write-Host "  3. Run: npx nodebench-mcp --preset full"',
            'Write-Host "  4. Verify: call check_mcp_setup to see all domains"',
            "",
          ].join("\n");

          // docker-compose.nodebench.yml
          const dockerCompose = [
            "# ═══════════════════════════════════════════════════════════",
            "# NodeBench MCP — Docker Compose for Python Servers",
            "# Generated by check_mcp_setup",
            "# ═══════════════════════════════════════════════════════════",
            "# Usage: docker compose -f docker-compose.nodebench.yml up -d",
            "",
            "services:",
            "  flicker_detection:",
            "    build: ./python-mcp-servers/flicker_detection",
            "    ports:",
            '      - "8006:8006"',
            "    volumes:",
            "      - ./tmp/flicker:/app/tmp",
            "    restart: unless-stopped",
            "    healthcheck:",
            "      test: curl -f http://localhost:8006/health || exit 1",
            "      interval: 30s",
            "      timeout: 5s",
            "      retries: 3",
            "",
            "  figma_flow:",
            "    build: ./python-mcp-servers/figma_flow",
            "    ports:",
            '      - "8007:8007"',
            "    environment:",
            "      - FIGMA_ACCESS_TOKEN=${FIGMA_ACCESS_TOKEN:-}",
            "    volumes:",
            "      - ./tmp/figma:/app/tmp",
            "    restart: unless-stopped",
            "    healthcheck:",
            "      test: curl -f http://localhost:8007/health || exit 1",
            "      interval: 30s",
            "      timeout: 5s",
            "      retries: 3",
            "",
          ].join("\n");

          // Full MCP config with ALL env vars
          const allEnvVars: Record<string, string> = {
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || "your-gemini-api-key",
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || "your-openai-api-key",
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "your-anthropic-api-key",
            PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || "your-perplexity-api-key",
            GITHUB_TOKEN: process.env.GITHUB_TOKEN || "ghp_your-github-token",
            EMAIL_USER: process.env.EMAIL_USER || "your.email@gmail.com",
            EMAIL_PASS: process.env.EMAIL_PASS || "your-16-char-app-password",
            EMAIL_SMTP_HOST: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
            EMAIL_SMTP_PORT: process.env.EMAIL_SMTP_PORT || "465",
            EMAIL_IMAP_HOST: process.env.EMAIL_IMAP_HOST || "imap.gmail.com",
            EMAIL_IMAP_PORT: process.env.EMAIL_IMAP_PORT || "993",
            FIGMA_ACCESS_TOKEN: process.env.FIGMA_ACCESS_TOKEN || "your-figma-token",
            HF_TOKEN: process.env.HF_TOKEN || "hf_your-huggingface-token",
          };
          const fullMcpConfig = JSON.stringify(
            {
              mcpServers: {
                nodebench: {
                  command: "npx",
                  args: ["-y", "nodebench-mcp", "--preset", "full"],
                  env: allEnvVars,
                },
              },
            },
            null,
            2
          );

          setupFiles = {
            env: {
              filename: ".env.nodebench",
              content: envTemplate,
              description: "Environment variable template — copy to .env and fill in your API keys",
            },
            bash: {
              filename: "setup-nodebench.sh",
              content: bashScript,
              description: "Bash install script — chmod +x setup-nodebench.sh && ./setup-nodebench.sh",
            },
            powershell: {
              filename: "setup-nodebench.ps1",
              content: psScript,
              description: "PowerShell install script — .\\setup-nodebench.ps1",
            },
            docker: {
              filename: "docker-compose.nodebench.yml",
              content: dockerCompose,
              description: "Docker Compose for Python servers (flicker detection + figma flow)",
            },
            mcpConfig: {
              filename: "mcp-config.nodebench.json",
              content: fullMcpConfig,
              description: "Full MCP config with ALL env vars — paste into Claude Code / Cursor settings",
            },
          };
        }

        return {
          summary: {
            totalDomains: reports.length,
            ready: readyCount,
            partial: partialCount,
            notConfigured: missingCount,
            overallStatus:
              missingCount === 0
                ? "fully_configured"
                : readyCount > 0
                  ? "partially_configured"
                  : "needs_setup",
          },
          domains: reports,
          ...(configSnippet ? { mcpConfigSnippet: configSnippet } : {}),
          ...(setupFiles ? { setupFiles } : {}),
          nextSteps:
            readyCount === reports.length
              ? [
                  "All checked domains are configured! Start working.",
                  "Run discover_tools to find the right tools for your task.",
                  "Run getMethodology('overview') to see available methodologies.",
                ]
              : generateSetup
                ? [
                    "Setup files generated! Write them to your project root:",
                    "  1. Write .env.nodebench → fill in API keys → rename to .env",
                    "  2. Run setup-nodebench.sh (bash) or setup-nodebench.ps1 (PowerShell) to install all deps",
                    "  3. Optionally run docker-compose.nodebench.yml for Python servers",
                    "  4. Copy mcp-config.nodebench.json content into your Claude Code / Cursor MCP settings",
                    "  5. Re-run check_mcp_setup to verify everything is configured",
                  ]
                : [
                    `${missingCount} domain(s) need configuration. See setupInstructions per domain.`,
                    "Add env vars to your MCP config (see mcpConfigSnippet) or shell profile.",
                    "Re-run check_mcp_setup to verify after configuration.",
                    "Tip: Most capabilities work without ALL domains configured. Start with what you need.",
                    "Tip: Run check_mcp_setup with generate_setup=true to get ready-to-write setup files.",
                  ],
        };
      },
    },
  ];
}
