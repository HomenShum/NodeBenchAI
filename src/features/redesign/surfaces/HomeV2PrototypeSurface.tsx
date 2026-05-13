import { useState } from "react";
import type { ReactNode } from "react";
import type { LiveArtifactsResult } from "../hooks/useLiveArtifacts";

interface HomeV2SurfaceProps {
  onAsk?: (prompt: string) => void;
  liveArtifacts?: LiveArtifactsResult;
}

interface PrototypeSelectionProps extends HomeV2SurfaceProps {
  selectedEntity?: string;
  onSelectEntity?: (entity: string) => void;
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
    delta: "▲ 3 from last run",
    kind: "Partnership intelligence - Company",
    body: "Enterprise tier repriced +40%; Claude 4 Opus structure held. Managed Agent tier launched at $0.168/1K tokens.",
    tags: ["Partnership", "AI", "Enterprise"],
    ref: "Board prep - Q2 strategy - Vendor review",
    meta: "Confidence 91 · 12 sources · 2 open claims · refreshed 2h ago",
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
    delta: "▼ declining",
    kind: "Term sheet analysis - Investor",
    body: "Full-ratchet anti-dilution at 1x in term sheet v3; 33% below market norm. Board observer seat added at $83M.",
    tags: ["Fundraising", "Term sheet", "Action needed"],
    ref: "Cap table model - Dilution analysis - Deal memo",
    meta: "Confidence 74 · 8 sources · 3 open claims · review needed",
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
    delta: "▲ 2 from last run",
    kind: "Competitive intelligence - Competitor",
    body: "Pricing dropped to $199/mo from $349; SOC 2 Type II obtained. Feature gap narrowing on automated QA.",
    tags: ["Competitive", "QA", "Enterprise"],
    ref: "Competitive matrix - Pricing comparison",
    meta: "Confidence 88 · 5 sources · 1 open claim · refreshed 1d ago",
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
    delta: "▼ stale",
    kind: "Market intelligence - Company",
    body: "GPT-5 announcement rumored but unverified; 2 of 5 claims stale after 3 days. Refresh needed.",
    tags: ["AI", "Unverified"],
    ref: "Competitive matrix - API cost model",
    meta: "Confidence 62 · 4 sources · 3 stale claims · refresh needed",
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
    delta: "▼ stale",
    kind: "Coverage gap - Company",
    body: "No new signals in 5 days; only 1 of 3 sources still verifiable. Refresh the research and update model capability notes.",
    tags: ["AI", "Research", "Refresh"],
    ref: "Model capability watch - Source ledger",
    meta: "Confidence 55 · 3 sources · 2 stale claims · refresh needed",
    dims: { Sources: 48, Freshness: 35, Verification: 45, Coverage: 55 },
    signals: ["No new signals in 5 days", "Only 1 of 3 sources still verifiable", "Research tracker needs owner review"],
    related: ["Anthropic", "OpenAI", "Sequoia Capital"],
  },
];

type PrototypeReportEntity = (typeof reportEntities)[number];

