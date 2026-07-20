/**
 * Product API Routes — Canonical backend for the 5 product surfaces.
 *
 * GET/POST /api/reports    — saved research reports
 * GET/POST /api/nudges     — reminders and actions
 * GET/POST /api/chat       — chat sessions
 * GET/POST /api/me         — private context
 */

import { Router, type Request, type Response } from "express";
import { wrapRoute } from "../lib/wrapRoute.js";
import {
  saveReport, listReports, getReport, pinReport,
  createNudge, listNudges, dismissNudge,
  createChatSession, listChatSessions, completeChatSession,
  saveMeContext, listMeContext,
} from "../lib/canonicalModels.js";

export function createProductRouter(): Router {
  const router = Router();

  // ── Reports ────────────────────────────────────────────────────────

  router.get("/reports", (_req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(_req.query.limit) || 20, 100);
      res.json({ reports: listReports(limit) });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.get("/reports/:id", (req: Request, res: Response) => {
    try {
      const report = getReport(req.params.id);
      if (!report) { res.status(404).json({ error: "Report not found" }); return; }
      res.json(report);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.post("/reports", (req: Request, res: Response) => {
    try {
      const { title, entityName, type, summary, confidence, lens, query, packetJson, envelopeId, sourceCount, contradictionCount } = req.body;
      if (!title || !query) { res.status(400).json({ error: "title and query required" }); return; }
      const id = saveReport({
        title: String(title).slice(0, 200),
        entityName: entityName ? String(entityName).slice(0, 200) : undefined,
        type: String(type ?? "company").slice(0, 50),
        summary: String(summary ?? "").slice(0, 1000),
        confidence: Math.max(0, Math.min(100, Number(confidence) || 0)),
        lens: String(lens ?? "founder").slice(0, 20),
        query: String(query).slice(0, 2000),
        packetJson: String(packetJson ?? "{}").slice(0, 50000),
        envelopeId,
        sourceCount: Math.max(0, Number(sourceCount) || 0),
        contradictionCount: Math.max(0, Number(contradictionCount) || 0),
        pinned: false, status: "saved",
      });
      res.status(201).json({ reportId: id });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.post("/reports/:id/pin", (req: Request, res: Response) => {
    try {
      pinReport(req.params.id, req.body.pinned !== false);
      res.json({ ok: true });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  // ── Nudges ─────────────────────────────────────────────────────────

  router.get("/nudges", (_req: Request, res: Response) => {
    try {
      const status = String(_req.query.status ?? "active");
      const limit = Math.min(Number(_req.query.limit) || 20, 100);
      res.json({ nudges: listNudges(status, limit) });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.post("/nudges", (req: Request, res: Response) => {
    try {
      const { type, title, summary, priority, linkedReportId, actionLabel, actionTarget, dueAt } = req.body;
      if (!type || !title) { res.status(400).json({ error: "type and title required" }); return; }
      const id = createNudge({
        type, title, summary: summary ?? "", priority: priority ?? "normal",
        status: "active", linkedReportId, actionLabel, actionTarget, dueAt,
      });
      res.status(201).json({ nudgeId: id });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.post("/nudges/:id/dismiss", (req: Request, res: Response) => {
    try {
      dismissNudge(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  // ── Chat Sessions ──────────────────────────────────────────────────

  router.get("/chat/sessions", (_req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(_req.query.limit) || 10, 50);
      res.json({ sessions: listChatSessions(limit) });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.post("/chat/sessions", (req: Request, res: Response) => {
    try {
      const { query, lens } = req.body;
      if (!query) { res.status(400).json({ error: "query required" }); return; }
      const id = createChatSession(query, lens ?? "founder");
      res.status(201).json({ chatId: id });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.post("/chat/sessions/:id/complete", (req: Request, res: Response) => {
    try {
      const { reportId, eventCount } = req.body;
      completeChatSession(req.params.id, reportId ?? "", eventCount ?? 0);
      res.json({ ok: true });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  // ── Me Context ─────────────────────────────────────────────────────

  router.get("/me/context", (_req: Request, res: Response) => {
    try {
      const type = _req.query.type as string | undefined;
      const limit = Math.min(Number(_req.query.limit) || 20, 100);
      res.json({ items: listMeContext(type, limit) });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  router.post("/me/context", (req: Request, res: Response) => {
    try {
      const { type, title, summary, entityRef, tags } = req.body;
      if (!type || !title) { res.status(400).json({ error: "type and title required" }); return; }
      const id = saveMeContext({ type, title, summary, entityRef, tags });
      res.status(201).json({ contextId: id });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
