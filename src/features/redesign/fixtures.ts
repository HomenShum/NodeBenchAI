/**
 * NodeBench Redesign — Fixture data
 *
 * Source-of-truth content for the demo /redesign showcase. All numbers reflect
 * the spec the user provided (memory pulse metrics, event corpus, capture flow).
 *
 * Replace with live Convex queries before promoting to default UI.
 */

export type SurfaceId = "home" | "reports" | "chat" | "inbox" | "me";

export type Density = "compact" | "grid" | "list";

export interface PulseMetric {
  label: string;
  value: string;
  delta?: string;
  hint?: string;
}

export const memoryPulse: PulseMetric[] = [
  { label: "Entities tracked", value: "42,810", delta: "+184 today" },
  { label: "Relationships mapped", value: "183,204", delta: "+412 today" },
  { label: "Reports created", value: "18,204" },
  { label: "Answers from memory", value: "71%", delta: "126,000 searches avoided" },
  { label: "Sources refreshed", value: "9,420", hint: "this week" },
  { label: "Avg sourced answer", value: "3.4s" },
];

export interface PulseCard {
  kind: "memory_win" | "report_update" | "follow_up" | "event";
  title: string;
  body: string;
  meta: string;
  cta?: string;
}

// Latest public research cards — Pitchbook/CB Insights entity-card pattern.
// Mirrors live nodebenchai.com "Reusable public memory from recent entity runs"
// and adds the magnetic primitives: delta arrows, signal class, sources count, last-refreshed.
export type EntityClass = "company" | "person" | "topic" | "role" | "event";
export type SignalClass = "hiring" | "funding" | "shipping" | "coverage" | "regulatory" | "leadership" | "research";

export interface PublicResearchCard {
  /** Optional saved/live report route id. Present for Convex-backed artifact cards. */
  reportId?: string;
  entity: string;
  entityClass: EntityClass;
  kind: string;             // legacy display label, e.g. "ROLE · READY"
  whenAgo: string;
  signal: string;
  signalClass: SignalClass;
  delta: number;            // signed change (claims added vs last snapshot)
  trendUp: boolean;
  claims: number;
  sources: number;
  confidence: number;       // 0..1
  iconChar?: string;        // monogram or emoji (used when no logo)
}

export const publicResearch: PublicResearchCard[] = [
  {
    entity: "OpenAI",
    entityClass: "company",
    kind: "Hiring · 4 new roles",
    whenAgo: "2h ago",
    signal: "Posted Forward Deploy Engineer + 3 GenAI roles — heavy enterprise tilt",
    signalClass: "hiring",
    delta: 4,
    trendUp: true,
    claims: 12,
    sources: 6,
    confidence: 0.91,
    iconChar: "AI",
  },
  {
    entity: "Mercor",
    entityClass: "company",
    kind: "Funding · Series B closed",
    whenAgo: "11m ago",
    signal: "+$30M Series B led by General Catalyst; valuation 2× last round",
    signalClass: "funding",
    delta: 5,
    trendUp: true,
    claims: 18,
    sources: 9,
    confidence: 0.88,
    iconChar: "Mc",
  },
  {
    entity: "DISCO",
    entityClass: "company",
    kind: "Coverage · diligence brief",
    whenAgo: "1h ago",
    signal: "SOC2 Type II achieved — clears the legal-AI procurement gate",
    signalClass: "regulatory",
    delta: 3,
    trendUp: true,
    claims: 14,
    sources: 7,
    confidence: 0.84,
    iconChar: "Di",
  },
  {
    entity: "Anthropic",
    entityClass: "company",
    kind: "Shipping · MCP host extensions",
    whenAgo: "3h ago",
    signal: "Confirmed for Q3 ship; agent SDK + Claude Code lanes now public",
    signalClass: "shipping",
    delta: 2,
    trendUp: true,
    claims: 8,
    sources: 4,
    confidence: 0.90,
    iconChar: "An",
  },
  {
    entity: "Voice-agent evaluation",
    entityClass: "topic",
    kind: "Theme · 2 new vendors",
    whenAgo: "3h ago",
    signal: "Crowded but unowned — 6 vendors, only 1 targets healthcare (Orbital)",
    signalClass: "research",
    delta: 2,
    trendUp: true,
    claims: 11,
    sources: 5,
    confidence: 0.66,
    iconChar: "VE",
  },
  {
    entity: "Foundation Labs",
    entityClass: "company",
    kind: "Coverage · positioning",
    whenAgo: "Yesterday",
    signal: "New landscape map — category edges shifting toward eval infra",
    signalClass: "coverage",
    delta: 1,
    trendUp: true,
    claims: 6,
    sources: 3,
    confidence: 0.74,
    iconChar: "FL",
  },
];

// Situation cards — Notion/Linear "Templates Gallery" pattern with previews.
// Mirrors live "Pick the situation" but adds: preview thumbnail, time estimate, uses count.
export type SituationWindow = "today" | "week" | "month";

export interface SituationCard {
  window: SituationWindow;
  persona: string;
  title: string;
  description: string;
  exports: string[];
  chips: string[];
  previewLines: string[];  // 3-5 short lines that approximate the saved report's structure
  estimateMinutes: number; // rough time-to-report
  usesCount: number;       // social proof: how many ran this template recently
}

