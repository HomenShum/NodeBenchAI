/**
 * ArbitrageReportCard.tsx
 * Visual component for displaying arbitrage verification results
 * Shows contradictions, source quality rankings, deltas, and health status
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ChevronDown, 
  ChevronRight,
  Shield,
  TrendingUp,
  TrendingDown,
  Minus,
  Link2,
  AlertCircle,
  FileWarning
} from 'lucide-react';
import { StatusBadge, type ArbitrageStatus } from './FastAgentPanel.VisualCitation';

// Types matching backend arbitrage tool outputs
interface Contradiction {
  id: string;
  claim1: { claim: string; source: string };
  claim2: { claim: string; source: string };
  severity: 'high' | 'medium' | 'low';
  analysis: string;
}

interface RankedSource {
  url: string;
  name: string;
  type: string;
  qualityScore: number;
  tier: 'excellent' | 'good' | 'fair' | 'poor';
  recencyBonus: number;
  finalScore: number;
}

interface Delta {
  type: 'fact_added' | 'fact_removed' | 'fact_modified' | 'conflict_detected' | 'conflict_resolved' | 'source_404' | 'source_changed';
  factId?: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

interface SourceHealth {
  url: string;
  status: 'ok' | '404' | 'content_changed';
  contentHash: string;
  responseTimeMs?: number;
}

interface ArbitrageReportData {
  contradictions?: Contradiction[];
  rankedSources?: RankedSource[];
  deltas?: Delta[];
  healthResults?: SourceHealth[];
  overallStatus?: ArbitrageStatus;
  summary?: string;
}

interface ArbitrageReportCardProps {
  data: ArbitrageReportData;
  className?: string;
}

/**
 * Severity badge component
 */
