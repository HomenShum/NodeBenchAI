"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";

export type EmailIntelligenceEntities = {
  companies: string[];
  people: string[];
  investors: string[];
  keywords: string[];
};

export type EmailIntelligence = {
  emailId?: string;
  from?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  intent: "partnership_inquiry" | "demo_request" | "investment_pitch" | "meeting_request" | "general";
  urgency: "high" | "medium" | "low";
  entities: EmailIntelligenceEntities;
  notes?: string[];
  snippets?: string[];
};

const INVESTOR_KEYWORDS = ["sequoia", "a16z", "andreessen", "intel capital", "softbank", "accel", "general catalyst"];
const PARTNERSHIP_TERMS = ["partnership", "partner", "collaboration", "co-build", "integrate", "integration", "demo"];
const INVESTMENT_TERMS = ["investment", "raise", "series", "funding", "term sheet", "lead investor"];
const URGENCY_TERMS = ["urgent", "asap", "this week", "today", "calendar", "invite", "soon"];
const TECH_TERMS = ["api", "integration", "pilot", "verification", "eda", "semiconductor", "chip", "architecture"];

type BasicEmail = {
  id?: string;
  from?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  date?: string;
};

export const parseEmailForIntelligence = createTool({
  description: `Parse Gmail messages to extract companies, people, investors, and intent for research orchestration.

Supports two modes:
1) Pass a specific email payload to parse it directly
2) Pull recent messages from Gmail (maxEmails) and return parsed intelligence

Outputs structured entities, intent classification, and urgency scoring.`,
  args: z.object({
    maxEmails: z.number().default(20),
    unreadOnly: z.boolean().default(true),
    filterSenders: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    email: z
      .object({
        id: z.string().optional(),
        from: z.string().optional(),
        subject: z.string().optional(),
        snippet: z.string().optional(),
        body: z.string().optional(),
        date: z.string().optional(),
      })
      .optional(),
  }),
  handler: async (ctx, args): Promise<{ success: boolean; emails?: EmailIntelligence[]; error?: string }> => {
    const targets =
      args.email !== undefined
        ? [args.email]
        : await fetchRecentInbox(ctx, args.maxEmails, args.filterSenders);

    if (!targets || targets.length === 0) {
      return { success: true, emails: [] };
    }

    const parsed = targets
      .map((email: BasicEmail) => analyzeEmailIntelligence(email, args.keywords))
      .filter(
        (email: EmailIntelligence) =>
          email.entities.companies.length > 0 || email.entities.people.length > 0,
      );

    return { success: true, emails: parsed };
  },
});

/**
 * Analyze a single email payload for entities, intent, and urgency.
 * Exposed for reuse by workflows that already have an email body loaded.
 */
export function analyzeEmailIntelligence(
  email: BasicEmail,
  extraKeywords?: string[],
): EmailIntelligence {
  const text = buildText(email);
  const entities = extractEntities(email.from, text, extraKeywords);
  const intent = classifyIntent(text);
  const urgency = detectUrgency(text);

  return {
    emailId: email.id,
    from: email.from,
    subject: email.subject,
    snippet: email.snippet,
    body: email.body,
    intent,
    urgency,
    entities,
    snippets: email.snippet ? [email.snippet] : [],
  };
}

async function fetchRecentInbox(ctx: any, maxEmails: number, filterSenders?: string[]) {
  const inbox = await ctx.runAction(api.domains.integrations.gmail.fetchInbox, {
    maxResults: maxEmails,
  });

  if (!inbox.success || !inbox.messages) return [];

  const candidates = inbox.messages;
  if (!filterSenders || filterSenders.length === 0) return candidates;

  const matchers = filterSenders.map((f) => f.toLowerCase());
  return candidates.filter((m: any) => {
    if (!m.from) return false;
    const from = m.from.toLowerCase();
    return matchers.some((m) => from.includes(m.replace("*", "")));
  });
}

function buildText(email: { subject?: string; snippet?: string; body?: string }): string {
  const parts = [email.subject ?? "", email.snippet ?? "", email.body ?? ""].filter(Boolean);
  return parts.join(" ").trim();
}

