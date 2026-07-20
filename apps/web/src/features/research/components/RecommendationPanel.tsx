import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useRecommendations } from '../../../hooks/useRecommendations';
import { RecommendationCard } from './RecommendationCard';
import { useMotionConfig } from '@/lib/motion';

interface RecommendationPanelProps {
  className?: string;
  onActionClick?: (actionType: string, actionData: unknown) => void;
}

export function RecommendationPanel({ className = '', onActionClick }: RecommendationPanelProps) {
  const { instant, transition } = useMotionConfig();
  const { recommendations, isLoading, dismiss, click, recordFeedback } = useRecommendations();
  const [isExpanded, setIsExpanded] = useState(true);

  const handleClick = async (id: typeof recommendations[0]['_id']) => {
    const rec = recommendations.find((r) => r._id === id);
    if (rec) {
      await click(id);
      onActionClick?.(rec.actionType ?? 'default', rec.actionData);
    }
  };

  const handleFeedback = async (
    id: typeof recommendations[0]['_id'],
    action: "accepted" | "rejected",
    rating?: number,
    reason?: string
  ) => {
    await recordFeedback(id, action, rating, reason);
  };

  if (isLoading) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="motion-safe:animate-pulse space-y-3">
          <div className="h-4 bg-surface-secondary rounded w-1/3" />
          <div className="h-16 bg-surface-secondary rounded" />
          <div className="h-16 bg-surface-secondary rounded" />
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return null; // Don't show panel if no recommendations
  }

  return (
    <div className={`bg-surface rounded-lg border border-edge overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold text-content">Suggestions</span>
          <span className="text-xs text-content-secondary bg-surface-secondary px-1.5 py-0.5 rounded-full">
            {recommendations.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-content-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-content-muted" />
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: instant ? 'auto' : 0, opacity: instant ? 1 : 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: instant ? 'auto' : 0, opacity: instant ? 1 : 0 }}
            transition={transition(0.2)}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              <AnimatePresence mode="popLayout">
                {recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec._id}
                    id={rec._id}
                    type={rec.type}
                    priority={rec.priority}
                    message={rec.message}
                    actionLabel={rec.actionLabel}
                    icon={rec.icon ?? undefined}
                    onDismiss={dismiss}
                    onClick={handleClick}
                    onFeedback={handleFeedback}
                    showFeedback={true}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default RecommendationPanel;

