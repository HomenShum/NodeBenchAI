/**
 * EmptyState — Illustrated empty states for various scenarios.
 *
 * PURPOSE (for other coding agents):
 * Provides animated SVG illustrations for empty/zero-data states.
 * All colors use CSS custom properties with sensible defaults so
 * consumers can theme illustrations via a parent selector:
 *
 *   --empty-fill:           Surface fill (default: stone-100)
 *   --empty-stroke:         Border/divider stroke (default: stone-300)
 *   --empty-muted:          Text/icon muted fill (default: stone-400)
 *   --empty-bg:             Checkbox/element background (default: white)
 *   --empty-success:        Success accent (default: emerald-500)
 *   --empty-success-soft:   Success background (default: emerald-50)
 *   --empty-success-border: Success border (default: emerald-300)
 *   --empty-error:          Error accent (default: red-500)
 *   --empty-error-soft:     Error background (default: red-50)
 *   --empty-error-border:   Error border (default: red-300)
 *
 * OPEN-SOURCE NOTES (for other coding agents):
 * Zero hardcoded hex colors in SVGs — all themeable via CSS vars.
 * Peer deps: react, framer-motion.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { SignatureOrb } from '../../shared/ui/SignatureOrb';
import { useMotionConfig } from '@/lib/motion';

type EmptyStateVariant = 'documents' | 'search' | 'inbox' | 'tasks' | 'error' | 'success' | 'orb';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

function getIllustrations(instant: boolean): Record<Exclude<EmptyStateVariant, 'orb'>, React.ReactNode> {
  return {
    documents: (
      <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
        <motion.rect
          x="25" y="20" width="70" height="85" rx="4"
          fill="var(--empty-fill, #f5f5f4)" stroke="var(--empty-stroke, #d6d3d1)" strokeWidth="2"
          initial={instant ? { y: 0, opacity: 1 } : { y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.1 }}
        />
        <motion.rect
          x="35" y="35" width="40" height="4" rx="2"
          fill="var(--empty-muted, #a8a29e)"
          initial={instant ? { scaleX: 1 } : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.3 }}
        />
        <motion.rect
          x="35" y="45" width="50" height="3" rx="1.5"
          fill="var(--empty-stroke, #d6d3d1)"
          initial={instant ? { scaleX: 1 } : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.4 }}
        />
        <motion.rect
          x="35" y="53" width="45" height="3" rx="1.5"
          fill="var(--empty-stroke, #d6d3d1)"
          initial={instant ? { scaleX: 1 } : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.5 }}
        />
        <motion.rect
          x="35" y="61" width="35" height="3" rx="1.5"
          fill="var(--empty-stroke, #d6d3d1)"
          initial={instant ? { scaleX: 1 } : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.6 }}
        />
        <motion.circle
          cx="90" cy="90" r="20"
          fill="var(--empty-success, #10b981)" fillOpacity="0.1"
          stroke="var(--empty-success, #10b981)" strokeWidth="2"
          initial={instant ? { scale: 1 } : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.5, type: 'spring' }}
        />
        <motion.path
          d="M82 90L88 96L98 84"
          stroke="var(--empty-success, #10b981)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          fill="none"
          initial={instant ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.7, duration: 0.4 }}
        />
      </svg>
    ),
    search: (
      <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
        <motion.circle
          cx="50" cy="50" r="30"
          fill="var(--empty-fill, #f5f5f4)" stroke="var(--empty-stroke, #d6d3d1)" strokeWidth="3"
          initial={instant ? { scale: 1, opacity: 1 } : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={instant ? { duration: 0 } : { type: 'spring' }}
        />
        <motion.line
          x1="72" y1="72" x2="100" y2="100"
          stroke="var(--empty-muted, #a8a29e)" strokeWidth="6" strokeLinecap="round"
          initial={instant ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.3 }}
        />
        <motion.text
          x="50" y="55" textAnchor="middle"
          fill="var(--empty-muted, #a8a29e)" fontSize="24" fontWeight="300"
          initial={instant ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.4 }}
        >
          ?
        </motion.text>
      </svg>
    ),
    inbox: (
      <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
        <motion.path
          d="M20 50L60 20L100 50V95C100 97.7614 97.7614 100 95 100H25C22.2386 100 20 97.7614 20 95V50Z"
          fill="var(--empty-fill, #f5f5f4)" stroke="var(--empty-stroke, #d6d3d1)" strokeWidth="2"
          initial={instant ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={instant ? { duration: 0 } : undefined}
        />
        <motion.path
          d="M20 50L60 75L100 50"
          stroke="var(--empty-stroke, #d6d3d1)" strokeWidth="2"
          fill="none"
          initial={instant ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.3 }}
        />
        <motion.circle
          cx="60" cy="60" r="8"
          fill="var(--empty-muted, #a8a29e)"
          initial={instant ? { scale: 1 } : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.5, type: 'spring' }}
        />
      </svg>
    ),
    tasks: (
      <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
        <motion.rect
          x="20" y="25" width="80" height="70" rx="6"
          fill="var(--empty-fill, #f5f5f4)" stroke="var(--empty-stroke, #d6d3d1)" strokeWidth="2"
          initial={instant ? { scale: 1, opacity: 1 } : { scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={instant ? { duration: 0 } : undefined}
        />
        {[40, 55, 70].map((y, i) => (
          <React.Fragment key={y}>
            <motion.rect
              x="30" y={y} width="12" height="12" rx="3"
              fill="var(--empty-bg, white)" stroke="var(--empty-stroke, #d6d3d1)" strokeWidth="2"
              initial={instant ? { scale: 1 } : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={instant ? { duration: 0 } : { delay: 0.2 + i * 0.1 }}
            />
            <motion.rect
              x="50" y={y + 4} width={40 - i * 8} height="4" rx="2"
              fill="var(--empty-stroke, #d6d3d1)"
              initial={instant ? { scaleX: 1 } : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={instant ? { duration: 0 } : { delay: 0.3 + i * 0.1 }}
            />
          </React.Fragment>
        ))}
      </svg>
    ),
    error: (
      <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
        <motion.circle
          cx="60" cy="60" r="40"
          fill="var(--empty-error-soft, #fef2f2)" stroke="var(--empty-error-border, #fca5a5)" strokeWidth="3"
          initial={instant ? { scale: 1 } : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={instant ? { duration: 0 } : { type: 'spring' }}
        />
        <motion.path
          d="M45 45L75 75M75 45L45 75"
          stroke="var(--empty-error, #ef4444)" strokeWidth="4" strokeLinecap="round"
          initial={instant ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.3, duration: 0.4 }}
        />
      </svg>
    ),
    success: (
      <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
        <motion.circle
          cx="60" cy="60" r="40"
          fill="var(--empty-success-soft, #ecfdf5)" stroke="var(--empty-success-border, #6ee7b7)" strokeWidth="3"
          initial={instant ? { scale: 1 } : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={instant ? { duration: 0 } : { type: 'spring' }}
        />
        <motion.path
          d="M40 60L55 75L80 45"
          stroke="var(--empty-success, #10b981)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
          fill="none"
          initial={instant ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={instant ? { duration: 0 } : { delay: 0.3, duration: 0.5 }}
        />
      </svg>
    ),
  };
}

export function EmptyState({
  variant = 'documents',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const { instant, transition } = useMotionConfig();
  const illustrations = getIllustrations(instant);

  return (
    <motion.div
      initial={instant ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition(0.3)}
      className={cn(
        'flex flex-col items-center justify-center py-6 sm:py-12 px-4 sm:px-6 text-center',
        className
      )}
    >
      {variant === 'orb' ? (
        <div className="mb-4">
          <SignatureOrb variant="empty" />
        </div>
      ) : (
        <div className="w-20 h-20 sm:w-32 sm:h-32 mb-4 sm:mb-6">
          {illustrations[variant]}
        </div>
      )}

      <h3 className="text-lg font-semibold text-content mb-2">{title}</h3>

      {description && (
        <p className="text-sm text-content-secondary max-w-[min(100%-2rem,24rem)] break-words mb-4 sm:mb-6">{description}</p>
      )}

      {action && (
        <motion.button
          whileHover={!instant ? { scale: 1.02 } : undefined}
          whileTap={!instant ? { scale: 0.98 } : undefined}
          onClick={action.onClick}
          className="px-5 py-2.5 bg-content text-surface text-sm font-medium rounded-lg hover:bg-content/90 transition-colors shadow-sm"
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}

export default EmptyState;
