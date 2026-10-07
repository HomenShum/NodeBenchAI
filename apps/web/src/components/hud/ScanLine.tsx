/**
 * ScanLine — Horizontal sweep animation on panel mount.
 * A single line that sweeps vertically, then fades out.
 */

import React, { useState, useEffect } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface ScanLineProps {
    duration?: number;
    color?: string;
    autoPlay?: boolean;
    onComplete?: () => void;
    className?: string;
}

export function ScanLine({
    duration = 800,
    color = 'var(--color-primary, rgba(99, 102, 241, 0.4))',
    autoPlay = true,
    onComplete,
    className = '',
}: ScanLineProps) {
    const reduced = useReducedMotion();
    const [visible, setVisible] = useState(autoPlay && !reduced);

    useEffect(() => {
        if (!visible) return;

        const timer = setTimeout(() => {
            setVisible(false);
            onComplete?.();
        }, duration + 300);

        return () => clearTimeout(timer);
    }, [visible, duration, onComplete]);

    if (reduced || !visible) return null;

    return (
        <div
            aria-hidden="true"
            className={className}
            style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                pointerEvents: 'none',
                zIndex: 10,
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: '1px',
                    background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
                    animation: `scan-sweep ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1) forwards`,
                }}
            />
            <style>{`
        @keyframes scan-sweep {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
        </div>
    );
}
