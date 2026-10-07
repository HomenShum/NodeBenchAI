/**
 * Operator Profile Template Generator
 *
 * Builds USER.md markdown from wizard answers or structured config.
 */

import type { OperatorProfileConfig } from "./parser";
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_BUDGET,
  DEFAULT_OUTPUT_PREFERENCES,
} from "./parser";

// ── Wizard Answer Types ─────────────────────────────────────────────────────

export interface WizardAnswers {
  // Step 1: Identity
  displayName: string;
  role?: string;
  domains?: string[];
  writingStyle?: string;

  // Step 2: Goals
  goals: string[];

  // Step 3: Schedule
  autonomyMode: "assist" | "batch_autopilot" | "full_autopilot";
  scheduleInterval?: "3h" | "6h" | "12h" | "daily";
  scheduleTimeUtc?: string;

  // Step 4: Permissions
  permissions?: Partial<typeof DEFAULT_PERMISSIONS>;

  // Step 4b: Budget (optional overrides)
  budget?: Partial<typeof DEFAULT_BUDGET>;

  // Step 4c: Output preferences
  outputPreferences?: Partial<typeof DEFAULT_OUTPUT_PREFERENCES>;
}

// ── Template Generator ──────────────────────────────────────────────────────

const AUTONOMY_LABELS: Record<string, string> = {
  assist: "Assist",
  batch_autopilot: "Batch Autopilot",
  full_autopilot: "Full Autopilot",
};

/**
 * Generate USER.md markdown from wizard answers
 */
export function generateProfileMarkdown(answers: WizardAnswers): string {
  const perms = { ...DEFAULT_PERMISSIONS, ...answers.permissions };
  const budget = { ...DEFAULT_BUDGET, ...answers.budget };
  const output = { ...DEFAULT_OUTPUT_PREFERENCES, ...answers.outputPreferences };

  const lines: string[] = [
    "# USER.md — Operator Profile",
    "",
    "## Identity",
    `- **Name**: ${answers.displayName}`,
  ];

  if (answers.role) lines.push(`- **Role**: ${answers.role}`);
  if (answers.domains?.length) lines.push(`- **Primary Domains**: ${answers.domains.join(", ")}`);
  if (answers.writingStyle) lines.push(`- **Writing Style**: ${answers.writingStyle}`);

  lines.push(
    "",
    "## Personal Context Notebook",
    "",
    "### Background",
    "",
    "### Current priorities",
    "",
    "### Projects I am building",
    "",
    "### Companies, people, and markets I care about",
    "",
    "### Communication style",
    answers.writingStyle
      ? `- ${answers.writingStyle}`
      : "- Concise, evidence-led, and explicit about uncertainty.",
    "",
    "### Evidence preferences",
    "- Prefer source-backed claims and mark weak evidence as needs_review.",
    "",
    "### CRM / export preferences",
    "",
    "### Privacy boundaries",
    "- Ask before changing privacy, connector, budget, sharing, or external-write defaults.",
    "",
    "### Things NodeBench should not assume",
    "",
    "## Style Profile",
    answers.writingStyle
      ? `- ${answers.writingStyle}`
      : "- Founder / banker lens with concise recommendation-first memos.",
    "- Short answer",
    "- Why it matters",
    "- Evidence",
    "- Risks / unknowns",
    "- Next action",
    "",
    "## Golden Set",
    "- Upload 3-10 accepted memos, reports, prompts, or manager feedback artifacts to calibrate private style.",
    "",
    "## Rubric Library",
    "- Banker coverage screen",
    "- VC investor memo",
  );

  lines.push("", "## Goals");
  answers.goals.forEach((goal, i) => {
    lines.push(`${i + 1}. ${goal}`);
  });

  lines.push(
    "",
    "## Autonomy Settings",
    `- **Mode**: ${AUTONOMY_LABELS[answers.autonomyMode] || answers.autonomyMode}`,
  );
  if (answers.scheduleInterval) lines.push(`- **Schedule**: ${answers.scheduleInterval}`);
  if (answers.scheduleTimeUtc) lines.push(`- **Time**: ${answers.scheduleTimeUtc}`);

  lines.push(
    "",
    "## Permissions",
    `- **READ_WEB**: ${perms.readWeb}`,
    `- **READ_DOCS**: ${perms.readDocs}`,
    `- **READ_EMAIL**: ${perms.readEmail}`,
    `- **READ_CALENDAR**: ${perms.readCalendar}`,
    `- **WRITE_FORUM_POSTS**: ${perms.writeForumPosts}`,
    `- **WRITE_EMAIL_DRAFTS**: ${perms.writeEmailDrafts}`,
    `- **SEND_EMAIL**: ${perms.sendEmail}`,
    `- **SUBMIT_FORMS**: ${perms.submitForms}`,
    `- **UPLOAD_DOCUMENTS**: ${perms.uploadDocuments}`,
  );

  lines.push(
    "",
    "## Budget",
    `- **Max Tokens Per Run**: ${budget.maxTokensPerRun}`,
    `- **Max Tool Calls Per Run**: ${budget.maxToolCallsPerRun}`,
    `- **Max External Writes Per Run**: ${budget.maxExternalWritesPerRun}`,
    `- **Preferred Model Tier**: ${budget.preferredModelTier}`,
  );

  lines.push(
    "",
    "## Output Preferences",
    `- **Brief Format**: ${output.briefFormat}`,
    `- **Include Cost Estimate**: ${output.includeCostEstimate}`,
    `- **Citation Style**: ${output.citationStyle}`,
  );

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate markdown from a full structured config (for re-serialization)
 */
export function configToMarkdown(config: OperatorProfileConfig): string {
  return generateProfileMarkdown({
    displayName: config.identity.displayName,
    role: config.identity.role,
    domains: config.identity.domains,
    writingStyle: config.identity.writingStyle,
    goals: config.goals.sort((a, b) => a.rank - b.rank).map((g) => g.description),
    autonomyMode: config.autonomyMode as WizardAnswers["autonomyMode"],
    scheduleInterval: config.scheduleInterval as WizardAnswers["scheduleInterval"],
    scheduleTimeUtc: config.scheduleTimeUtc,
    permissions: config.permissions,
    budget: config.budget,
    outputPreferences: config.outputPreferences,
  });
}
