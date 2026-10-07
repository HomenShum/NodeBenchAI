/**
 * useMouseProximity — Detects cursor distance from a target element
 *
 * Powers "cards sense your cursor" effects: glow-on-approach,
 * tilt-toward-mouse, proximity-based opacity, etc.
 *
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * const { distance, normalizedDistance, isNear } = useMouseProximity(ref, { radius: 200 });
 *
 * return (
 *   <div
 *     ref={ref}
 *     style={{ boxShadow: isNear ? `0 0 ${30 * (1 - normalizedDistance)}px rgba(99,102,241,0.4)` : 'none' }}
 *   />
 * );
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useReducedMotion } from './useReducedMotion';

export interface ProximityData {
    /** Euclidean distance from mouse to element center, in px */
    distance: number;
    /** Distance normalized to 0–1 within the radius (0 = touching, 1 = at edge) */
    normalizedDistance: number;
    /** True when the mouse is within `radius` of the element center */
    isNear: boolean;
    /** Mouse position relative to element center (-1 to 1 on each axis) */
    relativeX: number;
    relativeY: number;
}

interface UseMouseProximityOptions {
    /** Detection radius in pixels. Default 250. */
    radius?: number;
    /** Throttle interval in ms. Default 16 (~60fps). */
    throttleMs?: number;
}

const IDLE: ProximityData = {
    distance: Infinity,
    normalizedDistance: 1,
    isNear: false,
    relativeX: 0,
    relativeY: 0,
};

export function useMouseProximity(
    elementRef: React.RefObject<HTMLElement | null>,
    options: UseMouseProximityOptions = {},
): ProximityData {
    const { radius = 250, throttleMs = 16 } = options;
    const reduced = useReducedMotion();
    const [data, setData] = useState<ProximityData>(IDLE);
    const rafRef = useRef<number>(0);
    const lastRef = useRef<number>(0);

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (reduced || !elementRef.current) return;

            const now = performance.now();
            if (now - lastRef.current < throttleMs) return;
            lastRef.current = now;

            if (rafRef.current) cancelAnimationFrame(rafRef.current);

            rafRef.current = requestAnimationFrame(() => {
                const el = elementRef.current;
                if (!el) return;

                const rect = el.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;

                const dx = e.clientX - centerX;
                const dy = e.clientY - centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const isNear = distance <= radius;
                const normalizedDistance = Math.min(distance / radius, 1);

                // Relative position from -1 to 1 (for tilt calculations)
                const halfW = rect.width / 2 || 1;
                const halfH = rect.height / 2 || 1;
                const relativeX = Math.max(-1, Math.min(1, dx / halfW));
                const relativeY = Math.max(-1, Math.min(1, dy / halfH));

                setData({ distance, normalizedDistance, isNear, relativeX, relativeY });
            });
        },
        [reduced, elementRef, radius, throttleMs],
    );

    useEffect(() => {
        if (reduced) {
            setData(IDLE);
            return;
        }

        window.addEventListener('mousemove', handleMouseMove, { passive: true });
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [handleMouseMove, reduced]);

    return data;
}
