import { useState, type KeyboardEvent, type ReactNode } from "react";
import { showToast } from "../components/Toast";
import { UniversalComposer, type RouterTier } from "../components/UniversalComposer";
import type { LiveArtifactsResult, LiveArtifactSourceRow } from "../hooks/useLiveArtifacts";
import type { ReportCardData } from "../fixtures";
import { buildGraphContextBridgePacket } from "../lib/graphContextBridge";

interface HomeAskContext {
  reportId?: string;
  artifactKey?: string;
}

interface HomeV2SurfaceProps {
  onAsk?: (prompt: string, context?: HomeAskContext) => void;
  onOpenReports?: (reportId?: string) => void;
  liveArtifacts?: LiveArtifactsResult;
}

interface PrototypeSelectionProps extends HomeV2SurfaceProps {
  selectedEntity?: string;
  selectedReport?: ReportCardData | null;
  onSelectEntity?: (entity: string) => void;
  guestSafe?: boolean;
}

export type PrototypeSurface = "home" | "reports" | "chat" | "inbox" | "me";

const editionItems = [
  {
    day: "11",
    title: "Today",
    meta: "4 signals \u00b7 12 sources",
    body: "Anthropic repriced enterprise tier +40%. Sequoia added ratchet clause. SMB churn 3.2%.",
    today: true,
  },
  {
    day: "10",
    title: "Sequoia counter-bid",
    meta: "2 signals \u00b7 6 sources",
    body: "Sequoia moved to $80M pre. New terms include board seat and pro-rata rights.",
  },
  {
    day: "9",
    title: "Bug0 pricing drop",
    meta: "3 signals \u00b7 8 sources",
    body: "Bug0 dropped enterprise to $199/seat. Three customers asked about our response.",
  },
  {
    day: "8",
    title: "SMB churn spike",
    meta: "1 signal \u00b7 4 sources",
    body: "First above-baseline churn week. Two exits cited pricing.",
  },
  {
    day: "7",
    title: "Patent filing update",
    meta: "1 signal \u00b7 2 sources",
    body: "USPTO acknowledged receipt of 17/892,341. Estimated 14-month review.",
  },
];

const queueItems = [
  ["1", "Now", "Anthropic partnership terms - board call Thu", "Open memo \u2192"],
  ["2", "Now", "Series B term sheet from Sequoia - deadline Wed", "Draft reply \u2192"],
  ["3", "Now", "Customer churn spike in SMB - 3 flagged", "Research \u2192"],
  ["4", "Prep", "Competitor Bug0 dropped enterprise to $199/seat", "Read brief \u2192"],
  ["5", "Prep", "Board deck Q2 financials - CFO updated projections", "Review \u2192"],
  ["6", "Check", "Patent filing status for agent orchestration - USPTO pending", "Check \u2192"],
  ["7", "Report", "Weekly hiring pipeline review - 4 senior eng in final round", "Open report \u2192"],
  ["8", "Report", "Customer feedback digest from NPS survey - 340 responses", "Open report \u2192"],
];

const reportEntities = [
  {
    initial: "A",
    name: "Anthropic",
    status: "Verified",
    score: 91,
    sources: 12,
    delta: "Updated 2h ago",
    kind: "Partnership intelligence - Company",
    body: "Enterprise tier repriced +40%; Claude 4 Opus structure held. Managed Agent tier launched at $0.168/1K tokens.",
    tags: ["Partnership", "AI", "Enterprise"],
    ref: "Board prep - Q2 strategy - Vendor review",
    meta: "5 of 5 claims verified · 12 sources · refreshed 2h ago",
    dims: { Sources: 95, Freshness: 92, Verification: 80, Coverage: 88 },
    signals: ["Enterprise pricing +40% effective June 1", "Managed Agent tier $0.168/1K tokens", "Partnership compressed $1.2M"],
    related: ["Sequoia Capital", "OpenAI", "Google DeepMind"],
    active: true,
  },
  {
    initial: "S",
    name: "Sequoia Capital",
    status: "Needs review",
    score: 74,
    sources: 8,
    delta: "Last checked 1d ago",
    kind: "Term sheet analysis - Investor",
    body: "Full-ratchet anti-dilution at 1x in term sheet v3; 33% below market norm. Board observer seat added at $83M.",
    tags: ["Fundraising", "Term sheet", "Action needed"],
    ref: "Cap table model - Dilution analysis - Deal memo",
    meta: "4 of 7 claims current · 8 sources · review needed",
    dims: { Sources: 72, Freshness: 65, Verification: 58, Coverage: 80 },
    signals: ["Full-ratchet anti-dilution clause added", "Board observer seat at $8.3M", "Counter-bid moved to $80M pre"],
    related: ["Anthropic", "Bug0", "OpenAI"],
  },
  {
    initial: "B",
    name: "Bug0",
    status: "Verified",
    score: 88,
    sources: 5,
    delta: "Updated 1d ago",
    kind: "Competitive intelligence - Competitor",
    body: "Pricing dropped to $199/mo from $349; SOC 2 Type II obtained. Feature gap narrowing on automated QA.",
    tags: ["Competitive", "QA", "Enterprise"],
    ref: "Competitive matrix - Pricing comparison",
    meta: "4 of 4 claims verified · 5 sources · refreshed 1d ago",
    dims: { Sources: 78, Freshness: 85, Verification: 90, Coverage: 82 },
    signals: ["Pricing dropped to $199/mo from $349", "SOC 2 Type II obtained", "Feature gap narrowing on automated QA"],
    related: ["Anthropic", "OpenAI", "Google DeepMind"],
  },
  {
    initial: "O",
    name: "OpenAI",
    status: "Stale",
    score: 62,
    sources: 4,
    delta: "Last checked 3d ago",
    kind: "Market intelligence - Company",
    body: "GPT-5 announcement rumored but unverified; 2 of 5 claims stale after 3 days. Refresh needed.",
    tags: ["AI", "Unverified"],
    ref: "Competitive matrix - API cost model",
    meta: "3 of 5 claims current · 4 sources · refresh needed",
    dims: { Sources: 55, Freshness: 42, Verification: 50, Coverage: 68 },
    signals: ["GPT-5 announcement rumored, unverified", "2 of 5 claims now stale", "API pricing restructure signal"],
    related: ["Anthropic", "Google DeepMind", "Bug0"],
  },
  {
    initial: "G",
    name: "Google DeepMind",
    status: "Stale",
    score: 55,
    sources: 3,
    delta: "Last checked 5d ago",
    kind: "Coverage gap - Company",
    body: "No new signals in 5 days; only 1 of 3 sources still verifiable. Refresh the research and update model capability notes.",
    tags: ["AI", "Research", "Refresh"],
    ref: "Model capability watch - Source ledger",
    meta: "1 of 3 sources still verifiable · 3 sources · refresh needed",
    dims: { Sources: 48, Freshness: 35, Verification: 45, Coverage: 55 },
    signals: ["No new signals in 5 days", "Only 1 of 3 sources still verifiable", "Research tracker needs owner review"],
    related: ["Anthropic", "OpenAI", "Sequoia Capital"],
  },
];

type PrototypeReportEntity = (typeof reportEntities)[number];
type ReportsRailStatus = "verified" | "review" | "stale" | "drafting" | "monitoring";
type ReportsRailItem = {
  icon: string;
  name: string;
  status?: ReportsRailStatus;
  active?: boolean;
};

const reportsRailGroups: Array<{ label: string; count: string; items: ReportsRailItem[] }> = [
  {
    label: "Universes",
    count: "3",
    items: [
      { icon: "◆", name: "AI Infrastructure", active: true },
      { icon: "◆", name: "Banking Targets" },
      { icon: "◆", name: "Fundraise Watch" },
    ],
  },
  {
    label: "Companies",
    count: "5",
    items: [
      { icon: "A", name: "Anthropic", status: "verified" },
      { icon: "O", name: "OpenAI", status: "stale" },
      { icon: "M", name: "Mistral", status: "drafting" },
      { icon: "B", name: "Bug0", status: "verified" },
      { icon: "G", name: "Google DeepMind", status: "stale" },
    ],
  },
  {
    label: "People",
    count: "2",
    items: [
      { icon: "D", name: "Dario Amodei", status: "verified" },
      { icon: "S", name: "Sequoia Capital", status: "review" },
    ],
  },
  {
    label: "Briefs",
    count: "1",
    items: [
      { icon: "D", name: "Daily Brief - May 13", status: "review" },
    ],
  },
  {
    label: "Monitoring",
    count: "1",
    items: [
      { icon: "C", name: "Cohere", status: "monitoring" },
    ],
  },
];

const reportRailFilters: Array<{ id: "all" | ReportsRailStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "review", label: "Review" },
  { id: "stale", label: "Stale" },
  { id: "drafting", label: "Draft" },
];

function getPrototypeEntity(name = "Anthropic"): PrototypeReportEntity {
  return reportEntities.find((entity) => entity.name === name) ?? reportEntities[0];
}

function getReportScore(report: ReportCardData): number {
  const evidence = Math.max(42, Math.min(96, 44 + report.sources * 2 + report.claims));
  const freshness = report.updatedAt.includes("m") || report.updatedAt.includes("h") ? 88 : report.updatedAt.toLowerCase().includes("yesterday") ? 72 : 62;
  const actionability = Math.max(42, Math.min(96, 50 + report.followUps * 8 + (report.status === "review" ? 10 : 0)));
  const graphFit = Math.max(42, Math.min(96, 54 + report.claims * 2 + report.sources));
  return Math.round((evidence + freshness + actionability + graphFit) / 4);
}

function liveReportToPrototypeEntity(report: ReportCardData): PrototypeReportEntity {
  const score = getReportScore(report);
  const status = report.status === "verified" ? "Verified" : report.status === "watching" ? "Watching" : "Needs review";
  const evidence = Math.max(42, Math.min(96, 44 + report.sources * 2 + report.claims));
  const freshness = report.updatedAt.includes("m") || report.updatedAt.includes("h") ? 88 : report.updatedAt.toLowerCase().includes("yesterday") ? 72 : 62;
  const actionability = Math.max(42, Math.min(96, 50 + report.followUps * 8 + (report.status === "review" ? 10 : 0)));
  const graphFit = Math.max(42, Math.min(96, 54 + report.claims * 2 + report.sources));

  return {
    initial: report.entity.slice(0, 1).toUpperCase() || "R",
    name: report.entity,
    status,
    score,
    sources: report.sources,
    delta: `Updated ${report.updatedAt}`,
    kind: `${report.kind} - Live report`,
    body: report.description,
    tags: [report.kind, status, report.followUps > 0 ? "Action needed" : "Current"],
    ref: "Live Convex artifacts - notebook - sources",
    meta: `${report.claims} claims · ${report.sources} sources · ${report.followUps} follow-ups · ${report.updatedAt}`,
    dims: { Sources: evidence, Freshness: freshness, Verification: actionability, Coverage: graphFit },
    signals: [
      report.description,
      `${report.sources} source rows and ${report.claims} claims available`,
      report.followUps > 0 ? `${report.followUps} follow-ups need routing` : "No open follow-up pressure",
    ],
    related: ["People", "Sources", "Similar companies"],
    active: true,
  };
}

type HomeV2QueueItem = [string, string, string, string];

interface HomeV2BriefItem {
  title: string;
  body: string;
  meta?: string;
  status?: string;
  tone?: "default" | "accent" | "blue" | "green" | "amber";
}

interface HomeV2BriefSection {
  eyebrow: string;
  title: string;
  body: string;
  items: HomeV2BriefItem[];
  deck?: string;
  metric?: string;
  layout?: "lead" | "cards" | "compact" | "sources" | "actions";
}

interface HomeV2Introspection {
  kicker: string;
  title: string;
  body: string;
  reflectionTitle: string;
  reflectionBody: string;
  question: string;
  meta: string;
  sourceTitle: string;
  sourceBody: string;
  sourceMeta: string;
  windowTitle: string;
  windowBody: string;
  prompt: string;
}

interface HomeV2Model {
  editionItems: typeof editionItems;
  editionLine: string;
  heroSub: string;
  dailyIntrospection: HomeV2Introspection;
  primaryTitle: string;
  primaryBody: string;
  sweepTitle: string;
  sweepBody: string;
  sweepBullets: string[];
  stats: Array<{ label: string; value: string; tone?: string }>;
  selectedTitle: string;
  selectedBody: string;
  selectedNext: string;
  selectedWhy: string;
  selectedScore: string;
  proofCards: Array<{ title: string; body: string; tag?: string; highlight?: boolean }>;
  queueItems: HomeV2QueueItem[];
  moreLabel: string;
  whatChangedTitle: string;
  whatChangedBody: string;
  dailyBriefEyebrow: string;
  dailyBriefTitle: string;
  dailyBriefSubtitle: string;
  dailyBriefDek: string;
  dailyBriefStats: Array<{ label: string; value: string; hint: string }>;
  dailyBriefSections: HomeV2BriefSection[];
  agentMeta: string;
  agentLead: string;
  agentBody: string;
  agentTrace: string[];
  agentEntities: Array<[string, string, string, string]>;
}

