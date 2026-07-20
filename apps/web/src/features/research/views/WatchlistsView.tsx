import { useQuery } from "convex/react";
import { BellRing, Eye, Globe2, Layers3, TimerReset } from "lucide-react";

import { api } from "../../../../convex/_generated/api";

function WatchlistStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-background p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-secondary">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold text-content">{value}</div>
    </div>
  );
}

export default function WatchlistsView() {
  const digest = useQuery(api.domains.monitoring.worldMonitor.getWatchlistDigest, {
    status: "active",
  });

  const watchlists: any[] = (digest as any)?.watchlists ?? [];
  const totalAlerts = watchlists.reduce((sum: number, item: any) => sum + (item.alertEventCount ?? 0), 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="rounded-3xl border border-edge bg-surface p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-content-secondary">
          NodeBench Watchlists
        </p>
        <h1 className="text-3xl font-semibold text-content">Persistent monitors for companies, sectors, and geographies</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-content-secondary">
          Watchlists turn world-monitor events and entity graph changes into durable operator queues with thresholds,
          refresh cadence, and mission handoff points.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <WatchlistStat label="Active Watchlists" value={watchlists.length} icon={<Eye className="h-4 w-4" />} />
        <WatchlistStat label="Alert Events" value={totalAlerts} icon={<BellRing className="h-4 w-4" />} />
        <WatchlistStat
          label="Scope Types"
          value={new Set(watchlists.map((item: any) => item.scopeType)).size}
          icon={<Layers3 className="h-4 w-4" />}
        />
        <WatchlistStat
          label="Need Refresh"
          value={watchlists.filter((item: any) => !item.lastRefreshedAt).length}
          icon={<TimerReset className="h-4 w-4" />}
        />
      </section>

      <section className="rounded-3xl border border-edge bg-surface p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-content">Active watchlists</h2>
            <p className="text-sm text-content-secondary">
              Alerts are derived from world events that match the watchlist scope and threshold.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {watchlists.length > 0 ? (
            watchlists.map((watchlist: any) => (
              <div key={watchlist._id} className="rounded-2xl border border-edge bg-background p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-medium text-content">{watchlist.title}</h3>
                      <span className="rounded-full border border-edge px-2 py-1 text-[11px] text-content-secondary">
                        {watchlist.scopeType}
                      </span>
                      <span className="rounded-full border border-edge px-2 py-1 text-[11px] text-content-secondary">
                        {watchlist.refreshCadence}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-content-secondary">
                      {(watchlist.entityKeys ?? []).slice(0, 4).map((entityKey: string) => (
                        <span key={entityKey} className="rounded-full border border-edge px-2 py-1">
                          {entityKey}
                        </span>
                      ))}
                      {(watchlist.countryCodes ?? []).map((countryCode: string) => (
                        <span key={countryCode} className="rounded-full border border-edge px-2 py-1">
                          <Globe2 className="mr-1 inline h-3 w-3" />
                          {countryCode}
                        </span>
                      ))}
                      {(watchlist.themeTags ?? []).slice(0, 4).map((tag: string) => (
                        <span key={tag} className="rounded-full border border-edge px-2 py-1">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid min-w-[210px] gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-edge bg-surface-secondary p-3">
                      <div className="text-xs text-content-secondary">Matching</div>
                      <div className="text-xl font-semibold text-content">{watchlist.matchingEventCount ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-edge bg-surface-secondary p-3">
                      <div className="text-xs text-content-secondary">Alerts</div>
                      <div className="text-xl font-semibold text-content">{watchlist.alertEventCount ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-edge bg-surface-secondary p-3">
                      <div className="text-xs text-content-secondary">Last refresh</div>
                      <div className="text-sm font-medium text-content">
                        {watchlist.lastRefreshedAt ? new Date(watchlist.lastRefreshedAt).toLocaleDateString() : "Pending"}
                      </div>
                    </div>
                  </div>
                </div>

                {watchlist.latestEvent && (
                  <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-content-secondary">
                      Latest matched event
                    </div>
                    <div className="text-sm font-medium text-content">{watchlist.latestEvent.title}</div>
                    <p className="mt-1 text-sm text-content-secondary">{watchlist.latestEvent.summary}</p>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-edge p-6 text-sm text-content-secondary">
              No active watchlists yet.
            </div>
          )}
        </div>
      </section>

      {digest?.suggestedWatchlists?.length ? (
        <section className="rounded-3xl border border-edge bg-surface p-6">
          <h2 className="text-lg font-semibold text-content">Suggested starting watchlists</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {digest.suggestedWatchlists.map((watchlist: any) => (
              <div key={watchlist.title} className="rounded-2xl border border-edge bg-background p-4">
                <div className="text-sm font-medium text-content">{watchlist.title}</div>
                <p className="mt-1 text-sm text-content-secondary">Scope: {watchlist.scopeType}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