export const situations: SituationCard[] = [
  {
    window: "today",
    persona: "Teacher",
    title: "Relocation and school culture read",
    description:
      "Research a school, principal, district, and nearby staff culture before a relocation conversation. Include reviews, salary clues, commute, public signals, and what to ask current teachers.",
    exports: ["Apple Notes", "Notion", "OneNote"],
    chips: ["reviews and scattered forums", "salary and district context", "questions to ask people"],
    previewLines: [
      "# School snapshot",
      "Principal · culture · staff turnover",
      "Salary band + commute calc",
      "Questions to ask · what to listen for",
    ],
    estimateMinutes: 4,
    usesCount: 312,
  },
  {
    window: "today",
    persona: "Banker",
    title: "Pre-meeting diligence on a private mid-market borrower",
    description:
      "Pull entity tear-sheet: ownership, recent filings, hiring spike, sector signal, peer comps, news, and red flags to validate before the meeting.",
    exports: ["Notion", "Linear", "CSV"],
    chips: ["filings and hiring", "peer comps", "red flags to verify"],
    previewLines: [
      "# Tear-sheet · Ownership · Capital",
      "Recent filings + hiring delta",
      "Peer comps table (3 names)",
      "Red flags to validate live",
    ],
    estimateMinutes: 6,
    usesCount: 1840,
  },
  {
    window: "week",
    persona: "Founder",
    title: "Watch competitors and nudge me when something moves",
    description:
      "Set up a watchlist for 4 named competitors, sweep their site/changelog/team weekly, and ping when hiring, pricing, or product surface changes.",
    exports: ["Slack", "Notion"],
    chips: ["weekly sweep", "diff vs last week", "Slack ping when meaningful"],
    previewLines: [
      "Watchlist (4 entities)",
      "Weekly diff vs last sweep",
      "Slack ping rules per signal class",
      "Optional digest email",
    ],
    estimateMinutes: 8,
    usesCount: 962,
  },
  {
    window: "month",
    persona: "Operator",
    title: "Track and export pipeline + customer signals",
    description:
      "Bundle CRM + recent signals + meeting notes into a single monthly memo with citations and CSV export to refresh the deck.",
    exports: ["CSV", "Notion", "Linear"],
    chips: ["pipeline rollup", "customer signal summary", "ready-to-paste memo"],
    previewLines: [
      "# Monthly ops memo",
      "Pipeline rollup + delta",
      "Top 5 customer signals",
      "CSV export for slide deck",
    ],
    estimateMinutes: 10,
    usesCount: 487,
  },
];

export const pulseCards: PulseCard[] = [
  {
    kind: "memory_win",
    title: "Orbital Labs answered from event corpus",
    body: "4 sources reused. 0 paid calls. The reusable memory loop is paying down.",
    meta: "2m ago · Ship Demo Day",
    cta: "Explore",
  },
  {
    kind: "report_update",
    title: "Ship Demo Day report updated",
    body: "12 captures · 8 companies · 14 people · 9 follow-ups",
    meta: "11m ago · Event corpus",
    cta: "Open report",
  },
  {
    kind: "follow_up",
    title: "Alex at Orbital Labs",
    body: "Ask about healthcare pilot criteria. Tag: Watching · pilot.",
    meta: "Due tomorrow",
    cta: "Add to chat",
  },
  {
    kind: "event",
    title: "Shipped: voice-agent eval pilot lead",
    body: "Linked to Orbital Labs entity. CRM export queued.",
    meta: "1h ago",
    cta: "Approve export",
  },
];

export interface ReportCardData {
  id: string;
  entity: string;
  kind: string;
  status: "verified" | "review" | "watching";
  description: string;
  sources: number;
  claims: number;
  followUps: number;
  updatedAt: string;
}

export const reports: ReportCardData[] = [
  {
    id: "rep_orbital",
    entity: "Orbital Labs",
    kind: "Diligence",
    status: "watching",
    description: "Voice-agent eval infra. Healthcare design partner angle.",
    sources: 14,
    claims: 7,
    followUps: 3,
    updatedAt: "2h ago",
  },
  {
    id: "rep_ship_demo",
    entity: "Ship Demo Day",
    kind: "Event",
    status: "verified",
    description: "12 captures. 8 companies surfaced. Strong pilot intent on 3.",
    sources: 41,
    claims: 22,
    followUps: 9,
    updatedAt: "11m ago",
  },
  {
    id: "rep_anthropic",
    entity: "Anthropic",
    kind: "Coverage",
    status: "verified",
    description: "Model line + product roadmap. Enterprise / API / Claude Code lanes.",
    sources: 28,
    claims: 16,
    followUps: 2,
    updatedAt: "Yesterday",
  },
  {
    id: "rep_voice_eval",
    entity: "Voice-agent evaluation",
    kind: "Theme",
    status: "review",
    description: "Cross-entity rollup: 6 vendors, 3 academic groups, 2 regulators.",
    sources: 19,
    claims: 11,
    followUps: 4,
    updatedAt: "3d ago",
  },
];

export interface ChatTrace {
  step: string;
  status: "ok" | "info" | "warn";
  detail: string;
  durationMs?: number;
}

export interface ChatRuntimeArtifact {
  id: string;
  label: string;
  status: string;
  detail: string;
  confidence?: number;
  riskTier?: "low" | "medium" | "high";
  costUsd?: number;
}

export interface ChatClaimCheck {
  idx: number;
  status: string;
  method?: string;
  source?: string;
  detail?: string;
  verified?: boolean;
  validationError?: string;
  verificationState?: "verified" | "cached_reference" | "provider_grounded" | "fetch_blocked" | "unsupported";
  verificationDetail?: string;
  blocking?: boolean;
}

export interface ChatRunMetrics {
  runId?: string;
  totalLatencyMs?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  paidCalls?: number;
  sourceCount?: number;
  verifiedSourceCount?: number;
  softWarningSourceCount?: number;
  unsupportedSourceCount?: number;
  cachedSourceCount?: number;
  fetchBlockedSourceCount?: number;
  providerGroundedSourceCount?: number;
  toolCallCount?: number;
  liveSearchCalls?: number;
  memoryHitRate?: number;
  sourceCacheHitRate?: number;
  timeToFirstSourceMs?: number | null;
  timeToFinalMs?: number;
}