function SeverityBadge({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { label: 'High', bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' },
    medium: { label: 'Medium', bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
    low: { label: 'Low', bg: 'bg-surface-hover dark:bg-surface-secondary', text: 'text-content-secondary dark:text-content-muted' },
  };
  const c = config[severity];
  return (
    <span className={cn('px-1.5 py-0.5 text-xs font-medium rounded-full', c.bg, c.text)}>
      {c.label}
    </span>
  );
}

/**
 * Quality tier badge
 */
function QualityTierBadge({ tier, score }: { tier: string; score: number }) {
  const config: Record<string, { bg: string; text: string }> = {
    excellent: { bg: 'bg-indigo-100 dark:bg-gray-900/40', text: 'text-content-secondary dark:text-indigo-300' },
    good: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
    fair: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
    poor: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' },
  };
  const c = config[tier] || config.fair;
  return (
    <span className={cn('px-1.5 py-0.5 text-xs font-medium rounded-full', c.bg, c.text)}>
      {tier} ({score})
    </span>
  );
}

/**
 * Collapsible section component
 */
function CollapsibleSection({ 
  title, 
  icon: Icon, 
  count, 
  defaultOpen = false,
  children,
  variant = 'default'
}: { 
  title: string; 
  icon: React.ElementType; 
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  variant?: 'default' | 'warning' | 'success' | 'error';
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  const variantStyles = {
    default: 'border-edge dark:border-edge',
    warning: 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/20',
    success: 'border-indigo-300 dark:border-gray-700 bg-indigo-50/50 dark:bg-gray-900/20',
    error: 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/20',
  };

  return (
    <div className={cn('border rounded-lg overflow-hidden', variantStyles[variant])}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left hover:bg-surface-hover dark:hover:bg-surface-secondary transition-colors"
      >
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Icon className="h-4 w-4" />
        <span className="flex-1">{title}</span>
        {count !== undefined && (
          <span className="px-1.5 py-0.5 text-xs font-medium bg-surface-secondary dark:bg-surface-secondary rounded-full">
            {count}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-1 border-t border-edge dark:border-edge">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * ArbitrageReportCard - Main component
 */
export function ArbitrageReportCard({ data, className }: ArbitrageReportCardProps) {
  const hasContradictions = data.contradictions && data.contradictions.length > 0;
  const hasSources = data.rankedSources && data.rankedSources.length > 0;
  const hasDeltas = data.deltas && data.deltas.length > 0;
  const hasHealthIssues = data.healthResults?.some(h => h.status !== 'ok');

  if (!hasContradictions && !hasSources && !hasDeltas && !data.healthResults) {
    return null;
  }

  return (
    <div className={cn('space-y-2 mb-4', className)}>
      {/* Header with overall status */}
      <div className="flex items-center gap-2 px-1">
        <Shield className="h-4 w-4 text-violet-500" />
        <span className="text-sm font-medium text-content dark:text-content">Verification Report</span>
        {data.overallStatus && <StatusBadge status={data.overallStatus} size="sm" />}
      </div>

      {/* Summary if provided */}
      {data.summary && (
        <p className="text-xs text-content-secondary dark:text-content-muted px-1">{data.summary}</p>
      )}

      {/* Contradictions */}
      {hasContradictions && (
        <CollapsibleSection
          title="Contradictions Detected"
          icon={AlertTriangle}
          count={data.contradictions!.length}
          defaultOpen={true}
          variant="warning"
        >
          <div className="space-y-2">
            {data.contradictions!.map((c, idx) => (
              <div key={c.id || idx} className="p-2 bg-surface dark:bg-surface-secondary rounded border border-edge dark:border-edge">
                <div className="flex items-center gap-2 mb-1">
                  <SeverityBadge severity={c.severity} />
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex gap-1">
                    <span className="text-content-secondary">Claim 1:</span>
                    <span className="text-content dark:text-content">{c.claim1.claim}</span>
                    <span className="text-content-muted">({c.claim1.source})</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-content-secondary">Claim 2:</span>
                    <span className="text-content dark:text-content">{c.claim2.claim}</span>
                    <span className="text-content-muted">({c.claim2.source})</span>
                  </div>
                  <div className="text-content-secondary dark:text-content-muted italic mt-1">{c.analysis}</div>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Source Quality Rankings */}
      {hasSources && (
        <CollapsibleSection
          title="Source Quality Rankings"
          icon={TrendingUp}
          count={data.rankedSources!.length}
          variant="default"
        >
          <div className="space-y-1">
            {data.rankedSources!.map((s, idx) => (
              <div key={s.url || idx} className="flex items-center gap-2 py-1 text-xs">
                <span className="font-mono text-content-secondary w-4">{idx + 1}.</span>
                <QualityTierBadge tier={s.tier} score={s.finalScore} />
                <span className="text-content dark:text-content truncate flex-1">{s.name}</span>
                <span className="text-content-muted text-xs">{s.type}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Deltas / Changes */}
      {hasDeltas && (
        <CollapsibleSection
          title="What Changed"
          icon={Clock}
          count={data.deltas!.length}
          variant="default"
        >
          <div className="space-y-1">
            {data.deltas!.map((d, idx) => (
              <div key={d.factId || idx} className="flex items-center gap-2 py-1 text-xs">
                {d.type === 'fact_added' && <TrendingUp className="h-3 w-3 text-green-500" />}
                {d.type === 'fact_removed' && <TrendingDown className="h-3 w-3 text-red-500" />}
                {d.type === 'fact_modified' && <Minus className="h-3 w-3 text-amber-500" />}
                {d.type.includes('conflict') && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                {d.type.includes('source') && <Link2 className="h-3 w-3 text-content-secondary" />}
                <SeverityBadge severity={d.severity} />
                <span className="text-content dark:text-content flex-1">{d.description}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Source Health */}
      {data.healthResults && data.healthResults.length > 0 && (
        <CollapsibleSection
          title="Source Health"
          icon={hasHealthIssues ? AlertCircle : CheckCircle2}
          count={data.healthResults.length}
          variant={hasHealthIssues ? 'error' : 'success'}
        >
          <div className="space-y-1">
            {data.healthResults.map((h, idx) => (
              <div key={h.url || idx} className="flex items-center gap-2 py-1 text-xs">
                {h.status === 'ok' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                {h.status === '404' && <XCircle className="h-3 w-3 text-red-500" />}
                {h.status === 'content_changed' && <FileWarning className="h-3 w-3 text-amber-500" />}
                <span className="text-content dark:text-content truncate flex-1">{h.url}</span>
                {h.responseTimeMs && (
                  <span className="text-content-muted text-xs">{h.responseTimeMs}ms</span>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

export default ArbitrageReportCard;
