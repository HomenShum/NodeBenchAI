/**
 * ChangelogPage — Release history with timeline dots and glass cards.
 */

import { memo, useCallback } from "react";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";

interface Release {
  version: string;
  date: string;
  title: string;
  bullets: string[];
}

const RELEASES: Release[] = [
  {
    version: "v2.35.0",
    date: "March 21, 2026",
    title: "Security Hardening & Production Polish",
    bullets: [
      "Security audit: 12 fixes — CSP headers, HTML sanitizer rewrite, error message redaction, CORS lockdown, tool name validation, Mermaid XSS prevention",
      "Privacy audit: removed PII from error reporting (userAgent, full URLs), gated debug logs behind DEV mode, generic production error messages",
      "ElevenLabs voice output integration with browser SpeechSynthesis fallback",
      "Context ingestion wizard at /connect — 3-step guided setup for repos, docs, URLs, and MCP",
      "Entity tracking view at /tracking — persistent company/product/founder monitoring with sparklines",
      "Pricing page updated to 4-tier model (Free/Pro/Team/Enterprise) with comparison table",
      "6 workflow presets on landing: Investor Diligence, CEO Strategy, GTM Planning, Product Launch, Creator Growth, Competitive Analysis",
    ],
  },
  {
    version: "v2.34.0",
    date: "March 20, 2026",
    title: "Usability Sprint & Viral Adoption",
    bullets: [
      "Run Live Demo now opens agent panel with pre-scripted thinking animation and investigation results",
      "8 demo conversations covering trajectory scoring, judgment gates, MCP tools, denied actions, FTX investigation, permissions, agent activity, and Series A decision simulation",
      "Visible learning indicators: landing page metrics, agent panel badge, System sparkline",
      "Shareable URLs with one-click copy on Decision Memo, Forecast Review, and Research Hub",
      "Mobile-first agent panel: full-screen overlay, bottom-to-top animation, iPhone safe area insets",
      "Daily rotating research signals (25 AI industry signals, deterministic date-seeded)",
      "p50/p99 latency tracking in MCP Gateway health endpoint with color-coded right-rail badge",
      "3-phase streaming text reveal (burst → reading speed → instant dump) for demo conversations",
      "Voice input CTA on landing page with dynamic right-rail listening indicator and 12 voice command aliases",
      "CLI one-liner: npx nodebench-mcp demo returns instant results in under 3 seconds",
    ],
  },
  {
    version: "v2.33.0",
    date: "March 19, 2026",
    title: "Design Unification & Performance",
    bullets: [
      "Unified glass card DNA across all 5 surfaces — border-white/[0.06] bg-white/[0.02] with warm terracotta #d97757 accent",
      "SurfacePrimitives component library: SurfaceCard, SurfaceSection, SurfaceBadge, SurfaceStat, SurfaceGrid, SurfacePageHeader",
      "Brand consolidation: NodeBench is the product, DeepTrace is the investigation feature",
      "Jargon sweep: 22 developer terms replaced across 17 files (spans→actions, dogfood→quality review, telemetry→activity, cockpit→workspace)",
      "Bundle optimization: route-agents chunk 920KB→71KB (-92%), editor-vendor -279KB, 14 components lazy-loaded",
      "WCAG AA contrast fix: --text-muted bumped from #76736c (3.2:1) to #908d85 (4.6:1), 60+ sub-AA opacity modifiers removed",
      "DocumentsHomeHub decomposed from 8066 to 309 lines (96% reduction) across 4 extracted components",
      "Calendar performance: hoverSlot converted to useRef+DOM, 7 event filter chains memoized, loading skeleton added",
      "Dead neon component re-exports removed from bundle (CursorGlow, GridOverlay, ScanLine, HUDPanel)",
      "Indigo accent swept: 59→14 references (45 replaced with var(--accent-primary) across 18 files)",
      "9 'Coming Soon' placeholders replaced with actionable text, 6 icon buttons given aria-labels",
      "FastAgentPanel decomposed from 4372 to 3518 lines — extracted MinimizedStrip, PanelHeader, PanelOverlays, PanelDialogs",
    ],
  },
  {
    version: "v2.32.0",
    date: "March 18, 2026",
    title: "WebSocket MCP Gateway & Deep Sim",
    bullets: [
      "WebSocket MCP Gateway (server/mcpGateway.ts) with API key auth, rate limiting (100/min, 10k/day), and idle timeout",
      "MCP Client SDK (packages/mcp-client/) — zero-dep TypeScript client with auto-reconnect and typed tool calls",
      "API Key Management page at /api-keys with create, revoke, copy, and usage dashboard",
      "7 Deep Sim MCP tools: build_claim_graph, extract_variables, generate_countermodels, run_deep_sim, rank_interventions, score_compounding, render_decision_memo",
      "Decision Workbench at /deep-sim with 3 fixtures (Acme AI Series A, Founder Strategy, Market Entry Analysis)",
      "Forecast Review at /postmortem with 6-dimension scoring (variable recall, scenario usefulness, intervention quality, decision clarity, outcome alignment, calibration)",
      "Agent Telemetry Dashboard at /agent-telemetry with sortable tool breakdown, cost sparkline, and error log",
      "ActionSpan unified type (convex/shared/actionSpan.ts) — 15-field canonical span with trajectory and mission converters",
      "ActionSpan replay engine (convex/shared/actionSpanReplay.ts) — dry-replay, batch replay, verdict comparison",
      "Autoresearch optimizer runner (scripts/eval-harness/deeptrace/runAutoresearch.ts) with throughput scoring and hard guards",
      "Recursive architecture documented (docs/architecture/RECURSIVE_ARCHITECTURE.md)",
    ],
  },
  {
    version: "v2.31.0",
    date: "March 7, 2026",
    title: "Cockpit Consolidation",
    bullets: [
      "Consolidated 45 routes into 5 cockpit surfaces (Ask, Memo, Research, Workspace, System)",
      "WorkspaceRail: 220px left rail with 5 surface shortcuts, collapsible to 48px",
      "ActiveSurfaceHost: bounded cache (max 4 surfaces), scroll position persistence",
      "AgentPresenceRail: right rail with agent status, active plan, runtime metrics",
      "TraceStrip: bottom rail with live event feed, expandable log",
      "Surface-aware command palette with Cmd+K navigation",
      "3-step onboarding wizard for first-time users",
      "Keyboard shortcuts overlay (press ? to view)",
      "404 page with branded glass card design",
      "Branded favicon and OG image for social sharing",
    ],
  },
  {
    version: "v2.30.0",
    date: "February 24, 2026",
    title: "Trajectory Intelligence",
    bullets: [
      "11 schema tables for trajectory domain (spans, verdicts, feedback, interventions, trust graph, benchmarks)",
      "8-dimension trajectory scoring with compounding/improving/flat/drifting labels",
      "ActionSpan unified type replacing 4 legacy span formats",
      "Trust graph with TrustNodes (person/institution/channel/platform) and TrustEdges with leverage scores",
      "Trajectory sparkline component for inline trend display",
    ],
  },
  {
    version: "v2.29.0",
    date: "February 10, 2026",
    title: "Judgment Layer & Self-Evolution",
    bullets: [
      "Pre-execution gate with 5 required gates and 6 disqualifiers (boolean, not scored)",
      "Self-evolution loop: daily health check with 10 boolean metrics, max 3 conservative proposals",
      "Decision memory with SHA-256 fingerprinting and 3-layer architecture (ephemeral/7-day/persistent)",
      "Swarm deliberation with 6 agency roles, convergence detection, and early termination",
      "Consistency index for cross-agent decision coherence tracking",
      "Evolution verification gate with thrashing detection and historical replay simulation",
    ],
  },
  {
    version: "v2.28.0",
    date: "January 28, 2026",
    title: "350 MCP Tools",
    bullets: [
      "350 MCP tools across 55 domains with progressive discovery and lazy-loading",
      "Hybrid search with 14 strategies and 8 search modes",
      "Agent-as-a-graph embeddings with weighted RRF fusion",
      "Persona presets: starter (15), founder, banker, operator, researcher, full (350)",
      "CLI subcommands: discover, setup, workflow, quickref, call, demo",
    ],
  },
];

