/**
 * BlockStatusBar.tsx - lightweight status footer for the live notebook.
 *
 * Gives the user enough collaboration signal to trust the surface without
 * dragging in full cursor presence.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, WifiOff, Users } from "lucide-react";

type PresenceEntry = { userId: string; online: boolean; lastDisconnected: number };

type Props = {
  presence: PresenceEntry[];
  selfUserId: string | null;
  participantDirectory?: Record<string, string>;
  latestHumanEdit?: {
    ownerKey?: string | null;
    updatedAt?: number | null;
  } | null;
  lastSyncedAt: number | null;
  offlineQueueLength: number;
  isOffline: boolean;
  rateLimited: boolean;
  readOnly: boolean;
};

function formatRelative(ms: number | null | undefined): string {
  if (!ms) return "-";
  const diff = Date.now() - ms;
  if (diff < 0) return "now";
  if (diff < 2_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function displayNameForOwnerKey(
  ownerKey: string,
  participantDirectory?: Record<string, string>,
) {
  const explicit = participantDirectory?.[ownerKey];
  if (explicit?.trim()) return explicit.trim();
  if (ownerKey.startsWith("anon:")) return "Anonymous collaborator";
  return "Someone";
}

function activeEditingText(
  others: PresenceEntry[],
  participantDirectory?: Record<string, string>,
) {
  if (others.length === 0) return null;
  const labels = others.map((entry) => displayNameForOwnerKey(entry.userId, participantDirectory));
  if (labels.length === 1) return `${labels[0]} editing now`;
  return `${labels[0]} + ${labels.length - 1} editing`;
}

export function BlockStatusBar({
  presence,
  selfUserId,
  participantDirectory,
  latestHumanEdit,
  lastSyncedAt,
  offlineQueueLength,
  isOffline,
  rateLimited,
  readOnly,
}: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const others = useMemo(
    () => presence.filter((entry) => entry.online && entry.userId !== selfUserId),
    [presence, selfUserId],
  );
  const activeText = useMemo(
    () => activeEditingText(others, participantDirectory),
    [others, participantDirectory],
  );
  const latestHumanEditText = useMemo(() => {
    if (!latestHumanEdit?.updatedAt || !latestHumanEdit.ownerKey) return null;
    const label = displayNameForOwnerKey(latestHumanEdit.ownerKey, participantDirectory);
    return `Last edited by ${label} ${formatRelative(latestHumanEdit.updatedAt)}`;
  }, [latestHumanEdit, participantDirectory]);

  return (
    <div
      data-testid="notebook-block-status"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-white/[0.06] dark:text-gray-400"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3">
        {activeText ? (
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3 w-3" aria-hidden="true" />
            <span>{activeText}</span>
          </span>
        ) : null}
        {latestHumanEditText ? <span>{latestHumanEditText}</span> : null}
        {lastSyncedAt ? (
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden="true" />
            <span>Synced {formatRelative(lastSyncedAt)}</span>
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {readOnly ? (
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Lock className="h-3 w-3" aria-hidden="true" />
            <span>Read-only</span>
          </span>
        ) : null}
        {rateLimited ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            <span>Slow down - rate limit</span>
          </span>
        ) : null}
        {isOffline ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <WifiOff className="h-3 w-3" aria-hidden="true" />
            <span>
              Offline
              {offlineQueueLength > 0 ? ` - ${offlineQueueLength} edits queued` : ""}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default BlockStatusBar;
