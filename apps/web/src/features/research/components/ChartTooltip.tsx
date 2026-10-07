"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, FileText } from "lucide-react";
import { useMotionConfig } from '@/lib/motion';

export interface TooltipEvidence {
  id: string;
  title: string;
  source?: string;
  url?: string;
}

export interface TooltipData {
  id: string;
  title: string;
  description: string;
  position?: { x: number; y: number };
  kicker?: string; // Optional category/type label
  sentiment?: "positive" | "negative" | "neutral";
  /** Linked evidence items to display in tooltip */
  linkedEvidence?: TooltipEvidence[];
}

interface TooltipProps {
  active: boolean;
  data: TooltipData | null;
  /** Callback when user clicks "scroll to evidence" */
  onEvidenceClick?: (evidenceId: string) => void;
}

/**
 * Enhanced ChartTooltip matching AI 2027 reference
 * Features: Dark slate/blue-gray background, rich content structure, evidence links
 */
export const ChartTooltip = ({ active, data, onEvidenceClick }: TooltipProps) => {
  const { instant, transition } = useMotionConfig();
  if (!data) return null;

  // Sentiment-based accent colors (AI 2027 style)
  const sentimentColors = {
    positive: {
      bg: "bg-slate-900/95",
      accent: "bg-indigo-400",
      accentText: "text-indigo-400",
      border: "border-indigo-500/30",
      glow: "shadow-[0_0_8px_rgba(52,211,153,0.5)]",
    },
    negative: {
      bg: "bg-slate-900/95",
      accent: "bg-red-400",
      accentText: "text-red-400",
      border: "border-red-500/30",
      glow: "shadow-[0_0_8px_rgba(248,113,113,0.5)]",
    },
    neutral: {
      bg: "bg-slate-900/95",
      accent: "bg-blue-400",
      accentText: "text-blue-400",
      border: "border-blue-500/30",
      glow: "shadow-[0_0_8px_rgba(96,165,250,0.5)]",
    },
  };

  const colors = sentimentColors[data.sentiment || "neutral"];
  const position = data.position || { x: 50, y: 50 };

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, scale: instant ? 1 : 0.95, y: instant ? 0 : 10, x: "-50%" }}
          animate={{ opacity: 1, scale: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, scale: instant ? 1 : 0.95 }}
          transition={transition({ duration: 0.2, ease: "easeOut" })}
          className="absolute z-50 pointer-events-none w-72"
          style={{
            left: `${position.x}%`,
            top: `${position.y}%`,
            marginTop: "-160px",
          }}
        >
          {/* Main tooltip container - Dark slate per AI 2027 */}
          <div className={`
            ${colors.bg} text-white p-4 rounded-lg shadow-2xl
            ${colors.border} border 
            relative overflow-hidden
          `}>
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />

            {/* Header with indicator dot and kicker */}
            <div className="relative flex items-center gap-2 mb-2">
              <motion.div
                animate={!instant ? { scale: [1, 1.2, 1] } : undefined}
                transition={transition({ duration: 2, repeat: Infinity })}
                className={`w-2 h-2 rounded-full ${colors.accent} ${colors.glow}`}
              />
              <span className={`font-mono text-xs font-bold ${colors.accentText}/80`}>
                {data.kicker || "Intel Log"}
              </span>
            </div>

            {/* Title */}
            <h4 className="relative font-bold text-sm mb-2 text-white leading-tight">
              {data.title}
            </h4>

            {/* Description body - font-sans per spec */}
            <p className="relative font-sans text-xs leading-relaxed text-slate-300">
              {data.description}
            </p>

            {/* Evidence links section */}
            {data.linkedEvidence && data.linkedEvidence.length > 0 && (
              <div className="relative mt-3 pt-2 border-t border-slate-700/50">
                <div className="flex items-center gap-1 mb-1.5">
                  <FileText size={10} className={colors.accentText} />
                  <span className="font-mono text-[10px] tracking-wide text-slate-400">
                    Sources ({data.linkedEvidence.length})
                  </span>
                </div>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {data.linkedEvidence.slice(0, 3).map((ev, idx) => (
                    <button
                      key={`${ev.id}-${idx}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEvidenceClick?.(ev.id);
                      }}
                      className="w-full text-left group flex items-start gap-1.5 pointer-events-auto hover:bg-slate-800/50 rounded px-1 py-0.5 transition-colors"
                    >
                      <ExternalLink size={9} className="text-slate-500 mt-0.5 shrink-0 group-hover:text-blue-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-200 truncate group-hover:text-blue-300 transition-colors">
                          {ev.title}
                        </p>
                        {ev.source && (
                          <p className="text-[10px] text-slate-500 truncate">
                            {ev.source}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                  {data.linkedEvidence.length > 3 && (
                    <p className="text-xs text-slate-500 italic pl-1">
                      +{data.linkedEvidence.length - 3} more...
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Bottom accent line */}
            <motion.div
              initial={{ scaleX: instant ? 1 : 0 }}
              animate={{ scaleX: 1 }}
              transition={transition({ delay: 0.1, duration: 0.3 })}
              className={`absolute bottom-0 left-0 right-0 h-0.5 ${colors.accent}/50 origin-left`}
            />
          </div>

          {/* Arrow pointing down (to the data point below) */}
          <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-slate-900/95 mx-auto mt-[-1px]" />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ChartTooltip;
