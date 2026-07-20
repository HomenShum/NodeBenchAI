import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface DeltaIndicatorProps {
    /** The delta value (positive, negative, or zero) */
    value: number;
    /** Unit to display (default: %) */
    unit?: string;
    /** Optional label for context (e.g., "vs. yesterday") */
    label?: string;
    /** Size variant */
    size?: 'sm' | 'md';
}

/**
 * DeltaIndicator - Shows change from previous period with directional styling
 * 
 * Used in dashboards to indicate "What Changed" at a glance.
 */
export function DeltaIndicator({
    value,
    unit = "%",
    label,
    size = 'sm'
}: DeltaIndicatorProps) {
    const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";

    const colorClass = {
        up: "text-indigo-600 dark:text-indigo-400",
        down: "text-red-500 dark:text-red-400",
        flat: "text-content-muted"
    }[direction];

    const bgClass = {
        up: "bg-indigo-50 dark:bg-indigo-950/30",
        down: "bg-red-50 dark:bg-red-950/30",
        flat: "bg-surface-secondary/50"
    }[direction];

    const Icon = {
        up: TrendingUp,
        down: TrendingDown,
        flat: Minus
    }[direction];

    const sizeClasses = {
        sm: "text-xs px-1.5 py-0.5 gap-1",
        md: "text-xs px-2 py-1 gap-1.5"
    }[size];

    const iconSize = size === 'sm' ? 10 : 12;

    // Don't render if value is exactly 0 and no label
    if (value === 0 && !label) return null;

    return (
        <span className={`inline-flex items-center font-mono font-medium rounded ${colorClass} ${bgClass} ${sizeClasses}`}>
            <Icon size={iconSize} className="shrink-0" />
            <span>{value > 0 ? '+' : ''}{value.toFixed(1)}{unit}</span>
            {label && (
                <span className="text-content-muted font-normal ml-0.5">
                    {label}
                </span>
            )}
        </span>
    );
}

export default DeltaIndicator;
