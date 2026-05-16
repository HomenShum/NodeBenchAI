# Report Graph Topology Runtime

## Goal

Make the Reports graph topology a runtime primitive for both humans and agents.

The graph has three views:

- `density`: where attention keeps gravitating.
- `pca`: dominant axes of variation across reports, entities, artifacts, sources, freshness, and causal links.
- `centroid`: typical center versus outlier edge cases.

## Runtime Path

```text
Convex report artifacts
  -> reportGraphNeighborhood query
  -> reportTopology runtime graph
  -> density / PCA / centroid projection
  -> Mapper clusters
  -> reportTopologySnapshots table
  -> Reports graph UI
  -> graph context bridge
  -> inspect_topology_shape MCP tool
```

## What Is Persisted

`reportTopologySnapshots` stores a bounded, derived snapshot:

- `snapshotKey`
- `graphHash`
- `view`
- `mode`
- node projections
- Mapper clusters and cluster edges
- PCA axis labels
- bounded graph source metadata

The snapshot is derived data. Convex report artifacts remain the source of truth.

## Agent Contract

Agents should use topology after memory/search and before live search:

```text
search_memory
search_report_context
inspect_topology_shape
decide whether to expand cluster, inspect outlier, or reuse first-ring context
```

The `inspect_topology_shape` tool returns:

- selected node projection
- graph node metadata
- Mapper clusters
- first-ring neighbors
- retrieval plan for human and agent use
- recommended actions

## UI Contract

Reports graph consumes Convex topology when available and falls back to client projection when needed.

DOM QA hooks:

- `data-topology-view`
- `data-topology-source`
- `data-topology-persisted`
- `data-topology-cluster-count`
- `data-topology-hot-node`
- `data-topology-outlier-node`

## Design Grounding

This preserves the product direction:

- humans get readable views and clusters, not an unbounded node cloud
- agents get a bounded retrieval strategy before expensive live search
- Convex remains source of truth
- topology snapshots are derived, refreshable, and safe to discard
