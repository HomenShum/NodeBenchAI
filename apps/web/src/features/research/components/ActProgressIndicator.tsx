"use client";

import React from "react";

export type ActId = "actI" | "actII" | "actIII";

interface ActProgressIndicatorProps {
  currentAct: ActId;
  onActChange?: (act: ActId) => void;
  className?: string;
}

const ACTS: { id: ActId; label: string; subtitle: string }[] = [
  { id: "actI", label: "Quick Pulse", subtitle: "Composition" },
  { id: "actII", label: "Analysis", subtitle: "Change" },
  { id: "actIII", label: "Deep Dive", subtitle: "Decision" },
];

const ActProgressIndicator: React.FC<ActProgressIndicatorProps> = ({
  currentAct,
  onActChange,
  className = "",
}) => {
  const activeIndex = ACTS.findIndex((act) => act.id === currentAct);
  const safeIndex = activeIndex === -1 ? 0 : activeIndex;
  const progressPercent =
    ACTS.length > 1 ? (safeIndex / (ACTS.length - 1)) * 100 : 100;

  return (
    <div
      className={`rounded-lg border border-edge bg-[#fbfaf2]/90 px-3 py-2 shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold tracking-wide text-content">
          Research Depth
        </span>
        <span className="text-xs text-content-secondary">
          {ACTS[safeIndex]?.label ?? "Quick Pulse"}
        </span>
      </div>
      <div className="mt-1">
        {/* Progress bar */}
        <div className="relative h-1.5 w-full rounded-full bg-surface-secondary overflow-hidden">
          <div
            className="h-full rounded-full bg-gray-900 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {/* Act markers */}
        <div className="mt-2 flex items-center justify-between">
          {ACTS.map((act) => {
            const isActive = act.id === currentAct;
            return (
              <button
                key={act.id}
                type="button"
                onClick={() => onActChange?.(act.id)}
                className="group flex flex-col items-center gap-0.5 focus:outline-none"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive
                      ? "bg-gray-900"
                      : "bg-content-secondary group-hover:bg-content"
                  }`}
                />
                <span
                  className={`text-xs font-medium ${
                    isActive ? "text-content" : "text-content-secondary"
                  }`}
                >
                  {act.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ActProgressIndicator;
