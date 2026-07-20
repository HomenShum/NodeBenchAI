/**
 * Subconscious REST API — exposes memory blocks, graph queries, and whisper generation.
 */

import { Router, type Request, type Response } from "express";
import {
  getAllBlocks,
  getBlock,
  updateBlock,
  getStaleBlocks,
  getBlockSummary,
  ensureBlocksExist,
  getRecentWhispers,
  type BlockType,
  ALL_BLOCK_TYPES,
} from "../../packages/mcp-local/src/subconscious/blocks.js";
import { getGraphSummary } from "../../packages/mcp-local/src/subconscious/graphEngine.js";
import { classifyPrompt } from "../../packages/mcp-local/src/subconscious/classifier.js";
import { generateWhisper, type SubconsciousMode } from "../../packages/mcp-local/src/subconscious/whisperPolicy.js";

export function createSubconsciousRouter(): Router {
  const router = Router();

  // ── Health ─────────────────────────────────────────────────────────────

  router.get("/health", (_req: Request, res: Response) => {
    try {
      ensureBlocksExist();
      res.json({ ok: true, service: "subconscious", blockCount: ALL_BLOCK_TYPES.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Blocks ─────────────────────────────────────────────────────────────

  router.get("/blocks", (_req: Request, res: Response) => {
    try {
      const blocks = getAllBlocks();
      res.json({ ok: true, blocks });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/blocks/:id", (req: Request, res: Response) => {
    try {
      const id = req.params.id as BlockType;
      if (!ALL_BLOCK_TYPES.includes(id)) {
        res.status(400).json({ ok: false, error: `Invalid block ID. Valid: ${ALL_BLOCK_TYPES.join(", ")}` });
        return;
      }
      const block = getBlock(id);
      res.json({ ok: true, block });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/blocks/:id", (req: Request, res: Response) => {
    try {
      const id = req.params.id as BlockType;
      if (!ALL_BLOCK_TYPES.includes(id)) {
        res.status(400).json({ ok: false, error: `Invalid block ID` });
        return;
      }
      const { value, confidence } = req.body;
      if (typeof value !== "string") {
        res.status(400).json({ ok: false, error: "value (string) is required" });
        return;
      }
      const updated = updateBlock(id, {
        value,
        confidence: confidence ?? "medium",
        sourceEvent: `api_update_${Date.now()}`,
      });
      res.json({ ok: true, block: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Summary ────────────────────────────────────────────────────────────

  router.get("/summary", (_req: Request, res: Response) => {
    try {
      const blocks = getAllBlocks();
      const populated = blocks.filter((b) => b.value.length > 0);
      const stale = getStaleBlocks(7);
      res.json({
        ok: true,
        summary: getBlockSummary(),
        totalBlocks: ALL_BLOCK_TYPES.length,
        populatedBlocks: populated.length,
        staleCount: stale.length,
        staleBlocks: stale.map((b) => ({ id: b.id, label: b.label, updatedAt: b.updatedAt })),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Whisper Log ────────────────────────────────────────────────────────

  router.get("/whispers/:sessionId", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const whispers = getRecentWhispers(req.params.sessionId, Math.min(limit, 100));
      res.json({ ok: true, whispers });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Graph ──────────────────────────────────────────────────────────────

  router.get("/graph/summary", (_req: Request, res: Response) => {
    try {
      const summary = getGraphSummary();
      res.json({ ok: true, ...summary });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Classify + Whisper ────────────────────────────────────────────���────

  router.post("/classify", (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        res.status(400).json({ ok: false, error: "prompt is required" });
        return;
      }
      const result = classifyPrompt(prompt);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/whisper", (req: Request, res: Response) => {
    try {
      const { prompt, mode, session_id } = req.body;
      if (!prompt) {
        res.status(400).json({ ok: false, error: "prompt is required" });
        return;
      }
      const result = generateWhisper(
        prompt,
        session_id ?? "api",
        (mode as SubconsciousMode) ?? "whisper"
      );
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
