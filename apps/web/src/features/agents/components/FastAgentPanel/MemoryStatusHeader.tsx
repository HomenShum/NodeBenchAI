// src/features/agents/components/FastAgentPanel/MemoryStatusHeader.tsx
// Live Status Header - Collapsible progress accordion showing plan status

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PlanItem {
    id: string;
    name: string;
    status: 'queued' | 'active' | 'done' | 'failed';
    description?: string;
}

interface MemoryStatusHeaderProps {
    planItems: PlanItem[];
    currentFocus?: string;
    isLoading?: boolean;
    onToggleItem?: (itemId: string) => void;
    className?: string;
}

/**
 * MemoryStatusHeader - Ambient context header showing plan progress
 * 
 * Collapsed: 24px thin strip with progress indicator
 * Expanded: Feature checklist with status icons
 */
export function MemoryStatusHeader({
    planItems,
    currentFocus,
    isLoading = false,
    onToggleItem,
    className,
}: MemoryStatusHeaderProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Calculate progress
    const totalItems = planItems.length;
    const doneItems = planItems.filter(item => item.status === 'done').length;
    const progressPercent = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

    // Find current active item if no focus specified
    const activeItem = planItems.find(item => item.status === 'active');
    const displayFocus = currentFocus || activeItem?.name || (totalItems > 0 ? planItems[0].name : 'No active plan');

    // Don't render if no plan items
    if (totalItems === 0 && !isLoading) {
        return null;
    }

    const getStatusIcon = (status: PlanItem['status']) => {
        switch (status) {
            case 'done':
                return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
            case 'active':
                return <Loader2 className="w-3.5 h-3.5 text-violet-500 motion-safe:animate-spin" />;
            case 'failed':
                return <Circle className="w-3.5 h-3.5 text-red-500" />;
            default:
                return <Circle className="w-3.5 h-3.5 text-content-muted" />;
        }
    };

    const getStatusBadge = (status: PlanItem['status']) => {
        const config = {
            done: { label: 'Done', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
            active: { label: 'Active', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
            failed: { label: 'Failed', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
            queued: { label: 'Queued', className: 'bg-surface-hover text-content-secondary dark:bg-surface-secondary dark:text-content-muted' },
        };
        const { label, className } = config[status];
        return (
            <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', className)}>
                {label}
            </span>
        );
    };

    return (
        <div className={cn(
            "sticky top-0 z-10 bg-surface-secondary border-b border-edge",
            "transition-all duration-200 ease-out",
            className
        )}>
            {/* Collapsed Header - 24px */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={cn(
                    "w-full flex items-center justify-between px-3 py-1.5",
                    "hover:bg-surface-secondary transition-colors",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                )}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {/* Status indicator */}
                    <div className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0",
                        doneItems === totalItems && totalItems > 0 ? "bg-green-500" :
                            activeItem ? "bg-violet-500 motion-safe:animate-pulse" : "bg-content-muted"
                    )} />

                    {/* Progress text */}
                    <span className="text-xs font-medium text-content truncate">
                        {isLoading ? (
                            <span className="flex items-center gap-1">
                                <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
                                Loading plan...
                            </span>
                        ) : (
                            <>
                                {doneItems}/{totalItems} Complete
                                <span className="mx-1.5 text-content-muted">•</span>
                                <span className="text-content-secondary">{displayFocus}</span>
                            </>
                        )}
                    </span>
                </div>

                {/* Expand/collapse icon */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Progress bar mini */}
                    <div className="hidden sm:block w-16 h-1 bg-surface-secondary rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>

                    {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-content-muted" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-content-muted" />
                    )}
                </div>
            </button>

            {/* Progress bar full width at bottom of collapsed header */}
            {!isExpanded && (
                <div className="h-0.5 bg-surface-secondary">
                    <div
                        className="h-full bg-gradient-to-r from-[rgb(79, 70, 229)] to-[var(--accent-secondary)] transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            )}

            {/* Expanded Checklist */}
            {isExpanded && (
                <div className="px-3 py-2 space-y-1 bg-surface border-t border-edge">
                    {planItems.map((item) => (
                        <div
                            key={item.id}
                            className={cn(
                                "flex items-center justify-between py-1.5 px-2 rounded-md",
                                "hover:bg-surface-secondary transition-colors cursor-pointer",
                                item.status === 'active' && "bg-blue-50/50 dark:bg-blue-900/10"
                            )}
                            onClick={() => onToggleItem?.(item.id)}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {getStatusIcon(item.status)}
                                <span className={cn(
                                    "text-sm truncate",
                                    item.status === 'done' && "text-content-muted line-through",
                                    item.status === 'active' && "text-content font-medium"
                                )}>
                                    {item.name}
                                </span>
                            </div>
                            {getStatusBadge(item.status)}
                        </div>
                    ))}

                    {planItems.length === 0 && (
                        <div className="flex items-center justify-center py-4 text-sm text-content-muted">
                            <Target className="w-4 h-4 mr-2" />
                            No plan items yet
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default MemoryStatusHeader;
