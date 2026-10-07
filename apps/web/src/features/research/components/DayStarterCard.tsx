import React from "react";
import { Zap, Play, UserCircle } from "lucide-react";

type Preset = {
  id: string;
  title: string;
  subtitle: string;
  prompt: string;
  persona: string;
};

interface DayStarterCardProps {
  onRunPreset: (prompt: string, persona: string) => void;
  activePersona: string;
  onPersonaChange: (persona: string) => void;
  isGuest?: boolean;
}

const PRESETS: Preset[] = [
  {
    id: "general",
    persona: "general",
    title: "Overnight Brief",
    subtitle: "Top 5 moves + risks across your sources; public signals only.",
    prompt:
      "Give me the top 5 overnight moves with risks across my sources. Use public news, filings, FDA updates, patents, and academic papers if available. Keep it 30 seconds.",
  },
  {
    id: "banking",
    persona: "banking",
    title: "Banking Prospect",
    subtitle: "Seed/Series A healthcare/life science raises > $2M (last 7 days).",
    prompt:
      "Give me seed/Series A healthcare and life science companies that raised more than $2M in the past 7 days. Include amount, investors, founders, credibility signals (past companies, exits, schools), and links to filings, FDA status, patents, and academic papers.",
  },
  {
    id: "product",
    persona: "product",
    title: "Product Scout",
    subtitle: "New AI infra launches + traction signals.",
    prompt:
      "List AI infrastructure launches this week with traction indicators (repos, stars, waitlist, early adopters). Add founder profiles and standout differentiators.",
  },
  {
    id: "research",
    persona: "research",
    title: "Regulatory Scan",
    subtitle: "FDA approvals/pending + patent grants impacting therapeutics.",
    prompt:
      "Summarize notable FDA approvals or pending filings and patent grants in therapeutics this week. Include companies, indications, trial stage, and timelines.",
  },
  {
    id: "sales",
    persona: "sales",
    title: "Pipeline Builder",
    subtitle: "Fast-growing Series B+ with hiring velocity and fresh budgets.",
    prompt:
      "Identify Series B+ tech companies showing hiring velocity and fresh budgets this quarter. Include revenue proxy, hiring rate, recent fundraising, and execs to target with credibility notes.",
  },
];

export function DayStarterCard({ onRunPreset, activePersona, onPersonaChange, isGuest }: DayStarterCardProps) {
  const personas = ["general", "banking", "product", "research", "sales"];
  const filteredPresets = PRESETS.filter((p) => p.persona === activePersona);

  return (
    <div className="rounded-lg border border-edge bg-surface shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-content text-white flex items-center justify-center shadow-sm">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-content-secondary">Day Starter</p>
            <p className="text-sm font-semibold text-content">Choose a preset</p>
          </div>
        </div>
        <div className="flex gap-1">
          {personas.map((persona) => (
            <button
              key={persona}
              type="button"
              onClick={() => onPersonaChange(persona)}
              className={`px-2 py-1 rounded-full text-xs font-semibold border ${
                activePersona === persona
                  ? "bg-content text-white border-content"
                  : "bg-surface text-content border-edge hover:bg-surface-hover"
              }`}
            >
              {persona}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-[color:var(--border-color)]">
        {filteredPresets.map((preset) => (
          <div key={preset.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <UserCircle className="w-4 h-4 text-content-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-content">{preset.title}</p>
                <p className="text-[12px] text-content leading-relaxed">{preset.subtitle}</p>
                {isGuest && preset.persona !== "general" && (
                  <p className="text-xs text-amber-600 mt-1">Sign in for full investor/FDA/patent detail.</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => onRunPreset(preset.prompt, preset.persona)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-content text-white text-xs font-semibold px-3 py-2 hover:bg-content/80 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Run
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText?.(preset.prompt)}
                className="text-[12px] text-content-secondary hover:text-content"
              >
                Copy prompt
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DayStarterCard;
