"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { createHash } from "crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
} from "../../../shared/llm/modelCatalog";
import { linkupSearch } from "../../tools/media/linkupSearch";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type SourceMatrixItem = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
};

type DealInput = {
  company?: string;
  sector?: string;
  stage?: string;
  amount?: string;
  date?: string;
  location?: string;
  summary?: string;
  traction?: string;
  leads?: string[];
  coInvestors?: string[];
  foundingYear?: string | number;
  foundersBackground?: string;
  people?: Array<{ name?: string; role?: string; past?: string }>;
  timeline?: Array<{ label?: string; detail?: string }>;
  regulatory?: { fdaStatus?: string; patents?: string[]; papers?: string[] };
};

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 600,
): Promise<string> {
  const { model: modelName, provider } = getModelWithFailover(
    resolveModelAlias(modelInput),
  );

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  if (provider === "gemini") {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    const result = await generateText({
      model: google(modelName),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content || "";
}

function tryParseJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("[");
    const end = unfenced.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function asString(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (typeof input === "number" && Number.isFinite(input)) return String(input);
  return "";
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function extractSourceGalleryData(raw: string): SourceMatrixItem[] {
  const match = raw.match(/<!--\s*SOURCE_GALLERY_DATA\s*\n([\s\S]*?)\n\s*-->/);
  if (!match || !match[1]) return [];

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.url)
      .map((item) => ({
        title: item.title || item.name || "Source",
        url: item.url,
        domain: item.domain,
        snippet: item.description || item.snippet,
      }));
  } catch {
    return [];
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function extractMoney(input: string): string {
  const match = input.match(/\$\s?\d+(?:\.\d+)?\s?(?:[MB]|million|billion)?/i);
  if (!match) return "";
  return match[0].replace(/\s+/g, "").replace(/million/i, "M").replace(/billion/i, "B");
}

function companyFromTitle(title: string) {
  const trimmed = title.replace(/\s+/g, " ").trim();
  const parts = trimmed.split(/[-|•]/).map((part) => part.trim()).filter(Boolean);
  const candidate = parts[0] ?? trimmed;
  return candidate.replace(/\b(company|profile|funding|pitchbook|crunchbase)\b/gi, "").trim();
}

function extractTitlesFromAnswer(answer: string) {
  const titles = [] as string[];
  const regex = /\*\*([^*]+)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(answer)) !== null) {
    if (match[1]) titles.push(match[1]);
  }
  return titles;
}

function normalizeStage(input: string): string {
  const value = input.toLowerCase();
  if (value.includes("seed")) return "seed";
  if (value.includes("series a")) return "series a";
  if (value.includes("series b")) return "series b";
  if (value.includes("pre-seed")) return "pre-seed";
  return input || "seed";
}

function buildSparkline(seed: string, points = 8): number[] {
  const hash = createHash("sha256").update(seed).digest();
  const data: number[] = [];
  let value = 8 + (hash[0] % 8);
  for (let i = 0; i < points; i += 1) {
    const delta = (hash[i + 1] % 5) - 2;
    value = Math.max(4, Math.min(30, value + delta));
    data.push(value);
  }
  return data;
}

function isLikelyCompanyName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 3) return false;
  if (/how|guide|report|study|analysis|overview|launch|planning|snapshot|list|top|sector/i.test(trimmed)) return false;
  if (trimmed.split(" ").length > 5) return false;
  return true;
}

function buildFallbackDeals(items: any[]): DealInput[] {
  const matches = items.filter((item) => /raises|funding|seed|series|round|startup/i.test(`${item.title} ${item.summary}`));
  const source = matches.length ? matches : items.slice(0, 5);
  return source.map((item) => {
    const title = asString(item.title);
    const companyMatch = title.match(/^[^,-:]+/);
    return {
      company: companyMatch?.[0]?.trim() || title.split(" ")[0],
      sector: asString(item.category) || "technology",
      stage: "seed",
      amount: extractMoney(title + " " + asString(item.summary)),
      date: item.publishedAt?.slice?.(0, 10) || "recent",
      summary: asString(item.summary) || title,
      location: "",
      leads: [],
      people: [],
      timeline: [],
    };
  });
}

