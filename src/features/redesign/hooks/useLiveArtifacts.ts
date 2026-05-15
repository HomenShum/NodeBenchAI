/**
 * useLiveArtifacts
 *
 * Bridges existing first-party production artifacts into the redesign surfaces:
 * LinkedIn archive rows, daily brief memories, and daily brief feature checks.
 * The hook only returns Convex-backed public artifacts. Empty states are explicit
 * so production cannot mask broken wiring with starter fixtures.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { PulseMetric, PulseCard, PublicResearchCard, ReportCardData, SignalClass } from "../fixtures";

interface ArchivePost {
  _id: string;
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  postUrl?: string;
  factCheckCount?: number;
  metadata?: unknown;
  postedAt: number;
}

interface ArchivePostsResult {
  posts: ArchivePost[];
  hasMore: boolean;
}

interface ArchiveStats {
  totalPosts: number;
  byType: Array<{ postType: string; count: number }>;
  recentDates: string[];
}

interface DailyBriefFeature {
  id: string;
  type: string;
  name: string;
  status: "pending" | "failing" | "passing";
  priority?: number;
  testCriteria: string;
  sourceRefs?: unknown;
  notes?: string;
  updatedAt: number;
}

interface DailyBriefMemory {
  _id: string;
  dateString: string;
  generatedAt: number;
  goal: string;
  features: DailyBriefFeature[];
  context?: unknown;
}

export interface LiveArtifactsResult {
  isLoading: boolean;
  isLive: boolean;
  sourceLabel: string;
  metrics: PulseMetric[];
  pulse: PulseCard[];
  publicResearch: PublicResearchCard[];
  reports: ReportCardData[];
  details: LiveArtifactDetail[];
  archiveCount: number;
  briefFeatureCount: number;
}

const EMPTY_LIVE_ARTIFACTS: LiveArtifactsResult = {
  isLoading: false,
  isLive: false,
  sourceLabel: "Live artifacts disabled",
  metrics: [],
  pulse: [],
  publicResearch: [],
  reports: [],
  details: [],
  archiveCount: 0,
  briefFeatureCount: 0,
};

export interface LiveArtifactSourceRow {
  id: string;
  type: string;
  title: string;
  refreshed: string;
  reused: number;
  excerpt: string;
  href?: string;
  status?: string;
  confidence?: number;
}

export interface LiveArtifactSection {
  title: string;
  body: string;
  items?: Array<{
    label: string;
    body: string;
    meta?: string;
    status?: "verified" | "review" | "watching";
  }>;
}

export interface LiveArtifactMapNode {
  id: string;
  title: string;
  subtitle: string;
  tone: "default" | "accent" | "blue" | "green" | "amber";
  kind?: "entity" | "report" | "artifact" | "source" | "portfolio";
  artifactType?: string;
}

export interface LiveArtifactMapEdge {
  from: string;
  to: string;
  type?: "has_report" | "has_artifact" | "covers" | "causes" | "correlates_with" | "evidence" | "coverage" | "funding" | "competition" | "integration" | "review";
  label?: string;
  basis?: string;
  strength?: number;
}

export interface LiveArtifactDetail {
  id: string;
  title: string;
  kind: string;
  status: ReportCardData["status"];
  summary: string;
  updatedAt: string;
  updatedAtMs: number;
  sourceCount: number;
  claimCount: number;
  followUps: number;
  tags: string[];
  sections: LiveArtifactSection[];
  sourceRows: LiveArtifactSourceRow[];
  nodes: LiveArtifactMapNode[];
  edges: LiveArtifactMapEdge[];
  notebookHtml: string;
  primaryAction: string;
}

type QueryRef = Parameters<typeof useQuery>[0];

const liveArtifactApi = api as unknown as {
  domains: {
    social: {
      linkedinArchiveQueries: {
        getArchivedPosts: QueryRef;
        getArchiveStats: QueryRef;
      };
    };
    research: {
      dailyBriefMemoryQueries: {
        getLatestMemory: QueryRef;
      };
    };
    redesign: {
      reportGraphNeighborhood: {
        getReportGraphNeighborhood: QueryRef;
      };
    };
  };
};

export interface ReportGraphNeighborhoodScope {
  isServerBounded: boolean;
  mode: string;
  reportLimit: number;
  scanLimit: number;
  scannedArchivePosts: number;
  totalCandidateReports: number;
  returnedReportCount: number;
  hiddenReportCount: number;
  hasMoreArchive: boolean;
}

interface ReportGraphNeighborhoodPacket {
  mode: string;
  sourceLabel: string;
  rootId?: string;
  latestMemory?: DailyBriefMemory | null;
  posts: ArchivePost[];
  reportLimit: number;
  scanLimit: number;
  scannedArchivePosts: number;
  totalCandidateReports: number;
  returnedReportCount: number;
  hiddenReportCount: number;
  hasMoreArchive: boolean;
}

export interface ReportGraphNeighborhoodResult extends LiveArtifactsResult {
  scope: ReportGraphNeighborhoodScope | null;
}

const POST_TYPE_LABELS: Record<string, string> = {
  daily_digest: "Daily brief",
  did_you_know: "Did You Know",
  funding_tracker: "Funding tracker",
  funding_brief: "Funding brief",
  fda: "FDA update",
  clinical: "Clinical signal",
  research: "Research",
  ma: "Deal memo",
};

function timeAgo(at: number): string {
  const delta = Math.max(0, Date.now() - at);
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstMeaningfulLine(markdown: string): string {
  const line = markdown
    .split(/\r?\n/)
    .map((l) => normalizeSpace(l.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "")))
    .find((l) => l && !/^={3,}$/.test(l));
  return line ?? "Published intelligence artifact";
}

function excerpt(markdown: string, max = 190): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((l) => normalizeSpace(l.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "")))
    .filter(Boolean);
  const text = normalizeSpace(lines.slice(1).join(" ") || lines[0] || "Source-backed artifact from the NodeBench archive.");
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

function postTypeLabel(type: string): string {
  return POST_TYPE_LABELS[type] ?? normalizeSpace(type.replace(/[_-]+/g, " ")).replace(/\b\w/g, (c) => c.toUpperCase());
}

function signalClassForPost(post: ArchivePost): SignalClass {
  const text = `${post.postType} ${post.content}`.toLowerCase();
  if (/funding|series|round|raised|\$/.test(text)) return "funding";
  if (/fda|approval|regulatory|sec|filing/.test(text)) return "regulatory";
  if (/hiring|role|job|headcount/.test(text)) return "hiring";
  if (/launch|ship|release|product/.test(text)) return "shipping";
  if (/deal|m&a|acquisition|merger/.test(text)) return "coverage";
  return "research";
}

function countSourceRefs(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") {
    let count = 0;
    for (const item of Object.values(value as Record<string, unknown>)) count += countSourceRefs(item);
    return count;
  }
  return 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceRefLabels(value: unknown, max = 6): string[] {
  const labels: string[] = [];
  const visit = (item: unknown) => {
    if (labels.length >= max || !item) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (typeof item === "string") {
      const clean = normalizeSpace(item);
      if (clean) labels.push(clean.slice(0, 90));
      return;
    }
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      const label =
        typeof record.title === "string" ? record.title :
        typeof record.name === "string" ? record.name :
        typeof record.url === "string" ? record.url :
        typeof record.source === "string" ? record.source :
        typeof record.id === "string" ? record.id :
        "";
      if (label) {
        labels.push(normalizeSpace(label).slice(0, 90));
        return;
      }
      for (const child of Object.values(record)) visit(child);
    }
  };
  visit(value);
  return Array.from(new Set(labels)).slice(0, max);
}

function sourceRefHref(value: unknown): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const href = sourceRefHref(item);
      if (href) return href;
    }
    return undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string") return record.url;
    if (typeof record.href === "string") return record.href;
    for (const child of Object.values(record)) {
      const href = sourceRefHref(child);
      if (href) return href;
    }
  }
  return undefined;
}

function statusToReportStatus(status: DailyBriefFeature["status"]): ReportCardData["status"] {
  if (status === "passing") return "verified";
  if (status === "pending") return "watching";
  return "review";
}

function statusLabel(status: DailyBriefFeature["status"]): string {
  if (status === "passing") return "verified";
  if (status === "pending") return "watching";
  return "needs review";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function uniqueDailyBriefFeatures(features: DailyBriefFeature[]): DailyBriefFeature[] {
  const seen = new Set<string>();
  return features.filter((feature) => {
    const key = normalizeSpace(`${feature.type}|${feature.name}|${feature.testCriteria}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isCustomerFacingFeature(feature: DailyBriefFeature): boolean {
  const text = normalizeSpace(`${feature.name} ${feature.testCriteria} ${feature.notes ?? ""}`).toLowerCase();
  if (/worker returned insufficient output|insufficient output|empty output|model timeout|retry/i.test(text)) return false;
  if (/^summarize (research paper|top signal):/i.test(feature.name)) return false;
  return true;
}

function signalAudienceScore(signal: Record<string, any>): number {
  const text = normalizeSpace(
    `${signal.headline ?? ""} ${signal.synthesis ?? ""} ${JSON.stringify(signal.evidence ?? [])}`,
  ).toLowerCase();
  let score = 0;
  if (/(funding|raised|series|seed|valuation|ipo|m&a|acquisition|revenue|arr|growth)/i.test(text)) score += 5;
  if (/(ai|agent|model|llm|voice|inference|compute|nvidia|openai|anthropic|deepseek|perplexity|yc)/i.test(text)) score += 5;
  if (/(enterprise|workflow|banker|finance|diligence|crm|customer|sales|infrastructure|data center)/i.test(text)) score += 4;
  if (/(biotech|fda|clinical|drug|medtech|healthcare)/i.test(text)) score += 3;
  if (/(report|source|evidence|claim|notebook|follow-up|watchlist)/i.test(text)) score += 2;
  if (/(reddit|r\/|comments|viral|fired|wipe|crime|joke|meme|thread drama)/i.test(text)) score -= 7;
  if (/(shocking|crazy|wild|just happened|you won'?t believe)/i.test(text)) score -= 4;
  const evidenceCount = Array.isArray(signal.evidence) ? signal.evidence.length : 0;
  score += Math.min(3, evidenceCount);
  return score;
}

function getExecutiveBriefRecord(memory: DailyBriefMemory): Record<string, unknown> | null {
  const context = asRecord(memory.context);
  if (!context) return null;
  const record = asRecord(context.executiveBriefRecord);
  if (record) return record;
  const direct = asRecord(context.executiveBrief);
  return direct
    ? {
        status: "valid",
        brief: direct,
        generatedAt: context.executiveBriefGeneratedAt ?? memory.generatedAt,
      }
    : null;
}

function getExecutiveBrief(memory: DailyBriefMemory): Record<string, any> | null {
  const record = getExecutiveBriefRecord(memory);
  const nested = asRecord(record?.brief);
  if (nested) return nested as Record<string, any>;
  return record && (record.actI || record.actII || record.actIII || record.meta)
    ? record as Record<string, any>
    : null;
}

function getExecutiveBriefGeneratedAt(memory: DailyBriefMemory): number {
  const context = asRecord(memory.context);
  const record = getExecutiveBriefRecord(memory);
  return (
    toTimestampMs(record?.generatedAt) ??
    toTimestampMs(record?.updatedAt) ??
    toTimestampMs(context?.executiveBriefGeneratedAt) ??
    memory.generatedAt
  );
}

function isValidExecutiveBrief(memory: DailyBriefMemory, brief: Record<string, any> | null): boolean {
  if (!brief) return false;
  const record = getExecutiveBriefRecord(memory);
  const validation = asRecord(record?.validation) ?? asRecord(record?.validationResult);
  const status = String(record?.status ?? validation?.status ?? "").toLowerCase();
  const validFlag =
    record?.valid === true ||
    validation?.valid === true ||
    status === "valid" ||
    status === "verified" ||
    status === "succeeded";
  const invalidFlag =
    record?.valid === false ||
    validation?.valid === false ||
    status === "invalid" ||
    status === "failed" ||
    status === "failing" ||
    status === "error";
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const hasSubstance =
    executiveSignals(brief).length > 0 ||
    executiveActions(brief).length > 0 ||
    Boolean(brief.actI || brief.actII || brief.actIII || brief.meta);
  if (invalidFlag) return false;
  return Boolean(hasSubstance && (validFlag || errors.length === 0));
}

function executiveSummary(brief: Record<string, any> | null, fallback: string): string {
  const briefMeta = asRecord(brief?.meta);
  return normalizeSpace(String(briefMeta?.summary ?? brief?.actI?.synthesis ?? fallback));
}

function collectFeedItems(value: unknown, max = 12): Array<Record<string, any>> {
  const items: Array<Record<string, any>> = [];
  const visit = (item: unknown) => {
    if (items.length >= max || !item) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    const record = asRecord(item);
    if (!record) return;
    if (typeof record.title === "string" && (typeof record.url === "string" || typeof record.source === "string")) {
      items.push(record as Record<string, any>);
      return;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return items;
}

function executiveSignals(brief: Record<string, any> | null): Array<Record<string, any>> {
  const signals = brief?.actII?.signals;
  return Array.isArray(signals) ? signals : [];
}

function executiveActions(brief: Record<string, any> | null): Array<Record<string, any>> {
  const actions = brief?.actIII?.actions;
  return Array.isArray(actions) ? actions : [];
}

function executiveEvidenceRows(brief: Record<string, any> | null): LiveArtifactSourceRow[] {
  return executiveSignals(brief).flatMap((signal, signalIndex) => {
    const evidence = Array.isArray(signal.evidence) ? signal.evidence : [];
    return evidence.map((row: Record<string, any>, index: number) => ({
      id: row.id ?? `signal-${signalIndex}-evidence-${index}`,
      type: row.source ?? row.sourceDomain ?? "evidence",
      title: row.title ?? signal.headline ?? "Evidence item",
      refreshed: row.publishedAt ? timeAgo(new Date(row.publishedAt).getTime()) : "today",
      reused: 1,
      excerpt: normalizeSpace(row.relevance ?? signal.synthesis ?? "Evidence captured by the daily brief pipeline.").slice(0, 240),
      href: typeof row.url === "string" ? row.url : undefined,
      status: "verified",
      confidence: typeof row.score === "number" ? Math.min(0.95, Math.max(0.55, row.score / 1000)) : 0.78,
    }));
  });
}

function cleanMarkdownLine(value: string): string {
  return normalizeSpace(value.replace(/^#+\s*/, "").replace(/^[-*]\s*/, ""));
}

