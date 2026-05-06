/**
 * useLiveArtifacts
 *
 * Bridges existing first-party production artifacts into the redesign surfaces:
 * LinkedIn archive rows, daily brief memories, and daily brief feature checks.
 * Starter fixtures remain the fallback, but when Convex has public artifacts the
 * redesign should feel like a real operating surface, not a static showcase.
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
  archiveCount: number;
  briefFeatureCount: number;
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
  };
};

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
  const features = memory.features ?? [];
  const failing = features.filter((f) => f.status === "failing").length;
  const sources = Math.max(1, countSourceRefs(features.map((f) => f.sourceRefs)));
  return {
    id: `daily_${memory._id}`,
    entity: `Daily Brief - ${memory.dateString}`,
    kind: "Daily Brief",
    status: failing > 0 ? "review" : "verified",
    description: normalizeSpace(memory.goal || "Daily brief memory generated by NodeBench."),
    sources,
    claims: features.length,
    followUps: features.filter((f) => f.status !== "passing").length,
    updatedAt: timeAgo(memory.generatedAt),
  };
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

function buildPulse(memory: DailyBriefMemory | null, posts: ArchivePost[]): PulseCard[] {
  const cards: PulseCard[] = [];
  if (memory) {
    const passing = memory.features.filter((f) => f.status === "passing").length;
    const needsWork = memory.features.length - passing;
    cards.push({
      kind: needsWork > 0 ? "follow_up" : "report_update",
      title: `Daily Brief memory advanced ${passing}/${memory.features.length} checks`,
      body: normalizeSpace(memory.goal || "Daily brief memory is available for reuse in the redesign."),
      meta: `${timeAgo(memory.generatedAt)} - ${memory.dateString}`,
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
  const passing = features.filter((f) => f.status === "passing").length;
  return [
    { label: "Public artifacts", value: String(stats?.totalPosts ?? 0), delta: `${stats?.recentDates.length ?? 0} active days` },
    { label: "Artifact types", value: String(stats?.byType.length ?? 0), hint: "LinkedIn archive" },
    { label: "Brief features", value: String(features.length), delta: `${passing} passing` },
    { label: "Source refs", value: String(Math.max(0, countSourceRefs(features.map((f) => f.sourceRefs)))), hint: "daily brief" },
    { label: "Latest brief", value: memory?.dateString ?? "none" },
    { label: "Frontend feed", value: "Live", delta: "Convex-backed" },
  ];
}

export function useLiveArtifacts(limit = 24): LiveArtifactsResult {
  const archive = useQuery(
    liveArtifactApi.domains.social.linkedinArchiveQueries.getArchivedPosts,
    { limit, dedupe: true } as Parameters<typeof useQuery>[1],
  ) as ArchivePostsResult | undefined;

  const archiveStats = useQuery(
    liveArtifactApi.domains.social.linkedinArchiveQueries.getArchiveStats,
    { dedupe: true } as Parameters<typeof useQuery>[1],
  ) as ArchiveStats | undefined;

  const latestMemory = useQuery(
    liveArtifactApi.domains.research.dailyBriefMemoryQueries.getLatestMemory,
    {} as Parameters<typeof useQuery>[1],
  ) as DailyBriefMemory | null | undefined;

  return useMemo(() => {
    const isLoading = archive === undefined || archiveStats === undefined || latestMemory === undefined;
    const posts = archive?.posts ?? [];
    const memory = latestMemory ?? null;
    const artifactReports = [
      ...(memory ? [dailyBriefToReport(memory)] : []),
      ...posts.map(archivePostToReport),
    ].slice(0, limit);
    const publicResearch = [
      ...(memory?.features ?? []).slice(0, 6).map((feature) => featureToPublicCard(feature, memory)),
      ...posts.map(archivePostToPublicCard),
    ].slice(0, limit);
    const isLive = artifactReports.length > 0 || publicResearch.length > 0;
    const archiveCount = posts.length;
    const briefFeatureCount = memory?.features.length ?? 0;
    return {
      isLoading,
      isLive,
      sourceLabel: isLive
        ? `Live artifacts - ${archiveCount} posts - ${briefFeatureCount} brief checks`
        : "Starter coverage",
      metrics: buildMetrics(archiveStats ?? null, memory),
      pulse: buildPulse(memory, posts),
      publicResearch,
      reports: artifactReports,
      archiveCount,
      briefFeatureCount,
    };
  }, [archive, archiveStats, latestMemory, limit]);
}