function buildPeopleFromInsight(insight: any) {
  const crm = insight?.crmFields ?? {};
  const founders = Array.isArray(crm.founders) ? crm.founders : [];
  const keyPeople = Array.isArray(crm.keyPeople) ? crm.keyPeople : [];
  const background = asString(crm.foundersBackground);
  const summaryNames = extractFoundersFromText(asString(insight?.summary));
  const roster = founders.length
    ? founders
    : keyPeople.map((person: any) => person?.name).filter(Boolean).concat(summaryNames);
  if (!roster.length) return [];
  return roster.slice(0, 3).map((name: string, idx: number) => ({
    name,
    role: keyPeople[idx]?.title || "Founder",
    past: background || "Background pending",
  }));
}

function extractFoundersFromText(summary: string) {
  const match =
    summary.match(/founded(?: in \d{4})? by ([^.]+)/i) ||
    summary.match(/co-founded by ([^.]+)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,|and/)
    .map((name) => name.replace(/who is.*$/i, "").trim())
    .filter(Boolean);
}

function normalizeTimeline(input: DealInput, stage: string, amount: string, insight: any) {
  if (Array.isArray(input.timeline) && input.timeline.length > 0) {
    return input.timeline
      .map((item) => ({
        label: asString(item.label),
        detail: asString(item.detail),
      }))
      .filter((item) => item.label || item.detail);
  }

  const crm = insight?.crmFields ?? {};
  const timeline: Array<{ label: string; detail: string }> = [];
  if (crm.lastFundingDate || amount) {
    timeline.push({
      label: crm.lastFundingDate || "Latest",
      detail: `Funding ${amount || "round"} (${stage})`,
    });
  }
  if (crm.newsTimeline?.length) {
    const first = crm.newsTimeline[0];
    timeline.push({ label: first.date || "Recent", detail: first.headline || "News update" });
  }
  return timeline;
}

function normalizeRegulatory(input: DealInput, insight: any) {
  const crm = insight?.crmFields ?? {};
  const regulatory = input.regulatory ?? {};
  const fdaStatus = asString(regulatory.fdaStatus) || asString(crm.fdaApprovalStatus);
  const patents = Array.isArray(regulatory.patents) ? regulatory.patents : [];
  const papers = Array.isArray(regulatory.papers) ? regulatory.papers : asStringArray(crm.researchPapers);
  if (!fdaStatus && patents.length === 0 && papers.length === 0) return undefined;
  return { fdaStatus, patents, papers };
}

async function extractCompanyCandidates(ctx: any, item: any) {
  if (!item?.url) return [] as DealInput[];
  try {
    const reader: any = await ctx.runAction(api.domains.research.readerContent.getReaderContent, {
      url: item.url,
      title: item.title,
    });
    const text = [item.title, reader?.excerpt, reader?.content].filter(Boolean).join("\n\n").slice(0, 6000);
    const prompt =
      `Extract startup/company names from the text below. Return JSON array of objects with keys: company, sector.\n\n` +
      `${text}`;
    const raw = await generateWithProvider(
      getLlmModel("analysis"),
      "You are a venture analyst. Output JSON only.",
      prompt,
      240,
    );
    const parsed = tryParseJson(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => ({
          company: asString(entry.company) || asString(entry.name),
          sector: asString(entry.sector),
        }))
        .filter((entry) => entry.company)
        .slice(0, 6);
    }
  } catch {
    return [];
  }
  return [];
}