function compact(value: string | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function monogram(value: string): string {
  const words = value.replace(/[^a-zA-Z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "N";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function trimSentence(value: string | undefined, fallback: string, limit = 340): string {
  const text = compact(value, fallback);
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
}

function cleanBriefTitle(value: string | undefined, fallback: string): string {
  return compact(value, fallback)
    .replace(/^Act\s+[IVX]+:\s*/i, "")
    .replace(/^The Morning Dossier\s*[—-]\s*/i, "")
    .trim();
}

function editorialSectionLabel(value: string | undefined, fallback: string): string {
  const title = cleanBriefTitle(value, fallback);
  return /morning dossier|rising action/i.test(title) ? fallback : title;
}

function sourceLabel(value: string | undefined): string {
  const label = compact(value, "source").replace(/^r\//i, "");
  return label.length > 18 ? `${label.slice(0, 17).trim()}...` : label;
}

function isNoisyFirstViewportSource(source: LiveArtifactSourceRow | undefined): boolean {
  const text = `${source?.type ?? ""} ${source?.title ?? ""} ${source?.href ?? ""}`.toLowerCase();
  return /\breddit\b|(^|\s)r\/|discussion on r\//i.test(text);
}

function introspectionSourceTitle(source: LiveArtifactSourceRow | undefined, fallback: string): string {
  if (!source) return fallback;
  if (isNoisyFirstViewportSource(source)) return "A public discussion signal is already captured.";
  return trimSentence(source.title, fallback, 96);
}

function introspectionSourceBody(source: LiveArtifactSourceRow | undefined, fallback: string): string {
  if (!source) return fallback;
  if (isNoisyFirstViewportSource(source)) {
    return "The raw headline stays below the fold as evidence. The useful part is that provenance, reuse count, and review state are ready for the agent to judge.";
  }
  return trimSentence(source.excerpt, fallback, 180);
}

function defaultIntrospection(): HomeV2Introspection {
  return {
    kicker: "Daily introspection",
    title: "One useful thing surfaced while you were not looking.",
    body: "NodeBench turns the morning stream into a small operator check-in: what is starting to drift, what evidence is reusable, and what one action would prevent another tab from becoming background noise.",
    reflectionTitle: "The quiet cost is stale follow-through.",
    reflectionBody: "A useful source is only useful if it changes a report, a note, or a next move. The loss is not missing another headline. It is letting already-found context decay into something you have to re-search later.",
    question: "What should the agent prepare first: a short brief, a notebook patch, or a follow-up you can actually send?",
    meta: "Daily introspection - memory first - source-backed - approval before writes",
    sourceTitle: "Source rows become working material.",
    sourceBody: "Raw news, reports, and public artifacts are kept as evidence. The landing read should be the human consequence and the next decision.",
    sourceMeta: "Prototype packet - public evidence below",
    windowTitle: "Give this 12 minutes.",
    windowBody: "Open the packet with context loaded. The agent can turn it into a brief, notebook patch, or follow-up and ask before any write.",
    prompt: "Use the Daily Introspection packet to identify the quiet cost, summarize the reusable evidence, and prepare the first concrete next action.",
  };
}

function briefItems(
  items: Array<{ label?: string; body?: string; meta?: string; status?: string } | undefined>,
  limit = 3,
): HomeV2BriefItem[] {
  return items
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => ({
      title: compact(item?.label, "Brief item"),
      body: trimSentence(item?.body, "No detail attached yet.", 220),
      meta: item?.meta,
      status: item?.status,
      tone: item?.status === "verified" ? "green" : item?.status === "review" ? "amber" : "default",
    }));
}

function fallbackBriefSections(): HomeV2BriefSection[] {
  return [
    {
      eyebrow: "01 - What changed",
      title: "Waiting for the live Daily Brief artifact",
      deck: "Live memory is still hydrating.",
      body: "NodeBench is loading the Convex-backed daily brief before it ranks changed facts, evidence, affected reports, and next actions.",
      items: [],
      metric: "Loading",
      layout: "lead",
    },
    {
      eyebrow: "02 - Why it matters",
      title: "Impact summary will render from live memory",
      deck: "No unsourced market read is shown while the artifact loads.",
      body: "This section stays explicit while the artifact loads so Home never substitutes fixture analysis for user-facing intelligence.",
      items: [],
      metric: "Memory",
      layout: "compact",
    },
    {
      eyebrow: "03 - Next move",
      title: "Next actions will appear after source-backed synthesis",
      deck: "The brief becomes useful when it tells you what to open, verify, or defer.",
      body: "The live brief decides whether to open a report, verify sources, propose a notebook patch, or create a follow-up.",
      items: [],
      metric: "Queue",
      layout: "actions",
    },
    {
      eyebrow: "04 - Reports touched",
      title: "Reports touched by today's edition",
      deck: "Coverage-book changes will appear here.",
      body: "The live edition lists exact reports affected once Convex returns artifacts.",
      items: [],
      metric: "Reports",
      layout: "cards",
    },
    {
      eyebrow: "05 - Sources used",
      title: "Sources used by the brief",
      deck: "Evidence rows will appear here.",
      body: "Sources are shown as first-class evidence rows instead of hidden behind a summary.",
      items: [],
      metric: "Sources",
      layout: "sources",
    },
    {
      eyebrow: "06 - Actions created",
      title: "Actions created from the brief",
      deck: "Follow-through stays separate from analysis.",
      body: "Follow-ups, notebook patches, and inbox approvals appear here when the agent proposes them.",
      items: [],
      metric: "Actions",
      layout: "actions",
    },
  ];
}

function buildDailyBriefSections(liveArtifacts?: LiveArtifactsResult): {
  eyebrow: string;
  title: string;
  subtitle: string;
  dek: string;
  stats: Array<{ label: string; value: string; hint: string }>;
  sections: HomeV2BriefSection[];
} {
  const detail = liveArtifacts?.details.find((item) => item.kind === "Daily Brief") ?? liveArtifacts?.details[0];
  if (!detail) {
    return {
      eyebrow: "Daily brief",
      title: "Daily Brief loading",
      subtitle: "Waiting for the Convex-backed daily-brief artifact. No fixture brief is being shown.",
      dek: "The brief will resolve into a prioritized read, a reason to care, and concrete next moves.",
      stats: [
        { label: "Reports", value: "0", hint: "loading" },
        { label: "Sources", value: "0", hint: "loading" },
        { label: "Actions", value: "0", hint: "loading" },
      ],
      sections: fallbackBriefSections(),
    };
  }

  const executive = detail.sections[0];
  const signalSection = detail.sections.find((section) => /signal|act ii|what changed/i.test(section.title)) ?? detail.sections[1];
  const actionSection = detail.sections.find((section) => /follow|act iii|next|recommended|to do|review/i.test(section.title));
  const reviewSection = detail.sections.find((section) => /review/i.test(section.title));
  const topSignal = signalSection?.items?.[0] ?? executive?.items?.[0];
  const sourceItems = detail.sourceRows.slice(0, 5).map((source) => ({
    label: source.title,
    body: source.excerpt || `${source.type} refreshed ${source.refreshed}.`,
    meta: `${sourceLabel(source.type)} - ${source.reused}x reused${source.status ? ` - ${source.status}` : ""}`,
    status: source.status,
  }));
  const reportItems = (liveArtifacts?.reports ?? []).slice(0, 5).map((report) => ({
    label: report.entity,
    body: report.description,
    meta: `${report.claims} claims - ${report.sources} sources - ${report.followUps} follow-ups`,
    status: report.status,
  }));
  const actionItems = actionSection?.items?.length
    ? actionSection.items
    : reviewSection?.items?.length
      ? reviewSection.items
      : [{ label: "Promote verified signals", body: detail.primaryAction, meta: `${detail.followUps} follow-ups` }];
  const reportCount = liveArtifacts?.reports.length ?? 0;
  const topReport = liveArtifacts?.reports[0];
  const leadTitle = cleanBriefTitle(topSignal?.label ?? executive?.title ?? detail.title, detail.title);
  const leadBody = trimSentence(topSignal?.body ?? executive?.body ?? detail.summary, detail.summary, 430);
  const sourceCount = detail.sourceRows.length || detail.sourceCount;
  const actionCount = Math.max(detail.followUps, actionItems.length);
  const evidenceLine = `${detail.claimCount} claims, ${sourceCount} source rows, ${reportCount || reportItems.length} reports, ${actionCount} follow-ups.`;

  return {
    eyebrow: "Daily brief",
    title: leadTitle,
    subtitle: `${evidenceLine} Updated ${detail.updatedAt}.`,
    dek: "Read the lead, check the reason it matters to your current queue, then open the affected reports or source rows. No broad prediction is promoted unless it has evidence or a saved follow-up.",
    stats: [
      { label: "Changed", value: String(Math.max(1, liveArtifacts?.briefFeatureCount ?? detail.sections.length)), hint: "signals" },
      { label: "Evidence", value: String(sourceCount), hint: "sources" },
      { label: "Follow-up", value: String(actionCount), hint: "next moves" },
    ],
    sections: [
      {
        eyebrow: "01 - What changed",
        title: leadTitle,
        deck: "The lead item is the highest-ranked changed fact in the live daily brief.",
        body: leadBody,
        items: briefItems([topSignal, ...(executive?.items ?? [])], 3),
        metric: `${detail.claimCount} claims`,
        layout: "lead",
      },
      {
        eyebrow: "02 - Why it matters",
        title: "Why this is worth your time",
        deck: "The agent ranks work by coverage impact, evidence reuse, and next action.",
        body: `${evidenceLine} This item earned the lead slot because it touches saved coverage, has reusable source rows, or creates a concrete follow-up. If it does not affect a report, watchlist, source, or action, it should not lead Home.`,
        items: briefItems(signalSection?.items ?? [], 4),
        metric: `${reportCount || reportItems.length} reports`,
        layout: "compact",
      },
      {
        eyebrow: "03 - Next move",
        title: "Start with the highest-leverage follow-up",
        deck: "Triage: act now, prep later, archive the rest.",
        body: trimSentence(actionSection?.body ?? detail.primaryAction, detail.primaryAction, 420),
        items: briefItems(actionItems, 4),
        metric: `${actionCount} actions`,
        layout: "actions",
      },
      {
        eyebrow: "04 - Reports touched",
        title: `${Math.max(1, reportItems.length)} report${reportItems.length === 1 ? "" : "s"} touched by this edition`,
        deck: "Coverage-book impact, not just news recency.",
        body: "These are the reusable report artifacts Home reads before asking the model to search again.",
        items: briefItems(reportItems, 5),
        metric: `${reportItems.length} shown`,
        layout: "cards",
      },
      {
        eyebrow: "05 - Sources used",
        title: `${detail.sourceCount} source${detail.sourceCount === 1 ? "" : "s"} used by the brief`,
        deck: "Useful daily-read format: headline, provenance, reuse count.",
        body: "The daily brief is backed by source rows that can be opened, verified, or promoted into report evidence.",
        items: briefItems(sourceItems, 5),
        metric: `${sourceCount} rows`,
        layout: "sources",
      },
      {
        eyebrow: "06 - Actions created",
        title: `${detail.followUps} follow-up${detail.followUps === 1 ? "" : "s"} or review item${detail.followUps === 1 ? "" : "s"} created`,
        deck: "The brief ends with workflow, not commentary.",
        body: "Action items stay explicit so the user sees what NodeBench wants to do next and what still needs approval.",
        items: briefItems(actionItems, 5),
        metric: `${actionCount} queued`,
        layout: "actions",
      },
    ],
  };
}

function buildHomeV2Model(liveArtifacts?: LiveArtifactsResult): HomeV2Model {
  const hasLive = Boolean(liveArtifacts?.isLive);
  const dailyBrief = buildDailyBriefSections(liveArtifacts);
  if (!liveArtifacts) {
    return {
      editionItems,
      editionLine: "Sun, May 11 · 4 signals · 7 reports · 12 sources",
      heroSub: "No dashboard theater. Today is only the signals that can change your pipeline. Everything below is supporting evidence.",
      dailyIntrospection: defaultIntrospection(),
      primaryTitle: "Book warm intro / YC AI Ops Co.",
      primaryBody: "Use Wednesday, May 13 at 11:30 AM PT if available. Backup Thursday afternoon or Friday morning. Then move on.",
      sweepTitle: "Public inbox tracker demo",
      sweepBody: "Current sweep reduced the loaded 60-message demo inbox into five operating queues.",
      sweepBullets: [
        "Book the warm intro with YC AI Ops Co first.",
        "Open the remote AI SWE lead and qualify company, role, comp, location.",
        "Ask the operator friend whether the PE/AI lead has budget and role clarity.",
        "Leave the submitted applied-AI role as waiting after submission.",
      ],
      stats: [
        { label: "Must clear", value: "4", tone: "accent" },
        { label: "Prep", value: "7", tone: "blue" },
        { label: "Batch / Defer", value: "42" },
      ],
      selectedTitle: "Warm Intro Lead",
      selectedBody: "Active founder-recruiter lead after Earlier Startup Lead / Insurance AI Co context.",
      selectedNext: "Book Wed Wednesday 11:30 AM.",
      selectedWhy: "This is specific, current, and high enough signal to clear before recruiter batch work.",
      selectedScore: "Verified",
      proofCards: [
        { title: "Pinned match", body: "active thread, calendar-ready, vertical AI", tag: "active thread" },
        { title: "NodeBench proof", body: "Ready for action. 3 public-source signals attached.", tag: "ready" },
        { title: "Calendar preview", body: "Scheduling/deadline logic from dashboard.", tag: "Wed May 13, 11:30 AM PT", highlight: true },
        { title: "Privacy boundary", body: "Public demo only shows synthetic summaries. Raw email body, resume text, and private fit scoring stay local." },
      ],
      queueItems,
      moreLabel: "Show 23 more items",
      whatChangedTitle: "Anthropic raised valuation ceiling; Sequoia counter-bid changes cap table math",
      whatChangedBody: "Two material signals converged overnight that shift the fundraise calculus. Anthropic's updated enterprise pricing model prices the partnership tier above Q1 rates, while Sequoia's revised term sheet introduces a ratchet clause that changes dilution math before the board call.",
      dailyBriefEyebrow: dailyBrief.eyebrow,
      dailyBriefTitle: dailyBrief.title,
      dailyBriefSubtitle: dailyBrief.subtitle,
      dailyBriefDek: dailyBrief.dek,
      dailyBriefStats: dailyBrief.stats,
      dailyBriefSections: dailyBrief.sections,
      agentMeta: "Daily Edition · 4 signals · 7 reports · 12 sources",
      agentLead: "Three items matter most this morning.",
      agentBody: "Anthropic repriced enterprise tier +40% effective June 1, Sequoia added a full-ratchet clause to the Series C term sheet, and SMB churn crossed the 3% threshold for the first time since Q3.",
      agentTrace: ["entity_scan", "signal_rank", "source_verify"],
      agentEntities: [
        ["A", "Anthropic", "Verified", "12 sources"],
        ["S", "Sequoia Capital", "Review", "8 sources"],
        ["B", "Bug0", "", "5 sources"],
        ["O", "OpenAI", "Stale", "4 sources"],
        ["D", "DeepMind", "Stale", "3 sources"],
      ],
    };
  }

  const reports = liveArtifacts.reports;
  const pulse = liveArtifacts.pulse;
  const metrics = liveArtifacts.metrics;
  const publicResearch = liveArtifacts.publicResearch;
  const topReport = reports[0];
  const topPulse = pulse[0];
  const topPublic = publicResearch[0];
  const sourceCount = reports.reduce((total, report) => total + report.sources, 0);
  const liveSummary = liveArtifacts.sourceLabel.replace(/\bartifacts?\b/gi, "signals");
  const statusPrefix = liveArtifacts.isLoading && !hasLive ? "Loading live edition" : hasLive ? "Live edition" : "No live artifacts yet";
  const editionLine = `${statusPrefix} · ${reports.length} reports · ${liveArtifacts.briefFeatureCount} brief signals · ${sourceCount} sources`;
  const actionTitle = compact(
    topPulse?.title ?? topReport?.entity ?? topPublic?.entity,
    liveArtifacts.isLoading ? "Loading today's brief..." : "No live reports returned yet",
  );
  const actionBody = compact(
    topPulse?.body ?? topReport?.description ?? topPublic?.signal,
    liveArtifacts.isLoading
      ? "NodeBench is waiting for Convex-backed archive and daily-brief data before ranking the first action."
      : "Run or refresh a report to populate the first ranked action from live memory.",
  );
  const queueSource = [
    ...pulse.map((card) => ({ title: card.title, next: card.cta ?? "Open brief", meta: card.meta })),
    ...reports.map((report) => ({ title: report.entity, next: "Open report", meta: `${report.sources} sources` })),
  ];
  const liveQueueItems: HomeV2QueueItem[] = queueSource.slice(0, 8).map((item, index) => [
    String(index + 1),
    index < 2 ? "Now" : index < 5 ? "Prep" : "Report",
    compact(item.title, "Untitled live signal"),
    `${compact(item.next, "Review")} ->`,
  ]);
  const liveStats = metrics.slice(0, 3).map((metric, index) => ({
    label: metric.label,
    value: metric.value,
    tone: index === 0 ? "accent" : index === 1 ? "blue" : undefined,
  }));
  const liveEditionItems = [
    ...pulse.map((card, index) => ({
      day: String(Math.max(1, 11 - index)),
      title: index === 0 ? "Today" : compact(card.title, "Live signal").slice(0, 28),
      meta: compact(card.meta, liveSummary),
      body: compact(card.body, card.title).slice(0, 150),
      today: index === 0,
    })),
    ...reports.map((report, index) => ({
      day: String(Math.max(1, 11 - pulse.length - index)),
      title: report.entity.slice(0, 28),
      meta: `${report.sources} sources · ${report.claims} claims`,
      body: compact(report.description, "Live report signal").slice(0, 150),
      today: pulse.length === 0 && index === 0,
    })),
  ].slice(0, 5);
  const liveStatusEditionItems = [
    {
      day: "11",
      title: liveArtifacts.isLoading ? "Loading live brief" : "Live memory status",
      meta: liveArtifacts.isLoading ? "Convex query in flight" : "No public artifacts returned",
      body: actionBody,
      today: true,
    },
    {
      day: "10",
      title: "Memory first",
      meta: `${reports.length} reports`,
      body: "The agent checks reusable report memory before asking for new research.",
    },
    {
      day: "9",
      title: "Source-backed",
      meta: `${sourceCount} sources`,
      body: "Claims stay tied to source rows or remain marked for review.",
    },
    {
      day: "8",
      title: "Report handoff",
      meta: `${liveArtifacts.briefFeatureCount} signals`,
      body: "Brief items are framed as report updates, notebook patches, or follow-up work.",
    },
    {
      day: "7",
      title: "Private boundary",
      meta: "Public pulse only",
      body: "Private captures are intentionally kept out of the public home brief.",
    },
  ];
  const entityRows = reports.slice(0, 5).map((report) => [
    monogram(report.entity),
    report.entity,
    report.status === "verified" ? "Verified" : report.status === "review" ? "Review" : "",
    `${report.sources} sources`,
  ] as [string, string, string, string]);
  const sweepBullets = queueSource.slice(0, 4).map((item) => `${compact(item.next, "Review")} ${compact(item.title, "live signal")}.`);
  const fallbackStats = liveArtifacts.isLoading
    ? [
        { label: "Live status", value: "Loading", tone: "accent" },
        { label: "Reports", value: String(reports.length), tone: "blue" },
        { label: "Sources", value: String(sourceCount) },
      ]
    : [
        { label: "Live status", value: "Empty", tone: "accent" },
        { label: "Reports", value: "0", tone: "blue" },
        { label: "Sources", value: "0" },
      ];
  const topSource = liveArtifacts.details
    .flatMap((detail) => detail.sourceRows)
    .find((source) => compact(source.title || source.excerpt, "").length > 0);
  const followUpTotal = reports.reduce((total, report) => total + report.followUps, 0);
  const changedSignalCount = Math.max(liveArtifacts.briefFeatureCount, pulse.length, reports.length);
  const sourceReviewState = typeof topSource?.confidence === "number"
    ? topSource.confidence >= 0.82 ? "verified source row" : "needs review"
    : "review pending";
  const liveIntrospection: HomeV2Introspection = {
    kicker: "Daily introspection",
    title: "One useful thing surfaced while you were not looking.",
    body: hasLive
      ? `NodeBench found ${changedSignalCount} changed signal${changedSignalCount === 1 ? "" : "s"}, ${reports.length} report handle${reports.length === 1 ? "" : "s"}, and ${sourceCount} reusable source row${sourceCount === 1 ? "" : "s"}. The point is not to read the feed. It is to notice what is already prepared before it becomes background noise.`
      : liveArtifacts.isLoading
        ? "NodeBench is loading the live artifact packet before it shows a nudge. It will not replace missing memory with a fake headline."
        : "NodeBench has the live path connected, but no public artifact packet returned yet. The useful move is to run a brief or report workflow and let the agent attach evidence before it asks you to act.",
    reflectionTitle: hasLive ? "The quiet cost is stale follow-through." : "The quiet cost is an empty packet.",
    reflectionBody: hasLive
      ? `There are ${followUpTotal} follow-up${followUpTotal === 1 ? "" : "s"} and ${reports.length} touched report${reports.length === 1 ? "" : "s"} available. If none of them becomes a note, patch, or reply, tomorrow starts by re-searching what the system already found.`
      : "When the packet is empty, the product should say that plainly and route the user to create the first reusable artifact.",
    question: hasLive
      ? "What should the agent prepare first: a short brief, a notebook patch, or a follow-up you can actually send?"
      : "What should the agent create first: a report seed, a source pack, or a follow-up queue?",
    meta: `Daily introspection - ${changedSignalCount} signals - ${reports.length} reports - ${sourceCount} sources - ${followUpTotal} follow-ups`,
    sourceTitle: introspectionSourceTitle(topSource, topReport?.entity ?? "A reusable source row is ready."),
    sourceBody: introspectionSourceBody(
      topSource,
      topReport?.description ?? "Source-backed evidence will appear here once a live report, daily brief, or public archive row returns.",
    ),
    sourceMeta: topSource
      ? `${sourceLabel(topSource.type)} - ${topSource.reused} reuses - ${sourceReviewState}`
      : hasLive
        ? "No source row attached to the top packet"
        : "Waiting for live evidence",
    windowTitle: hasLive ? "Give this 12 minutes." : "Start with one packet.",
    windowBody: hasLive
      ? "Open Chat with the context loaded. The agent can turn this into a brief, notebook patch, or follow-up and ask before any write."
      : "Create or refresh one report so the next landing read starts from memory instead of a blank state.",
    prompt: hasLive
      ? `Use the Daily Introspection packet from Home. Identify the quiet cost, summarize reusable evidence from ${reports.length} touched reports and ${sourceCount} source rows, then prepare the first concrete next action without writing externally unless I approve.`
      : "Create the first Daily Introspection packet by finding a report seed, reusable source pack, and one next action. Do not fabricate live evidence.",
  };

  return {
    editionItems: liveEditionItems.length > 0 ? liveEditionItems : liveStatusEditionItems,
    editionLine,
    heroSub: hasLive
      ? "A source-backed brief ranks what changed, why it matters, and which reports need attention now."
      : "NodeBench is connected to the live memory path. This view stays explicit while Convex returns data instead of masking the state with fixture content.",
    dailyIntrospection: liveIntrospection,
    primaryTitle: actionTitle,
    primaryBody: actionBody,
    sweepTitle: hasLive ? "Live intelligence sweep" : liveArtifacts.isLoading ? "Loading live intelligence sweep" : "No live intelligence sweep yet",
    sweepBody: hasLive
      ? liveSummary
      : liveArtifacts.isLoading
        ? "Waiting for Convex-backed archive stats and latest daily brief memory."
        : "No Convex-backed public artifacts were returned for this session.",
    sweepBullets: sweepBullets.length > 0 ? sweepBullets : [
      liveArtifacts.isLoading ? "Load archive posts from Convex." : "Run a research or daily brief workflow to create the first signal.",
      "Keep private captures out of the public pulse.",
      "Return an explicit empty state rather than a fixture dashboard.",
    ],
    stats: liveStats.length > 0 ? liveStats : fallbackStats,
    selectedTitle: topReport?.entity ?? actionTitle,
    selectedBody: topReport?.description ?? actionBody,
    selectedNext: topPulse?.cta ?? (topReport ? "Open the live report." : "Wait for live artifacts or run a new report."),
    selectedWhy: topReport
      ? `${topReport.sources} sources, ${topReport.claims} claims, ${topReport.followUps} follow-ups.`
      : "This card is driven by the live memory hook state, not static starter data.",
    selectedScore: hasLive ? "live" : liveArtifacts.isLoading ? "loading" : "empty",
    proofCards: [
      { title: "Live source", body: liveSummary, tag: hasLive ? "Convex-backed" : liveArtifacts.isLoading ? "loading" : "empty", highlight: hasLive },
      { title: "Reports touched", body: `${reports.length} live reports available.`, tag: `${reports.length} reports` },
      { title: "Sources reused", body: `${sourceCount} source references available from current signals.`, tag: `${sourceCount} sources`, highlight: sourceCount > 0 },
      { title: "Privacy boundary", body: "Home reads public archive and daily brief memory; private captures remain outside the public pulse." },
    ],
    queueItems: liveQueueItems.length > 0 ? liveQueueItems : [["1", "Now", actionTitle, "Refresh ->"]],
    moreLabel: hasLive ? `Show ${Math.max(0, reports.length + pulse.length - 8)} more items` : "Show live memory status",
    whatChangedTitle: topPulse?.title ?? topReport?.entity ?? "Live memory state",
    whatChangedBody: topPulse?.body ?? topReport?.description ?? actionBody,
    dailyBriefEyebrow: dailyBrief.eyebrow,
    dailyBriefTitle: dailyBrief.title,
    dailyBriefSubtitle: dailyBrief.subtitle,
    dailyBriefDek: dailyBrief.dek,
    dailyBriefStats: dailyBrief.stats,
    dailyBriefSections: dailyBrief.sections,
    agentMeta: editionLine,
    agentLead: hasLive ? "Agent work packet ready." : liveArtifacts.isLoading ? "Loading live memory now." : "No live reports returned yet.",
    agentBody: hasLive
      ? `${reports.length} reports matched, ${sourceCount} source rows reused, ${liveArtifacts.briefFeatureCount} signals ranked, and ${reports.reduce((total, report) => total + report.followUps, 0)} follow-ups queued. Ask it to brief, patch a notebook, or open a touched report.`
      : liveArtifacts.isLoading
        ? "The briefing rail is waiting for Convex-backed archive and daily brief queries."
        : "Run a report, daily brief, or archive-backed workflow to populate this rail.",
    agentTrace: hasLive ? ["memory_search", "report_match", "source_reuse", "handoff_ready"] : ["convex_query", "empty_state", "no_fixture_fallback"],
    agentEntities: entityRows.length > 0 ? entityRows : [["N", "No live report", liveArtifacts.isLoading ? "Loading" : "Empty", "0"]],
  };
}

const chatCheckpoints = [
  ["✓", "Searching memory"],
  ["✓", "Found existing report"],
  ["✓", "Checking source cache"],
  ["✓", "Analyzing cap table model"],
  ["•", "Updating notebook"],
  ["○", "2 claims need review"],
];

const inboxRows = [
  ["Requires action", "Sequoia - Revised term sheet v3", "Alfred Lin · New ratchet clause requires legal review", "2h", "Due Wed", true],
  ["Requires action", "Anthropic - Enterprise pricing update", "Partnership team · Managed Agent tier +40%, effective June 1", "5h", "Today"],
  ["Requires action", "Board meeting - Agenda review", "CFO · Q2 financials deck needs sign-off", "6h", "Due Thu"],
  ["Requires action", "Customer escalation - Acme Corp", "CS team · Enterprise renewal at risk, competitor pricing cited", "8h", "Overdue"],
  ["To read", "Weekly engineering standup notes", "Platform team · Infrastructure migration 80% complete", "1d", ""],
  ["To read", "Competitor - Bug0 pricing drop", "Market intel · Enterprise tier now $199/seat, down from $349", "1d", ""],
  ["To read", "Monthly investor update - Draft review", "CFO · ARR narrative needs your input before send", "2d", ""],
  ["Waiting on others", "USPTO - Patent acknowledgement", "Filing 17/892,341 · Est. 14-month review period", "3d", "14 mo"],
  ["Waiting on others", "Counsel - Redline turnaround", "Legal team · Waiting for anti-dilution comments", "4d", ""],
  ["Waiting on others", "Partner intro - YC AI Ops Co.", "Warm intro sent · no reply yet", "5d", ""],
  ["Filed", "Stripe renewal note", "Sales ops · Filed after ARR sync", "6d", ""],
];

function requestHomeV2Share(
  channel: "email" | "linkedin" | "slack",
  onAsk?: (prompt: string, context?: HomeAskContext) => void,
) {
  const promptByChannel = {
    email: "Draft an email digest from today's agent brief. Keep it source-backed, concise, and action-oriented.",
    linkedin: "Draft a LinkedIn-ready summary from today's agent brief. Keep claims grounded and mark anything that needs approval before posting.",
    slack: "Draft a Slack update from today's agent brief with what changed, report impact, evidence, and asks.",
  };
  onAsk?.(promptByChannel[channel]);
}

async function copyHomeV2ShareLink() {
  const url = typeof window === "undefined"
    ? "/redesign"
    : `${window.location.origin}/redesign?edition=1`;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      showToast({ tone: "success", message: "Copied the Daily Brief link." });
      return;
    }
    showToast({ tone: "info", message: `Copy this link: ${url}` });
  } catch {
    showToast({ tone: "warning", message: `Clipboard blocked. Copy this link: ${url}` });
  }
}

function openHomeV2PrintView() {
  if (typeof window === "undefined") return;
  const child = window.open("/redesign/edition/print?id=home-v2-agent-brief", "_blank", "noopener,noreferrer");
  if (!child) {
    showToast({ tone: "warning", message: "Popup blocked. Open the print view from the browser menu." });
  }
}

function HomeV2ShareBar({ onAsk, pulse = false }: { onAsk?: (prompt: string, context?: HomeAskContext) => void; pulse?: boolean }) {
  return (
    <div className={`rd-v2-share-bar${pulse ? " rd-v2-share-bar--pulse" : ""}`} aria-label="Share edition">
      <span>Share</span>
      <button type="button" className="rd-v2-share-primary" onClick={() => requestHomeV2Share("email", onAsk)}>Email digest</button>
      <button type="button" onClick={() => requestHomeV2Share("linkedin", onAsk)}>LinkedIn</button>
      <button type="button" onClick={() => requestHomeV2Share("slack", onAsk)}>Slack</button>
      <button type="button" onClick={() => void copyHomeV2ShareLink()}>Copy link</button>
      <button type="button" onClick={openHomeV2PrintView}>PDF</button>
    </div>
  );
}

const inboxSourceByTitle = {
  "Customer escalation - Acme Corp": ["slack", "☁"],
  "Weekly engineering standup notes": ["doc", "▤"],
  "Competitor - Bug0 pricing drop": ["alert", "△"],
} as const;

const meLines = [
  ["# USER.md", ""],
  ["## Identity", ""],
  ["name:", "Homen Shum"],
  ["role:", "Founder · Builder-analyst hybrid"],
  ["background:", "Banking/finance + data engineering + agentic AI + product/UI"],
  ["edge:", "Context ingestion -> structure -> execution"],
  ["## Decision style", ""],
  ["bias:", "Action over analysis. Ship -> measure -> iterate."],
  ["anti-pattern:", "Perfectionism disguised as rigor"],
  ["reset-trigger:", "Spiraling, stuck choosing, doomscrolling"],
  ["reset-action:", "Smallest bet, 7-day timebox, kill criteria, output"],
  ["## Communication", ""],
  ["style:", "Direct, tactical, specific. Push back when rationalizing."],
  ["format:", "Decision -> Why -> Plan -> Risks -> Deliverable"],
  ["no:", "Fluff. Motivational speech. Restating questions."],
  ["## Agent corrections", ""],
  ["# 23 corrections logged. Most recent:", ""],
  ["2026-05-10:", "\"Don't summarize what you just did - I can read the diff\""],
  ["2026-05-08:", "\"Interweave before execute on non-trivial tasks\""],
];

export function PrototypeV2LeftRail({ surface, onAsk, selectedEntity = "Anthropic", onSelectEntity, guestSafe = false }: { surface: PrototypeSurface } & PrototypeSelectionProps) {
  const [reportsRailQuery, setReportsRailQuery] = useState("");
  const [reportsRailFilter, setReportsRailFilter] = useState<(typeof reportRailFilters)[number]["id"]>("all");
  if (surface === "home") return <HomeV2EditionRail onAsk={onAsk} />;
  if (surface === "reports") {
    const query = reportsRailQuery.trim().toLowerCase();
    const filteredGroups = reportsRailGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const matchesQuery = !query || `${group.label} ${item.name}`.toLowerCase().includes(query);
          const matchesStatus = reportsRailFilter === "all" || item.status === reportsRailFilter;
          return matchesQuery && matchesStatus;
        }),
      }))
      .filter((group) => group.items.length > 0);
    return (
      <aside className="rd-v2-left left-rail" aria-label="Entity navigation">
        <div className="lr-search">
          <div className="lr-search-wrap">
            <span className="lr-search-icon" aria-hidden="true">⌕</span>
            <input
              className="lr-search-input"
              placeholder="Search reports..."
              aria-label="Search reports"
              value={reportsRailQuery}
              onChange={(event) => setReportsRailQuery(event.currentTarget.value)}
            />
          </div>
        </div>
        <div className="lr-filters" role="tablist" aria-label="Filter reports by status">
          {reportRailFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={reportsRailFilter === filter.id}
              className={`lr-filter ${reportsRailFilter === filter.id ? "active" : ""}`}
              data-filter={filter.id}
              onClick={() => setReportsRailFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="lr-body">
          {filteredGroups.map((group) => (
            <ReportsV3RailGroup
              key={group.label}
              label={group.label}
              count={group.count}
              items={group.items}
              selectedName={selectedEntity}
              onSelectItem={onSelectEntity}
            />
          ))}
          {filteredGroups.length === 0 && <div className="rd-v2-rail-empty">No reports match this filter.</div>}
        </div>
        <div className="lr-footer">
          <button type="button" onClick={() => onAsk?.("Create a new report entity and hydrate its first notebook.")}>+ Entity</button>
          <button type="button" onClick={() => onAsk?.("Import a company list and run a sample coverage batch.")}>+ Import</button>
        </div>
      </aside>
    );
  }
  if (surface === "chat") {
    return (
      <aside className="rd-v2-left rd-v2-left--nav" aria-label="Chat threads">
        <button className="rd-v2-new-thread">+ New thread</button>
        <div className="rd-v2-rail-rule" />
        <ChatThreadGroup label="Today" items={[
          ["Sequoia ratch...", "Under a 40% do...", "2m", true],
          ["Anthropic pric...", "Enterprise tier mo...", "1h"],
          ["SMB churn in...", "Monthly churn hit...", "3h"],
        ]} />
        <ChatThreadGroup label="Yesterday" items={[
          ["Board deck prep", "Q2 financials proj...", "1d"],
          ["Patent filing fo...", "USPTO acknowle...", "1d"],
        ]} />
        <ChatThreadGroup label="This week" items={[
          ["Hiring pipelin...", "4 senior engine...", "3d"],
          ["NPS survey a...", "340 responses, o...", "4d"],
        ]} />
      </aside>
    );
  }
  if (surface === "inbox") {
    return (
      <aside className="rd-v2-left rd-v2-left--nav" aria-label="Inbox navigation">
        <input className="rd-v2-rail-search" placeholder="Search inbox..." aria-label="Search inbox" />
        <div className="rd-v2-rail-rule" />
        <NavItem label="All items" count="53" active marker="★" />
        <NavItem label="Act" count="4" marker="●" />
        <NavItem label="Read" count="12" marker="●" tone="blue" />
        <NavItem label="Waiting" count="8" marker="●" tone="amber" />
        <NavItem label="Filed" count="24" marker="●" tone="muted" />
        <NavItem label="Delete" count="5" marker="●" tone="red" />
        <div className="rd-v2-rail-rule" />
        <RailGroup label="Sources" count="" items={[
          ["✉", "Email", "31"],
          ["☁", "Slack", "14"],
          ["▣", "Docs", "5"],
          ["⚠", "Alerts", "3"],
        ]} />
        <div className="rd-v2-keyboard-help">Keyboard: <kbd>j</kbd> <kbd>k</kbd> navigate · <kbd>a</kbd> act · <kbd>d</kbd> delete</div>
      </aside>
    );
  }
  return (
    <aside className="rd-v2-left rd-v2-left--nav" aria-label="Me navigation">
      <div className="rd-v2-profile-mini">
        <span>{guestSafe ? "P" : "HS"}</span>
        <div><strong>{guestSafe ? "Private profile" : "Homen Shum"}</strong><p>{guestSafe ? "Sign in to sync" : "Founder · Builder"}</p></div>
      </div>
      <div className="rd-v2-rail-rule" />
      <NavItem label="Identity" active marker="🧠" />
      <NavItem label="Preferences" marker="⚙" />
      <NavItem label="Integrations" marker="🔗" />
      <NavItem label="Permissions" marker="🔒" />
      <NavItem label="Style profile" marker="🎨" />
      <div className="rd-v2-rail-rule" />
      <div className="rd-v2-memory-stats">
        <div><span>Observations</span><strong>{guestSafe ? "Locked" : "847"}</strong></div>
        <div><span>Corrections</span><strong>{guestSafe ? "Locked" : "23"}</strong></div>
        <div><span>Last updated</span><strong>{guestSafe ? "After sign-in" : "2m ago"}</strong></div>
      </div>
      <button className="rd-v2-sign-out">{guestSafe ? "Sign in" : "Sign out"}</button>
    </aside>
  );
}

