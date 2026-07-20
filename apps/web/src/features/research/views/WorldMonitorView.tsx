import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Globe2, MapPin, Radar, ShieldAlert, Siren, Tags } from "lucide-react";

import { api } from "../../../../convex/_generated/api";

const SEVERITY_TONE: Record<string, string> = {
  low: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  high: "border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  critical: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

function SnapshotCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-5">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-secondary">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold text-content">{value}</div>
    </div>
  );
}

export default function WorldMonitorView() {
  const [selectedTopic, setSelectedTopic] = useState<string | undefined>(undefined);
  const [selectedCountry, setSelectedCountry] = useState<string | undefined>(undefined);

  const snapshot = useQuery(api.domains.monitoring.worldMonitor.getMapSnapshot, {
    status: "open",
    limit: 80,
  });

  const cluster = useQuery(api.domains.monitoring.worldMonitor.getEventCluster, {
    topic: selectedTopic,
    countryCode: selectedCountry,
    limit: 20,
  });

  const topCountries = useMemo(() => snapshot?.countries?.slice(0, 8) ?? [], [snapshot?.countries]);
  const topTopics = useMemo(() => snapshot?.topics?.slice(0, 8) ?? [], [snapshot?.topics]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="rounded-3xl border border-edge bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-content-secondary">
              NodeBench World Monitor
            </p>
            <h1 className="text-3xl font-semibold text-content">Open-source geopolitical and market event map</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-secondary">
              Track world events, cluster them by geography and topic, and route the highest-impact developments into
              causal company analysis and watchlist refresh missions.
            </p>
          </div>
          <div className="rounded-2xl border border-edge bg-background px-4 py-3 text-sm text-content-secondary">
            {selectedTopic || selectedCountry ? (
              <div className="flex flex-wrap gap-2">
                {selectedTopic && (
                  <button
                    type="button"
                    className="rounded-full border border-edge px-3 py-1 hover:bg-surface-hover"
                    onClick={() => setSelectedTopic(undefined)}
                  >
                    Topic: {selectedTopic}
                  </button>
                )}
                {selectedCountry && (
                  <button
                    type="button"
                    className="rounded-full border border-edge px-3 py-1 hover:bg-surface-hover"
                    onClick={() => setSelectedCountry(undefined)}
                  >
                    Country: {selectedCountry}
                  </button>
                )}
              </div>
            ) : (
              <span>No filters applied</span>
            )}
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <SnapshotCard label="Open Events" value={snapshot?.totalEvents ?? 0} icon={<Radar className="h-4 w-4" />} />
        <SnapshotCard
          label="Critical"
          value={snapshot?.severityCounts?.critical ?? 0}
          icon={<Siren className="h-4 w-4" />}
        />
        <SnapshotCard
          label="High Severity"
          value={snapshot?.severityCounts?.high ?? 0}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <SnapshotCard
          label="Countries"
          value={snapshot?.countries?.length ?? 0}
          icon={<Globe2 className="h-4 w-4" />}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-edge bg-surface p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-content">
            <MapPin className="h-4 w-4 text-content-secondary" />
            Geographic concentration
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {topCountries.length > 0 ? (
              topCountries.map((country) => (
                <button
                  key={country.countryCode}
                  type="button"
                  onClick={() => setSelectedCountry(country.countryCode === "GLOBAL" ? undefined : country.countryCode)}
                  className="rounded-2xl border border-edge bg-background p-4 text-left transition hover:bg-surface-hover"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-content">{country.countryCode}</span>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${SEVERITY_TONE[country.highestSeverity]}`}>
                      {country.highestSeverity}
                    </span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-content">{country.count}</div>
                  <p className="mt-2 text-xs leading-5 text-content-secondary">
                    Topics: {country.topics.slice(0, 4).join(", ") || "No topic tags"}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-edge p-6 text-sm text-content-secondary">
                No world events have been ingested yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-edge bg-surface p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-content">
            <Tags className="h-4 w-4 text-content-secondary" />
            Topic clusters
          </div>
          <div className="flex flex-wrap gap-2">
            {topTopics.length > 0 ? (
              topTopics.map((topic) => (
                <button
                  key={topic.topic}
                  type="button"
                  onClick={() => setSelectedTopic(topic.topic === selectedTopic ? undefined : topic.topic)}
                  className={`rounded-full border px-3 py-2 text-sm transition ${
                    topic.topic === selectedTopic
                      ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                      : "border-edge bg-background text-content-secondary hover:bg-surface-hover"
                  }`}
                >
                  {topic.topic} ({topic.count})
                </button>
              ))
            ) : (
              <span className="text-sm text-content-secondary">No topic clusters yet.</span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-edge bg-surface p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-content">Event cluster detail</h2>
            <p className="text-sm text-content-secondary">
              Use this list to select events for causal-chain generation or watchlist refresh.
            </p>
          </div>
          <span className="text-sm text-content-secondary">{cluster?.total ?? 0} events</span>
        </div>
        <div className="space-y-3">
          {(cluster?.events ?? []).length > 0 ? (
            cluster?.events.map((event) => (
              <div key={event._id} className="rounded-2xl border border-edge bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-medium text-content">{event.title}</h3>
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${SEVERITY_TONE[event.severity]}`}>
                        {event.severity}
                      </span>
                      <span className="rounded-full border border-edge px-2 py-1 text-[11px] text-content-secondary">
                        {event.topic}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-content-secondary">{event.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={`/execution-trace?event=${encodeURIComponent(event.eventKey)}`}
                        className="rounded-full border border-edge px-3 py-1 text-xs text-content-secondary transition hover:bg-surface-hover"
                      >
                        Open trace context
                      </a>
                      {event.sourceRefs?.[0]?.href ? (
                        <a
                          href={event.sourceRefs[0].href}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-edge px-3 py-1 text-xs text-content-secondary transition hover:bg-surface-hover"
                        >
                          Primary evidence
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right text-xs text-content-secondary">
                    <div>{event.countryCode ?? "GLOBAL"}</div>
                    <div>{new Date(event.detectedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-edge p-6 text-sm text-content-secondary">
              No events match the current filters.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
