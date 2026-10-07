import React from "react";
import { CheckCircle2, Circle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DeepAgentStep {
    label: string;
    status: "pending" | "in_progress" | "completed" | "error";
    details?: string;
}

export interface DeepAgentProgressProps {
    steps: DeepAgentStep[];
    className?: string;
}

export const DeepAgentProgress: React.FC<DeepAgentProgressProps> = ({ steps, className }) => {
    const activeStepIndex = steps.findIndex((s) => s.status === "in_progress");
    const isComplete = steps.every((s) => s.status === "completed");

    return (
        <div className={cn("w-full max-w-2xl mx-auto my-8 font-sans", className)}>
            {/* Header */}
            <div className="flex items-center gap-2 mb-6">
                <div className={cn("p-2 rounded-lg", isComplete ? "bg-green-100" : "bg-indigo-500/10")}>
                    {isComplete ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                        <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400 motion-safe:animate-pulse" />
                    )}
                </div>
                <div>
                    <h3 className="text-sm font-bold text-content">
                        {isComplete ? "Deep Research Complete" : "Deep Research in Progress"}
                    </h3>
                    <p className="text-xs text-content-secondary">
                        {isComplete ? "All tasks finished successfully." : "Orchestrating specialized agents..."}
                    </p>
                </div>
            </div>

            {/* Steps */}
            <div className="relative space-y-0">
                {/* Vertical Line */}
                <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-surface-hover" />

                {steps.map((step, idx) => {
                    const isLast = idx === steps.length - 1;
                    const isActive = step.status === "in_progress";
                    const isDone = step.status === "completed";
                    const isPending = step.status === "pending";

                    return (
                        <div key={idx} className="relative flex gap-4 pb-8 last:pb-0 group">
                            {/* Icon */}
                            <div className="relative z-10 flex-shrink-0">
                                <div
                                    className={cn(
                                        "w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                                        isDone
                                            ? "bg-green-500 border-green-500"
                                            : isActive
                                                ? "bg-surface border-indigo-500/30 ring-4 ring-[var(--accent-primary-bg)]"
                                                : "bg-surface border-edge"
                                    )}
                                >
                                    {isDone ? (
                                        <CheckCircle2 className="w-4 h-4 text-white" />
                                    ) : isActive ? (
                                        <Loader2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 motion-safe:animate-spin" />
                                    ) : (
                                        <Circle className="w-3 h-3 text-content-muted fill-surface-secondary" />
                                    )}
                                </div>
                            </div>

                            {/* Content */}
                            <div className={cn("pt-0.5 transition-opacity duration-300", isPending && "opacity-50")}>
                                <h4
                                    className={cn(
                                        "text-sm font-semibold leading-none mb-1",
                                        isActive ? "text-indigo-600 dark:text-indigo-400" : isDone ? "text-content" : "text-content-secondary"
                                    )}
                                >
                                    {step.label}
                                </h4>
                                {step.details && (
                                    <p className="text-xs text-content-secondary leading-relaxed max-w-md">{step.details}</p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
