import type {
  CaptureIntent,
  CaptureTarget,
} from "@/features/product/lib/captureRouter";

export type SurfaceFit = "primary" | "secondary" | "optional" | "not_primary";

export interface ScenarioMatrixRow {
  scenario: string;
  mobile: string;
  web: string;
  workspace: string;
  cliMcp: string;
  primarySurface: "Mobile" | "Web app" | "Workspace" | "CLI / MCP";
}

export interface ScenarioTestCase {
  id: string;
  title: string;
  realLifeInput: string;
  inferredIntent: CaptureIntent;
  target: CaptureTarget;
  structuredOutput: string[];
  ack: string;
  nextAction: string[];
}

export const SCENARIO_FAMILIES = [
  "Event / conference",
  "Networking",
  "Job search",
  "Founder / startup operator",
  "Sales / business development",
  "Investor / VC diligence",
  "Product management",
  "Research / analyst",
  "Academic / learning",
  "Technical / developer",
  "Content / creator",
  "Personal knowledge / life admin",
  "Inbox / automation",
  "Team / organizational memory",
] as const;

export const PRODUCT_SURFACE_MODEL = [
  {
    surface: "Web app",
    job: "Main operating app",
    bestFor: "Daily pulse, reports, chat, inbox triage, profile/context",
  },
  {
    surface: "Mobile",
    job: "Real-world capture and quick action",
    bestFor: "Events, voice notes, screenshots, fast triage",
  },
  {
    surface: "CLI / MCP",
    job: "Agent and developer distribution",
    bestFor: "Claude/Cursor workflows, automations, batch research, API workflows",
  },
  {
    surface: "Workspace",
    job: "Deep research and recursive exploration",
    bestFor: "Report detail, cards, notebook, sources, map, team memory",
  },
] as const;

export const SCENARIO_MATRIX: ScenarioMatrixRow[] = [
  {
    scenario: "At an event, capturing notes",
    mobile: "Voice, camera, screenshot, quick text, context pill",
    web: "Inbox and captures review",
    workspace: "Post-event organization into event report",
    cliMcp: "Optional import from automations",
    primarySurface: "Mobile",
  },
  {
    scenario: "Meeting someone and saving relationship context",
    mobile: "Primary capture surface",
    web: "View and edit in Inbox or Reports",
    workspace: "Deep person/company card expansion",
    cliMcp: "Optional CRM or scripted import later",
    primarySurface: "Mobile",
  },
  {
    scenario: "Recruiter email / job alert",
    mobile: "Quick notification and triage",
    web: "Inbox to Chat to Reports",
    workspace: "Interview prep workspace",
    cliMcp: "Gmail automation enrichment",
    primarySurface: "Web app",
  },
  {
    scenario: "Interview prep",
    mobile: "Quick review before call",
    web: "Start from Chat or Report",
    workspace: "Company dossier, notes, sources",
    cliMcp: "Auto-generate briefing from email/calendar",
    primarySurface: "Workspace",
  },
  {
    scenario: "Founder customer discovery",
    mobile: "Capture field notes live",
    web: "Review captures and convert reports",
    workspace: "Synthesize pain themes, objections, next actions",
    cliMcp: "Bulk ingest notes/transcripts",
    primarySurface: "Mobile",
  },
  {
    scenario: "Investor demo day diligence",
    mobile: "Capture each founder/company live",
    web: "Inbox review and Reports grid",
    workspace: "Compare companies, cards, sources, memo",
    cliMcp: "Batch research companies from event list",
    primarySurface: "Workspace",
  },
  {
    scenario: "Sales / BD leads",
    mobile: "Capture booth/event conversations",
    web: "Inbox triage and account reports",
    workspace: "Account workspace with stakeholders and follow-ups",
    cliMcp: "Future CRM sync/API calls",
    primarySurface: "Web app",
  },
  {
    scenario: "PM feedback collection",
    mobile: "Capture user/customer comments",
    web: "Reports organize themes",
    workspace: "Notebook turns feedback into PRD/evidence",
    cliMcp: "Repo/docs integration later",
    primarySurface: "Workspace",
  },
  {
    scenario: "Market research",
    mobile: "Quick read only",
    web: "Start from Chat, save report",
    workspace: "Recursive cards, sources, notebook",
    cliMcp: "Scheduled or batch research runs",
    primarySurface: "Workspace",
  },
  {
    scenario: "Technical repo/vendor research",
    mobile: "Tertiary",
    web: "Start from Chat/Reports",
    workspace: "Architecture/vendor report workspace",
    cliMcp: "MCP inside Claude/Cursor",
    primarySurface: "CLI / MCP",
  },
  {
    scenario: "Newsletter / content research",
    mobile: "Save ideas/screenshots",
    web: "Inbox and Reports",
    workspace: "Draft newsletter/memo from cards and sources",
    cliMcp: "Scheduled digest pipeline",
    primarySurface: "Workspace",
  },
  {
    scenario: "Personal knowledge capture",
    mobile: "One input for messy notes",
    web: "Search/review in Inbox or Reports",
    workspace: "Deep cleanup only when needed",
    cliMcp: "Not primary",
    primarySurface: "Mobile",
  },
  {
    scenario: "Team memory",
    mobile: "Capture from the field",
    web: "Reports as shared library",
    workspace: "Primary shared workspace",
    cliMcp: "MCP/API for team automation",
    primarySurface: "Workspace",
  },
  {
    scenario: "Research / analyst",
    mobile: "Quick read and source capture",
    web: "Start from Chat or Reports",
    workspace: "Company, person, market, claims, and source verification",
    cliMcp: "Batch research and scheduled refreshes",
    primarySurface: "Workspace",
  },
  {
    scenario: "Academic / learning",
    mobile: "Lecture notes, whiteboard photos, quick review",
    web: "Reports and study threads",
    workspace: "Concept graph, paper evidence table, notebook",
    cliMcp: "Paper and dataset ingestion",
    primarySurface: "Workspace",
  },
  {
    scenario: "Content / creator",
    mobile: "Idea, screenshot, and story capture",
    web: "Inbox and report library",
    workspace: "Draft narrative from cards and sources",
    cliMcp: "Scheduled digest and publishing pipeline",
    primarySurface: "Workspace",
  },
  {
    scenario: "Inbox / automation",
    mobile: "Notifications and fast triage",
    web: "Primary queue for uncertain captures and alerts",
    workspace: "Promoted items become durable reports",
    cliMcp: "Gmail, calendar, CRM, and workflow enrichment",
    primarySurface: "Web app",
  },
];

