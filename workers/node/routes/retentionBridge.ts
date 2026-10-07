/**
 * Retention Bridge API — Integration between NodeBench Delta and retention.sh / Attrition
 *
 * POST /retention/register  — Register retention.sh team connection
 * POST /retention/sync      — Sync QA findings from retention.sh
 * GET  /retention/status    — Get retention.sh connection status
 * POST /retention/webhook   — Receive retention.sh events
 * POST /retention/push-packet — Ingest delta packets
 * GET  /retention/packets   — List ingested packets
 *
 * All write endpoints forward a non-blocking copy to the Attrition backend
 * (Cloud Run) when available. If Attrition is down, NodeBench continues
 * working normally with its local in-memory state.
 */

import { Router } from "express";
import type { WorkflowEnvelope } from "../lib/workflowEnvelope.js";
import { getTrajectoryStats, listTrajectorySummaries, estimateCostSaved } from "../lib/trajectoryStore.js";

// ── Attrition backend forwarding ─────────────────────────────────────────────

const ATTRITION_BACKEND =
  process.env.ATTRITION_URL || "https://attrition-7xtb75zi5q-uc.a.run.app";

/**
 * Forward a request to the Attrition backend. Non-blocking — returns null on
 * any failure so NodeBench continues with local handling.
 */
