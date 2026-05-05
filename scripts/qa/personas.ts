/**
 * Persona scenarios for the /redesign route — Obsidian + Karpathy + Notion + Roam hybrid QA.
 *
 * Each persona is a real-world target user who would adopt NodeBench as their entity-intelligence
 * notebook. The scenario describes a concrete task they'd do in the redesign route. Gemini 3.1 Pro
 * grades the experience against a Notion / Roam / Obsidian rubric.
 *
 * Sources for "obsidian + karpathy flow":
 *   - Obsidian: plain-text vault, [[wiki-links]], graph view, daily notes, plugin community
 *   - Karpathy: long-form distilled writing, "from scratch" derivations, hand-cited references,
 *     daily/weekly review threads, opinionated argued claims
 *   - Notion: blocks, slash menu, page chrome, properties, comments
 *   - Roam: bullet-everything, [[backlinks]], block transclusion, daily notes
 */

export type PersonaId =
  | "banker_diligence"
  | "founder_pre_meeting"
  | "researcher_long_form"
  | "teacher_relocation"
  | "operator_pipeline"
  | "karpathy_learner"
  | "obsidian_vault_keeper";

export interface PersonaScenario {
  id: PersonaId;
  name: string;          // "Sam — small-cap banker"
  oneLine: string;       // "Pre-meeting diligence on a private mid-market borrower"
  context: string;       // 2-3 sentences of who they are, what they need
  startUrl: string;      // route under /redesign that they'd open first
  tasks: string[];       // 5-8 concrete actions they'd attempt in the notebook
  successCriteria: string[];  // outcomes the agent should verify
  rubricEmphasis: string[];   // which rubric dimensions matter most for this persona
}

