import { memo } from "react";
import { Activity } from "lucide-react";
import { ScratchpadViewer } from "@/features/entities/components/ScratchpadViewer";

type CheckpointSummary = {
  checkpointId: string;
  checkpointNumber: number;
  currentStep: string;
  status: "active" | "paused" | "completed" | "error" | "waiting_approval";
  progress: number;
  createdAt: number;
  error?: string;
};

type Props = {
  markdownSource: string | null | undefined;
  runLabel?: string;
  version?: number;
  updatedAt?: number;
  checkpoints?: readonly CheckpointSummary[];
};

function formatRelative(timestamp: number): string {
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 60_000) return "just now";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function NotebookScratchpadTracePanelBase({
  markdownSource,
  runLabel,
  version,
  updatedAt,
  checkpoints,
}: Props) {
  const items = checkpoints ?? [];

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-gray-200 bg-white px-3 py-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-gray-400" />
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Checkpoint trace
          </div>
        </div>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          Block-level checkpoints land here as the overlay run structures each section.
        </p>
        <div className="mt-3 space-y-2">
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-[11px] text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.01] dark:text-gray-400">
              No checkpoints yet for this entity.
            </div>
          ) : (
            items.map((checkpoint) => (
              <div
                key={checkpoint.checkpointId}
                className="rounded-md border border-gray-100 bg-gray-50/80 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.02]"
              >
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    #{checkpoint.checkpointNumber} {checkpoint.currentStep}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500">
                    {checkpoint.progress}%
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {checkpoint.status} · {formatRelative(checkpoint.createdAt)}
                </div>
                {checkpoint.error ? (
                  <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                    {checkpoint.error}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <ScratchpadViewer
        markdownSource={markdownSource}
        runLabel={runLabel}
        version={version}
        updatedAt={updatedAt}
      />
    </div>
  );
}

export const NotebookScratchpadTracePanel = memo(NotebookScratchpadTracePanelBase);
NotebookScratchpadTracePanel.displayName = "NotebookScratchpadTracePanel";
