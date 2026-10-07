import React, { ReactNode } from "react";

interface TopDividerBarProps {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
  noBorder?: boolean;
}

/**
 * Standardized thin top bar with a bottom divider and compact spacing.
 * Keeps visual parity across Home Hubs.
 */
export function TopDividerBar({ left, right, className, noBorder }: TopDividerBarProps) {
  return (
    <div className={[
      "flex items-center justify-between pb-2 mb-3",
      noBorder ? "" : "border-b border-edge",
      className ?? "",
    ].join(" ").trim()}>
      <div className="min-w-0 flex items-center gap-2">{left}</div>
      <div className="min-w-0 flex items-center gap-2">{right}</div>
    </div>
  );
}