function extractEntities(from: string | undefined, text: string, extraKeywords?: string[]): EmailIntelligenceEntities {
  const companies = new Set<string>();
  const people = new Set<string>();
  const investors = new Set<string>();
  const keywords = new Set<string>();

  if (from) {
    const domainCompany = companyFromEmail(from);
    if (domainCompany) {
      companies.add(domainCompany);
    }
    const name = nameFromEmail(from);
    if (name) people.add(name);
  }

  // Company mentions from capitalized tokens
  const companyMatches = text.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)\b/g);
  if (companyMatches) {
    companyMatches.forEach((c) => {
      if (c.length >= 3 && c.length <= 40) {
        companies.add(c.trim());
      }
    });
  }

  // Investors
  INVESTOR_KEYWORDS.forEach((inv) => {
    if (text.toLowerCase().includes(inv)) investors.add(toTitle(inv));
  });

  // Keywords: funding amounts, olympiad mentions, etc.
  const fundingMatches = text.match(/\$\s?\d+(\.\d+)?\s?[MB]|\bseries\s+[abc]/gi);
  if (fundingMatches) {
    fundingMatches.forEach((k) => keywords.add(k));
  }

  const olympiadMatches = text.match(/\b(IOI|IPhO|IMO)\b/gi);
  if (olympiadMatches) olympiadMatches.forEach((k) => keywords.add(k));

  extraKeywords?.forEach((k) => {
    if (text.toLowerCase().includes(k.toLowerCase())) keywords.add(k);
  });

  return {
    companies: Array.from(companies).slice(0, 8),
    people: Array.from(people).slice(0, 8),
    investors: Array.from(investors).slice(0, 8),
    keywords: Array.from(keywords).slice(0, 12),
  };
}

function classifyIntent(text: string): EmailIntelligence["intent"] {
  const lower = text.toLowerCase();
  if (PARTNERSHIP_TERMS.some((t) => lower.includes(t))) return "partnership_inquiry";
  if (lower.includes("demo")) return "demo_request";
  if (INVESTMENT_TERMS.some((t) => lower.includes(t))) return "investment_pitch";
  if (lower.includes("meet") || lower.includes("calendar")) return "meeting_request";
  return "general";
}

function detectUrgency(text: string): EmailIntelligence["urgency"] {
  const lower = text.toLowerCase();
  if (URGENCY_TERMS.some((t) => lower.includes(t))) return "high";
  if (lower.includes("next week") || lower.includes("soon")) return "medium";
  return "low";
}

function companyFromEmail(from: string): string | null {
  const match = from.match(/@([A-Za-z0-9.-]+)/);
  if (!match) return null;
  const domain = match[1];
  const parts = domain.split(".");
  if (parts.length === 0) return null;
  const root = parts[0];
  if (!root) return null;
  return toTitle(root.replace(/-/g, " "));
}

function nameFromEmail(from: string): string | null {
  const match = from.match(/"?([^"<]+)"?\s*<[^>]+>/);
  if (match && match[1]) return match[1].trim();
  const handle = from.split("@")[0];
  if (!handle) return null;
  const cleaned = handle.replace(/[._]/g, " ");
  if (cleaned.length < 3) return null;
  return cleaned
    .split(" ")
    .map((p) => toTitle(p))
    .join(" ")
    .trim();
}

function toTitle(input: string): string {
  return input
    .split(" ")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ")
    .trim();
}

/**
 * Action wrapper for parseEmailForIntelligence tool.
 * Allows the cron and other internal actions to call this directly.
 */
export const parseEmailForIntelligenceAction = action({
  args: {
    maxEmails: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
    filterSenders: v.optional(v.array(v.string())),
    keywords: v.optional(v.array(v.string())),
    email: v.optional(v.object({
      id: v.optional(v.string()),
      from: v.optional(v.string()),
      subject: v.optional(v.string()),
      snippet: v.optional(v.string()),
      body: v.optional(v.string()),
      date: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<{ success: boolean; emails?: EmailIntelligence[]; error?: string }> => {
    const maxEmails = args.maxEmails ?? 20;
    const targets =
      args.email !== undefined
        ? [args.email]
        : await fetchRecentInboxAction(ctx, maxEmails, args.filterSenders);

    if (!targets || targets.length === 0) {
      return { success: true, emails: [] };
    }

    const parsed = targets
      .map((email: BasicEmail) => analyzeEmailIntelligence(email, args.keywords))
      .filter(
        (email: EmailIntelligence) =>
          email.entities.companies.length > 0 || email.entities.people.length > 0,
      );

    return { success: true, emails: parsed };
  },
});

async function fetchRecentInboxAction(ctx: any, maxEmails: number, filterSenders?: string[]) {
  const inbox = await ctx.runAction(api.domains.integrations.gmail.fetchInbox, {
    maxResults: maxEmails,
  });

  if (!inbox.success || !inbox.messages) return [];

  const candidates = inbox.messages;
  if (!filterSenders || filterSenders.length === 0) return candidates;

  const matchers = filterSenders.map((f) => f.toLowerCase());
  return candidates.filter((m: any) => {
    if (!m.from) return false;
    const from = m.from.toLowerCase();
    return matchers.some((matcher) => from.includes(matcher.replace("*", "")));
  });
}
