/**
 * DataSourceBanner — Compact inline indicator showing data source mode.
 *
 * Shows on every surface so the user always knows what's backing the data.
 * Not intrusive — small pill below the subtitle, auto-hides when live.
 */

import { Circle, Wifi, HardDrive, AlertCircle } from "lucide-react";
import { useDataSource, type DataSourceMode } from "@/lib/hooks/useDataSource";
import { cn } from "@/lib/utils";

const MODE_CONFIG: Record<DataSourceMode, {
  icon: typeof Circle;
  dotColor: string;
  textColor: string;
  bg: string;
}> = {
  live: {
    icon: Wifi,
    dotColor: "bg-emerald-400",
    textColor: "text-emerald-400",
    bg: "bg-emerald-500/8",
  },
  local: {
    icon: HardDrive,
    dotColor: "bg-blue-400",
    textColor: "text-blue-400",
    bg: "bg-blue-500/8",
  },
  demo: {
    icon: AlertCircle,
    dotColor: "bg-amber-400",
    textColor: "text-amber-400",
    bg: "bg-amber-500/8",
  },
};

export function DataSourceBanner({ className }: { className?: string }) {
  const status = useDataSource();
  const config = MODE_CONFIG[status.mode];
  const Icon = config.icon;

  return (
    <div className={cn("flex justify-center", className)}>
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-3 py-1",
          config.bg,
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", config.dotColor)} />
        <span className={cn("text-[11px] font-medium", config.textColor)}>
          {status.label}
        </span>
        <span className="text-[11px] text-content-muted">
          {status.hint}
        </span>
      </div>
    </div>
  );
}