function getPrototypeEntity(name = "Anthropic"): PrototypeReportEntity {
  return reportEntities.find((entity) => entity.name === name) ?? reportEntities[0];
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

interface HomeV2Model {
  editionItems: typeof editionItems;
  editionLine: string;
  heroSub: string;
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
        title: "It changes the reading order before it changes the thesis",
        deck: "The brief is useful because it tells you what deserves attention now.",
        body: `${evidenceLine} Ranking favors items that touch a saved report, have reusable source rows, or create a concrete next step.`,
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
      selectedScore: "91 strong",
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
        ["A", "Anthropic", "Verified", "91"],
        ["S", "Sequoia Capital", "Review", "74"],
        ["B", "Bug0", "", "68"],
        ["O", "OpenAI", "", "62"],
        ["D", "DeepMind", "", "55"],
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
  const entityRows = reports.slice(0, 5).map((report) => [
    monogram(report.entity),
    report.entity,
    report.status === "verified" ? "Verified" : report.status === "review" ? "Review" : "",
    String(Math.round(Math.min(99, Math.max(40, report.sources * 7 + report.claims * 3)))),
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

  return {
    editionItems: liveEditionItems.length > 0 ? liveEditionItems : editionItems.map((item) => ({
      ...item,
      title: item.today ? "Live status" : item.title,
      body: item.today ? actionBody : item.body,
    })),
    editionLine,
    heroSub: hasLive
      ? "A source-backed brief ranks what changed, why it matters, and which reports need attention now."
      : "NodeBench is connected to the live memory path. This view stays explicit while Convex returns data instead of masking the state with fixture content.",
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
    agentLead: hasLive ? "Live memory returned reusable context." : liveArtifacts.isLoading ? "Loading live memory now." : "No live reports returned yet.",
    agentBody: hasLive
      ? actionBody
      : liveArtifacts.isLoading
        ? "The briefing rail is waiting for Convex-backed archive and daily brief queries."
        : "Run a report, daily brief, or archive-backed workflow to populate this rail.",
    agentTrace: hasLive ? ["convex_archive", "daily_brief", "signal_rank"] : ["convex_query", "empty_state", "no_fixture_fallback"],
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

export function PrototypeV2LeftRail({ surface, selectedEntity = "Anthropic", onSelectEntity }: { surface: PrototypeSurface } & PrototypeSelectionProps) {
  if (surface === "home") return <HomeV2EditionRail />;
  if (surface === "reports") {
    return (
      <aside className="rd-v2-left rd-v2-left--nav" aria-label="Reports navigation">
        <input className="rd-v2-rail-search" placeholder="Filter entities..." aria-label="Filter entities" />
        <div className="rd-v2-rail-rule" />
        <RailGroup label="Companies" count="12" selectedName={selectedEntity} onSelectItem={onSelectEntity} items={[
          ["A", "Anthropic", "3", true],
          ["S", "Sequoia Capital", "2"],
          ["B", "Bug0", "1"],
          ["O", "OpenAI", ""],
          ["G", "Google DeepMind", ""],
          ["M", "Mistral", ""],
        ]} />
        <RailGroup label="People" count="8" items={[
          ["•", "Dario Amodei", ""],
          ["•", "Alfred Lin", ""],
          ["•", "Sam Altman", ""],
        ]} />
        <RailGroup label="Topics" count="5" items={[["#", "Fundraise", ""], ["#", "Pricing", ""], ["#", "Hiring", ""]]} />
        <button className="rd-v2-new-entity">+ New entity</button>
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
        <span>HS</span>
        <div><strong>Homen Shum</strong><p>Founder · Builder</p></div>
      </div>
      <div className="rd-v2-rail-rule" />
      <NavItem label="Identity" active marker="🧠" />
      <NavItem label="Preferences" marker="⚙" />
      <NavItem label="Integrations" marker="🔗" />
      <NavItem label="Permissions" marker="🔒" />
      <NavItem label="Style profile" marker="🎨" />
      <div className="rd-v2-rail-rule" />
      <div className="rd-v2-memory-stats">
        <div><span>Observations</span><strong>847</strong></div>
        <div><span>Corrections</span><strong>23</strong></div>
        <div><span>Last updated</span><strong>2m ago</strong></div>
      </div>
      <button className="rd-v2-sign-out">Sign out</button>
    </aside>
  );
}

export function PrototypeV2Center({ surface, onAsk, selectedEntity = "Anthropic", onSelectEntity }: { surface: PrototypeSurface } & PrototypeSelectionProps) {
  if (surface === "home") return <HomeV2Surface onAsk={onAsk} />;
  if (surface === "reports") return <ReportsPrototypeCenter selectedEntity={selectedEntity} onSelectEntity={onSelectEntity} />;
  if (surface === "chat") return <ChatPrototypeCenter />;
  if (surface === "inbox") return <InboxPrototypeCenter />;
  return <MePrototypeCenter />;
}

export function PrototypeV2RightRail({ surface, onAsk, selectedEntity = "Anthropic", onSelectEntity }: { surface: PrototypeSurface } & PrototypeSelectionProps) {
  if (surface === "home") return <HomeV2BriefingRail onAsk={onAsk} />;
  if (surface === "reports") return <ReportsPrototypeRail onAsk={onAsk} selectedEntity={selectedEntity} onSelectEntity={onSelectEntity} />;
  if (surface === "chat") return <ChatPrototypeRail />;
  if (surface === "inbox") return <InboxPrototypeRail onAsk={onAsk} />;
  return <MePrototypeRail onAsk={onAsk} />;
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
    <div className="rd-v2-proto-center">
      <div className="rd-v2-edition-row">
        <span className="rd-v2-edition-pill">Entity intelligence</span>
        <span className="rd-v2-edition-subline">12 entities · 83% verified · avg score 87 · 48 sources</span>
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
  const pillClassName = (_pill: string, index: number) => {
    const classes = ["rd-v2-agent-pill"];
    if (index === 0) classes.push("is-active");
    if (title === "Coverage agent") {
      if (index === 1) classes.push("is-entity");
      if (index === 2) classes.push("is-source");
    }
    if (title === "Triage agent" && index === 1) classes.push("is-entity");
    return classes.join(" ");
  };

  return (
    <aside className="rd-pane rd-pane--right rd-v2-briefing" aria-label={title}>
      <header className="rd-v2-agent-head">
        <div className="rd-v2-agent-head-row">
          <span className="rd-v2-agent-dot" />
          <strong>{title}</strong>
          <button type="button" aria-label="Expand rail">{"\u2197"}</button>
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

function ReportsPrototypeRail({ onAsk, selectedEntity = "Anthropic", onSelectEntity }: PrototypeSelectionProps) {
  const entity = getPrototypeEntity(selectedEntity);
  const reviewText = entity.score < 75 ? `${entity.name} needs review.` : `${entity.name} is in good shape.`;
  const summaryText = entity.score < 75
    ? `${entity.name} is below coverage threshold. Refresh sources, verify open claims, and decide whether the report needs a notebook patch.`
    : `${entity.name} has current sources and enough verified claims for the present coverage task. Keep it on watch.`;

  return (
    <AgentShell
      title="Coverage agent"
      context={`Reports · 5 entities · 48 sources · ${entity.sources} active`}
      pills={["Reports", entity.name, `${entity.sources} sources`, `Score ${entity.score}`]}
      question="Which reports need work?"
      placeholder="Ask about these reports..."
      onAsk={onAsk}
    >
      <div className="rd-v2-msg rd-v2-msg-agent">
        <strong>{reviewText}</strong>
        <p>{summaryText}</p>
        <div className="rd-v2-trace"><small>3 steps completed</small><span>entity_health</span><span>freshness_scan</span><span>claim_verify</span></div>
      </div>
      <button className="rd-v2-drawer-toggle">{`Context · ${entity.name} ${entity.score} · ${entity.signals.length} signals · ${entity.related.length} entities`}</button>
      <section className="rd-v2-agent-context">
        <div className="rd-v2-context-head"><span>Active entity</span><span>{entity.score}</span></div>
        <div className="rd-v2-score-big">{entity.score} <small>{entity.delta}</small></div>
        {Object.entries(entity.dims).map(([label, value]) => (
          <div className="rd-v2-score-row" key={label}>
            <span>{label}</span>
            <b><i data-tone={value >= 80 ? "green" : value >= 58 ? "accent" : "amber"} style={{ width: `${value}%` }} /></b>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <section className="rd-v2-agent-context">
        <div className="rd-v2-context-head"><span>Recent signals</span><span>{entity.signals.length}</span></div>
        {entity.signals.map((signal) => <p className="rd-v2-signal-line" key={signal}>{signal}</p>)}
      </section>
      <section className="rd-v2-agent-context">
        <div className="rd-v2-context-head"><span>Related entities</span><span>{entity.related.length}</span></div>
        {entity.related.map((name) => {
          const related = getPrototypeEntity(name);
          return (
            <button className="rd-v2-related-entity" key={name} onClick={() => onSelectEntity?.(name)}>
              <span>{related.initial}</span><strong>{name}</strong><b>{related.score}</b>
            </button>
          );
        })}
      </section>
    </AgentShell>
  );
}

function ChatPrototypeRail() {
  const [activeTab, setActiveTab] = useState("Entity");
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
    Graph: <section className="rd-v2-util-list"><h3>Graph neighborhood</h3><p><strong>Sequoia</strong> connects to YC AI Ops, Alfred Lin, cap table model, and board prep.</p><p><strong>Closest report</strong><span>Term Sheet Analysis</span></p></section>,
    Sources: <section className="rd-v2-util-list"><h3>Sources</h3><p><strong>Term sheet v3</strong><span>PDF</span></p><p><strong>Cap table model</strong><span>Sheet</span></p><p><strong>Cooley primer</strong><span>Reference</span></p></section>,
    Threads: <section className="rd-v2-util-list"><h3>Threads</h3><p><strong>Ratchet clause analysis</strong><span>3 messages</span></p><p><strong>Board deck prep</strong><span>2 messages</span></p></section>,
    Notebook: <section className="rd-v2-util-list"><h3>Notebook patch</h3><p><strong>Proposed edit</strong><span>pending</span></p><p>Add dilution table, counsel review, and counterproposal summary.</p></section>,
    Report: <section className="rd-v2-util-list"><h3>Report</h3><p><strong>Status</strong><span>Saved</span></p><p><strong>Claims</strong><span>7 total</span></p><p><strong>Open</strong><span>2 pending</span></p></section>,
  };

  return (
    <aside className="rd-pane rd-pane--right rd-v2-utility" aria-label="Context">
      <header className="rd-v2-util-head"><strong>Context</strong><button>{"\u2197"}</button></header>
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
        <div className="rd-v2-trace"><small>3 steps completed</small><span>term_sheet_parse</span><span>dilution_calc</span><span>calendar_check</span></div>
      </div>
      <button className="rd-v2-drawer-toggle">Context · Sequoia 74 · 2 threads</button>
      <article className="rd-v2-util-card">
        <div className="rd-v2-report-title"><span>S</span><h2>Sequoia Capital</h2><b>74</b></div>
        <p>• Active term sheet negotiation<br />• $1.2M partnership · 3 prior rounds<br />• Last report: 6h ago</p>
      </article>
      <div className="rd-v2-agent-insight"><strong>Agent insight</strong><p>Full-ratchet clause creates 14.3pp dilution gap at $48M. Counter with narrow-based weighted-average as floor.</p></div>
      <section className="rd-v2-action-card-list">
        {["Draft reply", "Flag for legal", "Forward to counsel", "Defer"].map((action, index) => (
          <button key={action} className={index === 0 ? "is-primary" : ""}>{action}</button>
        ))}
      </section>
    </AgentShell>
  );
}

function MePrototypeRail({ onAsk }: HomeV2SurfaceProps) {
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
        <div className="rd-v2-trace"><small>3 steps completed</small><span>memory_scan</span><span>preference_log</span><span>profile_update</span></div>
      </div>
      <button className="rd-v2-drawer-toggle">Context · Voice · Permissions · Usage</button>
      <section className="rd-v2-settings-list">
        <h3>Voice profile</h3>
        <p><span>Tone</span><strong>Direct, tactical</strong></p>
        <p><span>Format</span><strong>{"Decision -> Why -> Plan"}</strong></p>
        <p><span>Jargon level</span><strong>High (match user)</strong></p>
        <h3>Permissions</h3>
        <p>• Web search: <b>Enabled</b></p>
        <p>• File access: <b>Enabled</b></p>
        <p>• Post to LinkedIn: <em>Approval required</em></p>
        <p>• Send email: <em>Approval required</em></p>
        <p>• Execute trades: <em>Disabled</em></p>
        <h3>Session stats</h3>
        <p><span>Memory hits</span><strong>71%</strong></p>
        <p><span>Corrections</span><strong>23</strong></p>
        <p><span>Current mode</span><strong>Builder</strong></p>
      </section>
      <section className="rd-v2-action-card-list">
        <button className="is-primary">Review memory update</button>
        <button>Export USER.md</button>
        <button>Open permissions</button>
      </section>
    </AgentShell>
  );
}

export function HomeV2EditionRail({ liveArtifacts }: { liveArtifacts?: LiveArtifactsResult } = {}) {
  const model = buildHomeV2Model(liveArtifacts);
  return (
    <aside className="rd-v2-left" aria-label="Edition browser">
      <div className="rd-v2-edition-month">May 2026</div>
      {model.editionItems.map((item) => (
        <div key={item.day} className="rd-v2-edition-block">
          <button type="button" className={`rd-v2-edition-date ${item.today ? "is-today" : ""}`}>
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
      <EditionGroup label="Week of May 4" count="5" />
      <EditionGroup label="Week of Apr 27" count="7" />
      <div className="rd-v2-rail-rule" />
      <EditionGroup label="April 2026" count="28" />
      <EditionGroup label="March 2026" count="31" />
      <EditionGroup label="February 2026" count="28" />
      <div className="rd-v2-rail-rule" />
      <EditionGroup label="Q4 2025" count="62" />
    </aside>
  );
}

function findBriefSection(model: HomeV2Model, label: string, fallbackIndex: number): HomeV2BriefSection {
  return model.dailyBriefSections.find((section) => section.title.toLowerCase().includes(label)) ??
    model.dailyBriefSections[fallbackIndex] ??
    model.dailyBriefSections[0];
}

function firstBriefItem(section: HomeV2BriefSection | undefined): HomeV2BriefItem | undefined {
  return section?.items.find((item) => item.title || item.body);
}

function LivePulseLanding({ model, onAsk }: { model: HomeV2Model; onAsk?: (text: string) => void }) {
  const whatChanged = findBriefSection(model, "changed", 0);
  const whyMatters = findBriefSection(model, "matters", 1);
  const nextMove = findBriefSection(model, "move", 2);
  const reportsTouched = findBriefSection(model, "reports", 3);
  const sourcesUsed = findBriefSection(model, "sources", 4);
  const actionsCreated = findBriefSection(model, "actions", 5);
  const nextItem = firstBriefItem(nextMove);
  const leadTitle = model.dailyBriefTitle.toLowerCase();
  const seenLeadItems = new Set<string>();
  const leadItems = whatChanged.items.filter((item) => {
    const key = item.title.toLowerCase();
    if (!key || key === leadTitle || seenLeadItems.has(key)) return false;
    seenLeadItems.add(key);
    return true;
  }).slice(0, 2);
  const cardSections = [reportsTouched, sourcesUsed, actionsCreated];

  return (
    <section className="rd-v2-pulse" data-testid="home-v2-pulse-landing" aria-labelledby="home-v2-pulse-title">
      <div className="rd-v2-pulse-topline" aria-label="Daily Brief status">
        <span>Daily Brief</span>
        <span>{model.editionLine}</span>
      </div>

      <div className="rd-v2-pulse-head">
        <p className="rd-v2-pulse-kicker">For your coverage book</p>
        <h1 id="home-v2-pulse-title">Today for you</h1>
        <p>{model.heroSub}</p>
      </div>

      <div className="rd-v2-pulse-grid">
        <article className="rd-v2-pulse-lead">
          <div className="rd-v2-card-kicker">What changed</div>
          <h2>{model.dailyBriefTitle}</h2>
          <p>{whatChanged.body || model.dailyBriefDek}</p>
          {leadItems.length > 0 && (
            <ul className="rd-v2-pulse-list">
              {leadItems.map((item, index) => (
                <li key={`${item.title}-${index}`}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="rd-v2-pulse-actions">
            <button className="rd-v2-btn-primary" onClick={() => onAsk?.(`Open today's Daily Brief: ${model.dailyBriefTitle}`)}>
              Ask in Chat
            </button>
            <button onClick={() => onAsk?.("Open the reports touched by today's Daily Brief.")}>
              Open reports
            </button>
          </div>
        </article>

        <div className="rd-v2-pulse-side">
          <article className="rd-v2-pulse-note">
            <div className="rd-v2-card-kicker">Why it matters</div>
            <h3>{whyMatters.title}</h3>
            <p>{whyMatters.body}</p>
          </article>
          <article className="rd-v2-pulse-note rd-v2-pulse-note--accent">
            <div className="rd-v2-card-kicker">Next move</div>
            <h3>{nextItem?.title ?? nextMove.title}</h3>
            <p>{nextItem?.body ?? nextMove.body}</p>
            <button onClick={() => onAsk?.(nextItem?.title ? `Help me with: ${nextItem.title}` : "Turn today's Daily Brief into next actions.")}>
              Work this
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

      <div className="rd-v2-share-bar rd-v2-share-bar--pulse" aria-label="Share edition">
        <span>Share</span>
        <button className="rd-v2-share-primary">Email digest</button>
        <button>LinkedIn</button>
        <button>Slack</button>
        <button>Copy link</button>
        <button>PDF</button>
      </div>
    </section>
  );
}

export function HomeV2Surface({ onAsk, liveArtifacts }: HomeV2SurfaceProps) {
  const model = buildHomeV2Model(liveArtifacts);
  const isLiveHome = Boolean(liveArtifacts);
  return (
    <div className="rd-v2-home">
      {isLiveHome ? (
        <LivePulseLanding model={model} onAsk={onAsk} />
      ) : (
        <>
          <div className="rd-v2-edition-row">
            <span className="rd-v2-edition-pill">Daily edition</span>
            <span className="rd-v2-edition-subline">{model.editionLine}</span>
          </div>

          <div className="rd-v2-share-bar" aria-label="Share edition">
            <span>Share</span>
            <button className="rd-v2-share-primary">Email digest</button>
            <button>LinkedIn</button>
            <button>Slack</button>
            <button>Copy link</button>
            <button>PDF</button>
          </div>

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

export function HomeV2BriefingRail({ onAsk, liveArtifacts }: HomeV2SurfaceProps) {
  const model = buildHomeV2Model(liveArtifacts);
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
        <span className="is-source">{liveArtifacts ? `${liveArtifacts.reports.reduce((total, report) => total + report.sources, 0)} sources` : "12 sources"}</span>
        <span>Memory</span>
      </div>
      <div className="rd-v2-agent-thread">
        <div className="rd-v2-msg rd-v2-msg-user">What changed today?</div>
        <div className="rd-v2-msg rd-v2-msg-agent">
          <strong>{model.agentLead}</strong>
          <p>{model.agentBody}</p>
          <div className="rd-v2-trace">
            <small>{model.agentTrace.length} steps completed</small>
            {model.agentTrace.map((step) => <span key={step}>{step}</span>)}
          </div>
        </div>
        <button className="rd-v2-drawer-toggle">Context - 5 entities - 4 threads - 4 sources</button>
        <section className="rd-v2-agent-context">
          <div className="rd-v2-context-head"><span>Entities</span><span>{model.agentEntities.length}</span></div>
          {model.agentEntities.map(([icon, name, badge, score]) => (
            <div className="rd-v2-entity" key={name}>
              <span>{icon}</span>
              <strong>{name}</strong>
              {badge && <em>{badge}</em>}
              <b>{score}</b>
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
        <button type="button" onClick={() => onAsk?.("What changed today?")}>{"\u2191"}</button>
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

function EditionGroup({ label, count }: { label: string; count: string }) {
  return (
    <button type="button" className="rd-v2-edition-group">
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
