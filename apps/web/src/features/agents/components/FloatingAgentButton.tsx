/**
 * FloatingAgentButton - Universal FAB for triggering the Fast Agent
 * 
 * A floating action button that appears on pages without the sidebar
 * (like ResearchHub) to give users one-click access to the AI agent.
 * 
 * Features:
 * - Animated slide-in from bottom
 * - Pulses gently to attract attention
 * - Hides when agent panel is open
 * - Can be positioned in different corners
 */

import React from 'react';
import { Sparkles, MessageCircle, Zap } from 'lucide-react';
import { useFastAgent } from '../context/FastAgentContext';

interface FloatingAgentButtonProps {
  /** Position of the button */
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
  /** Custom label (default: "Ask Agent") */
  label?: string;
  /** Whether to show the label (default: true on desktop) */
  showLabel?: boolean;
  /** Custom class name */
  className?: string;
}

export const FloatingAgentButton: React.FC<FloatingAgentButtonProps> = ({
  position = 'bottom-right',
  label = 'Ask Agent',
  showLabel = true,
  className = '',
}) => {
  const { toggle, isOpen } = useFastAgent();

  // Hide when agent is open
  if (isOpen) return null;

  const positionClasses = {
    'bottom-right': 'right-6 bottom-6',
    'bottom-left': 'left-6 bottom-6',
    'bottom-center': 'left-1/2 -translate-x-1/2 bottom-6',
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`
        fixed z-[100] flex items-center gap-2.5
        px-5 py-3
        bg-content
        text-surface rounded-full
        shadow-2xl shadow-black/25
        hover:shadow-purple-500/20
        active:scale-95
        transition-all duration-300 ease-out
        animate-in slide-in-from-bottom-4 fade-in duration-500
        group
        lg:hidden
        ${positionClasses[position]}
        ${className}
      `}
      aria-label="Open AI Agent"
    >
      {/* Animated icon */}
      <div className="relative" aria-hidden="true">
        <Sparkles className="w-5 h-5 text-purple-400 group-hover:text-purple-300 transition-colors" />
        {/* Subtle pulse effect */}
        <div className="absolute inset-0 bg-purple-500/30 rounded-full motion-safe:animate-ping" style={{ animationDuration: '2s' }} />
      </div>

      {/* Label - hidden on mobile by default */}
      {showLabel && (
        <span className="font-medium text-sm hidden sm:inline">
          {label}
        </span>
      )}

      {/* Keyboard shortcut hint */}
      <kbd className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-white/10 rounded border border-edge text-white/60">
        ⌘K
      </kbd>
    </button>
  );
};

/**
 * Compact version - just an icon, for minimalist UIs
 */
export const FloatingAgentIcon: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { toggle, isOpen } = useFastAgent();

  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      className={`
        fixed right-6 bottom-6 z-[100]
        p-4
        bg-gradient-to-br from-purple-600 to-indigo-700
        text-white rounded-full
        shadow-xl shadow-purple-500/30
        hover:shadow-purple-500/50
        active:scale-95
        transition-all duration-200
        animate-in zoom-in duration-300
        lg:hidden
        ${className}
      `}
      aria-label="Open AI Agent"
    >
      <Zap className="w-6 h-6" aria-hidden="true" />
    </button>
  );
};

export default FloatingAgentButton;

