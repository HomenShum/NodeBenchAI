import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Lightbulb, FileText, Users, Bell, Sparkles, ChevronRight, ThumbsUp, ThumbsDown, Star } from 'lucide-react';
import { Id } from '../../../../convex/_generated/dataModel';
import { useMotionConfig } from '@/lib/motion';

interface RecommendationCardProps {
  id: Id<"recommendations">;
  type: "pattern" | "idle_content" | "collaboration" | "external_trigger" | "smart_suggestion";
  priority: "high" | "medium" | "low";
  message: string;
  actionLabel: string;
  icon?: string;
  onDismiss: (id: Id<"recommendations">) => void;
  onClick: (id: Id<"recommendations">) => void;
  onFeedback?: (id: Id<"recommendations">, action: "accepted" | "rejected", rating?: number, reason?: string) => void;
  showFeedback?: boolean;
}

const typeIcons = {
  pattern: Lightbulb,
  idle_content: FileText,
  collaboration: Users,
  external_trigger: Bell,
  smart_suggestion: Sparkles,
};

const priorityColors = {
  high: 'border-l-red-500 bg-red-50',
  medium: 'border-l-amber-500 bg-amber-50',
  low: 'border-l-blue-500 bg-blue-50',
};

export const RecommendationCard = React.memo(function RecommendationCard({
  id,
  type,
  priority,
  message,
  actionLabel,
  onDismiss,
  onClick,
  onFeedback,
  showFeedback = true,
}: RecommendationCardProps) {
  const { instant, transition } = useMotionConfig();
  const Icon = typeIcons[type] || Lightbulb;
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);

  const handleAccept = () => {
    setFeedbackGiven(true);
    setShowRating(true);
  };

  const handleReject = (reason?: string) => {
    setFeedbackGiven(true);
    onFeedback?.(id, "rejected", undefined, reason);
    // Auto-dismiss after reject
    setTimeout(() => onDismiss(id), 1500);
  };

  const handleRatingSubmit = () => {
    onFeedback?.(id, "accepted", rating);
    onClick(id); // Proceed with the action
  };

  return (
    <motion.div
      initial={{ opacity: instant ? 1 : 0, x: instant ? 0 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: instant ? 1 : 0, x: instant ? 0 : -20 }}
      className={`relative rounded-lg border-l-4 p-3 shadow-sm ${priorityColors[priority]}`}
    >
      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(id);
        }}
        className="absolute top-2 right-2 p-1 rounded-full hover:bg-black/10 transition-colors"
        aria-label="Dismiss recommendation"
      >
        <X className="h-3.5 w-3.5 text-content-secondary" />
      </button>

      {/* Content */}
      <div className="flex items-start gap-3 pr-6">
        <div className="flex-shrink-0 mt-0.5">
          <Icon className="h-4 w-4 text-content-secondary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-content leading-snug">{message}</p>

          {!feedbackGiven && !showRating && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onClick(id)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                {actionLabel}
                <ChevronRight className="h-3 w-3" />
              </button>

              {/* Feedback buttons */}
              {showFeedback && onFeedback && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleAccept}
                    className="p-1.5 rounded hover:bg-green-100 transition-colors group"
                    title="This is helpful"
                    aria-label="Mark as helpful"
                  >
                    <ThumbsUp className="h-3.5 w-3.5 text-content-muted group-hover:text-green-600" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject("not_relevant")}
                    className="p-1.5 rounded hover:bg-red-100 transition-colors group"
                    title="Not relevant"
                    aria-label="Not relevant"
                  >
                    <ThumbsDown className="h-3.5 w-3.5 text-content-muted group-hover:text-red-600" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Rating prompt after accept */}
          {showRating && (
            <motion.div
              initial={{ opacity: instant ? 1 : 0, height: instant ? 'auto' : 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-3 p-2 bg-surface/50 dark:bg-white/[0.03] rounded border border-edge"
            >
              <p className="text-xs text-content-secondary mb-2">How helpful was this suggestion?</p>
              <div className="flex items-center gap-1 mb-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="p-0.5 transition-colors"
                    aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                    title={`${star} star${star > 1 ? 's' : ''}`}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        star <= rating
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'text-gray-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRatingSubmit}
                  disabled={rating === 0}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit & Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRating(false);
                    onClick(id);
                  }}
                  className="text-xs px-2 py-1 text-content-secondary hover:text-content"
                >
                  Skip
                </button>
              </div>
            </motion.div>
          )}

          {/* Feedback confirmation */}
          {feedbackGiven && !showRating && (
            <motion.div
              initial={{ opacity: instant ? 1 : 0 }}
              animate={{ opacity: 1 }}
              className="mt-2 text-xs text-content-secondary"
            >
              Thanks for your feedback!
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}, (prevProps, nextProps) =>
  prevProps.id === nextProps.id &&
  prevProps.priority === nextProps.priority &&
  prevProps.message === nextProps.message
);

export default RecommendationCard;

