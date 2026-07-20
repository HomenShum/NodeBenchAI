import React, { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

type NotificationActivityPanelProps = {
  mode?: "user" | "topic";
  variant?: "settings" | "hub";
  title?: string;
  subtitle?: string;
  limit?: number;
  className?: string;
};

type NotificationStats = {
  totalSent: number;
  totalCost: number;
  last24Hours: number;
  last7Days: number;
};

type NotificationLogEntry = {
  body?: string;
  status?: string;
  eventType?: string;
  createdAt?: number;
};

function normalizeText(value?: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clipText(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  const slice = value.slice(0, maxLen);
  const sentenceEnd = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );
  if (sentenceEnd > Math.floor(maxLen * 0.6)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLen * 0.6)) {
    return slice.slice(0, lastSpace).trim();
  }
  return slice.trim();
}

function extractBodyContent(body?: string): string {
  const trimmed = (body ?? "").trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.message === "string") return parsed.message;
      if (typeof parsed?.body === "string") return parsed.body;
    } catch {
      return body ?? "";
    }
  }
  return body ?? "";
}

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return "Unknown";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60 * 1000) return "Just now";
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatEventLabel(eventType?: string): string {
  if (!eventType) return "Notification";
  return eventType.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractHeadline(body?: string): string {
  const lines = extractBodyContent(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] ?? "Notification";
}

function extractPreview(body?: string): string {
  const lines = extractBodyContent(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return "";
  return lines.slice(1).join(" ");
}

export function NotificationActivityPanel({
  mode = "user",
  variant = "settings",
  title,
  subtitle,
  limit = 6,
  className,
}: NotificationActivityPanelProps) {
  const user = useQuery(api.domains.auth.auth.loggedInUser);
  const stats = useQuery(
    mode === "topic"
      ? api.domains.integrations.ntfy.getTopicNotificationStats
      : api.domains.integrations.ntfy.getNotificationStats,
    {},
  ) as NotificationStats | undefined;
  const logs = useQuery(
    mode === "topic"
      ? api.domains.integrations.ntfy.getTopicNotificationLogs
      : api.domains.integrations.ntfy.getNotificationLogs,
    { limit },
  ) as NotificationLogEntry[] | undefined;

  const isLoading = stats === undefined || logs === undefined || user === undefined;
  const isSignedIn = user !== null && user !== undefined;
  const showSignInHint = mode === "user" && !isSignedIn;
  const displayStats = stats ?? { totalSent: 0, totalCost: 0, last24Hours: 0, last7Days: 0 };
  const costDollars = (displayStats.totalCost / 100).toFixed(2);

  const logEntries = useMemo(() => (logs ?? []).slice(0, limit), [logs, limit]);

  const styles =
    variant === "hub"
      ? {
          container: "border border-edge bg-surface-secondary p-6 space-y-4",
          title: "text-xs font-semibold text-content",
          subtitle: "text-xs text-content-muted",
          statsGrid: "grid grid-cols-2 gap-2",
          statCard: "bg-surface border border-edge px-3 py-2 text-center",
          statValue: "text-base font-semibold text-content",
          statLabel: "text-xs text-content-muted",
          logList: "space-y-2",
          logItem: "border border-edge bg-surface px-3 py-2",
          logTitle: "text-xs font-semibold text-content",
          logMeta: "text-xs text-content-muted font-medium",
          logBody: "text-xs text-content-secondary",
          emptyText: "text-xs text-content-muted",
        }
      : {
          container: "pt-4 border-t border-edge space-y-3",
          title: "text-xs font-semibold text-content-secondary",
          subtitle: "text-xs text-content-secondary",
          statsGrid: "grid grid-cols-2 md:grid-cols-4 gap-2",
          statCard: "bg-surface-secondary rounded p-2 text-center",
          statValue: "text-sm font-bold text-content",
          statLabel: "text-xs text-content-secondary",
          logList: "space-y-2",
          logItem: "border border-edge rounded p-2 bg-surface",
          logTitle: "text-xs font-semibold text-content line-clamp-1 dark:text-gray-200",
          logMeta: "text-xs text-content-muted font-medium",
          logBody: "text-xs text-content-secondary line-clamp-2",
          emptyText: "text-xs text-content-secondary",
        };

  return (
    <div className={`${styles.container} ${className ?? ""}`}>
      {(title || subtitle) && (
        <div className="space-y-1">
          {title && <div className={styles.title}>{title}</div>}
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
      )}

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{displayStats.totalSent}</div>
          <div className={styles.statLabel}>Total</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{displayStats.last24Hours}</div>
          <div className={styles.statLabel}>24h</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{displayStats.last7Days}</div>
          <div className={styles.statLabel}>7d</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>${costDollars}</div>
          <div className={styles.statLabel}>Cost</div>
        </div>
      </div>

      <div className={styles.logList}>
        {showSignInHint && !isLoading && (
          <div className={styles.emptyText}>Sign in to view your notification log.</div>
        )}
        {!showSignInHint && !isLoading && logEntries.length === 0 && (
          <div className={styles.emptyText}>No notifications yet.</div>
        )}
        {!showSignInHint &&
          logEntries.map((entry, idx) => {
            const headline = clipText(normalizeText(extractHeadline(entry.body)), 80);
            const preview = clipText(normalizeText(extractPreview(entry.body)), 140);
            const eventLabel = formatEventLabel(entry.eventType);
            const statusLabel = entry.status ? entry.status.toUpperCase() : "SENT";
            return (
              <div key={idx} className={styles.logItem}>
                <div className="flex items-center justify-between gap-2">
                  <span className={styles.logMeta}>{eventLabel}</span>
                  <span className={styles.logMeta}>{formatTimeAgo(entry.createdAt)}</span>
                </div>
                <div className={styles.logTitle}>{headline}</div>
                {preview && <div className={styles.logBody}>{preview}</div>}
                <div className={styles.logMeta}>{statusLabel}</div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default NotificationActivityPanel;