export interface ChatRuntimeTrace {
  boardState?: Record<string, unknown>;
  contextCandidates?: ChatRuntimeArtifact[];
  toolDecisions?: ChatRuntimeArtifact[];
  claimChecks?: ChatClaimCheck[];
  metrics?: ChatRunMetrics;
  contextPacket?: {
    hasContext: boolean;
    contextRef: string | null;
    contextKind: "graph_packet" | "report" | "none";
    reportId: string | null;
    artifactKey: string | null;
    title: string;
    summary: string;
    selectedContext: string[];
    rejectedContext: string[];
    sourceRefs: Array<{ title: string; url?: string; source?: string; publishedAt?: string; excerpt?: string }>;
    graph: {
      mode: "bounded_packet";
      nodeCount: number;
      edgeCount: number;
      clusters: Array<{ name: "used" | "changed" | "needs_review" | "blocked"; count: number; sample: string[] }>;
    };
    notebook: { sectionTitles: string[]; htmlPreview?: string };
    verification: { tier: "deterministic" | "retrieval" | "judge_required"; decisions: string[] };
    telemetry: { memoryHit: boolean; sourceCacheHit: boolean; candidateCount: number };
  };
  liveGroundingDecision?: {
    useLiveGrounding: boolean;
    reason: string;
    confidence: number;
    freshnessIntent: boolean;
    memorySufficient: boolean;
    signals: string[];
  };
}

export interface ChatAnswer {
  shortAnswer: string;
  whyItMatters: string;
  evidence: {
    idx: number;
    quote: string;
    source: string;
    sourceProvider?: string;
    verified?: boolean;
    verifiedAt?: number;
    validationError?: string;
    verificationState?: "verified" | "cached_reference" | "provider_grounded" | "fetch_blocked" | "unsupported";
    verificationDetail?: string;
    blocking?: boolean;
  }[];
  risks: string[];
  nextAction: string;
  sourceCount: number;
  paidCalls: number;
  fromMemory: boolean;
  trace: ChatTrace[];
  runtime?: ChatRuntimeTrace;
}

export const sampleAnswer: ChatAnswer = {
  shortAnswer:
    "Orbital Labs builds voice-agent evaluation infrastructure with a clear lean toward healthcare pilots. Strong fit for a regulated-industry coverage thread.",
  whyItMatters:
    "If they validate a healthcare pilot in Q3, the evaluation surface becomes a wedge against generic LLM-eval vendors. Adjacent to your existing voice + diligence portfolio.",
  evidence: [
    { idx: 1, quote: "Eval framework supports per-utterance grading with HIPAA-aware tagging.", source: "Orbital Labs whitepaper, p.4" },
    { idx: 2, quote: "Looking for healthcare design partners — capital not the constraint.", source: "Founder note, Ship Demo Day" },
    { idx: 3, quote: "Active partner discussions with two regional hospital systems.", source: "Notion meeting recap, Apr 30" },
  ],
  risks: [
    "Healthcare regulatory burden could compress runway if procurement stalls.",
    "Two competitors are within 6 months on the same wedge.",
  ],
  nextAction: "Send Alex a 5-line note proposing a 30-min pilot-criteria call this week.",
  sourceCount: 4,
  paidCalls: 0,
  fromMemory: true,
  trace: [
    { step: "Resolve entity", status: "ok", detail: "Matched 'Orbital Labs' (entity #2,841)", durationMs: 38 },
    { step: "Memory-first", status: "ok", detail: "4 prior conversations · 12 sources cached · last refreshed 2h ago", durationMs: 21 },
    { step: "Event corpus", status: "ok", detail: "Ship Demo Day captures matched (3 notes, 1 founder quote)", durationMs: 14 },
    { step: "Public sources", status: "info", detail: "Skipped — confidence threshold met by memory", durationMs: 0 },
    { step: "Synthesise", status: "ok", detail: "Gemini 3 Pro · grounded · evidence checklist 5/6", durationMs: 1820 },
    { step: "Save to report", status: "ok", detail: "Report rep_orbital updated · 2 new claims · 1 follow-up", durationMs: 96 },
  ],
};

export type InboxLane = "batch_review" | "agent_suggestions" | "captures" | "watchlist" | "approvals";

export interface InboxItem {
  id: string;
  /** New 5-lane categorization. Old `category` retained for backwards compat below. */
  lane?: InboxLane;
  /** Plain-English reason this row is in the queue, shown inline. */
  whyHere?: string;
  whyTone?: "amber" | "accent" | "blue" | "green";
  category: "needs_confirmation" | "unassigned" | "event" | "watchlist" | "automation" | "approval";
  title: string;
  body: string;
  confidence?: number;
  detected?: { person?: string; company?: string; topic?: string };
  meta: string;
}

