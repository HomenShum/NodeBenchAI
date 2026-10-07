/**
 * Slack Block Kit Message Builders
 *
 * Utilities for building rich Slack messages using Block Kit.
 *
 * @see https://api.slack.com/block-kit
 * @module integrations/slack/slackBlocks
 */

import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Participant {
  name: string;
  role?: string;
  company?: string;
  linkedEntityId?: Id<"entityContexts">;
}

export interface Company {
  name: string;
  linkedEntityId?: Id<"entityContexts">;
}

export interface EncounterConfirmationData {
  id: Id<"userEvents">;
  context: string;
  participants: Participant[];
  companies: Company[];
  researchStatus: "none" | "fast_pass" | "deep_dive" | "complete";
}

export interface DigestData {
  encounters: Array<{
    _id: Id<"userEvents">;
    title: string;
    encounter?: {
      participants: Participant[];
      companies: Company[];
      context?: string;
      followUpRequested?: boolean;
    };
  }>;
  date: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENCOUNTER CONFIRMATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build encounter confirmation Block Kit message.
 */
export function buildEncounterConfirmation(data: EncounterConfirmationData): any[] {
  const participantList = data.participants.map((p) => {
    const linked = p.linkedEntityId ? ":link:" : "";
    const company = p.company ? ` (${p.company})` : "";
    const role = p.role ? ` - ${p.role}` : "";
    return `${linked} ${p.name}${company}${role}`;
  }).join("\n") || "_No participants detected_";

  const companyList = data.companies.map((c) => {
    const linked = c.linkedEntityId ? ":link:" : "";
    return `${linked} ${c.name}`;
  }).join(", ") || "_None detected_";

  const researchStatusEmoji = {
    none: ":hourglass:",
    fast_pass: ":zap:",
    deep_dive: ":mag:",
    complete: ":white_check_mark:",
  };

  const researchStatusText = {
    none: "Pending",
    fast_pass: "Quick lookup complete",
    deep_dive: "Deep research in progress",
    complete: "Research complete",
  };

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: *Encounter logged*\n_${data.context}_`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Participants:*\n${participantList}`,
        },
        {
          type: "mrkdwn",
          text: `*Companies:*\n${companyList}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${researchStatusEmoji[data.researchStatus]} *Research:* ${researchStatusText[data.researchStatus]}`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ":mag: Deep Dive", emoji: true },
          action_id: "deep_dive",
          value: data.participants[0]?.name || data.companies[0]?.name || "",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":calendar: Add Follow-up", emoji: true },
          action_id: "add_followup",
          value: data.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":pencil2: Edit", emoji: true },
          action_id: "edit_encounter",
          value: data.id,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Powered by NodeBench AI_ | <https://nodebench-ai.vercel.app/encounters|View in app>`,
        },
      ],
    },
  ];

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY DIGEST
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build daily digest Block Kit message.
 */
export function buildDigestBlocks(data: DigestData): any[] {
  const encounterCount = data.encounters.length;
  const followUpCount = data.encounters.filter((e) => e.encounter?.followUpRequested).length;
  const uniqueCompanies = new Set<string>();
  const uniqueParticipants = new Set<string>();

  data.encounters.forEach((e) => {
    e.encounter?.participants.forEach((p) => uniqueParticipants.add(p.name));
    e.encounter?.companies.forEach((c) => uniqueCompanies.add(c.name));
  });

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `:sunrise: Your Daily Digest - ${data.date}`, emoji: true },
    },
  ];

  if (encounterCount === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No encounters logged today._\n\nUse `/encounter` to log your meetings and networking conversations.",
      },
    });
  } else {
    // Summary stats
    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*:handshake: Encounters:* ${encounterCount}`,
        },
        {
          type: "mrkdwn",
          text: `*:busts_in_silhouette: People Met:* ${uniqueParticipants.size}`,
        },
        {
          type: "mrkdwn",
          text: `*:office: Companies:* ${uniqueCompanies.size}`,
        },
        {
          type: "mrkdwn",
          text: `*:bell: Follow-ups Due:* ${followUpCount}`,
        },
      ],
    });

    blocks.push({ type: "divider" });

    // List encounters (max 5)
    const displayEncounters = data.encounters.slice(0, 5);

    displayEncounters.forEach((enc, idx) => {
      const participants = enc.encounter?.participants.map((p) => p.name).join(", ") || "Unknown";
      const context = enc.encounter?.context || enc.title;
      const followUp = enc.encounter?.followUpRequested ? " :bell:" : "";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${idx + 1}. ${context}*${followUp}\n${participants}`,
        },
      });
    });

    if (data.encounters.length > 5) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_+ ${data.encounters.length - 5} more encounters_`,
          },
        ],
      });
    }
  }

  // Action buttons
  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ":clipboard: View All Encounters", emoji: true },
          url: "https://nodebench-ai.vercel.app/encounters",
          action_id: "view_encounters",
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":calendar: View Tasks", emoji: true },
          url: "https://nodebench-ai.vercel.app/tasks",
          action_id: "view_tasks",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Powered by NodeBench AI_",
        },
      ],
    }
  );

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELP MESSAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build help message Block Kit.
 */
export function buildHelpBlocks(): any[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: ":robot_face: NodeBench AI Bot", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Your intelligent assistant for capturing professional encounters and running research.",
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*:memo: Commands*\n\n" +
          "`/encounter <details>` - Log a meeting or encounter\n" +
          "> _Example: /encounter Met with Jane Smith from Acme Corp - discussing partnership_\n\n" +
          "`/research <entity>` - Research a person or company\n" +
          "> _Example: /research Anthropic_\n\n" +
          "`/digest` - Get today's encounter summary\n\n" +
          "`/help` - Show this message",
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*:bulb: Quick Tips*\n\n" +
          "• DM me your meeting notes and I'll auto-capture encounters\n" +
          "• Click *Deep Dive* to trigger comprehensive research\n" +
          "• Use follow-up buttons to create tasks\n" +
          "• Connect your Slack in NodeBench Settings > Integrations",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Need help? Visit <https://nodebench-ai.vercel.app/help|nodebench-ai.vercel.app/help>_",
        },
      ],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR MESSAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build error message Block Kit.
 */
export function buildErrorBlocks(message: string): any[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:x: *Error*\n${message}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_If this persists, try `/help` or contact support._",
        },
      ],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCH STATUS UPDATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build research status update Block Kit.
 */
export function buildResearchStatusBlocks(data: {
  entityName: string;
  status: "started" | "in_progress" | "complete" | "error";
  summary?: string;
  sources?: number;
  error?: string;
}): any[] {
  const statusEmoji = {
    started: ":hourglass_flowing_sand:",
    in_progress: ":mag:",
    complete: ":white_check_mark:",
    error: ":x:",
  };

  const statusText = {
    started: "Research started",
    in_progress: "Research in progress",
    complete: "Research complete",
    error: "Research failed",
  };

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji[data.status]} *${statusText[data.status]}:* ${data.entityName}`,
      },
    },
  ];

  if (data.summary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: data.summary,
      },
    });
  }

  if (data.sources) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Based on ${data.sources} sources_`,
        },
      ],
    });
  }

  if (data.error) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: ${data.error}`,
      },
    });
  }

  return blocks;
}
