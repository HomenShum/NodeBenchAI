/**
 * NodeBench Demo Video — Full Storyboard
 *
 * Every scene maps to a surface, feature, or interaction in home-v3.html.
 * Each scene has: screenshot key, narration text, duration (frames at 30fps),
 * highlight regions for animated callouts, and caption text.
 */

export const FPS = 30;

export interface HighlightRegion {
  x: number;       // % from left
  y: number;       // % from top
  w: number;       // % width
  h: number;       // % height
  label: string;   // callout text
  delay: number;   // frames delay before appearing
}

export interface Scene {
  id: string;
  title: string;              // section title overlay
  screenshot: string;         // filename in public/screenshots/
  narration: string;          // TTS script
  durationSec: number;        // scene duration in seconds
  highlights: HighlightRegion[];
  caption: string;            // bottom caption bar text
  transition: "fade" | "slide" | "zoom" | "none";
}

export const scenes: Scene[] = [
  // ═══════════════════════════════════════════════════
  // ACT 1: INTRO + HOME SURFACE
  // ═══════════════════════════════════════════════════
  {
    id: "intro",
    title: "NodeBench",
    screenshot: "home-dark.jpg",
    narration: "NodeBench is the operating intelligence layer for agent-native businesses. It watches your entities, tracks signals, and surfaces what matters — before you ask.",
    durationSec: 8,
    highlights: [],
    caption: "Operating Intelligence for Founders",
    transition: "fade",
  },
  {
    id: "home-overview",
    title: "Home — Daily Brief",
    screenshot: "home-dark.jpg",
    narration: "The Home surface is your morning command center. At the top, entity cards show live status for every company you track — with source counts, claim verification badges, and freshness indicators.",
    durationSec: 9,
    highlights: [
      { x: 30, y: 5, w: 55, h: 10, label: "Entity status cards", delay: 15 },
      { x: 62, y: 5, w: 8, h: 3, label: "Verified badge", delay: 45 },
    ],
    caption: "Live entity cards with verification status",
    transition: "fade",
  },
  {
    id: "home-input",
    title: "Home — Conversational Input",
    screenshot: "home-dark.jpg",
    narration: "A rich conversational input bar lets you ask about signals, research entities, or start threads. Action chips provide quick access to context, references, commands, and file attachments.",
    durationSec: 8,
    highlights: [
      { x: 31, y: 18, w: 40, h: 7, label: "Conversational input", delay: 10 },
      { x: 31, y: 23, w: 40, h: 3, label: "Action chips: Context, Reference, Command, Attach", delay: 40 },
    ],
    caption: "Natural language + structured commands",
    transition: "none",
  },
  {
    id: "home-daily-edition",
    title: "Home — Daily Edition & Exposure",
    screenshot: "home-dark.jpg",
    narration: "The Daily Edition banner shows today's signal summary — seven sources, five entities, three items needing attention. Below it, your exposure tracker shows estimated annual API spend at risk and active deals impacted.",
    durationSec: 9,
    highlights: [
      { x: 31, y: 29, w: 40, h: 3, label: "Daily Edition: 7 sources, 5 entities", delay: 10 },
      { x: 31, y: 32, w: 40, h: 3, label: "Exposure: $2.4M API spend at risk", delay: 40 },
    ],
    caption: "Signal summary + financial exposure tracking",
    transition: "none",
  },
  {
    id: "home-need-to-know",
    title: "Home — Need to Know",
    screenshot: "home-dark.jpg",
    narration: "Need to Know is the intelligence feed. Each signal shows the entity, the change, evidence citations, and a verification badge — Verified with three sources, or Estimated when data is still gathering. Your exposure note tells you exactly why each signal matters to you.",
    durationSec: 11,
    highlights: [
      { x: 31, y: 35, w: 40, h: 15, label: "Need to Know signals", delay: 10 },
      { x: 58, y: 37, w: 5, h: 2, label: "Verified · 3", delay: 50 },
      { x: 31, y: 39, w: 30, h: 2, label: "Your exposure note", delay: 80 },
    ],
    caption: "Verified signals with evidence + personal exposure",
    transition: "none",
  },
  {
    id: "home-action-cards",
    title: "Home — Next Best Action & Daily Sweep",
    screenshot: "home-dark.jpg",
    narration: "Two action cards sit side by side. Next Best Action recommends reviewing Anthropic partnership terms before Thursday's board call. The Daily Sweep shows five items triaged from overnight signals — each routed to the right lane: Now, Prep, or Batch.",
    durationSec: 10,
    highlights: [
      { x: 31, y: 57, w: 20, h: 15, label: "Next Best Action", delay: 10 },
      { x: 55, y: 57, w: 20, h: 15, label: "Daily Sweep triage", delay: 50 },
    ],
    caption: "Actionable triage with priority routing",
    transition: "none",
  },
  {
    id: "home-what-changed",
    title: "Home — What Changed Cards",
    screenshot: "home-scrolled.jpg",
    narration: "What Changed cards are the heartbeat of your coverage. Each card shows an entity, the magnitude of change — plus forty percent for Anthropic repricing, one hundred seventy five billion dollar Sequoia counter-bid — with source citations and your strategic context.",
    durationSec: 10,
    highlights: [
      { x: 31, y: 20, w: 40, h: 25, label: "What Changed grid", delay: 10 },
      { x: 31, y: 25, w: 18, h: 3, label: "+40% magnitude badge", delay: 50 },
    ],
    caption: "Entity change cards with magnitude + citations",
    transition: "slide",
  },
  {
    id: "home-why-now",
    title: "Home — WHY NOW & What to Watch",
    screenshot: "home-scrolled.jpg",
    narration: "WHY NOW chips score three competing narratives with evidence check counts — Demand-driven confidence at five of six, Competitive preemption at three of six. Below, What to Watch lists upcoming decision triggers with dates and rebalancing criteria.",
    durationSec: 10,
    highlights: [
      { x: 31, y: 48, w: 40, h: 4, label: "WHY NOW evidence chips", delay: 10 },
      { x: 31, y: 52, w: 40, h: 12, label: "What to Watch calendar", delay: 50 },
    ],
    caption: "Evidence-scored narratives + decision calendar",
    transition: "none",
  },
  {
    id: "home-actions-sources",
    title: "Home — Actions & Sources",
    screenshot: "home-scrolled.jpg",
    narration: "The Actions table assigns work to you or to agents — with priority levels P zero and P one, deadlines, and clear ownership. The Sources section lists every primary source consulted, with publication dates for full provenance.",
    durationSec: 9,
    highlights: [
      { x: 31, y: 64, w: 40, h: 10, label: "Actions table: owner, priority, deadline", delay: 10 },
      { x: 31, y: 78, w: 40, h: 10, label: "7 primary sources with dates", delay: 50 },
    ],
    caption: "Assigned actions + source provenance",
    transition: "none",
  },
  {
    id: "home-right-rail",
    title: "Home — Briefing Agent Rail",
    screenshot: "home-dark.jpg",
    narration: "The right rail hosts the Briefing Agent — always visible context. It shows the three things that matter most this morning, with direct entity links. Below: quick action buttons, entity health badges, and recent analysis threads.",
    durationSec: 9,
    highlights: [
      { x: 82, y: 4, w: 17, h: 35, label: "Briefing Agent panel", delay: 10 },
      { x: 82, y: 68, w: 17, h: 10, label: "Entity list with status", delay: 50 },
    ],
    caption: "Always-on briefing agent with entity context",
    transition: "none",
  },

  // ═══════════════════════════════════════════════════
  // ACT 1B: HOME INTERACTIONS
  // ═══════════════════════════════════════════════════
  {
    id: "nav-surfaces",
    title: "Home — Surface Navigation",
    screenshot: "home-dark.jpg",
    narration: "Five surface tabs span the top bar — Home, Reports, Chat, Inbox, Me. Each surface is a distinct workspace with its own left rail, center pane, and right rail. One click switches context instantly with no page reload. The active tab glows terracotta.",
    durationSec: 7,
    highlights: [
      { x: 32, y: 0, w: 30, h: 3, label: "Home · Reports · Chat · Inbox · Me", delay: 10 },
    ],
    caption: "Five surfaces, zero page reloads",
    transition: "none",
  },
  {
    id: "home-search",
    title: "Home — Search & Filter",
    screenshot: "home-dark.jpg",
    narration: "The left rail includes a real-time entity search bar. Type to instantly filter entities across all surfaces. The topbar adds a global search accessible from anywhere. Both use fuzzy matching with prefix scoring so partial queries still find results.",
    durationSec: 8,
    highlights: [
      { x: 0, y: 5, w: 8, h: 5, label: "Left rail entity search", delay: 10 },
      { x: 60, y: 0, w: 15, h: 3, label: "Global topbar search", delay: 40 },
    ],
    caption: "Instant fuzzy search across all entities",
    transition: "none",
  },
  {
    id: "home-entity-popover",
    title: "Home — Entity Popovers",
    screenshot: "home-dark.jpg",
    narration: "Clicking any entity mention opens a rich popover card. Popovers stack — click a linked entity inside a popover and a second card floats above the first. Press Escape to close the topmost. Each popover shows status, sources, backlinks, and quick actions.",
    durationSec: 9,
    highlights: [
      { x: 35, y: 36, w: 12, h: 2, label: "Entity mention → popover", delay: 10 },
      { x: 40, y: 20, w: 30, h: 30, label: "Stacking popover cards", delay: 45 },
    ],
    caption: "Stacking entity popovers with backlinks",
    transition: "none",
  },
  {
    id: "home-mention-tags",
    title: "Home — Mentions, Tags & Backlinks",
    screenshot: "home-dark.jpg",
    narration: "At-mentions and hash-tag chips are first-class objects. Click an at-mention to expand entity details inline. Click a tag chip to see all entities sharing that tag in a floating popover. The backlinks section shows every place an entity is referenced — full bidirectional linking.",
    durationSec: 9,
    highlights: [
      { x: 35, y: 38, w: 10, h: 2, label: "@mention → inline expand", delay: 10 },
      { x: 50, y: 38, w: 8, h: 2, label: "#tag → popover filter", delay: 40 },
      { x: 40, y: 50, w: 15, h: 3, label: "Backlinks: Referred by...", delay: 70 },
    ],
    caption: "Bidirectional entity linking with @mentions and #tags",
    transition: "none",
  },
  {
    id: "home-toast-scroll",
    title: "Home — Toasts & Scroll Tracking",
    screenshot: "home-dark.jpg",
    narration: "A toast notification system provides instant feedback — copied to clipboard, report refreshed, action completed. Toasts appear top-right and auto-dismiss. Scroll-spy tracks your position within the daily brief, highlighting the active section in the left rail as you scroll.",
    durationSec: 8,
    highlights: [
      { x: 70, y: 3, w: 15, h: 5, label: "Toast notifications", delay: 10 },
      { x: 0, y: 15, w: 8, h: 3, label: "Active section highlight", delay: 40 },
    ],
    caption: "Toast feedback + scroll-spy navigation",
    transition: "none",
  },

  // ═══════════════════════════════════════════════════
  // ACT 2: REPORTS SURFACE
  // ═══════════════════════════════════════════════════
  {
    id: "reports-overview",
    title: "Reports — Gallery View",
    screenshot: "reports-dark.jpg",
    narration: "The Reports surface is your research library. Eighty-seven reports across three hundred twelve sources. The gallery view shows mini report cards with entity names, status badges — verified, review, stale, draft — source counts, and connected entity graphs.",
    durationSec: 10,
    highlights: [
      { x: 8, y: 4, w: 72, h: 8, label: "87 reports · 312 sources · 18 need review", delay: 10 },
      { x: 8, y: 14, w: 72, h: 50, label: "Report card gallery", delay: 40 },
    ],
    caption: "Report gallery with verification status",
    transition: "slide",
  },
  {
    id: "reports-left-rail",
    title: "Reports — Universe Navigation",
    screenshot: "reports-dark.jpg",
    narration: "The left rail organizes reports by universe, company, and monitoring category. AI Infrastructure contains Anthropic, OpenAI, Mistral, Bug Zero, and Google DeepMind. Briefs and monitoring entries track specific coverage threads.",
    durationSec: 8,
    highlights: [
      { x: 0, y: 5, w: 8, h: 40, label: "Universe / Company tree", delay: 10 },
    ],
    caption: "Hierarchical entity navigation",
    transition: "none",
  },
  {
    id: "reports-filter-tabs",
    title: "Reports — Filter & View Modes",
    screenshot: "reports-dark.jpg",
    narration: "Filter tabs let you slice by status — All, Verified, Review, Stale, Drafting. View modes switch between Gallery, Board, Table, and Graph layouts. A sort dropdown and filter button provide additional controls.",
    durationSec: 8,
    highlights: [
      { x: 30, y: 10, w: 40, h: 3, label: "Gallery · Board · Table · Graph views", delay: 10 },
      { x: 30, y: 10, w: 50, h: 3, label: "Status filters: All 87 · Verified 12 · Review 18", delay: 40 },
    ],
    caption: "Multi-view layout with status filtering",
    transition: "none",
  },
  {
    id: "reports-entity-agent",
    title: "Reports — Entity Agent Panel",
    screenshot: "reports-dark.jpg",
    narration: "Clicking an entity opens the Entity Agent panel on the right. For Anthropic: five of five claims verified, twelve sources, two hours since last refresh, ninety three dependencies tracked. The agent answers questions about claims, expiring evidence, and source health.",
    durationSec: 10,
    highlights: [
      { x: 82, y: 4, w: 17, h: 60, label: "Entity Agent panel", delay: 10 },
      { x: 82, y: 13, w: 8, h: 5, label: "5/5 claims verified", delay: 40 },
      { x: 90, y: 13, w: 8, h: 5, label: "12 sources", delay: 60 },
    ],
    caption: "Entity intelligence agent with live verification",
    transition: "none",
  },
  {
    id: "reports-card-detail",
    title: "Reports — Card Anatomy",
    screenshot: "reports-dark.jpg",
    narration: "Each report card is information-dense. The Anthropic card shows: enterprise tier repricing plus forty percent, minimal churn, managed agent tier at point one six eight per one K tokens. Tag badges, source links to Reuters and TechCrunch, connected entity graph, signal sparkline, and a Notebook Ready status badge.",
    durationSec: 10,
    highlights: [
      { x: 8, y: 14, w: 22, h: 20, label: "Anthropic report card", delay: 10 },
      { x: 8, y: 21, w: 22, h: 3, label: "Source links: Reuters, TechCrunch", delay: 50 },
      { x: 8, y: 28, w: 22, h: 3, label: "Signal sparkline + Notebook Ready", delay: 75 },
    ],
    caption: "Dense report cards: signals, sources, status",
    transition: "none",
  },

  {
    id: "reports-graph-view",
    title: "Reports — Graph Visualization",
    screenshot: "reports-graph.jpg",
    narration: "The Graph view transforms your report library into an interactive network topology. D3 force-directed layout shows entity relationships — node size reflects source count, edge thickness shows connection strength. Hover to highlight neighbors. Four topology modes: Force, Hierarchy, Radial, and TDA persistence diagrams.",
    durationSec: 10,
    highlights: [
      { x: 8, y: 14, w: 72, h: 55, label: "D3 force-directed entity graph", delay: 10 },
      { x: 30, y: 10, w: 18, h: 3, label: "Topology modes: Force · Hierarchy · Radial · TDA", delay: 50 },
    ],
    caption: "Interactive graph with 4 topology modes",
    transition: "slide",
  },
  {
    id: "reports-board-table",
    title: "Reports — Board & Table Views",
    screenshot: "reports-board.jpg",
    narration: "Board view arranges reports as kanban columns by verification status — Verified, Review, Stale, Drafting. Drag cards between columns to update status. Table view provides a dense spreadsheet layout with sortable columns — entity, status, sources, last updated, and connected count. Four views serve four workflows.",
    durationSec: 9,
    highlights: [
      { x: 8, y: 14, w: 72, h: 50, label: "Kanban board by verification status", delay: 10 },
    ],
    caption: "Board kanban + Table spreadsheet views",
    transition: "none",
  },
  {
    id: "reports-notebook",
    title: "Reports — Notebook Editor",
    screenshot: "reports-dark.jpg",
    narration: "Each report card opens into a rich notebook view. The editor supports inline editing with content-editable blocks, at-mention entity linking, and AI writing chips that generate analysis inline. Notebook Ready badges on cards indicate which reports have complete structured content.",
    durationSec: 9,
    highlights: [
      { x: 8, y: 14, w: 22, h: 20, label: "Report card → notebook editor", delay: 10 },
      { x: 12, y: 30, w: 15, h: 2, label: "AI writing chip: Write with AI", delay: 50 },
    ],
    caption: "Rich notebook editor with AI writing assistance",
    transition: "none",
  },

  // ═══════════════════════════════════════════════════
  // ACT 3: CHAT SURFACE
  // ═══════════════════════════════════════════════════
  {
    id: "chat-overview",
    title: "Chat — Coverage Agent",
    screenshot: "chat-dark.jpg",
    narration: "The Chat surface connects you to specialized agents. The Coverage Agent scans your entire portfolio — loading context for five entities, forty eight sources, and twelve claims. It identifies which reports need attention and shows its work step by step.",
    durationSec: 10,
    highlights: [
      { x: 8, y: 4, w: 72, h: 8, label: "Coverage Agent: 5 entities · 48 sources", delay: 10 },
      { x: 30, y: 25, w: 40, h: 25, label: "Agent analysis with tool badges", delay: 40 },
    ],
    caption: "Specialized coverage agent with full trace",
    transition: "slide",
  },
  {
    id: "chat-thread-list",
    title: "Chat — Thread Management",
    screenshot: "chat-dark.jpg",
    narration: "The left rail shows active and archived threads. Active threads have real-time indicators — the AI Infrastructure Coverage thread shows three reports needing attention. Recent threads include deep dives, fundraise watch refreshes, and competitive analysis.",
    durationSec: 8,
    highlights: [
      { x: 0, y: 5, w: 8, h: 40, label: "Thread list: Active / Recent / Archived", delay: 10 },
    ],
    caption: "Persistent conversation threads by topic",
    transition: "none",
  },
  {
    id: "chat-changes-block",
    title: "Chat — Changes & Tool Badges",
    screenshot: "chat-dark.jpg",
    narration: "Agent responses include structured changes blocks. Anthropic has three new signals — enterprise tier repricing, managed agent tier, new enterprise references. Tool badges show exactly which tools were used: entity diff, signal extract, web search. Every claim is traceable.",
    durationSec: 10,
    highlights: [
      { x: 31, y: 70, w: 40, h: 12, label: "Structured changes block", delay: 10 },
      { x: 31, y: 77, w: 20, h: 2, label: "Tool badges: entity_diff, signal_extract", delay: 50 },
    ],
    caption: "Structured entity changes with tool provenance",
    transition: "none",
  },
  {
    id: "chat-right-rail",
    title: "Chat — Session Context Rail",
    screenshot: "chat-dark.jpg",
    narration: "The right rail provides session context — progress indicators, artifact links to generated files, agent roster showing Coverage, Research, Verify, and Extract workers, and source list tracking Convex, Web Search, MCP tools, Bloomberg, and PitchBook.",
    durationSec: 9,
    highlights: [
      { x: 82, y: 4, w: 17, h: 50, label: "Session context: Progress + Artifacts + Agents + Sources", delay: 10 },
    ],
    caption: "Full session context with agent roster",
    transition: "none",
  },
  {
    id: "chat-action-buttons",
    title: "Chat — Action Buttons & Updates",
    screenshot: "chat-dark.jpg",
    narration: "Action buttons let you open the notebook, verify claims, or export a memo — all one click from the agent's output. Live update banners show report updates and entity signal changes in real time, with direct links to open the full report.",
    durationSec: 8,
    highlights: [
      { x: 31, y: 80, w: 25, h: 3, label: "Open notebook · Verify claims · Export memo", delay: 10 },
      { x: 31, y: 85, w: 40, h: 5, label: "Live update: 1 report updated, +3 signals", delay: 45 },
    ],
    caption: "One-click actions from agent output",
    transition: "none",
  },

  {
    id: "chat-artifact-overlay",
    title: "Chat — Artifact Preview",
    screenshot: "chat-scrolled.jpg",
    narration: "When agents generate artifacts — memos, reports, charts — they render inline as preview cards. Click to expand into a full artifact overlay with close button. Artifacts are first-class objects: referenceable, shareable, and versioned. The artifact frame shows the generated content alongside the conversation that produced it.",
    durationSec: 9,
    highlights: [
      { x: 35, y: 50, w: 30, h: 20, label: "Artifact preview card → full overlay", delay: 10 },
      { x: 55, y: 53, w: 8, h: 2, label: "Version badge + share link", delay: 50 },
    ],
    caption: "Inline artifact previews with full overlay",
    transition: "none",
  },
  {
    id: "chat-agent-memory",
    title: "Chat — Agent Memory & Trace",
    screenshot: "chat-dark.jpg",
    narration: "The agent memory panel tracks accumulated observations across sessions. Each memory item is editable — correct a wrong inference and the agent learns. The trace panel shows the full execution path: which tools were called, what data was fetched, how claims were verified. Full transparency into agent reasoning.",
    durationSec: 9,
    highlights: [
      { x: 82, y: 30, w: 17, h: 20, label: "Agent memory: edit/delete items", delay: 10 },
      { x: 82, y: 55, w: 17, h: 15, label: "Execution trace: tool calls + data flow", delay: 50 },
    ],
    caption: "Editable agent memory + full execution trace",
    transition: "none",
  },

  // ═══════════════════════════════════════════════════
  // ACT 4: INBOX SURFACE
  // ═══════════════════════════════════════════════════
  {
    id: "inbox-overview",
    title: "Inbox — Signal Triage",
    screenshot: "inbox-dark.jpg",
    narration: "The Inbox surface is your signal triage center. Fifty three items, four needing action. Three priority lanes: Must Clear, Prep, and Batch or Defer — with counts of four, seven, and forty two. Every signal is pre-classified so you start with what matters most.",
    durationSec: 10,
    highlights: [
      { x: 8, y: 5, w: 72, h: 10, label: "Priority lanes: 4 Must Clear · 7 Prep · 42 Batch", delay: 10 },
      { x: 8, y: 15, w: 72, h: 20, label: "Selected item detail card", delay: 50 },
    ],
    caption: "Pre-classified signal triage with priority lanes",
    transition: "slide",
  },
  {
    id: "inbox-item-detail",
    title: "Inbox — Item Detail Card",
    screenshot: "inbox-dark.jpg",
    narration: "Selecting an item expands a rich detail card. The Anthropic partnership terms item shows: what it is, what to do next, why it matters now — with signal match, evidence count, and calendar context. Action buttons: Open memo, Draft reply, Research, or Defer.",
    durationSec: 9,
    highlights: [
      { x: 30, y: 15, w: 40, h: 25, label: "Detail card: summary, next steps, why now", delay: 10 },
      { x: 30, y: 26, w: 40, h: 5, label: "Signal Match · Evidence · Calendar", delay: 50 },
    ],
    caption: "Rich context cards with action routing",
    transition: "none",
  },
  {
    id: "inbox-left-rail",
    title: "Inbox — Source Filters",
    screenshot: "inbox-dark.jpg",
    narration: "The left rail filters by lane — All Items, Act, Read, Waiting, Filed, Delete — and by source: Email, Slack, Docs, Alerts. Each source shows its item count, giving you full visibility into where signals are coming from.",
    durationSec: 8,
    highlights: [
      { x: 0, y: 5, w: 8, h: 35, label: "Lane + Source filters", delay: 10 },
    ],
    caption: "Multi-source inbox with lane filtering",
    transition: "none",
  },
  {
    id: "inbox-right-rail",
    title: "Inbox — Context Panel",
    screenshot: "inbox-dark.jpg",
    narration: "The right rail shows deep context for the selected item. For the Anthropic partnership terms: the pricing model analysis, three scenarios to model before the board call — absorb cost, pass through to customer, renegotiate tier — with linked sources.",
    durationSec: 9,
    highlights: [
      { x: 82, y: 4, w: 17, h: 50, label: "Context panel: analysis + scenarios + sources", delay: 10 },
      { x: 82, y: 65, w: 17, h: 10, label: "Action buttons: Open memo, Draft reply, Defer", delay: 50 },
    ],
    caption: "Deep context with scenario analysis",
    transition: "none",
  },

  // ═══════════════════════════════════════════════════
  // ACT 5: ME SURFACE
  // ═══════════════════════════════════════════════════
  {
    id: "me-overview",
    title: "Me — Identity & Config",
    screenshot: "me-dark.jpg",
    narration: "The Me surface is your identity and configuration hub. The USER dot M D file defines who you are to the system — your role, background, decision style, voice preferences, watchlist, and competitors. Every report, agent, and notification is shaped by this profile.",
    durationSec: 10,
    highlights: [
      { x: 8, y: 5, w: 72, h: 55, label: "USER.md: Identity · Decision style · Voice · Watchlist", delay: 10 },
    ],
    caption: "USER.md — your identity file shapes everything",
    transition: "slide",
  },
  {
    id: "me-runtime",
    title: "Me — Runtime Configuration",
    screenshot: "me-dark.jpg",
    narration: "The Runtime section shows how USER dot M D powers reports, chats, and agents. How NodeBench sees you: Founder with a banker lens. Five active rules govern behavior. Report shaping is evidence-first — hard numbers, source citations, and falsifiable claims over narrative.",
    durationSec: 9,
    highlights: [
      { x: 30, y: 52, w: 40, h: 12, label: "Runtime: Lens · Rules · Report shaping", delay: 10 },
    ],
    caption: "Identity-driven runtime configuration",
    transition: "none",
  },
  {
    id: "me-integrations",
    title: "Me — Integrations & Plan",
    screenshot: "me-dark.jpg",
    narration: "Integrations connect your workflow — HubSpot and Notion are connected, Linear, Slack, and Gmail are available. The plan section shows Founder tier at forty nine dollars per month, with eight paid calls used out of two hundred.",
    durationSec: 8,
    highlights: [
      { x: 30, y: 68, w: 40, h: 10, label: "Integrations: HubSpot, Notion connected", delay: 10 },
      { x: 30, y: 82, w: 40, h: 8, label: "Founder plan: $49/mo · 8/200 calls", delay: 45 },
    ],
    caption: "Integration status + usage tracking",
    transition: "none",
  },
  {
    id: "me-agent-memory",
    title: "Me — Agent Memory",
    screenshot: "me-dark.jpg",
    narration: "The Agent Memory section tracks eight hundred forty seven observations and twenty three corrections — the system's accumulated understanding of your preferences, patterns, and working style. The Profile Agent in the right rail shows how your voice profile was learned.",
    durationSec: 9,
    highlights: [
      { x: 0, y: 20, w: 8, h: 8, label: "847 observations · 23 corrections", delay: 10 },
      { x: 82, y: 4, w: 17, h: 30, label: "Profile Agent: voice analysis", delay: 50 },
    ],
    caption: "Accumulated agent memory + voice profiling",
    transition: "none",
  },

  // ═══════════════════════════════════════════════════
  // ACT 6: CROSS-CUTTING FEATURES
  // ═══════════════════════════════════════════════════
  {
    id: "wide-mode",
    title: "Wide Mode",
    screenshot: "home-wide.jpg",
    narration: "Wide mode, inspired by Streamlit, expands the center content area while keeping both rails visible. Grid layouts gain extra columns — What Changed shows four cards per row. Toggle with the W key or the toolbar button. Preference persists across sessions.",
    durationSec: 8,
    highlights: [
      { x: 92, y: 1, w: 3, h: 2, label: "Wide toggle (W key)", delay: 10 },
      { x: 25, y: 72, w: 55, h: 18, label: "4-column What Changed grid", delay: 40 },
    ],
    caption: "Streamlit-style wide mode with smart layout",
    transition: "slide",
  },
  {
    id: "light-theme",
    title: "Light Theme",
    screenshot: "home-light.jpg",
    narration: "Full light theme support. Every color token adapts — backgrounds, text, borders, accent colors, and status badges all resolve through CSS custom properties. Toggle with the theme button in the top bar. No hardcoded colors.",
    durationSec: 7,
    highlights: [
      { x: 92, y: 1, w: 3, h: 2, label: "Theme toggle", delay: 10 },
    ],
    caption: "Complete light/dark theme via CSS variables",
    transition: "slide",
  },
  {
    id: "command-palette",
    title: "Command Palette",
    screenshot: "home-dark.jpg",
    narration: "Command K opens a global search palette — find reports, entities, and actions instantly. Fuzzy search with prefix scoring, keyboard navigation, and quick action execution. The universal entry point for power users.",
    durationSec: 7,
    highlights: [
      { x: 80, y: 1, w: 15, h: 2, label: "Cmd+K: Global search", delay: 10 },
    ],
    caption: "Global command palette with fuzzy search",
    transition: "none",
  },
  {
    id: "keyboard-a11y",
    title: "Keyboard & Accessibility",
    screenshot: "reports-dark.jpg",
    narration: "Every interactive element is keyboard-accessible. Report cards have role button, tab index, and aria labels. Enter and Space activate cards. Icon-only buttons have descriptive labels. The entire prototype respects reduced motion preferences.",
    durationSec: 8,
    highlights: [
      { x: 8, y: 14, w: 72, h: 25, label: "All cards: role=button, tabindex=0, aria-label", delay: 10 },
    ],
    caption: "Full keyboard navigation + ARIA labels",
    transition: "none",
  },
  {
    id: "css-tokens",
    title: "Design System",
    screenshot: "home-dark.jpg",
    narration: "One hundred seventy nine CSS custom properties power the design system. Semantic tokens for every color, spacing, and typography value. Dark and light themes switch instantly. No inline hex colors — eighty seven percent variable coverage across thirteen thousand lines of code.",
    durationSec: 8,
    highlights: [],
    caption: "179 CSS variables · 87% token coverage · 13,807 lines",
    transition: "fade",
  },

  {
    id: "evidence-checklist",
    title: "Evidence Verification",
    screenshot: "home-dark.jpg",
    narration: "Every claim carries an evidence checklist popup. Click any verification badge to see the full breakdown — six boolean checks: government source, corroborated by two plus sources, hard numbers present, recent data, named analyst, and falsifiable claim. Grounded explanations score four of six or higher. Partial evidence shows exactly what is missing.",
    durationSec: 9,
    highlights: [
      { x: 55, y: 37, w: 12, h: 3, label: "Verified badge → evidence popup", delay: 10 },
      { x: 40, y: 40, w: 25, h: 12, label: "6-point evidence checklist", delay: 45 },
    ],
    caption: "Boolean evidence checklist per claim",
    transition: "none",
  },
  {
    id: "disambiguation",
    title: "Entity Disambiguation",
    screenshot: "reports-dark.jpg",
    narration: "When a search query matches multiple entities, a disambiguation dialog appears. Select the correct entity from a ranked list showing name, description, source count, and match confidence. The system learns from selections to improve future matching. No ambiguous links — every reference resolves to exactly one entity.",
    durationSec: 8,
    highlights: [
      { x: 30, y: 30, w: 30, h: 15, label: "Disambiguation: Choose the right entity", delay: 10 },
    ],
    caption: "Entity disambiguation with ranked matches",
    transition: "none",
  },
  {
    id: "responsive-mobile",
    title: "Mobile Responsive",
    screenshot: "home-mobile.jpg",
    narration: "The entire prototype is responsive down to three hundred ninety pixel mobile viewports. Rails collapse into a bottom navigation bar. Cards stack single-column. Touch targets meet the forty four pixel minimum. The conversational input and need-to-know feed are fully usable on phone — no horizontal overflow, no broken layouts.",
    durationSec: 8,
    highlights: [
      { x: 0, y: 90, w: 100, h: 10, label: "Bottom nav: Home · Reports · Chat · Inbox · Me", delay: 10 },
      { x: 5, y: 20, w: 90, h: 40, label: "Single-column stacked cards", delay: 40 },
    ],
    caption: "Full mobile responsive at 390px viewport",
    transition: "slide",
  },
  {
    id: "focus-traps-dialogs",
    title: "Focus Traps & Dialogs",
    screenshot: "home-dark.jpg",
    narration: "Modal dialogs and the command palette use proper focus traps — Tab cycles within the dialog, Escape closes it, and focus returns to the element that triggered it. No keyboard user gets stuck. The command palette captures Cmd K globally and provides full keyboard navigation through results with arrow keys and Enter to select.",
    durationSec: 8,
    highlights: [
      { x: 30, y: 25, w: 40, h: 30, label: "Focus trap: Tab cycles, Escape closes", delay: 10 },
    ],
    caption: "WCAG focus management for all dialogs",
    transition: "none",
  },
  {
    id: "print-view",
    title: "Print Stylesheet",
    screenshot: "home-light.jpg",
    narration: "A dedicated print stylesheet hides navigation, toolbars, and interactive controls. Report cards and daily brief content render with light backgrounds, dark text, and visible borders for readability on paper. Page breaks avoid splitting cards mid-content. The daily brief prints as a clean one-page summary.",
    durationSec: 7,
    highlights: [],
    caption: "Print-optimized layout for daily briefs",
    transition: "fade",
  },

  // ═══════════════════════════════════════════════════
  // OUTRO
  // ═══════════════════════════════════════════════════
  {
    id: "outro",
    title: "NodeBench",
    screenshot: "home-dark.jpg",
    narration: "NodeBench. Operating intelligence for agent-native businesses. Five surfaces, four view modes, eighty seven reports, three hundred twelve sources. Real-time verification, graph topology, entity disambiguation, bidirectional linking, and an agent memory that improves with every session. One hundred seventy nine design tokens. Full keyboard accessibility. Responsive to mobile. This is what founder-grade intelligence looks like.",
    durationSec: 10,
    highlights: [],
    caption: "nodebenchai.com",
    transition: "fade",
  },
];

// Total video duration
export const totalDurationSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);
export const totalFrames = totalDurationSec * FPS;

// Scene frame offsets
export function getSceneFrameOffsets(): { id: string; from: number; durationFrames: number }[] {
  let offset = 0;
  return scenes.map((s) => {
    const entry = { id: s.id, from: offset, durationFrames: s.durationSec * FPS };
    offset += s.durationSec * FPS;
    return entry;
  });
}
