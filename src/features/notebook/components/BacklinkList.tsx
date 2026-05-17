/**
 * BacklinkList — Renders bidirectional backlinks for an entity.
 * Shows typed edges (mention, citation, supports, contradicts, etc.)
 * with source context and confidence scores.
 *
 * Pattern: Convex subscription via useEntityExpansion hook.
 * Prior art: Roam Research backlinks panel, Obsidian backlinks.
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md
 */
import {
  ArrowRight,
  Quote,
  Link2,
  Zap,
  AlertTriangle,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { useBacklinks } from "../hooks/useEntityExpansion";

const LINK_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof Link2 }
> = {
  mention: { label: "Mention", color: "var(--accent, #d97757)", icon: ArrowRight },
  citation: { label: "Citation", color: "#60a5fa", icon: Quote },
  relatedTo: { label: "Related", color: "#a78bfa", icon: Link2 },
  causes: { label: "Causes", color: "#f472b6", icon: Zap },
  supports: { label: "Supports", color: "#4ade80", icon: CheckCircle2 },
  contradicts: { label: "Contradicts", color: "#f87171", icon: AlertTriangle },
  derived: { label: "Derived", color: "#94a3b8", icon: FileText },
};

type BacklinkListProps = {
  entityId: string;
};

export function BacklinkList({ entityId }: BacklinkListProps) {
  const { backlinks, loading } = useBacklinks(entityId);

  if (loading) {
    return (
      <div className="nb-backlink-list nb-backlink-list--loading">
        <span className="nb-backlink-loading-text">Loading backlinks...</span>
      </div>
    );
  }

  if (!backlinks || backlinks.length === 0) {
    return (
      <div className="nb-backlink-list nb-backlink-list--empty">
        <span>No backlinks found.</span>
      </div>
    );
  }

  return (
    <div className="nb-backlink-list" role="list" aria-label="Backlinks">
      {backlinks.map((bl, i) => {
        const config = LINK_TYPE_CONFIG[bl.type] ?? LINK_TYPE_CONFIG.mention;
        const TypeIcon = config.icon;

        return (
          <div
            key={`${bl.from}-${bl.type}-${(bl.context ?? "").slice(0, 20)}-${i}`}
            className="nb-backlink-item"
            role="listitem"
          >
            <span
              className="nb-backlink-type-badge"
              style={{ borderColor: config.color, color: config.color }}
            >
              <TypeIcon className="h-2.5 w-2.5" aria-hidden="true" />
              {config.label}
            </span>
            <span className="nb-backlink-from">{bl.from}</span>
            {bl.context && (
              <span className="nb-backlink-context">{bl.context}</span>
            )}
            {typeof bl.confidence === "number" && (
              <span
                className="nb-backlink-confidence"
                title={`Confidence: ${Math.round(bl.confidence * 100)}%`}
              >
                {Math.round(bl.confidence * 100)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
