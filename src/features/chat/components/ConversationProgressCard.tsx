/**
 * ConversationProgressCard — extracted from ChatHome.tsx during the
 * stabilization sprint (2026-04-27). The component shows a streaming
 * progress timeline with collapsible children per item, used by chat
 * surfaces to give the user "I see what you're doing" feedback while
 * the agent runs.
 *
 * Originally lived inline at ChatHome.tsx:509 alongside the
 * `ConversationProgressItem` type, `ProgressSpinner` helper, and two
 * tone-class helpers. Extracted as part of deleting the parent
 * ChatHome.tsx (which was @deprecated since #187 — never rendered in
 * production but kept getting phantom-maintenance edits because grep
 * found it).
 *
 * ChatHome.progress-card.test.tsx imports from here now.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";


function formatToolLabel(value: string | null | undefined) {
  if (!value) return "Working";
  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function progressStateClasses(state: "complete" | "active" | "pending") {
  if (state === "complete") {
    return "text-gray-100";
  }
  if (state === "active") {
    return "text-gray-100";
  }
  return "text-gray-300";
}

export type ConversationProgressItem = {
  id: string;
  label: string;
  detail: string;
  state: "complete" | "active" | "pending";
  children?: ReadonlyArray<{
    id: string;
    label: string;
    tone?: "complete" | "active" | "pending";
  }>;
};

function progressChildToneClasses(tone: "complete" | "active" | "pending" = "pending") {
  if (tone === "complete") {
    return "bg-[#151a20] text-gray-200";
  }
  if (tone === "active") {
    return "bg-[#171d25] text-gray-100";
  }
  return "bg-white/[0.04] text-gray-300";
}

function shouldShowProgressChildren(item: ConversationProgressItem, expandedItemId: string | null) {
  if (!item.children?.length) return false;
  return expandedItemId === item.id;
}

function ProgressSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block rounded-full border-[1.5px] border-dashed border-sky-300/95 border-t-transparent motion-safe:animate-spin",
        className,
      )}
    />
  );
}

export function ConversationProgressCard({
  progressItems,
  completedProgressCount,
  isStreaming,
  defaultCollapsed = false,
}: {
  progressItems: readonly ConversationProgressItem[];
  completedProgressCount: number;
  isStreaming: boolean;
  defaultCollapsed?: boolean;
}) {
  const preferredExpandedId = useMemo(
    () =>
      progressItems.find((item) => item.state === "active" && (item.children?.length ?? 0) > 0)?.id ?? null,
    [progressItems],
  );
  const [expandedItemId, setExpandedItemId] = useState<string | null>(preferredExpandedId);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const previousPreferredExpandedIdRef = useRef<string | null>(preferredExpandedId);
  const collapsedSummaryItem = useMemo(
    () =>
      progressItems.find((item) => item.state === "active") ??
      progressItems.find((item) => item.state === "pending") ??
      progressItems.at(-1) ??
      null,
    [progressItems],
  );
  const progressHeadline = useMemo(() => {
    if (collapsedSummaryItem?.label) return collapsedSummaryItem.label;
    if (completedProgressCount === progressItems.length && !isStreaming) return "Report ready";
    return "Working through the brief";
  }, [collapsedSummaryItem?.label, completedProgressCount, isStreaming, progressItems.length]);
  const progressOrdinal = useMemo(() => {
    const activeIndex = progressItems.findIndex((item) => item.state === "active");
    if (activeIndex >= 0) return activeIndex + 1;
    if (completedProgressCount > 0) return Math.min(completedProgressCount, progressItems.length);
    return 1;
  }, [completedProgressCount, progressItems]);
  const progressCountLabel = `${progressOrdinal}/${progressItems.length}`;

  useEffect(() => {
    if (!expandedItemId) return;
    const currentExists = progressItems.some((item) => item.id === expandedItemId);
    if (!currentExists) {
      setExpandedItemId(preferredExpandedId);
    }
  }, [expandedItemId, preferredExpandedId, progressItems]);

  useEffect(() => {
    if (previousPreferredExpandedIdRef.current === preferredExpandedId) return;
    previousPreferredExpandedIdRef.current = preferredExpandedId;
    setExpandedItemId(preferredExpandedId);
  }, [preferredExpandedId]);

  useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  return (
    <div className="rounded-[28px] border border-white/[0.07] bg-[#141a21]/98 px-3.5 py-3.5 text-gray-100 shadow-[0_24px_56px_-40px_rgba(0,0,0,0.88)]">
      <button
        type="button"
        onClick={() => setCollapsed((open) => !open)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 px-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35"
      >
        <span
          className={`inline-flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full border ${
            isStreaming
              ? "border-sky-400/25 bg-sky-500/12 text-sky-100"
              : completedProgressCount === progressItems.length
                ? "border-emerald-400/18 bg-emerald-500/12 text-emerald-100"
                : "border-white/[0.08] bg-white/[0.03] text-gray-300"
          }`}
          aria-hidden
        >
          {completedProgressCount === progressItems.length && !isStreaming ? (
            <Check className="h-3.5 w-3.5" />
          ) : isStreaming ? (
            <ProgressSpinner className="h-3.5 w-3.5" />
          ) : (
            <Clock3 className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className="text-[15px] font-semibold tracking-[-0.02em] text-white">Task progress</div>
            <div className="text-[12px] font-medium text-gray-400">{progressCountLabel}</div>
          </div>
          <div className="pt-0.75 text-[12.5px] font-medium leading-5 text-gray-100">{progressHeadline}</div>
          {collapsed && collapsedSummaryItem?.detail ? (
            <div className="truncate pt-0.5 text-[11px] leading-[1.05rem] text-gray-300">
              {collapsedSummaryItem.detail}
            </div>
          ) : null}
        </div>
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.02] text-gray-400">
          {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>
      {!collapsed ? (
        <div className="mt-3.5 space-y-2.5">
          {progressItems.map((item) => {
            const itemExpanded = expandedItemId === item.id;
            return (
              <div
                key={item.id}
                className={`${
                  item.state === "active"
                    ? "rounded-[22px] border border-white/[0.07] bg-[#18212b] px-4 py-3.5"
                    : item.state === "complete"
                      ? "rounded-[20px] border border-white/[0.05] bg-[#151c24] px-3.5 py-3.25"
                      : "rounded-[18px] border border-white/[0.04] bg-[#12171d] px-3 py-2.75"
                } ${progressStateClasses(item.state)}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    item.children?.length
                      ? setExpandedItemId(expandedItemId === item.id ? null : item.id)
                      : undefined
                  }
                  className="flex w-full items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35"
                  aria-expanded={item.children?.length ? itemExpanded : undefined}
                >
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center ${
                      item.state === "complete"
                        ? "text-emerald-300"
                        : item.state === "active"
                          ? "text-sky-200"
                          : "text-gray-500"
                    }`}
                    aria-hidden
                  >
                    {item.state === "complete" ? (
                      <Check className="h-4 w-4" />
                    ) : item.state === "active" ? (
                      <ProgressSpinner className="h-4 w-4" />
                    ) : (
                      <Clock3 className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold leading-[1.2rem] tracking-[-0.01em] text-white">{item.label}</p>
                    {item.detail ? (
                      <p className="mt-1 text-[11.5px] leading-[1.15rem] text-gray-200">{item.detail}</p>
                    ) : null}
                  </div>
                  {item.children?.length ? (
                    <span className="mt-0.5 inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.02] text-gray-400">
                      {itemExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  ) : null}
                </button>
                {shouldShowProgressChildren(item, expandedItemId) ? (
                  <div className="space-y-1.5 pl-8.5 pr-0.5 pb-0.5 pt-2">
                    {(item.children ?? []).map((child) => (
                      <div
                        key={child.id}
                        className={`flex items-center gap-2 rounded-[14px] px-3 py-1.75 text-[11px] leading-[1.02rem] ${progressChildToneClasses(child.tone)}`}
                      >
                        <span
                          className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${
                            child.tone === "complete"
                              ? "text-emerald-300"
                              : child.tone === "active"
                                ? "text-sky-300"
                                : "text-gray-500"
                          }`}
                          aria-hidden
                        >
                          {child.tone === "complete" ? (
                            <Check className="h-3 w-3" />
                          ) : child.tone === "active" ? (
                            <ProgressSpinner className="h-3 w-3" />
                          ) : (
                            <Clock3 className="h-3 w-3" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">{child.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
