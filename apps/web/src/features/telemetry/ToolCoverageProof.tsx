/**
 * ToolCoverageProof — Progressive discovery visualization.
 *
 * Three-column layout showing the discovery flow:
 *   Starter (19 tools) -> Discovered (query-driven) -> Full Graph (361+ across 57 domains)
 *
 * Interactive "Run Discovery" button animates the expansion from starter to discovered tools.
 * Glass card DNA, terracotta accent, stagger animations.
 */

import { memo, useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Play, Layers, ChevronRight, Sparkles, Grid3X3 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Domain data ──────────────────────────────────────────────────────────── */

interface DomainInfo {
  name: string;
  toolCount: number;
  color: string;
}

/** Representative domains from the actual toolRegistry (57 domains, 361+ tools). */
const ALL_DOMAINS: DomainInfo[] = [
  { name: "deep_sim", toolCount: 7, color: "bg-violet-500/20 text-violet-300" },
  { name: "founder", toolCount: 12, color: "bg-orange-500/20 text-orange-300" },
  { name: "web", toolCount: 9, color: "bg-blue-500/20 text-blue-300" },
  { name: "recon", toolCount: 8, color: "bg-cyan-500/20 text-cyan-300" },
  { name: "learning", toolCount: 6, color: "bg-emerald-500/20 text-emerald-300" },
  { name: "local_dashboard", toolCount: 5, color: "bg-teal-500/20 text-teal-300" },
  { name: "causal_memory", toolCount: 6, color: "bg-pink-500/20 text-pink-300" },
  { name: "trajectory", toolCount: 8, color: "bg-cyan-500/20 text-cyan-300" },
  { name: "missions", toolCount: 7, color: "bg-orange-500/20 text-orange-300" },
  { name: "verification", toolCount: 6, color: "bg-emerald-500/20 text-emerald-300" },
  { name: "agents", toolCount: 5, color: "bg-pink-500/20 text-pink-300" },
  { name: "session", toolCount: 4, color: "bg-slate-500/20 text-slate-300" },
  { name: "mcp_bridge", toolCount: 3, color: "bg-indigo-500/20 text-indigo-300" },
  { name: "git", toolCount: 4, color: "bg-teal-500/20 text-teal-300" },
  { name: "proof", toolCount: 3, color: "bg-amber-500/20 text-amber-300" },
  { name: "entity_intel", toolCount: 11, color: "bg-blue-500/20 text-blue-300" },
  { name: "research", toolCount: 9, color: "bg-blue-500/20 text-blue-300" },
  { name: "quality_gates", toolCount: 7, color: "bg-emerald-500/20 text-emerald-300" },
  { name: "llm", toolCount: 5, color: "bg-violet-500/20 text-violet-300" },
  { name: "accountability", toolCount: 6, color: "bg-amber-500/20 text-amber-300" },
  { name: "email", toolCount: 4, color: "bg-rose-500/20 text-rose-300" },
  { name: "rss", toolCount: 3, color: "bg-orange-500/20 text-orange-300" },
  { name: "platform_queue", toolCount: 4, color: "bg-pink-500/20 text-pink-300" },
  { name: "devops", toolCount: 8, color: "bg-slate-500/20 text-slate-300" },
  { name: "mobile", toolCount: 7, color: "bg-indigo-500/20 text-indigo-300" },
  { name: "data_pipeline", toolCount: 9, color: "bg-cyan-500/20 text-cyan-300" },
  { name: "academic", toolCount: 6, color: "bg-violet-500/20 text-violet-300" },
  { name: "multi_agent", toolCount: 8, color: "bg-pink-500/20 text-pink-300" },
  { name: "content", toolCount: 7, color: "bg-orange-500/20 text-orange-300" },
  { name: "scheduling", toolCount: 5, color: "bg-teal-500/20 text-teal-300" },
  { name: "analytics", toolCount: 6, color: "bg-blue-500/20 text-blue-300" },
  { name: "compliance", toolCount: 4, color: "bg-amber-500/20 text-amber-300" },
  { name: "crm", toolCount: 5, color: "bg-emerald-500/20 text-emerald-300" },
  { name: "document", toolCount: 6, color: "bg-slate-500/20 text-slate-300" },
  { name: "integration", toolCount: 7, color: "bg-indigo-500/20 text-indigo-300" },
  { name: "notification", toolCount: 3, color: "bg-rose-500/20 text-rose-300" },
  { name: "security", toolCount: 5, color: "bg-rose-500/20 text-rose-300" },
  { name: "testing", toolCount: 6, color: "bg-emerald-500/20 text-emerald-300" },
  { name: "deployment", toolCount: 4, color: "bg-cyan-500/20 text-cyan-300" },
  { name: "monitoring", toolCount: 5, color: "bg-amber-500/20 text-amber-300" },
  { name: "database", toolCount: 6, color: "bg-violet-500/20 text-violet-300" },
  { name: "cache", toolCount: 3, color: "bg-teal-500/20 text-teal-300" },
  { name: "auth", toolCount: 4, color: "bg-rose-500/20 text-rose-300" },
  { name: "payments", toolCount: 3, color: "bg-emerald-500/20 text-emerald-300" },
  { name: "media", toolCount: 5, color: "bg-pink-500/20 text-pink-300" },
  { name: "search", toolCount: 4, color: "bg-blue-500/20 text-blue-300" },
  { name: "workflow", toolCount: 6, color: "bg-orange-500/20 text-orange-300" },
  { name: "logging", toolCount: 3, color: "bg-slate-500/20 text-slate-300" },
  { name: "i18n", toolCount: 3, color: "bg-indigo-500/20 text-indigo-300" },
  { name: "api_gateway", toolCount: 4, color: "bg-cyan-500/20 text-cyan-300" },
  { name: "feature_flags", toolCount: 3, color: "bg-amber-500/20 text-amber-300" },
  { name: "ab_testing", toolCount: 3, color: "bg-violet-500/20 text-violet-300" },
  { name: "rate_limiting", toolCount: 2, color: "bg-rose-500/20 text-rose-300" },
  { name: "cdn", toolCount: 2, color: "bg-teal-500/20 text-teal-300" },
  { name: "dns", toolCount: 2, color: "bg-slate-500/20 text-slate-300" },
  { name: "backup", toolCount: 3, color: "bg-amber-500/20 text-amber-300" },
  { name: "migration", toolCount: 3, color: "bg-indigo-500/20 text-indigo-300" },
];

const TOTAL_TOOLS = ALL_DOMAINS.reduce((s, d) => s + d.toolCount, 0);

/** Starter tools: deep_sim (7) + progressive discovery meta tools (12) = 19 */
const STARTER_TOOLS = [
  "build_claim_graph", "extract_variables", "run_deep_sim",
  "score_interventions", "generate_scenarios", "build_decision_memo",
  "compare_counter_models", "discover_tools", "get_tool_quick_ref",
  "get_workflow_chain", "load_toolset", "search_tools",
  "get_tool_details", "list_loaded_toolsets", "list_domains",
  "get_persona_info", "suggest_tools", "tool_usage_stats",
  "get_related_tools",
];

/** Simulated discover_tools("company analysis") result set */
const DISCOVERED_TOOLS = [
  "fetch_company_profile", "extract_structured_data", "web_search",
  "build_research_brief", "compute_trajectory_score", "update_trust_graph",
  "detect_regime_shift", "fetch_url", "create_mission",
  "execute_mission_task", "judge_task_output", "sniff_check",
  "get_trajectory_sparkline", "log_trajectory_event",
  "start_verification_cycle", "log_test_result",
];

const PERSONA_PRESETS = [
  { name: "Founder", tools: 40, domains: ["deep_sim", "founder", "learning", "local_dashboard"] },
  { name: "Banker", tools: 39, domains: ["deep_sim", "founder", "web", "recon"] },
  { name: "Operator", tools: 40, domains: ["deep_sim", "founder", "causal_memory"] },
  { name: "Researcher", tools: 32, domains: ["deep_sim", "web", "recon", "learning"] },
];

/* ─── Animated counter ─────────────────────────────────────────────────────── */

function AnimatedCounter({ target, duration = 1200 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    const from = prevTarget.current;
    prevTarget.current = target;
    startRef.current = performance.now();

    function tick(now: number) {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return <span className="tabular-nums">{value}</span>;
}

/* ─── Tool chip ────────────────────────────────────────────────────────────── */

function ToolChip({
  name,
  active = false,
  delay = 0,
  animating = false,
}: {
  name: string;
  active?: boolean;
  delay?: number;
  animating?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono transition-all duration-300",
        active
          ? "bg-[#d97757]/20 text-[#d97757] border border-[#d97757]/30"
          : "bg-white/[0.04] text-white/50 border border-white/[0.06]",
        animating && "animate-in fade-in zoom-in-95",
      )}
      style={animating ? { animationDelay: `${delay}ms`, animationFillMode: "backwards" } : undefined}
    >
      {name}
    </span>
  );
}

/* ─── Flow arrow ───────────────────────────────────────────────────────────── */

function FlowArrow({ active = false }: { active?: boolean }) {
  return (
    <div className="flex items-center justify-center px-1 shrink-0">
      <div className="flex items-center gap-0.5">
        <div
          className={cn(
            "h-px w-6 transition-all duration-500",
            active ? "bg-[#d97757]" : "bg-white/10",
          )}
        />
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-colors duration-500",
            active ? "text-[#d97757]" : "text-white/10",
          )}
        />
      </div>
    </div>
  );
}