export function PrototypeV2Center({ surface, onAsk, selectedEntity = "Anthropic", onSelectEntity }: { surface: PrototypeSurface } & PrototypeSelectionProps) {
  if (surface === "home") return <HomeV2Surface onAsk={onAsk} onOpenReports={() => onAsk?.("Open the reports touched by today's agent brief.")} />;
  if (surface === "reports") return <ReportsPrototypeCenter selectedEntity={selectedEntity} onSelectEntity={onSelectEntity} />;
  if (surface === "chat") return <ChatPrototypeCenter />;
  if (surface === "inbox") return <InboxPrototypeCenter />;
  return <MePrototypeCenter />;
}

export function PrototypeV2RightRail({ surface, onAsk, selectedEntity = "Anthropic", selectedReport, onSelectEntity, guestSafe = false }: { surface: PrototypeSurface } & PrototypeSelectionProps) {
  if (surface === "home") return <HomeV2BriefingRail onAsk={onAsk} onOpenReports={() => onAsk?.("Open the reports touched by today's agent brief.")} />;
  if (surface === "reports") return <ReportsPrototypeRail onAsk={onAsk} selectedEntity={selectedEntity} selectedReport={selectedReport} onSelectEntity={onSelectEntity} />;
  if (surface === "chat") return <ChatPrototypeRail />;
  if (surface === "inbox") return <InboxPrototypeRail onAsk={onAsk} />;
  return <MePrototypeRail onAsk={onAsk} guestSafe={guestSafe} />;
}

