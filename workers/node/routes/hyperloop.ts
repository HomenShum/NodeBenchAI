import { Router } from "express";
import { getArchiveStats } from "../../packages/mcp-local/src/sync/hyperloopArchive.js";
import {
  computeImprovementAtK,
  listRecentEvaluations,
  listTrackedClassifications,
} from "../../packages/mcp-local/src/sync/hyperloopEval.js";

export function createHyperloopRouter(): Router {
  const router = Router();

  router.get("/stats", (_req, res) => {
    try {
      const archive = getArchiveStats();
      const recentEvals = listRecentEvaluations(12);
      const improvementCurve = Object.fromEntries(
        listTrackedClassifications(6).map((classification) => [
          classification,
          computeImprovementAtK(classification, 5),
        ]),
      );

      res.json({
        archive,
        recentEvals,
        improvementCurve,
      });
    } catch (error: any) {
      res.status(500).json({
        error: true,
        message: error?.message ?? "Failed to load HyperLoop stats",
        archive: { total: 0, byType: {}, byStatus: {}, avgQuality: 0 },
        recentEvals: [],
        improvementCurve: {},
      });
    }
  });

  return router;
}