async function forwardToAttrition(
  path: string,
  method: string,
  body?: unknown
): Promise<unknown | null> {
  try {
    const resp = await fetch(`${ATTRITION_BACKEND}/api/retention${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) return resp.json();
    return null;
  } catch {
    // Attrition backend not available — continue with local handling
    return null;
  }
}

// In-memory retention state (production would persist via Convex)
interface RetentionConnection {
  teamCode: string;
  peerId: string;
  connectedAt: string;
  lastSync: string | null;
  qaScore: number | null;
  memberCount: number | null;
  tokensSaved: number | null;
  version: string | null;
}

let retentionConnection: RetentionConnection | null = null;

// Bounded event log
const MAX_EVENTS = 200;
const eventLog: Array<{ type: string; timestamp: string; data: unknown }> = [];

function logEvent(type: string, data: unknown): void {
  eventLog.push({ type, timestamp: new Date().toISOString(), data });
  if (eventLog.length > MAX_EVENTS) {
    eventLog.splice(0, eventLog.length - MAX_EVENTS);
  }
}

export function createRetentionBridgeRouter(): Router {
  const router = Router();

  // Register retention.sh team connection
  router.post("/register", (req, res) => {
    try {
      const { teamCode, peerId, version, memberCount } = req.body as {
        teamCode?: string;
        peerId?: string;
        version?: string;
        memberCount?: number;
      };

      if (!teamCode) {
        res.status(400).json({ error: "teamCode is required" });
        return;
      }

      retentionConnection = {
        teamCode,
        peerId: peerId || `peer:monitor:retention:${teamCode}`,
        connectedAt: new Date().toISOString(),
        lastSync: null,
        qaScore: null,
        memberCount: memberCount || null,
        tokensSaved: null,
        version: version || null,
      };

      logEvent("registered", { teamCode, peerId: retentionConnection.peerId });

      // Forward to Attrition backend (non-blocking)
      forwardToAttrition("/register", "POST", req.body).catch(() => {});

      res.status(201).json({
        status: "connected",
        sessionId: `rs_${Date.now().toString(36)}`,
        teamCode,
        peerId: retentionConnection.peerId,
        hint: "retention.sh is now connected. QA findings will be synced as delta packets.",
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Registration failed", detail: String(err) });
      }
    }
  });

  // Sync QA findings from retention.sh
  router.post("/sync", (req, res) => {
    try {
      const { qaFindings, qaScore, tokensSaved, teamMembers } = req.body as {
        qaFindings?: Array<{ page: string; score: number; issues: string[] }>;
        qaScore?: number;
        tokensSaved?: number;
        teamMembers?: number;
      };

      if (retentionConnection) {
        retentionConnection.lastSync = new Date().toISOString();
        if (qaScore !== undefined) retentionConnection.qaScore = qaScore;
        if (tokensSaved !== undefined) retentionConnection.tokensSaved = tokensSaved;
        if (teamMembers !== undefined) retentionConnection.memberCount = teamMembers;
      }

      const findingCount = qaFindings?.length || 0;
      logEvent("sync", { findingCount, qaScore, tokensSaved });

      // Forward to Attrition backend (non-blocking)
      forwardToAttrition("/sync", "POST", req.body).catch(() => {});

      res.json({
        status: "synced",
        findingsReceived: findingCount,
        qaScore,
        hint: "QA findings are now available as context for delta_brief runs.",
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Sync failed", detail: String(err) });
      }
    }
  });

  // Get retention.sh connection status
  router.get("/status", (_req, res) => {
    if (!retentionConnection) {
      res.json({
        connected: false,
        hint: "retention.sh is not connected. Install: RETENTION_TEAM=<CODE> curl -sL retention.sh/install.sh | bash",
      });
      return;
    }

    res.json({
      connected: true,
      ...retentionConnection,
      dashboardUrl: `https://retention.sh/memory/team?team=${retentionConnection.teamCode}`,
      recentEvents: eventLog.slice(-10),
    });
  });

  // Receive retention.sh webhook events
  router.post("/webhook", (req, res) => {
    try {
      const { event, data } = req.body as { event?: string; data?: unknown };

      if (!event) {
        res.status(400).json({ error: "event type is required" });
        return;
      }

      logEvent(event, data);

      // Forward to Attrition backend (non-blocking)
      forwardToAttrition("/webhook", "POST", req.body).catch(() => {});

      // Update QA score if it's a crawl_complete event
      if (event === "crawl_complete" && retentionConnection && data) {
        const d = data as Record<string, unknown>;
        if (typeof d.qaScore === "number") {
          retentionConnection.qaScore = d.qaScore;
        }
      }

      res.json({ received: true, event });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Webhook processing failed", detail: String(err) });
      }
    }
  });

  // Ingest delta packets from MCP tools into the shared context layer
  // This is the MCP → Dashboard sync bridge
  router.post("/push-packet", (req, res) => {
    try {
      const packet = req.body as {
        type?: string;
        subject?: string;
        summary?: string;
        persona?: string;
        confidence?: number;
        payload?: unknown;
      };

      if (!packet.type || !packet.subject) {
        res.status(400).json({ error: "type and subject are required" });
        return;
      }

      logEvent("packet_ingested", {
        type: packet.type,
        subject: packet.subject,
        confidence: packet.confidence,
      });

      // Forward to Attrition backend (non-blocking)
      forwardToAttrition("/push-packet", "POST", req.body).catch(() => {});

      // Update retention connection stats if present
      if (retentionConnection) {
        retentionConnection.lastSync = new Date().toISOString();
      }

      // The packet is now logged in the event stream.
      // When Convex is wired, this will also:
      // - delta.brief → ambientIntelligenceOps.enqueueIngestion
      // - delta.diligence → founder.ingestSignal
      // - delta.memo → sharedContextOps.publishPacket
      // - delta.handoff → founder.createTaskPacket
      // - delta.watch → founder.createRelatedEntity

      // HONEST_STATUS: 202 Accepted (event log only, not durably persisted)
      res.status(202).json({
        status: "accepted",
        persisted: false,
        type: packet.type,
        subject: packet.subject,
        hint: "Packet stored in event stream. Dashboard will reflect changes on next refresh.",
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Packet ingestion failed", detail: String(err) });
      }
    }
  });

  // Get recent ingested packets (for dashboard polling)
  router.get("/packets", (_req, res) => {
    const packetEvents = eventLog
      .filter((e) => e.type === "packet_ingested")
      .slice(-20);
    res.json({ packets: packetEvents, count: packetEvents.length });
  });

  // ── NEW: Accept WorkflowEnvelope (canonical envelope format) ──────────────

  router.post("/push-envelope", (req, res) => {
    try {
      const envelope = req.body as WorkflowEnvelope;

      // Validate required fields
      if (!envelope?.transport?.envelopeId || !envelope?.content?.subject || !envelope?.content?.summary) {
        res.status(400).json({
          error: "Invalid envelope: transport.envelopeId, content.subject, and content.summary are required",
        });
        return;
      }

      logEvent("envelope_ingested", {
        envelopeId: envelope.transport.envelopeId,
        envelopeType: envelope.transport.envelopeType,
        subject: envelope.content.subject,
        entityName: envelope.content.entityName,
        confidence: envelope.content.confidence,
        sourceCount: envelope.proof?.sourceRefs?.length ?? 0,
        traceSteps: envelope.trace?.steps?.length ?? 0,
      });

      // Forward to Attrition backend (non-blocking)
      forwardToAttrition("/push-envelope", "POST", req.body).catch(() => {});

      if (retentionConnection) {
        retentionConnection.lastSync = new Date().toISOString();
      }

      // HONEST_STATUS: 202 Accepted (event log only)
      res.status(202).json({
        status: "accepted",
        persisted: false,
        envelopeId: envelope.transport.envelopeId,
        envelopeType: envelope.transport.envelopeType,
        hint: "Envelope stored in event stream. Use /retention/savings for cost metrics.",
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Envelope ingestion failed", detail: String(err) });
      }
    }
  });

  // ── NEW: Aggregate savings stats from trajectory store ──────────────────

  router.get("/savings", (_req, res) => {
    try {
      const stats = getTrajectoryStats();

      const estimatedCostSavedUsd = estimateCostSaved(stats);

      res.json({
        ...stats,
        estimatedCostSavedUsd,
        retentionConnected: !!retentionConnection,
        hint: stats.totalTrajectories === 0
          ? "No trajectories recorded yet. Run a search via /api/pipeline/search to start recording."
          : `${stats.totalTrajectories} trajectories, ${stats.totalReplays} replays. Avg ${stats.avgTokenSavingsPct}% token savings.`,
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Savings query failed", detail: String(err) });
      }
    }
  });

  // ── NEW: List stored search trajectories with replay stats ──────────────

  router.get("/trajectories", (req, res) => {
    try {
      const entityName = req.query.entityName as string | undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 100);

      const trajectories = listTrajectorySummaries({ entityName, limit });

      res.json({
        trajectories: trajectories.map((t) => ({
          trajectoryId: t.trajectoryId,
          entityName: t.entityName,
          lens: t.lens,
          query: t.query,
          success: t.success,
          replayCount: t.replayCount,
          avgTokenSavings: t.avgTokenSavings,
          avgTimeSavings: t.avgTimeSavings,
          driftScore: t.driftScore,
          totalDurationMs: t.totalDurationMs,
          totalSteps: t.totalSteps,
          envelopeId: t.envelopeId,
          createdAt: t.createdAt,
        })),
        count: trajectories.length,
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Trajectory list failed", detail: String(err) });
      }
    }
  });

  return router;
}
