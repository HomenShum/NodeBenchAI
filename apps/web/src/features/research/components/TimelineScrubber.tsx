"use client";

import React from "react";
import ActProgressIndicator, { ActId } from "./ActProgressIndicator";

interface TimelineScrubberProps {
  totalSections: number;
  activeIndex: number;
  currentAct: ActId;
  onScrubToSection?: (index: number) => void;
  className?: string;
}

const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  totalSections,
  activeIndex,
  currentAct,
  onScrubToSection,
  className = "",
}) => {
  if (totalSections <= 0) {
    return null;
  }

  if (totalSections === 1) {
    return (
      <div className={className}>
        <ActProgressIndicator currentAct={currentAct} />
      </div>
    );
  }

  const clampedActive = Math.max(0, Math.min(activeIndex, totalSections - 1));
  const progressPercent =
    totalSections > 1 ? (clampedActive / (totalSections - 1)) * 100 : 100;

  return (
    <div className={`space-y-2 ${className}`}>
      <ActProgressIndicator
        currentAct={currentAct}
        onActChange={(act) => {
          if (!onScrubToSection) return;
          let targetIndex = 0;
          if (act === "actII") {
            targetIndex = Math.round((totalSections - 1) / 2);
          } else if (act === "actIII") {
            targetIndex = totalSections - 1;
          }
          onScrubToSection(targetIndex);
        }}
      />
      <div className="rounded-lg border border-edge bg-surface/90 px-3 py-2 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold tracking-wide text-content">
            Timeline
          </span>
          <span className="text-xs text-content-secondary">
            {clampedActive + 1} / {totalSections}
          </span>
        </div>
        <div className="relative mt-1 h-8">
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-secondary" />
          <div
            className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-content transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
          {Array.from({ length: totalSections }).map((_, index) => {
            const position =
              totalSections === 1
                ? 0
                : (index / (totalSections - 1)) * 100;
            const isActive = index === clampedActive;
            return (
              <button
                key={index}
                type="button"
                onClick={() => onScrubToSection?.(index)}
                className="absolute -translate-x-1/2 flex flex-col items-center gap-0.5 focus:outline-none"
                style={{ left: `${position}%`, top: "4px" }}
                aria-label={`Go to section ${index + 1}`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full border ${
                    isActive
                      ? "bg-content border-[color:var(--text-primary)]"
                      : "bg-surface border-edge hover:bg-surface-hover"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TimelineScrubber;