export const HERO_SCENARIO_TESTS: ScenarioTestCase[] = [
  {
    id: "live-event-capture",
    title: "Live event capture",
    realLifeInput:
      "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
    inferredIntent: "capture_field_note",
    target: "active_event_session",
    structuredOutput: [
      "Entities: Alex, Orbital Labs, voice agent eval infra, healthcare",
      "Claims: Orbital Labs builds voice-agent eval infra; looking for healthcare design partners",
      "Follow-up: ask about pilot criteria",
    ],
    ack: "Saved to active event session",
    nextAction: ["Edit", "Move", "Go deeper"],
  },
  {
    id: "recruiter-prep",
    title: "Recruiter / interview prep",
    realLifeInput:
      "Recruiter emailed me about Staff Engineer at Acme AI. Prep company risks and draft a reply.",
    inferredIntent: "create_followup",
    target: "inbox_item",
    structuredOutput: [
      "Entities: recruiter, Staff Engineer, Acme AI",
      "Evidence: recruiter email/job spec",
      "Follow-up: tailored reply and interview prep workspace",
    ],
    ack: "Saved to inbox item",
    nextAction: ["Open workspace", "Draft reply", "Verify"],
  },
  {
    id: "founder-customer-discovery",
    title: "Founder customer discovery",
    realLifeInput:
      "Talked to five clinic operators. Repeated pain: prior auth delays, no budget owner, wants pilot if ROI proof exists.",
    inferredIntent: "capture_field_note",
    target: "current_report",
    structuredOutput: [
      "Entities: clinic operators, prior auth, ROI proof",
      "Claims: repeated customer pain and objection",
      "Follow-up: pilot criteria and roadmap theme",
    ],
    ack: "Saved to customer discovery report",
    nextAction: ["Cluster themes", "Add follow-up", "Open notebook"],
  },
  {
    id: "investor-demo-day",
    title: "Investor demo day diligence",
    realLifeInput:
      "Ten startups from Ship Demo Day. Need clusters by market, unverified traction claims, and founder follow-ups.",
    inferredIntent: "expand_entity",
    target: "active_event_session",
    structuredOutput: [
      "Entities: startups, markets, founders, traction claims",
      "Edges: company to market, founder to company, claim to evidence",
      "Follow-up: ranked diligence queue",
    ],
    ack: "Saved to active event session",
    nextAction: ["Compare", "Verify", "Open map"],
  },
  {
    id: "research-report-workspace",
    title: "Research report workspace",
    realLifeInput:
      "Ask a messy question, create a report, explore cards, edit notebook, verify sources.",
    inferredIntent: "ask_question",
    target: "current_report",
    structuredOutput: [
      "Entities: people, companies, products, market themes",
      "Claims: extracted and confidence-scored",
      "Evidence: linked sources and citations",
    ],
    ack: "Saved to report workspace",
    nextAction: ["Open cards", "Edit notebook", "Verify sources"],
  },
];
