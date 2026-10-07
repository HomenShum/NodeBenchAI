/**
 * System Prompt Builder — A-PR-B.6 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Pure function (no Convex, no I/O) that turns an array of `agentLessons`
 * rows into a markdown-formatted system-prompt prefix. The agent runtime
 * concatenates this prefix to the model's existing system prompt before
 * each turn so previously-captured lessons literally cannot be ignored.
 *
 * Format design notes:
 *   - Lessons are grouped by type so the agent doesn't have to scan a
 *     mixed list. Order: SEMANTIC → INFRASTRUCTURE → SPIRAL → BUDGET.
 *     Semantic + spiral are "what NOT to do" (highest priority);
 *     infrastructure + budget are "what to expect at the system level".
 *   - Pinned lessons get a 📌 prefix so the agent can tell which ones
 *     the user explicitly elevated.
 *   - The block opens with a stable header so downstream tooling
 *     (lesson-injection telemetry, prompt cache invalidation) can
 *     detect it deterministically.
 *   - Empty input returns an empty string — never a fake "no lessons"
 *     placeholder. Caller decides whether to concatenate.
 *
 * Bound: total prefix capped at `MAX_PROMPT_PREFIX_BYTES` UTF-8 bytes
 * (8 KB by default). When over budget, lower-priority lessons are
 * dropped from the tail. Pinned lessons are kept regardless.
 */

import type { AgentLesson } from "./captureLesson";

// ════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════

/**
 * Hard ceiling on the system-prompt prefix size. 8 KB is generous for
 * 5-10 lesson sentences but small enough to not derail context windows.
 */
export const MAX_PROMPT_PREFIX_BYTES = 8_192;

/** Stable header so downstream tooling can detect the prefix block. */
export const LESSONS_HEADER = "## Active lessons (auto-injected)";
export const LESSONS_FOOTER = "## End of lessons";

// ════════════════════════════════════════════════════════════════════════
// PRIORITY ORDER
// ════════════════════════════════════════════════════════════════════════

const TYPE_PRIORITY: Record<AgentLesson["type"], number> = {
  semantic: 0, // highest
  spiral: 1,
  infrastructure: 2,
  budget: 3, // lowest
};

const TYPE_HEADING: Record<AgentLesson["type"], string> = {
  semantic: "### Past mistakes to avoid",
  spiral: "### Loop patterns to break",
  infrastructure: "### Known model failover patterns",
  budget: "### Budget signals",
};

// ════════════════════════════════════════════════════════════════════════
// FORMATTERS
// ════════════════════════════════════════════════════════════════════════

function pinPrefix(lesson: AgentLesson): string {
  return lesson.pinned ? "📌 " : "";
}

function formatSemantic(lesson: AgentLesson): string {
  const tool = lesson.toolName ? ` (\`${lesson.toolName}\`)` : "";
  const note = lesson.userNote ? ` — user note: "${lesson.userNote}"` : "";
  return `- ${pinPrefix(lesson)}**Don't:** ${
    lesson.mistakePattern ?? "(unspecified mistake)"
  }${tool}${note}\n  **Do:** ${
    lesson.correctPattern ?? "(unspecified correct pattern)"
  }`;
}

function formatSpiral(lesson: AgentLesson): string {
  const tool = lesson.toolName ? ` via \`${lesson.toolName}\`` : "";
  return `- ${pinPrefix(lesson)}**Loop:** ${
    lesson.mistakePattern ?? "(unspecified loop)"
  }${tool}\n  **Break by:** ${
    lesson.correctPattern ?? "(unspecified break pattern)"
  }`;
}

function formatInfrastructure(lesson: AgentLesson): string {
  if (!lesson.fromModel || !lesson.toModel) return "";
  const status =
    typeof lesson.failedWith === "number"
      ? `HTTP ${lesson.failedWith}`
      : lesson.failedWith ?? "error";
  const outcome = lesson.succeeded ? "succeeded" : "failed";
  const count =
    lesson.count && lesson.count > 1 ? ` (×${lesson.count})` : "";
  return `- ${pinPrefix(lesson)}\`${lesson.fromModel}\` → \`${lesson.toModel}\` after ${status}; fallback ${outcome}${count}`;
}

