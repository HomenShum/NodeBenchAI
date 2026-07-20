import React, { ButtonHTMLAttributes, ReactNode } from "react";

export interface PresetChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * Small bordered chip-style button used in hero headers for preset actions.
 */
export function PresetChip({ children, className, ...props }: PresetChipProps) {
  const base = "px-2 py-1 text-xs border border-edge rounded-md hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <button className={[base, className ?? ""].join(" ").trim()} {...props}>
      {children}
    </button>
  );
}