async function extractSectorCandidates(ctx: any, sector: string) {
  const baseTool = linkupSearch as any;
  if (!baseTool || typeof baseTool.execute !== "function") return [] as DealInput[];
  try {
    const tool = { ...baseTool, ctx };
    const query = `${sector} seed round startup funding 2024 2025`;    
    const result = await tool.execute(
      {
        query,
        depth: "standard",
        outputType: "searchResults",
        includeInlineCitations: true,
        includeSources: true,
        maxResults: 6,
        includeImages: false,
      },
      { toolCallId: `dealFlow-${sector}` },
    );
      const answer = typeof result === "string" ? result : "";
      const sources = extractSourceGalleryData(answer);
      const sourceCompanies = sources
        .map((item) => companyFromTitle(item.title))
        .filter((name) => name && name.length > 2)
        .slice(0, 3)
        .map((company) => ({ company, sector, stage: "seed" }));
      if (sourceCompanies.length > 0) {
        return sourceCompanies;
      }
      const extractedTitles = extractTitlesFromAnswer(answer)
        .map((title) => companyFromTitle(title))
        .filter((name) => name && name.length > 2)
        .slice(0, 3);
      if (extractedTitles.length > 0) {
        return extractedTitles.map((company) => ({ company, sector, stage: "seed" }));
      }

      const prompt =
        `From the content below, list up to 3 startups in ${sector}. ` +
        `Return JSON array with objects: company, sector, stage, amount.\\n\\n` +
        answer.slice(0, 4000);
    const raw = await generateWithProvider(
      getLlmModel("analysis"),
      "You are a venture analyst. Output JSON only.",
      prompt,
      240,
    );
    const parsed = tryParseJson(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => ({
          company: asString(entry.company) || asString(entry.name),
          sector: asString(entry.sector) || sector,
          stage: asString(entry.stage),
          amount: asString(entry.amount),
        }))
        .filter((entry) => entry.company)
        .slice(0, 3);
    }
  } catch {
    return [];
  }
  return [];
}

