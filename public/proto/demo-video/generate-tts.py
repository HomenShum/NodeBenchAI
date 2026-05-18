"""
Generate TTS audio for all NodeBench demo video scenes.
Uses edge-tts (Microsoft Edge TTS) as a reliable cross-platform fallback.
For Supertonic 3: pip install supertonic (when available).

Usage:
  pip install edge-tts
  python generate-tts.py
"""
import asyncio
import json
import os
import sys
import io

# Force UTF-8 stdout on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Scene narrations — extracted from storyboard.ts
SCENES = [
    ("intro", "NodeBench is the operating intelligence layer for agent-native businesses. It watches your entities, tracks signals, and surfaces what matters — before you ask."),
    ("home-overview", "The Home surface is your morning command center. At the top, entity cards show live status for every company you track — with source counts, claim verification badges, and freshness indicators."),
    ("home-input", "A rich conversational input bar lets you ask about signals, research entities, or start threads. Action chips provide quick access to context, references, commands, and file attachments."),
    ("home-daily-edition", "The Daily Edition banner shows today's signal summary — seven sources, five entities, three items needing attention. Below it, your exposure tracker shows estimated annual API spend at risk and active deals impacted."),
    ("home-need-to-know", "Need to Know is the intelligence feed. Each signal shows the entity, the change, evidence citations, and a verification badge — Verified with three sources, or Estimated when data is still gathering. Your exposure note tells you exactly why each signal matters to you."),
    ("home-action-cards", "Two action cards sit side by side. Next Best Action recommends reviewing Anthropic partnership terms before Thursday's board call. The Daily Sweep shows five items triaged from overnight signals — each routed to the right lane: Now, Prep, or Batch."),
    ("home-what-changed", "What Changed cards are the heartbeat of your coverage. Each card shows an entity, the magnitude of change — plus forty percent for Anthropic repricing, one hundred seventy five billion dollar Sequoia counter-bid — with source citations and your strategic context."),
    ("home-why-now", "WHY NOW chips score three competing narratives with evidence check counts — Demand-driven confidence at five of six, Competitive preemption at three of six. Below, What to Watch lists upcoming decision triggers with dates and rebalancing criteria."),
    ("home-actions-sources", "The Actions table assigns work to you or to agents — with priority levels P zero and P one, deadlines, and clear ownership. The Sources section lists every primary source consulted, with publication dates for full provenance."),
    ("home-right-rail", "The right rail hosts the Briefing Agent — always visible context. It shows the three things that matter most this morning, with direct entity links. Below: quick action buttons, entity health badges, and recent analysis threads."),
    ("nav-surfaces", "Five surface tabs span the top bar — Home, Reports, Chat, Inbox, Me. Each surface is a distinct workspace with its own left rail, center pane, and right rail. One click switches context instantly with no page reload. The active tab glows terracotta."),
    ("home-search", "The left rail includes a real-time entity search bar. Type to instantly filter entities across all surfaces. The topbar adds a global search accessible from anywhere. Both use fuzzy matching with prefix scoring so partial queries still find results."),
    ("home-entity-popover", "Clicking any entity mention opens a rich popover card. Popovers stack — click a linked entity inside a popover and a second card floats above the first. Press Escape to close the topmost. Each popover shows status, sources, backlinks, and quick actions."),
    ("home-mention-tags", "At-mentions and hash-tag chips are first-class objects. Click an at-mention to expand entity details inline. Click a tag chip to see all entities sharing that tag in a floating popover. The backlinks section shows every place an entity is referenced — full bidirectional linking."),
    ("home-toast-scroll", "A toast notification system provides instant feedback — copied to clipboard, report refreshed, action completed. Toasts appear top-right and auto-dismiss. Scroll-spy tracks your position within the daily brief, highlighting the active section in the left rail as you scroll."),
    ("reports-overview", "The Reports surface is your research library. Eighty-seven reports across three hundred twelve sources. The gallery view shows mini report cards with entity names, status badges — verified, review, stale, draft — source counts, and connected entity graphs."),
    ("reports-left-rail", "The left rail organizes reports by universe, company, and monitoring category. AI Infrastructure contains Anthropic, OpenAI, Mistral, Bug Zero, and Google DeepMind. Briefs and monitoring entries track specific coverage threads."),
    ("reports-filter-tabs", "Filter tabs let you slice by status — All, Verified, Review, Stale, Drafting. View modes switch between Gallery, Board, Table, and Graph layouts. A sort dropdown and filter button provide additional controls."),
    ("reports-entity-agent", "Clicking an entity opens the Entity Agent panel on the right. For Anthropic: five of five claims verified, twelve sources, two hours since last refresh, ninety three dependencies tracked. The agent answers questions about claims, expiring evidence, and source health."),
    ("reports-card-detail", "Each report card is information-dense. The Anthropic card shows: enterprise tier repricing plus forty percent, minimal churn, managed agent tier at point one six eight per one K tokens. Tag badges, source links to Reuters and TechCrunch, connected entity graph, signal sparkline, and a Notebook Ready status badge."),
    ("reports-graph-view", "The Graph view transforms your report library into an interactive network topology. D3 force-directed layout shows entity relationships — node size reflects source count, edge thickness shows connection strength. Hover to highlight neighbors. Four topology modes: Force, Hierarchy, Radial, and TDA persistence diagrams."),
    ("reports-board-table", "Board view arranges reports as kanban columns by verification status — Verified, Review, Stale, Drafting. Drag cards between columns to update status. Table view provides a dense spreadsheet layout with sortable columns — entity, status, sources, last updated, and connected count. Four views serve four workflows."),
    ("reports-notebook", "Each report card opens into a rich notebook view. The editor supports inline editing with content-editable blocks, at-mention entity linking, and AI writing chips that generate analysis inline. Notebook Ready badges on cards indicate which reports have complete structured content."),
    ("chat-overview", "The Chat surface connects you to specialized agents. The Coverage Agent scans your entire portfolio — loading context for five entities, forty eight sources, and twelve claims. It identifies which reports need attention and shows its work step by step."),
    ("chat-thread-list", "The left rail shows active and archived threads. Active threads have real-time indicators — the AI Infrastructure Coverage thread shows three reports needing attention. Recent threads include deep dives, fundraise watch refreshes, and competitive analysis."),
    ("chat-changes-block", "Agent responses include structured changes blocks. Anthropic has three new signals — enterprise tier repricing, managed agent tier, new enterprise references. Tool badges show exactly which tools were used: entity diff, signal extract, web search. Every claim is traceable."),
    ("chat-right-rail", "The right rail provides session context — progress indicators, artifact links to generated files, agent roster showing Coverage, Research, Verify, and Extract workers, and source list tracking Convex, Web Search, MCP tools, Bloomberg, and PitchBook."),
    ("chat-action-buttons", "Action buttons let you open the notebook, verify claims, or export a memo — all one click from the agent's output. Live update banners show report updates and entity signal changes in real time, with direct links to open the full report."),
    ("chat-artifact-overlay", "When agents generate artifacts — memos, reports, charts — they render inline as preview cards. Click to expand into a full artifact overlay with close button. Artifacts are first-class objects: referenceable, shareable, and versioned. The artifact frame shows the generated content alongside the conversation that produced it."),
    ("chat-agent-memory", "The agent memory panel tracks accumulated observations across sessions. Each memory item is editable — correct a wrong inference and the agent learns. The trace panel shows the full execution path: which tools were called, what data was fetched, how claims were verified. Full transparency into agent reasoning."),
    ("inbox-overview", "The Inbox surface is your signal triage center. Fifty three items, four needing action. Three priority lanes: Must Clear, Prep, and Batch or Defer — with counts of four, seven, and forty two. Every signal is pre-classified so you start with what matters most."),
    ("inbox-item-detail", "Selecting an item expands a rich detail card. The Anthropic partnership terms item shows: what it is, what to do next, why it matters now — with signal match, evidence count, and calendar context. Action buttons: Open memo, Draft reply, Research, or Defer."),
    ("inbox-left-rail", "The left rail filters by lane — All Items, Act, Read, Waiting, Filed, Delete — and by source: Email, Slack, Docs, Alerts. Each source shows its item count, giving you full visibility into where signals are coming from."),
    ("inbox-right-rail", "The right rail shows deep context for the selected item. For the Anthropic partnership terms: the pricing model analysis, three scenarios to model before the board call — absorb cost, pass through to customer, renegotiate tier — with linked sources."),
    ("me-overview", "The Me surface is your identity and configuration hub. The USER dot M D file defines who you are to the system — your role, background, decision style, voice preferences, watchlist, and competitors. Every report, agent, and notification is shaped by this profile."),
    ("me-runtime", "The Runtime section shows how USER dot M D powers reports, chats, and agents. How NodeBench sees you: Founder with a banker lens. Five active rules govern behavior. Report shaping is evidence-first — hard numbers, source citations, and falsifiable claims over narrative."),
    ("me-integrations", "Integrations connect your workflow — HubSpot and Notion are connected, Linear, Slack, and Gmail are available. The plan section shows Founder tier at forty nine dollars per month, with eight paid calls used out of two hundred."),
    ("me-agent-memory", "The Agent Memory section tracks eight hundred forty seven observations and twenty three corrections — the system's accumulated understanding of your preferences, patterns, and working style. The Profile Agent in the right rail shows how your voice profile was learned."),
    ("wide-mode", "Wide mode, inspired by Streamlit, expands the center content area while keeping both rails visible. Grid layouts gain extra columns — What Changed shows four cards per row. Toggle with the W key or the toolbar button. Preference persists across sessions."),
    ("light-theme", "Full light theme support. Every color token adapts — backgrounds, text, borders, accent colors, and status badges all resolve through CSS custom properties. Toggle with the theme button in the top bar. No hardcoded colors."),
    ("command-palette", "Command K opens a global search palette — find reports, entities, and actions instantly. Fuzzy search with prefix scoring, keyboard navigation, and quick action execution. The universal entry point for power users."),
    ("keyboard-a11y", "Every interactive element is keyboard-accessible. Report cards have role button, tab index, and aria labels. Enter and Space activate cards. Icon-only buttons have descriptive labels. The entire prototype respects reduced motion preferences."),
    ("css-tokens", "One hundred seventy nine CSS custom properties power the design system. Semantic tokens for every color, spacing, and typography value. Dark and light themes switch instantly. No inline hex colors — eighty seven percent variable coverage across thirteen thousand lines of code."),
    ("evidence-checklist", "Every claim carries an evidence checklist popup. Click any verification badge to see the full breakdown — six boolean checks: government source, corroborated by two plus sources, hard numbers present, recent data, named analyst, and falsifiable claim. Grounded explanations score four of six or higher. Partial evidence shows exactly what is missing."),
    ("disambiguation", "When a search query matches multiple entities, a disambiguation dialog appears. Select the correct entity from a ranked list showing name, description, source count, and match confidence. The system learns from selections to improve future matching. No ambiguous links — every reference resolves to exactly one entity."),
    ("responsive-mobile", "The entire prototype is responsive down to three hundred ninety pixel mobile viewports. Rails collapse into a bottom navigation bar. Cards stack single-column. Touch targets meet the forty four pixel minimum. The conversational input and need-to-know feed are fully usable on phone — no horizontal overflow, no broken layouts."),
    ("focus-traps-dialogs", "Modal dialogs and the command palette use proper focus traps — Tab cycles within the dialog, Escape closes it, and focus returns to the element that triggered it. No keyboard user gets stuck. The command palette captures Cmd K globally and provides full keyboard navigation through results with arrow keys and Enter to select."),
    ("print-view", "A dedicated print stylesheet hides navigation, toolbars, and interactive controls. Report cards and daily brief content render with light backgrounds, dark text, and visible borders for readability on paper. Page breaks avoid splitting cards mid-content. The daily brief prints as a clean one-page summary."),
    ("outro", "NodeBench. Operating intelligence for agent-native businesses. Five surfaces, four view modes, eighty seven reports, three hundred twelve sources. Real-time verification, graph topology, entity disambiguation, bidirectional linking, and an agent memory that improves with every session. One hundred seventy nine design tokens. Full keyboard accessibility. Responsive to mobile. This is what founder-grade intelligence looks like."),
]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "public", "audio")

