/**
 * FeedbackWidget — Floating feedback button + compact form.
 *
 * Bottom-right corner, terracotta accent, glass card DNA.
 * Stores to localStorage via useFeedbackStore. No backend required.
 */

import { memo, useState, useCallback, useRef } from "react";
import {
  useFeedbackStore,
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
} from "../hooks/useFeedbackStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ai-ui/popover";
import { toast } from "sonner";

// ── Star rating component ────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hover || value);
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === value}
            aria-label={`${star} star${star > 1 ? "s" : ""}`}
            className="p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary rounded"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill={filled ? "#d97757" : "none"}
              stroke={filled ? "#d97757" : "currentColor"}
              strokeWidth="1.5"
              className={`transition-colors ${filled ? "" : "text-content-muted/50"}`}
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

export const FeedbackWidget = memo(function FeedbackWidget() {
  const { submitFeedback } = useFeedbackStore();
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("Other");
  const inputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setRating(0);
    setComment("");
    setCategory("Other");
  }, []);

  const handleSubmit = useCallback(() => {
    if (rating === 0) return; // Require at least a rating
    submitFeedback({ rating, comment, category });
    resetForm();
    setIsOpen(false);
    toast.success("Thanks for your feedback!");
  }, [rating, comment, category, submitFeedback, resetForm]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      {/* Floating button */}
      <PopoverTrigger asChild>
      <button
        type="button"
        className={`
          fixed bottom-12 right-4 z-40
          flex items-center justify-center
          w-10 h-10 rounded-full
          border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl
          shadow-lg transition-all duration-200
          hover:bg-accent-primary/20 hover:border-accent-primary/30 hover:scale-105
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary
          ${isOpen ? "bg-accent-primary/20 border-accent-primary/30" : ""}
        `}
        aria-label={isOpen ? "Close feedback form" : "Send feedback"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97757" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      </PopoverTrigger>

      {/* Feedback form */}
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-40 w-72 rounded-xl border border-white/[0.06] bg-[rgba(20,22,28,0.95)] p-0 backdrop-blur-2xl shadow-2xl"
          role="dialog"
          aria-label="Feedback form"
          aria-modal="false"
        >
          <div className="p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-content">
                Share feedback
              </h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-content-muted hover:bg-white/[0.06] hover:text-content transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Star rating */}
            <div>
              <label className="block text-[11px] uppercase tracking-[0.2em] text-content-muted mb-1.5">
                Rating
              </label>
              <StarRating value={rating} onChange={setRating} />
            </div>

            {/* Comment */}
            <div>
              <label
                htmlFor="feedback-comment"
                className="block text-[11px] uppercase tracking-[0.2em] text-content-muted mb-1.5"
              >
                What could be better?
              </label>
              <input
                ref={inputRef}
                id="feedback-comment"
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Quick thought..."
                maxLength={500}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] text-content placeholder:text-content-muted/40 focus:outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-[#d97757]/20 transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && rating > 0) {
                    handleSubmit();
                  }
                }}
              />
            </div>

            {/* Category */}
            <div>
              <label
                htmlFor="feedback-category"
                className="block text-[11px] uppercase tracking-[0.2em] text-content-muted mb-1.5"
              >
                Category
              </label>
              <select
                id="feedback-category"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as FeedbackCategory)
                }
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] text-content focus:outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-[#d97757]/20 transition-colors appearance-none cursor-pointer"
              >
                {FEEDBACK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat} className="bg-[#14161c] text-content">
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={rating === 0}
              className="w-full rounded-lg bg-accent-primary px-3 py-2 text-[13px] font-medium text-white transition-all hover:bg-accent-primary/90 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#14161c]"
            >
              Submit
            </button>
          </div>
        </PopoverContent>
    </Popover>
  );
});