export const PERSONAS: PersonaScenario[] = [
  {
    id: "banker_diligence",
    name: "Sam — small-cap banker",
    oneLine: "Pre-meeting diligence on a private mid-market borrower",
    context:
      "Sam is a banker preparing for a 1pm meeting with the CFO of a mid-market borrower. He needs a one-page tear-sheet with ownership, recent filings, hiring spike, peer comps, news, and red flags. Memo style: banker, citation-aware.",
    startUrl: "/redesign/reports/rep_orbital",
    tasks: [
      "Open the report notebook for Orbital Labs",
      "Skim the page chrome — does the status / kind / source count tell me whether this is fresh or stale?",
      "Read the existing claims and verify the citation badges are visible at a glance",
      "Add a new claim about peer comps via the toolbar `+ Claim`",
      "Trigger the slash menu by typing `/` and insert a `Source list` block",
      "Accept the pending agent patch (Hiring spike) — verify the new block lands styled",
      "Click an inline `[[Entity]]` chip to verify cross-report linking is obvious",
    ],
    successCriteria: [
      "Page chrome single-row + meta-pill scan completed in <3 seconds",
      "Claim status (verified/review) visible without hover",
      "Citation index `[N]` round-trips to source list",
      "Agent-pending patch is reviewable + accept/reject visible",
    ],
    rubricEmphasis: ["citation_clarity", "claim_status_visibility", "agent_review_loop", "scannability"],
  },
  {
    id: "founder_pre_meeting",
    name: "Priya — founder running diligence on a partner",
    oneLine: "Quick scan of a vendor before a partnership call",
    context:
      "Priya runs a 14-person AI startup. Has 7 minutes to read everything she has on a potential partner. She's a Notion power user, expects slash commands, expects to drag blocks, expects to comment.",
    startUrl: "/redesign/reports/rep_orbital",
    tasks: [
      "Land on the report and scan the property row in <2 seconds",
      "Use ⌘+F or visual scan to find risks quickly",
      "Type `/` to add a callout block — expect Notion-style menu",
      "Try to drag a block — does it work?",
      "Add a comment via 'Add comment' — discover the affordance",
      "Open the right rail to see pending edits / audit feed",
      "Tab to the slash menu items and Enter to insert",
    ],
    successCriteria: [
      "Slash menu opens within 100ms of `/` keystroke",
      "Slash menu has at least 12 items grouped by category",
      "Block hover handle (`+ ⋮⋮`) appears on the left of each block",
      "Hover background wash makes block boundaries discoverable",
      "Keyboard navigation in slash menu works (↑/↓/Enter/Esc)",
    ],
    rubricEmphasis: ["notion_parity", "keyboard_efficiency", "discoverability", "comment_affordance"],
  },
  {
    id: "researcher_long_form",
    name: "Maya — independent AI researcher",
    oneLine: "Long-form synthesis with backlinks and citations",
    context:
      "Maya writes 3,000-word distilled essays, hand-cited. She needs Markdown export, math support, and to chase backlinks across notebooks. Roam Research is her current stack.",
    startUrl: "/redesign/reports/rep_orbital",
    tasks: [
      "Read a long paragraph — does the typography feel publication-grade?",
      "Click an inline `[[Entity]]` chip to navigate cross-report",
      "Scroll to the bottom — find the backlinks / linked references panel",
      "Click a Linked Reference — does it navigate to the source report?",
      "Add a new heading and a long paragraph; verify line-height + measure feel right (Karpathy-style)",
      "Try inline code via the toolbar; expect `code` mark to render mono",
      "Export the page (Export ▾ button) — expect Markdown option",
    ],
    successCriteria: [
      "Body type measure ≤740 px (max-width), line-height 1.6-1.7",
      "Backlinks panel shows Linked + Unlinked sections",
      "Backlink snippets render `[[Entity]]` as terracotta chips",
      "Headings have aggressive negative tracking (Karpathy / NYT feel)",
      "Code mark exists in toolbar (or via slash menu)",
    ],
    rubricEmphasis: ["typography_quality", "backlinks_loop", "long_form_readability", "export_options"],
  },
  {
    id: "teacher_relocation",
    name: "Rachel — teacher researching a relocation",
    oneLine: "Research a school + district before a relocation conversation",
    context:
      "Rachel is a 6th-grade teacher considering a move. She is non-technical. She doesn't know what slash commands are. The UX must teach her in 15 seconds.",
    startUrl: "/redesign/reports/rep_orbital",
    tasks: [
      "Land on the report cold — is the page intent obvious?",
      "Read the property row — do labels make sense without a manual?",
      "Try to add a note — discover an affordance (hover handle, click anywhere, Enter)",
      "Try to share the page with a partner — find Share link",
      "Try to make it read-only for sharing — find Public read-only toggle",
      "Try to undo a change",
    ],
    successCriteria: [
      "First-impression clarity in <10 seconds (analyst diagnostic test)",
      "Toolbar buttons readable without hover tooltips",
      "Share / public-read-only toggle visible without scrolling",
      "No jargon ('TipTap', 'Convex', 'Notebook ID') visible to the user",
      "Undo/Redo discoverable",
    ],
    rubricEmphasis: ["zero_jargon", "first_impression_clarity", "affordance_visibility", "share_flow"],
  },
  {
    id: "operator_pipeline",
    name: "Jordan — RevOps operator",
    oneLine: "Bundle CRM + signals into a monthly memo with CSV export",
    context:
      "Jordan rolls up pipeline + customer signals into a monthly memo with CSV export to refresh the leadership deck. They expect tabular data, filterable lists, and Notion-database-ish properties.",
    startUrl: "/redesign/reports/rep_orbital",
    tasks: [
      "Find sources/claims/follow-ups counts in the chrome",
      "Click 'Export ▾' — expect CSV / Markdown / Notion / HubSpot options",
      "Find the Sources tab on Workspace — should be one click",
      "Trigger refresh-sources to update stale citations",
      "Find the audit feed — verify recent agent activity is visible",
    ],
    successCriteria: [
      "Properties row exposes counts AND freshness ('refreshed 2h ago')",
      "Export menu includes structured CRM-friendly options",
      "Refresh sources is a primary CTA, not buried",
      "Audit feed shows source-typed entries (user / chat / agent)",
    ],
    rubricEmphasis: ["export_breadth", "freshness_visibility", "audit_legibility", "crm_compatibility"],
  },
  {
    id: "karpathy_learner",
    name: "Andrej-style learner",
    oneLine: "Distill a complex topic into a tight derivation with citations",
    context:
      "A learner who writes long-form, opinionated, hand-derived notes (Karpathy style). They iterate inline, want fast keyboard input, mathematical-precision tracking, and visible source attribution. They REJECT chrome that gets in the way of writing. Lands the report in writing-focus mode (zen).",
    startUrl: "/redesign/reports/rep_orbital?focus=zen",
    tasks: [
      "Open the report and immediately start typing — does the cursor land where expected?",
      "Type a paragraph + `/` to insert heading 2 + continue typing",
      "Add a code block (looking for code-fence or ` syntax) — verify mono font + syntax tone",
      "Verify Cmd+B / Cmd+I work for bold / italic",
      "Add a [[backlink]] using the slash menu Entity link option",
      "Press Tab on a list item — expect indent",
      "Close the chrome panels (chat sidebar) to focus on writing — find the affordance",
    ],
    successCriteria: [
      "Composer-grade keyboard latency (no input lag)",
      "Cmd+B and Cmd+I work without explicit hint",
      "Slash menu groups are discoverable within 1 second of opening",
      "Tab/Shift+Tab indent in lists",
      "Distraction-free writing mode (or at minimum, no chrome that blocks the cursor)",
    ],
    rubricEmphasis: ["keyboard_latency", "writing_focus", "slash_menu_speed", "markdown_shortcuts"],
  },
  {
    id: "obsidian_vault_keeper",
    name: "An Obsidian vault keeper",
    oneLine: "Maintain a personal entity vault with [[backlinks]] and graph navigation",
    context:
      "An Obsidian power user expecting plain-text-feel, [[wikilinks]] everywhere, a graph/backlinks view, and the ability to convert the page to plain Markdown. They REJECT silent server-side mutation; they want every change auditable.",
    startUrl: "/redesign/reports/rep_orbital",
    tasks: [
      "Find at least one inline [[Entity]] link and click it",
      "Open the backlinks panel at the bottom of the page",
      "Verify Unlinked references are surfaced separately from Linked",
      "Try Cmd+/ or `[[` to autocomplete an entity link inline",
      "Open the audit feed — expect every save to be attributed (user / chat / agent)",
      "Find a graph/map view of relationships",
    ],
    successCriteria: [
      "[[Entity]] chips are visually consistent across body + backlinks + property row",
      "Backlinks panel shows Linked + Unlinked, with snippet preview",
      "Every patch in the audit feed shows source (user/chat/agent) + timestamp",
      "A graph view exists at /redesign/workspace?tab=map",
    ],
    rubricEmphasis: ["wikilinks_consistency", "backlinks_completeness", "audit_attribution", "graph_view"],
  },
];

