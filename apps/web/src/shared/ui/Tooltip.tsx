import React, { useState, useRef, useCallback } from "react";

type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: React.ReactNode;
  side?: TooltipSide;
  /** Show delay in ms (default 200) */
  delay?: number;
  children: React.ReactElement;
  /** Class for the tooltip popup */
  className?: string;
  /** Class for the wrapper span (e.g. "block w-full" for block layout) */
  wrapperClassName?: string;
}

const sideStyles: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * Tooltip — zero-dependency, CSS-positioned tooltip.
 * Inverted colors for contrast. 200ms show delay, 0ms hide.
 */
export function Tooltip({ content, side = "top", delay = 200, children, className, wrapperClassName }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <span className={`relative inline-flex ${wrapperClassName ?? ""}`} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`absolute z-toast pointer-events-none whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium bg-content text-surface shadow-lg ${sideStyles[side]} ${className ?? ""}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
