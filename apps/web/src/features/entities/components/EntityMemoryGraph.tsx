type GraphNode = {
  id: string;
  label: string;
  type: "entity" | "related" | "evidence";
  x: number;
  y: number;
  slug?: string;
};

type EntityMemoryGraphProps = {
  entityName: string;
  relatedEntities?: Array<{ slug: string; name: string; entityType: string; reason?: string }>;
  evidence?: Array<{ _id?: string; label: string; type?: string }>;
  onOpenEntity?: (slug: string) => void;
};

function clampNodes<T>(items: T[], max: number) {
  return items.slice(0, Math.max(0, max));
}

export function EntityMemoryGraph({
  entityName,
  relatedEntities = [],
  evidence = [],
  onOpenEntity,
}: EntityMemoryGraphProps) {
  const centerNode: GraphNode = {
    id: "center",
    label: entityName,
    type: "entity",
    x: 50,
    y: 38,
  };

  const relatedNodes = clampNodes(relatedEntities, 5).map((entity, index, list) => {
    const spread = list.length === 1 ? 0.5 : index / Math.max(1, list.length - 1);
    return {
      id: `related-${entity.slug}`,
      label: entity.name,
      type: "related" as const,
      x: 10 + spread * 80,
      y: 10 + (index % 2 === 0 ? 0 : 8),
      slug: entity.slug,
    };
  });

  const evidenceNodes = clampNodes(evidence, 4).map((item, index, list) => {
    const spread = list.length === 1 ? 0.5 : index / Math.max(1, list.length - 1);
    return {
      id: `evidence-${item._id ?? item.label}-${index}`,
      label: item.label,
      type: "evidence" as const,
      x: 18 + spread * 64,
      y: 72 + (index % 2 === 0 ? 0 : 8),
    };
  });

  const nodes = [centerNode, ...relatedNodes, ...evidenceNodes];

  return (
    <div className="nb-panel-inset relative overflow-hidden p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
        Memory graph
      </div>

      <div className="relative h-[320px] rounded-[20px] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {relatedNodes.map((node) => (
            <line
              key={`edge-${node.id}`}
              x1={centerNode.x}
              y1={centerNode.y}
              x2={node.x}
              y2={node.y}
              stroke="currentColor"
              className="text-[rgba(217,119,87,0.35)]"
              strokeWidth="0.35"
            />
          ))}
          {evidenceNodes.map((node) => (
            <line
              key={`edge-${node.id}`}
              x1={centerNode.x}
              y1={centerNode.y}
              x2={node.x}
              y2={node.y}
              stroke="currentColor"
              className="text-[rgba(148,163,184,0.3)]"
              strokeWidth="0.35"
            />
          ))}
        </svg>

        {nodes.map((node) => {
          const positionStyle = {
            left: `${node.x}%`,
            top: `${node.y}%`,
          };
          const nodeClass =
            node.type === "entity"
              ? "border-[#d97757]/35 bg-[#d97757]/10 text-content"
              : node.type === "related"
                ? "border-white/10 bg-[#1d232b] text-content"
                : "border-white/8 bg-[#171c23] text-content-muted";

          const inner = (
            <div className={`max-w-[180px] rounded-2xl border px-3 py-2 text-left shadow-[0_10px_30px_rgba(15,23,42,0.18)] ${nodeClass}`}>
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">
                {node.type === "entity" ? "Current entity" : node.type === "related" ? "Linked memory" : "Evidence"}
              </div>
              <div className="mt-1 text-sm font-medium leading-5">{node.label}</div>
            </div>
          );

          const nodeSlug = (node as GraphNode).slug;
          return nodeSlug && onOpenEntity ? (
            <button
              key={node.id}
              type="button"
              onClick={() => onOpenEntity(nodeSlug)}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition hover:scale-[1.02]"
              style={positionStyle}
            >
              {inner}
            </button>
          ) : (
            <div
              key={node.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={positionStyle}
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default EntityMemoryGraph;
