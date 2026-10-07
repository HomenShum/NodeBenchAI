/**
 * Operator Profile Markdown Parser
 *
 * Parses USER.md-style markdown into structured config.
 * Regex-based heading extraction with fallback defaults. No LLM calls.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface OperatorIdentity {
  displayName: string;
  role?: string;
  domains?: string[];
  writingStyle?: string;
}

export interface OperatorGoal {
  rank: number;
  description: string;
}

export interface OperatorPermissions {
  readWeb: boolean;
  readDocs: boolean;
  readEmail: boolean;
  readCalendar: boolean;
  writeForumPosts: boolean;
  writeEmailDrafts: boolean;
  sendEmail: boolean;
  submitForms: boolean;
  uploadDocuments: boolean;
}

export interface OperatorBudget {
  maxTokensPerRun: number;
  maxToolCallsPerRun: number;
  maxExternalWritesPerRun: number;
  preferredModelTier: string;
}

export interface OperatorOutputPreferences {
  briefFormat: string;
  includeCostEstimate: boolean;
  citationStyle: string;
}

export interface OperatorProfileConfig {
  identity: OperatorIdentity;
  goals: OperatorGoal[];
  autonomyMode: string;
  scheduleInterval?: string;
  scheduleTimeUtc?: string;
  permissions: OperatorPermissions;
  budget: OperatorBudget;
  outputPreferences: OperatorOutputPreferences;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_PERMISSIONS: OperatorPermissions = {
  readWeb: true,
  readDocs: true,
  readEmail: false,
  readCalendar: false,
  writeForumPosts: false,
  writeEmailDrafts: false,
  sendEmail: false,
  submitForms: false,
  uploadDocuments: false,
};

export const DEFAULT_BUDGET: OperatorBudget = {
  maxTokensPerRun: 50000,
  maxToolCallsPerRun: 20,
  maxExternalWritesPerRun: 5,
  preferredModelTier: "free",
};

export const DEFAULT_OUTPUT_PREFERENCES: OperatorOutputPreferences = {
  briefFormat: "tldr_bullets",
  includeCostEstimate: true,
  citationStyle: "inline",
};

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * Extract a named section's content from markdown (everything between ## Heading and next ##)
 */
function extractSection(md: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|$(?!\\n))`, "mi");
  const match = md.match(regex);
  return match ? match[1].trim() : "";
}

/**
 * Parse "Key: Value" lines from a section
 */
function parseKeyValues(section: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of section.split("\n")) {
    const match = line.match(/^-?\s*\*?\*?(\w[\w\s]*?)\*?\*?\s*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
      result[key] = match[2].trim();
    }
  }
  return result;
}

/**
 * Parse a numbered or bulleted list into ordered items
 */
function parseList(section: string): string[] {
  const items: string[] = [];
  for (const line of section.split("\n")) {
    const match = line.match(/^\s*(?:\d+[.)]\s*|-\s*)\s*(.+)/);
    if (match) {
      items.push(match[1].trim());
    }
  }
  return items;
}

/**
 * Parse boolean from string ("true", "yes", "on", "enabled" → true)
 */
function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const lower = value.toLowerCase().trim();
  if (["true", "yes", "on", "enabled"].includes(lower)) return true;
  if (["false", "no", "off", "disabled"].includes(lower)) return false;
  return fallback;
}

/**
 * Parse operator profile markdown into structured config
 */
export function parseOperatorMarkdown(md: string): OperatorProfileConfig {
  // Identity
  const identitySection = extractSection(md, "Identity");
  const identityKV = parseKeyValues(identitySection);
  const identity: OperatorIdentity = {
    displayName: identityKV["name"] || identityKV["display_name"] || identityKV["handle"] || "User",
    role: identityKV["role"] || identityKV["roles"],
    domains: identityKV["primary_domains"]?.split(",").map((d) => d.trim()) ||
      identityKV["domains"]?.split(",").map((d) => d.trim()),
    writingStyle: identityKV["writing_style"],
  };

  // Goals
  const goalsSection = extractSection(md, "Goals");
  const goalsList = parseList(goalsSection);
  const goals: OperatorGoal[] = goalsList.map((desc, i) => ({
    rank: i + 1,
    description: desc,
  }));

  // Autonomy Settings
  const autonomySection = extractSection(md, "Autonomy Settings");
  const autonomyKV = parseKeyValues(autonomySection);
  const autonomyMode = autonomyKV["mode"]?.toLowerCase().replace(/\s+/g, "_") || "assist";
  const scheduleInterval = autonomyKV["schedule"] || undefined;
  const scheduleTimeUtc = autonomyKV["time"] || autonomyKV["time_utc"] || undefined;

  // Permissions
  const permSection = extractSection(md, "Permissions");
  const permKV = parseKeyValues(permSection);
  const permissions: OperatorPermissions = {
    readWeb: parseBool(permKV["read_web"], DEFAULT_PERMISSIONS.readWeb),
    readDocs: parseBool(permKV["read_docs"], DEFAULT_PERMISSIONS.readDocs),
    readEmail: parseBool(permKV["read_email"], DEFAULT_PERMISSIONS.readEmail),
    readCalendar: parseBool(permKV["read_calendar"], DEFAULT_PERMISSIONS.readCalendar),
    writeForumPosts: parseBool(permKV["write_forum_posts"], DEFAULT_PERMISSIONS.writeForumPosts),
    writeEmailDrafts: parseBool(permKV["write_email_drafts"], DEFAULT_PERMISSIONS.writeEmailDrafts),
    sendEmail: parseBool(permKV["send_email"], DEFAULT_PERMISSIONS.sendEmail),
    submitForms: parseBool(permKV["submit_forms"], DEFAULT_PERMISSIONS.submitForms),
    uploadDocuments: parseBool(permKV["upload_documents"], DEFAULT_PERMISSIONS.uploadDocuments),
  };

  // Budget
  const budgetSection = extractSection(md, "Budget");
  const budgetKV = parseKeyValues(budgetSection);
  const budget: OperatorBudget = {
    maxTokensPerRun: parseInt(budgetKV["max_tokens_per_run"] || "", 10) || DEFAULT_BUDGET.maxTokensPerRun,
    maxToolCallsPerRun: parseInt(budgetKV["max_tool_calls_per_run"] || "", 10) || DEFAULT_BUDGET.maxToolCallsPerRun,
    maxExternalWritesPerRun: parseInt(budgetKV["max_external_writes_per_run"] || "", 10) || DEFAULT_BUDGET.maxExternalWritesPerRun,
    preferredModelTier: budgetKV["preferred_model_tier"] || DEFAULT_BUDGET.preferredModelTier,
  };

  // Output Preferences
  const outputSection = extractSection(md, "Output Preferences");
  const outputKV = parseKeyValues(outputSection);
  const outputPreferences: OperatorOutputPreferences = {
    briefFormat: outputKV["brief_format"] || outputKV["default_brief_format"] || DEFAULT_OUTPUT_PREFERENCES.briefFormat,
    includeCostEstimate: parseBool(outputKV["include_cost_estimate"], DEFAULT_OUTPUT_PREFERENCES.includeCostEstimate),
    citationStyle: outputKV["citation_style"] || DEFAULT_OUTPUT_PREFERENCES.citationStyle,
  };

  return {
    identity,
    goals: goals.length > 0 ? goals : [{ rank: 1, description: "Stay informed on my domains" }],
    autonomyMode,
    scheduleInterval,
    scheduleTimeUtc,
    permissions,
    budget,
    outputPreferences,
  };
}