function archiveContentToHtml(markdown: string): string {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!blocks.length) return "<p>Archived NodeBench intelligence artifact.</p>";
  return blocks.map((block) => {
    const escaped = escapeHtml(block);
    if (/^#+\s/.test(block)) return `<h2>${escapeHtml(cleanMarkdownLine(block))}</h2>`;
    if (/^[-*]\s/m.test(block)) {
      const items = block
        .split(/\r?\n/)
        .map(cleanMarkdownLine)
        .filter(Boolean)
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${escaped.replace(/\r?\n/g, "<br />")}</p>`;
  }).join("");
}

function confidenceFromStatus(status: DailyBriefFeature["status"]): number {
  if (status === "passing") return 0.86;
  if (status === "pending") return 0.62;
  return 0.44;
}

function archivePostToReport(post: ArchivePost): ReportCardData {
  const label = postTypeLabel(post.postType);
  const sources = Math.max(1, post.factCheckCount ?? countSourceRefs((post.metadata as any)?.sourcesUsed));
  return {
    id: `li_${post._id}`,
    entity: firstMeaningfulLine(post.content).slice(0, 72),
    kind: label,
    status: post.postUrl || sources > 1 ? "verified" : "watching",
    description: excerpt(post.content, 220),
    sources,
    claims: Math.max(1, post.factCheckCount ?? 1),
    followUps: 0,
    updatedAt: timeAgo(post.postedAt),
  };
}

function archivePostToPublicCard(post: ArchivePost): PublicResearchCard {
  const sources = Math.max(1, post.factCheckCount ?? countSourceRefs((post.metadata as any)?.sourcesUsed));
  const reportId = `li_${post._id}`;
  return {
    reportId,
    entity: firstMeaningfulLine(post.content).slice(0, 52),
    entityClass: "topic",
    kind: `${postTypeLabel(post.postType)} - ${post.persona}`,
    whenAgo: timeAgo(post.postedAt),
    signal: excerpt(post.content, 140),
    signalClass: signalClassForPost(post),
    delta: Math.max(1, post.factCheckCount ?? 1),
    trendUp: true,
    claims: Math.max(1, post.factCheckCount ?? 1),
    sources,
    confidence: post.postUrl ? 0.84 : 0.72,
    iconChar: postTypeLabel(post.postType).slice(0, 2).toUpperCase(),
  };
}

function dailyBriefToReport(memory: DailyBriefMemory): ReportCardData {
  const features = uniqueDailyBriefFeatures(memory.features ?? []).filter(isCustomerFacingFeature);
  const brief = getExecutiveBrief(memory);
  const validBrief = isValidExecutiveBrief(memory, brief);
  const signals = executiveSignals(brief);
  const actions = executiveActions(brief);
  const executiveRows = executiveEvidenceRows(brief);
  const failing = validBrief ? 0 : features.filter((f) => f.status === "failing").length;
  const sources = Math.max(1, executiveRows.length || countSourceRefs(features.map((f) => f.sourceRefs)));
  const claims = Math.max(1, signals.length || features.filter((f) => f.status === "passing").length || features.length);
  const followUps = actions.length || (validBrief ? 0 : features.filter((f) => f.status !== "passing").length);
  return {
    id: `daily_${memory._id}`,
    entity: `Daily Brief - ${memory.dateString}`,
    kind: "Daily Brief",
    status: failing > 0 ? "review" : "verified",
    description: executiveSummary(brief, memory.goal || "Daily brief memory generated by NodeBench."),
    sources,
    claims,
    followUps,
    updatedAt: timeAgo(getExecutiveBriefGeneratedAt(memory)),
  };
}

function dailyBriefToDetail(memory: DailyBriefMemory): LiveArtifactDetail {
  const allFeatures = uniqueDailyBriefFeatures(memory.features ?? []);
  const features = allFeatures.filter(isCustomerFacingFeature).sort((a, b) => {
    const statusRank = { failing: 0, pending: 1, passing: 2 } as const;
    return statusRank[a.status] - statusRank[b.status] || (a.priority ?? 99) - (b.priority ?? 99);
  });
  const title = `Daily Brief - ${memory.dateString}`;
  const brief = getExecutiveBrief(memory);
  const validBrief = isValidExecutiveBrief(memory, brief);
  const generatedAtMs = getExecutiveBriefGeneratedAt(memory);
  const summary = executiveSummary(brief, memory.goal || "Daily brief memory generated by NodeBench.");
  const briefMeta = asRecord(brief?.meta);
  const signals = executiveSignals(brief);
  const rankedSignals = signals.slice().sort((a, b) => signalAudienceScore(b) - signalAudienceScore(a));
  const actions = executiveActions(brief);
  const executiveRows = executiveEvidenceRows(brief);
  const sources = Math.max(1, executiveRows.length || countSourceRefs(features.map((f) => f.sourceRefs)));
  const claims = Math.max(1, signals.length || features.filter((f) => f.status === "passing").length || features.length);
  const followUps = actions.length || (validBrief ? 0 : features.filter((f) => f.status !== "passing").length);
  const failing = validBrief ? 0 : features.filter((f) => f.status === "failing").length;
  const sourceRows: LiveArtifactSourceRow[] = [
    ...executiveRows,
    ...features.map((feature, index) => {
    const feedItems = collectFeedItems(feature.sourceRefs, 3);
    const primaryFeed = feedItems[0];
    return {
      id: feature.id || `feature-${index}`,
      type: `${feature.type || "check"} / ${statusLabel(feature.status)}`,
      title: primaryFeed?.title ?? feature.name,
      refreshed: timeAgo(feature.updatedAt || memory.generatedAt),
      reused: Math.max(1, countSourceRefs(feature.sourceRefs)),
      excerpt: normalizeSpace(primaryFeed?.summary || feature.notes || feature.testCriteria || summary).slice(0, 220),
      href: typeof primaryFeed?.url === "string" ? primaryFeed.url : sourceRefHref(feature.sourceRefs),
      status: statusLabel(feature.status),
      confidence: confidenceFromStatus(feature.status),
    };
  })].slice(0, 40);
  const signalItems = rankedSignals.length
    ? rankedSignals.slice(0, 10).map((signal) => ({
        label: signal.headline ?? "Daily brief signal",
        body: normalizeSpace(signal.synthesis ?? "Signal captured by the daily brief pipeline."),
        meta: `${Array.isArray(signal.evidence) ? signal.evidence.length : 0} evidence refs - executive brief`,
        status: "verified" as const,
      }))
    : features.slice(0, 10).map((feature) => ({
        label: feature.name,
        body: normalizeSpace(feature.notes || feature.testCriteria || summary),
        meta: `${statusLabel(feature.status)} - ${Math.max(1, countSourceRefs(feature.sourceRefs))} source refs - updated ${timeAgo(feature.updatedAt || memory.generatedAt)}`,
        status: statusToReportStatus(feature.status),
      }));
  const actionItems = actions.slice(0, 8).map((action) => ({
    label: action.label ?? "Follow-up action",
    body: normalizeSpace(action.content ?? "Investigate this item and summarize implications, risks, and suggested next actions."),
    meta: `priority ${action.priority ?? "normal"} - ${action.status ?? "proposed"}`,
    status: "watching" as const,
  }));
  const needsReview = features.filter((feature) => feature.status !== "passing").slice(0, 8).map((feature) => ({
    label: feature.name,
    body: normalizeSpace(feature.testCriteria || feature.notes || "Review this daily brief signal before promoting it."),
    meta: `${statusLabel(feature.status)} - priority ${feature.priority ?? "normal"}`,
    status: statusToReportStatus(feature.status),
  }));
  const reviewQueueBody = needsReview.length
    ? "These items still need source verification, stronger evidence, or a human decision before they become reusable memory."
    : validBrief
      ? "The public brief is validated. Lower-confidence worker retries stay out of the customer-facing report surface."
      : "No failing or pending checks remain in the latest daily brief.";
  const sections: LiveArtifactSection[] = [
    {
      title: "Executive read",
      body: normalizeSpace(String(briefMeta?.summary ?? brief?.actI?.synthesis ?? summary)),
      items: [
        {
          label: briefMeta?.headline ? String(briefMeta.headline) : `${features.length} checks captured`,
          body: `${claims} reusable signals, ${actions.length} recommended actions, ${sources} evidence rows available. ${briefMeta?.confidence ? `Executive confidence ${briefMeta.confidence}%.` : ""}`.trim(),
          meta: `Generated ${timeAgo(generatedAtMs)} from the daily brief pipeline`,
          status: failing > 0 ? "review" : "verified",
        },
      ],
    },
    ...(brief?.actI ? [{
      title: brief.actI.title ?? "Act I: Coverage and freshness",
      body: normalizeSpace(brief.actI.synthesis ?? "Coverage and source freshness summary."),
      items: Array.isArray(brief.actI.topSources)
        ? brief.actI.topSources.slice(0, 4).map((source: Record<string, any>) => ({
            label: source.source ?? "Source",
            body: `${source.count ?? 0} items contributed to this brief.`,
            meta: `${brief.actI.sourcesCount ?? 0} source groups - ${brief.actI.totalItems ?? features.length} total items`,
            status: "verified" as const,
          }))
        : undefined,
    }] : []),
    {
      title: brief?.actII?.title ?? "Signals to review",
      body: normalizeSpace(brief?.actII?.synthesis ?? "These are the live daily-brief checks available to preserve as claims, notebook blocks, or follow-up tasks."),
      items: signalItems,
    },
    ...(actionItems.length ? [{
      title: brief?.actIII?.title ?? "Deep-dive actions",
      body: normalizeSpace(brief?.actIII?.synthesis ?? "Follow-ups convert today's signals into concrete investigations."),
      items: actionItems,
    }] : []),
    {
      title: "Review queue",
      body: reviewQueueBody,
      items: needsReview,
    },
    {
      title: "Next action",
      body: "Convert the strongest verified signals into notebook claims, attach their source references, and run the same rubric across the active coverage universe.",
    },
  ];
  const mapItems = rankedSignals.length
    ? rankedSignals.slice(0, 6).map((signal, index) => ({
        id: signal.id ?? `signal-${index}`,
        title: String(signal.headline ?? "Daily signal").slice(0, 28),
        subtitle: `${Array.isArray(signal.evidence) ? signal.evidence.length : 0} evidence refs`,
        tone: "green" as const,
      }))
    : features.slice(0, 6).map((feature) => ({
        id: feature.id,
        title: feature.name.slice(0, 28),
        subtitle: `${feature.type} - ${statusLabel(feature.status)}`,
        tone: feature.status === "passing" ? "green" as const : feature.status === "pending" ? "blue" as const : "amber" as const,
      }));
  const nodes: LiveArtifactMapNode[] = [
    { id: "root", title, subtitle: "Daily brief - root", tone: "accent" },
    ...mapItems,
  ];
  const edges: LiveArtifactMapEdge[] = [
    ...nodes.slice(1).map((node) => ({
      from: "root",
      to: node.id,
      type: "has_artifact" as const,
      label: node.subtitle || "artifact",
      basis: "Derived from the current daily brief signal map.",
    })),
  ];
  if (mapItems.length >= 2) {
    edges.push({
      from: mapItems[0].id,
      to: mapItems[1].id,
      type: "causes",
      label: "causes",
      basis: "The first ranked signal is treated as the lead artifact that changes the next artifact's review order.",
      strength: 0.74,
    });
  }
  if (mapItems.length >= 3) {
    edges.push({
      from: mapItems[1].id,
      to: mapItems[2].id,
      type: "correlates_with",
      label: "correlates",
      basis: "Adjacent daily brief artifacts share source timing or topic overlap.",
      strength: 0.66,
    });
  }
  const signalClaimHtml = rankedSignals.length
    ? rankedSignals.map((signal) => {
        const evidence = Array.isArray(signal.evidence) ? signal.evidence : [];
        const sourceLabel = evidence
          .map((row: Record<string, any>) => row.url ?? row.title ?? row.source)
          .filter(Boolean)
          .slice(0, 3)
          .join(" | ");
        return [
          `<div data-block="claim" data-status="verified">`,
          `<span data-claim-label>${escapeHtml(String(signal.headline ?? "Daily brief signal"))} - verified</span>`,
          `<p>${escapeHtml(normalizeSpace(signal.synthesis ?? "Signal captured by the daily brief pipeline."))}</p>`,
          `<span data-claim-source>${evidence.length} evidence refs${sourceLabel ? ` - ${escapeHtml(sourceLabel)}` : ""}</span>`,
          `</div>`,
        ].join("");
      })
    : features.map((feature) => {
        const refs = sourceRefLabels(feature.sourceRefs, 3);
        const sourceLabel = refs.length ? ` - ${escapeHtml(refs.join(" | "))}` : "";
        const status = statusToReportStatus(feature.status) === "verified" ? "verified" : "review";
        return [
          `<div data-block="claim" data-status="${status}">`,
          `<span data-claim-label>${escapeHtml(feature.name)} - ${escapeHtml(statusLabel(feature.status))}</span>`,
          `<p>${escapeHtml(normalizeSpace(feature.notes || feature.testCriteria || summary))}</p>`,
          `<span data-claim-source>${Math.max(1, countSourceRefs(feature.sourceRefs))} source refs${sourceLabel} - refreshed ${escapeHtml(timeAgo(feature.updatedAt || memory.generatedAt))}</span>`,
          `</div>`,
        ].join("");
      });
  const notebookHtml = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(normalizeSpace(String(briefMeta?.summary ?? summary)))}</p>`,
    brief?.actI ? `<h2>${escapeHtml(String(brief.actI.title ?? "Act I"))}</h2><p>${escapeHtml(normalizeSpace(brief.actI.synthesis ?? ""))}</p>` : "",
    `<h2>Signals to review</h2>`,
    ...signalClaimHtml,
    actionItems.length ? `<h2>Deep-dive actions</h2>${actionItems.map((action) => `<p><strong>${escapeHtml(action.label)}</strong>: ${escapeHtml(action.body)}</p>`).join("")}` : "",
    `<h2>Review plan</h2>`,
    `<p>Promote verified checks into reusable claims, request source refresh for pending checks, and keep failing checks in the Inbox review queue until they have stronger evidence.</p>`,
  ].join("");

  return {
    id: `daily_${memory._id}`,
    title,
    kind: "Daily Brief",
    status: failing > 0 ? "review" : "verified",
    summary,
    updatedAt: timeAgo(generatedAtMs),
    updatedAtMs: generatedAtMs,
    sourceCount: sources,
    claimCount: claims,
    followUps,
    tags: [
      "Daily Brief",
      validBrief ? "Validated executive brief" : "Live memory",
      memory.dateString,
      ...features.slice(0, 3).map((f) => f.type),
    ],
    sections,
    sourceRows,
    nodes,
    edges,
    notebookHtml,
    primaryAction: "Promote verified signals into notebook claims",
  };
}

function archivePostToDetail(post: ArchivePost): LiveArtifactDetail {
  const report = archivePostToReport(post);
  const metadata = (post.metadata ?? {}) as Record<string, unknown>;
  const sourceLabels = sourceRefLabels(metadata.sourcesUsed ?? metadata.sourceRefs ?? metadata.sources, 8);
  const sourceCount = Math.max(1, report.sources);
  const sourceRows: LiveArtifactSourceRow[] = sourceLabels.length
    ? sourceLabels.map((label, index) => ({
        id: `source-${index}`,
        type: "source",
        title: label,
        refreshed: timeAgo(post.postedAt),
        reused: 1,
        excerpt: excerpt(post.content, 180),
        href: /^https?:\/\//.test(label) ? label : undefined,
        confidence: post.postUrl ? 0.84 : 0.72,
      }))
    : [{
        id: "archive-row",
        type: postTypeLabel(post.postType),
        title: post.postUrl ? "LinkedIn archive post" : "NodeBench archive row",
        refreshed: timeAgo(post.postedAt),
        reused: sourceCount,
        excerpt: excerpt(post.content, 180),
        href: post.postUrl,
        confidence: post.postUrl ? 0.84 : 0.72,
      }];
  const paragraphs = post.content.split(/\n{2,}/).map(cleanMarkdownLine).filter(Boolean);
  const sections: LiveArtifactSection[] = [
    {
      title: "Published read",
      body: excerpt(post.content, 360),
      items: paragraphs.slice(0, 5).map((body, index) => ({
        label: index === 0 ? report.entity : `Evidence block ${index + 1}`,
        body,
        meta: `${postTypeLabel(post.postType)} - ${timeAgo(post.postedAt)}`,
        status: report.status,
      })),
    },
    {
      title: "Next action",
      body: "Preserve the strongest public claim, attach the archive row as evidence, and decide whether to track this topic in a recurring universe.",
    },
  ];
  const nodes: LiveArtifactMapNode[] = [
    { id: "root", title: report.entity.slice(0, 28), subtitle: `${report.kind} - root`, tone: "accent" },
    { id: "archive", title: "Archive post", subtitle: `${sourceCount} sources`, tone: "blue" },
    { id: "persona", title: post.persona, subtitle: "persona", tone: "default" },
  ];
  const edges: LiveArtifactMapEdge[] = [
    { from: "root", to: "archive", type: "has_artifact", label: "archive artifact", basis: "Archive row rendered as reusable evidence." },
    { from: "root", to: "persona", type: "coverage", label: "persona context", basis: "Persona controls tone and audience for this artifact." },
    { from: "archive", to: "persona", type: "correlates_with", label: "correlates", basis: "Archive artifact and persona context are part of the same published packet.", strength: 0.58 },
  ];
  const notebookHtml = [
    `<h1>${escapeHtml(report.entity)}</h1>`,
    `<p><strong>${escapeHtml(report.kind)}</strong> - ${escapeHtml(report.description)}</p>`,
    archiveContentToHtml(post.content),
    `<div data-block="claim" data-status="${report.status === "verified" ? "verified" : "review"}">`,
    `<span data-claim-label>Archived public claim - ${escapeHtml(report.status)}</span>`,
    `<p>${escapeHtml(report.description)}</p>`,
    `<span data-claim-source>${sourceCount} sources - ${escapeHtml(timeAgo(post.postedAt))}${post.postUrl ? ` - ${escapeHtml(post.postUrl)}` : ""}</span>`,
    `</div>`,
  ].join("");

  return {
    id: report.id,
    title: report.entity,
    kind: report.kind,
    status: report.status,
    summary: report.description,
    updatedAt: report.updatedAt,
    updatedAtMs: post.postedAt,
    sourceCount,
    claimCount: report.claims,
    followUps: report.followUps,
    tags: [report.kind, post.persona, post.dateString].filter(Boolean),
    sections,
    sourceRows,
    nodes,
    edges,
    notebookHtml,
    primaryAction: "Preserve as reusable public memory",
  };
}

export function buildLiveArtifactNotebookHtml(detail: LiveArtifactDetail): string {
  return detail.notebookHtml;
}

function featureToPublicCard(feature: DailyBriefFeature, memory: DailyBriefMemory): PublicResearchCard {
  const sources = Math.max(1, countSourceRefs(feature.sourceRefs));
  return {
    reportId: `daily_${memory._id}`,
    entity: feature.name.slice(0, 56),
    entityClass: "topic",
    kind: `Daily brief - ${feature.status}`,
    whenAgo: timeAgo(feature.updatedAt || memory.generatedAt),
    signal: normalizeSpace(feature.notes || feature.testCriteria || memory.goal).slice(0, 150),
    signalClass: feature.status === "failing" ? "regulatory" : "research",
    delta: feature.status === "passing" ? 1 : -1,
    trendUp: feature.status === "passing",
    claims: 1,
    sources,
    confidence: confidenceFromStatus(feature.status),
    iconChar: "DB",
  };
}

function signalToPublicCard(signal: Record<string, any>, memory: DailyBriefMemory, index: number): PublicResearchCard {
  const evidence = Array.isArray(signal.evidence) ? signal.evidence : [];
  const headline = String(signal.headline ?? `Daily brief signal ${index + 1}`);
  return {
    reportId: `daily_${memory._id}`,
    entity: headline.slice(0, 56),
    entityClass: "topic",
    kind: "Daily brief - verified",
    whenAgo: timeAgo(getExecutiveBriefGeneratedAt(memory)),
    signal: normalizeSpace(String(signal.synthesis ?? memory.goal ?? "Validated daily brief signal.")).slice(0, 150),
    signalClass: "research",
    delta: Math.max(1, evidence.length),
    trendUp: true,
    claims: 1,
    sources: Math.max(1, evidence.length),
    confidence: 0.86,
    iconChar: "DB",
  };
}

function dailyBriefPublicCards(memory: DailyBriefMemory): PublicResearchCard[] {
  const brief = getExecutiveBrief(memory);
  const signals = executiveSignals(brief);
  if (isValidExecutiveBrief(memory, brief) && signals.length) {
    return signals.slice(0, 6).map((signal, index) => signalToPublicCard(signal, memory, index));
  }
  return uniqueDailyBriefFeatures(memory.features ?? [])
    .filter((feature) => feature.status === "passing" && isCustomerFacingFeature(feature))
    .slice(0, 6)
    .map((feature) => featureToPublicCard(feature, memory));
}

function buildPulse(memory: DailyBriefMemory | null, posts: ArchivePost[]): PulseCard[] {
  const cards: PulseCard[] = [];
  if (memory) {
    const brief = getExecutiveBrief(memory);
    const validBrief = isValidExecutiveBrief(memory, brief);
    const signals = executiveSignals(brief);
    const actions = executiveActions(brief);
    const evidenceRows = executiveEvidenceRows(brief);
    const features = uniqueDailyBriefFeatures(memory.features ?? []).filter(isCustomerFacingFeature);
    const passing = features.filter((f) => f.status === "passing").length;
    const needsWork = validBrief ? 0 : features.length - passing;
    cards.push({
      kind: needsWork > 0 ? "follow_up" : "report_update",
      title: validBrief
        ? `Daily Brief validated ${Math.max(1, signals.length || passing)} reusable signals`
        : `Daily Brief needs review on ${needsWork}/${features.length} checks`,
      body: validBrief
        ? executiveSummary(brief, memory.goal || "Daily brief memory is available for reuse in the redesign.")
        : normalizeSpace(memory.goal || "Daily brief memory is available for reuse in the redesign."),
      meta: validBrief
        ? `${evidenceRows.length || countSourceRefs(features.map((f) => f.sourceRefs))} evidence rows - ${actions.length} actions - ${timeAgo(getExecutiveBriefGeneratedAt(memory))}`
        : `${timeAgo(memory.generatedAt)} - ${memory.dateString}`,
      cta: "Open brief",
    });
  }
  for (const post of posts.slice(0, 4)) {
    cards.push({
      kind: post.postUrl ? "report_update" : "memory_win",
      title: firstMeaningfulLine(post.content).slice(0, 80),
      body: excerpt(post.content, 140),
      meta: `${timeAgo(post.postedAt)} - ${postTypeLabel(post.postType)}`,
      cta: post.postUrl ? "Open post" : undefined,
    });
  }
  return cards.slice(0, 5);
}

function buildMetrics(stats: ArchiveStats | null, memory: DailyBriefMemory | null): PulseMetric[] {
  if (!stats && !memory) return [];
  const features = memory?.features ?? [];
  const brief = memory ? getExecutiveBrief(memory) : null;
  const validBrief = memory ? isValidExecutiveBrief(memory, brief) : false;
  const signals = executiveSignals(brief);
  const sourceRows = executiveEvidenceRows(brief);
  const passing = features.filter((f) => f.status === "passing").length;
  return [
    { label: "Public artifacts", value: String(stats?.totalPosts ?? 0), delta: `${stats?.recentDates.length ?? 0} active days` },
    { label: "Artifact types", value: String(stats?.byType.length ?? 0), hint: "LinkedIn archive" },
    { label: "Brief signals", value: String(signals.length || passing || features.length), delta: validBrief ? "validated" : `${passing} passing` },
    { label: "Evidence rows", value: String(Math.max(0, sourceRows.length || countSourceRefs(features.map((f) => f.sourceRefs)))), hint: "daily brief" },
    { label: "Latest brief", value: memory?.dateString ?? "none" },
    { label: "Frontend feed", value: "Live", delta: "Convex-backed" },
  ];
}

export function useLiveArtifacts(limit = 24, options: { enabled?: boolean } = {}): LiveArtifactsResult {
  const enabled = options.enabled ?? true;
  const archive = useQuery(
    liveArtifactApi.domains.social.linkedinArchiveQueries.getArchivedPosts,
    enabled ? ({ limit, dedupe: true } as Parameters<typeof useQuery>[1]) : "skip",
  ) as ArchivePostsResult | undefined;

  const archiveStats = useQuery(
    liveArtifactApi.domains.social.linkedinArchiveQueries.getArchiveStats,
    enabled ? ({ dedupe: true } as Parameters<typeof useQuery>[1]) : "skip",
  ) as ArchiveStats | undefined;

  const latestMemory = useQuery(
    liveArtifactApi.domains.research.dailyBriefMemoryQueries.getLatestMemory,
    enabled ? ({} as Parameters<typeof useQuery>[1]) : "skip",
  ) as DailyBriefMemory | null | undefined;

  return useMemo(() => {
    if (!enabled) return EMPTY_LIVE_ARTIFACTS;
    const isLoading = archive === undefined || archiveStats === undefined || latestMemory === undefined;
    const posts = archive?.posts ?? [];
    const memory = latestMemory ?? null;
    const artifactReports = [
      ...(memory ? [dailyBriefToReport(memory)] : []),
      ...posts.map(archivePostToReport),
    ].slice(0, limit);
    const details = [
      ...(memory ? [dailyBriefToDetail(memory)] : []),
      ...posts.map(archivePostToDetail),
    ].slice(0, limit);
    const dailyBriefCards = memory ? dailyBriefPublicCards(memory) : [];
    const publicResearch = [
      ...dailyBriefCards,
      ...posts.map(archivePostToPublicCard),
    ].slice(0, limit);
    const isLive = artifactReports.length > 0 || publicResearch.length > 0;
    const archiveCount = posts.length;
    const briefFeatureCount = dailyBriefCards.length || (memory ? uniqueDailyBriefFeatures(memory.features ?? []).filter(isCustomerFacingFeature).length : 0);
    return {
      isLoading,
      isLive,
      sourceLabel: isLive
        ? `Live artifacts - ${archiveCount} posts - ${briefFeatureCount} brief signals`
        : "No live artifacts yet",
      metrics: buildMetrics(archiveStats ?? null, memory),
      pulse: buildPulse(memory, posts),
      publicResearch,
      reports: artifactReports,
      details,
      archiveCount,
      briefFeatureCount,
    };
  }, [archive, archiveStats, enabled, latestMemory, limit]);
}

export function useReportGraphNeighborhood(
  args: {
    rootId?: string | null;
    query?: string;
    stage?: string;
    kind?: string;
    mode?: "focus" | "clustered" | "expanded";
    limit?: number;
  },
  options: { enabled?: boolean } = {},
): ReportGraphNeighborhoodResult {
  const enabled = options.enabled ?? true;
  const packet = useQuery(
    liveArtifactApi.domains.redesign.reportGraphNeighborhood.getReportGraphNeighborhood,
    enabled
      ? ({
          rootId: args.rootId ?? undefined,
          query: args.query || undefined,
          stage: args.stage || undefined,
          kind: args.kind || undefined,
          mode: args.mode ?? "expanded",
          limit: args.limit,
        } as Parameters<typeof useQuery>[1])
      : "skip",
  ) as ReportGraphNeighborhoodPacket | undefined;

  return useMemo(() => {
    if (!enabled) {
      return {
        ...EMPTY_LIVE_ARTIFACTS,
        scope: null,
      };
    }

    if (packet === undefined) {
      return {
        ...EMPTY_LIVE_ARTIFACTS,
        isLoading: true,
        sourceLabel: "Loading graph neighborhood",
        scope: null,
      };
    }

    const memory = packet.latestMemory ?? null;
    const posts = packet.posts ?? [];
    const artifactReports = [
      ...(memory ? [dailyBriefToReport(memory)] : []),
      ...posts.map(archivePostToReport),
    ];
    const details = [
      ...(memory ? [dailyBriefToDetail(memory)] : []),
      ...posts.map(archivePostToDetail),
    ];
    const dailyBriefCards = memory ? dailyBriefPublicCards(memory) : [];
    const publicResearch = [
      ...dailyBriefCards,
      ...posts.map(archivePostToPublicCard),
    ];
    const isLive = artifactReports.length > 0 || publicResearch.length > 0;
    const briefFeatureCount = dailyBriefCards.length || (memory ? uniqueDailyBriefFeatures(memory.features ?? []).filter(isCustomerFacingFeature).length : 0);

    return {
      isLoading: false,
      isLive,
      sourceLabel: packet.sourceLabel,
      metrics: [],
      pulse: [],
      publicResearch,
      reports: artifactReports,
      details,
      archiveCount: posts.length,
      briefFeatureCount,
      scope: {
        isServerBounded: true,
        mode: packet.mode,
        reportLimit: packet.reportLimit,
        scanLimit: packet.scanLimit,
        scannedArchivePosts: packet.scannedArchivePosts,
        totalCandidateReports: packet.totalCandidateReports,
        returnedReportCount: packet.returnedReportCount,
        hiddenReportCount: packet.hiddenReportCount,
        hasMoreArchive: packet.hasMoreArchive,
      },
    };
  }, [enabled, packet]);
}
