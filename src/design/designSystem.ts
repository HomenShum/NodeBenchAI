/**
 * NodeBench AI-Surface Design System
 * ==================================
 *
 * The machine-readable design contract for NodeBench's agent chat surface — the
 * layer where we adopt Vercel AI Elements primitives instead of hand-rolled
 * chat / markdown / reasoning / tool-call components, so "our components" become
 * thin, on-brand adapters over canonical primitives rather than ~56 bespoke
 * files we self-maintain.
 *
 * Pattern: manifest + audit (guidance over enforcement).
 *   - The MANIFEST (`getNodeBenchAiDesignManifest`) is a human-, test-, and
 *     agent-readable description of the tokens, principles, and per-primitive
 *     must/avoid rules for the AI surface.
 *   - The AUDIT (`auditAiSurfaceDesign`) is a thin drift check that REUSES the
 *     canonical banned-pattern linter in `src/design-governance/` — it does not
 *     re-implement the rules. `npm run lint:design` remains the enforcement CLI.
 *
 * Prior art:
 *   - NodeRoom `src/design/designSystem.ts` — the manifest+audit shape mirrored here
 *     (`docs/design/UI_CONTRACT.md` + `src/design/designSystem.ts` in that repo).
 *   - Vercel AI Elements (https://elements.ai-sdk.dev) — the primitive vocabulary.
 *   - Astryx principle "one system for humans and agents" — the same manifest is
 *     read by people, `designSystem.test.ts`, and coding agents.
 *
 * See: docs/design/UI_CONTRACT.md · docs/architecture/AI_ELEMENTS_MIGRATION.md
 *      src/design-governance/ (enforcement) · scripts/ui/designLinter.mjs (CLI)
 */

import {
  getViolationsForSource,
  summarizeViolations,
  type Violation,
} from "@/design-governance";

/* ─── Canonical tokens & scales ──────────────────────────────────────────────
 * Grounded in `src/index.css` (`:root` light + `.dark`). These are the values
 * every AI Elements primitive must resolve to via the shadcn token bridge —
 * `bg-primary`, `text-muted-foreground`, `border`, `ring` render on-brand
 * automatically because the tokens below back them.
 */

/** Terracotta accent — selection, focus, CTA, and agent provenance. */
export const nbAccent = {
  primary: "#d97757",
  secondary: "#e59579",
  hover: "#c76648",
  /** shadcn `--primary` HSL: light `18 62% 60%`, dark `18 60% 55%`. */
  primaryHslLight: "18 62% 60%",
  primaryHslDark: "18 60% 55%",
} as const;

/** Warm neutral app surfaces and the glass-card hairline (`--border-color`). */
export const nbSurface = {
  bgPrimaryLight: "#FFFFFF",
  bgPrimaryDark: "#111418",
  /** The glass-card border: `border-white/[0.06]` dark, `border-black/[0.06]` light. */
  glassBorderDark: "rgba(255, 255, 255, 0.10)",
  glassBorderLight: "rgba(0, 0, 0, 0.06)",
  /** The glass-card fill: `bg-white/[0.02]`. */
  glassFill: "rgba(255, 255, 255, 0.02)",
} as const;

/** Semantic colors — reserved meanings; never repurposed for selection. */
export const nbSemantic = {
  success: "#2e9e6b", // completed / healthy only
  warning: "#d9a441", // held / review only
  danger: "#dc5b5b", // error / failure only
} as const;

