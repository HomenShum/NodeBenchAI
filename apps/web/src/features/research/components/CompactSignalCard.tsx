import React, { memo } from 'react';
import { ExternalLink, TrendingUp, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeSourceLabel, sanitizeReadableText, sanitizeSignalSummary } from '@/lib/displayText';

const SOURCE_CONFIG: Record<string, { shortLabel: string; color: string; bg: string }> = {
  'Hugging Face': { shortLabel: 'HF', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  'YCombinator': { shortLabel: 'HN', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  TechCrunch: { shortLabel: 'TC', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  ArXiv: { shortLabel: 'AX', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  GitHub: { shortLabel: 'GH', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  'BioPharma Dive': { shortLabel: 'BD', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  FierceBiotech: { shortLabel: 'FB', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  Bloomberg: { shortLabel: 'BB', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  'Financial Times': { shortLabel: 'FT', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  'OpenAI Blog': { shortLabel: 'OA', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  'Google AI Blog': { shortLabel: 'GA', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  'The Hacker News': { shortLabel: 'TH', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
  default: { shortLabel: 'SRC', color: 'text-content-secondary', bg: 'bg-surface-secondary' },
};

const CATEGORY_STYLES: Record<string, { style: string; label: string }> = {
  ai_ml: { style: 'bg-surface-secondary text-content-secondary', label: 'AI & ML' },
  research: { style: 'bg-surface-secondary text-content-secondary', label: 'Research' },
  finance: { style: 'bg-surface-secondary text-content-secondary', label: 'Finance' },
  startups: { style: 'bg-surface-secondary text-content-secondary', label: 'Startups' },
  biotech: { style: 'bg-surface-secondary text-content-secondary', label: 'Biotech' },
  tech: { style: 'bg-surface-secondary text-content-secondary', label: 'Tech' },
  security: { style: 'bg-surface-secondary text-content-secondary', label: 'Security' },
  default: { style: 'bg-surface-secondary text-content-secondary', label: '' },
};

interface CompactSignalCardProps {
  title: string;
  source: string;
  category?: string;
  url?: string;
  publishedAt?: string | Date;
  score?: number;
  isHot?: boolean;
  summary?: string;
  showSummary?: boolean;
  onClick?: () => void;
  className?: string;
}

function getTimeAgo(date: string | Date | undefined): string {
  if (!date) return '';
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return past.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const CompactSignalCard = memo(function CompactSignalCard({
  title,
  source,
  category,
  url,
  publishedAt,
  score,
  isHot,
  summary,
  showSummary = false,
  onClick,
  className,
}: CompactSignalCardProps) {
  const displaySource = normalizeSourceLabel(source, 'Source');
  const sourceKey =
    displaySource.startsWith('Reddit /')
      ? 'default'
      : displaySource === 'Hacker News'
        ? 'YCombinator'
        : displaySource;
  const sourceConfig = SOURCE_CONFIG[sourceKey] || SOURCE_CONFIG.default;
  const categoryConfig = CATEGORY_STYLES[category || 'default'] || CATEGORY_STYLES.default;
  const timeAgo = getTimeAgo(publishedAt);
  const cleanedSummary = showSummary ? sanitizeSignalSummary(summary, displaySource) : '';
  const cleanedTitle = sanitizeReadableText(title);

  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex items-start gap-2 p-2.5 rounded-lg border border-transparent',
        'hover:bg-surface-hover hover:border-edge hover:shadow-sm dark:hover:border-white/10 cursor-pointer transition-all duration-150',
        showSummary && 'py-3',
        className,
      )}
    >
      <div
        className={cn(
          'w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5',
          sourceConfig.bg,
        )}
        aria-hidden="true"
      >
        {sourceConfig.shortLabel}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="text-[13px] font-medium text-content leading-snug line-clamp-2 group-hover:text-content dark:group-hover:text-white transition-colors">
          {cleanedTitle}
        </h4>

        {showSummary && cleanedSummary && (
          <p className="mt-1 text-xs text-content-secondary leading-relaxed line-clamp-2">
            {cleanedSummary}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1.5 text-xs text-content-secondary">
          <span className={cn('font-medium', sourceConfig.color)}>{displaySource}</span>
          {timeAgo && (
            <>
              <span aria-hidden="true" className="text-gray-300 dark:text-content-secondary">/</span>
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {timeAgo}
              </span>
            </>
          )}
          {category && (
            <>
              <span aria-hidden="true" className="text-gray-300 dark:text-content-secondary">/</span>
              <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap', categoryConfig.style)}>
                {categoryConfig.label || category.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
              </span>
            </>
          )}
          {isHot && (
            <span className="flex items-center gap-0.5 text-content-muted">
              <TrendingUp className="w-2.5 h-2.5" />
              Trending
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {score !== undefined && score > 70 && (
          <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-surface-secondary text-content-muted rounded text-xs font-medium">
            {score}
          </div>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="p-1 opacity-0 group-hover:opacity-100 transition-opacity text-content-muted hover:text-indigo-600 dark:hover:text-indigo-400"
            title="Open article"
            aria-label="Open article in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
});

export function CompactSignalList({
  signals,
  maxItems = 10,
  onSignalClick,
}: {
  signals: Array<{
    id: string;
    title: string;
    source: string;
    category?: string;
    url?: string;
    publishedAt?: string | Date;
    score?: number;
  }>;
  maxItems?: number;
  onSignalClick?: (id: string) => void;
}) {
  const displaySignals = signals.slice(0, maxItems);
  const remaining = signals.length - maxItems;

  return (
    <div className="space-y-0.5">
      {displaySignals.map((signal) => (
        <CompactSignalCard
          key={signal.id}
          {...signal}
          isHot={signal.score !== undefined && signal.score > 80}
          onClick={() => onSignalClick?.(signal.id)}
        />
      ))}
      {remaining > 0 && (
        <div className="text-center py-2 text-xs text-content-muted">
          +{remaining} more signals
        </div>
      )}
    </div>
  );
}