function RailGroup({
  label,
  count,
  items,
  selectedName,
  onSelectItem,
}: {
  label: string;
  count: string;
  items: Array<[string, string, string?, boolean?]>;
  selectedName?: string;
  onSelectItem?: (name: string) => void;
}) {
  return (
    <section className="rd-v2-rail-section">
      <div className="rd-v2-rail-section-head"><span>{label}</span><b>{count}</b></div>
      {items.map(([icon, name, itemCount, active]) => (
        <button
          key={name}
          className={`rd-v2-nav-row ${active || selectedName === name ? "is-active" : ""}`}
          type="button"
          onClick={() => onSelectItem?.(name)}
        >
          <span>{icon}</span>
          <strong>{name}</strong>
          {itemCount && <b>{itemCount}</b>}
        </button>
      ))}
    </section>
  );
}

function ReportsRailGroup({
  label,
  count,
  items,
  selectedName,
  onSelectItem,
}: {
  label: string;
  count: string;
  items: ReportsRailItem[];
  selectedName?: string;
  onSelectItem?: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className={`rd-v2-rail-section rd-v2-rail-section--reports ${collapsed ? "is-collapsed" : ""}`}>
      <button
        type="button"
        className="rd-v2-rail-section-head rd-v2-rail-section-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="rd-v2-rail-chevron">{collapsed ? "\u25b8" : "\u25be"}</span>
        <span>{label}</span>
        <b>{count}</b>
      </button>
      {!collapsed && items.map((item) => {
        const selected = selectedName ? selectedName === item.name : item.active;
        return (
          <button
            key={`${label}-${item.name}`}
            className={`rd-v2-nav-row rd-v2-report-nav-row ${selected ? "is-active" : ""}`}
            type="button"
            data-status={item.status}
            onClick={() => onSelectItem?.(item.name)}
          >
            <span className="rd-v2-report-nav-icon">{item.icon}</span>
            <strong>{item.name}</strong>
            {item.status && <i aria-label={item.status} className="rd-v2-report-nav-dot" data-status={item.status} />}
          </button>
        );
      })}
    </section>
  );
}

function NavItem({ label, count, marker, active, tone }: { label: string; count?: string; marker: string; active?: boolean; tone?: string }) {
  return (
    <button type="button" className={`rd-v2-nav-row ${active ? "is-active" : ""}`} data-tone={tone}>
      <span>{marker}</span>
      <strong>{label}</strong>
      {count && <b>{count}</b>}
    </button>
  );
}

function ChatThreadGroup({ label, items }: { label: string; items: Array<[string, string, string, boolean?]> }) {
  return (
    <section className="rd-v2-rail-section">
      <div className="rd-v2-rail-section-head"><span>{label}</span></div>
      {items.map(([title, preview, time, active]) => (
        <button key={`${label}-${title}`} type="button" className={`rd-v2-thread-row ${active ? "is-active" : ""}`}>
          <span className={active ? "is-live" : ""} />
          <div><strong>{title}</strong><p>{preview}</p></div>
          <b>{time}</b>
        </button>
      ))}
    </section>
  );
}

