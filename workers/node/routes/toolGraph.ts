/**
 * toolGraph.ts — API endpoint serving REAL tool registry graph data.
 * No demo data. 365 nodes, 56 domains, 935+ edges from actual toolRegistry.
 */

import { Router } from "express";

export function createToolGraphRouter() {
  const router = Router();

  router.get("/tool-graph", async (_req, res) => {
    try {
      const { ALL_REGISTRY_ENTRIES } = await import(
        "../../packages/mcp-local/src/tools/toolRegistry.js"
      );

      const entries = ALL_REGISTRY_ENTRIES as any[];

      // Build nodes
      const nodes = entries.map((e: any) => ({
        id: e.name,
        domain: e.category || "unknown",
        tags: e.tags || [],
        phase: e.phase || null,
        nextTools: e.quickRef?.nextTools || [],
        methodology: e.quickRef?.methodology || null,
      }));

      // Build edges from quickRef.nextTools
      const edges: Array<{ source: string; target: string; type: string }> = [];
      for (const e of entries) {
        const next = (e as any).quickRef?.nextTools || [];
        for (const t of next) {
          edges.push({ source: e.name, target: t, type: "next" });
        }
      }

      // Domain summary
      const domains: Record<string, number> = {};
      for (const e of entries) {
        const d = (e as any).category || "unknown";
        domains[d] = (domains[d] || 0) + 1;
      }

      res.json({
        nodes: nodes.length,
        edges: edges.length,
        domains: Object.keys(domains).length,
        avgEdgesPerNode: +(edges.length / nodes.length).toFixed(1),
        domainSizes: Object.entries(domains)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count })),
        // Send top 50 most-connected nodes for the graph viz (full 365 is too dense for SVG)
        graphNodes: nodes
          .map((n) => ({
            ...n,
            edgeCount: edges.filter(
              (e) => e.source === n.id || e.target === n.id
            ).length,
          }))
          .sort((a, b) => b.edgeCount - a.edgeCount)
          .slice(0, 60),
        graphEdges: edges.filter((e) => {
          // Only edges between the top 60 nodes
          const top60 = new Set(
            nodes
              .map((n) => ({
                id: n.id,
                ec: edges.filter(
                  (ed) => ed.source === n.id || ed.target === n.id
                ).length,
              }))
              .sort((a, b) => b.ec - a.ec)
              .slice(0, 60)
              .map((n) => n.id)
          );
          return top60.has(e.source) && top60.has(e.target);
        }),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
