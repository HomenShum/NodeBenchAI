import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { genId, getDb } from "../db.js";
import {
  buildSharedContextPacketResource,
  getSharedContextPacket,
  invalidateSharedContextPacket,
  linkDurableObjects,
  proposeSharedContextTask,
  publishSharedContextPacket,
  pullSharedContextPackets,
  recordExecutionReceipt,
  recordLocalArtifact,
  recordLocalOutcome,
  registerSharedContextPeer,
  upsertDurableObject,
} from "../sync/store.js";
import type { SharedContextPacket, SharedContextPacketType } from "../sync/protocol.js";
import type { McpTool } from "../types.js";
import {
  buildFounderDirectionAssessment,
  type FounderDirectionAssessment,
  type FounderStrategicAngle,
} from "./founderLocalPipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

type FounderDirectionInput = Parameters<typeof buildFounderDirectionAssessment>[0];

type DistributionSurfaceId =
  | "npm_package"
  | "npx_cli"
  | "install_script"
  | "claude_plugin"
  | "cursor_plugin"
  | "smithery"
  | "local_dashboard"
  | "shared_web_app";

interface DistributionSurface {
  id: DistributionSurfaceId;
  label: string;
  status: "ready" | "partial" | "missing";
  whyItMatters: string;
  evidence: string[];
}

function ensureFounderOpsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS founder_watchlist_entities (
      id TEXT PRIMARY KEY,
      entity_name TEXT NOT NULL,
      entity_name_lower TEXT NOT NULL UNIQUE,
      strategic_angle_id TEXT,
      added_at TEXT NOT NULL,
      last_checked TEXT,
      alert_preferences_json TEXT NOT NULL,
      change_count INTEGER NOT NULL DEFAULT 0,
      last_change_summary TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_founder_watchlist_entities_added_at
      ON founder_watchlist_entities(added_at DESC);

    CREATE TABLE IF NOT EXISTS founder_share_links (
      share_id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL,
      packet_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      summary TEXT,
      payload_json TEXT NOT NULL,
      visibility TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_founder_share_links_packet_id
      ON founder_share_links(packet_id);

    CREATE TABLE IF NOT EXISTS founder_retention_connections (
      team_code TEXT PRIMARY KEY,
      peer_id TEXT NOT NULL,
      connected_at TEXT NOT NULL,
      last_sync TEXT,
      qa_score REAL,
      member_count INTEGER,
      tokens_saved INTEGER,
      version TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS founder_retention_events (
      id TEXT PRIMARY KEY,
      team_code TEXT,
      event_type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_founder_retention_events_team_code
      ON founder_retention_events(team_code, created_at DESC);
  `);
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function selectStrategicAngle(
  assessment: FounderDirectionAssessment,
  angleId?: string,
): FounderStrategicAngle {
  if (angleId) {
    const exact = assessment.strategicAngles.find((angle) => angle.id === angleId);
    if (exact) return exact;
  }
  const priority = { watch: 0, unknown: 1, strong: 2 } as const;
  return [...assessment.strategicAngles].sort((left, right) => {
    const leftPriority = priority[left.status];
    const rightPriority = priority[right.status];
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.id.localeCompare(right.id);
  })[0];
}

function startFounderTrace(toolName: string, label: string, metadata?: Record<string, unknown>) {
  const runId = `run:${genId("founder_run")}`;
  const traceId = `trace:${genId("founder_trace")}`;
  upsertDurableObject({
    id: runId,
    kind: "run",
    label,
    metadata: { toolName, ...(metadata ?? {}) },
  });
  upsertDurableObject({
    id: traceId,
    kind: "trace",
    label: `${label} trace`,
    metadata: { toolName, ...(metadata ?? {}) },
  });
  linkDurableObjects({
    fromId: runId,
    toId: traceId,
    edgeType: "produces",
    metadata: { toolName },
  });
  recordExecutionReceipt({
    runId,
    traceId,
    objectId: traceId,
    toolName,
    actionType: "tool_started",
    summary: label,
    metadata,
  });
  return { runId, traceId };
}

function completeFounderTrace(args: {
  runId: string;
  traceId: string;
  toolName: string;
  summary: string;
  output: unknown;
  outcomeType: string;
  userValue?: string;
  stakeholderValue?: string;
}): void {
  recordExecutionReceipt({
    runId: args.runId,
    traceId: args.traceId,
    objectId: args.traceId,
    toolName: args.toolName,
    actionType: "tool_completed",
    summary: args.summary,
    output: args.output,
    status: "completed",
  });
  recordLocalOutcome({
    runId: args.runId,
    objectId: args.traceId,
    outcomeType: args.outcomeType,
    headline: args.summary,
    userValue: args.userValue,
    stakeholderValue: args.stakeholderValue,
    status: "completed",
    evidence: [],
    metadata: { toolName: args.toolName },
  });
}

function normalizeFounderAssessmentInput(args: FounderDirectionInput | { assessment: FounderDirectionAssessment }): FounderDirectionAssessment {
  if ("assessment" in args) return args.assessment;
  return buildFounderDirectionAssessment(args);
}

function getFounderPackets(options: {
  requestingPeerId?: string;
  producerPeerId?: string;
  workspaceId?: string;
  tenantId?: string;
  status?: SharedContextPacket["status"];
  angleId?: string;
  limit?: number;
}): SharedContextPacket[] {
  const packets = pullSharedContextPackets({
    contextType: "issue_packet",
    requestingPeerId: options.requestingPeerId,
    producerPeerId: options.producerPeerId,
    workspaceId: options.workspaceId,
    tenantId: options.tenantId,
    status: options.status,
    limit: options.limit ?? 50,
  });
  return packets.filter((packet) => {
    const metadata = packet.metadata ?? {};
    if (metadata.packetNamespace !== "founder_issue") return false;
    if (options.angleId && metadata.strategicAngleId !== options.angleId) return false;
    return true;
  });
}

function getDistributionSurfacesInternal(): DistributionSurface[] {
  const packageJson = safeReadJson<{ name?: string; version?: string }>(join(PACKAGE_ROOT, "package.json"));
  const smitheryPath = join(PACKAGE_ROOT, "smithery.yaml");
  const installScriptPath = join(PACKAGE_ROOT, "scripts", "install.sh");
  const claudeDir = join(PACKAGE_ROOT, ".claude");
  const cursorDir = join(PACKAGE_ROOT, ".cursor");
  const ledgerViewPath = join(REPO_ROOT, "apps", "web", "src", "features", "mcp", "views", "McpToolLedgerView.tsx");

  return [
    {
      id: "npm_package",
      label: "npm package",
      status: packageJson?.version ? "ready" : "missing",
      whyItMatters: "The package version is the canonical update surface for NodeBench MCP.",
      evidence: packageJson?.version ? [`package.json version ${packageJson.version}`] : ["packages/mcp-local/package.json missing version"],
    },
    {
      id: "npx_cli",
      label: "npx CLI",
      status: packageJson?.name === "nodebench-mcp" ? "ready" : "partial",
      whyItMatters: "npx is the fastest install path for individual founders and Claude Code users.",
      evidence: [`package name ${packageJson?.name ?? "unknown"}`],
    },
    {
      id: "install_script",
      label: "curl/bash installer",
      status: existsSync(installScriptPath) ? "ready" : "missing",
      whyItMatters: "A one-command installer reduces adoption friction for teams.",
      evidence: [installScriptPath],
    },
    {
      id: "claude_plugin",
      label: "Claude Code config",
      status: existsSync(claudeDir) ? "ready" : "missing",
      whyItMatters: "Claude Code is a high-frequency workflow for the target user base.",
      evidence: [claudeDir],
    },
    {
      id: "cursor_plugin",
      label: "Cursor config",
      status: existsSync(cursorDir) ? "ready" : "partial",
      whyItMatters: "Cursor parity matters for teams that do not standardize on Claude Code.",
      evidence: [cursorDir],
    },
    {
      id: "smithery",
      label: "Smithery metadata",
      status: existsSync(smitheryPath) ? "ready" : "missing",
      whyItMatters: "Smithery increases discoverability for external MCP distribution.",
      evidence: [smitheryPath],
    },
    {
      id: "local_dashboard",
      label: "local dashboard / ledger",
      status: existsSync(ledgerViewPath) ? "ready" : "partial",
      whyItMatters: "The operator needs an inspectable UI for receipts, packets, and sync provenance.",
      evidence: [ledgerViewPath],
    },
    {
      id: "shared_web_app",
      label: "NodeBench AI web account",
      status: existsSync(ledgerViewPath) ? "ready" : "partial",
      whyItMatters: "Shared history and approvals need a multi-device web surface.",
      evidence: [ledgerViewPath],
    },
  ];
}

function buildInstallCommand(preset: string): string {
  return `npx -y nodebench-mcp --preset=${preset}`;
}

function buildTeamInstallPlan(args: {
  teamType?: string;
  targetWorkflow?: string;
  preferredPreset?: string;
  seatCount?: number;
  requiresOffline?: boolean;
  needsDashboard?: boolean;
}) {
  const preset = args.preferredPreset ?? (args.teamType === "founder" ? "founder" : "delta");
  const workflow = (args.targetWorkflow ?? "claude code").toLowerCase();
  const steps = [
    `Install via ${buildInstallCommand(preset)} for the first operator.`,
    workflow.includes("claude") || workflow.includes("mcp")
      ? "Connect the preset to Claude Code first because that is the fastest path to high-frequency use."
      : "Start with the local CLI and .mcp.json path, then add editor-native surfaces after the first team workflow is stable.",
    args.requiresOffline
      ? "Keep SQLite local-first and treat outbound sync as optional replication only."
      : "Enable the outbound sync bridge after the first local workflow is working so shared history does not block initial adoption.",
    args.needsDashboard || (args.seatCount ?? 1) > 1
      ? "Turn on shared account review in NodeBench AI once at least one repeated packet/review workflow exists."
      : "Delay shared dashboard work until the single-user loop shows weekly reuse.",
  ];
  return {
    recommendedPreset: preset,
    installCommand: buildInstallCommand(preset),
    steps,
    blockers: [
      "MCP preset must match the real daily workflow instead of a generic tool bundle.",
      "Installer, update story, and support path must be clear before broader team rollout.",
    ],
    successMetric: args.seatCount && args.seatCount > 1
      ? "Two or more teammates can install, run the founder workflow, and publish/share a packet without manual setup help."
      : "One founder can install from scratch and get to a useful packet inside one session.",
  };
}

function installNodebenchPlugin(args: {
  targetDir: string;
  preset?: string;
  dryRun?: boolean;
}) {
  const preset = args.preset ?? "founder";
  const targetDir = resolve(args.targetDir);
  const configPath = join(targetDir, ".mcp.json");
  const config = {
    mcpServers: {
      nodebench: {
        command: "npx",
        args: ["-y", "nodebench-mcp", "--preset", preset],
        env: {},
      },
    },
  };
  if (args.dryRun !== false) {
    return {
      dryRun: true,
      configPath,
      config,
    };
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return {
    dryRun: false,
    configPath,
    config,
  };
}

function checkPluginUpdateReadinessInternal() {
  const packageJsonPath = join(PACKAGE_ROOT, "package.json");
  const packageJson = safeReadJson<{ version?: string; scripts?: Record<string, string> }>(packageJsonPath);
  const installScriptPath = join(PACKAGE_ROOT, "scripts", "install.sh");
  const smitheryPath = join(PACKAGE_ROOT, "smithery.yaml");
  const claudeDir = join(PACKAGE_ROOT, ".claude");
  const cursorDir = join(PACKAGE_ROOT, ".cursor");
  const missing: string[] = [];
  if (!packageJson?.version) missing.push("package version");
  if (!existsSync(installScriptPath)) missing.push("install.sh");
  if (!existsSync(smitheryPath)) missing.push("smithery.yaml");
  if (!existsSync(claudeDir)) missing.push(".claude config");
  if (!existsSync(cursorDir)) missing.push(".cursor config");
  return {
    version: packageJson?.version ?? null,
    ready: missing.length === 0,
    missing,
    readinessChecks: {
      packageVersion: Boolean(packageJson?.version),
      installer: existsSync(installScriptPath),
      smithery: existsSync(smitheryPath),
      claudeConfig: existsSync(claudeDir),
      cursorConfig: existsSync(cursorDir),
      buildScript: Boolean(packageJson?.scripts?.build),
    },
    nextAction: missing.length === 0
      ? "Version, installer, and discovery metadata are present. Publish only after the local install + sync bridge smoke test is green."
      : `Fill the missing distribution surfaces: ${missing.join(", ")}.`,
  };
}

function scanWorkflowAdoption(args: {
  query: string;
  marketWorkflow?: string[];
  targetUsers?: string[];
  installSurface?: string[];
  constraints?: string[];
}) {
  const query = args.query.toLowerCase();
  const marketWorkflow = uniq((args.marketWorkflow ?? []).map((entry) => entry.toLowerCase()));
  const targetUsers = uniq((args.targetUsers ?? []).map((entry) => entry.toLowerCase()));
  const installSurface = uniq((args.installSurface ?? []).map((entry) => entry.toLowerCase()));
  const constraints = uniq((args.constraints ?? []).map((entry) => entry.toLowerCase()));

  let fitScore = 50;
  if (includesAny(query, ["claude code", "mcp", "local", "sqlite"])) fitScore += 20;
  if (marketWorkflow.some((entry) => entry.includes("claude code") || entry.includes("mcp"))) fitScore += 15;
  if (installSurface.some((entry) => entry.includes("dashboard") || entry.includes("subscription"))) fitScore += 5;
  if (constraints.some((entry) => entry.includes("heavy setup") || entry.includes("manual onboarding"))) fitScore -= 15;
  if (constraints.some((entry) => entry.includes("no ai") || entry.includes("anti ai"))) fitScore -= 10;
  fitScore = clamp(fitScore, 0, 100);

  return {
    fitScore,
    recommendedSurface: fitScore >= 70 ? "claude_code_mcp" : "local_cli_then_dashboard",
    adoptionRisks: [
      !marketWorkflow.length ? "Current user workflow is underspecified, so install and messaging risk are still fuzzy." : null,
      !includesAny(query, ["claude code", "mcp"]) && marketWorkflow.length > 0
        ? "The direction is not yet clearly anchored to the real workflow people already use."
        : null,
      constraints.some((entry) => entry.includes("no ai") || entry.includes("anti ai"))
        ? "AI skepticism needs to be translated into a bounded, user-valued stance rather than a blanket product veto."
        : null,
    ].filter(Boolean),
    installRecommendation: fitScore >= 70
      ? "Lead with Claude Code + NodeBench MCP because that matches the current high-frequency workflow."
      : "Lead with a narrow CLI/local-first wedge, then add the dashboard only after the loop proves sticky.",
    maintenanceView: includesAny(query, ["dashboard", "subscription", "teams"])
      ? "A team-facing dashboard creates support and uptime burden. Keep the local MCP surface as the system of record and add web collaboration only where reuse is proven."
      : "Keep the initial surface light enough that one builder can maintain it without creating an ops tax.",
    targetUsers,
    marketWorkflow,
    installSurface,
  };
}

function buildServiceToDashboardPath(args: {
  concept: string;
  currentAssets?: string[];
  seatCount?: number;
  needsRecurringValue?: boolean;
  supportLoad?: "low" | "medium" | "high";
  workflowAnchor?: string[];
}) {
  const assets = uniq(args.currentAssets ?? []);
  const workflowAnchor = uniq(args.workflowAnchor ?? []);
  const seatCount = args.seatCount ?? 1;
  const supportLoad = args.supportLoad ?? "medium";
  const recurring = args.needsRecurringValue ?? true;
  const serviceFirstScore = clamp(60 + (assets.length > 0 ? 10 : 0) + (seatCount <= 3 ? 10 : -5) + (supportLoad === "low" ? 10 : supportLoad === "high" ? -10 : 0), 0, 100);
  const dashboardScore = clamp(45 + (recurring ? 15 : 0) + (workflowAnchor.some((entry) => entry.toLowerCase().includes("claude code") || entry.toLowerCase().includes("mcp")) ? 10 : 0) + (seatCount > 3 ? 10 : 0), 0, 100);
  const hybridScore = clamp(Math.round((serviceFirstScore + dashboardScore) / 2) + 5, 0, 100);
  const recommendedPath = hybridScore >= serviceFirstScore && hybridScore >= dashboardScore ? "hybrid" : serviceFirstScore >= dashboardScore ? "service_first" : "dashboard_first";
  return {
    concept: args.concept,
    pathScores: {
      serviceFirst: serviceFirstScore,
      dashboardFirst: dashboardScore,
      hybrid: hybridScore,
    },
    recommendedPath,
    rationale: recommendedPath === "service_first"
      ? "Lead with done-for-you services until the value is obvious, then productize the repeated workflow."
      : recommendedPath === "dashboard_first"
        ? "The recurring team use case is already strong enough to justify a dashboard surface early."
        : "Use the local MCP flow as the proving ground, then graduate the repeated artifacts and approvals into a dashboard subscription.",
    milestones: [
      "Prove one repeated high-value workflow with a founder or operator.",
      "Capture the packet, review, and follow-up loop with durable receipts.",
      "Turn the repeated review surface into a lightweight dashboard only after people want shared history or approvals.",
    ],
  };
}

function registerFounderPeerIfNeeded(args: {
  peerId: string;
  workspaceId?: string;
  tenantId?: string;
  role?: "researcher" | "compiler" | "judge" | "explorer" | "replay" | "environment_builder" | "runner" | "observer" | "monitor" | "router";
  capabilities?: string[];
}) {
  return registerSharedContextPeer({
    peerId: args.peerId,
    product: "nodebench",
    tenantId: args.tenantId,
    workspaceId: args.workspaceId,
    surface: "local_runtime",
    role: args.role ?? "compiler",
    capabilities: args.capabilities ?? ["founder-direction-assessment", "shared-context-publish", "execution-receipts"],
    contextScopes: ["workspace", "run", "packet"],
    status: "active",
    summary: {
      currentTask: "Founder strategic ops",
      currentState: "ready",
      confidence: 0.8,
      availableArtifacts: ["issue_packet", "direction_assessment"],
      lastUpdate: new Date().toISOString(),
    },
  });
}

export const founderStrategicOpsTools: McpTool[] = [
  {
    name: "publish_founder_issue_packet",
    description: "Turn the weakest founder-direction angle into a durable shared-context issue packet with lineage, proof links, and a reusable resource URI.",
    inputSchema: {
      type: "object",
      properties: {
        producerPeerId: { type: "string" },
        workspaceId: { type: "string" },
        tenantId: { type: "string" },
        angleId: { type: "string" },
        assessment: { type: "object" },
        query: { type: "string" },
        lens: { type: "string" },
        daysBack: { type: "number" },
        userSkillset: { type: "array", items: { type: "string" } },
        interests: { type: "array", items: { type: "string" } },
        constraints: { type: "array", items: { type: "string" } },
        marketWorkflow: { type: "array", items: { type: "string" } },
        extraContext: { type: "string" },
        visibility: { type: "string", enum: ["internal", "workspace", "tenant"] },
      },
      required: ["producerPeerId"],
    },
    handler: async (rawArgs) => {
      const args = rawArgs as {
        producerPeerId: string;
        workspaceId?: string;
        tenantId?: string;
        angleId?: string;
        assessment?: FounderDirectionAssessment;
        query?: string;
        lens?: string;
        daysBack?: number;
        userSkillset?: string[];
        interests?: string[];
        constraints?: string[];
        marketWorkflow?: string[];
        extraContext?: string;
        visibility?: "internal" | "workspace" | "tenant";
      };
      const trace = startFounderTrace("publish_founder_issue_packet", "Publish founder issue packet", {
        producerPeerId: args.producerPeerId,
        workspaceId: args.workspaceId,
      });
      registerFounderPeerIfNeeded({
        peerId: args.producerPeerId,
        workspaceId: args.workspaceId,
        tenantId: args.tenantId,
      });
      const assessment = normalizeFounderAssessmentInput(
        args.assessment ? { assessment: args.assessment } : {
          query: args.query ?? "Founder direction issue",
          lens: args.lens,
          daysBack: args.daysBack,
          userSkillset: args.userSkillset,
          interests: args.interests,
          constraints: args.constraints,
          marketWorkflow: args.marketWorkflow,
          extraContext: args.extraContext,
        },
      );
      const strategicAngle = selectStrategicAngle(assessment, args.angleId);
      const published = publishSharedContextPacket({
        contextType: "issue_packet",
        producerPeerId: args.producerPeerId,
        workspaceId: args.workspaceId,
        tenantId: args.tenantId,
        scope: uniq(["workspace", `angle:${strategicAngle.id}`, ...assessment.issueAngles.map((issueAngle) => `issue:${issueAngle}`)]),
        subject: `${strategicAngle.title} issue`,
        summary: strategicAngle.summary,
        claims: [strategicAngle.summary, strategicAngle.whyItMatters, `Next question: ${strategicAngle.nextQuestion}`],
        evidenceRefs: strategicAngle.evidenceRefIds,
        confidence: assessment.confidence,
        permissions: {
          visibility: args.visibility ?? "workspace",
          allowedRoles: ["compiler", "judge", "researcher", "router", "monitor"],
        },
        freshness: {
          status: strategicAngle.status === "strong" ? "fresh" : "warming",
          trustTier: "directional",
        },
        lineage: {
          sourceRunId: trace.runId,
          sourceTraceId: trace.traceId,
        },
        metadata: {
          packetNamespace: "founder_issue",
          strategicAngleId: strategicAngle.id,
          strategicAngleTitle: strategicAngle.title,
          assessmentId: assessment.assessmentId,
          packetId: assessment.packetId,
          recommendedNextAction: assessment.recommendedNextAction,
          nextQuestions: assessment.nextQuestions,
          sourceRefs: assessment.sourceRefs,
        },
        nextActions: [assessment.recommendedNextAction, `Resolve or delegate ${strategicAngle.id}`],
      });
      const packet = getSharedContextPacket(published.contextId, args.producerPeerId);
      const resource = packet ? buildSharedContextPacketResource(packet, args.producerPeerId) : null;
      completeFounderTrace({
        runId: trace.runId,
        traceId: trace.traceId,
        toolName: "publish_founder_issue_packet",
        summary: `Published founder issue packet for ${strategicAngle.id}`,
        output: { contextId: published.contextId, angleId: strategicAngle.id },
        outcomeType: "founder_issue_packet",
        userValue: "Weak founder-direction angles are now durable packets instead of disposable chat output.",
        stakeholderValue: "Stakeholders can inspect, delegate, and invalidate strategic risks with lineage.",
      });
      return {
        contextId: published.contextId,
        strategicAngle,
        assessmentId: assessment.assessmentId,
        resourceUri: resource?.resourceUri ?? null,
        pullQuery: resource?.pullQuery ?? null,
        subscriptionQuery: resource?.subscriptionQuery ?? null,
        provenance: trace,
      };
    },
  },
  {
    name: "list_founder_issue_packets",
    description: "List founder issue packets from shared context by workspace, producer, status, or strategic angle.",
    inputSchema: {
      type: "object",
      properties: {
        requestingPeerId: { type: "string" },
        producerPeerId: { type: "string" },
        workspaceId: { type: "string" },
        tenantId: { type: "string" },
        status: { type: "string", enum: ["active", "superseded", "invalidated"] },
        angleId: { type: "string" },
        limit: { type: "number" },
      },
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => {
      const args = rawArgs as {
        requestingPeerId?: string;
        producerPeerId?: string;
        workspaceId?: string;
        tenantId?: string;
        status?: SharedContextPacket["status"];
        angleId?: string;
        limit?: number;
      };
      const packets = getFounderPackets(args);
      return {
        count: packets.length,
        packets: packets.map((packet) => ({
          contextId: packet.contextId,
          subject: packet.subject,
          summary: packet.summary,
          status: packet.status,
          strategicAngleId: packet.metadata?.strategicAngleId ?? null,
          strategicAngleTitle: packet.metadata?.strategicAngleTitle ?? null,
          confidence: packet.confidence ?? null,
        })),
      };
    },
  },
  {
    name: "resolve_founder_issue",
    description: "Invalidate a founder issue packet and optionally publish a resolution packet so the issue lifecycle stays explicit.",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string" },
        producerPeerId: { type: "string" },
        resolverPeerId: { type: "string" },
        resolutionSummary: { type: "string" },
        publishResolution: { type: "boolean" },
      },
      required: ["contextId", "producerPeerId", "resolutionSummary"],
    },
    handler: async (rawArgs) => {
      const args = rawArgs as {
        contextId: string;
        producerPeerId: string;
        resolverPeerId?: string;
        resolutionSummary: string;
        publishResolution?: boolean;
      };
      const trace = startFounderTrace("resolve_founder_issue", "Resolve founder issue", {
        contextId: args.contextId,
      });
      const sourcePacket = getSharedContextPacket(args.contextId, args.resolverPeerId ?? args.producerPeerId);
      if (!sourcePacket) {
        throw new Error(`Founder issue packet not found or inaccessible: ${args.contextId}`);
      }
      const invalidation = invalidateSharedContextPacket(args.contextId, args.producerPeerId, args.resolutionSummary, [args.contextId]);
      let resolutionContextId: string | null = null;
      if (args.publishResolution !== false) {
        const published = publishSharedContextPacket({
          contextType: "workflow_packet",
          producerPeerId: args.resolverPeerId ?? args.producerPeerId,
          workspaceId: sourcePacket.workspaceId ?? undefined,
          tenantId: sourcePacket.tenantId ?? undefined,
          scope: uniq(["workspace", ...(sourcePacket.scope ?? [])]),
          subject: `Resolved: ${sourcePacket.subject}`,
          summary: args.resolutionSummary,
          claims: [args.resolutionSummary],
          evidenceRefs: [args.contextId],
          confidence: sourcePacket.confidence ?? 0.8,
          permissions: sourcePacket.permissions,
          freshness: { status: "fresh", trustTier: "internal" },
          lineage: {
            parentContextIds: [args.contextId],
            sourceRunId: trace.runId,
            sourceTraceId: trace.traceId,
          },
          metadata: {
            packetNamespace: "founder_issue_resolution",
            resolvedIssueContextId: args.contextId,
            strategicAngleId: sourcePacket.metadata?.strategicAngleId ?? null,
          },
          nextActions: ["Verify the issue stays resolved in the next founder run."],
        });
        resolutionContextId = published.contextId;
      }
      completeFounderTrace({
        runId: trace.runId,
        traceId: trace.traceId,
        toolName: "resolve_founder_issue",
        summary: `Resolved founder issue ${args.contextId}`,
        output: { invalidated: invalidation.contextId, resolutionContextId },
        outcomeType: "founder_issue_resolution",
        userValue: "Resolved founder issues do not linger as stale context.",
        stakeholderValue: "Issue invalidation and resolution packets make strategic state transitions auditable.",
      });
      return {
        invalidatedContextId: invalidation.contextId,
        resolutionContextId,
        provenance: trace,
      };
    },
  },
  {
    name: "delegate_founder_issue",
    description: "Create a bounded shared task handoff for a founder issue packet so the weak angle becomes assigned work.",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string" },
        proposerPeerId: { type: "string" },
        assigneePeerId: { type: "string" },
        taskType: { type: "string" },
        instructions: { type: "string" },
        expectedOutputContextType: { type: "string" },
      },
      required: ["contextId", "proposerPeerId", "assigneePeerId"],
    },
    handler: async (rawArgs) => {
      const args = rawArgs as {
        contextId: string;
        proposerPeerId: string;
        assigneePeerId: string;
        taskType?: string;
        instructions?: string;
        expectedOutputContextType?: SharedContextPacketType;
      };
      const trace = startFounderTrace("delegate_founder_issue", "Delegate founder issue", {
        contextId: args.contextId,
        assigneePeerId: args.assigneePeerId,
      });
      const packet = getSharedContextPacket(args.contextId, args.proposerPeerId);
      if (!packet) throw new Error(`Founder issue packet not found or inaccessible: ${args.contextId}`);
      const proposed = proposeSharedContextTask({
        taskType: args.taskType ?? "founder_issue_followup",
        proposerPeerId: args.proposerPeerId,
        assigneePeerId: args.assigneePeerId,
        inputContextIds: [args.contextId],
        taskSpec: {
          instructions: args.instructions ?? packet.summary,
          expectedOutputContextType: args.expectedOutputContextType ?? "workflow_packet",
          strategicAngleId: packet.metadata?.strategicAngleId ?? null,
        },
        reason: `Resolve founder issue: ${packet.subject}`,
      });
      completeFounderTrace({
        runId: trace.runId,
        traceId: trace.traceId,
        toolName: "delegate_founder_issue",
        summary: `Delegated founder issue ${args.contextId} to ${args.assigneePeerId}`,
        output: { taskId: proposed.taskId },
        outcomeType: "founder_issue_delegation",
        userValue: "Weak strategic angles become assigned tasks instead of vague concerns.",
        stakeholderValue: "Delegation is tied to the packet lineage and can be audited later.",
      });
      return {
        taskId: proposed.taskId,
        contextId: args.contextId,
        assigneePeerId: args.assigneePeerId,
        provenance: trace,
      };
    },
  },
  {
    name: "compare_founder_directions",
    description: "Compare multiple founder directions side by side across strategic angles, issue count, confidence, and recommended wedge.",
    inputSchema: {
      type: "object",
      properties: {
        directions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              query: { type: "string" },
              lens: { type: "string" },
              userSkillset: { type: "array", items: { type: "string" } },
              interests: { type: "array", items: { type: "string" } },
              constraints: { type: "array", items: { type: "string" } },
              marketWorkflow: { type: "array", items: { type: "string" } },
              extraContext: { type: "string" },
            },
            required: ["name", "query"],
          },
        },
      },
      required: ["directions"],
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => {
      const args = rawArgs as { directions: Array<FounderDirectionInput & { name: string }> };
      const trace = startFounderTrace("compare_founder_directions", "Compare founder directions", {
        directions: args.directions.map((direction) => direction.name),
      });
      const comparisons = args.directions.map((direction) => {
        const assessment = buildFounderDirectionAssessment(direction);
        const strong = assessment.strategicAngles.filter((angle) => angle.status === "strong").length;
        const watch = assessment.strategicAngles.filter((angle) => angle.status === "watch").length;
        const unknown = assessment.strategicAngles.filter((angle) => angle.status === "unknown").length;
        const score = clamp(Math.round((assessment.confidence * 100) + (strong * 8) - (watch * 6) - (unknown * 4)), 0, 100);
        return {
          name: direction.name,
          assessment,
          score,
          counts: { strong, watch, unknown },
          weakestAngle: selectStrategicAngle(assessment),
        };
      }).sort((left, right) => right.score - left.score);
      const recommended = comparisons[0];
      const result = {
        recommendation: {
          direction: recommended.name,
          score: recommended.score,
          why: recommended.assessment.summary,
          falsifier: recommended.weakestAngle.nextQuestion,
        },
        comparisons: comparisons.map((entry) => ({
          name: entry.name,
          score: entry.score,
          confidence: entry.assessment.confidence,
          counts: entry.counts,
          weakestAngle: {
            id: entry.weakestAngle.id,
            title: entry.weakestAngle.title,
            status: entry.weakestAngle.status,
            nextQuestion: entry.weakestAngle.nextQuestion,
          },
          recommendedNextAction: entry.assessment.recommendedNextAction,
        })),
      };
      completeFounderTrace({
        runId: trace.runId,
        traceId: trace.traceId,
        toolName: "compare_founder_directions",
        summary: `Compared ${args.directions.length} founder directions`,
        output: result,
        outcomeType: "founder_direction_compare",
        userValue: "Multiple directions can be pressure-tested before committing roadmap time.",
        stakeholderValue: "Direction choice is backed by explicit tradeoffs and falsifiers instead of intuition alone.",
      });
      return { ...result, provenance: trace };
    },
  },
  {
    name: "workflow_adoption_scan",
    description: "Evaluate how naturally a direction fits current high-frequency user workflows, install surfaces, and maintenance burden.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        marketWorkflow: { type: "array", items: { type: "string" } },
        targetUsers: { type: "array", items: { type: "string" } },
        installSurface: { type: "array", items: { type: "string" } },
        constraints: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => scanWorkflowAdoption(rawArgs as any),
  },
  {
    name: "service_to_dashboard_path",
    description: "Map a concept from bespoke service work to a possible dashboard subscription path without losing the local-first wedge.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string" },
        currentAssets: { type: "array", items: { type: "string" } },
        seatCount: { type: "number" },
        needsRecurringValue: { type: "boolean" },
        supportLoad: { type: "string", enum: ["low", "medium", "high"] },
        workflowAnchor: { type: "array", items: { type: "string" } },
      },
      required: ["concept"],
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => buildServiceToDashboardPath(rawArgs as any),
  },
  {
    name: "get_founder_packet_resource",
    description: "Fetch the resource URI, pull query, and subscription query for a founder issue or resolution packet.",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string" },
        peerId: { type: "string" },
      },
      required: ["contextId"],
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => {
      const args = rawArgs as { contextId: string; peerId?: string };
      const packet = getSharedContextPacket(args.contextId, args.peerId);
      if (!packet) {
        return { found: false, resourceUri: null, pullQuery: null, subscriptionQuery: null };
      }
      const resource = buildSharedContextPacketResource(packet, args.peerId);
      return { found: true, ...resource };
    },
  },
  {
    name: "get_distribution_surfaces",
    description: "Inspect NodeBench MCP distribution surfaces: npm/npx, installer, plugin configs, Smithery, and shared web review surfaces.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: async () => {
      const surfaces = getDistributionSurfacesInternal();
      return {
        surfaces,
        readyCount: surfaces.filter((surface) => surface.status === "ready").length,
        partialCount: surfaces.filter((surface) => surface.status === "partial").length,
        missingCount: surfaces.filter((surface) => surface.status === "missing").length,
      };
    },
  },
  {
    name: "generate_team_install_plan",
    description: "Generate a practical install and rollout plan for a founder, solo developer, or small team using NodeBench MCP.",
    inputSchema: {
      type: "object",
      properties: {
        teamType: { type: "string" },
        targetWorkflow: { type: "string" },
        preferredPreset: { type: "string" },
        seatCount: { type: "number" },
        requiresOffline: { type: "boolean" },
        needsDashboard: { type: "boolean" },
      },
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => buildTeamInstallPlan(rawArgs as any),
  },
  {
    name: "install_nodebench_plugin",
    description: "Generate or write a starter .mcp.json entry for NodeBench MCP so a local team member can install the preset quickly.",
    inputSchema: {
      type: "object",
      properties: {
        targetDir: { type: "string" },
        preset: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["targetDir"],
    },
    handler: async (rawArgs) => installNodebenchPlugin(rawArgs as any),
  },
  {
    name: "check_plugin_update_readiness",
    description: "Check whether NodeBench MCP is ready for a version/update push across installer, plugin metadata, and editor surfaces.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: async () => checkPluginUpdateReadinessInternal(),
  },
  {
    name: "watchlist_add_entity",
    description: "Add an entity to the local founder watchlist with alert preferences and optional strategic-angle linkage.",
    inputSchema: {
      type: "object",
      properties: {
        entityName: { type: "string" },
        alertPreferences: { type: "array", items: { type: "string" } },
        strategicAngleId: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["entityName"],
    },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as {
        entityName: string;
        alertPreferences?: string[];
        strategicAngleId?: string;
        metadata?: Record<string, unknown>;
      };
      const db = getDb();
      const normalized = args.entityName.trim().toLowerCase();
      const existing = db.prepare(`
        SELECT * FROM founder_watchlist_entities WHERE entity_name_lower = ? LIMIT 1
      `).get(normalized) as any;
      if (existing) {
        return {
          status: "already_watching",
          entity: {
            id: existing.id,
            entityName: existing.entity_name,
            strategicAngleId: existing.strategic_angle_id ?? null,
          },
        };
      }
      const id = genId("watch");
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO founder_watchlist_entities
          (id, entity_name, entity_name_lower, strategic_angle_id, added_at, last_checked, alert_preferences_json, change_count, last_change_summary, metadata_json)
        VALUES (?, ?, ?, ?, ?, NULL, ?, 0, NULL, ?)
      `).run(
        id,
        args.entityName,
        normalized,
        args.strategicAngleId ?? null,
        now,
        json(args.alertPreferences ?? ["any_material"]),
        json(args.metadata ?? {}),
      );
      upsertDurableObject({
        id,
        kind: "artifact",
        label: `Watchlist entity: ${args.entityName}`,
        metadata: {
          entityName: args.entityName,
          strategicAngleId: args.strategicAngleId ?? null,
        },
      });
      recordLocalArtifact({
        objectId: id,
        kind: "watchlist_entity",
        summary: `Watching ${args.entityName}`,
        verificationStatus: "verified",
        metadata: {
          alertPreferences: args.alertPreferences ?? ["any_material"],
          strategicAngleId: args.strategicAngleId ?? null,
        },
      });
      return {
        status: "added",
        entity: {
          id,
          entityName: args.entityName,
          alertPreferences: args.alertPreferences ?? ["any_material"],
          strategicAngleId: args.strategicAngleId ?? null,
        },
      };
    },
  },
  {
    name: "watchlist_list_entities",
    description: "List watched entities from the local founder watchlist.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: async () => {
      ensureFounderOpsSchema();
      const rows = getDb().prepare(`
        SELECT *
        FROM founder_watchlist_entities
        ORDER BY added_at DESC
      `).all() as any[];
      return {
        count: rows.length,
        entities: rows.map((row) => ({
          id: row.id,
          entityName: row.entity_name,
          strategicAngleId: row.strategic_angle_id ?? null,
          addedAt: row.added_at,
          lastChecked: row.last_checked ?? null,
          alertPreferences: parseJson<string[]>(row.alert_preferences_json, []),
          changeCount: row.change_count,
          lastChangeSummary: row.last_change_summary ?? null,
          metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
        })),
      };
    },
  },
  {
    name: "watchlist_refresh_entities",
    description: "Refresh watchlist timestamps and optionally attach change summaries for watched entities.",
    inputSchema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entityName: { type: "string" },
              summary: { type: "string" },
            },
            required: ["entityName", "summary"],
          },
        },
      },
    },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as { changes?: Array<{ entityName: string; summary: string }> };
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`UPDATE founder_watchlist_entities SET last_checked = ?`).run(now);
      for (const change of args.changes ?? []) {
        db.prepare(`
          UPDATE founder_watchlist_entities
          SET change_count = change_count + 1,
              last_change_summary = ?,
              last_checked = ?
          WHERE entity_name_lower = ?
        `).run(change.summary, now, change.entityName.toLowerCase());
      }
      const refreshed = (db.prepare(`SELECT COUNT(*) as count FROM founder_watchlist_entities`).get() as { count: number }).count;
      return {
        refreshed,
        changed: (args.changes ?? []).length,
        hint: "Use delta diligence or founder issue packets to turn real changes into durable packets.",
      };
    },
  },
  {
    name: "watchlist_get_alerts",
    description: "Return watchlist entries with attached change summaries or non-zero alert counts.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: async () => {
      ensureFounderOpsSchema();
      const rows = getDb().prepare(`
        SELECT *
        FROM founder_watchlist_entities
        WHERE change_count > 0 OR last_change_summary IS NOT NULL
        ORDER BY last_checked DESC
      `).all() as any[];
      return {
        count: rows.length,
        alerts: rows.map((row) => ({
          entityName: row.entity_name,
          changeCount: row.change_count,
          lastChange: row.last_change_summary ?? null,
          lastChecked: row.last_checked ?? null,
        })),
      };
    },
  },
  {
    name: "share_create_packet_link",
    description: "Create a durable local share link record for a packet or founder memo so it can be rendered or synced later.",
    inputSchema: {
      type: "object",
      properties: {
        packetId: { type: "string" },
        packetType: { type: "string" },
        subject: { type: "string" },
        summary: { type: "string" },
        payload: { type: "object" },
        visibility: { type: "string" },
        baseUrl: { type: "string" },
      },
      required: ["subject"],
    },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as {
        packetId?: string;
        packetType?: string;
        subject: string;
        summary?: string;
        payload?: unknown;
        visibility?: string;
        baseUrl?: string;
      };
      const shareId = genId("share");
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      getDb().prepare(`
        INSERT INTO founder_share_links
          (share_id, packet_id, packet_type, subject, summary, payload_json, visibility, created_at, expires_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        shareId,
        args.packetId ?? shareId,
        args.packetType ?? "memo",
        args.subject,
        args.summary ?? "",
        json(args.payload ?? {}),
        args.visibility ?? "workspace",
        createdAt,
        expiresAt,
      );
      upsertDurableObject({
        id: shareId,
        kind: "artifact",
        label: `Share link: ${args.subject}`,
        metadata: {
          packetId: args.packetId ?? shareId,
          packetType: args.packetType ?? "memo",
        },
      });
      recordLocalArtifact({
        objectId: shareId,
        kind: "share_link",
        summary: `Share link for ${args.subject}`,
        verificationStatus: "verified",
        metadata: {
          packetId: args.packetId ?? shareId,
          packetType: args.packetType ?? "memo",
          subject: args.subject,
        },
      });
      const baseUrl = (args.baseUrl ?? "https://nodebenchai.com").replace(/\/$/, "");
      return {
        shareId,
        shareUrl: `${baseUrl}/share/${shareId}`,
        expiresAt,
      };
    },
  },
  {
    name: "share_get_packet_link",
    description: "Retrieve a local share link record by share ID.",
    inputSchema: {
      type: "object",
      properties: { shareId: { type: "string" } },
      required: ["shareId"],
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as { shareId: string };
      const row = getDb().prepare(`
        SELECT *
        FROM founder_share_links
        WHERE share_id = ?
        LIMIT 1
      `).get(args.shareId) as any;
      if (!row || row.revoked_at) {
        return { found: false };
      }
      return {
        found: true,
        shareId: row.share_id,
        packetId: row.packet_id,
        packetType: row.packet_type,
        subject: row.subject,
        summary: row.summary,
        payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    },
  },
  {
    name: "share_revoke_packet_link",
    description: "Revoke a local share link so it no longer counts as active.",
    inputSchema: {
      type: "object",
      properties: { shareId: { type: "string" } },
      required: ["shareId"],
    },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as { shareId: string };
      const now = new Date().toISOString();
      const result = getDb().prepare(`
        UPDATE founder_share_links
        SET revoked_at = ?
        WHERE share_id = ? AND revoked_at IS NULL
      `).run(now, args.shareId);
      return { revoked: result.changes > 0, shareId: args.shareId };
    },
  },
  {
    name: "retention_register_connection",
    description: "Register a retention.sh team connection in local MCP state so QA findings and token savings can flow into founder packets.",
    inputSchema: {
      type: "object",
      properties: {
        teamCode: { type: "string" },
        peerId: { type: "string" },
        version: { type: "string" },
        memberCount: { type: "number" },
      },
      required: ["teamCode"],
    },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as {
        teamCode: string;
        peerId?: string;
        version?: string;
        memberCount?: number;
      };
      const now = new Date().toISOString();
      const peerId = args.peerId ?? `peer:monitor:retention:${args.teamCode}`;
      getDb().prepare(`
        INSERT INTO founder_retention_connections
          (team_code, peer_id, connected_at, last_sync, qa_score, member_count, tokens_saved, version, metadata_json)
        VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, '{}')
        ON CONFLICT(team_code) DO UPDATE SET
          peer_id = excluded.peer_id,
          version = excluded.version,
          member_count = COALESCE(excluded.member_count, founder_retention_connections.member_count)
      `).run(args.teamCode, peerId, now, args.memberCount ?? null, args.version ?? null);
      registerFounderPeerIfNeeded({
        peerId,
        role: "monitor",
        capabilities: ["retention-sync", "qa-score", "tokens-saved"],
      });
      getDb().prepare(`
        INSERT INTO founder_retention_events (id, team_code, event_type, data_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(genId("ret_event"), args.teamCode, "registered", json({ peerId }), now);
      return {
        status: "connected",
        teamCode: args.teamCode,
        peerId,
      };
    },
  },
  {
    name: "retention_sync_findings",
    description: "Sync retention.sh QA findings, scores, and token savings into local MCP state.",
    inputSchema: {
      type: "object",
      properties: {
        teamCode: { type: "string" },
        qaFindings: { type: "array", items: { type: "object" } },
        qaScore: { type: "number" },
        tokensSaved: { type: "number" },
        teamMembers: { type: "number" },
      },
      required: ["teamCode"],
    },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as {
        teamCode: string;
        qaFindings?: unknown[];
        qaScore?: number;
        tokensSaved?: number;
        teamMembers?: number;
      };
      const now = new Date().toISOString();
      getDb().prepare(`
        UPDATE founder_retention_connections
        SET last_sync = ?,
            qa_score = COALESCE(?, qa_score),
            tokens_saved = COALESCE(?, tokens_saved),
            member_count = COALESCE(?, member_count)
        WHERE team_code = ?
      `).run(now, args.qaScore ?? null, args.tokensSaved ?? null, args.teamMembers ?? null, args.teamCode);
      getDb().prepare(`
        INSERT INTO founder_retention_events (id, team_code, event_type, data_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(genId("ret_event"), args.teamCode, "sync", json({
        qaScore: args.qaScore ?? null,
        tokensSaved: args.tokensSaved ?? null,
        findingCount: args.qaFindings?.length ?? 0,
      }), now);
      return {
        status: "synced",
        findingsReceived: args.qaFindings?.length ?? 0,
        qaScore: args.qaScore ?? null,
      };
    },
  },
  {
    name: "retention_get_status",
    description: "Return the latest retention.sh connection and recent event history from local MCP state.",
    inputSchema: {
      type: "object",
      properties: { teamCode: { type: "string" } },
    },
    annotations: { readOnlyHint: true },
    handler: async (rawArgs) => {
      ensureFounderOpsSchema();
      const args = rawArgs as { teamCode?: string };
      const row = getDb().prepare(`
        SELECT *
        FROM founder_retention_connections
        WHERE (? IS NULL OR team_code = ?)
        ORDER BY connected_at DESC
        LIMIT 1
      `).get(args.teamCode ?? null, args.teamCode ?? null) as any;
      if (!row) {
        return { connected: false };
      }
      const events = getDb().prepare(`
        SELECT *
        FROM founder_retention_events
        WHERE team_code = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).all(row.team_code) as any[];
      return {
        connected: true,
        teamCode: row.team_code,
        peerId: row.peer_id,
        connectedAt: row.connected_at,
        lastSync: row.last_sync ?? null,
        qaScore: row.qa_score ?? null,
        memberCount: row.member_count ?? null,
        tokensSaved: row.tokens_saved ?? null,
        version: row.version ?? null,
        recentEvents: events.map((event) => ({
          type: event.event_type,
          timestamp: event.created_at,
          data: parseJson<Record<string, unknown>>(event.data_json, {}),
        })),
      };
    },
  },
];
