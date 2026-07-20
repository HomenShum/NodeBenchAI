/**
 * CursorGlow — Full-viewport radial gradient that follows the mouse.
 * Uses subtle neutral/primary tint instead of cyan.
 * Auto-disables on reduced motion.
 */

import React, { useRef, useEffect } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface CursorGlowProps {
    radius?: number;
    color?: string;
    intensity?: number;
    className?: string;
}

export function CursorGlow({
    radius = 450,
    color = 'var(--color-primary, rgba(99, 102, 241, 1))',
    intensity = 0.06,
    className = '',
}: CursorGlowProps) {
    const reduced = useReducedMotion();
    const glowRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        if (reduced || !glowRef.current) return;

        const el = glowRef.current;

        const onMove = (e: MouseEvent) => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                el.style.setProperty('--glow-x', `${e.clientX}px`);
                el.style.setProperty('--glow-y', `${e.clientY}px`);
            });
        };

        window.addEventListener('mousemove', onMove, { passive: true });

        return () => {
            window.removeEventListener('mousemove', onMove);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [reduced]);

    if (reduced) return null;

    return (
        <div
            ref={glowRef}
            className={className}
            aria-hidden="true"
            style={{
                position: 'fixed',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 9998,
                opacity: intensity,
                mixBlendMode: 'screen',
                background: `radial-gradient(${radius}px circle at var(--glow-x, 50%) var(--glow-y, 50%), ${color}, transparent 70%)`,
                transition: 'opacity 0.3s ease',
            }}
        />
    );
}