async def generate_edge_tts():
    """Generate TTS using edge-tts (Microsoft Edge, free, high quality)."""
    try:
        import edge_tts
    except ImportError:
        print("Installing edge-tts...")
        os.system(f"{sys.executable} -m pip install edge-tts")
        import edge_tts

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Professional male voice — good for product demos
    VOICE = "en-US-GuyNeural"

    for scene_id, text in SCENES:
        outpath = os.path.join(OUTPUT_DIR, f"{scene_id}.wav")
        if os.path.exists(outpath):
            print(f"  [skip] {scene_id}.wav (exists)")
            continue

        print(f"  [gen] {scene_id}.wav ...")
        # Generate MP3 first, then convert concept
        mp3_path = outpath.replace(".wav", ".mp3")
        communicate = edge_tts.Communicate(text, VOICE, rate="+5%")
        await communicate.save(mp3_path)

        # edge-tts outputs mp3; Remotion can use mp3 directly
        # Rename to .mp3 for the final output
        final_path = os.path.join(OUTPUT_DIR, f"{scene_id}.mp3")
        if mp3_path != final_path:
            os.rename(mp3_path, final_path)
        print(f"  [ok] {scene_id}.mp3")

    print(f"\n[done] Generated {len(SCENES)} audio files in {OUTPUT_DIR}")


async def main():
    print("NodeBench Demo Video — TTS Generation")
    print(f"Scenes: {len(SCENES)}")
    print(f"Output: {OUTPUT_DIR}\n")

    # Use edge-tts (reliable cross-platform TTS)
    # Supertonic 3 can be wired later for local ONNX inference
    print("Using edge-tts (Microsoft Edge Neural TTS)\n")
    await generate_edge_tts()


if __name__ == "__main__":
    asyncio.run(main())
