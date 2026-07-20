/**
 * Watchlist API — Entity monitoring with change alerts
 *
 * POST   /watchlist/add          — Add entity to watchlist
 * DELETE /watchlist/remove/:name — Remove entity
 * GET    /watchlist/list         — List all watched entities
 * POST   /watchlist/refresh      — Trigger refresh of all watched entities
 * GET    /watchlist/alerts       — Get recent change alerts
 */

import { Router } from "express";

// In-memory watchlist (production would use SQLite via MCP tools or Convex)
const MAX_WATCHLIST = 100;

interface WatchedEntity {
  id: string;
  entityName: string;
  addedAt: string;
  lastChecked: string | null;
  alertPreferences: string[];
  changeCount: number;
  lastChangeSummary: string | null;
}

const watchlist = new Map<string, WatchedEntity>();

function genId(): string {
  return `we_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createWatchlistRouter(): Router {
  const router = Router();

  // Add entity to watchlist
  router.post("/add", (req, res) => {
    try {
      const { entityName, alertPreferences } = req.body as {
        entityName?: string;
        alertPreferences?: string[];
      };

      if (!entityName) {
        res.status(400).json({ error: "entityName is required" });
        return;
      }

      // Check if already watching
      for (const [, entry] of watchlist) {
        if (entry.entityName.toLowerCase() === entityName.toLowerCase()) {
          res.json({ status: "already_watching", entity: entry });
          return;
        }
      }

      if (watchlist.size >= MAX_WATCHLIST) {
        res.status(429).json({ error: `Watchlist full (max ${MAX_WATCHLIST} entities)` });
        return;
      }

      const id = genId();
      const entity: WatchedEntity = {
        id,
        entityName,
        addedAt: new Date().toISOString(),
        lastChecked: null,
        alertPreferences: alertPreferences || ["any_material"],
        changeCount: 0,
        lastChangeSummary: null,
      };

      watchlist.set(id, entity);
      res.status(201).json({ status: "added", entity });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to add entity", detail: String(err) });
      }
    }
  });

  // Remove entity
  router.delete("/remove/:name", (req, res) => {
    const name = decodeURIComponent(req.params.name).toLowerCase();
    let removed = false;
    for (const [id, entry] of watchlist) {
      if (entry.entityName.toLowerCase() === name) {
        watchlist.delete(id);
        removed = true;
        break;
      }
    }
    res.json({ removed, entityName: req.params.name });
  });

  // List all watched entities
  router.get("/list", (_req, res) => {
    const entities = Array.from(watchlist.values()).sort(
      (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );
    res.json({ entities, count: entities.length });
  });

  // Trigger refresh
  router.post("/refresh", (_req, res) => {
    const now = new Date().toISOString();
    for (const [, entry] of watchlist) {
      entry.lastChecked = now;
    }
    res.json({
      refreshed: watchlist.size,
      hint: "Use web_search or delta_diligence on each entity to detect actual changes.",
    });
  });

  // Get recent alerts
  router.get("/alerts", (_req, res) => {
    const alerts = Array.from(watchlist.values())
      .filter((e) => e.changeCount > 0)
      .map((e) => ({
        entityName: e.entityName,
        changeCount: e.changeCount,
        lastChange: e.lastChangeSummary,
        lastChecked: e.lastChecked,
      }));
    res.json({ alerts, count: alerts.length });
  });

  return router;
}