export const inboxItems: InboxItem[] = [
  {
    id: "in_b1",
    lane: "batch_review",
    whyHere: "Weak source coverage",
    whyTone: "amber",
    category: "needs_confirmation",
    title: "Notable Health · Healthcare AI batch",
    body: "Generated in your Founder/banker lens · 3 claims need a primary source. Founder background section is shallow.",
    confidence: 0.62,
    meta: "2m ago · batch run #241 · 47/250 done",
  },
  {
    id: "in_b2",
    lane: "batch_review",
    whyHere: "Style mismatch",
    whyTone: "amber",
    category: "needs_confirmation",
    title: "Augmedix · Healthcare AI batch",
    body: "Style match score 64% — recommendation phrased as 'It depends…' which is below your threshold.",
    confidence: 0.71,
    meta: "5m ago · batch run #241",
  },
  {
    id: "in_a1",
    lane: "agent_suggestions",
    whyHere: "Agent proposes a new claim",
    whyTone: "accent",
    category: "approval",
    title: "Orbital Labs — hiring spike",
    body: "Agent: 4× ML eval engineers posted on LinkedIn this week. Add as a verified claim?",
    meta: "12m ago · Watchlist Agent",
  },
  {
    id: "in_a2",
    lane: "agent_suggestions",
    whyHere: "Agent wants to write externally",
    whyTone: "accent",
    category: "approval",
    title: "CRM Export Agent · 12 contacts to HubSpot",
    body: "Will write 12 Ship Demo Day contacts to HubSpot. Approve, edit, or reject the diff.",
    meta: "30m ago · CRM Export Agent",
  },
  {
    id: "in_c1",
    lane: "captures",
    whyHere: "Captured note ambiguous",
    whyTone: "amber",
    category: "needs_confirmation",
    title: "Captured note · likely Ship Demo Day",
    body: '"Met Alex from Orbital Labs. They build voice-agent eval infra. Looking for healthcare design partners."',
    confidence: 0.72,
    detected: { person: "Alex", company: "Orbital Labs", topic: "voice-agent eval infra" },
    meta: "3m ago · likely target: Ship Demo Day",
  },
  {
    id: "in_c2",
    lane: "captures",
    whyHere: "Quick capture without target",
    whyTone: "amber",
    category: "unassigned",
    title: "Anthropic MCP host extensions",
    body: '"Anthropic rumored to ship MCP host extensions next quarter — verify."',
    meta: "12m ago",
  },
  {
    id: "in_w1",
    lane: "watchlist",
    whyHere: "Watchlist signal triggered",
    whyTone: "blue",
    category: "watchlist",
    title: "Mercor · Series B closed",
    body: "+$30M Series B led by General Catalyst — confidence 88%. Update Mercor report?",
    meta: "11m ago · Watchlist Agent",
  },
  {
    id: "in_w2",
    lane: "watchlist",
    whyHere: "Stale source detected",
    whyTone: "amber",
    category: "watchlist",
    title: "DISCO whitepaper · 90 days old",
    body: "DISCO procurement page was last fetched 90 days ago. Refresh sources?",
    meta: "1h ago · Source Refresh Agent",
  },
  {
    id: "in_x1",
    lane: "approvals",
    whyHere: "Paid call would be triggered",
    whyTone: "accent",
    category: "approval",
    title: "Deep refresh on Voice-agent evaluation",
    body: "Running a Deep dive on the theme would consume ~$0.18 of paid calls. Approve?",
    meta: "5m ago",
  },
  {
    id: "in_x2",
    lane: "approvals",
    whyHere: "Daily automation summary",
    whyTone: "green",
    category: "automation",
    title: "Daily refresh complete",
    body: "9,420 sources refreshed. 18 stale, 4 broken (auto-flagged).",
    meta: "Today, 06:00",
  },
];

export interface NotebookSection {
  heading: string;
  body: string;
  controls: ("use_chat" | "use_reports" | "use_exports" | "private_only" | "disabled")[];
}

export const personalContext: NotebookSection[] = [
  {
    heading: "Background",
    body: "Builder-analyst. Banking + agentic AI. Run NodeBench as a self-dogfooded operating-memory product. Comfort with engineering and finance jargon.",
    controls: ["use_chat", "use_reports"],
  },
  {
    heading: "Current priorities",
    body: "Ship the entity intelligence loop end-to-end. Demo the event flow at Ship Demo Day. Close the first paid pilot.",
    controls: ["use_chat", "use_reports"],
  },
  {
    heading: "Communication style",
    body: "Direct. Tactical. Banker memo cadence. Skip motivational filler. Push back when I'm rationalizing.",
    controls: ["use_chat", "use_exports"],
  },
  {
    heading: "Evidence preferences",
    body: "Prefer primary sources. Flag uncertainty explicitly. Falsification framing on competing explanations.",
    controls: ["use_chat", "use_reports"],
  },
  {
    heading: "Privacy boundaries",
    body: "Never share my private notes externally. Never auto-publish to LinkedIn without preview.",
    controls: ["private_only"],
  },
];

export interface CardStackEntity {
  id: string;
  type: "event" | "company" | "person" | "topic";
  title: string;
  subtitle: string;
  whyItMatters?: string;
  facts: { label: string; value: string }[];
  pills: { label: string; tone?: "default" | "accent" | "green" | "blue" | "amber" }[];
  claims?: { idx: number; text: string; status: "verified" | "review" }[];
  sources?: number;
  nextHops: { id: string; label: string; type: CardStackEntity["type"]; subtitle: string }[];
}

// ─── Style profiles — public memo styles + the user's inferred style ───
// Modeled on Anthropic Skills frontmatter. Each style is portable: a JSON manifest
// drives generation; the UI renders preview + chip + selector everywhere.
export type StyleId =
  | "gs.banker.brief"
  | "yc.investor.memo"
  | "stratechery.analysis"
  | "bessemer.scorecard"
  | "buffett.plainenglish"
  | "firstround.casestudy"
  | "user.inferred";

export interface MemoStyle {
  id: StyleId;
  name: string;             // "Goldman banker brief"
  source: string;           // "Goldman Sachs Top of Mind"
  persona: string;          // who it converts
  voice: string;            // 1-line voice description
  sectionOrder: string[];   // ordered section list
  recommendationPhrasings: string[]; // examples of how recs are stated
  riskLens: string[];       // dimensions risk-checked against
  sourcePreferences: string[];
  previewLines: string[];   // 5 mock memo lines (in the style's voice)
  exampleArtifactUrl?: string;
  confidence?: number;      // for user.inferred only
}

