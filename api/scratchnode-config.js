// api/scratchnode-config.js — Phase 1 of scratchnode.live live prod plan
//
// Returns the Convex URL + feature flags to the static home-v5.html prototype
// so it can connect to the real backend. The URL itself is public (every
// Convex client connects to it openly), so this endpoint is unauthenticated.
//
// Cache: 60s edge — the URL never changes mid-session.

export default function handler(req, res) {
  const convexUrl = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL || "";
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    convexUrl,
    // Feature flags so the client can stay defensive even after deploy.
    realtime: !!convexUrl,
    // Build-time identifier for debugging (helps tell "did the new bundle land?")
    builtAt: new Date().toISOString(),
  });
}
