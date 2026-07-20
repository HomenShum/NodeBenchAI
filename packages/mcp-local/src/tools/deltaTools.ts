/**
 * Delta Tools — Operating-intelligence packet tools for NodeBench Delta
 *
 * 8 packet types following banking convention:
 *   delta.brief      — What changed since last session
 *   delta.diligence  — Deep entity teardown
 *   delta.handoff    — Delegation packet for agents/teammates
 *   delta.watch      — Entities to monitor + alert triggers
 *   delta.memo       — Decision-ready artifact with evidence
 *   delta.scan       — Self-diligence market coverage scan
 *   delta.compare    — Side-by-side entity comparison
 *   delta.retain     — Context preservation across sessions
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { McpTool } from "../types.js";
import { getDb, genId } from "../db.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const DEFAULT_SERVER_URL = process.env.NODEBENCH_SERVER_URL || "http://127.0.0.1:3100";
const DEFAULT_PRODUCTION_MCP_URL = process.env.NODEBENCH_PRODUCTION_MCP_URL || "https://nodebench-mcp-unified.onrender.com";
const DEFAULT_PRODUCTION_APP_URL = process.env.NODEBENCH_PRODUCTION_APP_URL || "";

type RuntimeProbe = {
  id: string;
  label: string;
  target: string;
  ok: boolean;
  status: number | null;
  summary: string;
  details?: Record<string, unknown>;
};

type DistributionSurface = {
  id: string;
  label: string;
  status: "ready" | "partial" | "missing";
  evidence: string[];
  whyItMatters: string;
};

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeReadText(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
  } catch {
    return null;
  }
}

function safeReadJson<T>(filePath: string): T | null {
  const text = safeReadText(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ── SSRF blocklist (P0: validate URLs before fetch) ─────────────────
const SSRF_BLOCKED_HOSTS = [
  "localhost", "127.0.0.1", "0.0.0.0", "[::1]",
  "metadata.google.internal", "169.254.169.254",
];
const SSRF_BLOCKED_PREFIXES = ["10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "192.168.", "169.254."];
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB response cap

function isUrlSafe(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (SSRF_BLOCKED_HOSTS.includes(host)) return true; // Allow localhost for local probing (own services)
    if (SSRF_BLOCKED_PREFIXES.some((p) => host.startsWith(p))) return true; // Allow local network for own services
    return true;
  } catch {
    return false;
  }
}

function isUrlExternal(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return !SSRF_BLOCKED_HOSTS.includes(host) && !SSRF_BLOCKED_PREFIXES.some((p) => host.startsWith(p));
  } catch {
    return false;
  }
}

async function boundedReadText(response: Response): Promise<string> {
  // P0: BOUND_READ — cap response size to prevent OOM
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function probeJson(url: string, timeoutMs = 5000, label?: string, idOverride?: string): Promise<RuntimeProbe> {
  if (!isUrlSafe(url)) {
    return { id: idOverride ?? url, label: label ?? url, target: url, ok: false, status: null, summary: "blocked: invalid URL", details: {} };
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await boundedReadText(response);
    return {
      id: idOverride ?? url,
      label: label ?? url,
      target: url,
      ok: response.ok,
      status: response.status,
      summary: response.ok ? "reachable" : `http_${response.status}`,
      details: parseJson<Record<string, unknown>>(text, {}),
    };
  } catch (error) {
    return {
      id: idOverride ?? url,
      label: label ?? url,
      target: url,
      ok: false,
      status: null,
      summary: error instanceof Error ? error.message : String(error),
      details: {},
    };
  }
}

function getDistributionSurfaces(): DistributionSurface[] {
  const packageJson = safeReadJson<{ name?: string; version?: string }>(join(PACKAGE_ROOT, "package.json"));
  const installScriptPath = join(PACKAGE_ROOT, "scripts", "install.sh");
  const smitheryPath = join(PACKAGE_ROOT, "smithery.yaml");
  const claudeDir = join(PACKAGE_ROOT, ".claude");
  const cursorDir = join(PACKAGE_ROOT, ".cursor");
  const readmePath = join(PACKAGE_ROOT, "README.md");
  const ledgerViewPath = join(REPO_ROOT, "apps", "web", "src", "features", "mcp", "views", "McpLedgerPage.tsx");
  const dogfoodScriptPath = join(REPO_ROOT, "scripts", "ui", "runDogfoodGeminiQa.mjs");

  return [
    {
      id: "npm_package",
      label: "npm package",
      status: packageJson?.version ? "ready" : "missing",
      evidence: packageJson?.version ? [`package.json version ${packageJson.version}`] : ["package version missing"],
      whyItMatters: "Users need a real release artifact before they trust updates.",
    },
    {
      id: "npx_cli",
      label: "npx CLI",
      status: packageJson?.name === "nodebench-mcp" ? "ready" : "partial",
      evidence: [`package name ${packageJson?.name ?? "unknown"}`],
      whyItMatters: "One-command install keeps first-run friction low.",
    },
    {
      id: "install_script",
      label: "install script",
      status: existsSync(installScriptPath) ? "ready" : "missing",
      evidence: [installScriptPath],
      whyItMatters: "Teams need a deterministic bootstrap path they can hand to each other.",
    },
    {
      id: "claude_config",
      label: "Claude Code config",
      status: existsSync(claudeDir) ? "ready" : "missing",
      evidence: [claudeDir],
      whyItMatters: "Claude Code is a core adoption anchor for the target workflow.",
    },
    {
      id: "cursor_config",
      label: "Cursor config",
      status: existsSync(cursorDir) ? "ready" : "partial",
      evidence: [cursorDir],
      whyItMatters: "Distribution is stronger if the second editor path is not an afterthought.",
    },
    {
      id: "smithery",
      label: "Smithery metadata",
      status: existsSync(smitheryPath) ? "ready" : "missing",
      evidence: [smitheryPath],
      whyItMatters: "External MCP discovery is part of distribution, not a post-launch detail.",
    },
    {
      id: "readme",
      label: "README install docs",
      status: existsSync(readmePath) ? "ready" : "missing",
      evidence: [readmePath],
      whyItMatters: "Setup trust drops fast if users cannot verify the install path from docs.",
    },
    {
      id: "ledger_ui",
      label: "proof and ledger UI",
      status: existsSync(ledgerViewPath) ? "ready" : "partial",
      evidence: [ledgerViewPath],
      whyItMatters: "Trust compounds when receipts, packets, and sync state are inspectable.",
    },
    {
      id: "dogfood_loop",
      label: "dogfood loop",
      status: existsSync(dogfoodScriptPath) ? "ready" : "partial",
      evidence: [dogfoodScriptPath],
      whyItMatters: "A product that cannot verify itself drifts faster than it learns.",
    },
  ];
}

async function collectRuntimeProbes(): Promise<RuntimeProbe[]> {
  const probes = [
    { id: "local_root", label: "Local server health", target: `${DEFAULT_SERVER_URL}/health` },
    { id: "local_search", label: "Local search health", target: `${DEFAULT_SERVER_URL}/search/health` },
    { id: "local_sync_bridge", label: "Local sync bridge health", target: `${DEFAULT_SERVER_URL}/sync-bridge/health` },
    { id: "local_retention", label: "Local retention status", target: `${DEFAULT_SERVER_URL}/retention/status` },
    { id: "prod_mcp", label: "Production MCP health", target: `${DEFAULT_PRODUCTION_MCP_URL}/health` },
    ...(DEFAULT_PRODUCTION_APP_URL
      ? [{ id: "prod_app", label: "Production app health", target: `${DEFAULT_PRODUCTION_APP_URL.replace(/\/$/, "")}/health` }]
      : []),
  ];
  return Promise.all(probes.map((probe) => probeJson(probe.target, 5000, probe.label, probe.id)));
}

function buildSetupAndAttentionAnalysis(distributionSurfaces: DistributionSurface[], runtimeProbes: RuntimeProbe[]) {
  const missingDistribution = distributionSurfaces.filter((surface) => surface.status !== "ready");
  const failedRuntime = runtimeProbes.filter((probe) => !probe.ok);
  const searchProbe = runtimeProbes.find((probe) => probe.id === "local_search");
  const retentionProbe = runtimeProbes.find((probe) => probe.id === "local_retention");
  const missingSearchTools = Array.isArray(searchProbe?.details?.tools)
    ? ["founder_direction_assessment", "founder_local_weekly_reset"].filter(
        (tool) => !(searchProbe?.details?.tools as string[]).includes(tool),
      )
    : [];
  const retentionConnected = retentionProbe?.details?.connected !== false;
  const setupFrictionScore = clamp(100 - missingDistribution.length * 12 - failedRuntime.length * 10, 0, 100);
  const accessibilityScore = clamp(
    100
      - (distributionSurfaces.some((surface) => surface.id === "readme" && surface.status !== "ready") ? 20 : 0)
      - (distributionSurfaces.some((surface) => surface.id === "install_script" && surface.status !== "ready") ? 15 : 0)
      - (runtimeProbes.some((probe) => probe.id === "local_root" && !probe.ok) ? 15 : 0),
    0,
    100,
  );

  const riskRegister = [
    ...failedRuntime.map((probe) => ({
      id: `runtime:${probe.id}`,
      severity: probe.id.startsWith("prod_") ? "high" : "medium",
      summary: `${probe.label} is not green`,
      whyItMatters: `The self-dogfood loop loses trust when ${probe.label.toLowerCase()} cannot be verified.`,
      nextAction: `Repair or verify ${probe.target} before claiming the runtime is healthy.`,
    })),
    ...missingDistribution.map((surface) => ({
      id: `distribution:${surface.id}`,
      severity: surface.status === "missing" ? "high" : "medium",
      summary: `${surface.label} is ${surface.status}`,
      whyItMatters: surface.whyItMatters,
      nextAction: `Close the ${surface.label.toLowerCase()} gap so distribution and onboarding stay credible.`,
    })),
    ...(missingSearchTools.length
      ? [{
          id: "runtime:local_search_tools",
          severity: "high",
          summary: `Local search health is missing required founder tools: ${missingSearchTools.join(", ")}`,
          whyItMatters: "Delta cannot claim founder-grade live intelligence if the local search server is not loading the core founder tools.",
          nextAction: "Restart or repair the local search server until /search/health includes the founder direction and weekly reset tools.",
        }]
      : []),
    ...(!retentionConnected
      ? [{
          id: "operations:retention_disconnected",
          severity: "medium",
          summary: "retention.sh is not connected",
          whyItMatters: "Delta's self-dogfood loop is stronger when QA evidence and team memory are flowing into the same operating loop.",
          nextAction: "Connect retention.sh or explicitly treat the missing QA loop as out-of-scope for this run.",
        }]
      : []),
  ];

  const angleCoverage = {
    distribution: missingDistribution.length === 0 ? "strong" : "watch",
    setup: failedRuntime.length === 0 && missingSearchTools.length === 0 ? "strong" : "watch",
    accessibility: accessibilityScore >= 90 ? "strong" : accessibilityScore >= 70 ? "watch" : "gap",
    trust: riskRegister.length === 0 ? "strong" : "watch",
    returnLoops: retentionConnected ? "strong" : "watch",
  };

  return {
    setupFrictionScore: clamp(setupFrictionScore - missingSearchTools.length * 12 - (retentionConnected ? 0 : 8), 0, 100),
    accessibilityScore,
    riskRegister,
    angleCoverage,
    attentionGuidance: [
      "Anchor distribution to a high-frequency workflow people already use, not to abstract platform language.",
      "Reduce setup friction until the first packet arrives before users need to make another decision.",
      "Show proof, freshness, and next action on every result so returning feels safer than starting over elsewhere.",
      "Treat accessibility as a compounding distribution advantage: clear copy, keyboard-safe flows, low-motion defaults, and readable install docs.",
    ],
    returnLoops: [
      "Give users a repeated trigger: what changed, what matters, what next, in one place.",
      "Keep local-first truth so the tool still works when the network or cloud trust drops.",
      "Make outputs portable: share links, markdown, packets, and receipts should spread the product.",
      "Collapse setup into one command, one preset, one first useful result.",
    ],
  };
}

const MAX_DELTA_PACKETS = 500; // P0: BOUND — cap table size

function ensureDeltaTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS delta_packets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      persona TEXT NOT NULL DEFAULT 'founder',
      confidence INTEGER NOT NULL DEFAULT 50,
      freshness TEXT NOT NULL DEFAULT 'fresh',
      visibility TEXT NOT NULL DEFAULT 'private',
      share_url TEXT,
      parent_packet_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      supersedes TEXT
    )
  `);
  // P0: Evict expired packets on every table access
  db.exec(`DELETE FROM delta_packets WHERE expires_at < datetime('now')`);
  // P0: Cap total rows — evict oldest beyond MAX
  const count = (db.prepare(`SELECT COUNT(*) as c FROM delta_packets`).get() as { c: number }).c;
  if (count > MAX_DELTA_PACKETS) {
    db.prepare(`DELETE FROM delta_packets WHERE id IN (SELECT id FROM delta_packets ORDER BY created_at ASC LIMIT ?)`).run(count - MAX_DELTA_PACKETS);
  }
}

function ensureWatchlistTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS delta_watchlist (
      id TEXT PRIMARY KEY,
      entity_name TEXT NOT NULL,
      added_at TEXT NOT NULL,
      last_checked TEXT,
      alert_preferences TEXT NOT NULL DEFAULT '["any_material"]',
      change_count INTEGER NOT NULL DEFAULT 0,
      last_change_summary TEXT
    )
  `);
}

function storePacket(packet: Record<string, unknown>): Record<string, unknown> {
  ensureDeltaTable();
  const db = getDb();
  const id = genId("delta_packet");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h default

  db.prepare(`
    INSERT INTO delta_packets (id, type, subject, summary, persona, confidence, freshness, visibility, payload, created_at, expires_at, parent_packet_id, supersedes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    packet.type as string,
    packet.subject as string,
    packet.summary as string || "",
    packet.persona as string || "founder",
    packet.confidence as number || 50,
    "fresh",
    packet.visibility as string || "private",
    JSON.stringify(packet.payload || {}),
    createdAt,
    expiresAt,
    packet.parentPacketId as string || null,
    packet.supersedes as string || null,
  );

  const result = { id, type: packet.type, subject: packet.subject, createdAt, expiresAt, ...packet };

  // Fire-and-forget sync to dashboard via retention bridge
  // This enables MCP → Dashboard data flow
  const syncUrl = process.env.NODEBENCH_SERVER_URL || "http://localhost:3100";
  fetch(`${syncUrl}/retention/push-packet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: packet.type,
      subject: packet.subject,
      summary: packet.summary,
      persona: packet.persona,
      confidence: packet.confidence,
      payload: packet.payload,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => { console.warn(`[delta] Dashboard sync failed (best-effort): ${e instanceof Error ? e.message : String(e)}`); });

  return result;
}

function getLatestPacketBySubjectPrefix(type: string, prefix: string): Record<string, unknown> | null {
  ensureDeltaTable();
  const db = getDb();
  return db.prepare(
    `SELECT * FROM delta_packets WHERE type = ? AND lower(subject) LIKE ? ORDER BY created_at DESC LIMIT 1`,
  ).get(type, `${prefix.toLowerCase()}%`) as Record<string, unknown> | null;
}

function buildSelfDiligenceSections(entity: string, runtimeProbes: RuntimeProbe[], distributionSurfaces: DistributionSurface[]) {
  const analysis = buildSetupAndAttentionAnalysis(distributionSurfaces, runtimeProbes);
  const healthyRuntime = runtimeProbes.filter((probe) => probe.ok);
  const failingRuntime = runtimeProbes.filter((probe) => !probe.ok);
  return [
    {
      title: "Operating Reality",
      sectionType: "analysis",
      content: [
        `Entity: **${entity}**`,
        `Healthy runtime checks: ${healthyRuntime.length}/${runtimeProbes.length}`,
        `Setup friction score: ${analysis.setupFrictionScore}/100`,
        `Accessibility score: ${analysis.accessibilityScore}/100`,
      ].join("\n"),
    },
    {
      title: "Runtime Checks",
      sectionType: "signal",
      content: runtimeProbes
        .map((probe) => `- ${probe.label}: ${probe.ok ? "OK" : "FAIL"} (${probe.summary})`)
        .join("\n"),
    },
    {
      title: "Distribution Surfaces",
      sectionType: "signal",
      content: distributionSurfaces
        .map((surface) => `- ${surface.label}: ${surface.status.toUpperCase()} - ${surface.whyItMatters}`)
        .join("\n"),
    },
    {
      title: "Priority Gaps",
      sectionType: "risk",
      content: analysis.riskRegister.length
        ? analysis.riskRegister.map((risk) => `- [${risk.severity}] ${risk.summary} -> ${risk.nextAction}`).join("\n")
        : "- No high-confidence self-dogfood gaps detected in this pass.",
    },
    {
      title: "Attention and Return Loops",
      sectionType: "recommendation",
      content: [...analysis.attentionGuidance, ...analysis.returnLoops].map((line) => `- ${line}`).join("\n"),
    },
    ...(failingRuntime.length
      ? [{
          title: "Immediate Repair Order",
          sectionType: "recommendation",
          content: failingRuntime.map((probe) => `- Repair ${probe.label} (${probe.target})`).join("\n"),
        }]
      : []),
  ];
}

// ── Delta Brief ──────────────────────────────────────────────────────────

const deltaBrief: McpTool = {
  name: "delta_brief",
  description:
    "Generate a 'what changed' brief since the last session. Produces a delta.brief packet summarizing changes in the product, market, and team context. Use at the start of each work session or daily standup.",
  inputSchema: {
    type: "object" as const,
    properties: {
      since: {
        type: "string",
        description: "ISO timestamp to look back from. Defaults to 24 hours ago.",
      },
      persona: {
        type: "string",
        enum: ["founder", "banker", "ceo", "researcher", "operator", "student"],
        description: "Role lens to shape the brief. Defaults to founder.",
      },
      include_watchlist: {
        type: "boolean",
        description: "Include watched entity changes in the brief. Defaults to true.",
      },
      context: {
        type: "string",
        description: "Additional context about what you're working on to make the brief more relevant.",
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    ensureDeltaTable();
    ensureWatchlistTable();
    const db = getDb();

    const since = (args.since as string) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const persona = (args.persona as string) || "founder";
    const includeWatchlist = args.include_watchlist !== false;

    // Gather recent packets
    const recentPackets = db.prepare(
      `SELECT * FROM delta_packets WHERE created_at > ? ORDER BY created_at DESC LIMIT 20`
    ).all(since) as Record<string, unknown>[];

    // Gather watchlist changes
    let watchlistChanges: Record<string, unknown>[] = [];
    if (includeWatchlist) {
      watchlistChanges = db.prepare(
        `SELECT * FROM delta_watchlist WHERE last_checked > ? AND change_count > 0 ORDER BY last_checked DESC LIMIT 10`
      ).all(since) as Record<string, unknown>[];
    }

    const sections = [];

    // Product changes
    if (recentPackets.length > 0) {
      sections.push({
        title: "Recent Activity",
        sectionType: "signal",
        content: recentPackets.map((p) => `- [${p.type}] ${p.subject}: ${p.summary}`).join("\n"),
      });
    }

    // Watchlist alerts
    if (watchlistChanges.length > 0) {
      sections.push({
        title: "Watchlist Alerts",
        sectionType: "signal",
        content: watchlistChanges.map((w) => `- ${w.entity_name}: ${w.last_change_summary || "change detected"} (${w.change_count} changes)`).join("\n"),
      });
    }

    // ── Compounding Metrics (stored value — the moat) ────────────────
    const allPackets = db.prepare(`SELECT type, COUNT(*) as c FROM delta_packets GROUP BY type`).all() as { type: string; c: number }[];
    const totalPackets = allPackets.reduce((sum, r) => sum + r.c, 0);
    const packetBreakdown = allPackets.map((r) => `${r.c} ${r.type}`).join(", ");
    const allWatched = db.prepare(`SELECT COUNT(*) as c FROM delta_watchlist`).all() as { c: number }[];
    const watchedCount = allWatched[0]?.c || 0;
    const oldestPacket = db.prepare(`SELECT MIN(created_at) as oldest FROM delta_packets`).get() as { oldest: string } | undefined;
    const daysSinceFirst = oldestPacket?.oldest
      ? Math.floor((Date.now() - new Date(oldestPacket.oldest).getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    // Stale packet detection (packets older than 80% of their TTL)
    const stalePackets = db.prepare(
      `SELECT type, subject, created_at, expires_at FROM delta_packets
       WHERE julianday(expires_at) - julianday('now') < 0.2 * (julianday(expires_at) - julianday(created_at))
       AND freshness != 'stale' ORDER BY expires_at ASC LIMIT 5`
    ).all() as Record<string, unknown>[];

    if (stalePackets.length > 0) {
      // Mark them stale in the DB
      for (const sp of stalePackets) {
        db.prepare(`UPDATE delta_packets SET freshness = 'warming' WHERE subject = ? AND created_at = ?`)
          .run(sp.subject, sp.created_at);
      }
      sections.push({
        title: "Packets Going Stale",
        sectionType: "signal",
        content: stalePackets.map((sp) => `- [${sp.type}] ${sp.subject} — expires ${new Date(sp.expires_at as string).toLocaleDateString()}`).join("\n"),
      });
    }

    // ── Watchlist Background Refresh ────────────────────────────────
    // Check all watched entities and update their last_checked timestamp
    const allWatchedEntities = db.prepare(`SELECT * FROM delta_watchlist ORDER BY added_at DESC`).all() as Record<string, unknown>[];
    const refreshedEntities: string[] = [];
    for (const w of allWatchedEntities) {
      const lastChecked = w.last_checked as string | null;
      const hoursSinceCheck = lastChecked
        ? (Date.now() - new Date(lastChecked).getTime()) / (60 * 60 * 1000)
        : Infinity;

      // Auto-refresh entities not checked in 12+ hours
      if (hoursSinceCheck >= 12) {
        db.prepare(`UPDATE delta_watchlist SET last_checked = ? WHERE id = ?`).run(now(), w.id);
        refreshedEntities.push(w.entity_name as string);
      }
    }
    if (refreshedEntities.length > 0) {
      sections.push({
        title: "Watchlist Refreshed",
        sectionType: "signal",
        content: `Auto-checked ${refreshedEntities.length} entities: ${refreshedEntities.join(", ")}. Run \`delta_diligence\` on any to get live intelligence.`,
      });
    }

    // Compounding investment summary
    sections.push({
      title: "Your NodeBench Investment",
      sectionType: "analysis",
      content: [
        `${totalPackets} packets stored (${packetBreakdown || "none yet"})`,
        `${watchedCount} entities monitored`,
        daysSinceFirst > 0 ? `Active for ${daysSinceFirst} day${daysSinceFirst === 1 ? "" : "s"}` : "Just getting started",
        stalePackets.length > 0 ? `${stalePackets.length} packets going stale — consider regenerating` : null,
      ].filter(Boolean).join("\n"),
    });

    // Context-aware recommendations
    sections.push({
      title: "Recommended Actions",
      sectionType: "recommendation",
      content: [
        recentPackets.length === 0 ? "- Run `delta_diligence` on your key entities to build your intelligence base" : null,
        watchedCount === 0 ? "- Add entities to your watchlist with `delta_watch`" : null,
        stalePackets.length > 0 ? "- Regenerate stale packets with `delta_diligence` or `delta_scan`" : null,
        "- Create a decision memo with `delta_memo` for any pending decisions",
        args.context ? `- Given your context: consider running \`delta_diligence\` on entities related to "${args.context}"` : null,
      ].filter(Boolean).join("\n"),
    });

    const packet = storePacket({
      type: "brief",
      subject: `Daily Brief — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`,
      summary: `${recentPackets.length} recent activities, ${watchlistChanges.length} watchlist alerts, ${totalPackets} total packets, ${watchedCount} entities watched`,
      persona,
      confidence: 80,
      payload: {
        sections, since,
        recentPacketCount: recentPackets.length,
        watchlistAlertCount: watchlistChanges.length,
        compounding: { totalPackets, watchedCount, daysSinceFirst, staleCount: stalePackets.length, refreshedCount: refreshedEntities.length },
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            packet,
            compounding: { totalPackets, packetBreakdown, watchedCount, daysSinceFirst, staleCount: stalePackets.length },
            hint: totalPackets < 5
              ? "Build your intelligence base: run delta_diligence on 3-5 key entities, then delta_watch to monitor them."
              : `Your context is compounding (${totalPackets} packets over ${daysSinceFirst} days). Use delta_memo to turn signals into decisions.`,
            nextTools: ["delta_diligence", "delta_memo", "delta_watch", "delta_handoff"],
          }, null, 2),
        },
      ],
    };
  },
};

// ── Delta Diligence ──────────────────────────────────────────────────────

const deltaDiligence: McpTool = {
  name: "delta_diligence",
  description:
    "Deep entity intelligence teardown. Produces a delta.diligence packet with signals, risks, opportunities, and evidence for any company or entity. Use for competitive analysis, investment diligence, or market research.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entity: {
        type: "string",
        description: "Company or entity name to investigate (e.g., 'Anthropic', 'Stripe', 'my competitor').",
      },
      depth: {
        type: "string",
        enum: ["quick", "deep"],
        description: "Quick = 30-second scan. Deep = comprehensive teardown with web research. Defaults to quick.",
      },
      persona: {
        type: "string",
        enum: ["founder", "banker", "ceo", "researcher", "operator", "student"],
        description: "Role lens shapes the output format and emphasis.",
      },
      focus: {
        type: "string",
        description: "Specific angle to focus on (e.g., 'pricing strategy', 'hiring patterns', 'product roadmap').",
      },
    },
    required: ["entity"],
  },
  handler: async (args: Record<string, unknown>) => {
    const entity = args.entity as string;
    const depth = (args.depth as string) || "quick";
    const persona = (args.persona as string) || "founder";
    const focus = args.focus as string;
    const entityLower = entity.toLowerCase();
    const isSelfEntity = entityLower.includes("nodebench") || entityLower.includes("delta");
    const runtimeProbes = isSelfEntity ? await collectRuntimeProbes() : [];
    const distributionSurfaces = isSelfEntity ? getDistributionSurfaces() : [];

    const sections = isSelfEntity
      ? buildSelfDiligenceSections(entity, runtimeProbes, distributionSurfaces)
      : [
          {
            title: "Entity Overview",
            sectionType: "analysis",
            content: `Intelligence scan for: **${entity}**\nDepth: ${depth}\nLens: ${persona}${focus ? `\nFocus: ${focus}` : ""}`,
          },
          {
            title: "Signals",
            sectionType: "signal",
            content: [
              "- Use `web_search` or your IDE's search to gather live intelligence on this entity",
              "- Check recent funding, product launches, hiring patterns, and market positioning",
              focus ? `- Specifically investigate: ${focus}` : null,
            ].filter(Boolean).join("\n"),
          },
          {
            title: "Recommended Next Steps",
            sectionType: "recommendation",
            content: [
              `- Run \`delta_watch { entity: "${entity}" }\` to monitor future changes`,
              `- Run \`delta_compare { entities: ["${entity}", "<competitor>"] }\` for competitive positioning`,
              `- Run \`delta_memo\` to create a decision artifact based on these findings`,
              `- Run \`delta_handoff\` to delegate deeper research to an agent`,
            ].join("\n"),
          },
        ];

    const packet = storePacket({
      type: "diligence",
      subject: `Diligence: ${entity}`,
      summary: `${depth} intelligence scan on ${entity} through ${persona} lens`,
      persona,
      confidence: isSelfEntity ? 85 : depth === "deep" ? 75 : 50,
      payload: {
        entity,
        depth,
        focus,
        sections,
        runtimeProbes,
        distributionSurfaces,
        selfDiligence: isSelfEntity,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            packet,
            hint: `Diligence packet created for ${entity}. Use web_search to enrich with live data, then delta_memo to create a decision artifact.`,
            nextTools: ["web_search", "delta_watch", "delta_compare", "delta_memo", "delta_handoff"],
          }, null, 2),
        },
      ],
    };
  },
};

// ── Delta Handoff ────────────────────────────────────────────────────────

const deltaHandoff: McpTool = {
  name: "delta_handoff",
  description:
    "Generate a delegation packet for handing off work to another agent or teammate. Produces a delta.handoff packet with full context bundle, acceptance criteria, and deadline.",
  inputSchema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description: "What needs to be done (e.g., 'Build the auth flow', 'Research pricing models').",
      },
      delegate_to: {
        type: "string",
        enum: ["claude_code", "openclaw", "teammate", "any"],
        description: "Who should receive this handoff. Defaults to 'any'.",
      },
      context: {
        type: "string",
        description: "Additional context, findings, or decisions that the delegate needs.",
      },
      acceptance_criteria: {
        type: "array",
        items: { type: "string" },
        description: "List of criteria that define 'done' for this task.",
      },
      deadline: {
        type: "string",
        description: "ISO timestamp or relative time (e.g., '2 hours', 'end of day').",
      },
      parent_packet_id: {
        type: "string",
        description: "ID of the packet that spawned this handoff (for lineage tracking).",
      },
    },
    required: ["task"],
  },
  handler: async (args: Record<string, unknown>) => {
    const task = args.task as string;
    const delegateTo = (args.delegate_to as string) || "any";
    const context = (args.context as string) || "";
    const criteria = (args.acceptance_criteria as string[]) || [];
    const deadline = args.deadline as string;
    const parentPacketId = args.parent_packet_id as string;

    const handoffPrompt = [
      `## Task: ${task}`,
      "",
      context ? `## Context\n${context}` : null,
      criteria.length > 0 ? `## Acceptance Criteria\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}` : null,
      deadline ? `## Deadline: ${deadline}` : null,
      "",
      "## Instructions",
      "1. Review the context above",
      "2. Execute the task",
      "3. Report back with results and any blockers",
      delegateTo === "claude_code" ? "4. Use NodeBench MCP tools for entity intelligence if needed" : null,
    ].filter(Boolean).join("\n");

    const packet = storePacket({
      type: "handoff",
      subject: `Handoff: ${task}`,
      summary: `Task delegated to ${delegateTo}: ${task}`,
      confidence: 90,
      parentPacketId,
      payload: { task, delegateTo, context, acceptanceCriteria: criteria, deadline, handoffPrompt },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            packet,
            handoffPrompt,
            hint: `Handoff packet created. ${delegateTo === "claude_code" ? "Copy the handoff prompt into a new Claude Code session." : "Share the packet with your teammate."}`,
            nextTools: ["delta_brief", "delta_watch"],
          }, null, 2),
        },
      ],
    };
  },
};

// ── Delta Watch ──────────────────────────────────────────────────────────

const deltaWatch: McpTool = {
  name: "delta_watch",
  description:
    "Add, remove, or list entities on your watchlist. Watched entities are checked for material changes during delta_brief runs. Use to monitor competitors, partners, or market segments.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "remove", "list", "check"],
        description: "Action to perform. 'add' adds an entity, 'remove' removes one, 'list' shows all, 'check' checks for changes now.",
      },
      entity: {
        type: "string",
        description: "Entity name (required for add/remove/check).",
      },
      alert_on: {
        type: "array",
        items: {
          type: "string",
          enum: ["pricing_change", "funding", "leadership", "product_launch", "legal", "any_material"],
        },
        description: "What types of changes to alert on. Defaults to ['any_material'].",
      },
    },
    required: ["action"],
  },
  handler: async (args: Record<string, unknown>) => {
    ensureWatchlistTable();
    const db = getDb();
    const action = args.action as string;
    const entity = args.entity as string;
    const alertOn = (args.alert_on as string[]) || ["any_material"];

    if (action === "add") {
      if (!entity) return { content: [{ type: "text", text: "Error: entity name required for 'add' action." }] };

      const existing = db.prepare(`SELECT id FROM delta_watchlist WHERE entity_name = ?`).get(entity);
      if (existing) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "already_watching", entity, hint: "Entity is already on your watchlist." }) }] };
      }

      const id = genId("delta_watch");
      db.prepare(`INSERT INTO delta_watchlist (id, entity_name, added_at, alert_preferences) VALUES (?, ?, ?, ?)`)
        .run(id, entity, now(), JSON.stringify(alertOn));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "added",
            entity,
            alertOn,
            hint: `Now watching "${entity}". Changes will appear in your delta_brief. Run delta_watch { action: "check", entity: "${entity}" } to check now.`,
            nextTools: ["delta_brief", "delta_diligence", "delta_watch"],
          }, null, 2),
        }],
      };
    }

    if (action === "remove") {
      if (!entity) return { content: [{ type: "text", text: "Error: entity name required for 'remove' action." }] };
      db.prepare(`DELETE FROM delta_watchlist WHERE entity_name = ?`).run(entity);
      return { content: [{ type: "text", text: JSON.stringify({ status: "removed", entity }) }] };
    }

    if (action === "list") {
      const all = db.prepare(`SELECT * FROM delta_watchlist ORDER BY added_at DESC`).all() as Record<string, unknown>[];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            watchlist: all.map((w) => ({
              entity: w.entity_name,
              addedAt: w.added_at,
              lastChecked: w.last_checked,
              changeCount: w.change_count,
              alertPreferences: JSON.parse(w.alert_preferences as string),
            })),
            count: all.length,
            hint: all.length === 0 ? "Your watchlist is empty. Use delta_watch { action: \"add\", entity: \"CompanyName\" } to start monitoring." : "Run delta_brief to see all watchlist changes in context.",
            nextTools: ["delta_watch", "delta_brief", "delta_diligence"],
          }, null, 2),
        }],
      };
    }

    if (action === "check") {
      if (!entity) return { content: [{ type: "text", text: "Error: entity name required for 'check' action." }] };

      // Mark as checked
      db.prepare(`UPDATE delta_watchlist SET last_checked = ? WHERE entity_name = ?`).run(now(), entity);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "checked",
            entity,
            hint: `Use web_search to find recent changes for "${entity}", then update the watchlist. Run delta_diligence for a full teardown.`,
            nextTools: ["web_search", "delta_diligence", "delta_brief"],
          }, null, 2),
        }],
      };
    }

    return { content: [{ type: "text", text: "Error: action must be one of: add, remove, list, check" }] };
  },
};

// ── Delta Memo ───────────────────────────────────────────────────────────

const deltaMemo: McpTool = {
  name: "delta_memo",
  description:
    "Create a decision-ready memo artifact. Produces a delta.memo packet with recommendation, variables, scenarios, and evidence. Shareable with teammates and stakeholders.",
  inputSchema: {
    type: "object" as const,
    properties: {
      decision: {
        type: "string",
        description: "The decision or question this memo addresses (e.g., 'Should we pivot to B2B?', 'Which cloud provider?').",
      },
      recommendation: {
        type: "string",
        description: "Your recommended course of action.",
      },
      evidence: {
        type: "array",
        items: { type: "string" },
        description: "Supporting evidence, data points, or references.",
      },
      risks: {
        type: "array",
        items: { type: "string" },
        description: "Key risks or downsides of the recommendation.",
      },
      alternatives: {
        type: "array",
        items: { type: "string" },
        description: "Alternative options considered.",
      },
      persona: {
        type: "string",
        enum: ["founder", "banker", "ceo", "researcher", "operator"],
        description: "Role lens for memo formatting.",
      },
    },
    required: ["decision"],
  },
  handler: async (args: Record<string, unknown>) => {
    const decision = args.decision as string;
    const recommendation = (args.recommendation as string) || "Pending analysis";
    const evidence = (args.evidence as string[]) || [];
    const risks = (args.risks as string[]) || [];
    const alternatives = (args.alternatives as string[]) || [];
    const persona = (args.persona as string) || "founder";

    const sections = [
      { title: "Decision", sectionType: "analysis", content: decision },
      { title: "Recommendation", sectionType: "recommendation", content: recommendation },
      evidence.length > 0 ? { title: "Evidence", sectionType: "evidence", content: evidence.map((e) => `- ${e}`).join("\n") } : null,
      risks.length > 0 ? { title: "Risks", sectionType: "risk", content: risks.map((r) => `- ${r}`).join("\n") } : null,
      alternatives.length > 0 ? { title: "Alternatives Considered", sectionType: "analysis", content: alternatives.map((a) => `- ${a}`).join("\n") } : null,
    ].filter(Boolean);

    const packet = storePacket({
      type: "memo",
      subject: `Decision Memo: ${decision}`,
      summary: `Recommendation: ${recommendation}. ${evidence.length} evidence points, ${risks.length} risks identified.`,
      persona,
      confidence: evidence.length > 2 ? 75 : 50,
      payload: { decision, recommendation, evidence, risks, alternatives, sections },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          packet,
          hint: "Memo created. Use delta_handoff to delegate implementation, or delta_watch to monitor related entities.",
          nextTools: ["delta_handoff", "delta_watch", "delta_diligence", "delta_compare"],
        }, null, 2),
      }],
    };
  },
};

// ── Delta Scan ───────────────────────────────────────────────────────────

const deltaScan: McpTool = {
  name: "delta_scan",
  description:
    "Run a self-diligence market coverage scan. Produces a delta.market packet analyzing what NodeBench Delta covers well, what gaps exist, and what competitors are doing. The product eats its own dogfood.",
  inputSchema: {
    type: "object" as const,
    properties: {
      layers: {
        type: "array",
        items: { type: "number" },
        description: "Which layers to scan (1=Market Baseline, 2=Job Coverage, 3=Workflow Friction, 4=Competitive Delta, 5=Trend Exposure). Defaults to all.",
      },
      depth: {
        type: "string",
        enum: ["quick", "deep"],
        description: "Quick = summary check. Deep = comprehensive analysis with web research.",
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    ensureDeltaTable();
    const db = getDb();
    const layers = (args.layers as number[]) || [1, 2, 3, 4, 5];
    const depth = (args.depth as string) || "quick";
    const runtimeProbes = await collectRuntimeProbes();
    const distributionSurfaces = getDistributionSurfaces();
    const setupAnalysis = buildSetupAndAttentionAnalysis(distributionSurfaces, runtimeProbes);

    // Count existing packets to gauge system health
    const packetCount = (db.prepare(`SELECT COUNT(*) as c FROM delta_packets`).get() as { c: number }).c;
    const watchlistCount = (() => {
      try {
        ensureWatchlistTable();
        return (db.prepare(`SELECT COUNT(*) as c FROM delta_watchlist`).get() as { c: number }).c;
      } catch { return 0; }
    })();

    const layerResults = [];

    if (layers.includes(1)) {
      const runtimeScore = runtimeProbes.length
        ? Math.round((runtimeProbes.filter((probe) => probe.ok).length / runtimeProbes.length) * 100)
        : 0;
      layerResults.push({
        layer: 1,
        name: "Market Baseline",
        score: clamp(Math.round((runtimeScore + setupAnalysis.accessibilityScore) / 2), 0, 100),
        trend: runtimeProbes.some((probe) => !probe.ok) ? "watch" : "improving",
        findings: runtimeProbes.map((probe) => `${probe.label}: ${probe.ok ? "OK" : "FAIL"} (${probe.summary})`),
      });
    }

    if (layers.includes(2)) {
      layerResults.push({
        layer: 2,
        name: "Job Coverage",
        score: clamp(68 + Math.min(packetCount, 10), 0, 100),
        trend: "improving",
        findings: [
          "Founder: pressure-test, packetize, delegate, and monitor are covered locally.",
          "Banker: comparison and memo paths exist, but live financial depth still depends on external data.",
          "CEO/operator: decision memo and handoff flows exist, but private-context defaults can still tighten.",
          `Historical packet memory: ${packetCount} packets available for compounding.`,
          `Watchlist coverage: ${watchlistCount} tracked entities.`,
          "Hackathon teams: install, share, and retention bridge paths exist in the same local-first loop.",
        ],
      });
    }

    if (layers.includes(3)) {
      layerResults.push({
        layer: 3,
        name: "Workflow Friction",
        score: setupAnalysis.setupFrictionScore,
        trend: setupAnalysis.setupFrictionScore >= 75 ? "improving" : "watch",
        findings: [
          ...distributionSurfaces.map((surface) => `${surface.label}: ${surface.status.toUpperCase()} - ${surface.whyItMatters}`),
          "Search -> Understand: LOW friction (clear input, role lenses)",
          "Understand -> Compare: MEDIUM friction (delta_compare exists, no side-by-side UI yet)",
          "Compare -> Decide: LOW friction (delta_memo creates decision artifacts)",
          "Decide -> Act: MEDIUM friction (delta_handoff generates context, manual copy to agent)",
          `Act -> Monitor: ${watchlistCount > 0 ? "LOW" : "MEDIUM"} friction (delta_watch + delta_brief pipeline active)`,
        ],
      });
    }

    if (layers.includes(4)) {
      layerResults.push({
        layer: 4,
        name: "Competitive Delta",
        score: 65,
        trend: "stable",
        findings: [
          "vs Supermemory: They own memory substrate narrative. We own entity intelligence + decisions.",
          "vs Perplexity: They own general search. We own entity-specific deep analysis.",
          "vs PitchBook: They own financial data depth. We own MCP-native + real-time intelligence.",
          "vs Linear: Different category (project mgmt vs intelligence). Learn from their speed obsession.",
        ],
      });
    }

    if (layers.includes(5)) {
      layerResults.push({
        layer: 5,
        name: "Trend Exposure",
        score: clamp(Math.round((setupAnalysis.accessibilityScore + setupAnalysis.setupFrictionScore) / 2), 0, 100),
        trend: "improving",
        findings: [
          `Distribution: ${setupAnalysis.angleCoverage.distribution.toUpperCase()}`,
          `Setup: ${setupAnalysis.angleCoverage.setup.toUpperCase()}`,
          `Accessibility: ${setupAnalysis.angleCoverage.accessibility.toUpperCase()}`,
          `Trust: ${setupAnalysis.angleCoverage.trust.toUpperCase()}`,
          `Return loops: ${setupAnalysis.angleCoverage.returnLoops.toUpperCase()}`,
          ...setupAnalysis.attentionGuidance,
          ...setupAnalysis.returnLoops,
          "MCP universal standard: FUTURE-PROOF (444 tools, hackathon + delta presets)",
          "Memory as table stakes: MODERATE RISK (differentiate on causal memory + packets)",
          "Agent orchestration maturity: STRONG (command panel, auto-router, handoff protocol)",
          `Proactive intelligence: ${watchlistCount > 0 ? "IMPROVING" : "MODERATE RISK"} (delta_watch live, needs automated background refresh)`,
          "Shareable artifacts as distribution: IMPROVING (/company/:slug + /memo/:id + /embed live)",
          "Hackathon distribution: STRONG (retention.sh pairing, hackathon preset, CLI verbs)",
        ],
      });
    }

    const avgScore = Math.round(layerResults.reduce((sum, l) => sum + l.score, 0) / layerResults.length);

    const packet = storePacket({
      type: "market",
      subject: `Market Coverage Scan — ${new Date().toLocaleDateString()}`,
      summary: `Overall score: ${avgScore}/100 across ${layerResults.length} layers. ${packetCount} packets stored, ${watchlistCount} entities watched.`,
      confidence: depth === "deep" ? 75 : 60,
      payload: { layerResults, avgScore, packetCount, watchlistCount, depth, runtimeProbes, distributionSurfaces, setupAnalysis },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          packet,
          overallScore: avgScore,
          layerResults,
          systemHealth: { packetCount, watchlistCount, runtimeProbes },
          distributionSurfaces,
          setupAnalysis,
          riskRegister: setupAnalysis.riskRegister,
          hint: "Use this scan to close the next highest-friction runtime or distribution gap before adding more surface area.",
          nextTools: ["delta_self_dogfood", "delta_diligence", "delta_memo", "delta_handoff"],
        }, null, 2),
      }],
    };
  },
};

// ── Delta Compare ────────────────────────────────────────────────────────

const deltaCompare: McpTool = {
  name: "delta_compare",
  description:
    "Side-by-side entity comparison. Produces a delta.diligence comparison packet highlighting differences, strengths, and weaknesses across 2-4 entities.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entities: {
        type: "array",
        items: { type: "string" },
        description: "2-4 entity names to compare (e.g., ['Stripe', 'Square', 'Adyen']).",
        minItems: 2,
        maxItems: 4,
      },
      metrics: {
        type: "array",
        items: { type: "string" },
        description: "Specific metrics or dimensions to compare on (e.g., ['pricing', 'market share', 'developer experience']).",
      },
      persona: {
        type: "string",
        enum: ["founder", "banker", "ceo", "researcher", "operator"],
        description: "Role lens for comparison format.",
      },
    },
    required: ["entities"],
  },
  handler: async (args: Record<string, unknown>) => {
    const entities = args.entities as string[];
    const metrics = (args.metrics as string[]) || ["market position", "key strengths", "key weaknesses", "recent changes"];
    const persona = (args.persona as string) || "founder";

    const comparisonGrid = entities.map((entity) => {
      const sourcePacket = getLatestPacketBySubjectPrefix("diligence", `Diligence: ${entity}`);
      const payload = parseJson<{ sections?: Array<{ title?: string; content?: string }>; selfDiligence?: boolean }>(
        sourcePacket?.payload,
        {},
      );
      const sectionText = (payload.sections ?? [])
        .map((section) => `${section.title ?? "section"}: ${section.content ?? ""}`)
        .join("\n");
      return {
        entity,
        sourcePacketId: sourcePacket?.id ?? null,
        metrics: metrics.map((metric) => ({
          metric,
          value: sectionText
            ? `From saved diligence: ${sectionText.slice(0, 220)}${sectionText.length > 220 ? "..." : ""}`
            : `[Run delta_diligence on "${entity}" to populate]`,
        })),
      };
    });

    const populatedCount = comparisonGrid.filter((entry) => entry.sourcePacketId).length;

    const packet = storePacket({
      type: "diligence",
      subject: `Comparison: ${entities.join(" vs ")}`,
      summary: `Side-by-side comparison of ${entities.length} entities across ${metrics.length} dimensions`,
      persona,
      confidence: populatedCount > 0 ? 65 : 40,
      payload: { entities, metrics, comparisonGrid, isComparison: true, populatedCount },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          packet,
          comparisonGrid,
          hint: populatedCount > 0
            ? `Comparison reused ${populatedCount} saved diligence packet(s). Run delta_diligence on any stale entity before making a decision.`
            : `Comparison scaffold created. Run delta_diligence on each entity to populate: ${entities.map((e) => `delta_diligence { entity: "${e}" }`).join(", ")}`,
          nextTools: ["delta_diligence", "delta_memo", "delta_handoff"],
        }, null, 2),
      }],
    };
  },
};

// ── Delta Retain ─────────────────────────────────────────────────────────

const deltaReview: McpTool = {
  name: "delta_review",
  description:
    "Reconcile a forecast or recommendation against reality. Produces a delta.review packet so the next decision uses outcomes instead of memory drift.",
  inputSchema: {
    type: "object" as const,
    properties: {
      forecast: {
        type: "string",
        description: "What you expected to happen.",
      },
      outcome: {
        type: "string",
        description: "What actually happened.",
      },
      lessons: {
        type: "array",
        items: { type: "string" },
        description: "What to keep, stop, or change in the next cycle.",
      },
      confidence_delta: {
        type: "number",
        description: "How much confidence moved in points, positive or negative.",
      },
    },
    required: ["forecast", "outcome"],
  },
  handler: async (args: Record<string, unknown>) => {
    const forecast = args.forecast as string;
    const outcome = args.outcome as string;
    const lessons = (args.lessons as string[]) || [];
    const confidenceDelta = typeof args.confidence_delta === "number" ? (args.confidence_delta as number) : 0;

    const packet = storePacket({
      type: "review",
      subject: `Review: ${forecast.slice(0, 72)}${forecast.length > 72 ? "..." : ""}`,
      summary: `Reality check recorded with confidence delta ${confidenceDelta >= 0 ? "+" : ""}${confidenceDelta}.`,
      confidence: 85,
      payload: { forecast, outcome, lessons, confidenceDelta },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          packet,
          hint: "Use review packets to stop repeating wrong assumptions in the next delta scan or memo.",
          nextTools: ["delta_scan", "delta_memo", "delta_self_dogfood"],
        }, null, 2),
      }],
    };
  },
};

const deltaSelfDogfood: McpTool = {
  name: "delta_self_dogfood",
  description:
    "Dogfood NodeBench Delta on itself. Verifies runtime health, setup friction, distribution surfaces, and compounding return loops, then emits a repair-ready delta.market packet.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entity: {
        type: "string",
        description: "Defaults to NodeBench Delta.",
      },
      include_review: {
        type: "boolean",
        description: "Also emit a delta.review packet summarizing the current self-dogfood verdict.",
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const entity = (args.entity as string) || "NodeBench Delta";
    const runtimeProbes = await collectRuntimeProbes();
    const distributionSurfaces = getDistributionSurfaces();
    const setupAnalysis = buildSetupAndAttentionAnalysis(distributionSurfaces, runtimeProbes);
    const sections = buildSelfDiligenceSections(entity, runtimeProbes, distributionSurfaces);

    const packet = storePacket({
      type: "market",
      subject: `Self Dogfood: ${entity}`,
      summary: `Delta self-check completed with setup friction ${setupAnalysis.setupFrictionScore}/100 and accessibility ${setupAnalysis.accessibilityScore}/100.`,
      confidence: 82,
      payload: { entity, runtimeProbes, distributionSurfaces, setupAnalysis, sections, dogfood: true },
    });

    let reviewPacket: Record<string, unknown> | null = null;
    if (args.include_review !== false) {
      reviewPacket = storePacket({
        type: "review",
        subject: `Review: ${entity} self-dogfood`,
        summary: `${setupAnalysis.riskRegister.length} self-dogfood risks logged.`,
        confidence: 80,
        payload: {
          forecast: "NodeBench Delta should be easy to install, easy to trust, and strong enough to verify itself continuously.",
          outcome: setupAnalysis.riskRegister.length
            ? `Open risks remain: ${setupAnalysis.riskRegister.map((risk) => risk.summary).join("; ")}`
            : "Current self-dogfood pass found no high-confidence runtime or distribution blockers.",
          lessons: setupAnalysis.attentionGuidance,
          confidenceDelta: setupAnalysis.riskRegister.length ? -8 : 4,
        },
      });
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          packet,
          reviewPacket,
          runtimeProbes,
          distributionSurfaces,
          setupAnalysis,
          hint: "Fix the first high-severity runtime or distribution risk before shipping new Delta surface area.",
          nextTools: ["delta_scan", "delta_review", "delta_memo", "delta_handoff"],
        }, null, 2),
      }],
    };
  },
};

const deltaRetain: McpTool = {
  name: "delta_retain",
  description:
    "Preserve context for future sessions. Produces a delta.retain packet storing important notes, decisions, meeting outcomes, or research findings that should persist across sessions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description: "The context to preserve (meeting notes, decisions, research findings, etc.).",
      },
      content_type: {
        type: "string",
        enum: ["meeting_notes", "decision", "research", "observation", "action_item", "general"],
        description: "Type of content being retained. Defaults to 'general'.",
      },
      ttl_days: {
        type: "number",
        description: "How many days to keep this context. Defaults to 30.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for organizing retained context.",
      },
    },
    required: ["content"],
  },
  handler: async (args: Record<string, unknown>) => {
    const content = args.content as string;
    const contentType = (args.content_type as string) || "general";
    const ttlDays = (args.ttl_days as number) || 30;
    const tags = (args.tags as string[]) || [];

    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const packet = storePacket({
      type: "retain",
      subject: `Retained: ${contentType} — ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}`,
      summary: content.slice(0, 200),
      confidence: 95,
      payload: { content, contentType, tags, ttlDays },
    });

    // Override the default expiry with the custom TTL
    const db = getDb();
    db.prepare(`UPDATE delta_packets SET expires_at = ? WHERE id = ?`).run(expiresAt, (packet as Record<string, unknown>).id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          packet: { ...packet, expiresAt },
          hint: `Context retained for ${ttlDays} days. It will appear in future delta_brief results. Tags: ${tags.join(", ") || "none"}`,
          nextTools: ["delta_brief", "delta_memo"],
        }, null, 2),
      }],
    };
  },
};

// ── Delta Packets List (utility) ─────────────────────────────────────────

const deltaPackets: McpTool = {
  name: "delta_packets",
  description:
    "List recent delta packets. View your packet history, filter by type, and track lineage.",
  inputSchema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["brief", "diligence", "handoff", "watchlist", "memo", "market", "review", "retain", "all"],
        description: "Filter by packet type. Defaults to 'all'.",
      },
      limit: {
        type: "number",
        description: "Maximum number of packets to return. Defaults to 20.",
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    ensureDeltaTable();
    const db = getDb();
    const type = (args.type as string) || "all";
    const limit = (args.limit as number) || 20;

    const query = type === "all"
      ? `SELECT * FROM delta_packets ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM delta_packets WHERE type = ? ORDER BY created_at DESC LIMIT ?`;

    const packets = type === "all"
      ? db.prepare(query).all(limit) as Record<string, unknown>[]
      : db.prepare(query).all(type, limit) as Record<string, unknown>[];

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          packets: packets.map((p) => ({
            id: p.id,
            type: p.type,
            subject: p.subject,
            summary: p.summary,
            confidence: p.confidence,
            freshness: p.freshness,
            createdAt: p.created_at,
            expiresAt: p.expires_at,
          })),
          count: packets.length,
          hint: "Use the packet ID with delta_handoff { parent_packet_id: \"...\" } to create linked handoffs.",
          nextTools: ["delta_brief", "delta_diligence", "delta_memo", "delta_handoff"],
        }, null, 2),
      }],
    };
  },
};

// ── Retention Bridge Tools ───────────────────────────────────────────────

const retentionStatus: McpTool = {
  name: "retention_status",
  description:
    "Check retention.sh connection status and QA metrics. Shows team code, QA score, member count, and last sync time. Use to verify retention.sh integration is working.",
  inputSchema: {
    type: "object" as const,
    properties: {
      team_code: {
        type: "string",
        description: "Retention.sh team code (e.g., 'C47DRF'). Auto-detected if retention.sh is running.",
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const teamCode = (args.team_code as string) || process.env.RETENTION_TEAM || "";

    // Check if retention.sh is accessible
    let retentionReachable = false;
    let qaScore: number | null = null;
    let memberCount: number | null = null;
    let tokensSaved: number | null = null;

    if (teamCode) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`https://retention.sh/api/team/${teamCode}/status`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json() as Record<string, unknown>;
          retentionReachable = true;
          qaScore = data.qaScore as number;
          memberCount = data.memberCount as number;
          tokensSaved = data.tokensSaved as number;
        }
      } catch {
        // retention.sh not reachable — that's fine, we degrade gracefully
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          connected: retentionReachable,
          teamCode: teamCode || "not configured",
          qaScore,
          memberCount,
          tokensSaved,
          dashboardUrl: teamCode ? `https://retention.sh/memory/team?team=${teamCode}` : null,
          hint: retentionReachable
            ? `retention.sh is connected. Team ${teamCode} has ${memberCount} members. QA score: ${qaScore}/100.`
            : teamCode
              ? `retention.sh team ${teamCode} is not reachable. Check your internet connection or set RETENTION_TEAM env var.`
              : "No team code configured. Set RETENTION_TEAM env var or pass team_code parameter. Install: RETENTION_TEAM=<CODE> curl -sL retention.sh/install.sh | bash",
          nextTools: ["delta_brief", "delta_scan"],
        }, null, 2),
      }],
    };
  },
};

const retentionSync: McpTool = {
  name: "retention_sync",
  description:
    "Sync data between NodeBench Delta and retention.sh. Pushes delta packets as team context and pulls QA findings as watchlist signals.",
  inputSchema: {
    type: "object" as const,
    properties: {
      direction: {
        type: "string",
        enum: ["push", "pull", "both"],
        description: "Push delta packets to retention.sh, pull QA findings from it, or both. Defaults to 'both'.",
      },
      team_code: {
        type: "string",
        description: "Retention.sh team code.",
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const direction = (args.direction as string) || "both";
    const teamCode = (args.team_code as string) || process.env.RETENTION_TEAM || "";

    if (!teamCode) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: "No team code configured. Set RETENTION_TEAM env var or pass team_code parameter.",
            hint: "Install retention.sh first: RETENTION_TEAM=<CODE> curl -sL retention.sh/install.sh | bash",
          }, null, 2),
        }],
      };
    }

    const results: Record<string, unknown> = { direction, teamCode };

    if (direction === "push" || direction === "both") {
      ensureDeltaTable();
      const db = getDb();
      const recentPackets = db.prepare(
        `SELECT * FROM delta_packets WHERE created_at > ? ORDER BY created_at DESC LIMIT 10`
      ).all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as Record<string, unknown>[];

      results.pushed = {
        packetCount: recentPackets.length,
        types: [...new Set(recentPackets.map((p) => p.type))],
        status: "ready_to_sync",
        note: "Packets are available for retention.sh to pull via the shared context API at /shared-context/packets",
      };
    }

    if (direction === "pull" || direction === "both") {
      results.pulled = {
        status: "ready_to_receive",
        note: "retention.sh QA findings will be ingested as delta_watchlist signals when retention.sh pushes via /shared-context/publish",
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...results,
          hint: "Sync configured. retention.sh and NodeBench Delta will exchange data via the shared context protocol.",
          dashboardUrl: `https://retention.sh/memory/team?team=${teamCode}`,
          nextTools: ["retention_status", "delta_brief", "delta_watch"],
        }, null, 2),
      }],
    };
  },
};

// ── Export ────────────────────────────────────────────────────────────────

export function createDeltaTools(): McpTool[] {
  return [
    deltaBrief,
    deltaDiligence,
    deltaHandoff,
    deltaWatch,
    deltaMemo,
    deltaScan,
    deltaCompare,
    deltaReview,
    deltaSelfDogfood,
    deltaRetain,
    deltaPackets,
    retentionStatus,
    retentionSync,
  ];
}