export const memoStyles: MemoStyle[] = [
  {
    id: "gs.banker.brief",
    name: "Goldman banker brief",
    source: "Goldman Sachs Top of Mind",
    persona: "Banker · sales analyst · institutional researcher",
    voice: "Q&A format, multiple expert perspectives, evidence-led, formal",
    sectionOrder: ["Top of Mind question", "Expert view A", "Expert view B", "Synthesis", "Implication for clients"],
    recommendationPhrasings: ["We see…", "Our view…", "Implication for portfolios:", "Risk to watch:"],
    riskLens: ["Macro", "Regulatory", "Liquidity", "Concentration", "Geopolitical"],
    sourcePreferences: ["SEC filings", "Government data", "Institutional research", "Earnings transcripts"],
    previewLines: [
      "TOP OF MIND: Apple's services trajectory into 2026",
      "Expert A — bullish: services already 25% of revenue, gross margin 71%",
      "Expert B — cautious: regulatory risk on App Store fees in EU + Korea",
      "Synthesis: services growth durable, margin compression manageable",
      "Implication: maintain overweight, watch Q3 services guide",
    ],
    exampleArtifactUrl: "https://www.goldmansachs.com/insights/top-of-mind",
  },
  {
    id: "yc.investor.memo",
    name: "YC investor memo",
    source: "YC public memos + Sequoia thesis posts",
    persona: "Founder · VC associate · seed investor",
    voice: "Punchy, thesis-driven, 'why now', founder-first",
    sectionOrder: ["Why now", "What they're building", "Why this team", "Market", "Thesis", "Risks", "Decision"],
    recommendationPhrasings: ["We're investing because…", "Pass for now — revisit when…", "Do the work."],
    riskLens: ["Founder execution", "Market timing", "Distribution", "Defensibility", "Capital efficiency"],
    sourcePreferences: ["Founder interview", "Customer references", "Product trial", "Cohort data"],
    previewLines: [
      "Why now: voice agents crossed the eval threshold in Q1.",
      "What they're building: HIPAA-aware grading layer for healthcare voice ops.",
      "Why this team: ex-Mode Analytics — they shipped enterprise eval before.",
      "Thesis: regulated industries are the wedge; horizontal eval losers can't follow.",
      "Decision: Lead the seed at the cap they want.",
    ],
    exampleArtifactUrl: "https://articles.sequoiacap.com/airbnb-pitch-deck",
  },
  {
    id: "stratechery.analysis",
    name: "Stratechery analysis",
    source: "Stratechery weekly (Ben Thompson)",
    persona: "Strategist · PM · industry watcher",
    voice: "Narrative + framework + arrow logic. Long-form, structural.",
    sectionOrder: ["The setup", "The framework", "The implication", "What it means for X", "What it means for Y"],
    recommendationPhrasings: ["The arrow points to…", "Which means…", "And so the conclusion is…"],
    riskLens: ["Structural advantage", "Aggregation", "Integration", "Channel", "Network effects"],
    sourcePreferences: ["Earnings calls", "Industry primary docs", "Founder essays", "Long-form interviews"],
    previewLines: [
      "The setup: Apple's services growth has structural drivers, not cyclical ones.",
      "The framework: Aggregation Theory predicts services compound when distribution locks in.",
      "Apple's distribution lock-in: 1.4B active devices, payment on file, default app slots.",
      "Which means services growth scales with installed base, not new device sales.",
      "And so: the bear case on iPhone unit decline misses the actual revenue arrow.",
    ],
    exampleArtifactUrl: "https://stratechery.com/",
  },
  {
    id: "bessemer.scorecard",
    name: "Bessemer scorecard",
    source: "Bessemer State of the Cloud",
    persona: "RevOps · growth · SaaS operator",
    voice: "Metric-focused, framework-driven, recurring rubric",
    sectionOrder: ["Scorecard", "Growth efficiency", "Net revenue retention", "Magic number", "Rule of 40", "Recommendation"],
    recommendationPhrasings: ["Score: A/B/C", "Top quartile on…", "Below benchmark on…"],
    riskLens: ["Growth deceleration", "Burn multiple", "GRR", "NRR", "Sales efficiency", "Gross margin"],
    sourcePreferences: ["S-1 filings", "Earnings reports", "Cloud Index data", "Operator surveys"],
    previewLines: [
      "Scorecard: Mercor — A- (top quartile growth, mid-pack efficiency)",
      "ARR growth: 3.4× YoY · benchmark 2.1× — TOP QUARTILE",
      "Net revenue retention: 142% · benchmark 120% — TOP DECILE",
      "Magic number: 1.6 · benchmark 1.0 — STRONG",
      "Rule of 40: 78 · benchmark 40 — TOP DECILE",
    ],
    exampleArtifactUrl: "https://www.bvp.com/atlas/state-of-the-cloud-2024",
  },
  {
    id: "buffett.plainenglish",
    name: "Buffett plain-English",
    source: "Berkshire Hathaway annual letters",
    persona: "Non-technical reader · board member · LP",
    voice: "Folksy, plain-English, owner mindset, risk-aware, humorous",
    sectionOrder: ["What we own", "How it's doing", "What worried us", "What we'd do again", "What we won't do"],
    recommendationPhrasings: ["We're happy owners.", "We made a mistake.", "We'll buy more if it gets cheaper."],
    riskLens: ["Management quality", "Moat durability", "Capital allocation", "Reinvestment runway"],
    sourcePreferences: ["Annual reports", "Letters to shareholders", "Long-tenured CEO interviews"],
    previewLines: [
      "Apple is our biggest holding, and we sleep well.",
      "Tim Cook earned his keep again this year — services up 14%, buybacks down to a sensible pace.",
      "What worried us: the EU's app-store rules. Inconvenient, not catastrophic.",
      "What we'd do again: not selling in 2022 when everyone thought iPhone was tired.",
      "What we won't do: pretend we know what AI does to Apple's moat in 5 years.",
    ],
    exampleArtifactUrl: "https://www.berkshirehathaway.com/letters/letters.html",
  },
  {
    id: "firstround.casestudy",
    name: "First Round case study",
    source: "First Round Review",
    persona: "Operator · founder · early-employee",
    voice: "Lesson-extraction, quotable, conversational",
    sectionOrder: ["The moment", "What they tried", "What worked", "The lesson", "How to apply it"],
    recommendationPhrasings: ["The lesson:", "Try this:", "Don't make our mistake:"],
    riskLens: ["Org design", "Hiring", "Product-market fit", "Founder-led sales", "Onboarding"],
    sourcePreferences: ["Founder interviews", "Internal docs (with permission)", "Operator essays"],
    previewLines: [
      "The moment: Mercor was burning $400k/month with no clear path to $1M ARR.",
      "What they tried: switching from PLG to founder-led sales, then back, then a hybrid.",
      "What worked: a single owner per account + a weekly review that asked one question.",
      "The lesson: process beats charisma, but only after you have one customer in love.",
      "Try this: write down the exact question your CEO asks every Friday. Make it the org's metric.",
    ],
    exampleArtifactUrl: "https://review.firstround.com/",
  },
  {
    id: "user.inferred",
    name: "Founder / banker lens · v3",
    source: "Inferred from your conversations + uploads",
    persona: "You",
    voice: "Concise, banker-memo cadence: answer → evidence → risk → next action.",
    sectionOrder: ["Short answer", "Why useful", "Evidence (cited)", "Risks", "Next action"],
    recommendationPhrasings: ["Take the call.", "Worth 30 minutes.", "Skip — capital not the binding constraint."],
    riskLens: ["Market ambiguity", "Revenue quality", "Founder background", "Financing stage", "Customer concentration"],
    sourcePreferences: ["Government / SEC filings", "Founder direct interview", "Cached primary sources", "Memory-first"],
    previewLines: [
      "Short answer: Take the call this week.",
      "Why useful: HIPAA-aware grading is the structurally defensible wedge.",
      "Evidence: 14 sources · founder confirmed pilot intent · 4 ML eval engineers hired.",
      "Risks: 6-month procurement at regional hospitals · 2 competitors within 6 months.",
      "Next action: 5-line note proposing 30-min pilot-criteria call.",
    ],
    confidence: 0.91,
  },
];