/* ─── Domain mini card ─────────────────────────────────────────────────────── */

function DomainCard({
  domain,
  delay = 0,
  animating = false,
}: {
  domain: DomainInfo;
  delay?: number;
  animating?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg",
        "bg-white/[0.02] border border-white/[0.06]",
        "transition-all duration-300",
        animating && "animate-in fade-in slide-in-from-bottom-1",
      )}
      style={animating ? { animationDelay: `${delay}ms`, animationFillMode: "backwards" } : undefined}
    >
      <span className="text-[10px] font-mono text-white/60 truncate">
        {domain.name}
      </span>
      <span
        className={cn(
          "text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-full shrink-0",
          domain.color,
        )}
      >
        {domain.toolCount}
      </span>
    </div>
  );
}

/* ─── Main component ───────────────────────────────────────────────────────── */

export interface ToolCoverageProofProps {
  className?: string;
}

export const ToolCoverageProof = memo(function ToolCoverageProof({
  className = "",
}: ToolCoverageProofProps) {
  const [phase, setPhase] = useState<"idle" | "discovering" | "done">("idle");

  const handleRunDiscovery = useCallback(() => {
    if (phase !== "idle") {
      setPhase("idle");
      return;
    }
    setPhase("discovering");
    setTimeout(() => setPhase("done"), 1800);
  }, [phase]);

  const currentToolCount = useMemo(() => {
    switch (phase) {
      case "idle":
        return STARTER_TOOLS.length;
      case "discovering":
        return STARTER_TOOLS.length + Math.floor(DISCOVERED_TOOLS.length / 2);
      case "done":
        return STARTER_TOOLS.length + DISCOVERED_TOOLS.length;
    }
  }, [phase]);

  const showDomains = ALL_DOMAINS.slice(0, phase === "done" ? 57 : 20);

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <Layers className="h-4 w-4 text-[#d97757]" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">
            Progressive Discovery
          </span>
        </div>
        <button
          onClick={handleRunDiscovery}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300",
            phase === "idle"
              ? "bg-[#d97757]/20 text-[#d97757] hover:bg-[#d97757]/30 border border-[#d97757]/30"
              : "bg-white/[0.04] text-white/40 hover:bg-white/[0.06] border border-white/[0.06]",
          )}
          aria-label={phase === "idle" ? "Run Discovery simulation" : "Reset Discovery"}
        >
          <Play className="h-3 w-3" />
          {phase === "idle" ? "Run Discovery" : "Reset"}
        </button>
      </div>

      {/* Tool count ticker */}
      <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold font-mono text-white/90">
            <AnimatedCounter target={currentToolCount} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-white/60">tools active</span>
            <span className="text-[10px] text-white/30">
              of {TOTAL_TOOLS}+ total across {ALL_DOMAINS.length} domains
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-white/30">
          {PERSONA_PRESETS.map((p) => (
            <div key={p.name} className="flex flex-col items-center">
              <span className="font-mono text-white/50">{p.tools}</span>
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Insight banner */}
      <div className="px-5 py-2.5 border-b border-white/[0.04] bg-[#d97757]/[0.04]">
        <p className="text-[11px] text-[#d97757]/80 italic">
          Start with 19. Discover what you need. Never load what you don't.
        </p>
      </div>

      {/* Three-column progressive disclosure */}
      <div className="px-5 py-5">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-0 items-start">
          {/* Column 1: Starter */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-[#d97757]" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/40 font-semibold">
                Starter
              </span>
              <span className="text-[10px] font-mono text-white/30">{STARTER_TOOLS.length} tools</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {STARTER_TOOLS.map((tool) => (
                <ToolChip key={tool} name={tool} active />
              ))}
            </div>
          </div>

          {/* Arrow 1 */}
          <FlowArrow active={phase !== "idle"} />

          {/* Column 2: Discovered */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Play className="h-3.5 w-3.5 text-white/30" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/40 font-semibold">
                Discovered
              </span>
              <span className="text-[10px] font-mono text-white/30">
                {phase !== "idle" ? DISCOVERED_TOOLS.length : 0} tools
              </span>
            </div>
            {phase === "idle" ? (
              <div className="flex items-center justify-center h-24 rounded-xl border border-dashed border-white/[0.08] text-[10px] text-white/20">
                Click "Run Discovery" to simulate
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {DISCOVERED_TOOLS.map((tool, i) => (
                  <ToolChip
                    key={tool}
                    name={tool}
                    active
                    animating={phase === "discovering" || phase === "done"}
                    delay={i * 80}
                  />
                ))}
              </div>
            )}
            {phase !== "idle" && (
              <div className="text-[10px] text-white/30 font-mono animate-in fade-in duration-500">
                discover_tools("company analysis")
              </div>
            )}
          </div>

          {/* Arrow 2 */}
          <FlowArrow active={phase === "done"} />

          {/* Column 3: Full Graph */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Grid3X3 className="h-3.5 w-3.5 text-white/30" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/40 font-semibold">
                Full Graph
              </span>
              <span className="text-[10px] font-mono text-white/30">
                {ALL_DOMAINS.length} domains
              </span>
            </div>
            <div
              className={cn(
                "grid grid-cols-2 gap-1 max-h-[280px] overflow-y-auto pr-1",
                "scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent",
              )}
            >
              {showDomains.map((domain, i) => (
                <DomainCard
                  key={domain.name}
                  domain={domain}
                  animating={phase === "done"}
                  delay={i * 30}
                />
              ))}
            </div>
            {phase === "done" && (
              <div className="text-[10px] text-white/30 text-center font-mono animate-in fade-in duration-700">
                {TOTAL_TOOLS}+ tools reachable
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ToolCoverageProof;
