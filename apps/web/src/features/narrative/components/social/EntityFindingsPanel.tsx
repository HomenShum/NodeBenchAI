import React, { useMemo, useState, useEffect } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useStableQuery } from "@/hooks/useStableQuery";
import { Building2, ExternalLink, FileText } from "lucide-react";

const formatUsd = (amountUsd?: number, fallback?: string): string => {
  if (typeof amountUsd === "number" && Number.isFinite(amountUsd) && amountUsd > 0) {
    if (amountUsd >= 1_000_000_000) return `$${(amountUsd / 1_000_000_000).toFixed(1)}B`;
    if (amountUsd >= 1_000_000) return `$${Math.round(amountUsd / 1_000_000)}M`;
    if (amountUsd >= 1_000) return `$${Math.round(amountUsd / 1_000)}K`;
    return `$${amountUsd}`;
  }
  return fallback ?? "n/a";
};

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const POST_TYPE_LABEL: Record<string, string> = {
  daily_digest: "Daily Digest",
  funding_tracker: "Funding Tracker",
  funding_brief: "Funding Brief",
  fda: "FDA Update",
  clinical: "Clinical Trial",
  research: "Research",
  ma: "Deal",
};

interface Props {
  initialEntityId?: string;
  onEntityChange?: (companyId: string | null) => void;
}

export const EntityFindingsPanel: React.FC<Props> = ({ initialEntityId, onEntityChange }) => {
  const [selected, setSelected] = useState<string | null>(initialEntityId ?? null);

  const entities = useStableQuery(
    api.domains.social.linkedinArchiveEntityLinks.listEntitiesWithArchiveLinks,
    {},
  );

  const findings = useStableQuery(
    api.domains.social.linkedinArchiveEntityLinks.getEntityFindings,
    selected ? { companyId: selected as Id<"entityContexts">, limit: 25 } : "skip",
  );

  // Auto-select the first entity once the list loads (so we render something useful by default).
  useEffect(() => {
    if (selected) return;
    if (!entities || entities.length === 0) return;
    setSelected(entities[0].companyId);
    onEntityChange?.(entities[0].companyId);
  }, [entities, selected, onEntityChange]);

  const entityOptions = useMemo(() => entities ?? [], [entities]);

  if (entityOptions.length === 0) {
    return (
      <div
        data-testid="entity-findings-empty"
        className="nb-surface-card p-4 text-sm text-content-muted"
      >
        No entity-linked findings yet. Run{" "}
        <code className="text-xs">rebuildAllArchiveEntityLinks</code> to populate.
      </div>
    );
  }

  return (
    <section
      data-testid="entity-findings-panel"
      aria-label="Findings by entity"
      className="nb-surface-card p-4 space-y-4"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-indigo-500/15 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-indigo-500 dark:text-indigo-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Findings by entity</h3>
            <p className="text-[11px] text-content-muted">
              Funding events + LinkedIn posts tied to the selected company
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-content-muted">
          <span>Entity</span>
          <select
            data-testid="entity-findings-select"
            className="bg-surface border border-edge rounded-md text-xs px-2 py-1 text-content"
            value={selected ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              setSelected(next);
              onEntityChange?.(next);
            }}
          >
            {entityOptions.map((entity) => (
              <option key={entity.companyId} value={entity.companyId}>
                {entity.entityName} · {entity.linkCount}
              </option>
            ))}
          </select>
        </label>
      </header>

      {findings === undefined ? (
        <div className="text-xs text-content-muted">Loading findings…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Funding events column */}
            <div>
              <h4 className="text-[11px] uppercase tracking-[0.2em] text-content-muted mb-2">
                Funding events
              </h4>
              {findings.fundingEvents.length === 0 ? (
                <p data-testid="entity-findings-no-funding" className="text-xs text-content-muted">
                  No funding events recorded for {findings.entity.entityName}.
                </p>
              ) : (
                <ul data-testid="entity-findings-funding-list" className="space-y-2">
                  {findings.fundingEvents.map((event) => (
                    <li
                      key={event._id}
                      data-testid="entity-findings-funding-row"
                      className="rounded-md border border-edge/60 px-3 py-2 text-xs"
                    >
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span className="font-medium text-content">
                          {formatUsd(event.amountUsd, event.amountRaw)}
                        </span>
                        <span className="text-content-muted text-[11px] uppercase tracking-wide">
                          {event.roundType}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-content-muted">
                        {formatDate(event.announcedAt)} · {event.verificationStatus}
                        {event.sector ? ` · ${event.sector}` : ""}
                      </div>
                      {event.leadInvestors && event.leadInvestors.length > 0 ? (
                        <div className="mt-1 text-[11px] text-content-muted">
                          Leads: {event.leadInvestors.slice(0, 3).join(", ")}
                        </div>
                      ) : null}
                      {event.sourceUrls.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {event.sourceUrls.slice(0, 3).map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline inline-flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              source
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Archive posts column */}
            <div>
              <h4 className="text-[11px] uppercase tracking-[0.2em] text-content-muted mb-2">
                LinkedIn coverage
              </h4>
              {findings.archivePosts.length === 0 ? (
                <p data-testid="entity-findings-no-posts" className="text-xs text-content-muted">
                  No LinkedIn posts mention {findings.entity.entityName} yet.
                </p>
              ) : (
                <ul data-testid="entity-findings-post-list" className="space-y-2">
                  {findings.archivePosts.map((post) => (
                    <li
                      key={post._id}
                      data-testid="entity-findings-post-row"
                      className="rounded-md border border-edge/60 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium text-content inline-flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-content-muted" />
                          {POST_TYPE_LABEL[post.postType] ?? post.postType}
                        </span>
                        <span className="text-[11px] text-content-muted">
                          {formatDate(post.postedAt)} · match: {post.matchSource.replace("_", " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-content-muted line-clamp-3">
                        {post.contentExcerpt}
                      </p>
                      {post.sourceUrls.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {post.sourceUrls.slice(0, 3).map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline inline-flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              source
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {post.postUrl ? (
                        <a
                          href={post.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View post
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default EntityFindingsPanel;