export interface InferredStyleProvenance {
  sourceLabel: string;     // "Memo_Anthropic_2025-04.md" / "47 conversations"
  patterns: number;        // # of patterns extracted
  weightPct: number;       // 0..100 contribution
}

export const inferredStyleProvenance: InferredStyleProvenance[] = [
  { sourceLabel: "Memo_Anthropic_2025-04.md", patterns: 3, weightPct: 18 },
  { sourceLabel: "Diligence_Mercor_2025-03.pdf", patterns: 5, weightPct: 24 },
  { sourceLabel: "Notion_recap_voice-eval_Apr.md", patterns: 4, weightPct: 14 },
  { sourceLabel: "47 conversations sampled", patterns: 12, weightPct: 44 },
];

// Watchlist — Bloomberg-style entities the user is tracking
export interface WatchlistEntity {
  id: string;
  entity: string;
  kind: "company" | "person" | "topic" | "event";
  signal: string;             // one-line "what changed since last session"
  delta: number;              // signed change (claims added) since last session
  confidence: number;         // 0..1
  lastSignalAt: string;       // "12m ago"
  trendUp: boolean;
}

export const watchlist: WatchlistEntity[] = [
  {
    id: "w_orbital",
    entity: "Orbital Labs",
    kind: "company",
    signal: "Hiring spike: 4× ML eval engineers this week",
    delta: 4,
    confidence: 0.78,
    lastSignalAt: "12m ago",
    trendUp: true,
  },
  {
    id: "w_anthropic",
    entity: "Anthropic",
    kind: "company",
    signal: "MCP host extensions confirmed for Q3",
    delta: 2,
    confidence: 0.91,
    lastSignalAt: "1h ago",
    trendUp: true,
  },
  {
    id: "w_voiceeval",
    entity: "Voice-agent evaluation",
    kind: "topic",
    signal: "2 new vendors entered the space",
    delta: 2,
    confidence: 0.66,
    lastSignalAt: "3h ago",
    trendUp: true,
  },
  {
    id: "w_mercor",
    entity: "Mercor",
    kind: "company",
    signal: "No movement since last refresh",
    delta: 0,
    confidence: 0.72,
    lastSignalAt: "2d ago",
    trendUp: false,
  },
  {
    id: "w_alex",
    entity: "Alex Chen",
    kind: "person",
    signal: "LinkedIn updated: now hiring co-founder",
    delta: 1,
    confidence: 0.84,
    lastSignalAt: "5h ago",
    trendUp: true,
  },
];

// ─── Universe = a list of entities you cover (Healthcare AI, sales accounts, ...) ───
export interface Universe {
  id: string;
  name: string;                  // "Healthcare AI Coverage"
  kind: "companies" | "people" | "topics" | "events" | "roles";
  entityCount: number;
  needsReview: number;
  refreshedAgo: string;          // "12m ago"
  rubric: string;                // "Banker screen" / "VC memo" / "Sales account plan"
  styleId: StyleId;              // which style is applied across this universe
  monitoring: boolean;
}

export const universes: Universe[] = [
  {
    id: "u_health_ai",
    name: "Healthcare AI Coverage",
    kind: "companies",
    entityCount: 312,
    needsReview: 18,
    refreshedAgo: "12m ago",
    rubric: "Banker target screen",
    styleId: "user.inferred",
    monitoring: true,
  },
  {
    id: "u_sales_q3",
    name: "Sales accounts · Q3",
    kind: "companies",
    entityCount: 84,
    needsReview: 6,
    refreshedAgo: "2h ago",
    rubric: "Account plan · operator lens",
    styleId: "bessemer.scorecard",
    monitoring: true,
  },
  {
    id: "u_yc_s25",
    name: "YC S25 batch",
    kind: "companies",
    entityCount: 192,
    needsReview: 9,
    refreshedAgo: "Yesterday",
    rubric: "VC investor memo",
    styleId: "yc.investor.memo",
    monitoring: false,
  },
];

// ─── Active batch run (live) ───
export interface BatchRunStep {
  entity: string;
  status: "done" | "running" | "queued" | "review";
  durationMs?: number;
  paidCalls?: number;
}

export interface ActiveBatchRun {
  id: string;
  universeId: string;
  universeName: string;
  styleId: StyleId;
  styleName: string;
  rubric: string;
  totalEntities: number;
  doneCount: number;
  reviewCount: number;
  etaSeconds: number;
  spentUsd: number;
  recentSteps: BatchRunStep[];
}

export const activeBatchRun: ActiveBatchRun = {
  id: "batch_orbital_run_241",
  universeId: "u_health_ai",
  universeName: "Healthcare AI Coverage",
  styleId: "user.inferred",
  styleName: "Founder / banker lens · v3",
  rubric: "Banker target screen",
  totalEntities: 250,
  doneCount: 47,
  reviewCount: 3,
  etaSeconds: 218,
  spentUsd: 0.18,
  recentSteps: [
    { entity: "Hippocratic AI", status: "done", durationMs: 4_200, paidCalls: 0 },
    { entity: "Abridge", status: "done", durationMs: 4_900, paidCalls: 1 },
    { entity: "Notable Health", status: "review", durationMs: 5_300, paidCalls: 0 },
    { entity: "Suki AI", status: "running" },
    { entity: "Augmedix", status: "queued" },
    { entity: "DeepScribe", status: "queued" },
  ],
};

