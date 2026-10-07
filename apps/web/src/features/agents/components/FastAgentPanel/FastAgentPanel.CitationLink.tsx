// src/components/FastAgentPanel/FastAgentPanel.CitationLink.tsx
// Interactive citation links that highlight and scroll to referenced tasks

import React, { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CitationLinkProps {
  taskId: string;
  taskName?: string;
  onHover?: (taskId: string | null) => void;
  onClick?: (taskId: string) => void;
  children?: React.ReactNode;
}

/**
 * CitationLink - Interactive citation that highlights and scrolls to task
 * Provides navigation from synthesis back to specific task results
 */
export function CitationLink({
  taskId,
  taskName,
  onHover,
  onClick,
  children,
}: CitationLinkProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);
    onHover?.(taskId);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    onHover?.(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onClick?.(taskId);
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded",
        "text-xs font-medium transition-all",
        "border border-blue-300 bg-blue-50 text-blue-700",
        "hover:bg-blue-100 hover:border-blue-400",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        isHovered && "scale-105"
      )}
      title={taskName ? `Jump to: ${taskName}` : 'Jump to task'}
    >
      {children || (
        <>
          <span>See Task</span>
          <ArrowUp className="h-3 w-3" />
        </>
      )}
    </button>
  );
}