function ReportsPrototypeCenter({ selectedEntity = "Anthropic", onSelectEntity }: PrototypeSelectionProps) {
  return (
    <div className="rd-v2-proto-center rd-v3-reports">
      <div className="rd-v3-universe-header">
        <div>
          <div className="rd-v3-kicker">Reports</div>
          <h1>AI Infrastructure Coverage</h1>
          <p>87 reports, 312 sources, 18 need review.</p>
        </div>
        <div className="rd-v3-universe-actions">
          <button type="button">Review queue</button>
          <button type="button" className="rd-v3-primary">+ New batch</button>
        </div>
      </div>
      <section className="rd-v3-metrics" aria-label="Coverage metrics">
        <span><strong>87</strong> reports</span>
        <span><strong>83%</strong> verified</span>
        <span><strong>7</strong> need review</span>
        <span><strong>3</strong> active runs</span>
        <span><strong>12</strong> notebook patches</span>
      </section>
      <div className="rd-v3-tabs" role="tablist" aria-label="Report views">
        {["Gallery", "Board", "Table", "Graph"].map((item, index) => (
          <button key={item} type="button" role="tab" aria-selected={index === 0} className={index === 0 ? "is-active" : ""}>{item}</button>
        ))}
      </div>
      <div className="rd-v2-edition-row">
        <span className="rd-v2-edition-pill">Entity intelligence</span>
        <span className="rd-v2-edition-subline">12 entities · 83% verified · 48 sources · 7 notebook patches</span>
      </div>
      <div className="rd-v2-filter-row">
        {["All", "Watching", "Needs review", "Stale", "Updated"].map((item, index) => (
          <button key={item} className={index === 0 ? "is-active" : ""}>{item}</button>
        ))}
        <button>Tags ▾</button>
      </div>
      <div className="rd-v2-action-row">
        <button>Updated ▾</button>
        <button>● Privacy</button>
        <button className="rd-v2-btn-primary">+ New report</button>
      </div>
      <div className="rd-v2-report-grid">
        {reportEntities.map((entity) => (
          <article
            key={entity.name}
            className={`rd-v2-report-card ${selectedEntity === entity.name ? "is-active" : ""}`}
            onClick={() => onSelectEntity?.(entity.name)}
            aria-selected={selectedEntity === entity.name}
          >
            <div className="rd-v2-report-title">
              <span>{entity.initial}</span>
              <h2>{entity.name}</h2>
              <b data-state={entity.status}>{entity.status}</b>
            </div>
            <p className="rd-v2-report-kind">{entity.kind}</p>
            <p>{entity.body}</p>
            <div className="rd-v2-report-tags">
              {entity.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <p className="rd-v2-report-ref">Referenced in: {entity.ref}</p>
            <p className="rd-v2-report-meta">{entity.meta}</p>
          </article>
        ))}
        <article className="rd-v2-report-card rd-v2-report-card--add">
          <h2>Add entity</h2>
          <p>Capture a company, person, topic, or source cluster and let the coverage agent hydrate the first report.</p>
          <button>+ New entity</button>
        </article>
      </div>
      <button className="rd-v2-show-more">Show 7 more entities</button>
    </div>
  );
}

function ChatPrototypeCenter() {
  return (
    <div className="rd-v2-proto-center rd-v2-chat-center">
      <div className="rd-v2-saved-banner">
        <strong>✓ Saved to Sequoia Capital — term sheet analysis</strong>
        <span>3 sections · 7 claims · 2 sources · notebook synced</span>
        <button>Open notebook</button><button>Export</button><button>Track updates</button>
      </div>
      <h1>Sequoia ratchet analysis</h1>
      <p className="rd-v2-muted-line">Started 2 minutes ago · 3 messages · opus-4</p>
      <div className="rd-v2-checkpoints">
        {chatCheckpoints.map(([mark, label]) => (
          <div key={label} data-active={label === "Updating notebook"}>
            <span>{mark}</span><strong>{label}</strong>
          </div>
        ))}
      </div>
      <article className="rd-v2-answer">
        <span>Agent · Analysis</span>
        <h3>Short answer</h3>
        <p>Under a 40% down-round scenario ($48M), the <mark>full-ratchet</mark> clause would result in 19.1% additional dilution compared to 4.8% under the <mark>weighted-average</mark> mechanism. That is a 14.3 percentage point gap.</p>
        <h3>Why this matters</h3>
        <p>At $48M valuation, founders go from 62% to approximately 48% ownership under full-ratchet. The weighted-average clause would preserve roughly 57%.</p>
        <h3>Evidence</h3>
        <table className="rd-v2-evidence-table">
          <thead><tr><th>Scenario</th><th>Founder dilution</th><th>Source</th></tr></thead>
          <tbody>
            <tr><td>Full-ratchet</td><td>19.1%</td><td>cap_table_model</td></tr>
            <tr><td>Weighted-average</td><td>4.8%</td><td>dilution_calc</td></tr>
            <tr><td>Negotiation gap</td><td>14.3pp</td><td>term_sheet_v3</td></tr>
          </tbody>
        </table>
        <h3>Risks and open questions</h3>
        <p>Board observer rights and pro-rata language are still pending verification. Treat the model result as decision support until counsel validates the clause language.</p>
        <h3>Next action</h3>
        <p>Draft a counterproposal that uses narrow-based weighted-average as the fallback floor and flags the board call deadline.</p>
      </article>
      <div className="rd-v2-context-chips">
        <span>Sequoia Capital ×</span><span>Report: Term Sheet Analysis ×</span><span>Sources: 2 ×</span><span>Balanced</span>
      </div>
      <div className="rd-v2-tool-strip">
        <span>opus-4</span><span>cap_table_model</span><span>dilution_calc</span><span>2 sources</span><span>1.2s</span><span>$0.05</span>
      </div>
      <div className="rd-v2-next-actions">
        {["Open notebook", "Draft counterproposal", "Verify open claims", "Attach term sheet", "Share summary"].map((action) => (
          <button key={action}>{action}</button>
        ))}
      </div>
      <article className="rd-v2-user-followup">
        <strong>You</strong>
        <p>Draft the counterproposal and mark counsel review as approval-required.</p>
      </article>
      <article className="rd-v2-streaming-draft">
        <span>Drafting</span>
        <p>Counterproposal packet: narrow-based weighted-average floor, board observer carve-out, counsel review task, and report notebook patch.</p>
      </article>
      <div className="rd-v2-bottom-composer">
        <input placeholder="Ask, capture, paste, upload, or record..." aria-label="Chat input" />
        <button>↑</button>
        <div className="rd-v2-composer-tools"><span>+ Context</span><span>@ Reference</span><span>/ Command</span><span>Attach</span><span>Record</span></div>
      </div>
    </div>
  );
}

function InboxPrototypeCenter() {
  return (
    <div className="rd-v2-proto-center rd-v2-inbox-center">
      <div className="rd-v2-inbox-head">
        <h1>Inbox</h1>
        <span>53 items · 4 need action</span>
        <button>Mark all read</button>
        <button className="rd-v2-btn-primary">Auto-triage</button>
      </div>
      {["Requires action", "To read", "Waiting on others", "Filed"].map((group) => (
        <section key={group} className="rd-v2-inbox-group">
          <div className="rd-v2-inbox-group-head"><span>{group}</span><b>{group === "Requires action" ? "4" : group === "To read" ? "12" : group === "Waiting on others" ? "8" : "24"}</b></div>
          {inboxRows.filter((row) => row[0] === group).map(([, title, sub, time, badge, active]) => (
            <article key={title} className={active ? "is-active" : ""}>
              <span className="rd-v2-source-icon" data-source={inboxSourceByTitle[title as keyof typeof inboxSourceByTitle]?.[0] ?? "email"}>
                {inboxSourceByTitle[title as keyof typeof inboxSourceByTitle]?.[1] ?? "✉"}
              </span>
              <div>
                <span className="rd-v2-inbox-title-row">
                  {active && <i />}
                  <strong>{title}</strong>
                </span>
                <p>{sub}</p>
              </div>
              <time>{time}</time>
              {badge && <b>{badge}</b>}
            </article>
          ))}
        </section>
      ))}
      <button className="rd-v2-show-more">Show 38 more items</button>
    </div>
  );
}

function MePrototypeCenter() {
  return (
    <div className="rd-v2-proto-center rd-v2-me-center">
      <div className="rd-v2-edition-row">
        <span className="rd-v2-edition-pill">USER.md</span>
        <span className="rd-v2-edition-subline">Your identity file · last edited 12m ago</span>
      </div>
      <div className="rd-v2-share-bar"><span>Actions</span><button className="rd-v2-share-primary">Edit</button><button>Export</button><button>Reset</button></div>
      <article className="rd-v2-user-md">
        {meLines.map(([key, value], index) => (
          key.startsWith("#") ? <h2 key={`${key}-${index}`}>{key}</h2> : (
            <p key={`${key}-${index}`}>
              <span>{key}</span>{value}
            </p>
          )
        ))}
      </article>
      <section className="rd-v2-integrations-grid">
        {[
          ["GitHub", "Connected", "12 repos indexed"],
          ["Convex", "Connected", "agile-caribou prod"],
          ["LinkedIn", "Approval required", "Posting gated"],
          ["Slack", "Connected", "Daily digest enabled"],
        ].map(([name, status, detail]) => (
          <article key={name}>
            <strong>{name}</strong>
            <span>{status}</span>
            <p>{detail}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function AgentShell({
  title,
  context,
  pills,
  question,
  children,
  placeholder,
  onAsk,
}: {
  title: string;
  context: string;
  pills: string[];
  question: string;
  children: ReactNode;
  placeholder: string;
  onAsk?: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pillClassName = (_pill: string, index: number) => {
    const classes = ["rd-v2-agent-pill"];
    if (index === 0) classes.push("is-active");
    if (title === "Coverage agent" || title === "Agent Inspector") {
      if (index === 1) classes.push("is-entity");
      if (index === 2) classes.push("is-source");
    }
    if (title === "Triage agent" && index === 1) classes.push("is-entity");
    return classes.join(" ");
  };

  return (
    <aside className="rd-pane rd-pane--right rd-v2-briefing" aria-label={title} data-width={expanded ? "expanded" : undefined}>
      <header className="rd-v2-agent-head">
        <div className="rd-v2-agent-head-row">
          <span className="rd-v2-agent-dot" />
          <strong>{title}</strong>
          <button type="button" aria-label={expanded ? "Collapse rail" : "Expand rail"} onClick={() => setExpanded(e => !e)}>{expanded ? "\u2921" : "\u2922"}</button>
        </div>
        <p>{context}</p>
      </header>
      <div className="rd-v2-agent-pills">
        {pills.map((pill, index) => <span key={pill} className={pillClassName(pill, index)}>{pill}</span>)}
      </div>
      <div className="rd-v2-agent-thread">
        <div className="rd-v2-msg rd-v2-msg-user">{question}</div>
        {children}
      </div>
      <footer className="rd-v2-agent-composer">
        <input placeholder={placeholder} onKeyDown={(event) => {
          if (event.key === "Enter") onAsk?.((event.currentTarget as HTMLInputElement).value);
        }} />
        <button type="button" onClick={() => onAsk?.(question)}>{"\u2191"}</button>
        <div className="rd-v2-agent-tools">
          <span>+ Context</span><span>@ Reference</span><span>/ Command</span><span>Attach</span><span>to send</span>
        </div>
      </footer>
    </aside>
  );
}

function inspectorPipeline(entity: PrototypeReportEntity): Array<{ label: string; done: boolean }> {
  const isDraft = /draft|generating|gathering/i.test(entity.status);
  const needsReview = entityNeedsReview(entity);
  const claimCount = claimCountForEntity(entity);
  return [
    { label: isDraft ? "Gathering sources" : `Gathered ${Math.max(8, entity.sources * 4)} sources`, done: !isDraft || entity.sources > 2 },
    { label: `Extracted ${Math.max(2, entity.signals.length)} entities`, done: !isDraft },
    { label: `Generated ${claimCount} source-backed claims`, done: entity.sources > 0 },
    { label: needsReview ? "Verifying evidence" : "Verified evidence", done: !needsReview },
    { label: needsReview ? "Notebook patch pending" : "Notebook published", done: !needsReview },
  ];
}

function ReportsV3RailGroup({
  label,
  count,
  items,
  selectedName,
  onSelectItem,
}: {
  label: string;
  count: string;
  items: ReportsRailItem[];
  selectedName?: string;
  onSelectItem?: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className={`lr-group ${collapsed ? "collapsed" : ""}`} data-group={label.toLowerCase()}>
      <button
        type="button"
        className="lr-group-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="lr-chevron" aria-hidden="true">▾</span>
        <span>{label}</span>
        <span className="lr-group-count">{count}</span>
      </button>
      {!collapsed && (
        <div className="lr-group-items">
          {items.map((item) => {
            const selected = selectedName ? selectedName === item.name : item.active;
            return (
              <button
                key={`${label}-${item.name}`}
                className={`lr-entity ${selected ? "active" : ""}`}
                type="button"
                data-name={item.name}
                data-status={item.status}
                onClick={() => onSelectItem?.(item.name)}
              >
                <span className="lr-entity-icon">{item.icon}</span>
                <span className="lr-entity-name">{item.name}</span>
                {item.status && <span className="lr-entity-dot" data-status={item.status} />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function entityNeedsReview(entity: PrototypeReportEntity): boolean {
  return /review|stale|draft|generating|gathering/i.test(entity.status) || entity.sources < 5;
}

function claimCountForEntity(entity: PrototypeReportEntity): number {
  return Math.max(3, Math.min(9, entity.signals.length + Math.ceil(entity.sources / 2)));
}

function entityStatusLabel(entity: PrototypeReportEntity): string {
  if (/stale/i.test(entity.status)) return "Stale";
  if (/review/i.test(entity.status)) return "Review";
  if (/draft|generating|gathering/i.test(entity.status)) return "Drafting";
  if (/watch/i.test(entity.status)) return "Watching";
  return "Verified";
}

function entityEvidenceText(entity: PrototypeReportEntity): string {
  const claims = claimCountForEntity(entity);
  if (/stale/i.test(entity.status)) return `${Math.max(1, claims - 2)} of ${claims} claims current`;
  if (entityNeedsReview(entity)) return `${Math.max(1, claims - 1)} of ${claims} claims need review`;
  return `${claims} of ${claims} claims verified`;
}

function entityFreshnessText(entity: PrototypeReportEntity): string {
  return entity.delta;
}

function entityCoverageText(entity: PrototypeReportEntity): string {
  return entity.tags.slice(0, 3).join(" - ");
}

function relatedStatusLabel(entityName: string): string {
  const related = reportEntities.find((item) => item.name === entityName);
  return related ? entityStatusLabel(related) : "Related";
}

function inspectorWarnings(entity: PrototypeReportEntity): string[] {
  if (/stale/i.test(entity.status)) {
    return [
      "Evidence freshness is below the release threshold.",
      "Refresh public sources before exporting this notebook.",
    ];
  }
  if (entityNeedsReview(entity)) {
    return [
      "Open claims need human review before verification.",
      "Notebook patch should preserve the prior source trail.",
    ];
  }
  return [
    "Source coverage is current enough for the present task.",
    "Keep monitoring for fresh signals before the next daily brief.",
  ];
}

function ReportsPrototypeRail({ onAsk, selectedEntity = "Anthropic", selectedReport, onSelectEntity }: PrototypeSelectionProps) {
  const entity = selectedReport ? liveReportToPrototypeEntity(selectedReport) : getPrototypeEntity(selectedEntity);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const needsReview = entityNeedsReview(entity);
  const status = entityStatusLabel(entity);
  const claimCount = claimCountForEntity(entity);
  const contextEntityCount = Math.max(3, entity.related.length + 1);
  const selectedSources = `${entity.sources} sources`;
  const contextPacket = buildGraphContextBridgePacket({
    report: selectedReport ?? {
      id: `proto-${entity.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      entity: entity.name,
      kind: entity.kind,
      status: needsReview ? "review" : "verified",
      description: entity.body,
      sources: entity.sources,
      claims: claimCount,
      followUps: needsReview ? 2 : 0,
      updatedAt: entity.meta,
    },
    mode: "agent",
  });
  const ask = (prompt: string) => onAsk?.(prompt);
  const sendInput = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const value = event.currentTarget.value.trim();
    if (!value) return;
    ask(value);
    event.currentTarget.value = "";
  };

  return (
    <aside
      className="rd-pane rd-pane--right right-rail"
      aria-label="Agent chat"
      data-agent-context-ref={contextPacket.contextRef}
      data-agent-context-rank={contextPacket.agentRank}
      data-agent-context-attention-score={contextPacket.attentionScore}
      data-agent-context-promotion={contextPacket.promotionClass}
    >
      <div className="ar-head">
        <span className="ar-dot" />
        <div className="ar-head-info">
          <div className="ar-name">Coverage agent</div>
          <div className="ar-meta">Reports · {contextEntityCount} entities · {entity.sources * 4} sources · {needsReview ? "3 active" : "12 active"}</div>
        </div>
        <div className="ar-head-actions">
          <button className="ar-head-btn" type="button" aria-label="Expand chat" title="Expand" onClick={() => ask(`Open Chat with ${entity.name} report context.`)}>↗</button>
          <button className="ar-head-btn" type="button" aria-label="Close chat" title="Close" onClick={() => ask("Collapse the Reports coverage rail.")}>×</button>
        </div>
      </div>

      <div className="ar-pills" aria-label="Current context">
        <button className="ar-pill active" type="button" onClick={() => ask("Show all reports in the active universe.")}>
          <span className="ar-pill-dot" style={{ background: "var(--rd-accent)" }} /> Reports
        </button>
        <button className="ar-pill" type="button" onClick={() => onSelectEntity?.(entity.name)}>
          <span className="ar-pill-dot" style={{ background: needsReview ? "var(--rd-amber)" : "var(--rd-green)" }} /> {entity.name}
        </button>
        <button className="ar-pill" type="button" onClick={() => ask(`Open source ledger for ${entity.name}.`)}>{selectedSources}</button>
        <button className="ar-pill" type="button" onClick={() => ask(`Explain ${status} status for ${entity.name}.`)}>
          <span className="ar-pill-dot" style={{ background: needsReview ? "var(--rd-amber)" : "var(--rd-green)" }} /> {status}
        </button>
      </div>

      <div className="ar-thread">
        <div className="ar-msg ar-msg--system">
          <div className="ar-msg-system-line">
            <div className="ar-msg-system-body">
              <span className="ar-msg-system-icon">⚙</span>
              Context loaded · {contextEntityCount} entities · {entity.sources * 4} sources
              <time>3 min ago</time>
            </div>
          </div>
        </div>

        <div className="ar-msg ar-msg--user">
          <div className="ar-msg-bubble">Which reports need the most attention right now?</div>
          <div className="ar-msg-time">2 min ago</div>
        </div>

        <div className="ar-msg ar-msg--system">
          <div className="ar-msg-system-line">
            <div className="ar-msg-system-body">
              <span className="ar-msg-system-icon">↻</span>
              Routed to deep-analysis model for multi-entity comparison
            </div>
          </div>
        </div>

        <div className="ar-msg ar-msg--agent">
          <div className="ar-msg-bubble">
            <div className="ar-msg-lead">{needsReview ? "3 reports need attention" : `${entity.name} is coverage-ready`}</div>
            <div className="ar-msg-detail">
              <strong>{entity.name}</strong> — {needsReview ? "Evidence or freshness is below threshold. Verify stale claims before notebook patch or export." : "Current source rows are verified enough for the active coverage task."}<br />
              <strong>Notebook</strong> — {needsReview ? "Patch should stay proposed until review clears." : "Notebook can be opened, reused, or exported with the current source trail."}<br />
              <strong>Graph</strong> — Related entities remain attached for comparison and follow-up routing.
            </div>
            <div className="ar-msg-tools">
              <span className="ar-tool-badge">source_scan</span>
              <span className="ar-tool-badge">claim_verify</span>
              <span className="ar-tool-badge">freshness_check</span>
              <span className="ar-tool-badge">resolve_report_graph_context</span>
            </div>
          </div>
          <div className="ar-msg-actions">
            <button className="ar-action-chip ar-action-chip--primary" type="button" onClick={() => ask(`Refresh stale reports related to ${entity.name}.`)}>Refresh stale reports</button>
            <button className="ar-action-chip" type="button" onClick={() => ask(`Open the ${entity.name} notebook.`)}>Open notebook</button>
            <button className="ar-action-chip" type="button" onClick={() => ask(`Compare ${entity.name} with related reports.`)}>Compare reports</button>
          </div>
          <div className="ar-msg-time">1 min ago</div>
        </div>

        <div className="ar-msg ar-msg--user">
          <div className="ar-msg-bubble">What changed with {entity.name} since yesterday?</div>
          <div className="ar-msg-time">just now</div>
        </div>

        <div className="ar-msg ar-msg--system">
          <div className="ar-msg-system-line">
            <div className="ar-msg-system-body">
              <span className="ar-msg-system-icon">⇄</span>
              Context narrowed to {entity.name} · {entity.sources} sources · {claimCount} corroborated
            </div>
          </div>
        </div>

        <div className="ar-msg ar-msg--agent">
          <div className="ar-msg-bubble">
            <div className="ar-msg-lead">{entity.name} — {entity.signals.length} new signals</div>
            <div className="ar-msg-detail">{entity.signals.slice(0, 3).join(" ")}</div>
            <div className="ar-msg-tools">
              <span className="ar-tool-badge">entity_diff</span>
              <span className="ar-tool-badge">signal_extract</span>
            </div>
          </div>
          <div className="ar-msg-actions">
            <button className="ar-action-chip ar-action-chip--primary" type="button" onClick={() => ask(`Open notebook for ${entity.name}.`)}>Open notebook</button>
            <button className="ar-action-chip" type="button" onClick={() => ask(`Verify claims for ${entity.name}.`)}>Verify claims</button>
            <button className="ar-action-chip" type="button" onClick={() => ask(`Export memo preview for ${entity.name}.`)}>Export memo</button>
          </div>
          <div className="ar-msg-time">just now</div>
        </div>
      </div>

      <div className={`ar-drawer ${drawerOpen ? "" : "collapsed"}`}>
        <button className="ar-drawer-head" type="button" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((value) => !value)}>
          <span className="ar-drawer-label">Context</span>
          <span className="ar-drawer-pills">
            <span className="ar-drawer-pill">{entity.name}</span>
            <span className="ar-drawer-pill">· {entity.sources} sources</span>
            <span className="ar-drawer-pill">· {contextEntityCount} entities</span>
          </span>
          <span className="ar-drawer-chevron">▾</span>
        </button>
        <div className="ar-drawer-body">
          <div className="ar-drawer-entity">
            <span className="ar-drawer-icon">{entity.initial}</span>
            <span className="ar-drawer-name">{entity.name}</span>
            <span className="ar-drawer-status" data-status={status}>{status}</span>
          </div>
          <div className="ar-context-packet">
            <div className="ar-context-packet__head">
              <span>Graph context packet</span>
              <b>{contextPacket.agentRank}</b>
            </div>
            <p>{contextPacket.agentSummary}</p>
            <div className="ar-context-packet__attention" data-promotion={contextPacket.promotionClass}>
              <span>
                <strong>{contextPacket.attentionScore}</strong>
                attention
              </span>
              <span>{contextPacket.promotionClass.replace("_", " ")}</span>
            </div>
            <div className="ar-context-packet__grid">
              <span><strong>{contextPacket.sourceRefs}</strong> sources</span>
              <span><strong>{contextPacket.claimRefs}</strong> claims</span>
              <span><strong>{contextPacket.estimatedTokens}</strong> tok</span>
            </div>
            <details className="ar-context-packet__why">
              <summary>Why the agent packed this</summary>
              <ol>
                {contextPacket.whySelected.slice(0, 4).map((reason, index) => (
                  <li key={`${reason}-${index}`}>{reason}</li>
                ))}
              </ol>
            </details>
          </div>
          <div className="ar-ctx-row"><span className="ar-ctx-lbl">Evidence</span><span className="ar-ctx-val">{entityEvidenceText(entity)}</span></div>
          <div className="ar-ctx-row"><span className="ar-ctx-lbl">Freshness</span><span className="ar-ctx-val">{entityFreshnessText(entity)}</span></div>
          <div className="ar-ctx-row"><span className="ar-ctx-lbl">Sources</span><span className="ar-ctx-val">{entity.sources} sources · {claimCount} corroborated</span></div>
          <div className="ar-ctx-row"><span className="ar-ctx-lbl">Coverage</span><span className="ar-ctx-val">{entityCoverageText(entity)}</span></div>
        </div>
      </div>

      <div className="ar-footer">
        <div className="ar-input-wrap">
          <input className="ar-input" placeholder="Ask about your reports..." aria-label="Chat with agent" onKeyDown={sendInput} />
          <div className="ar-input-actions">
            <button className="ar-input-btn" type="button" title="Add context" onClick={() => ask(`Attach ${entity.name} context.`)}>+ Context</button>
            <button className="ar-input-btn" type="button" title="Reference entity" onClick={() => ask(`Reference ${entity.name}.`)}>@ Reference</button>
            <button className="ar-input-btn" type="button" title="Slash command" onClick={() => ask(`/report ${entity.name}`)}>/ Command</button>
            <button className="ar-input-btn" type="button" title="Attach file" onClick={() => ask(`Attach source file to ${entity.name}.`)}>📎</button>
            <span className="ar-input-send"><kbd>↵</kbd> to send</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function ChatPrototypeRail() {
  const [activeTab, setActiveTab] = useState("Entity");
  const [expanded, setExpanded] = useState(false);
  const panels: Record<string, ReactNode> = {
    Entity: (
      <>
        <article className="rd-v2-util-card">
          <div className="rd-v2-report-title"><span>S</span><h2>Sequoia Capital</h2><b>74</b></div>
          <p>• Full-ratchet anti-dilution clause<br />• Series C term sheet Rev. 3<br />• Last verified: 2h ago</p>
        </article>
        <section className="rd-v2-util-list">
          <h3>Key claims</h3>
          <p>✓ <strong>Ratchet</strong> Full-ratchet vs weighted-average <span>verified</span></p>
          <p>✓ <strong>Dilution</strong> 23% founder dilution at $180M <span>verified</span></p>
          <p>○ <strong>Board seat</strong> Observer vs voting rights <span>pending</span></p>
          <p>○ <strong>Pro-rata</strong> Follow-on participation rights <span>pending</span></p>
        </section>
      </>
    ),
    Graph: (
      <section className="rd-v2-util-list">
        <h3>Graph neighborhood</h3>
        <svg viewBox="0 0 300 160" xmlns="http://www.w3.org/2000/svg" className="rd-v2-graph-svg">
          <line x1="150" y1="80" x2="50" y2="30" stroke="var(--rd-line)" strokeWidth="1" />
          <line x1="150" y1="80" x2="250" y2="30" stroke="var(--rd-line)" strokeWidth="1" />
          <line x1="150" y1="80" x2="60" y2="135" stroke="var(--rd-line)" strokeWidth="1" />
          <line x1="150" y1="80" x2="240" y2="135" stroke="var(--rd-line)" strokeWidth="1" />
          <line x1="50" y1="30" x2="250" y2="30" stroke="var(--rd-line-faint)" strokeWidth="1" strokeDasharray="4" />
          <circle cx="150" cy="80" r="18" fill="var(--rd-accent-tint)" stroke="var(--rd-accent)" strokeWidth="1.5" />
          <text x="150" y="84" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--rd-accent-strong)">You</text>
          <circle cx="50" cy="30" r="14" fill="var(--rd-panel)" stroke="var(--rd-line)" strokeWidth="1" />
          <text x="50" y="34" textAnchor="middle" fontSize="7" fill="var(--rd-ink-mute)">Anthropic</text>
          <circle cx="250" cy="30" r="14" fill="var(--rd-panel)" stroke="var(--rd-line)" strokeWidth="1" />
          <text x="250" y="34" textAnchor="middle" fontSize="7" fill="var(--rd-ink-mute)">Sequoia</text>
          <circle cx="60" cy="135" r="14" fill="var(--rd-panel)" stroke="var(--rd-line)" strokeWidth="1" />
          <text x="60" y="139" textAnchor="middle" fontSize="7" fill="var(--rd-ink-mute)">Bug0</text>
          <circle cx="240" cy="135" r="14" fill="var(--rd-panel)" stroke="var(--rd-line)" strokeWidth="1" />
          <text x="240" y="139" textAnchor="middle" fontSize="7" fill="var(--rd-ink-mute)">SMB</text>
        </svg>
        <p style={{ fontSize: "10px", color: "var(--rd-ink-faint)", textAlign: "center", marginTop: "8px" }}>4 entities · 6 relationships</p>
      </section>
    ),
    Sources: <section className="rd-v2-util-list"><h3>Sources</h3><p><strong>Term sheet v3</strong><span>PDF</span></p><p><strong>Cap table model</strong><span>Sheet</span></p><p><strong>Cooley primer</strong><span>Reference</span></p><p><strong>Anti-dilution clause primer</strong><span>Web</span></p></section>,
    Threads: <section className="rd-v2-util-list"><h3>Threads</h3><p><strong>Ratchet clause analysis</strong><span>3 messages</span></p><p><strong>Board deck prep</strong><span>2 messages</span></p><p><strong>Anti-dilution research</strong><span>1 message</span></p></section>,
    Notebook: <section className="rd-v2-util-list"><h3>Notebook patch</h3><p><strong>Proposed edit</strong><span>pending</span></p><p>Add dilution table, counsel review, and counterproposal summary.</p><button className="rd-v2-note-add">+ New note</button></section>,
    Report: (
      <section className="rd-v2-util-list">
        <h3>Thread stats</h3>
        <p><strong>Messages</strong><span>3</span></p>
        <p><strong>Tools used</strong><span>5</span></p>
        <p><strong>Cost</strong><span>$0.13</span></p>
        <p><strong>Duration</strong><span>2m 14s</span></p>
        <div className="rd-v2-action-card-list" style={{ marginTop: "12px" }}>
          <button className="is-primary">Export report</button>
          <button>Share</button>
        </div>
      </section>
    ),
  };

  return (
    <aside className="rd-pane rd-pane--right rd-v2-utility" aria-label="Context" data-width={expanded ? "expanded" : undefined}>
      <header className="rd-v2-util-head"><strong>Context</strong><button type="button" aria-label={expanded ? "Collapse rail" : "Expand rail"} onClick={() => setExpanded(e => !e)}>{expanded ? "\u2921" : "\u2922"}</button></header>
      <input className="rd-v2-util-search" placeholder="Search sources, entities..." />
      <div className="rd-v2-util-tabs" role="tablist" aria-label="Chat utilities">
        {Object.keys(panels).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      {panels[activeTab]}
    </aside>
  );
}

function InboxPrototypeRail({ onAsk }: HomeV2SurfaceProps) {
  return (
    <AgentShell
      title="Triage agent"
      context="Inbox item · Sequoia term sheet v3 · 1 of 53"
      pills={["Inbox", "Sequoia Capital", "Term sheet v3", "P0"]}
      question="Why is this urgent?"
      placeholder="Ask about this item..."
      onAsk={onAsk}
    >
      <div className="rd-v2-msg rd-v2-msg-agent">
        <strong>The ratchet clause needs legal review before Thursday's board call.</strong>
        <p>Full-ratchet creates a 14.3pp dilution gap at $48M. This is the single largest negotiation risk in the term sheet.</p>
        <details className="rd-v2-trace">
          <summary><small>3 steps completed</small></summary>
          <div className="rd-v2-trace-steps"><span>term_sheet_parse</span><span>dilution_calc</span><span>calendar_check</span></div>
        </details>
        <div className="rd-v2-msg-tools"><span>term_sheet_parse</span><span>dilution_calc</span><span>calendar_check</span></div>
      </div>
      <button className="rd-v2-drawer-toggle">Context · Sequoia 74 · 2 threads</button>
      <article className="rd-v2-util-card">
        <div className="rd-v2-report-title"><span>S</span><h2>Sequoia Capital</h2><b>74</b></div>
        <p>• Active term sheet negotiation<br />• $1.2M partnership · 3 prior rounds<br />• Last report: 6h ago</p>
      </article>
      <div className="rd-v2-agent-insight"><strong>Agent insight</strong><span className="rd-v2-confidence">Verified evidence</span><p>Full-ratchet clause creates 14.3pp dilution gap at $48M. Counter with narrow-based weighted-average as floor.</p></div>
      <section className="rd-v2-related-threads">
        <h3>Related threads</h3>
        <div className="rd-v2-thread-item"><span className="rd-v2-thread-dot" /><span>Term sheet v2 discussion</span><span className="rd-v2-thread-time">4d</span></div>
        <div className="rd-v2-thread-item"><span className="rd-v2-thread-dot" /><span>Sequoia intro meeting notes</span><span className="rd-v2-thread-time">2w</span></div>
      </section>
      <section className="rd-v2-action-card-list">
        {[
          { icon: "✉", label: "Draft reply" },
          { icon: "⚖", label: "Flag for legal" },
          { icon: "↷", label: "Forward to counsel" },
          { icon: "⏰", label: "Defer to Thursday" },
        ].map(({ icon, label }, index) => (
          <button key={label} className={index === 0 ? "is-primary" : ""}><span className="rd-v2-action-icon">{icon}</span> {label}</button>
        ))}
      </section>
    </AgentShell>
  );
}

function MePrototypeRail({ onAsk, guestSafe = false }: HomeV2SurfaceProps & { guestSafe?: boolean }) {
  const context = guestSafe
    ? "Private context - connect an account to sync"
    : "USER.md · 5 permissions · 7 sessions today";
  const question = guestSafe
    ? "What gets saved after sign-in?"
    : "Why did you suggest this memory update?";
  const lead = guestSafe
    ? "No private operator memory is loaded for visitors."
    : "You prefer concise banker-style memos over long-form analysis.";
  const detail = guestSafe
    ? "After sign-in, NodeBench can save writing style, watched entities, connector permissions, budget rules, and an audit trail. Until then, the public route stays read-only."
    : "In the last 7 sessions, you shortened 4 of my outputs and asked for just the decision. I updated your voice profile to default to Decision -> Why -> Plan format.";
  const trace = guestSafe
    ? ["auth_check", "privacy_boundary", "permission_preview"]
    : ["memory_scan", "preference_log", "profile_update"];

  if (guestSafe) {
    return (
      <AgentShell
        title="Settings agent"
        context={context}
        pills={["Me", "Private profile", "Permissions", "Usage"]}
        question={question}
        placeholder="Ask about your settings..."
        onAsk={onAsk}
      >
        <div className="rd-v2-msg rd-v2-msg-agent">
          <strong>{lead}</strong>
          <p>{detail}</p>
          <details className="rd-v2-trace">
            <summary><small>3 steps completed</small></summary>
            <div className="rd-v2-trace-steps">{trace.map((step) => <span key={step}>{step}</span>)}</div>
          </details>
          <div className="rd-v2-msg-tools">{trace.map((step) => <span key={step}>{step}</span>)}</div>
        </div>
        <button className="rd-v2-drawer-toggle">Context - Private profile - Permissions - Usage</button>
        <section className="rd-v2-settings-list">
          <h3>Private profile</h3>
          <p><span>Tone</span><strong>Not loaded</strong></p>
          <p><span>Format</span><strong>Sign in to sync</strong></p>
          <p><span>Jargon level</span><strong>Private</strong></p>
          <h3>Permissions</h3>
          <p>Web search: <b>Read-only</b></p>
          <p>File access: <b>Off</b></p>
          <p>Post to LinkedIn: <em>Approval required</em></p>
          <p>Send email: <em>Approval required</em></p>
          <p>Execute trades: <em>Disabled</em></p>
          <h3>Session stats</h3>
          <p><span>Memory hits</span><strong>Locked</strong></p>
          <p><span>Corrections</span><strong>Locked</strong></p>
          <p><span>Current mode</span><strong>Public</strong></p>
        </section>
        <section className="rd-v2-action-card-list">
          <button className="is-primary">Connect account</button>
          <button>Preview USER.md</button>
          <button>Open permissions</button>
        </section>
      </AgentShell>
    );
  }

  return (
    <AgentShell
      title="Settings agent"
      context="USER.md · 5 permissions · 7 sessions today"
      pills={["Me", "Voice profile", "Permissions", "Usage"]}
      question="Why did you suggest this memory update?"
      placeholder="Ask about your settings..."
      onAsk={onAsk}
    >
      <div className="rd-v2-msg rd-v2-msg-agent">
        <strong>You prefer concise banker-style memos over long-form analysis.</strong>
        <p>In the last 7 sessions, you shortened 4 of my outputs and asked for just the decision. I updated your voice profile to default to {"Decision -> Why -> Plan"} format.</p>
        <details className="rd-v2-trace">
          <summary><small>3 steps completed</small></summary>
          <div className="rd-v2-trace-steps"><span>memory_scan</span><span>preference_log</span><span>profile_update</span></div>
        </details>
        <div className="rd-v2-msg-tools"><span>memory_scan</span><span>preference_log</span><span>profile_update</span></div>
      </div>
      <button className="rd-v2-drawer-toggle">Context · Voice · Permissions · Usage</button>
      <section className="rd-v2-settings-list">
        <h3>Voice profile</h3>
        <p><span>Tone</span><strong>Direct, tactical</strong></p>
        <p><span>Format</span><strong>{"Decision -> Why -> Plan"}</strong></p>
        <p><span>Jargon level</span><strong>High (match user)</strong></p>
        <h3>Permissions</h3>
        <p>• Web search: <b style={{ color: "var(--rd-green, #22c55e)" }}>Enabled</b></p>
        <p>• File access: <b style={{ color: "var(--rd-green, #22c55e)" }}>Enabled</b></p>
        <p>• Post to LinkedIn: <em style={{ color: "var(--rd-amber, #f59e0b)" }}>Approval required</em></p>
        <p>• Send email: <em style={{ color: "var(--rd-amber, #f59e0b)" }}>Approval required</em></p>
        <p>• Execute trades: <em style={{ color: "#b91c1c" }}>Disabled</em></p>
        <h3>Session stats</h3>
        <p><span>Threads today</span><strong>7</strong></p>
        <p><span>Tools called</span><strong>34</strong></p>
        <p><span>Cost today</span><strong>$0.87</strong></p>
        <p><span>Avg latency</span><strong>1.4s</strong></p>
      </section>
      <section className="rd-v2-action-card-list">
        {[
          { icon: "⚙", label: "Calibrate voice" },
          { icon: "🔒", label: "Review permissions" },
          { icon: "📊", label: "View usage" },
          { icon: "↺", label: "Reset suggestion" },
        ].map(({ icon, label }, index) => (
          <button key={label} className={index === 0 ? "is-primary" : ""}><span className="rd-v2-action-icon">{icon}</span> {label}</button>
        ))}
      </section>
    </AgentShell>
  );
}

export function HomeV2EditionRail({
  liveArtifacts,
  onAsk,
}: {
  liveArtifacts?: LiveArtifactsResult;
  onAsk?: (prompt: string) => void;
} = {}) {
  const model = buildHomeV2Model(liveArtifacts);
  const askAboutEdition = (label: string) => {
    onAsk?.(`Open the ${label} agent brief and summarize what changed, which reports it touches, and what to do next.`);
  };
  return (
    <aside className="rd-v2-left" aria-label="Edition browser">
      <div className="rd-v2-edition-month">May 2026</div>
      {model.editionItems.map((item) => (
        <div key={item.day} className="rd-v2-edition-block">
          <button
            type="button"
            className={`rd-v2-edition-date ${item.today ? "is-today" : ""}`}
            onClick={() => askAboutEdition(item.title)}
          >
            <span className="rd-v2-edition-day">{item.day}</span>
            <span className="rd-v2-edition-info">
              <span className="rd-v2-edition-label">{item.title}</span>
              <span className="rd-v2-edition-sub">{item.meta}</span>
            </span>
          </button>
          <p>{item.body}</p>
        </div>
      ))}
      <div className="rd-v2-rail-rule" />
      <EditionGroup label="Week of May 4" count="5" onSelect={askAboutEdition} />
      <EditionGroup label="Week of Apr 27" count="7" onSelect={askAboutEdition} />
      <div className="rd-v2-rail-rule" />
      <EditionGroup label="April 2026" count="28" onSelect={askAboutEdition} />
      <EditionGroup label="March 2026" count="31" onSelect={askAboutEdition} />
      <EditionGroup label="February 2026" count="28" onSelect={askAboutEdition} />
      <div className="rd-v2-rail-rule" />
      <EditionGroup label="Q4 2025" count="62" onSelect={askAboutEdition} />
    </aside>
  );
}

function findBriefSection(model: HomeV2Model, label: string, fallbackIndex: number): HomeV2BriefSection {
  return model.dailyBriefSections.find((section) => section.title.toLowerCase().includes(label)) ??
    model.dailyBriefSections[fallbackIndex] ??
    model.dailyBriefSections[0];
}

function countFromText(value: string | undefined, fallback: string): string {
  const match = value?.match(/\d[\d,]*/);
  return match?.[0] ?? fallback;
}

interface HomeHaloReport {
  id: string;
  title: string;
  kind: string;
  status: ReportCardData["status"];
  summary: string;
  sources: number;
  claims: number;
  followUps: number;
  updatedAt: string;
  graphHint: string;
  sourceHint: string;
  hue: "orange" | "blue" | "green" | "purple" | "teal" | "red";
}

const homeHaloHues: HomeHaloReport["hue"][] = ["orange", "blue", "green", "purple", "teal", "red"];

function statusCopy(status: ReportCardData["status"]): string {
  if (status === "verified") return "Verified";
  if (status === "review") return "Needs review";
  return "Watching";
}

function buildHomeHaloReports(liveArtifacts?: LiveArtifactsResult): HomeHaloReport[] {
  const reports = liveArtifacts?.reports ?? [];
  return reports.slice(0, 8).map((report, index) => {
    const detail = liveArtifacts?.details.find((item) => item.id === report.id);
    const source = detail?.sourceRows[0];
    return {
      id: report.id,
      title: report.entity,
      kind: report.kind,
      status: report.status,
      summary: trimSentence(detail?.summary ?? report.description, report.description, 180),
      sources: report.sources,
      claims: report.claims,
      followUps: report.followUps,
      updatedAt: report.updatedAt,
      graphHint: detail
        ? `${detail.nodes.length} nodes · ${detail.edges.length} edges`
        : `${report.claims} claims · ${report.followUps} follow-ups`,
      sourceHint: source
        ? `${sourceLabel(source.type)} · ${source.reused}x reused`
        : `${report.sources} source rows`,
      hue: homeHaloHues[index % homeHaloHues.length],
    };
  });
}

function HomeReportHalo({
  reports,
  activeReportId,
  onActiveReportChange,
  onAsk,
  onOpenReports,
}: {
  reports: HomeHaloReport[];
  activeReportId?: string | null;
  onActiveReportChange?: (reportId: string) => void;
  onAsk?: (prompt: string, context?: HomeAskContext) => void;
  onOpenReports?: (reportId?: string) => void;
}) {
  const active = reports.find((report) => report.id === activeReportId) ?? reports[0];
  const selectReport = (reportId: string) => onActiveReportChange?.(reportId);
  const askReport = (report: HomeHaloReport) => {
    onAsk?.(
      `Use the ${report.title} report packet. Summarize what changed, source support, open claims, and the next report or notebook action.`,
      { reportId: report.id },
    );
  };

  if (reports.length === 0) {
    return (
      <section className="rd-v3-home-halo rd-v3-home-halo--empty" data-testid="home-v3-report-halo">
        <div className="rd-v3-home-halo-head">
          <span>Report memory</span>
          <strong>No live report halo yet</strong>
          <p>Run or refresh a report so Home can preview reusable context before Chat asks the model to search again.</p>
        </div>
        <button type="button" onClick={() => onAsk?.("Create the first report packet from live memory and attach sources before drafting.")}>
          Create first packet
        </button>
      </section>
    );
  }

  return (
    <section className="rd-v3-home-halo" data-testid="home-v3-report-halo" aria-label="Report memory halo">
      <div className="rd-v3-home-halo-head">
        <span>Report halo</span>
        <strong>Reusable memory is already in the room.</strong>
        <p>Hover or select a report, then ask with its Convex-backed context attached.</p>
      </div>

      <div className="rd-v3-halo-track" role="list">
        {reports.map((report) => (
          <button
            key={report.id}
            type="button"
            role="listitem"
            className="rd-v3-halo-card"
            data-hue={report.hue}
            data-active={active?.id === report.id ? "true" : undefined}
            onMouseEnter={() => selectReport(report.id)}
            onFocus={() => selectReport(report.id)}
            onClick={() => selectReport(report.id)}
          >
            <span className="rd-v3-halo-card-cover">
              <b>{monogram(report.title)}</b>
              <em>{report.kind}</em>
            </span>
            <strong>{report.title}</strong>
            <small>{statusCopy(report.status)} · {report.updatedAt}</small>
            <p>{report.summary}</p>
          </button>
        ))}
      </div>

      {active && (
        <aside className="rd-v3-halo-dock" data-testid="home-v3-halo-dock" aria-label={`${active.title} preview`}>
          <div>
            <span>{active.kind}</span>
            <h3>{active.title}</h3>
            <p>{active.summary}</p>
          </div>
          <dl>
            <div><dt>Status</dt><dd>{statusCopy(active.status)}</dd></div>
            <div><dt>Evidence</dt><dd>{active.sources} sources · {active.claims} claims</dd></div>
            <div><dt>Graph</dt><dd>{active.graphHint}</dd></div>
            <div><dt>Source</dt><dd>{active.sourceHint}</dd></div>
          </dl>
          <div className="rd-v3-halo-actions">
            <button type="button" className="rd-v2-btn-primary" onClick={() => askReport(active)}>Ask with context</button>
            <button type="button" onClick={() => onOpenReports?.(active.id)}>Open report</button>
            <button
              type="button"
              onClick={() => onAsk?.(`Explore the graph neighborhood for ${active.title} and identify used, changed, needs-review, and blocked clusters.`, { reportId: active.id })}
            >
              Explore graph
            </button>
          </div>
        </aside>
      )}
    </section>
  );
}

function HomeV3FrontPage({
  model,
  haloReports,
  onAsk,
  onOpenReports,
}: {
  model: HomeV2Model;
  haloReports: HomeHaloReport[];
  onAsk?: (prompt: string, context?: HomeAskContext) => void;
  onOpenReports?: (reportId?: string) => void;
}) {
  const [activeReportId, setActiveReportId] = useState<string | null>(haloReports[0]?.id ?? null);
  const activeReport = haloReports.find((report) => report.id === activeReportId) ?? haloReports[0];
  const contextLabel = activeReport
    ? `Using ${activeReport.title} · ${activeReport.sources} sources · ${activeReport.claims} claims`
    : model.editionLine;
  const submit = (text: string, _tier: RouterTier) => {
    onAsk?.(text, activeReport ? { reportId: activeReport.id } : undefined);
  };

  return (
    <section className="rd-v3-home-front" data-testid="home-v3-chat-first-frontpage" aria-label="Chat-first intelligence front page">
      <HomeReportHalo
        reports={haloReports}
        activeReportId={activeReport?.id ?? null}
        onActiveReportChange={setActiveReportId}
        onAsk={onAsk}
        onOpenReports={onOpenReports}
      />
      <div className="rd-v3-home-composer-shell">
        <div className="rd-v3-home-composer-head">
          <span>Ask first</span>
          <h1>Ask once. Turn it into reusable intelligence.</h1>
          <p>{model.heroSub}</p>
        </div>
        <UniversalComposer
          contextLabel={contextLabel}
          placeholder="Ask about a company, person, event, market, report, or source packet..."
          showRuntimeRibbon
          onSubmit={submit}
          onChatNow={submit}
        />
      </div>
    </section>
  );
}

function LivePulseLanding({
  model,
  onAsk,
  onOpenReports,
}: {
  model: HomeV2Model;
  onAsk?: (text: string, context?: HomeAskContext) => void;
  onOpenReports?: (reportId?: string) => void;
}) {
  const whatChanged = findBriefSection(model, "changed", 0);
  const reportsTouched = findBriefSection(model, "reports", 3);
  const sourcesUsed = findBriefSection(model, "sources", 4);
  const actionsCreated = findBriefSection(model, "actions", 5);
  const changedCount = countFromText(whatChanged.metric, model.dailyBriefStats[0]?.value ?? "0");
  const reportCount = countFromText(reportsTouched.metric, "0");
  const sourceCount = countFromText(sourcesUsed.metric, model.dailyBriefStats[1]?.value ?? "0");
  const actionCount = countFromText(actionsCreated.metric, model.dailyBriefStats[2]?.value ?? "0");
  const cardSections = [reportsTouched, sourcesUsed, actionsCreated];
  const introspection = model.dailyIntrospection;
  const agentSteps = [
    {
      title: "Memory first",
      body: `Searched the live brief and reusable report memory before asking the user to research again.`,
      meta: `${changedCount} changed signals`,
    },
    {
      title: "Report matching",
      body: `Mapped the signal packet to existing coverage so the next click opens work in context.`,
      meta: `${reportCount} reports touched`,
    },
    {
      title: "Evidence and action",
      body: `Kept sources and follow-ups visible so claims can be verified, patched, or routed to Chat.`,
      meta: `${sourceCount} source rows · ${actionCount} follow-ups`,
    },
  ];

  return (
    <section className="rd-v2-pulse" data-testid="home-v2-pulse-landing" aria-labelledby="home-v2-pulse-title">
      <div className="rd-v2-pulse-topline" aria-label="Daily Brief status">
        <span>{introspection.kicker}</span>
        <span>{model.editionLine}</span>
      </div>

      <div className="rd-v2-pulse-head">
        <p className="rd-v2-pulse-kicker">For the first decision of the day</p>
        <h1 id="home-v2-pulse-title">{introspection.title}</h1>
        <p>{introspection.body}</p>
      </div>

      <div className="rd-v2-pulse-grid">
        <article className="rd-v2-pulse-lead">
          <div className="rd-v2-card-kicker">Daily nudge</div>
          <h2>{introspection.reflectionTitle}</h2>
          <p>{introspection.reflectionBody}</p>
          <div className="rd-v2-introspection-question">
            <span>Next-action question</span>
            <strong>{introspection.question}</strong>
          </div>
          <p className="rd-v2-introspection-meta">{introspection.meta}</p>
          <div className="rd-v2-pulse-actions">
            <button className="rd-v2-btn-primary" onClick={() => onAsk?.(introspection.prompt)}>
              Work this in Chat
            </button>
            <button onClick={() => onOpenReports?.()}>
              Open touched reports
            </button>
          </div>
          <ul className="rd-v2-agent-steps" aria-label="Agent work completed">
            {agentSteps.map((item) => (
              <li key={item.title}>
                <span>{item.meta}</span>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
        </article>

        <div className="rd-v2-pulse-side">
          <article className="rd-v2-pulse-note">
            <div className="rd-v2-card-kicker">Found while scanning</div>
            <h3>{introspection.sourceTitle}</h3>
            <p>{introspection.sourceBody}</p>
            <p className="rd-v2-source-meta">{introspection.sourceMeta}</p>
          </article>
          <article className="rd-v2-pulse-note rd-v2-pulse-note--accent">
            <div className="rd-v2-card-kicker">Small execution window</div>
            <h3>{introspection.windowTitle}</h3>
            <p>{introspection.windowBody}</p>
            <button onClick={() => onAsk?.(introspection.prompt)}>
              Prepare the next move
            </button>
          </article>
        </div>
      </div>

      <div className="rd-v2-pulse-statline" aria-label="Daily Brief evidence summary">
        {model.dailyBriefStats.map((stat) => (
          <div key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
            <small>{stat.hint}</small>
          </div>
        ))}
      </div>

      <div className="rd-v2-pulse-mosaic" aria-label="Daily Brief follow-through">
        {cardSections.map((section) => (
          <article key={section.eyebrow}>
            <span>{section.title}</span>
            <strong>{section.metric ?? section.items.length}</strong>
            <p>{section.deck ?? section.body}</p>
          </article>
        ))}
      </div>

      <HomeV2ShareBar onAsk={onAsk} pulse />
    </section>
  );
}

export function HomeV2Surface({ onAsk, onOpenReports, liveArtifacts }: HomeV2SurfaceProps) {
  const model = buildHomeV2Model(liveArtifacts);
  const isLiveHome = Boolean(liveArtifacts);
  const haloReports = buildHomeHaloReports(liveArtifacts);
  return (
    <div className="rd-v2-home">
      <HomeV3FrontPage
        model={model}
        haloReports={haloReports}
        onAsk={onAsk}
        onOpenReports={onOpenReports}
      />
      {isLiveHome ? (
        <LivePulseLanding model={model} onAsk={onAsk} onOpenReports={onOpenReports} />
      ) : (
        <>
          <div className="rd-v2-edition-row">
            <span className="rd-v2-edition-pill">Daily edition</span>
            <span className="rd-v2-edition-subline">{model.editionLine}</span>
          </div>

          <HomeV2ShareBar onAsk={onAsk} />

          <p className="rd-v2-hero-tagline">Career ops</p>
          <h1 className="rd-v2-hero">One queue. One decision at a time.</h1>
          <p className="rd-v2-hero-sub">
            {model.heroSub}
          </p>

          <div className="rd-v2-ed-selector" role="group" aria-label="Edition timeframe">
            {["Today", "Yesterday", "This week", "This month", "Quarter", "Archive \u2192"].map((label, index) => (
              <button key={label} className={index === 0 ? "is-active" : ""} aria-pressed={index === 0}>
                {label}
              </button>
            ))}
          </div>

          <div className="rd-v2-twin-cards">
            <article className="rd-v2-card">
              <div className="rd-v2-card-kicker">Next best action</div>
              <h2>{model.primaryTitle}</h2>
              <p>{model.primaryBody}</p>
              <div className="rd-v2-card-actions">
                <button className="rd-v2-btn-primary" onClick={() => onAsk?.("Open today's booking queue.")}>Show booking queue</button>
                <button onClick={() => onAsk?.("Open today's prep queue.")}>Show prep queue</button>
              </div>
            </article>
            <article className="rd-v2-card">
              <div className="rd-v2-card-kicker">Daily sweep / May 11</div>
              <h3>{model.sweepTitle}</h3>
              <p>{model.sweepBody}</p>
              <ul className="rd-v2-sweep-list">
                {model.sweepBullets.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          </div>

          <div className="rd-v2-stats-row">
            {model.stats.map((stat) => (
              <StatCell key={stat.label} label={stat.label} value={stat.value} tone={stat.tone} />
            ))}
          </div>
        </>
      )}

      <div className="rd-v2-queue-head">
        <h3>{isLiveHome ? "Follow-up queue" : "Queue"}</h3>
        <div>
          {["All", "Now", "Prep", "Batch", "Later"].map((label, index) => (
            <button key={label} className={index === 0 ? "is-active" : ""}>{label}</button>
          ))}
        </div>
      </div>

      <section className="rd-v2-selected">
        <div className="rd-v2-selected-top">
          <span>Now / Selected</span>
          <strong>{model.selectedScore}</strong>
        </div>
        <h3>{model.selectedTitle}</h3>
        <p>{model.selectedBody}</p>
        <p><strong>Next:</strong> {model.selectedNext}</p>
        <p className="rd-v2-muted"><strong>Why?</strong> {model.selectedWhy}</p>
      </section>

      <div className="rd-v2-proof-row">
        {model.proofCards.map((card) => (
          <ProofCard key={card.title} title={card.title} body={card.body} tag={card.tag} highlight={card.highlight} />
        ))}
      </div>

      <div className="rd-v2-action-row">
        {["Read", "Draft reply", "Book", "Research", "Defer"].map((label, index) => (
          <button
            key={label}
            className={index === 0 ? "rd-v2-btn-primary" : ""}
            onClick={() => onAsk?.(`${label} the selected queue item.`)}
          >
            {label}
          </button>
        ))}
      </div>

      <ol className="rd-v2-q-list" aria-label="Ranked decision queue">
        {model.queueItems.map(([rank, lane, title, next]) => (
          <li key={rank}>
            <span className="rd-v2-q-rank">{rank}</span>
            <span className="rd-v2-q-badge" data-lane={lane}>{lane}</span>
            <span className="rd-v2-q-title">{title}</span>
            <span className="rd-v2-q-next">{next}</span>
          </li>
        ))}
      </ol>
      <div className="rd-v2-show-more"><button>{model.moreLabel}</button></div>

      <div className="rd-v2-editorial-divider" />
      <section className="rd-v2-brief-head" aria-labelledby="home-daily-brief-title">
        <span>{model.dailyBriefEyebrow}</span>
        <h2 id="home-daily-brief-title">{model.dailyBriefTitle}</h2>
        <p>{model.dailyBriefSubtitle}</p>
        <p className="rd-v2-brief-dek">{model.dailyBriefDek}</p>
        <div className="rd-v2-brief-statline" aria-label="Daily brief evidence summary">
          {model.dailyBriefStats.map((stat) => (
            <div key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
              <small>{stat.hint}</small>
            </div>
          ))}
        </div>
      </section>
      <div className="rd-v2-brief-sections" data-testid="home-v2-daily-brief-content">
        {model.dailyBriefSections.map((section) => (
          <section
            className={`rd-v2-ed-section rd-v2-ed-section--${section.layout ?? "cards"}`}
            data-testid="home-v2-brief-section"
            key={section.eyebrow}
          >
            <div className="rd-v2-ed-section-copy">
              <div className="rd-v2-ed-section-top">
                <span>{section.eyebrow}</span>
                {section.metric && <strong>{section.metric}</strong>}
              </div>
              <h3>{section.title}</h3>
              {section.deck && <p className="rd-v2-brief-deck">{section.deck}</p>}
              <p>{section.body}</p>
            </div>
            {section.items.length > 0 && (
              <div className="rd-v2-brief-items">
                {section.items.map((item, itemIndex) => (
                  <article
                    className="rd-v2-brief-item"
                    data-tone={item.tone ?? "default"}
                    key={`${section.eyebrow}-${item.title}-${itemIndex}`}
                  >
                    <div className="rd-v2-brief-item-meta">
                      {item.meta && <small>{item.meta}</small>}
                      {item.status && <span>{item.status}</span>}
                    </div>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export function HomeV2BriefingRail({ onAsk, onOpenReports, liveArtifacts }: HomeV2SurfaceProps) {
  const model = buildHomeV2Model(liveArtifacts);
  const railSourceCount = liveArtifacts ? liveArtifacts.reports.reduce((total, report) => total + report.sources, 0) : 12;
  return (
    <aside className="rd-pane rd-pane--right rd-v2-briefing" aria-label="Briefing agent">
      <header className="rd-v2-agent-head">
        <div className="rd-v2-agent-head-row">
          <span className="rd-v2-agent-dot" />
          <strong>Briefing agent</strong>
          <button type="button" aria-label="Expand rail">{"\u2197"}</button>
        </div>
        <p>{model.agentMeta}</p>
      </header>
      <div className="rd-v2-agent-pills">
        <span>Home</span>
        <span className="is-entity">Daily edition</span>
        <span className="is-source">{railSourceCount} sources</span>
        <span>Memory</span>
      </div>
      <div className="rd-v2-agent-thread">
        <div className="rd-v2-msg rd-v2-msg-user">What changed today?</div>
        <div className="rd-v2-msg rd-v2-msg-agent">
          <strong>{model.agentLead}</strong>
          <p>{model.agentBody}</p>
          <div className="rd-v2-trace">
            <small>Trace - {model.agentTrace.length} steps completed</small>
            {model.agentTrace.map((step) => <span key={step}>{step}</span>)}
          </div>
        </div>
        <button
          type="button"
          className="rd-v2-drawer-toggle"
          onClick={() => onOpenReports?.()}
        >
          Context - {model.agentEntities.length} entities - 4 threads - {railSourceCount} sources
        </button>
        <section className="rd-v2-agent-context">
          <div className="rd-v2-context-head"><span>Entities</span><span>{model.agentEntities.length}</span></div>
          {model.agentEntities.map(([icon, name, badge, detail]) => (
            <div className="rd-v2-entity" key={name}>
              <span>{icon}</span>
              <strong>{name}</strong>
              {badge && <em>{badge}</em>}
              <b>{detail}</b>
            </div>
          ))}
        </section>
        <section className="rd-v2-agent-threads">
          <div className="rd-v2-context-head"><span>Threads</span><span>4</span></div>
          <div className="rd-v2-thread-pills">
            <span>Home</span>
            <span>5 entities</span>
            <span>opus-4</span>
          </div>
        </section>
      </div>
      <footer className="rd-v2-agent-composer">
        <input placeholder="Ask about today's pulse..." onKeyDown={(event) => {
          if (event.key === "Enter") onAsk?.((event.currentTarget as HTMLInputElement).value);
        }} />
        <button
          type="button"
          onClick={() => onAsk?.("What changed today? Include report handles, source rows, tool trace, estimated cost, and next actions.")}
        >
          {"\u2191"}
        </button>
        <div className="rd-v2-agent-tools">
          <span>+ Context</span>
          <span>@ Reference</span>
          <span>/ Command</span>
          <span>Attach</span>
          <span>to send</span>
        </div>
      </footer>
    </aside>
  );
}

function EditionGroup({ label, count, onSelect }: { label: string; count: string; onSelect?: (label: string) => void }) {
  return (
    <button type="button" className="rd-v2-edition-group" onClick={() => onSelect?.(label)}>
      <span>&gt;</span>
      <span>{label}</span>
      <b>{count}</b>
    </button>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rd-v2-stat" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProofCard({ title, body, tag, highlight }: { title: string; body: string; tag?: string; highlight?: boolean }) {
  return (
    <article className="rd-v2-proof-card">
      <h4>{title}</h4>
      <p>{body}</p>
      {tag && <span className={highlight ? "is-highlight" : ""}>{tag}</span>}
    </article>
  );
}
