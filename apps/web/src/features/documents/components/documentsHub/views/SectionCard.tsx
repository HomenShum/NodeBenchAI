/**
 * SectionCard Component
 * 
 * A reusable card container for sections in the DocumentsHomeHub views.
 */

import type { ReactNode } from "react";

export interface SectionCardProps {
    /** Section title */
    title: string;
    /** Optional subtitle */
    subtitle?: string;
    /** Card content */
    children?: ReactNode;
    /** Additional className for the card */
    className?: string;
}

/**
 * Card container for sections like "Today", "This Week", etc.
 */
export function SectionCard({
    title,
    subtitle,
    children,
    className = "",
}: SectionCardProps) {
    return (
        <div className={`bg-surface border border-edge rounded-lg p-5 ${className}`}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-content">
                    {title}
                </h3>
                {subtitle && (
                    <span className="text-xs text-content-muted">{subtitle}</span>
                )}
            </div>
            {children}
        </div>
    );
}
