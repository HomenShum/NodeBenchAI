/**
 * useReducedMotion — Unified reduced-motion gate
 *
 * Combines the OS `prefers-reduced-motion` media query with
 * the user's in-app `themeReducedMotion` preference.
 *
 * All HUD/cinematic animation hooks should gate on this.
 *
 * @example
 * const reduced = useReducedMotion();
 * if (reduced) return null; // skip particle effect
 */

import { useState, useEffect } from 'react';

/** Read the user's in-app reduced-motion toggle from localStorage (no Convex dependency). */
function readAppPreference(): boolean {
    try {
        const raw = localStorage.getItem('nodebench-theme');
        if (raw) {
            const parsed = JSON.parse(raw);
            return !!parsed.reducedMotion;
        }
    } catch {
        // noop
    }
    return false;
}

export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        return osReduced || readAppPreference();
    });

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

        const update = () => {
            setReduced(mq.matches || readAppPreference());
        };

        // OS-level change
        mq.addEventListener('change', update);

        // In-app toggle (ThemeContext writes to localStorage → fires 'storage' in same tab via custom event)
        const onStorage = () => update();
        window.addEventListener('storage', onStorage);

        // Also listen for the custom 'nodebench-theme-change' event
        // that ThemeProvider can optionally dispatch for same-tab reactivity.
        window.addEventListener('nodebench-theme-change', onStorage);

        return () => {
            mq.removeEventListener('change', update);
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('nodebench-theme-change', onStorage);
        };
    }, []);

    return reduced;
}