/** Fonts: Inter (primary) → Manrope (brand fallback) for UI; JetBrains Mono for code/trace. */
export const nbFonts = {
  ui: '-apple-system, BlinkMacSystemFont, "Inter", "Manrope", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/**
 * Type scale (px) — documented guidance derived from observed AI-surface usage.
 * Section eyebrows sit at 11px uppercase `tracking-[0.15em]`; body copy 13–14px.
 */
export const nbTypeScalePx = [11, 12, 13, 14, 16, 18, 20, 24, 30, 36] as const;

/** Radius scale (px) — `--radius` base is 8px (0.5rem); panels use 12–16px. */
export const nbRadiusScalePx = [4, 6, 8, 12, 16, 24, 9999] as const;

/* ─── Governed file set ──────────────────────────────────────────────────────
 * The AI surface the manifest speaks for. Passed to `auditAiSurfaceDesign` and
 * used by tooling to scope the drift check to the primitives + consumer layer
 * (not the whole app — that is `npm run lint:design`'s job).
 */
export const aiSurfaceRoots = [
  "src/components/ai-elements", // 24 vendored AI Elements primitives (we own them)
  "src/features/agents/components/ai", // thin consumers: AiMessage, AiConversation, AiPromptInput
  "src/features/agents/components/FastAgentPanel", // live adapters + preserved domain renderers
] as const;

/* ─── Manifest types ─────────────────────────────────────────────────────── */

export type AiPrimitiveAdoption =
  | "migrated" // internals rewritten onto the primitive; export API preserved
  | "wrapped" // primitive wraps existing props/callbacks; domain logic untouched
  | "scaffolded" // themed + available, not yet cut into the target path
  | "planned" // decided target, not yet built
  | "keep_custom_boundary"; // primitive intentionally NOT adopted here; custom stays

export type AiPrimitiveRule = {
  /** AI Elements primitive name, e.g. "reasoning". */
  primitive: string;
  /** NodeBench file(s) that consume it, or the custom file it replaced. */
  consumers: string[];
  role: string;
  adoption: AiPrimitiveAdoption;
  must: string[];
  avoid: string[];
};

export type AiDesignManifest = {
  apiVersion: 1;
  type: "nodebench.ai-surface.design-system.manifest";
  data: {
    name: "NodeBench AI-Surface Design System";
    version: 1;
    inspiration: Array<{ source: string; appliedAs: string }>;
    principles: string[];
    tokens: Array<{ name: string; role: string; value: string }>;
    migration: {
      matrixFiles: 56;
      totalMilestones: 26;
      completedMilestones: 11;
      status: "ongoing";
      canonicalMainThrough: { pullRequest: 527; commit: "28d704b2" };
      completedUnits: string[];
      countingRule: string;
    };
    primitives: AiPrimitiveRule[];
    auditChecks: string[];
  };
};

/* ─── The manifest ───────────────────────────────────────────────────────── */

export function getNodeBenchAiDesignManifest(): AiDesignManifest {
  return {
    apiVersion: 1,
    type: "nodebench.ai-surface.design-system.manifest",
    data: {
      name: "NodeBench AI-Surface Design System",
      version: 1,
      inspiration: [
        {
          source: "Vercel AI Elements (elements.ai-sdk.dev)",
          appliedAs:
            "Canonical primitive vocabulary for chat / reasoning / tool / sources / code, vendored into src/components/ai-elements and themed with NodeBench tokens.",
        },
        {
          source: "NodeRoom src/design/designSystem.ts",
          appliedAs:
            "The manifest+audit shape: one description readable by humans, tests, and agents; enforcement kept in a separate linter.",
        },
        {
          source: "Astryx principle: guidance over enforcement",
          appliedAs:
            "Document concrete primitive roles + must/avoid; catch the highest-risk drift with a linter, don't hard-block on taste.",
        },
      ],
      principles: [
        "Compose, don't surrender — primitives render the generic surface (markdown, reasoning, tool headers, citations); NodeBench's domain + proof affordances (selection cards, arbitrage reports, memory cards, verification receipts) stay custom and sit alongside.",
        "Honesty contract — no primitive drives a stream. Live Convex hooks (useUIMessages(stream:true), useSmoothText, useStream) remain the data source; primitives are the presentation layer fed by hook output. Never replace a live part with a fixture.",
        "Terracotta, never default Tailwind — every primitive resolves to the shadcn token bridge (bg-primary, ring, border). #d97757 is selection/focus/agent provenance; success-green is reserved for completed state, never selection.",
        "Glass DNA — surfaces use the hairline + faint-fill treatment (border-white/[0.06] bg-white/[0.02]) and 11px uppercase tracking-[0.15em] eyebrows, not saturated cards.",
        "Export API is load-bearing — a migrated leaf rewrites internals only; its exported component signature stays byte-for-byte so call sites and barrels never change.",
        "Reduced motion is not optional — motion/react-driven primitives (Shimmer, Reasoning) bypass the CSS reduced-motion override, so each needs an explicit useReducedMotion() guard.",
      ],
      tokens: [
        { name: "--accent-primary", role: "selection, focus, CTA, agent provenance", value: nbAccent.primary },
        { name: "--accent-primary-hover", role: "accent hover", value: nbAccent.hover },
        { name: "--primary (hsl)", role: "shadcn primary bridge → terracotta", value: `${nbAccent.primaryHslLight} / ${nbAccent.primaryHslDark}` },
        { name: "--border-color", role: "glass-card hairline", value: `${nbSurface.glassBorderLight} / ${nbSurface.glassBorderDark}` },
        { name: "--bg-primary", role: "app canvas", value: `${nbSurface.bgPrimaryLight} / ${nbSurface.bgPrimaryDark}` },
        { name: "--success", role: "completed / healthy only — never selection", value: nbSemantic.success },
        { name: "--radius", role: "default container radius (8px)", value: "0.5rem" },
      ],
      migration: {
        matrixFiles: 56,
        totalMilestones: 26,
        completedMilestones: 11,
        status: "ongoing",
        canonicalMainThrough: { pullRequest: 527, commit: "28d704b2" },
        completedUnits: [
          "TypingIndicator",
          "ThoughtBubble",
          "QuickCommandChips",
          "LazySyntaxHighlighter",
          "AgentHierarchy",
          "SourceCard",
          "CollapsibleAgentProgress",
          "ToolCallTransparency",
          "UIMessageBubble",
          "InputBar",
          "LiveEventCard",
        ],
        countingRule:
          "The 11/26 scoreboard uses the original 26 candidate rows: 8 migrate, 17 wrap, and the HumanRequestCard wrap-to-keep re-evaluation row. The other 30 rows are explicit keep_custom. HumanRequestCard remains operationally keep-custom unless a future contract review preserves all HITL semantics. The shared convexToUIParts adapter is required foundation but is tracked outside the fraction.",
      },
      primitives: [
        {
          primitive: "shimmer",
          consumers: ["src/features/agents/components/FastAgentPanel/TypingIndicator.tsx"],
          role: "Streaming / loading text shimmer (replaced the hand-rolled 3-dot loader).",
          adoption: "migrated",
          must: [
            "Guard with useReducedMotion() — render a static span under reduced motion (Shimmer animates via motion/react, which the CSS prefers-reduced-motion override does NOT stop).",
            "Children must be a non-empty string.",
          ],
          avoid: ["Relying on the global CSS reduced-motion rule to stop the sweep."],
        },
        {
          primitive: "reasoning",
          consumers: [
            "src/features/agents/components/FastAgentPanel/FastAgentPanel.ThoughtBubble.tsx",
            "src/features/agents/components/FastAgentPanel/CollapsibleAgentProgress.tsx",
          ],
          role: "Reasoning disclosures, including the migrated thought leaf and wrapped agent-progress shell.",
          adoption: "migrated",
          must: ["Wire isStreaming through to <Reasoning isStreaming>.", "Pass a static trigger message under reduced motion."],
          avoid: ["Duplicating Reasoning and ChainOfThought in the same turn."],
        },
        {
          primitive: "suggestion",
          consumers: ["src/features/agents/components/FastAgentPanel/QuickCommandChips.tsx"],
          role: "Prompt / quick-command chips for the composer.",
          adoption: "migrated",
          must: [
            "Preserve every original onClick branch — Suggestion.onClick returns only the suggestion string, so map it back to the command (e.g. the cmd.navigate → window.location.assign handoff).",
          ],
          avoid: ["Dropping surface-aware command routing when swapping the container."],
        },
        {
          primitive: "code-block",
          consumers: ["src/features/agents/components/FastAgentPanel/LazySyntaxHighlighter.tsx"],
          role: "Shiki-highlighted code (replaced the lazy react-syntax-highlighter/Prism wrapper).",
          adoption: "migrated",
          must: [
            "Stay lazy-imported — Shiki ships ~200 grammars; keep it out of the initial bundle.",
            "Grammar chunks route to assets/shiki/ and are globIgnored from PWA precache (see vite.config) — never force @shikijs/* into one manualChunk (that collapses per-language splitting into a ~10MB blob and fails the build).",
          ],
          avoid: ["Eagerly importing code-block from a live path without the chunking guard."],
        },
        {
          primitive: "task",
          consumers: ["src/features/agents/components/FastAgentPanel/FastAgentPanel.AgentHierarchy.tsx"],
          role: "Sub-agent / delegation list shell with elapsed timing.",
          adoption: "migrated",
          must: ["Preserve startedAt / completedAt timing semantics."],
          avoid: ["Replacing the live ParallelTaskTimeline (Convex useQuery) — that stays custom."],
        },
        {
          primitive: "sources + inline-citation",
          consumers: ["src/features/agents/components/FastAgentPanel/SourceCard.tsx"],
          role: "Source preview list + inline evidence badges.",
          adoption: "migrated",
          must: ["Keep the rich preview extras in the wrapper; map citations to real sourceCaptures."],
          avoid: ["Flattening domain source cards (FusedSearchResults, ResourceLinkCard) into the primitive."],
        },
        {
          primitive: "message + reasoning + tool + sources",
          consumers: [
            "src/features/agents/components/ai/AiMessage.tsx",
            "src/features/agents/components/FastAgentPanel/FastAgentPanel.UIMessageBubble.tsx",
          ],
          role: "The active-path UIMessage bubble: parts → text / reasoning / tool / sources, with domain cards passed through.",
          adoption: "wrapped",
          must: [
            "Wrap generic sub-parts ONLY; domain cards (selection, arbitrage, media, GoalCard) render unchanged inside MessageContent via a renderCustomPart passthrough.",
            "Feed useSmoothText output to MessageResponse — never a static string.",
            "Guard the cutover with MessageBubble.streaming.test.",
          ],
          avoid: ["Letting the adapter emit persistent-text-streaming bodies — useStream stays a live subscription."],
        },
        {
          primitive: "prompt-input + context + model-selector",
          consumers: [
            "src/features/agents/components/ai/AiPromptInput.tsx",
            "src/features/agents/components/FastAgentPanel/FastAgentPanel.InputBar.tsx",
          ],
          role: "Composer: autoresize, send/stop, attachments, model, slash/@mentions/voice.",
          adoption: "wrapped",
          must: [
            "PromptInput.onSubmit must delegate to onSend/onStop/onSpawn — never swallow.",
            "Preserve useAction(enhancePrompt); slash/mentions/voice/drag-drop stay custom.",
          ],
          avoid: ["Replacing the live send path with the primitive's own state."],
        },
        {
          primitive: "task + chain-of-thought + reasoning + tool",
          consumers: ["src/features/agents/components/FastAgentPanel/CollapsibleAgentProgress.tsx"],
          role: "Agent-progress answer/process disclosure while preserving the ToolUIPart feed.",
          adoption: "wrapped",
          must: [
            "Preserve the exported component contract and toolParts: ToolUIPart[] feed.",
            "Describe this as a source migration, not a live-surface claim; the component is not a proven production render path.",
          ],
          avoid: ["Claiming live verification from unit coverage or a successful build."],
        },
        {
          primitive: "tool",
          consumers: ["src/features/agents/components/FastAgentPanel/ToolCallTransparency.tsx"],
          role: "MCP tool-call disclosure with input, output, and error states.",
          adoption: "migrated",
          must: [
            "Preserve running/success/error semantics when mapping to input-available/output-available/output-error.",
            "Keep tool arguments and results available to the existing transparency surface.",
          ],
          avoid: ["Treating an error result as a completed or success state."],
        },
        {
          primitive: "tool + task connector",
          consumers: ["src/features/agents/components/FastAgentPanel/LiveEventCard.tsx"],
          role: "Live agent-event cards fed by the panel's shared live-event derivation.",
          adoption: "migrated",
          must: [
            "Feed the card from derived panel events; never introduce fixture fallback in the production path.",
            "Preserve event status, summary, timing, and task-connector semantics.",
          ],
          avoid: ["Treating source merge or post-deploy health as visual-proof-complete."],
        },
        {
          primitive: "confirmation",
          consumers: ["HumanRequestCard (keep_custom candidate)"],
          role: "HITL approval prompts.",
          adoption: "keep_custom_boundary",
          must: ["If ever adopted, it must carry respondToRequest/cancelRequest + multi-option/textarea semantics."],
          avoid: ["Reducing a HITL question to a bare yes/no — Confirmation lacks textarea/multi-option; keep_custom is defensible."],
        },
        {
          primitive: "checkpoint / plan / artifact / web-preview / context",
          consumers: ["(scaffolded — evaluate per matrix)"],
          role: "Restore-points, goal boards, document artifacts, sandboxed file preview, token/context meters.",
          adoption: "scaffolded",
          must: ["Move scaffolded → live only when wired to the real component, preserving testids + proof affordances and passing e2e content assertions."],
          avoid: ["Marking a primitive 'live' on render-check alone."],
        },
      ],
      auditChecks: [
        "AI-surface files carry no banned saturated/gray Tailwind color classes (delegates to src/design-governance)",
        "no hardcoded indigo focus rings — use ring-ring / the terracotta bridge",
        "migrated leaf components preserve their exported signature (covered by FastAgentPanel __tests__)",
        "motion/react-driven primitives (shimmer, reasoning) carry a useReducedMotion() guard",
        "code-block stays lazy and @shikijs/* is never force-grouped into one chunk",
        "no primitive drives a live stream — Convex hooks remain the data source (honesty contract)",
        "success-green is reserved for completed state and never used for selection",
        "source-merged, visual-proof-complete, and production-live-verified are distinct evidence states",
        "web navigation remains Home - Reports - Chat - Inbox - Me; Workspace remains a separate deployed surface",
      ],
    },
  };
}

/* ─── Audit (thin wrapper over the canonical linter) ─────────────────────── */

export type AiSurfaceAuditResult = {
  ok: boolean;
  checkedAt: string;
  summary: { files: number; high: number; medium: number; low: number };
  findings: Array<{ file: string } & Violation>;
};

/** Cap so a pathological scan can never balloon the result (BOUND). */
const MAX_AUDIT_FINDINGS = 500;

/**
 * Audit the AI-surface files for design-governance drift. Reuses
 * `getViolationsForSource` from `src/design-governance` — this function only
 * scopes the scan to the AI surface and shapes the result; it defines no rules.
 *
 * @param files - path → file content for AI-surface files (caller reads them;
 *   this module is pure so it stays testable and side-effect free).
 * @param checkedAt - ISO timestamp (injected so the fn is deterministic in tests).
 */
export function auditAiSurfaceDesign(
  files: Record<string, string>,
  checkedAt: string,
): AiSurfaceAuditResult {
  const findings: Array<{ file: string } & Violation> = [];
  const paths = Object.keys(files).sort(); // deterministic order

  for (const file of paths) {
    if (findings.length >= MAX_AUDIT_FINDINGS) break;
    for (const v of getViolationsForSource(files[file], file)) {
      findings.push({ file, ...v });
      if (findings.length >= MAX_AUDIT_FINDINGS) break;
    }
  }

  const s = summarizeViolations(findings);
  return {
    ok: s.high === 0,
    checkedAt,
    summary: { files: paths.length, high: s.high, medium: s.medium, low: s.low },
    findings,
  };
}
