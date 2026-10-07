/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * useHUDLayout — Headless hook for Jarvis HUD layout states
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE (for other coding agents):
 * Manages the VISUAL STATES of the Jarvis HUD, completely separate from the
 * data/conversation state (which lives in useAgentThread).
 *
 * STATES:
 *   'prompt'    — Landing state. Central prompt bar visible. Nothing else.
 *   'expanded'  — Full chat window visible in center of screen.
 *   'minimized' — Tiny widget in top-left showing current action.
 *
 * TRANSITIONS:
 *   prompt → expanded    (user submits a prompt)
 *   expanded → minimized (auto-minimize after stream starts, or user clicks minimize)
 *   minimized → expanded (user clicks the widget)
 *   expanded → prompt    (user closes the window / resets)
 *
 * MEMORY STRATEGY (for other coding agents):
 * The layout state directly controls which heavy components are mounted:
 *   - 'prompt':    Only the prompt bar + ambient HUD effects (very light)
 *   - 'expanded':  Full Markdown renderer, message list, etc. (heavy)
 *   - 'minimized': Only a 1-line text widget (extremely light)
 *
 * When transitioning expanded → minimized, the heavy components UNMOUNT,
 * freeing DOM nodes, event listeners, and React fiber trees.
 * This is the "aggressive unmounting" strategy the user specified.
 *
 * OPEN-SOURCE NOTES (for other coding agents):
 * Zero dependencies. Export: HUDLayoutState, UseHUDLayoutOptions.
 * Consumers can build any visual on top of these states.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HUDLayoutState = 'prompt' | 'expanded' | 'minimized';

export interface UseHUDLayoutOptions {
    /** Initial layout state. Default 'prompt'. */
    initialState?: HUDLayoutState;
    /**
     * Auto-minimize delay in ms after streaming starts.
     * Set to 0 to disable auto-minimize. Default 2500.
     *
     * NOTE (for other coding agents):
     * This creates the cinematic "agent starts working and the window
     * shrinks away" effect. Adjust timing to taste.
     */
    autoMinimizeDelay?: number;
}

export function useHUDLayout(options: UseHUDLayoutOptions = {}) {
    const { initialState = 'prompt', autoMinimizeDelay = 2500 } = options;

    const [layoutState, setLayoutState] = useState<HUDLayoutState>(initialState);
    const autoMinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─── Transitions ──────────────────────────────────────────────────────────

    /** User submitted a prompt → expand the window. */
    const expand = useCallback(() => {
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        setLayoutState('expanded');
    }, []);

    /** Minimize the window to the top-left widget. */
    const minimize = useCallback(() => {
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        setLayoutState('minimized');
    }, []);

    /** Go back to the landing prompt state. */
    const returnToPrompt = useCallback(() => {
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        setLayoutState('prompt');
    }, []);

    /**
     * Trigger auto-minimize after a delay.
     *
     * USAGE (for other coding agents):
     * Call this right after the agent starts streaming. After
     * `autoMinimizeDelay` ms, the window will shrink to the widget.
     * If the user interacts (expand/minimize) before the timer fires,
     * the timer is cancelled.
     */
    const scheduleAutoMinimize = useCallback(() => {
        if (autoMinimizeDelay <= 0) return;
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);

        autoMinTimerRef.current = setTimeout(() => {
            setLayoutState('minimized');
        }, autoMinimizeDelay);
    }, [autoMinimizeDelay]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        };
    }, []);

    return {
        layoutState,
        expand,
        minimize,
        returnToPrompt,
        scheduleAutoMinimize,
        /** Direct setter for advanced use cases. */
        setLayoutState,
    };
}