function formatBudget(lesson: AgentLesson): string {
  const cat = lesson.taskCategory ?? "(unknown task)";
  const tokens = lesson.estimatedTokensRemaining ?? 0;
  return `- ${pinPrefix(lesson)}**${cat}** hit budget cap with ~${tokens.toLocaleString()} tokens estimated remaining`;
}

function formatLesson(lesson: AgentLesson): string {
  switch (lesson.type) {
    case "semantic":
      return formatSemantic(lesson);
    case "spiral":
      return formatSpiral(lesson);
    case "infrastructure":
      return formatInfrastructure(lesson);
    case "budget":
      return formatBudget(lesson);
    default:
      // HONEST_STATUS: unknown lesson type → drop quietly. Future lesson
      // types added to the schema must extend this switch in the same PR.
      return "";
  }
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════

export interface BuildPromptPrefixOptions {
  /** Override the byte ceiling. Defaults to MAX_PROMPT_PREFIX_BYTES. */
  maxBytes?: number;
  /** Optional intro line above the header (e.g. "User: alice"). */
  introLine?: string;
}

/**
 * Render an ordered list of lessons into a markdown prompt prefix.
 *
 * Returns the empty string when `lessons` is empty so the caller can
 * `prefix + originalSystemPrompt` without conditionals.
 */
export function buildSystemPromptPrefix(
  lessons: readonly AgentLesson[],
  options: BuildPromptPrefixOptions = {},
): string {
  if (lessons.length === 0) return "";

  const maxBytes = options.maxBytes ?? MAX_PROMPT_PREFIX_BYTES;

  // Sort by (pinned desc, type priority asc, capturedAt desc).
  const sorted = [...lessons].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const tDelta = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
    if (tDelta !== 0) return tDelta;
    return b.capturedAt - a.capturedAt;
  });

  const lines: string[] = [];
  if (options.introLine) lines.push(options.introLine, "");
  lines.push(LESSONS_HEADER);

  let currentType: AgentLesson["type"] | null = null;
  let currentBytes = byteLengthOf(lines.join("\n"));
  const droppedTypes = new Set<AgentLesson["type"]>();

  for (const lesson of sorted) {
    if (lesson.type !== currentType) {
      const heading = TYPE_HEADING[lesson.type];
      // Always include the heading even if subsequent lessons get
      // dropped; otherwise the section headers would dangle.
      const headingLine = `\n${heading}`;
      currentBytes += byteLengthOf(headingLine + "\n");
      lines.push(headingLine);
      currentType = lesson.type;
    }

    const formatted = formatLesson(lesson);
    if (!formatted) continue;
    const lineBytes = byteLengthOf(formatted + "\n");
    if (!lesson.pinned && currentBytes + lineBytes > maxBytes) {
      droppedTypes.add(lesson.type);
      continue; // skip non-pinned lessons that overflow the budget
    }
    lines.push(formatted);
    currentBytes += lineBytes;
  }

  if (droppedTypes.size > 0) {
    lines.push("");
    lines.push(
      `> Note: some lessons were trimmed to fit the ${maxBytes}-byte prompt budget.`,
    );
  }

  lines.push("");
  lines.push(LESSONS_FOOTER);
  return lines.join("\n");
}

/** UTF-8 byte length of a string. Cheap and dependency-free. */
function byteLengthOf(s: string): number {
  // TextEncoder is available in both V8 isolate and Node runtimes.
  return new TextEncoder().encode(s).length;
}

/**
 * Helper for the agent runtime — concatenate the lesson prefix in
 * front of an existing system prompt. Returns the original prompt
 * unchanged when the lesson list is empty so the call site stays
 * unconditional.
 */
export function injectLessonsIntoSystemPrompt(
  originalSystemPrompt: string,
  lessons: readonly AgentLesson[],
  options: BuildPromptPrefixOptions = {},
): string {
  const prefix = buildSystemPromptPrefix(lessons, options);
  if (!prefix) return originalSystemPrompt;
  return `${prefix}\n\n${originalSystemPrompt}`;
}
