import React, { useMemo, useState } from "react";
import { Filter, Users, ArrowRight, Building, FileText, FlaskConical, ShieldCheck, BookOpen, Zap } from "lucide-react";
import { Sparkline } from "@/components/ui/Sparkline";

export type Deal = {
  id: string;
  company: string;
  sector: string;
  stage: string;
  amount: string;
  date: string;
  location: string;
  foundingYear?: string;
  foundersBackground?: string;
  leads: string[];
  coInvestors?: string[];
  summary: string;
  traction?: string;
  sentiment?: "hot" | "watch";
  spark?: number[];
  people: Array<{
    name: string;
    role: string;
    past: string;
  }>;
  timeline: Array<{
    label: string;
    detail: string;
  }>;
  regulatory?: {
    fdaStatus?: string;
    patents?: string[];
    papers?: string[];
  };
  sources?: Array<{
    name: string;
    url: string;
  }>;
};

interface DealListPanelProps {
  deals: Deal[];
  onOpenDeal: (deal: Deal) => void;
}

const sentimentStyles: Record<NonNullable<Deal["sentiment"]>, string> = {
  hot: "bg-green-50 text-green-700 border border-green-100",
  watch: "bg-blue-50 text-blue-700 border border-blue-100",
};

export function DealListPanel({ deals, onOpenDeal }: DealListPanelProps) {
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [focusedSelect, setFocusedSelect] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return deals.filter((deal) => {
      const stageOk = stageFilter === "all" || deal.stage.toLowerCase() === stageFilter;
      const sectorOk = sectorFilter === "all" || deal.sector.toLowerCase() === sectorFilter;
      return stageOk && sectorOk;
    });
  }, [deals, stageFilter, sectorFilter]);

  const stages = Array.from(new Set(deals.map((d) => d.stage.toLowerCase())));
  const sectors = Array.from(new Set(deals.map((d) => d.sector.toLowerCase())));

  return (
    <div className="rounded-lg border border-edge bg-surface shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
            <Building className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-content-secondary">Deal List</p>
            <p className="text-sm font-semibold text-content">Filter by stage & sector</p>
          </div>
        </div>
        <Filter className="w-4 h-4 text-content-secondary" />
      </div>

      <div className="flex gap-2 px-4 pt-3 pb-2">
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          onFocus={() => setFocusedSelect("stage")}
          onBlur={() => setFocusedSelect(null)}
          aria-label="Filter by stage"
          className={`flex-1 text-sm border rounded-lg px-3 py-2 bg-surface-secondary focus:outline-none focus:ring-2 ${
            focusedSelect === "stage" ? "border-edge ring-[color:var(--border-color)]" : "border-edge ring-[color:var(--border-color)]"
          }`}
        >
          <option value="all">Stage: All</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          onFocus={() => setFocusedSelect("sector")}
          onBlur={() => setFocusedSelect(null)}
          aria-label="Filter by sector"
          className={`flex-1 text-sm border rounded-lg px-3 py-2 bg-surface-secondary focus:outline-none focus:ring-2 ${
            focusedSelect === "sector" ? "border-edge ring-[color:var(--border-color)]" : "border-edge ring-[color:var(--border-color)]"
          }`}
        >
          <option value="all">Sector: All</option>
          {sectors.map((sector) => (
            <option key={sector} value={sector}>
              {sector}
            </option>
          ))}
        </select>
      </div>

      <div className="divide-y divide-[color:var(--border-color)]">
        {filtered.map((deal) => (
          <button
            key={deal.id}
            type="button"
            onClick={() => onOpenDeal(deal)}
            className="w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-content truncate">{deal.company}</p>
                  <span className="text-xs font-semibold text-content-secondary">{deal.amount}</span>
                  <span className="text-xs text-content-secondary">• {deal.stage}</span>
                  <span className="text-xs text-content-secondary">• {deal.date}</span>
                  {deal.sentiment && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sentimentStyles[deal.sentiment]}`}>
                      {deal.sentiment === "hot" ? "Hot" : "Watch"}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-content line-clamp-2">{deal.summary}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-content-secondary">
                  <span className="rounded-full bg-surface-secondary px-2 py-0.5">{deal.location}</span>
                  <span className="rounded-full bg-surface-secondary px-2 py-0.5">{deal.sector}</span>
                  {deal.leads?.[0] && <span className="rounded-full bg-surface-secondary px-2 py-0.5">Lead: {deal.leads[0]}</span>}
                  {deal.traction && <span className="text-content-secondary bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">{deal.traction}</span>}
                </div>
              </div>
              {deal.spark && (
                <div className="w-24">
                  <Sparkline data={deal.spark} width={90} height={32} color="#22c55e" />
                </div>
              )}
              <ArrowRight className="w-4 h-4 text-content-secondary" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DealFlyout({
  deal,
  onClose,
  onPrep,
}: {
  deal: Deal | null;
  onClose: () => void;
  onPrep: (intent: "email" | "call" | "invite", deal: Deal) => void;
}) {
  if (!deal) return null;
  const sortedSources = (deal.sources ?? []).slice().sort((a, b) => {
    const score = (source: { name: string; url: string }) => {
      const hay = `${source.name} ${source.url}`.toLowerCase();
      if (hay.includes("pitchbook")) return 0;
      if (hay.includes("crunchbase")) return 1;
      return 2;
    };
    return score(a) - score(b);
  });

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-end pointer-events-none">
      <div className="absolute inset-0 bg-black/10 pointer-events-auto cursor-pointer" role="button" tabIndex={-1} aria-label="Close panel" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} />
      <div className="relative pointer-events-auto mt-10 mr-6 w-[420px] max-w-[94vw] bg-surface border border-edge shadow-2xl rounded-lg overflow-hidden">
        <div className="flex items-start justify-between px-4 py-3 border-b border-edge">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold text-content">{deal.company}</p>
              <span className="text-xs font-semibold text-content">{deal.amount}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-secondary text-content border border-edge">{deal.stage}</span>
            </div>
            <p className="text-sm text-content">{deal.sector} • {deal.location}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-content-secondary hover:text-content"
            aria-label="Close deal details"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="text-sm text-content leading-relaxed line-clamp-3">{deal.summary}</div>

          {(deal.foundingYear || deal.location || deal.foundersBackground) && (
            <div className="rounded-lg border border-edge bg-surface-secondary p-3 space-y-1">
              <div className="text-xs font-semibold text-content-secondary">Company profile</div>
              <div className="grid grid-cols-2 gap-2 text-[12px] text-content">
                <div>
                  <span className="font-semibold">Founded:</span> {deal.foundingYear || "n/a"}
                </div>
                <div>
                  <span className="font-semibold">HQ:</span> {deal.location || "n/a"}
                </div>
              </div>
              {deal.foundersBackground && (
                <div className="text-[12px] text-content">
                  <span className="font-semibold text-content-secondary">Founder background:</span> {deal.foundersBackground}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-edge bg-surface-secondary p-3 space-y-1">
            <div className="text-xs font-semibold text-content-secondary">Leads & Co-investors</div>
            <p className="text-sm text-content">
              Lead: {deal.leads.join(", ")}
              {deal.coInvestors?.length ? ` • Co-investors: ${deal.coInvestors.join(", ")}` : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-edge p-3 bg-surface">
              <div className="flex items-center gap-1 text-xs font-semibold text-content-secondary">
                <Users className="w-3.5 h-3.5" />
                People
              </div>
              <ul className="mt-2 space-y-1">
                {deal.people.map((p, idx) => (
                  <li key={idx} className="text-sm text-content">
                    <span className="font-semibold">{p.name}</span> — {p.role}
                    <div className="text-[12px] text-content-secondary">{p.past}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-edge p-3 bg-surface">
              <div className="flex items-center gap-1 text-xs font-semibold text-content-secondary">
                <FileText className="w-3.5 h-3.5" />
                Timeline
              </div>
              <ul className="mt-2 space-y-1">
                {deal.timeline.map((item, idx) => (
                  <li key={idx} className="text-sm text-content flex gap-2">
                    <span className="text-content-secondary text-[12px]">{item.label}</span>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-lg border border-edge p-3 bg-surface space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-content-secondary">
              <FlaskConical className="w-3.5 h-3.5" />
              Regulatory & Papers
            </div>
            {deal.regulatory?.fdaStatus && (
              <div className="inline-flex items-center gap-2 text-[12px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                <ShieldCheck className="w-3.5 h-3.5" />
                {deal.regulatory.fdaStatus}
              </div>
            )}
            {deal.regulatory?.patents?.length ? (
              <div className="text-sm text-content">
                <span className="font-semibold">Patents:</span> {deal.regulatory.patents.join(", ")}
              </div>
            ) : null}
            {deal.regulatory?.papers?.length ? (
              <div className="text-sm text-content space-y-1">
                <div className="font-semibold">Academic papers</div>
                <ul className="list-disc list-inside text-content text-[13px]">
                  {deal.regulatory.papers.map((p, idx) => (
                    <li key={idx}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {deal.sources?.length ? (
            <div className="rounded-lg border border-edge p-3 bg-surface space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-content-secondary">
                <FileText className="w-3.5 h-3.5" />
                Data Room Links
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {sortedSources.slice(0, 4).map((source) => (
                  <a
                    key={`${source.url}-${source.name}`}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-secondary px-2 py-1 text-content hover:text-content"
                  >
                    {source.name}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onPrep("email", deal)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold px-3 py-2 hover:bg-gray-800 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              Prep email
            </button>
            <button
              type="button"
              onClick={() => onPrep("call", deal)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-edge bg-surface text-xs font-semibold px-3 py-2 hover:bg-surface-hover transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Call brief
            </button>
            <button
              type="button"
              onClick={() => onPrep("invite", deal)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-edge bg-surface text-xs font-semibold px-3 py-2 hover:bg-surface-hover transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Invite
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DealListPanel;