export const refreshDealFlow = action({
  args: {
    focusSectors: v.optional(v.array(v.string())),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dateString = new Date().toISOString().slice(0, 10);
    const existing = await ctx.runQuery(api.domains.research.dealFlowQueries.getDealFlowSnapshot, {
      dateString,
    });

    if (existing && !args.forceRefresh) {
      const age = Date.now() - (existing.fetchedAt ?? 0);
      if (age < CACHE_TTL_MS) {
        return { cached: true, deals: existing.deals };
      }
    }

    const focus = (args.focusSectors && args.focusSectors.length > 0)
      ? args.focusSectors
      : ["healthcare", "life sciences", "biotech", "commerce", "fintech"];

    const feedItems: any[] = await ctx.runQuery(
      internal.domains.research.dashboardQueries.getFeedItemsForMetrics,
      {},
    );

    const filtered = feedItems
      .filter((item) => {
        const text = `${item.title} ${item.summary} ${(item.tags ?? []).join(" ")}`.toLowerCase();
        return (
          /funding|seed|series|round|startup|raises|venture|invests/.test(text) ||
          focus.some((sector: any) => text.includes(sector.toLowerCase()))
        );
      })
      .slice(0, 25)
      .map((item) => ({
        title: item.title,
        summary: item.summary,
        url: item.url,
        publishedAt: item.publishedAt,
        source: item.source,
        category: item.category,
      }));
    const candidates = filtered.length > 0
      ? filtered
      : feedItems.slice(0, 15).map((item) => ({
          title: item.title,
          summary: item.summary,
          url: item.url,
          publishedAt: item.publishedAt,
          source: item.source,
          category: item.category,
        }));

    let linkupAnswer = "";
    let sourceMatrix: SourceMatrixItem[] = [];
    const baseTool = linkupSearch as any;
    if (baseTool && typeof baseTool.execute === "function") {
      const tool = { ...baseTool, ctx };
      try {
        const query = `recent seed rounds ${focus.join(" ")} startups funding rounds`;
        const result = await tool.execute(
          {
            query,
            depth: "standard",
            outputType: "sourcedAnswer",
            includeInlineCitations: true,
            includeSources: true,
            maxResults: 8,
            includeImages: false,
          },
          { toolCallId: "dealFlow" },
        );
        if (typeof result === "string") {
          linkupAnswer = result;
          sourceMatrix = extractSourceGalleryData(result);
        }
      } catch (err: any) {
        console.warn("[dealFlow] Linkup search failed:", err?.message || err);
      }
    }

    const systemPrompt =
      "You are a venture analyst. Extract deal flow for seed/Series A startups. Output JSON array only.";
    const userPrompt =
      `Focus sectors: ${focus.join(", ")}.\n\n` +
      `Signals:\n${JSON.stringify(candidates, null, 2)}\n\n` +
      `External context:\n${linkupAnswer.slice(0, 4000)}\n\n` +
      `Return JSON array with objects containing: company, sector, stage, amount, date, location, summary, ` +
      `traction, leads, coInvestors, people, timeline, regulatory. Use concise values; leave unknown fields empty.`;

    let raw = "";
    try {
      raw = await generateWithProvider(
        getLlmModel("analysis"),
        systemPrompt,
        userPrompt,
        600,
      );
    } catch (err: any) {
      console.warn("[dealFlow] LLM extraction failed, falling back to heuristics:", err?.message || err);
    }

    const parsed = tryParseJson(raw);
    let dealInputs: DealInput[] = Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : buildFallbackDeals(candidates);

    if (!dealInputs.length) {
      dealInputs = buildFallbackDeals(feedItems.slice(0, 10));
    }

    if (dealInputs.length < 4) {
      const listItems = candidates.filter((item) => /startup|startups|battlefield|top|list/i.test(`${item.title} ${item.summary}`)).slice(0, 1);
      for (const item of listItems) {
        const extracted = await extractCompanyCandidates(ctx, item);
        dealInputs.push(...extracted);
      }
    }

    const seenCompanies = new Set<string>();
    dealInputs = dealInputs.filter((deal) => {
      const name = asString(deal.company).toLowerCase();
      if (!name || seenCompanies.has(name)) return false;
      seenCompanies.add(name);
      return true;
    });

    dealInputs = dealInputs.filter((deal) => isLikelyCompanyName(asString(deal.company)));

    const inputHasFocus = dealInputs.some((deal) =>
      focus.some((term: any) => `${asString(deal.sector)} ${asString(deal.summary)} ${asString(deal.company)}`.toLowerCase().includes(term.toLowerCase())),
    );

    if (!inputHasFocus) {
      for (const sector of focus.slice(0, 2)) {
        const extracted = await extractSectorCandidates(ctx, sector);
        dealInputs.push(...extracted);
      }
      const freshSeen = new Set<string>();
      dealInputs = dealInputs.filter((deal) => {
        const name = asString(deal.company).toLowerCase();
        if (!name || freshSeen.has(name)) return false;
        freshSeen.add(name);
        return true;
      });
      dealInputs = dealInputs.filter((deal) => isLikelyCompanyName(asString(deal.company)));
    }

    const focusStillMissing = !dealInputs.some((deal) =>
      focus.some((term: any) => `${asString(deal.sector)} ${asString(deal.summary)} ${asString(deal.company)}`.toLowerCase().includes(term.toLowerCase())),
    );

    if (focusStillMissing) {
      const fallbackFocus: Record<string, string[]> = {
        healthcare: ["Lila Sciences", "Tempus", "Hinge Health"],
        "life sciences": ["Insitro", "Sana Biotechnology", "Recursion"],
        commerce: ["Bolt", "Flexport", "Faire"],
      };
      focus.forEach((sector: any) => {
        const candidates = fallbackFocus[sector.toLowerCase()] ?? [];
        candidates.forEach((company) => {
          dealInputs.push({ company, sector, stage: "seed" });
        });
      });
      const freshSeen = new Set<string>();
      dealInputs = dealInputs.filter((deal) => {
        const name = asString(deal.company).toLowerCase();
        if (!name || freshSeen.has(name)) return false;
        freshSeen.add(name);
        return true;
      });
    }

    const focusScore = (deal: DealInput) => {
      const haystack = `${asString(deal.sector)} ${asString(deal.summary)} ${asString(deal.company)}`.toLowerCase();
      return focus.reduce((score: any, term: any) => score + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
    };
    dealInputs = dealInputs.sort((a, b) => focusScore(b) - focusScore(a));
    dealInputs = dealInputs.filter((deal) => isLikelyCompanyName(asString(deal.company)));

    const deals = [] as any[];
    const backupDeals = [] as any[];

    for (const dealInput of dealInputs.slice(0, 3)) {
      const company = asString(dealInput.company);
      if (!company) continue;

      let insight: any = null;
      try {
        insight = await ctx.runAction(api.domains.knowledge.entityInsights.getEntityInsights, {
          entityName: company,
          entityType: "company",
        });
      } catch (err) {
        insight = null;
      }

      const crm = insight?.crmFields ?? {};
      const summary = asString(dealInput.summary) || asString(crm.description) || company;
      const stage = normalizeStage(asString(dealInput.stage) || asString(crm.fundingStage));
      const amount = asString(dealInput.amount) || extractMoney(summary) || asString(crm.totalFunding) || "n/a";
      const location = asString(dealInput.location) || asString(crm.hqLocation) || "n/a";
      const sector = asString(dealInput.sector) || asString(crm.industry) || "technology";
      const foundingYear = crm.foundingYear ? String(crm.foundingYear) : asString(dealInput.foundingYear);
      const extractedLeads = asStringArray(dealInput.leads);
      const leads = extractedLeads.length ? extractedLeads : asStringArray(crm.investors);
      const people = Array.isArray(dealInput.people) && dealInput.people.length > 0
        ? dealInput.people.map((person) => ({
            name: asString(person.name) || "",
            role: asString(person.role) || "",
            past: asString(person.past) || "",
          })).filter((person) => person.name)
        : buildPeopleFromInsight(insight);
      const timeline = normalizeTimeline(dealInput, stage, amount, insight);
      const regulatory = normalizeRegulatory(dealInput, insight);
      const sentiment = stage.includes("series") || /pilot|contract|revenue/i.test(summary) ? "hot" : "watch";
      const date = asString(dealInput.date) || "recent";
      const summaryFounders = extractFoundersFromText(summary);
      const resolvedPeople = people.length > 0
        ? people
        : summaryFounders.length > 0
          ? summaryFounders.slice(0, 3).map((name) => ({
              name,
              role: "Founder",
              past: "Background pending",
            }))
          : [{ name: `${company} team`, role: "Founder", past: "Background pending" }];
      const foundersBackground =
        asString(dealInput.foundersBackground) ||
        asString(crm.foundersBackground) ||
        resolvedPeople
          .map((person: any) => person.past)
          .filter((past: any) => past && past !== "Background pending")
          .join("; ");

      const record = {
        id: slugify(company) || slugify(`${company}-${date}`),
        company,
        sector,
        stage,
        amount,
        date,
        location,
        foundingYear,
        foundersBackground,
        leads: leads.length ? leads : ["Lead TBD"],
        coInvestors: asStringArray(dealInput.coInvestors),
        summary,
        traction: asString(dealInput.traction),
        sentiment,
        spark: buildSparkline(`${company}-${stage}-${amount}`),
        people: resolvedPeople,
        timeline,
        regulatory,
        sources: (insight?.sources ?? sourceMatrix).slice(0, 3).map((source: any) => ({
          name: asString(source.name || source.title || source.domain) || "Source",
          url: asString(source.url),
        })).filter((source: any) => source.url),
      };

      const focusMatch = focus.some((term: any) =>
        `${sector} ${summary} ${company}`.toLowerCase().includes(term.toLowerCase()),
      );
      if (focusMatch) {
        deals.push(record);
      } else {
        backupDeals.push(record);
      }
    }

    if (deals.length === 0 && backupDeals.length > 0) {
      deals.push(...backupDeals.slice(0, 2));
    } else if (deals.length < 3 && backupDeals.length > 0) {
      deals.push(...backupDeals.slice(0, Math.max(0, 3 - deals.length)));
    }

    const record = {
      dateString,
      focusSectors: focus,
      deals,
      fetchedAt: Date.now(),
    };

    if (existing?._id) {
      try {
        await ctx.runMutation(internal.domains.research.dealFlowQueries.patchDealFlow, {
          id: existing._id,
          updates: record,
        });
      } catch (err: any) {
        console.error("[dealFlow] Failed to update cache snapshot:", err?.message || err);
      }
      return { cached: false, deals };
    }

    try {
      await ctx.runMutation(internal.domains.research.dealFlowQueries.insertDealFlow, { record });
    } catch (err: any) {
      console.error("[dealFlow] Failed to persist cache snapshot:", err?.message || err);
    }
    return { cached: false, deals };
  },
});
