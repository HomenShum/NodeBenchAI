/**
 * LiveDataBanner — Visual proof indicator showing live vs demo data state.
 *
 * When live: green pulse + "Live Data" + last fetch timestamp + refresh button
 * When demo: amber pulse + "Demo Data" + "Connect server to see real metrics"
 * When loading: skeleton pulse
 *
 * This is the ONE component that tells users "this is real, not fake."
 */

import { memo } from "react";
import { Activity, RefreshCw, Radio, Wifi, WifiOff } from "lucide-react";

export interface LiveDataBannerProps {
  isLive: boolean;
  isLoading?: boolean;
  lastFetched?: string | null;
  onRefresh?: () => void;
  label?: string;
  className?: string;
}

export const LiveDataBanner = memo(function LiveDataBanner({
  isLive,
  isLoading = false,
  lastFetched,
  onRefresh,
  label,
  className = "",
}: LiveDataBannerProps) {
  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 ${className}`}>
        <div className="h-2 w-2 rounded-full bg-white/20 animate-pulse" />
        <span className="text-[11px] text-white/30 animate-pulse">Connecting...</span>
      </div>
    );
  }

  if (isLive) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 ${className}`}>
        <div className="relative flex items-center justify-center">
          <span className="absolute h-3 w-3 rounded-full bg-emerald-500/30 animate-ping" />
          <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
        </div>
        <Radio className="h-3 w-3 text-emerald-400" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-400">
          {label ?? "Live Data"}
        </span>
        {lastFetched && (
          <span className="text-[10px] text-emerald-400/50 tabular-nums ml-1">
            {new Date(lastFetched).toLocaleTimeString()}
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto text-emerald-400/60 hover:text-emerald-400 transition-colors"
            aria-label="Refresh data"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 ${className}`}>
      <div className="relative flex items-center justify-center">
        <span className="absolute h-3 w-3 rounded-full bg-amber-500/20 animate-pulse" />
        <span className="relative h-2 w-2 rounded-full bg-amber-400" />
      </div>
      <WifiOff className="h-3 w-3 text-amber-400/60" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-400">
        Demo Data
      </span>
      <span className="text-[10px] text-amber-400/40 ml-1">
        Start server for live metrics
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto text-amber-400/60 hover:text-amber-400 transition-colors"
          aria-label="Retry connection"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
});

export default LiveDataBanner;
