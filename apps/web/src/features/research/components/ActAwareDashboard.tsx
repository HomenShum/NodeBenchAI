import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotionConfig } from '@/lib/motion';
import { StickyDashboard, type WorkflowStep } from './StickyDashboard';
import type { DashboardState, DailyBriefPayload, SourceSummary, Signal, Evidence, EntityGraph } from '@/features/research/types';
import { ChartDataPointContext } from './EnhancedLineChart';
import { Activity, Share2, Zap } from 'lucide-react';
import { EvidencePanel } from './EvidencePanel';
import { EntityRadar } from './EntityRadar';

interface ActAwareDashboardProps {
  activeAct: 'actI' | 'actII' | 'actIII';
  dashboardData: DashboardState;
  executiveBrief: DailyBriefPayload | null;
  sourceSummary: SourceSummary | null;
  evidence: Evidence[];
  workflowSteps: WorkflowStep[];
  deltas?: {
    keyStats: Array<{ label: string; delta: number }>;
    capabilities: Array<{ label: string; delta: number | null }>;
  } | null;
  onDataPointClick?: (point: ChartDataPointContext) => void;
  onEvidenceClick?: (evidence: Evidence) => void;
}

// ------------------------------------------------------------------
// ACT II: THE NETWORK (Context View)
// ------------------------------------------------------------------
function ActIIChangeView({
  brief,
  graph
}: {
  brief: DailyBriefPayload | null;
  graph?: EntityGraph | null;
}) {
  // Extract key "Change" drivers from Act II signals
  const drivers = brief?.actII?.signals?.slice(0, 4) || [];

  return (
    <div className="space-y-6">
      <div className="border-b border-edge pb-6">
        <h2 className="text-2xl font-semibold text-content tracking-tight mb-2">
          Context Graph
        </h2>
        <div className="flex items-center gap-2">
          <Share2 className="w-3 h-3 text-content-secondary" />
          <span className="text-xs font-medium text-content-muted">
            Active Narratives
          </span>
        </div>
      </div>

      <EntityRadar graph={graph ?? null} />

      <div className="space-y-4">
        {drivers.length === 0 ? (
          <div className="text-sm text-content-muted italic">No active narratives detected.</div>
        ) : (
          drivers.map((signal: any, i: number) => (
            <div key={signal.headline ?? i} className="group cursor-default">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-content-muted/50 group-hover:bg-content-secondary transition-colors" />
                <span className="text-xs font-medium text-content-muted group-hover:text-content transition-colors">
                  Node {i + 1}
                </span>
              </div>
              <p className="text-sm font-medium text-content leading-snug pl-4 border-l border-edge group-hover:border-content/40 transition-colors">
                {signal.headline}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// ACT III: THE PULSE (Signal Velocity)
// ------------------------------------------------------------------
function ActIIIVelocityView({ summary }: { summary: SourceSummary | null }) {
  const totalNodes = summary?.totalItems || 0;
  // Mock velocity for "alive" feel
  const velocity = Math.round(totalNodes / 24 * 1.5);

  return (
    <div className="space-y-6">
      <div className="border-b border-edge pb-6">
        <h2 className="text-2xl font-semibold text-content tracking-tight mb-2">
          Signal Velocity
        </h2>
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3 text-content-secondary" />
          <span className="text-xs font-medium text-content-muted">
            Processing Rate
          </span>
        </div>
      </div>

      {/* Velocity Big Stat */}
      <div className="py-8 text-center bg-surface-secondary border border-edge">
        <span className="text-6xl font-bold text-content block">{velocity}</span>
        <span className="text-xs font-medium text-content-muted">Nodes / Hour</span>
      </div>

      {/* Source Distribution */}
      <div className="space-y-3">
        <div className="flex justify-between text-xs font-medium text-content-muted mb-2">
          <span>Source Distribution</span>
        </div>
        {(summary?.breakdown || []).slice(0, 4).map((item: { source: string; count: number }) => (
          <div key={item.source} className="flex items-center justify-between group">
            <span className="text-xs text-content-secondary group-hover:text-content transition-colors capitalize">{item.source}</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500/50 group-hover:bg-indigo-500/70 transition-all duration-500"
                  style={{ width: `${(item.count / totalNodes) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono text-content-muted w-4 text-right">{item.count}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// MAIN COMPONENT
// ------------------------------------------------------------------
export const ActAwareDashboard: React.FC<ActAwareDashboardProps> = ({
  activeAct,
  dashboardData,
  executiveBrief,
  sourceSummary,
  evidence,
  workflowSteps,
  deltas,
  onDataPointClick,
  onEvidenceClick
}) => {
  const { instant, transition } = useMotionConfig();

  // Extract evidence relevant to the current act
  const actEvidence = React.useMemo(() => {
    if (!executiveBrief || !evidence.length) return evidence;

    // For now, return all evidence. Future: filter by act.
    return evidence;
  }, [executiveBrief, evidence]);

  return (
    <div className="relative"> {/* Naturally sized container */}
      <AnimatePresence mode="wait">

        {/* ACT I: The Horizon (Standard Dashboard) */}
        {activeAct === 'actI' && (
          <motion.div
            key="actI"
            initial={instant ? { opacity: 1 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={instant ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={transition({ duration: 0.4, ease: "circOut" })}
            className="w-full"
          >
            <StickyDashboard
              data={dashboardData}
              activeAct={activeAct}
              workflowSteps={workflowSteps}
              deltas={deltas}
              onDataPointClick={onDataPointClick}
            />
            {actEvidence.length > 0 && (
              <EvidencePanel evidence={actEvidence} title="Sources for Today" maxVisible={8} onEvidenceClick={onEvidenceClick} />
            )}
          </motion.div>
        )}

        {/* ACT II: The Network */}
        {activeAct === 'actII' && (
          <motion.div
            key="actII"
            initial={instant ? { opacity: 1 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={instant ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={transition({ duration: 0.4, ease: "circOut" })}
            className="w-full"
          >
            <ActIIChangeView brief={executiveBrief} graph={dashboardData.entityGraph ?? null} />
            {actEvidence.length > 0 && (
              <EvidencePanel evidence={actEvidence} title="Brief Sources" maxVisible={actEvidence.length} onEvidenceClick={onEvidenceClick} />
            )}
          </motion.div>
        )}

        {/* ACT III: The Pulse */}
        {activeAct === 'actIII' && (
          <motion.div
            key="actIII"
            initial={instant ? { opacity: 1 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={instant ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={transition({ duration: 0.4, ease: "circOut" })}
            className="w-full"
          >
            <ActIIIVelocityView summary={sourceSummary} />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};