export const ChangelogPage = memo(function ChangelogPage() {
  const { ref: revealRef, isVisible, instant } = useRevealOnMount();

  const stagger = useCallback(
    (delay: string): React.CSSProperties => ({
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? "none" : "translateY(8px)",
      transition: instant ? "none" : "opacity 0.3s ease-out, transform 0.3s ease-out",
      transitionDelay: instant ? "0s" : delay,
    }),
    [isVisible, instant],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div ref={revealRef} className="mx-auto max-w-3xl px-6 py-16">
        {/* Header */}
        <div style={stagger("0s")} className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-content">Changelog</h1>
          <p className="mt-3 text-base text-content-secondary">
            What shipped, when it shipped, and why it matters.
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-white/[0.08]" aria-hidden="true" />

          <div className="space-y-8">
            {RELEASES.map((release, i) => (
              <div
                key={release.version}
                style={stagger(`${0.1 + i * 0.08}s`)}
                className="relative pl-10"
              >
                {/* Timeline dot */}
                <div
                  className={`absolute left-0 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border ${
                    i === 0
                      ? "border-[#d97757]/40 bg-[#d97757]/20"
                      : "border-white/[0.12] bg-white/[0.04]"
                  }`}
                  aria-hidden="true"
                >
                  <div
                    className={`h-2 w-2 rounded-full ${
                      i === 0 ? "bg-[#d97757]" : "bg-white/30"
                    }`}
                  />
                </div>

                {/* Release card */}
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs font-mono font-semibold text-content">
                      {release.version}
                    </span>
                    <span className="text-[13px] font-medium text-content">{release.title}</span>
                    <span className="text-[11px] text-content-muted">{release.date}</span>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {release.bullets.map((bullet, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-content-secondary">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-content-muted" aria-hidden="true" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ChangelogPage;
