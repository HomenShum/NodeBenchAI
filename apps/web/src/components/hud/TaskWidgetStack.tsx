/**
 * TaskWidgetStack — Renders N minimized thread widgets stacked vertically.
 *
 * Each widget shows the thread's current action + status dot.
 * Click any widget to expand that thread's view.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotionConfig } from '@/lib/motion';
import { cn } from '../../lib/utils';
import type { ThreadEntry } from './useMultiThread';

interface TaskWidgetStackProps {
    threads: ThreadEntry[];
    onExpand: (threadId: string) => void;
    onClose: (threadId: string) => void;
    isMobile?: boolean;
}

export function TaskWidgetStack({ threads, onExpand, onClose, isMobile = false }: TaskWidgetStackProps) {
    const { instant, transition } = useMotionConfig();
    if (threads.length === 0) return null;

    return (
        <div
            className={cn(
                'fixed z-50 flex gap-2 pointer-events-auto',
                isMobile
                    ? 'left-1/2 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] -translate-x-1/2 w-[calc(100vw-1rem)] max-w-sm flex-col-reverse'
                    : 'top-4 left-4 flex-col',
            )}
            aria-label="Active tasks"
        >
            <AnimatePresence>
                {threads.map((thread, index) => (
                    <motion.div
                        key={thread.threadId}
                        layout
                        initial={instant ? { opacity: 0 } : { opacity: 0, x: -20, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={instant ? { opacity: 0 } : { opacity: 0, x: -20, scale: 0.95 }}
                        transition={transition({
                            type: 'spring',
                            stiffness: 300,
                            damping: 25,
                            delay: isMobile ? 0 : index * 0.05,
                        })}
                        onClick={() => onExpand(thread.threadId)}
                        className={cn(
                            isMobile ? 'w-full px-3 py-3' : 'w-64 px-3 py-2.5',
                            'rounded-xl border border-edge',
                            'bg-surface backdrop-blur-md cursor-pointer shadow-sm',
                            'flex items-center gap-2.5',
                            'hover:border-edge-strong hover:shadow-md',
                            'transition-[border-color,box-shadow] duration-200',
                        )}
                        whileHover={!instant && !isMobile ? { scale: 1.02 } : undefined}
                        whileTap={!instant ? { scale: 0.98 } : undefined}
                        role="button"
                        aria-label={`Expand task: ${thread.currentAction || 'Idle'}`}
                    >
                        {/* Status dot */}
                        <div className={cn(
                            'flex-shrink-0 w-1.5 h-1.5 rounded-full',
                            thread.status === 'streaming'
                                ? 'bg-primary motion-safe:animate-pulse'
                                : thread.status === 'done'
                                    ? 'bg-emerald-500'
                                    : thread.status === 'error'
                                        ? 'bg-red-500'
                                        : 'bg-content-muted',
                        )} />

                        {/* Action label */}
                        <span className="flex-1 text-xs text-content-secondary truncate">
                            {thread.currentAction || (thread.status === 'done' ? 'Done' : 'Idle')}
                        </span>

                        {/* Close button */}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onClose(thread.threadId); }}
                            className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-content-muted hover:text-red-500 transition-colors"
                            aria-label="Close task"
                        >
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                        </button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
