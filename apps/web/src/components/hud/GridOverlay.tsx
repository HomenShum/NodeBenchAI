/**
 * GridOverlay — Subtle animated dot/grid/line background pattern.
 * Uses currentColor with low opacity for theme-neutral appearance.
 */

import React from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type PatternType = 'dots' | 'grid' | 'lines';

interface GridOverlayProps {
    pattern?: PatternType;
    opacity?: number;
    size?: number;
    animate?: boolean;
    className?: string;
}

const patternStyles: Record<PatternType, (size: number) => React.CSSProperties> = {
    dots: (size) => ({
        backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
    }),
    grid: (size) => ({
        backgroundImage: `
      linear-gradient(currentColor 1px, transparent 1px),
      linear-gradient(90deg, currentColor 1px, transparent 1px)
    `,
        backgroundSize: `${size}px ${size}px`,
    }),
    lines: (size) => ({
        backgroundImage: `linear-gradient(currentColor 1px, transparent 1px)`,
        backgroundSize: `100% ${size}px`,
    }),
};

export function GridOverlay({
    pattern = 'dots',
    opacity = 0.04,
    size = 30,
    animate = true,
    className = '',
}: GridOverlayProps) {
    const reduced = useReducedMotion();
    const shouldAnimate = animate && !reduced;

    return (
        <div
            aria-hidden="true"
            className={className}
            style={{
                position: 'fixed',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 0,
                opacity,
                color: 'var(--color-content-muted, #94a3b8)',
                ...patternStyles[pattern](size),
                ...(shouldAnimate
                    ? { animation: 'grid-drift 60s linear infinite' }
                    : {}),
            }}
        />
    );
}

export function GridOverlayStyles() {
    return (
        <style>{`
      @keyframes grid-drift {
        from { background-position: 0 0; }
        to { background-position: 60px 60px; }
      }
    `}</style>
    );
}
