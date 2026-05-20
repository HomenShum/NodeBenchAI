/**
 * NodeBench Demo Video v2 — Condensed Storyboard
 *
 * 15 scenes, ~96 seconds (1:36). Tiered: intro, hero, supporting, montage, outro.
 * Gemini judge: 93/100 (Grade S) at round 5. Narration uses problem-solution framing.
 * Adds cursor animations, zoom-to-element, montage rapid cuts, streaming text, wipe transitions.
 *
 * Screenshot coordinate reference:
 *   home-dark:     left rail 0-8%, center 16-68%, right rail 80-100%, top bar 0-3.5%
 *   home-scrolled: What Changed x=25% y=20%, WHY NOW x=25% y=56%, Actions x=25% y=78%
 *   reports-dark:  entity tree 0-10%, cards x=15% y=13%, entity agent x=80%
 *   chat-dark:     threads 0-10%, chat content x=27%, session rail x=80%
 *   inbox-dark:    filters 0-10%, priority lanes x=25% y=10%, context x=80%
 *   me-dark:       sidebar 0-10%, USER.md x=23% y=6%, profile agent x=80%
 */

export const FPS = 30;

// ─── Type Definitions ───────────────────────────────────────

export interface HighlightRegion {
  x: number;       // % from left
  y: number;       // % from top
  w: number;       // % width
  h: number;       // % height
  label: string;
  delay: number;   // frames before appearing
}

/** Montage: rapid sequential screenshots within one scene */
export interface MontageItem {
  screenshot: string;
  label: string;
  durationFraction: number; // 0–1, portion of parent scene time
}

/** Camera zoom into a screenshot region */
export interface ZoomRegion {
  x: number;         // transform-origin X (%)
  y: number;         // transform-origin Y (%)
  scale: number;     // target scale (1.5–2.5 typical)
  startFrame: number;
  holdFrames?: number; // how long to stay zoomed (default: rest of scene)
}

/** Animated cursor that follows a path */
export interface CursorKeyframe {
  x: number;    // % from left
  y: number;    // % from top
  frame: number;
  click?: boolean; // show click ripple at this keyframe
}

/** Character-by-character text reveal */
export interface StreamingTextConfig {
  text: string;
  x: number;      // position %
  y: number;       // position %
  w: number;       // text box width %
  startFrame: number;
  charsPerFrame: number;
  style: "chat" | "code" | "label";
}

/** Horizontal wipe revealing a second screenshot */
export interface WipeConfig {
  afterScreenshot: string;
  startFrame: number;
  durationFrames: number;
  direction: "left" | "right";
}

export type SceneTier = "intro" | "hero" | "supporting" | "montage" | "outro";

export interface Scene {
  id: string;
  title: string;
  screenshot: string;
  narration: string;
  durationSec: number;
  highlights: HighlightRegion[];
  caption: string;
  transition: "fade" | "slide" | "zoom" | "none";
  tier: SceneTier;
  // v2 interaction features (all optional)
  montageItems?: MontageItem[];
  zoomTo?: ZoomRegion;
  cursorPath?: CursorKeyframe[];
  streamingText?: StreamingTextConfig;
  wipe?: WipeConfig;
}

// ─── Scenes ─────────────────────────────────────────────────

