/**
 * Prompt Builder — Personalized prompts for batch autopilot runs
 *
 * Three templates:
 * 1. Delta summary (condense discoveries)
 * 2. Brief generation (personalized to operator profile)
 * 3. Action planning (only if WRITE permissions enabled)
 */

interface DeltaData {
  feedItems: Array<{ title: string; summary: string; category: string; score: number; url: string; source: string }>;
  signals: Array<{ content: string; source: string; kind: string }>;
  narrativeEvents: Array<{ headline: string; summary: string; significance: string }>;
  researchTasks: Array<{ entityType: string; status: string; qualityScore: number }>;
}

interface ProfileContext {
  displayName: string;
  role?: string;
  domains?: string[];
  writingStyle?: string;
  goals: Array<{ rank: number; description: string }>;
  briefFormat: string;
  citationStyle: string;
  includeCostEstimate: boolean;
}

// ── 1. Delta Summary ────────────────────────────────────────────────────────

export function buildDeltaSummaryPrompt(delta: DeltaData, intervalLabel: string): string {
  const sections: string[] = [];

  if (delta.feedItems.length > 0) {
    const items = delta.feedItems
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map((f) => `- [${f.category}] ${f.title} (score: ${f.score})${f.source ? ` — ${f.source}` : ""}`)
      .join("\n");
    sections.push(`### Feed Items (${delta.feedItems.length} new)\n${items}`);
  }

  if (delta.signals.length > 0) {
    const items = delta.signals
      .slice(0, 10)
      .map((s) => `- [${s.kind}] ${s.content}${s.source ? ` — ${s.source}` : ""}`)
      .join("\n");
    sections.push(`### Signals (${delta.signals.length} new)\n${items}`);
  }

  if (delta.narrativeEvents.length > 0) {
    const items = delta.narrativeEvents
      .map((e) => `- [${e.significance}] ${e.headline}: ${e.summary}`)
      .join("\n");
    sections.push(`### Narrative Events (${delta.narrativeEvents.length} new)\n${items}`);
  }

  if (delta.researchTasks.length > 0) {
    const items = delta.researchTasks
      .map((t) => `- ${t.entityType} research (quality: ${t.qualityScore}/100)`)
      .join("\n");
    sections.push(`### Completed Research (${delta.researchTasks.length})\n${items}`);
  }

  const total = delta.feedItems.length + delta.signals.length +
    delta.narrativeEvents.length + delta.researchTasks.length;

  return `You are summarizing ${total} new discoveries from the past ${intervalLabel}.

Group by topic clusters and rank by urgency. Output structured markdown with ## headings per cluster.
Keep the summary under 1500 tokens. Focus on the most impactful items.

---

${sections.join("\n\n")}`;
}

// ── 2. Brief Generation ─────────────────────────────────────────────────────

export function buildBriefPrompt(deltaSummary: string, profile: ProfileContext): string {
  const goalsText = profile.goals
    .sort((a, b) => a.rank - b.rank)
    .map((g) => `${g.rank}. ${g.description}`)
    .join("\n");

  const formatInstructions = profile.briefFormat === "narrative"
    ? "Write in flowing narrative prose. Use paragraphs, not bullet points."
    : profile.briefFormat === "structured"
    ? "Use a structured format with clear ## headings, tables where helpful, and numbered lists."
    : "Use TL;DR format: 2-3 sentence summary at the top, then bullet points for details.";

  return `You are writing a personalized intelligence brief for ${profile.displayName}${profile.role ? `, a ${profile.role}` : ""}.

${profile.domains?.length ? `Their focus domains: ${profile.domains.join(", ")}` : ""}

Their ranked goals:
${goalsText}

Writing style: ${profile.writingStyle || "concise"}
Citation style: ${profile.citationStyle}
${formatInstructions}

Based on these accumulated discoveries:

---
${deltaSummary}
---

Generate a brief with:
1. **TL;DR** — 2-3 sentences on what matters most
2. **Key Discoveries** — Ranked by relevance to their goals
3. **Action Items** — What they should look into or do next
4. **Watch List** — What to monitor going forward

${profile.includeCostEstimate ? "Include a one-line cost estimate at the end (tokens used)." : ""}
Keep the brief focused and under 3000 tokens.`;
}

// ── 3. Action Planning ──────────────────────────────────────────────────────

interface PermissionContext {
  writeForumPosts: boolean;
  writeEmailDrafts: boolean;
  sendEmail: boolean;
  submitForms: boolean;
  uploadDocuments: boolean;
}

export function buildActionPlanPrompt(
  deltaSummary: string,
  permissions: PermissionContext,
  goals: Array<{ rank: number; description: string }>
): string {
  const enabledPerms = Object.entries(permissions)
    .filter(([, v]) => v)
    .map(([k]) => k);

  if (enabledPerms.length === 0) {
    return ""; // No WRITE permissions enabled — skip action planning
  }

  const goalsText = goals
    .sort((a, b) => a.rank - b.rank)
    .map((g) => `${g.rank}. ${g.description}`)
    .join("\n");

  return `Based on these discoveries and the user's goals, suggest up to 5 concrete actions the agent could take.

User's goals:
${goalsText}

Enabled permissions: ${enabledPerms.join(", ")}

Discoveries:
---
${deltaSummary}
---

For each action, output JSON:
{
  "description": "What to do",
  "riskTier": "low" | "medium" | "high",
  "requiredPermission": "writeForumPosts" | "writeEmailDrafts" | "sendEmail" | "submitForms" | "uploadDocuments"
}

Only suggest actions that match the enabled permissions.
Risk tiers: low = formatting/drafting, medium = creating content, high = sending/submitting externally.
Output a JSON array of actions.`;
}
