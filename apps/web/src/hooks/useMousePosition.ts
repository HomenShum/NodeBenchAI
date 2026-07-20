/**
 * useMousePosition — GPU-optimized mouse tracking
 *
 * Uses requestAnimationFrame throttling so consumers can read position
 * without causing excessive React re-renders.
 *
 * Two APIs:
 * 1. **Ref-based** (zero re-renders): read `posRef.current` in rAF loops
 * 2. **State-based** (~60fps updates): `{ x, y }` for React-driven effects
 *
 * Automatically disables when reduced-motion is active.
 *
 * @example
 * // Ref-based (best for CSS variable updates)
 * const { posRef } = useMousePosition();
 * useEffect(() => {
 *   const el = document.documentElement;
 *   const tick = () => {
 *     el.style.setProperty('--mouse-x', `${posRef.current.x}px`);
 *     el.style.setProperty('--mouse-y', `${posRef.current.y}px`);
 *     rafId = requestAnimationFrame(tick);
 *   };
 *   let rafId = requestAnimationFrame(tick);
 *   return () => cancelAnimationFrame(rafId);
 * }, []);
 *
 * // State-based (for React-driven effects)
 * const { x, y, normalizedX, normalizedY } = useMousePosition({ useState: true });
 */

import { useRef, useState as useReactState, useEffect, useCallback } from 'react';
import { useReducedMotion } from './useReducedMotion';

export interface MousePosition {
    /** Absolute X (px from viewport left) */
    x: number;
    /** Absolute Y (px from viewport top) */
    y: number;
    /** X normalized to 0–1 across viewport width */
    normalizedX: number;
    /** Y normalized to 0–1 across viewport height */
    normalizedY: number;
}

const ZERO: MousePosition = { x: 0, y: 0, normalizedX: 0, normalizedY: 0 };

interface UseMousePositionOptions {
    /** If true, returns reactive state (causes re-renders at ~60fps). Default false. */
    useState?: boolean;
    /** Throttle interval in ms. 0 = every rAF frame (~16ms). Default 0. */
    throttleMs?: number;
}

export function useMousePosition(options: UseMousePositionOptions = {}): MousePosition & {
    posRef: React.RefObject<MousePosition>;
} {
    const { useState: useStateMode = false, throttleMs = 0 } = options;
    const reduced = useReducedMotion();

    const posRef = useRef<MousePosition>({ ...ZERO });
    const rafRef = useRef<number>(0);
    const lastUpdateRef = useRef<number>(0);

    const [state, setState] = useReactState<MousePosition>({ ...ZERO });

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (reduced) return;

            const now = performance.now();
            if (throttleMs > 0 && now - lastUpdateRef.current < throttleMs) return;
            lastUpdateRef.current = now;

            // Cancel previous frame to collapse moves into a single frame
            if (rafRef.current) cancelAnimationFrame(rafRef.current);

            rafRef.current = requestAnimationFrame(() => {
                const vw = window.innerWidth || 1;
                const vh = window.innerHeight || 1;

                const next: MousePosition = {
                    x: e.clientX,
                    y: e.clientY,
                    normalizedX: e.clientX / vw,
                    normalizedY: e.clientY / vh,
                };

                posRef.current = next;

                if (useStateMode) {
                    setState(next);
                }
            });
        },
        [reduced, throttleMs, useStateMode],
    );

    useEffect(() => {
        if (reduced) return;

        window.addEventListener('mousemove', handleMouseMove, { passive: true });
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [handleMouseMove, reduced]);

    return {
        ...(useStateMode ? state : posRef.current),
        posRef: posRef as React.RefObject<MousePosition>,
    };
}
