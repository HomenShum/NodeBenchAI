/**
 * DealListSection - Right-rail deal/regulatory list wrapper
 *
 * Currently uses a small demo set until deals are backed by a query.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { RefreshCw } from "lucide-react";
import { DealFlyout, DealListPanel, type Deal } from "../components/DealListPanel";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";

export interface DealListSectionProps {
  className?: string;
  deals?: Deal[];
}

const DEMO_DEALS: Deal[] = [
  {
    id: "atlas-robotics",
    company: "Atlas Robotics",
    sector: "robotics",
    stage: "series a",
    amount: "$18M",
    date: "2d ago",
    location: "Austin, TX",
    leads: ["Khosla Ventures"],
    coInvestors: ["Lux Capital"],
    summary: "Autonomous warehouse picking with vision-language control loops. Early pilots show 27% throughput gains.",
    traction: "3 paid pilots (Fortune 500 retail)",
    sentiment: "hot",
    spark: [8, 9, 11, 13, 15, 18, 21, 24],
    people: [
      { name: "Ava Patel", role: "CEO", past: "ex-Amazon Robotics; CMU Robotics" },
      { name: "Jon Kim", role: "CTO", past: "ex-Boston Dynamics; MIT" },
    ],
    timeline: [
      { label: "Dec", detail: "Series A $18M (Khosla lead)" },
      { label: "Nov", detail: "Signed 3 pilots" },
      { label: "Oct", detail: "V2 control stack shipped" },
    ],
    regulatory: {
      patents: ["Safety-aware grasp planning", "Multi-agent route optimization"],
    },
  },
  {
    id: "helix-bio",
    company: "Helix BioSystems",
    sector: "healthcare",
    stage: "seed",
    amount: "$3.2M",
    date: "5d ago",
    location: "Boston, MA",
    leads: ["Atlas Ventures"],
    coInvestors: ["General Catalyst"],
    summary: "Lab-on-a-chip diagnostics for rapid sepsis detection. Early results show 15-minute turnaround with 92% sensitivity.",
    traction: "Clinical pilot in 2 hospitals",
    sentiment: "watch",
    spark: [12, 14, 15, 16, 17, 18, 20, 22, 25],
    people: [
      { name: "Dr. Mia Chen", role: "CEO", past: "ex-Illumina; Stanford PhD BioE" },
      { name: "Rafael Ortiz", role: "CTO", past: "ex-Thermo Fisher; MIT EE" },
    ],
    timeline: [
      { label: "Dec", detail: "Seed $3.2M (Atlas lead)" },
      { label: "Nov", detail: "IDE package submitted to FDA" },
      { label: "Oct", detail: "Pilot validated in 2 ICUs" },
    ],
    regulatory: {
      fdaStatus: "FDA: IDE submitted, review pending",
      papers: ["Contrastive learning for diagnostic triage"],
    },
  },
];

function DealListSectionInner({ className = "", deals }: DealListSectionProps) {
  const { openWithContext } = useFastAgent();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [liveDeals, setLiveDeals] = useState<Deal[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cachedDeals = useQuery(api.domains.research.dealFlowQueries.getDealFlow, {});
  const refresh = useAction(api.domains.research.dealFlow.refreshDealFlow);

  useEffect(() => {
    if (deals?.length) return;
    if (cachedDeals && cachedDeals.length > 0) return;
    let mounted = true;
    setIsRefreshing(true);
    refresh({ focusSectors: ["healthcare", "life sciences", "commerce", "biotech"] })
      .then((result: any) => {
        if (mounted) setLiveDeals(result.deals ?? []);
      })
      .catch((err: any) => {
        if (mounted) setError(err?.message ?? "Failed to refresh deal flow.");
      })
      .finally(() => {
        if (mounted) setIsRefreshing(false);
      });
    return () => {
      mounted = false;
    };
  }, [cachedDeals, deals, refresh]);

  const resolvedDeals = useMemo(() => {
    if (deals && deals.length > 0) return deals;
    if (cachedDeals && cachedDeals.length > 0) return cachedDeals as Deal[];
    if (liveDeals && liveDeals.length > 0) return liveDeals;
    return DEMO_DEALS;
  }, [cachedDeals, deals, liveDeals]);

  const handlePrep = (intent: "email" | "call" | "invite", deal: Deal) => {
    const intentLabel = intent === "email" ? "draft an email" : intent === "call" ? "prepare for a call" : "write an invite";
    openWithContext({
      contextTitle: `Deal: ${deal.company}`,
      initialMessage: `Help me ${intentLabel} about ${deal.company} (${deal.amount}, ${deal.stage}). Include key questions, risks, and next steps.`,
    });
  };

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between text-xs text-content-secondary">
        <div className="flex items-center gap-2">
          <span className=" font-semibold text-content-secondary">Live Deal Flow</span>
          {isRefreshing && <span className="text-indigo-600">Refreshing…</span>}
          {!isRefreshing && cachedDeals?.length ? <span className="text-indigo-600">Synced</span> : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setIsRefreshing(true);
            refresh({ forceRefresh: true, focusSectors: ["healthcare", "life sciences", "commerce", "biotech"] })
              .then((result: any) => setLiveDeals(result.deals ?? []))
              .catch((err: any) => setError(err?.message ?? "Failed to refresh deal flow."))
              .finally(() => setIsRefreshing(false));
          }}
          className="flex items-center gap-1 text-content-secondary hover:text-content"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? "motion-safe:animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
      <DealListPanel deals={resolvedDeals} onOpenDeal={setSelectedDeal} />
      <DealFlyout deal={selectedDeal} onClose={() => setSelectedDeal(null)} onPrep={handlePrep} />
    </div>
  );
}

export function DealListSection(props: DealListSectionProps) {
  return (
    <ErrorBoundary section="Deal List">
      <DealListSectionInner {...props} />
    </ErrorBoundary>
  );
}

export default DealListSection;