// Continue-working items — Bloomberg-style "where you left off"
export interface ContinueItem {
  id: string;
  reportId: string;
  title: string;
  kind: string;
  lastTouched: string;          // "12m ago"
  whatYouLeft: string;          // "Mid-edit on the pilot pre-read"
  pendingFromAgent?: number;    // # of suggestions waiting
}

export const continueWorking: ContinueItem[] = [
  {
    id: "c_orbital",
    reportId: "rep_orbital",
    title: "Orbital Labs — pilot pre-read",
    kind: "Diligence",
    lastTouched: "12m ago",
    whatYouLeft: "Mid-edit on Decision section",
    pendingFromAgent: 1,
  },
  {
    id: "c_ship",
    reportId: "rep_ship_demo",
    title: "Ship Demo Day — event report",
    kind: "Event · active",
    lastTouched: "2h ago",
    whatYouLeft: "9 follow-ups pending review",
  },
  {
    id: "c_voiceeval",
    reportId: "rep_voice_eval",
    title: "Voice-agent evaluation — theme",
    kind: "Theme",
    lastTouched: "Yesterday",
    whatYouLeft: "Awaiting source refresh",
    pendingFromAgent: 2,
  },
];

// Backlinks (Roam-style "Linked references" + "Unlinked references")
export interface BacklinkEntry {
  fromReportId: string;
  fromTitle: string;
  snippet: string;          // surrounding text from the source report
  blockKind: "claim" | "paragraph" | "follow-up" | "source";
  daysAgo: number;
}

export const reportBacklinks: Record<string, { linked: BacklinkEntry[]; unlinked: BacklinkEntry[] }> = {
  rep_orbital: {
    linked: [
      {
        fromReportId: "rep_ship_demo",
        fromTitle: "Ship Demo Day — event report",
        snippet: "[[Orbital Labs]] showed strongest pilot intent of the day. Founder ([[Alex Chen]]) is ex-Mode Analytics.",
        blockKind: "paragraph",
        daysAgo: 0,
      },
      {
        fromReportId: "rep_voice_eval",
        fromTitle: "Voice-agent evaluation — theme",
        snippet: "Vendors tracked: 6. Notable: [[Orbital Labs]] is the only one targeting healthcare with HIPAA-aware grading.",
        blockKind: "claim",
        daysAgo: 2,
      },
    ],
    unlinked: [
      {
        fromReportId: "rep_anthropic",
        fromTitle: "Anthropic — coverage",
        snippet: "Adjacent vendor: voice-agent eval infra startup with HIPAA-aware grading caught my eye at Ship Demo Day.",
        blockKind: "paragraph",
        daysAgo: 1,
      },
    ],
  },
};

// Report notebook content — full TipTap-ready report for Orbital Labs.
// Mirrors the spec: a report is a living entity workspace; this is the markdown/HTML
// payload of its Notebook tab. Real production: stored in Convex `reports.notebookHtml`.
export const reportNotebookHtml: Record<string, string> = {
  rep_orbital: `
<h2>What they do</h2>
<p>Orbital Labs builds <a class="rd-entity-link" data-entity="topic:voice-eval" href="#">voice-agent evaluation</a> infrastructure with first-class support for HIPAA-aware grading<a class="rd-cite" href="#cite-1" data-cite="1">1</a>. The team is voice + healthcare from prior roles at <a class="rd-entity-link" data-entity="company:mode-analytics" href="#">Mode Analytics</a>. Today they're seeking healthcare design partners — <em>capital is not the binding constraint</em><a class="rd-cite" href="#cite-2" data-cite="2">2</a>.</p>
<p>Met <a class="rd-entity-link" data-entity="person:alex-chen" href="#">Alex Chen</a> at <a class="rd-entity-link" data-entity="event:ship-demo-day" href="#">Ship Demo Day</a><a class="rd-cite" href="#cite-3" data-cite="3">3</a>.</p>

<div data-block="claim" data-status="verified" data-cite="2">
  <span data-claim-label>Claim 1 · verified</span>
  <p>Eval framework supports per-utterance grading with HIPAA-aware tagging.</p>
  <span data-claim-source>Orbital Labs whitepaper, p.4</span>
</div>

<div data-block="claim" data-status="verified" data-cite="3">
  <span data-claim-label>Claim 2 · verified</span>
  <p>Looking for healthcare design partners — capital not the constraint.</p>
  <span data-claim-source>Founder note, Ship Demo Day</span>
</div>

<div data-block="claim" data-status="review" data-cite="4">
  <span data-claim-label>Claim 3 · needs review</span>
  <p>Active partner discussions with two regional hospital systems.</p>
  <span data-claim-source>Notion meeting recap, Apr 30 · single source</span>
</div>

<h2>Why we should care</h2>
<p>The HIPAA-aware grading wedge is structurally defensible — most LLM eval vendors treat regulated industries as an afterthought. If Orbital wins one regional hospital pilot, expansion follows the same procurement cycle<a class="rd-cite" href="#cite-4" data-cite="4">4</a>.</p>

<h2>Open questions</h2>
<ul>
  <li>What's the expected pilot procurement timeline at the regional hospitals?</li>
  <li>Is the eval framework open-source or closed-source?</li>
  <li>How does Orbital differentiate from established eval vendors (Beam, OpenLLM-Eval)?</li>
</ul>

<div data-block="follow-up" data-due="tomorrow">
  <span data-followup-label>Follow-up · due tomorrow</span>
  <p>Send Alex a 5-line note proposing a 30-min pilot-criteria call this week.</p>
</div>

<h2>Decision</h2>
<p><strong>Take the call.</strong> Worth 30 minutes this week to stress-test the pilot timeline. Healthcare entrenchment makes this a one-shot opportunity if validated.</p>

<div data-block="source-list">
  <span data-source-list-label>Sources used in this report (4 / 14)</span>
  <ol>
    <li data-cite="1">Orbital Labs whitepaper, p.4 · refreshed 2d ago</li>
    <li data-cite="2">Founder note, Ship Demo Day · refreshed today</li>
    <li data-cite="3">Notion meeting recap, Apr 30 · refreshed 5d ago</li>
    <li data-cite="4">TechCrunch coverage, Mar 2026 · refreshed 1w ago</li>
  </ol>
</div>

<p></p>
`,
};

