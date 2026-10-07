/**
 * Share API — Shareable packet URLs for delta packets
 *
 * POST /share/create   — Create a shareable link for a packet
 * GET  /share/:shareId — Render a public view of the packet (no auth)
 * DELETE /share/:shareId — Revoke a share link
 */

import { Router } from "express";

// In-memory share store (production would use Convex)
const MAX_SHARES = 1000;
const shares = new Map<string, { packetId: string; packetType: string; subject: string; summary: string; payload: unknown; visibility: string; createdAt: string; expiresAt: string }>();

function evictOldest(): void {
  if (shares.size >= MAX_SHARES) {
    const oldest = shares.keys().next().value;
    if (oldest) shares.delete(oldest);
  }
}

function genShareId(): string {
  return `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createShareRouter(): Router {
  const router = Router();

  // Create a shareable link
  router.post("/create", (req, res) => {
    try {
      const { packetId, packetType, subject, summary, payload, visibility } = req.body as {
        packetId?: string;
        packetType?: string;
        subject?: string;
        summary?: string;
        payload?: unknown;
        visibility?: string;
      };

      if (!subject) {
        res.status(400).json({ error: "subject is required" });
        return;
      }

      evictOldest();
      const shareId = genShareId();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

      shares.set(shareId, {
        packetId: packetId || shareId,
        packetType: packetType || "memo",
        subject: subject || "",
        summary: summary || "",
        payload: payload || {},
        visibility: visibility || "public",
        createdAt,
        expiresAt,
      });

      const host = req.get("host") || "nodebenchai.com";
      const protocol = req.protocol || "https";
      const shareUrl = `${protocol}://${host}/share/${shareId}`;

      res.status(201).json({
        shareId,
        shareUrl,
        expiresAt,
        hint: "Share this URL — recipients can view the packet without signing in.",
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to create share link", detail: String(err) });
      }
    }
  });

  // Render a shared packet (public, no auth)
  router.get("/:shareId", (req, res) => {
    const { shareId } = req.params;
    const share = shares.get(shareId);

    if (!share) {
      res.status(404).json({ error: "Share link not found or expired" });
      return;
    }

    // Check expiry
    if (new Date(share.expiresAt) < new Date()) {
      shares.delete(shareId);
      res.status(410).json({ error: "Share link has expired" });
      return;
    }

    res.json({
      packetId: share.packetId,
      type: share.packetType,
      subject: share.subject,
      summary: share.summary,
      payload: share.payload,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
    });
  });

  // Revoke a share link
  router.delete("/:shareId", (req, res) => {
    const { shareId } = req.params;
    const existed = shares.delete(shareId);
    res.json({ revoked: existed, shareId });
  });

  return router;
}
