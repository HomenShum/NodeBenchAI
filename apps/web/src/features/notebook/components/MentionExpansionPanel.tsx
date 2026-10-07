/**
 * MentionExpansionPanel — Inline expansion panel for entity mentions.
 * Shows entity intelligence: summary, claims, edges, backlinks, actions.
 *
 * Pattern: Pure presentational component, data via useEntityExpansion hook.
 * Prior art: Roam Research block expansion, Notion @mention hover cards.
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md
 */
import { useState, useMemo } from "react";
import {
  Building2,
  User,
  Zap,
  ExternalLink,
  Link2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useEntityExpansion, useBacklinks } from "../hooks/useEntityExpansion";
import { BacklinkList } from "./BacklinkList";
import { MiniEntityGraph } from "./MiniEntityGraph";

/** Memoized graph wrapper — stabilizes edges/backlinks arrays to prevent MiniEntityGraph re-layout */
function MemoizedMiniGraph({
  entityId,
  label,
  kind,
  data,
  backlinks,
}: {
  entityId: string;
  label: string;
  kind: "company" | "person" | "tag";
  data: { edges?: { label: string; relation: string }[] };
  backlinks: { from: string; type: string; context?: string; confidence?: number }[];
}) {
  const edges = useMemo(() => data.edges ?? [], [data.edges]);
  const stableBacklinks = useMemo(() => backlinks, [backlinks]);

  if (edges.length === 0 && stableBacklinks.length === 0) return null;

  return (
    <MiniEntityGraph
      entityId={entityId}
      label={label}
      kind={kind}
      edges={edges}
      backlinks={stableBacklinks}
    />
  );
}

type MentionExpansionPanelProps = {
  entityId: string;
  label: string;
  kind: "company" | "person" | "tag";
};

export function MentionExpansionPanel({
  entityId,
  label,
  kind,
}: MentionExpansionPanelProps) {
  const { data, loading, error, expand } = useEntityExpansion(entityId);
  const { backlinks } = useBacklinks(entityId);
  const [showBacklinks, setShowBacklinks] = useState(false);

  const Icon = kind === "person" ? User : Building2;

  if (loading) {
    return (
      <div className="nb-expansion-panel" data-entity={entityId}>
        <div className="nb-expansion-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Loading entity data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="nb-expansion-panel" data-entity={entityId}>
        <div className="nb-expansion-error">
          <span>Failed to load entity data</span>
          <button
            type="button"
            className="nb-expansion-retry"
            onClick={() => expand()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="nb-expansion-panel" data-entity={entityId}>
        <div className="nb-expansion-empty">
          <p>No data available for {label}.</p>
          <button
            type="button"
            className="nb-expansion-action nb-expansion-action--primary"
            onClick={() => expand()}
          >
            <Zap className="h-3 w-3" aria-hidden="true" />
            Expand with agent
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="nb-expansion-panel" data-entity={entityId} role="region" aria-label={`${label} entity details`}>
      {/* Header */}
      <div className="nb-expansion-head">
        <span className={`nb-expansion-icon nb-expansion-icon--${kind}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="nb-expansion-name">{label}</span>
        {data.meta && (
          <span className="nb-expansion-meta">{data.meta}</span>
        )}
      </div>

      {/* Summary */}
      {data.summary && (
        <p className="nb-expansion-summary">{data.summary}</p>
      )}

      {/* Claims */}
      {data.claims && data.claims.length > 0 && (
        <div className="nb-expansion-section">
          <div className="nb-expansion-section-title">Claims</div>
          <div className="nb-expansion-claims">
            {data.claims.map((claim, i) => (
              <div key={`claim-${claim.text.slice(0, 20)}-${i}`} className="nb-expansion-claim">
                <span className="nb-expansion-claim-text">{claim.text}</span>
                <span className="nb-expansion-claim-src">{claim.src}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edges */}
      {data.edges && data.edges.length > 0 && (
        <div className="nb-expansion-edges">
          {data.edges.map((edge, i) => (
            <span key={`${edge.label}-${edge.relation}`} className="nb-expansion-edge" title={edge.relation}>
              <span className="nb-expansion-edge-rel">{edge.relation}</span>
              <span className="nb-expansion-edge-target">@{edge.label}</span>
            </span>
          ))}
        </div>
      )}

      {/* Mini graph visualization — edges memoized to avoid layout churn */}
      <MemoizedMiniGraph
        entityId={entityId}
        label={label}
        kind={kind}
        data={data}
        backlinks={backlinks}
      />

      {/* Backlinks toggle */}
      {data.backlinkCount > 0 && (
        <div className="nb-expansion-backlinks-toggle">
          <button
            type="button"
            className="nb-expansion-backlinks-btn"
            onClick={() => setShowBacklinks(!showBacklinks)}
            aria-expanded={showBacklinks}
          >
            <Link2 className="h-3 w-3" aria-hidden="true" />
            {data.backlinkCount} backlink{data.backlinkCount !== 1 ? "s" : ""}
            {showBacklinks ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
          {showBacklinks && <BacklinkList entityId={entityId} />}
        </div>
      )}

      {/* Actions */}
      <div className="nb-expansion-actions">
        <button
          type="button"
          className="nb-expansion-action nb-expansion-action--primary"
          onClick={() => expand()}
        >
          <Zap className="h-3 w-3" aria-hidden="true" />
          Expand with agent
        </button>
        <button type="button" className="nb-expansion-action">
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Open report
        </button>
        <button type="button" className="nb-expansion-action">
          <Link2 className="h-3 w-3" aria-hidden="true" />
          {data.backlinkCount} backlink{data.backlinkCount !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}