/**
 * The judge rubric — Gemini 3.1 Pro scores each persona scenario on these dimensions.
 * Total 100 points distributed across 8 dimensions, weighted by persona's `rubricEmphasis`.
 */
export const RUBRIC_DIMENSIONS: Record<string, { name: string; description: string }> = {
  notion_parity: {
    name: "Notion parity",
    description:
      "Slash menu, block hover handles, page chrome (icon + title + properties), keyboard nav, hover wash. Match Notion-iconic patterns.",
  },
  roam_parity: {
    name: "Roam parity",
    description:
      "[[Entity]] inline chips, backlinks panel, bullet-everything feel for lists, daily-note style permanence.",
  },
  obsidian_parity: {
    name: "Obsidian parity",
    description:
      "Plain-text-feel editor, [[wikilinks]] autocomplete, graph view, audit-trail of every save.",
  },
  karpathy_parity: {
    name: "Karpathy long-form parity",
    description:
      "Publication-grade typography, generous gutter, headings with aggressive tracking, no chrome blocking writing focus.",
  },
  zero_jargon: {
    name: "Zero jargon visible",
    description:
      "No 'TipTap', 'Convex', 'Notebook ID', 'block_id' visible to a non-technical user. Labels are plain English.",
  },
  scannability: {
    name: "Scannability",
    description:
      "Page chrome + claim badges + meta pills are scannable in <3 seconds. Status visible without hover.",
  },
  agent_review_loop: {
    name: "Agent review loop",
    description:
      "Chat / agent patches land in a Pending Edits queue. Accept/Reject visible. Audit feed records every transition.",
  },
  citation_clarity: {
    name: "Citation clarity",
    description:
      "[N] citation chip, source-list block, source attribution per claim. Round-trip from claim → source easy.",
  },
  claim_status_visibility: {
    name: "Claim status visibility",
    description:
      "verified / review / rejected status visible without hover. Color-coded left border. Status pill explicit.",
  },
  keyboard_efficiency: {
    name: "Keyboard efficiency",
    description:
      "Slash menu, Cmd+B/I, Tab indent, ⌘+Enter for primary actions. No mouse required for core writing.",
  },
  discoverability: {
    name: "Discoverability",
    description:
      "Block hover handles, hover wash on blocks, hint text in toolbar, addons appear on hover. Affordances are findable.",
  },
  comment_affordance: {
    name: "Comment affordance",
    description:
      "Add comment is visible. Comments anchor to blocks. Threaded discussion adjacent to the document.",
  },
  typography_quality: {
    name: "Typography quality",
    description:
      "40 px display, weight 510-700, negative tracking on headings. Body 14-16 px / 1.65 leading. Max-width 720-740 px.",
  },
  backlinks_loop: {
    name: "Backlinks loop",
    description:
      "Linked + Unlinked references, snippet preview, click navigates to source report. Backlinks update on save.",
  },
  long_form_readability: {
    name: "Long-form readability",
    description:
      "Type measure, line-height, paragraph spacing all support 3,000+ word essays without fatigue.",
  },
  export_options: {
    name: "Export options",
    description:
      "Markdown / CSV / HubSpot / Notion / Linear export. CRM-row format for entity lists.",
  },
  first_impression_clarity: {
    name: "First-impression clarity",
    description:
      "A new user understands the page intent in <10 seconds. Page-chrome + first paragraph carry the load.",
  },
  affordance_visibility: {
    name: "Affordance visibility",
    description:
      "Buttons readable without tooltip. Toolbar labels make sense to non-technical users. No icon-only mystery buttons in critical paths.",
  },
  share_flow: {
    name: "Share + public-read-only flow",
    description:
      "Share link, Public read-only toggle. Read-only renders the doc without edit chrome.",
  },
  export_breadth: {
    name: "Export breadth",
    description:
      "Multiple export formats. Structured exports (CSV row per entity, JSON for API, Markdown for vault).",
  },
  freshness_visibility: {
    name: "Freshness visibility",
    description:
      "Source freshness ('refreshed 2h ago') visible. Stale sources flagged. Refresh-sources CTA primary.",
  },
  audit_legibility: {
    name: "Audit legibility",
    description:
      "Every save attributed (user/chat/agent). Audit feed in right rail. Last edit timestamp on chrome.",
  },
  crm_compatibility: {
    name: "CRM compatibility",
    description:
      "Properties row maps to CRM fields. Export-to-HubSpot/Salesforce produces clean rows.",
  },
  keyboard_latency: {
    name: "Keyboard latency",
    description:
      "Sub-50ms input lag. No layout jank on each keystroke. Markdown shortcuts (* for list, # for heading) work inline.",
  },
  writing_focus: {
    name: "Writing focus / distraction-free",
    description:
      "Chrome can be hidden / minimized. Cursor stays predictable. No autocomplete popovers that block typing.",
  },
  slash_menu_speed: {
    name: "Slash menu speed",
    description:
      "/ opens within 100ms. Filtering by typing is instant. Selection inserts in <50ms.",
  },
  markdown_shortcuts: {
    name: "Markdown shortcuts",
    description:
      "**bold**, *italic*, # heading, - list, > quote, ``` code, --- divider all work inline as you type.",
  },
  wikilinks_consistency: {
    name: "Wikilinks consistency",
    description:
      "[[Entity]] renders identically in body, backlinks snippets, property row. Always clickable.",
  },
  backlinks_completeness: {
    name: "Backlinks completeness",
    description:
      "Linked refs (explicit [[]]) + unlinked refs (text match) both surfaced. Counts shown.",
  },
  audit_attribution: {
    name: "Audit attribution",
    description:
      "Every block has author trail. Hover a block reveals last-edited-by + timestamp. No silent agent writes.",
  },
  graph_view: {
    name: "Graph view",
    description:
      "A graph/map visualization exists for the entity neighborhood. Reachable in 1-2 clicks.",
  },
};
