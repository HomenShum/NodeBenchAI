/**
 * execute.ts — REST API for NodeBench → Claude Code implementation execution.
 *
 * POST /execute      — Execute an approved implementation packet via Claude Code
 * GET  /execute/:id  — Check execution status
 * GET  /execute/history — List past executions
 */

import { Router, type Request, type Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { executeViaClaudeCode } from "../claudeCodeBridge.js";

const WORKSPACE_ROOT = path.join(os.homedir(), ".nodebench", "workspace");
const IMPL_PATH = path.join(WORKSPACE_ROOT, "tasks", "implementations.json");

interface ImplementationPacket {
  id: string;
  objective: string;
  whyNow: string;
  scope: string[];
  constraints: string[];
  successCriteria: string[];
  validation: string[];
  context: string;
  status: string;
  agentType: string;
  priority: string;
  result?: { filesChanged: string[]; testsPassed: boolean; diffSummary: string; costUsd: number; durationMs: number };
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface PacketList { packets: ImplementationPacket[]; lastUpdated: string }

function loadPackets(): PacketList {
  if (!fs.existsSync(IMPL_PATH)) return { packets: [], lastUpdated: new Date().toISOString() };
  try { return JSON.parse(fs.readFileSync(IMPL_PATH, "utf-8")); }
  catch { return { packets: [], lastUpdated: new Date().toISOString() }; }
}

function savePackets(list: PacketList): void {
  list.lastUpdated = new Date().toISOString();
  const dir = path.dirname(IMPL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(IMPL_PATH, JSON.stringify(list, null, 2));
}

// ── Active executions (bounded, max 10) ──────────────────────────────────

const activeExecutions = new Map<string, { status: string; startedAt: number }>();
const MAX_ACTIVE = 10;

export function createExecuteRouter(): Router {
  const router = Router();

  // POST /execute — execute an implementation packet
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { packetId } = req.body ?? {};
      if (!packetId) return res.status(400).json({ ok: false, error: "packetId required" });

      const packets = loadPackets();
      const idx = packets.packets.findIndex(p => p.id === packetId);
      if (idx === -1) return res.status(404).json({ ok: false, error: `Packet not found: ${packetId}` });

      const packet = packets.packets[idx];
      if (packet.status !== "approved") {
        return res.status(400).json({ ok: false, error: `Packet must be approved first (current: ${packet.status})` });
      }

      if (activeExecutions.size >= MAX_ACTIVE) {
        return res.status(429).json({ ok: false, error: `Max ${MAX_ACTIVE} concurrent executions. Wait for one to finish.` });
      }

      // Mark as executing
      packet.status = "executing";
      packet.updatedAt = new Date().toISOString();
      savePackets(packets);
      activeExecutions.set(packetId, { status: "executing", startedAt: Date.now() });

      // Send immediate response
      res.json({ ok: true, status: "executing", packetId, message: "Execution started. Poll GET /execute/:id for status." });

      // Execute in background (non-blocking)
      executeViaClaudeCode(packet).then(result => {
        const updated = loadPackets();
        const i = updated.packets.findIndex(p => p.id === packetId);
        if (i >= 0) {
          if (result.success) {
            updated.packets[i].status = "completed";
            updated.packets[i].result = {
              filesChanged: result.filesChanged,
              testsPassed: result.testsPassed,
              diffSummary: result.diffSummary,
              costUsd: result.costUsd,
              durationMs: result.durationMs,
            };
          } else {
            updated.packets[i].status = "failed";
            updated.packets[i].errorMessage = result.errorMessage;
          }
          updated.packets[i].updatedAt = new Date().toISOString();
          savePackets(updated);
        }
        activeExecutions.delete(packetId);
      }).catch(err => {
        const updated = loadPackets();
        const i = updated.packets.findIndex(p => p.id === packetId);
        if (i >= 0) {
          updated.packets[i].status = "failed";
          updated.packets[i].errorMessage = err?.message ?? "Execution crashed";
          updated.packets[i].updatedAt = new Date().toISOString();
          savePackets(updated);
        }
        activeExecutions.delete(packetId);
      });
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ ok: false, error: err?.message ?? "execute failed" });
    }
  });

  // GET /execute/:id — check execution status
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const packets = loadPackets();
      const packet = packets.packets.find(p => p.id === id);
      if (!packet) return res.status(404).json({ ok: false, error: `Packet not found: ${id}` });

      const active = activeExecutions.get(id);
      res.json({
        ok: true,
        packet,
        isActive: !!active,
        elapsedMs: active ? Date.now() - active.startedAt : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /execute/history — list all executions
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const packets = loadPackets();
      const counts = {
        total: packets.packets.length,
        draft: packets.packets.filter(p => p.status === "draft").length,
        approved: packets.packets.filter(p => p.status === "approved").length,
        executing: packets.packets.filter(p => p.status === "executing").length,
        completed: packets.packets.filter(p => p.status === "completed").length,
        failed: packets.packets.filter(p => p.status === "failed").length,
      };
      res.json({ ok: true, packets: packets.packets, counts, activeExecutions: activeExecutions.size });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}
