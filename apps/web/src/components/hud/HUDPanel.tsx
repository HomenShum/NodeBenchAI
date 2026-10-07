/**
 * HUDPanel — Composable panel wrapper with subtle entrance animation.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useMotionConfig } from '@/lib/motion';
import { cn } from '../../lib/utils';

interface HUDPanelProps {
    children: React.ReactNode;
    /** Optional header label. */
    title?: string;
    /** Additional className. */
    className?: string;
}

export function HUDPanel({
    children,
    title,
    className = '',
}: HUDPanelProps) {
    const { instant, transition } = useMotionConfig();
    return (
        <motion.div
            initial={instant ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={transition({ type: 'spring', stiffness: 200, damping: 25 })}
            className={cn(
                'relative overflow-hidden rounded-lg',
                'bg-surface/80 backdrop-blur-md',
                'border border-edge/40',
                className,
            )}
        >
            {title && (
                <div className="px-4 py-2 border-b border-edge/30">
                    <span className="text-xs font-semibold text-content-secondary">
                        {title}
                    </span>
                </div>
            )}
            <div className="relative z-[1]">{children}</div>
        </motion.div>
    );
}