export const cardStackEntities: Record<string, CardStackEntity> = {
  ship_demo: {
    id: "ship_demo",
    type: "event",
    title: "Ship Demo Day",
    subtitle: "Event · 2026-05-04 · 8 companies · 14 people",
    whyItMatters: "Highest-signal pipeline event this quarter. 3 strong pilot intents detected.",
    facts: [
      { label: "Captures", value: "12" },
      { label: "Companies", value: "8" },
      { label: "People", value: "14" },
      { label: "Follow-ups", value: "9" },
      { label: "Sources reused", value: "78%" },
      { label: "Paid calls", value: "0" },
    ],
    pills: [
      { label: "Active event", tone: "green" },
      { label: "Memory-served", tone: "accent" },
    ],
    sources: 41,
    nextHops: [
      { id: "orbital", label: "Orbital Labs", type: "company", subtitle: "Voice-agent eval infra" },
      { id: "anthropic_team", label: "Anthropic team", type: "company", subtitle: "Booth · MCP demo" },
      { id: "alex", label: "Alex Chen", type: "person", subtitle: "Founder, Orbital Labs" },
    ],
  },
  orbital: {
    id: "orbital",
    type: "company",
    title: "Orbital Labs",
    subtitle: "Voice-agent evaluation infra · Series Seed · 14 people",
    whyItMatters: "Healthcare design-partner angle is the wedge. Validate procurement timeline before you commit time.",
    facts: [
      { label: "Stage", value: "Series Seed" },
      { label: "Headcount", value: "14" },
      { label: "Wedge", value: "Voice + healthcare" },
      { label: "Hiring spike", value: "4x ML eval roles" },
      { label: "Last raise", value: "$3.2M (Jan 2026)" },
    ],
    pills: [
      { label: "Watching", tone: "blue" },
      { label: "Pilot intent", tone: "green" },
    ],
    claims: [
      { idx: 1, text: "Eval framework HIPAA-aware (per whitepaper p.4)", status: "verified" },
      { idx: 2, text: "Active discussions with 2 regional hospital systems", status: "review" },
      { idx: 3, text: "Capital not the binding constraint per founder note", status: "verified" },
    ],
    sources: 14,
    nextHops: [
      { id: "alex", label: "Alex Chen", type: "person", subtitle: "Founder · prior at Mode Analytics" },
      { id: "voice_eval", label: "Voice-agent evaluation", type: "topic", subtitle: "Theme · 6 vendors tracked" },
      { id: "healthcare_pilot", label: "Healthcare pilot criteria", type: "topic", subtitle: "Decision blocker" },
    ],
  },
  alex: {
    id: "alex",
    type: "person",
    title: "Alex Chen",
    subtitle: "Founder, Orbital Labs · ex-Mode Analytics",
    whyItMatters: "First-time founder, but second-time operator on eval tooling. Strong technical credibility.",
    facts: [
      { label: "Role", value: "Founder & CEO" },
      { label: "Prior", value: "Mode Analytics (eval team)" },
      { label: "Education", value: "Stanford CS '18" },
      { label: "Met at", value: "Ship Demo Day" },
      { label: "Asked about", value: "Healthcare pilot criteria" },
    ],
    pills: [
      { label: "Pilot conversation", tone: "accent" },
      { label: "Follow-up due tomorrow", tone: "amber" },
    ],
    sources: 6,
    nextHops: [
      { id: "orbital", label: "Orbital Labs", type: "company", subtitle: "Founder + CEO" },
      { id: "ship_demo", label: "Ship Demo Day", type: "event", subtitle: "First met here" },
    ],
  },
  voice_eval: {
    id: "voice_eval",
    type: "topic",
    title: "Voice-agent evaluation",
    subtitle: "Theme · 6 vendors · 3 academic groups",
    whyItMatters: "Crowded but unowned. Whoever ships HIPAA-aware grading first takes the regulated wedge.",
    facts: [
      { label: "Vendors tracked", value: "6" },
      { label: "Academic groups", value: "3" },
      { label: "Frameworks", value: "OpenLLM-Eval · Beam · custom" },
      { label: "Reports referencing", value: "11" },
    ],
    pills: [{ label: "Theme", tone: "blue" }],
    sources: 19,
    nextHops: [
      { id: "orbital", label: "Orbital Labs", type: "company", subtitle: "HIPAA-aware angle" },
    ],
  },
  healthcare_pilot: {
    id: "healthcare_pilot",
    type: "topic",
    title: "Healthcare pilot criteria",
    subtitle: "Decision blocker · 2 unknowns",
    whyItMatters: "Open until you know procurement timeline + clinical sign-off bar.",
    facts: [
      { label: "Open questions", value: "2" },
      { label: "Owner", value: "You" },
      { label: "Linked entities", value: "3" },
    ],
    pills: [{ label: "Open", tone: "amber" }],
    sources: 5,
    nextHops: [
      { id: "orbital", label: "Orbital Labs", type: "company", subtitle: "Asking party" },
    ],
  },
  anthropic_team: {
    id: "anthropic_team",
    type: "company",
    title: "Anthropic team",
    subtitle: "Booth · MCP host extensions demo",
    facts: [
      { label: "Reps met", value: "3" },
      { label: "Topics", value: "MCP host · agent SDK · Claude Code" },
      { label: "Linked report", value: "rep_anthropic" },
    ],
    pills: [{ label: "Coverage", tone: "default" }],
    sources: 28,
    nextHops: [],
  },
};
