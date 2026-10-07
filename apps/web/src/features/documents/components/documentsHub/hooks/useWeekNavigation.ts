/**
 * useWeekNavigation Hook
 * 
 * Provides week boundary calculations and navigation handlers for the planner views.
 */

import { useCallback, useMemo } from "react";

export interface WeekNavigationOptions {
    /** Focused date in milliseconds (from planner state) */
    focusedDateMs?: number | null;
    /** Handler to update the focused week */
    handleViewWeek: (weekStartMs: number) => void;
}

export interface WeekNavigationResult {
    /** Get the start of the week (Monday) for a given timestamp */
    startOfWeekMs: (ms: number) => number;
    /** Format a week range as a human-readable string */
    formatWeekRange: (weekStartMs: number) => string;
    /** Current week range label */
    weekRangeLabel: string;
    /** Navigate to the previous week */
    onPrevWeek: () => void;
    /** Navigate to the next week */
    onNextWeek: () => void;
    /** Navigate to the current week (today) */
    onTodayWeek: () => void;
}

/**
 * Hook for week navigation helpers and calculations
 */
export function useWeekNavigation({
    focusedDateMs,
    handleViewWeek,
}: WeekNavigationOptions): WeekNavigationResult {

    /**
     * Calculate the start of the week (Monday) for a given timestamp
     */
    const startOfWeekMs = useCallback((ms: number): number => {
        const d = new Date(ms);
        d.setHours(0, 0, 0, 0);

        // JS getDay(): 0=Sun..6=Sat. Convert to 0=Mon..6=Sun
        const delta = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - delta);

        return d.getTime();
    }, []);

    /**
     * Format a week range as a human-readable string
     * e.g., "December 2 - 8, 2024" or "November 25 - December 1, 2024"
     */
    const formatWeekRange = useCallback((weekStartMs: number): string => {
        const start = new Date(weekStartMs);
        const end = new Date(weekStartMs);
        end.setDate(start.getDate() + 6);

        const sameMonth =
            start.getMonth() === end.getMonth() &&
            start.getFullYear() === end.getFullYear();

        if (sameMonth) {
            const month = start.toLocaleString(undefined, { month: "long" });
            return `${month} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
        }

        const startStr = start.toLocaleString(undefined, {
            month: "long",
            day: "numeric",
        });

        const endStr = end.toLocaleString(undefined, {
            month: "long",
            day: "numeric",
        });

        const yearSame = start.getFullYear() === end.getFullYear();
        return `${startStr} - ${endStr}${yearSame ? `, ${start.getFullYear()}` : ` ${end.getFullYear()}`}`;
    }, []);

    /**
     * Current week range label based on focused date
     */
    const weekRangeLabel = useMemo(() => {
        const anchor = focusedDateMs ?? Date.now();
        const wStart = startOfWeekMs(anchor);
        return formatWeekRange(wStart);
    }, [focusedDateMs, startOfWeekMs, formatWeekRange]);

    /**
     * Navigate to the previous week
     */
    const onPrevWeek = useCallback(() => {
        const anchor = focusedDateMs ?? Date.now();
        const start = startOfWeekMs(anchor);
        handleViewWeek(start - 7 * 24 * 60 * 60 * 1000);
    }, [focusedDateMs, startOfWeekMs, handleViewWeek]);

    /**
     * Navigate to the next week
     */
    const onNextWeek = useCallback(() => {
        const anchor = focusedDateMs ?? Date.now();
        const start = startOfWeekMs(anchor);
        handleViewWeek(start + 7 * 24 * 60 * 60 * 1000);
    }, [focusedDateMs, startOfWeekMs, handleViewWeek]);

    /**
     * Navigate to the current week (today)
     */
    const onTodayWeek = useCallback(() => {
        handleViewWeek(startOfWeekMs(Date.now()));
    }, [startOfWeekMs, handleViewWeek]);

    return {
        startOfWeekMs,
        formatWeekRange,
        weekRangeLabel,
        onPrevWeek,
        onNextWeek,
        onTodayWeek,
    };
}