export const scenes: Scene[] = [

  // ═══════════════════════════════════════════════════════════
  // 1. INTRO — RAPID-FIRE COLD OPEN (5s)
  // Hook pattern: rapid montage of the 4 best UI moments (0.6s each),
  // then hold on the full home dashboard for the brand reveal.
  // Arc Browser / Apple pattern: show the product, THEN say the name.
  // ═══════════════════════════════════════════════════════════
  {
    id: "intro",
    title: "NodeBench",
    screenshot: "home-dark.jpg", // final frame + fallback
    narration:
      "Every morning, founders face the same question: what changed while I slept? NodeBench answers it. Operating intelligence, before you ask.",
    durationSec: 5,
    highlights: [],
    caption: "Operating Intelligence for Founders",
    transition: "fade",
    tier: "intro",
    // Rapid montage: 4 product shots flash by with labels, then settle for brand reveal
    montageItems: [
      { screenshot: "chat-dark.jpg", label: "Agent Intelligence", durationFraction: 0.14 },
      { screenshot: "reports-graph.jpg", label: "Entity Graph", durationFraction: 0.14 },
      { screenshot: "inbox-dark.jpg", label: "Signal Triage", durationFraction: 0.14 },
      { screenshot: "home-scrolled.jpg", label: "What Changed", durationFraction: 0.14 },
      { screenshot: "home-dark.jpg", label: "NodeBench", durationFraction: 0.44 },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 2. DAILY BRIEF — HERO (7s) [tightened from 8s — pacing fix]
  // ═══════════════════════════════════════════════════════════
  {
    id: "daily-brief",
    title: "Home — Your Morning Brief",
    screenshot: "home-dark.jpg",
    narration:
      "Your morning starts here. No tabs to check. No feeds to scroll. Entity cards show live status with verification badges. The Need-to-Know feed surfaces verified signals with evidence and your personal exposure context.",
    durationSec: 7,
    highlights: [
      { x: 16, y: 5, w: 52, h: 14, label: "Entity status cards", delay: 15 },
      { x: 16, y: 43, w: 52, h: 25, label: "Need to Know signals", delay: 90 },
    ],
    caption: "Live entity cards + verified intelligence feed",
    transition: "fade",
    tier: "hero",
    zoomTo: {
      x: 38,
      y: 42,
      scale: 1.35,
      startFrame: 80,
    },
    cursorPath: [
      { x: 42, y: 10, frame: 20 },
      { x: 42, y: 25, frame: 60 },
      { x: 35, y: 48, frame: 100 },
      { x: 40, y: 55, frame: 140, click: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 3. EVIDENCE DEEP DIVE — HERO (6s) [tightened from 7s]
  // ═══════════════════════════════════════════════════════════
  {
    id: "evidence-zoom",
    title: "Home — Evidence Verification",
    screenshot: "home-dark.jpg",
    narration:
      "Click any verification badge for the full evidence breakdown. Six boolean checks per claim: government source, corroborated, hard numbers, recent data, named analyst, falsifiable.",
    durationSec: 6,
    highlights: [
      { x: 57, y: 44, w: 10, h: 3, label: "Verified badge", delay: 10 },
      { x: 35, y: 48, w: 25, h: 12, label: "6-point evidence checklist", delay: 60 },
    ],
    caption: "Boolean evidence checklist per claim",
    transition: "none",
    tier: "hero",
    zoomTo: {
      x: 55,
      y: 48,
      scale: 2.0,
      startFrame: 40,
    },
    cursorPath: [
      { x: 60, y: 44, frame: 10 },
      { x: 62, y: 45, frame: 35, click: true },
      { x: 48, y: 52, frame: 80 },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 4. INTELLIGENCE FEED — HERO (6s) [tightened from 7s]
  // ═══════════════════════════════════════════════════════════
  {
    id: "intelligence-feed",
    title: "Home — What Changed & WHY NOW",
    screenshot: "home-scrolled.jpg",
    narration:
      "What Changed cards show magnitude and citations. WHY NOW scores competing narratives with evidence checks. Five of six confidence versus three of six. Decision triggers with dates.",
    durationSec: 6,
    highlights: [
      { x: 25, y: 20, w: 48, h: 30, label: "What Changed grid", delay: 10 },
      { x: 25, y: 56, w: 48, h: 6, label: "WHY NOW evidence chips", delay: 80 },
    ],
    caption: "Entity changes + evidence-scored narratives",
    transition: "slide",
    tier: "hero",
    zoomTo: {
      x: 45,
      y: 35,
      scale: 1.3,
      startFrame: 60,
    },
    cursorPath: [
      { x: 35, y: 25, frame: 15 },
      { x: 40, y: 30, frame: 50, click: true },
      { x: 35, y: 58, frame: 90 },
      { x: 55, y: 58, frame: 130 },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 5. CHAT AGENT STREAMING — HERO MOMENT (8s)
  // This is the emotional crescendo — the "wow" feature.
  // Dramatic zoom into streaming text, cursor clicks tool badges.
  // ═══════════════════════════════════════════════════════════
  {
    id: "chat-streaming",
    title: "Chat — Agent Streaming",
    screenshot: "chat-dark.jpg",
    narration:
      "This is the moment. The Coverage Agent streams analysis in real time. Tool badges trace every step. Entity diff. Signal extract. Web search. You see exactly what the agent found and how it found it.",
    durationSec: 8,
    highlights: [
      { x: 27, y: 35, w: 42, h: 25, label: "Agent analysis stream", delay: 10 },
      { x: 27, y: 53, w: 25, h: 2, label: "Tool badges", delay: 100 },
    ],
    caption: "Real-time agent analysis with tool provenance",
    transition: "slide",
    tier: "hero",
    // Hero moment: dramatic zoom INTO the streaming text — the wow reveal
    zoomTo: {
      x: 42,
      y: 46,
      scale: 1.8,
      startFrame: 15,
      holdFrames: 160, // Hold close-up through the full streaming reveal
    },
    streamingText: {
      text: "Anthropic: 3 new signals detected. Enterprise tier repricing +40%. Managed agent tier at $0.168/1K tokens. 2 new enterprise references from Reuters, TechCrunch.",
      x: 30,
      y: 42,
      w: 38,
      startFrame: 30,
      charsPerFrame: 1.8,
      style: "chat",
    },
    cursorPath: [
      { x: 35, y: 40, frame: 15 },
      { x: 38, y: 48, frame: 80 },
      { x: 32, y: 54, frame: 120, click: true }, // Click a tool badge
      { x: 45, y: 54, frame: 160 },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 6. GRAPH TOPOLOGY — HERO (6s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "graph-topology",
    title: "Reports — Graph View",
    screenshot: "reports-graph.jpg",
    narration:
      "Your report library as an interactive graph. Force-directed layout. Node size reflects source count, edge thickness shows connection strength. Four topology modes.",
    durationSec: 6,
    highlights: [
      { x: 10, y: 13, w: 70, h: 55, label: "D3 force-directed entity graph", delay: 10 },
    ],
    caption: "Interactive entity graph with 4 topology modes",
    transition: "slide",
    tier: "hero",
    zoomTo: {
      x: 40,
      y: 40,
      scale: 1.6,
      startFrame: 45,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 7. REPORTS GALLERY — SUPPORTING (5s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "reports-gallery",
    title: "Reports — Gallery & Entity Agent",
    screenshot: "reports-dark.jpg",
    narration:
      "Eighty-seven reports, three hundred twelve sources. Gallery cards with status badges. The Entity Agent verifies claims in real time.",
    durationSec: 5,
    highlights: [
      { x: 15, y: 13, w: 65, h: 40, label: "Report card gallery", delay: 10 },
      { x: 80, y: 4, w: 20, h: 50, label: "Entity Agent panel", delay: 50 },
    ],
    caption: "Report gallery + entity intelligence agent",
    transition: "slide",
    tier: "supporting",
    zoomTo: {
      x: 30,
      y: 25,
      scale: 1.4,
      startFrame: 60,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 8. INBOX TRIAGE — SUPPORTING (5s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "inbox-triage",
    title: "Inbox — Signal Triage",
    screenshot: "inbox-dark.jpg",
    narration:
      "Signal triage in three priority lanes. Must Clear, Prep, and Batch. Every signal pre-classified for action.",
    durationSec: 5,
    highlights: [
      { x: 25, y: 10, w: 42, h: 10, label: "Priority lanes", delay: 10 },
      { x: 25, y: 22, w: 42, h: 20, label: "Detail card with actions", delay: 50 },
    ],
    caption: "Pre-classified signal triage with priority routing",
    transition: "slide",
    tier: "supporting",
    cursorPath: [
      { x: 35, y: 14, frame: 10 },
      { x: 35, y: 14, frame: 30, click: true },
      { x: 40, y: 30, frame: 60 },
      { x: 50, y: 38, frame: 100, click: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 9. ME / IDENTITY — SUPPORTING (5s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "me-identity",
    title: "Me — Your Identity File",
    screenshot: "me-dark.jpg",
    narration:
      "USER dot M-D defines who you are. Decision style, voice, watchlist, competitors. Every agent and report adapts to you.",
    durationSec: 5,
    highlights: [
      { x: 23, y: 6, w: 50, h: 55, label: "USER.md identity file", delay: 10 },
    ],
    caption: "Identity-driven intelligence configuration",
    transition: "slide",
    tier: "supporting",
    zoomTo: {
      x: 40,
      y: 30,
      scale: 1.5,
      startFrame: 40,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 10. ENTITY INTERACTIONS — SUPPORTING (5s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "entity-interactions",
    title: "Home — Entity Popovers & Links",
    screenshot: "home-dark.jpg",
    narration:
      "Click any entity for a rich popover. They stack. At-mentions, tags, and backlinks. Full bidirectional entity graph.",
    durationSec: 5,
    highlights: [
      { x: 17, y: 44, w: 12, h: 3, label: "@mention", delay: 10 },
      { x: 25, y: 20, w: 30, h: 25, label: "Stacking popovers", delay: 50 },
    ],
    caption: "Bidirectional entity linking with stacking popovers",
    transition: "none",
    tier: "supporting",
    cursorPath: [
      { x: 22, y: 46, frame: 10 },
      { x: 22, y: 46, frame: 25, click: true },
      { x: 35, y: 30, frame: 60 },
      { x: 38, y: 28, frame: 80, click: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 11. COMMAND CENTER — SUPPORTING (4s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "command-center",
    title: "Home — Briefing Agent & Cmd+K",
    screenshot: "home-dark.jpg",
    narration:
      "Briefing agent in the right rail. Action cards for triage. Command K for instant search across everything.",
    durationSec: 4,
    highlights: [
      { x: 80, y: 4, w: 20, h: 30, label: "Briefing Agent", delay: 10 },
      { x: 77, y: 0.5, w: 15, h: 2.5, label: "Cmd+K palette", delay: 45 },
    ],
    caption: "Always-on briefing agent + global command palette",
    transition: "none",
    tier: "supporting",
    cursorPath: [
      { x: 88, y: 15, frame: 10 },
      { x: 84, y: 1.5, frame: 50 },
      { x: 84, y: 1.5, frame: 65, click: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 12. MONTAGE: 5 SURFACES (10s) [was 8s — slowed for readability]
  // ═══════════════════════════════════════════════════════════
  {
    id: "montage-surfaces",
    title: "Five Surfaces",
    screenshot: "home-dark.jpg", // fallback
    narration:
      "Five surfaces. Home. Reports. Chat. Inbox. Me. One click, zero page reload. Each with its own left rail, center pane, and right rail.",
    durationSec: 10,
    highlights: [],
    caption: "5 surfaces, zero page reloads",
    transition: "slide",
    tier: "montage",
    montageItems: [
      { screenshot: "home-dark.jpg", label: "Home", durationFraction: 0.2 },
      { screenshot: "reports-dark.jpg", label: "Reports", durationFraction: 0.2 },
      { screenshot: "chat-dark.jpg", label: "Chat", durationFraction: 0.2 },
      { screenshot: "inbox-dark.jpg", label: "Inbox", durationFraction: 0.2 },
      { screenshot: "me-dark.jpg", label: "Me", durationFraction: 0.2 },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 13. MONTAGE: 4 VIEW MODES (9s) [was 8s — slowed for readability]
  // ═══════════════════════════════════════════════════════════
  {
    id: "montage-views",
    title: "Four View Modes",
    screenshot: "reports-dark.jpg", // fallback
    narration:
      "Four view modes. Gallery for browsing. Board for triage. Table for data. Graph for connections. Each serves a different workflow.",
    durationSec: 9,
    highlights: [],
    caption: "Gallery, Board, Table, Graph — 4 workflows",
    transition: "none",
    tier: "montage",
    montageItems: [
      { screenshot: "reports-dark.jpg", label: "Gallery", durationFraction: 0.25 },
      { screenshot: "reports-board.jpg", label: "Board", durationFraction: 0.25 },
      { screenshot: "reports-table.jpg", label: "Table", durationFraction: 0.25 },
      { screenshot: "reports-graph.jpg", label: "Graph", durationFraction: 0.25 },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 14. MONTAGE: DESIGN SYSTEM (10s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "montage-design",
    title: "Design System",
    screenshot: "home-dark.jpg", // base for wipe
    narration:
      "Full dark and light themes via one hundred seventy-nine CSS tokens. Wide mode for density. Mobile responsive at three ninety pixels. Keyboard accessible. Print optimized. No hardcoded colors.",
    durationSec: 10,
    highlights: [],
    caption: "179 CSS tokens, dark/light, wide, mobile, a11y",
    transition: "fade",
    tier: "montage",
    montageItems: [
      { screenshot: "home-dark.jpg", label: "Dark Theme", durationFraction: 0.2 },
      { screenshot: "home-light.jpg", label: "Light Theme", durationFraction: 0.2 },
      { screenshot: "home-wide.jpg", label: "Wide Mode", durationFraction: 0.2 },
      { screenshot: "home-mobile.jpg", label: "Mobile", durationFraction: 0.2 },
      { screenshot: "reports-dark.jpg", label: "Accessible", durationFraction: 0.2 },
    ],
    wipe: {
      afterScreenshot: "home-light.jpg",
      startFrame: 30,
      durationFrames: 45,
      direction: "left",
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 15. OUTRO (5s)
  // ═══════════════════════════════════════════════════════════
  {
    id: "outro",
    title: "NodeBench",
    screenshot: "home-dark.jpg",
    narration:
      "NodeBench. Five surfaces. Four views. Eighty-seven reports. Three hundred twelve sources. This is what operating intelligence looks like. Try it at nodebenchai.com.",
    durationSec: 5,
    highlights: [],
    caption: "nodebenchai.com",
    transition: "fade",
    tier: "outro",
  },
];

// ─── Computed values ────────────────────────────────────────

export const totalDurationSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);
export const totalFrames = totalDurationSec * FPS;

export function getSceneFrameOffsets(): {
  id: string;
  from: number;
  durationFrames: number;
}[] {
  let offset = 0;
  return scenes.map((s) => {
    const entry = {
      id: s.id,
      from: offset,
      durationFrames: s.durationSec * FPS,
    };
    offset += s.durationSec * FPS;
    return entry;
  });
}
