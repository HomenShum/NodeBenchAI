import React from 'react';
import { Flame, TrendingUp, TrendingDown, Zap, FileText, Bell } from 'lucide-react';

export interface TrendItem {
  id: string;
  label: string;
  delta: string;
  hot?: boolean;
  type?: 'up' | 'down' | 'new' | 'update';
}

interface TrendRailProps {
  trends?: TrendItem[];
  onTrendClick?: (trend: TrendItem) => void;
  className?: string;
}

const DEFAULT_TRENDS: TrendItem[] = [
  { id: '1', label: "AI Infra", delta: "+12%", hot: true, type: 'up' },
  { id: '2', label: "NVIDIA 10-K", delta: "New", hot: true, type: 'new' },
  { id: '3', label: "SaaS Multiples", delta: "-2.1%", hot: false, type: 'down' },
  { id: '4', label: "Regulatory EU", delta: "Update", hot: false, type: 'update' },
  { id: '5', label: "OpenAI", delta: "Trending", hot: true, type: 'up' },
  { id: '6', label: "Series A Deals", delta: "+8%", hot: false, type: 'up' },
  { id: '7', label: "Biotech FDA", delta: "Alert", hot: true, type: 'new' },
];

export const TrendRail: React.FC<TrendRailProps> = ({ 
  trends = DEFAULT_TRENDS, 
  onTrendClick,
  className = '' 
}) => {
  const getDeltaStyle = (trend: TrendItem) => {
    if (trend.type === 'up' || trend.hot) return 'bg-surface-secondary text-content-secondary';
    if (trend.type === 'down') return 'bg-surface-secondary text-content-secondary';
    if (trend.type === 'new') return 'bg-surface-secondary text-content-secondary';
    return 'bg-surface-secondary text-content-muted';
  };

  const getDeltaIcon = (trend: TrendItem) => {
    if (trend.type === 'up') return <TrendingUp className="w-2.5 h-2.5" />;
    if (trend.type === 'down') return <TrendingDown className="w-2.5 h-2.5" />;
    if (trend.type === 'new') return <FileText className="w-2.5 h-2.5" />;
    if (trend.type === 'update') return <Bell className="w-2.5 h-2.5" />;
    return null;
  };

  return (
    <div className={`w-full overflow-x-auto no-scrollbar py-3 ${className}`}>
      <div className="flex items-center gap-3 px-1">
        {/* Live Signals Badge */}
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface-secondary text-content-secondary border border-edge text-xs font-medium whitespace-nowrap shrink-0">
          <Flame className="w-3.5 h-3.5 text-content-muted" />
          <span>Live Signals</span>
          <span className="relative flex h-2 w-2 ml-1">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-content-muted opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-content-secondary"></span>
          </span>
        </div>
        
        {/* Trend Pills */}
        {trends.map((trend) => (
          <button 
            key={trend.id} 
            onClick={() => onTrendClick?.(trend)}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-surface border border-edge hover:border-primary/20 hover:bg-surface-hover hover:shadow-sm transition-all duration-200 whitespace-nowrap group shrink-0"
          >
            <span className="text-sm font-medium text-content group-hover:text-content">{trend.label}</span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5 ${getDeltaStyle(trend)}`}>
              {getDeltaIcon(trend)}
              {trend.delta}
            </span>
            {trend.hot && (
              <Zap className="w-3 h-3 text-content-muted" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

