import type { TraceStep } from "./SearchTrace";
import type {
  FounderPacketVisibility,
  LensId,
  ProofStatus,
  ResultAnswerBlock,
  ResultAutonomyBenchmarkRun,
  ResultClaimRef,
  ResultCompanyNamingPack,
  ResultCompanyReadinessPacket,
  ResultDiligencePackDefinition,
  ResultDistributionSurfaceStatus,
  ResultExplorationMemory,
  ResultFounderOperatingModel,
  ResultFounderProgressionProfile,
  ResultFounderScorecard,
  ResultGraphEdge,
  ResultGraphNode,
  ResultGraphSummary,
  ResultMaterialsChecklistItem,
  ResultPacket,
  ResultProgressionTierDefinition,
  ResultStrategicAngle,
  ResultSourceRef,
  ResultUnlockCriteria,
  ResultWorkflowAsset,
  ResultWorkflowPathComparison,
} from "./searchTypes";
import { PUBLIC_LENS_PERSONA_MAP } from "./searchTypes";

export interface ProofReadyResultPacket extends ResultPacket {
  packetId: string;
  packetType: string;
  canonicalEntity: string;
  sourceRefs: ResultSourceRef[];
  claimRefs: ResultClaimRef[];
  answerBlocks: ResultAnswerBlock[];
  explorationMemory: ResultExplorationMemory;
  graphSummary: ResultGraphSummary;
  proofStatus: ProofStatus;
  uncertaintyBoundary: string;
  recommendedNextAction: string;
  graphNodes: ResultGraphNode[];
  graphEdges: ResultGraphEdge[];
  strategicAngles: ResultStrategicAngle[];
  progressionProfile: ResultFounderProgressionProfile;
  progressionTiers: ResultProgressionTierDefinition[];
  diligencePack: ResultDiligencePackDefinition;
  readinessScore: number;
  unlocks: ResultUnlockCriteria[];
  materialsChecklist: ResultMaterialsChecklistItem[];
  scorecards: ResultFounderScorecard[];
  shareableArtifacts: NonNullable<ResultPacket["shareableArtifacts"]>;
  visibility: FounderPacketVisibility;
  benchmarkEvidence: ResultAutonomyBenchmarkRun[];
  workflowComparison: ResultWorkflowPathComparison;
  operatingModel: ResultFounderOperatingModel;
  workflowAsset: ResultWorkflowAsset;
  distributionSurfaceStatus: ResultDistributionSurfaceStatus[];
  companyReadinessPacket: ResultCompanyReadinessPacket;
  companyNamingPack: ResultCompanyNamingPack;
}

export interface ProgressStage {
  id:
    | "intent"
    | "context"
    | "sources"
    | "entities"
    | "claims"
    | "contradictions"
    | "answer";
  label: string;
  countLabel: string;
  status: "pending" | "running" | "completed" | "error";
}

export interface LiveProgressModel {
  personaId: string;
  proofStatus: ProofStatus;
  stages: ProgressStage[];
  counts: ResultExplorationMemory;
  graphSummary: ResultGraphSummary;
}

type LooseSignal = {
  name?: string;
  title?: string;
  label?: string;
  body?: string;
  description?: string;
  direction?: "up" | "down" | "neutral";
  impact?: "high" | "medium" | "low";
};

type LooseNextAction = {
  action?: string;
  impact?: "high" | "medium" | "low";
};

type LooseResultPacket = ResultPacket & {
  variables?: ResultPacket["variables"];
  signals?: LooseSignal[];
  nextActions?: LooseNextAction[];
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function buildPacketId(packet: ResultPacket): string {
  return (
    packet.packetId ??
    `pkt-${slugify(packet.entityName || "nodebench")}-${hashString(
      `${packet.query}|${packet.answer}|${packet.sourceCount}`,
    )}`
  );
}

function buildWorkflowAssetId(packet: ResultPacket): string {
  const packetId = packet.packetId ?? buildPacketId(packet);
  return (
    packet.workflowAsset?.assetId ??
    `asset:${slugify(packet.canonicalEntity || packet.entityName || "nodebench")}:${packetId}`
  );
}

function isGenericWorkspaceLabel(value?: string): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return ["your workspace", "workspace", "nodebench-mcp", "nodebench mcp"].includes(normalized);
}

function resolveDisplayEntityName(packet: ResultPacket): string {
  if (!isGenericWorkspaceLabel(packet.entityName)) return packet.entityName;
  const companyName = packet.companyReadinessPacket?.identity?.companyName;
  if (companyName) return companyName;
  const recommendedName = packet.companyNamingPack?.recommendedName;
  if (recommendedName) return recommendedName;
  const canonicalEntity =
    typeof packet.canonicalEntity === "string"
      ? packet.canonicalEntity
      : undefined;
  if (canonicalEntity && !isGenericWorkspaceLabel(canonicalEntity)) return canonicalEntity;
  if (packet.operatingModel?.packetRouter.companyMode === "own_company") return "Your Company";
  return packet.entityName || "NodeBench";
}

function resolvePacketType(packet: ResultPacket, lens: LensId): string {
  if (packet.packetType && packet.packetType !== "general_packet") return packet.packetType;
  const routed = packet.operatingModel?.packetRouter.packetType;
  if (routed) return routed;
  if (lens === "founder") return "founder_progression_packet";
  if (lens === "banker") return "banking_readiness_packet";
  if (lens === "ceo" || lens === "investor") return "operating_brief";
  if (lens === "legal") return "diligence_packet";
  if (lens === "student") return "study_brief";
  return packet.packetType ?? "founder_packet";
}

function inferFounderCompanyMode(packet: ResultPacket, lens: LensId): "own_company" | "external_company" | "mixed_comparison" {
  const routedMode = packet.operatingModel?.packetRouter.companyMode;
  if (routedMode) return routedMode;

  const queryText = `${packet.query} ${packet.entityName} ${packet.canonicalEntity ?? ""}`.toLowerCase();
  if (/\b(my company|our company|my startup|our startup|weekly reset|founder reset|pre-delegation|important change)\b/i.test(queryText)) {
    return "own_company";
  }
  if (lens === "founder" && /\b(y combinator|investor readiness|investor packet|pitch deck|fundraising)\b/i.test(queryText)) {
    return "own_company";
  }
  if (/\b(vs\.?|versus|compare|comparison)\b/i.test(queryText)) {
    return "mixed_comparison";
  }
  return "external_company";
}

function shouldIncludeFounderScaffolding(packet: ResultPacket, lens: LensId): boolean {
  const companyMode = inferFounderCompanyMode(packet, lens);
  if (companyMode === "own_company") return true;
  const packetType = resolvePacketType(packet, lens);
  return /weekly_reset|pre_delegation|important_change|founder_progression/i.test(packetType);
}

function inferDomain(href?: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function normalizeSource(
  source: ResultSourceRef,
  index: number,
  packet: ResultPacket,
): ResultSourceRef {
  const id =
    source.id ||
    `source:${slugify(packet.entityName || "entity")}:${hashString(
      `${source.label}|${source.href}|${index}`,
    )}`;
  return {
    id,
    label: source.label || `Source ${index + 1}`,
    href: source.href,
    type: source.type ?? (source.href ? "web" : "doc"),
    status: source.status ?? "cited",
    title: source.title ?? source.label ?? `Source ${index + 1}`,
    domain: source.domain ?? inferDomain(source.href) ?? "local memory",
    publishedAt: source.publishedAt,
    thumbnailUrl: source.thumbnailUrl,
    excerpt:
      source.excerpt ??
      `${packet.entityName} evidence item ${index + 1} retained during the final answer assembly.`,
    confidence: source.confidence ?? Math.max(55, packet.confidence - index * 4),
  };
}

function buildSyntheticSources(packet: ResultPacket): ResultSourceRef[] {
  const sources: ResultSourceRef[] = [];
  const pushSource = (label: string, excerpt: string, status: ResultSourceRef["status"] = "cited") => {
    sources.push({
      id: `source:${slugify(packet.entityName || "entity")}:${hashString(
        `${label}|${excerpt}|${sources.length}`,
      )}`,
      label,
      title: label,
      type: "doc",
      status,
      domain: "nodebench memory",
      excerpt,
      confidence: Math.max(55, packet.confidence - sources.length * 3),
    });
  };

  if (packet.changes?.length) {
    packet.changes.forEach((change, index) => {
      pushSource(
        `${packet.entityName} change ${index + 1}`,
        change.description,
      );
    });
  }
  if (packet.risks?.length) {
    packet.risks.forEach((risk, index) => {
      pushSource(
        `${packet.entityName} contradiction ${index + 1}`,
        risk.description,
      );
    });
  }
  if (packet.comparables?.length) {
    packet.comparables.forEach((comparable) => {
      pushSource(
        comparable.name,
        comparable.note,
      );
    });
  }
  if (!sources.length) {
    for (let index = 0; index < Math.max(1, Math.min(packet.sourceCount || 1, 4)); index += 1) {
      pushSource(
        `${packet.entityName} source ${index + 1}`,
        packet.answer,
      );
    }
  }
  return sources.slice(0, Math.max(1, Math.min(packet.sourceCount || sources.length, 8)));
}

function normalizeSources(packet: ResultPacket): ResultSourceRef[] {
  const sources = packet.sourceRefs?.length ? packet.sourceRefs : buildSyntheticSources(packet);
  return sources.map((source, index) => normalizeSource(source, index, packet));
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function firstUsefulText(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function summarizeSignal(signal: LooseSignal, index: number): string {
  const text = firstUsefulText(signal.name, signal.title, signal.label, signal.description, signal.body);
  if (!text) return `Signal ${index + 1}`;
  const sentence = text.split(/(?<=[.!?])\s+/)[0]?.trim();
  return sentence || text;
}

function formatRiskText(risk: { title?: string; description?: string | null; body?: string | null; detail?: string | null }): string {
  const title = firstUsefulText(risk.title, "Risk") ?? "Risk";
  const description = firstUsefulText(risk.description, risk.body, risk.detail);
  return description ? `${title}: ${description}` : title;
}

function normalizeInputPacket(packet: ResultPacket): ResultPacket {
  const loosePacket = packet as LooseResultPacket;
  const variables = Array.isArray(loosePacket.variables)
    ? loosePacket.variables
    : asArray(loosePacket.signals).map((signal, index) => ({
        rank: index + 1,
        name: summarizeSignal(signal, index),
        direction: signal.direction ?? "neutral",
        impact: signal.impact ?? "medium",
      }));
  const interventions = Array.isArray(packet.interventions)
    ? packet.interventions
    : asArray(loosePacket.nextActions)
        .map((action) => ({
          action: action.action ?? "",
          impact: action.impact ?? "medium",
        }))
        .filter((action) => action.action.trim().length > 0);
  const comparables = asArray(packet.comparables).filter((comparable: any) => {
    const name = typeof comparable?.name === "string" ? comparable.name.trim() : "";
    const note = typeof comparable?.note === "string" ? comparable.note.trim() : "";
    return name.length > 0 || note.length > 0;
  });

  return {
    ...packet,
    variables,
    keyMetrics: asArray(packet.keyMetrics),
    changes: asArray(packet.changes),
    risks: asArray(packet.risks).map((risk: any) => ({
      title: firstUsefulText(risk.title, risk.name) ?? "Risk",
      description: firstUsefulText(risk.description, risk.body, risk.detail) ?? "",
      falsification: risk.falsification,
      sourceIdx: risk.sourceIdx,
    })),
    comparables,
    scenarios: asArray(packet.scenarios),
    interventions,
    nextQuestions: asArray(packet.nextQuestions),
    sourceRefs: asArray(packet.sourceRefs),
    claimRefs: asArray(packet.claimRefs),
    answerBlocks: asArray(packet.answerBlocks),
  };
}

function buildClaimRefs(
  packet: ResultPacket,
  sources: ResultSourceRef[],
): ResultClaimRef[] {
  if (packet.claimRefs?.length) {
    return packet.claimRefs.map((claim, index) => ({
      ...claim,
      id: claim.id || `claim:${hashString(`${claim.text}|${index}`)}`,
      sourceRefIds:
        claim.sourceRefIds?.length
          ? claim.sourceRefIds
          : sources.slice(0, 1).map((source) => source.id),
      answerBlockIds: claim.answerBlockIds ?? [],
      status: claim.status ?? "retained",
    }));
  }

  const claims: ResultClaimRef[] = [];
  packet.variables.forEach((variable, index) => {
    claims.push({
      id: `claim:${slugify(variable.name)}:${index}`,
      text: variable.name,
      sourceRefIds: sources.slice(index % Math.max(sources.length, 1), (index % Math.max(sources.length, 1)) + 1).map((source) => source.id),
      answerBlockIds: [],
      status: "retained",
    });
  });
  packet.risks?.forEach((risk, index) => {
    claims.push({
      id: `claim:risk:${slugify(risk.title)}:${index}`,
      text: risk.title,
      sourceRefIds: sources.slice(index % Math.max(sources.length, 1), (index % Math.max(sources.length, 1)) + 1).map((source) => source.id),
      answerBlockIds: [],
      status: "contradicted",
    });
  });
  packet.changes?.forEach((change, index) => {
    claims.push({
      id: `claim:change:${index}`,
      text: change.description,
      sourceRefIds: sources.slice(index % Math.max(sources.length, 1), (index % Math.max(sources.length, 1)) + 1).map((source) => source.id),
      answerBlockIds: [],
      status: "retained",
    });
  });
  return claims;
}

function blockSourcesByIndex(
  sources: ResultSourceRef[],
  start: number,
  size = 2,
): string[] {
  if (!sources.length) return [];
  const refs: string[] = [];
  for (let offset = 0; offset < size; offset += 1) {
    refs.push(sources[(start + offset) % sources.length].id);
  }
  return Array.from(new Set(refs));
}

function buildAnswerBlocks(
  packet: ResultPacket,
  sources: ResultSourceRef[],
  claims: ResultClaimRef[],
): ResultAnswerBlock[] {
  if (packet.answerBlocks?.length) {
    return packet.answerBlocks.map((block, index) => ({
      ...block,
      id: block.id || `answer_block:${index}`,
      sourceRefIds: block.sourceRefIds?.length ? block.sourceRefIds : blockSourcesByIndex(sources, index),
      claimIds:
        block.claimIds?.length
          ? block.claimIds
          : claims.slice(index, index + 2).map((claim) => claim.id),
      status: block.status ?? "cited",
    }));
  }

  const blocks: ResultAnswerBlock[] = [
    {
      id: "answer_block:summary",
      title: "Executive Summary",
      text: packet.answer,
      sourceRefIds: blockSourcesByIndex(sources, 0, 2),
      claimIds: claims.slice(0, 2).map((claim) => claim.id),
      status: "cited",
    },
  ];
  if (packet.changes?.length) {
    blocks.push({
      id: "answer_block:changes",
      title: "What Changed",
      text: packet.changes.map((change) => change.description).join(" "),
      sourceRefIds: blockSourcesByIndex(sources, 1, 2),
      claimIds: claims
        .filter((claim) => packet.changes?.some((change) => change.description === claim.text))
        .map((claim) => claim.id),
      status: "cited",
    });
  }
  if (packet.risks?.length) {
    blocks.push({
      id: "answer_block:risks",
      title: "Contradictions",
      text: packet.risks.map((risk) => formatRiskText(risk)).join(" "),
      sourceRefIds: blockSourcesByIndex(sources, 2, 2),
      claimIds: claims
        .filter((claim) => packet.risks?.some((risk) => risk.title === claim.text))
        .map((claim) => claim.id),
      status: "cited",
    });
  }
  if (packet.interventions?.length || packet.recommendedNextAction) {
    blocks.push({
      id: "answer_block:actions",
      title: "Recommended Next Move",
      text:
        packet.recommendedNextAction ??
        packet.interventions?.map((intervention) => intervention.action).join(" ") ??
        "",
      sourceRefIds: blockSourcesByIndex(sources, 0, 1),
      claimIds: claims.slice(-2).map((claim) => claim.id),
      status: sources.length ? "cited" : "uncertain",
    });
  }
  return blocks;
}

function buildExplorationMemory(
  packet: ResultPacket,
  sources: ResultSourceRef[],
  claims: ResultClaimRef[],
  answerBlocks: ResultAnswerBlock[],
): ResultExplorationMemory {
  if (packet.explorationMemory) return packet.explorationMemory;
  const citedSourceCount = sources.filter((source) => source.status === "cited").length;
  const discardedSourceCount = sources.filter((source) => source.status === "discarded").length;
  return {
    exploredSourceCount: Math.max(packet.sourceCount || sources.length, sources.length),
    citedSourceCount,
    discardedSourceCount,
    entityCount: Math.max(1, packet.comparables?.length ?? 1),
    claimCount: claims.length || answerBlocks.length,
    contradictionCount: packet.risks?.length ?? 0,
  };
}

function buildGraphNodes(
  packet: ResultPacket,
  lens: LensId,
  sources: ResultSourceRef[],
  claims: ResultClaimRef[],
  answerBlocks: ResultAnswerBlock[],
  proofStatus: ProofStatus,
): ResultGraphNode[] {
  const personaId = PUBLIC_LENS_PERSONA_MAP[lens];
  const nodes: ResultGraphNode[] = [
    { id: "node:query", kind: "query", label: packet.query, status: proofStatus },
    { id: "node:lens", kind: "lens", label: lens, status: proofStatus },
    { id: "node:persona", kind: "persona", label: personaId, status: proofStatus },
    { id: "node:entity", kind: "entity", label: packet.canonicalEntity || packet.entityName, status: proofStatus },
  ];
  sources.forEach((source) => {
    nodes.push({
      id: source.id,
      kind: "source",
      label: source.label,
      status:
        source.status === "discarded"
          ? "incomplete"
          : source.status === "cited"
            ? "verified"
            : "provisional",
      confidence: source.confidence,
    });
  });
  claims.forEach((claim) => {
    nodes.push({
      id: claim.id,
      kind: claim.status === "contradicted" ? "contradiction" : "claim",
      label: claim.text,
      status: claim.status === "discarded" ? "incomplete" : "verified",
    });
  });
  answerBlocks.forEach((block) => {
    nodes.push({
      id: block.id,
      kind: "answer_block",
      label: block.title,
      status: block.status === "cited" ? "verified" : "provisional",
    });
  });
  if (packet.recommendedNextAction || packet.nextQuestions?.length) {
    nodes.push({
      id: "node:follow_up",
      kind: "follow_up",
      label: packet.recommendedNextAction ?? packet.nextQuestions?.[0] ?? "Follow up",
      status: proofStatus,
    });
  }
  return nodes;
}

function buildGraphEdges(
  sources: ResultSourceRef[],
  claims: ResultClaimRef[],
  answerBlocks: ResultAnswerBlock[],
  hasFollowUp: boolean,
): ResultGraphEdge[] {
  const edges: ResultGraphEdge[] = [
    { fromId: "node:query", toId: "node:lens", kind: "selected" },
    { fromId: "node:lens", toId: "node:persona", kind: "selected" },
    { fromId: "node:persona", toId: "node:entity", kind: "about" },
  ];
  sources.forEach((source) => {
    edges.push({ fromId: "node:query", toId: source.id, kind: "explored" });
  });
  claims.forEach((claim) => {
    claim.sourceRefIds.forEach((sourceRefId) => {
      edges.push({
        fromId: sourceRefId,
        toId: claim.id,
        kind: claim.status === "contradicted" ? "conflicts_with" : "supports",
      });
    });
  });
  answerBlocks.forEach((block) => {
    block.claimIds.forEach((claimId) => {
      edges.push({ fromId: claimId, toId: block.id, kind: "used_in" });
    });
  });
  if (hasFollowUp) {
    answerBlocks.forEach((block) => {
      edges.push({ fromId: block.id, toId: "node:follow_up", kind: "suggests" });
    });
  }
  return edges;
}

function inferProofStatus(
  packet: ResultPacket,
  sources: ResultSourceRef[],
  answerBlocks: ResultAnswerBlock[],
): ProofStatus {
  if (!sources.length) return "incomplete";
  const allCited = answerBlocks.every(
    (block) => block.status !== "cited" || block.sourceRefIds.length > 0,
  );
  if (!allCited) return "incomplete";
  if (packet.risks?.length) return "drifting";
  if (sources.some((source) => source.status === "cited")) return "verified";
  return "provisional";
}

function buildGraphSummary(
  packet: ResultPacket,
  memory: ResultExplorationMemory,
  nodeCount: number,
  edgeCount: number,
): ResultGraphSummary {
  return (
    packet.graphSummary ?? {
      nodeCount,
      edgeCount,
      clusterCount: Math.max(1, Math.min(4, memory.entityCount + (memory.contradictionCount ? 1 : 0))),
      primaryPath: [
        "Query received",
        `${memory.exploredSourceCount} sources explored`,
        `${memory.claimCount} claims retained`,
        `${memory.contradictionCount} contradictions tracked`,
        `${memory.citedSourceCount} cited sources`,
      ],
    }
  );
}

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function buildStrategicAngles(
  packet: ResultPacket,
  sources: ResultSourceRef[],
  lens: LensId,
): ResultStrategicAngle[] {
  const existing = packet.strategicAngles;
  if (existing?.length) {
    return existing;
  }

  const queryText = `${packet.query} ${packet.answer}`.toLowerCase();
  const signalText = packet.variables.map((item) => item.name).join(" ").toLowerCase();
  const sourceIds = sources.slice(0, 2).map((source) => source.id);
  const highConfidence = packet.confidence >= 80;
  const sourceRich = sources.filter((source) => source.status === "cited").length >= 2;
  const integrationHeavy = includesAny(queryText, ["mcp", "api", "plugin", "integration", "claude code", "cursor", "workflow"]);
  const installFriendly = includesAny(queryText, ["install", "local", "cli", "dashboard", "subscription", "mcp", "retention.sh"]);
  const maintenanceHeavy = includesAny(queryText, ["maintenance", "maintain", "update", "support", "ops", "dashboard service", "subscription service"]);
  const regulated = includesAny(queryText, ["legal", "regulatory", "healthcare", "fda", "bank", "compliance"]);
  const aiSkeptic = includesAny(queryText, ["no ai", "without ai", "anti ai", "environment", "peace", "altruistic"]);
  const constrainedTeam = includesAny(queryText, ["specific skillset", "narrow skillset", "solo founder", "limited team", "small team"]);
  const evidenceStrong = highConfidence && sourceRich;
  const marketAligned = includesAny(queryText, ["claude code", "developer", "team", "workflow", "founder", "agent", "dashboard"]) || includesAny(signalText, ["distribution", "workflow", "developer", "adoption"]);

  const angles: ResultStrategicAngle[] = [
    {
      id: "team-shape",
      title: "Team shape and complementary gaps",
      status: constrainedTeam ? "watch" : "unknown",
      summary: constrainedTeam
        ? "The direction appears to lean on a narrow or founder-heavy skillset, which can sharpen the wedge but also expose obvious complementary gaps."
        : "The packet does not yet explain whether the team shape is a real edge or an unaddressed bottleneck.",
      whyItMatters: "Specific skillsets help when they map directly to the wedge, but they slow progress when GTM, support, or adjacent execution gaps remain implicit.",
      evidenceRefIds: sourceIds,
      nextQuestion: "Which complementary capability would most reduce risk for this direction right now?",
    },
    {
      id: "founder-fit",
      title: "Founder-skill and credibility fit",
      status: evidenceStrong ? "watch" : "unknown",
      summary: evidenceStrong
        ? "The opportunity is legible, but the packet still needs explicit proof that your team background makes this wedge believable to users and investors."
        : "The current run does not yet establish why this team is the credible builder for the idea.",
      whyItMatters: "Founding direction breaks when the team's real edge, speed, and narrative do not match the product promise.",
      evidenceRefIds: sourceIds,
      nextQuestion: "What founder background, customer access, or technical edge makes us the believable team for this direction?",
    },
    {
      id: "build-speed",
      title: "Build speed and maintenance burden",
      status: regulated ? "watch" : integrationHeavy || installFriendly ? "strong" : "watch",
      summary: regulated
        ? "The opportunity touches regulated or high-trust surfaces, so build speed may look better on paper than it will in practice."
        : integrationHeavy || installFriendly
          ? "The idea appears to fit existing workflows and install surfaces, which improves time-to-value and reduces maintenance drag."
          : "The product story is still missing evidence that it can be built and maintained quickly with the current stack and team.",
      whyItMatters: "Fast founder loops depend on shipping something installable, supportable, and updateable before the market moves again.",
      evidenceRefIds: sourceIds,
      nextQuestion: "What is the smallest installable wedge we can ship in 2-4 weeks without creating long-term maintenance debt?",
    },
    {
      id: "installability",
      title: "Installability and update path",
      status: installFriendly ? "strong" : "watch",
      summary: installFriendly
        ? "The direction appears to fit real install surfaces such as local CLI, MCP, or a hosted dashboard, which improves onboarding and update reliability."
        : "The packet still needs proof that users can install, maintain, and update this without high-touch support.",
      whyItMatters: "Products that are easy to install and keep current spread faster and generate less early support drag.",
      evidenceRefIds: sourceIds,
      nextQuestion: "Is the first wedge easiest to adopt as a local MCP tool, a browser workflow, or a hosted team dashboard?",
    },
    {
      id: "maintainability",
      title: "Maintainability and service burden",
      status: maintenanceHeavy || regulated ? "watch" : installFriendly ? "strong" : "watch",
      summary: maintenanceHeavy || regulated
        ? "The direction likely creates ongoing update, support, or compliance work, so the team needs a clearer owner model and service boundary."
        : "The current architecture suggests the product can stay relatively lean to operate if the first wedge remains narrow.",
      whyItMatters: "Founders lose momentum when the first product creates more support and maintenance load than compounding leverage.",
      evidenceRefIds: sourceIds,
      nextQuestion: "What parts of this should be productized, automated, or intentionally left out so maintenance load stays bounded?",
    },
    {
      id: "adoption",
      title: "Workflow adoption and distribution fit",
      status: marketAligned ? "strong" : "watch",
      summary: marketAligned
        ? "The packet points toward a workflow users already run today, including current developer loops like Claude Code and adjacent agent tooling."
        : "The opportunity still needs proof that it rides a workflow people already use at high frequency rather than requiring behavior change.",
      whyItMatters: "Founders win faster when the product plugs into where the user already works instead of demanding a new ritual.",
      evidenceRefIds: sourceIds,
      nextQuestion: "Which current user workflow does this replace, accelerate, or become unavoidable inside?",
    },
    {
      id: "commercial",
      title: "Commercialization and saleability",
      status: installFriendly ? "strong" : "watch",
      summary: installFriendly
        ? "The direction can plausibly expand from tool to managed dashboard or team subscription, which supports a credible monetization path."
        : "The packet does not yet prove how the tool becomes a repeatable paid product, service, or team subscription.",
      whyItMatters: "A good prototype is not enough; the business has to be easy to buy, maintain, and eventually scale or sell.",
      evidenceRefIds: sourceIds,
      nextQuestion: "Does this become a paid dashboard, agent workflow subscription, or a service layer teams can justify recurring spend on?",
    },
    {
      id: "conviction",
      title: "User and investor conviction",
      status: evidenceStrong ? "strong" : "watch",
      summary: evidenceStrong
        ? "There is enough cited evidence to start a conviction story, but it still needs sharper proof on why now and why this team."
        : "The idea needs stronger proof and comparables before it will convincingly survive user or investor diligence.",
      whyItMatters: "Conviction compounds when the packet can explain timing, proof, and upside in a way others can repeat.",
      evidenceRefIds: sourceIds,
      nextQuestion: "What proof points, comparables, and traction signals would make this direction legible to both users and investors?",
    },
  ];

  if (lens === "founder" || aiSkeptic) {
    angles.push({
      id: "ai-tradeoffs",
      title: "AI stance and mission tradeoffs",
      status: aiSkeptic ? "watch" : "unknown",
      summary: aiSkeptic
        ? "The query itself raises discomfort with AI or model usage, so the product needs a clearer position on where AI helps and where it should be minimized."
        : "The current packet does not yet resolve whether AI is essential to the product or simply a convenience layer that may alienate some users.",
      whyItMatters: "Founders need a deliberate answer for users or teammates who resist AI on ethical, environmental, or mission grounds.",
      evidenceRefIds: sourceIds,
      nextQuestion: "Where is AI actually necessary here, and where should we offer a non-AI or low-AI path so the product stays aligned with the mission?",
    });
  }

  return angles;
}

const DEFAULT_PROGRESSION_TIERS: ResultProgressionTierDefinition[] = [
  { id: "clarity", label: "Stage 0: Clarity", priceLabel: "Free", unlocks: ["Idea pressure test", "Starter packet"], services: ["Search/upload/ask", "Weekly reset"] },
  { id: "foundation", label: "Stage 1: Foundation", priceLabel: "$1", unlocks: ["Missing foundations", "Delegation packet"], services: ["Readiness checklist", "Decision memo export"] },
  { id: "readiness", label: "Stage 2: Readiness", priceLabel: "$5", unlocks: ["Investor and banker packets", "Diligence pack"], services: ["Qualification scoring", "Artifact history"] },
  { id: "leverage", label: "Stage 3: Leverage", priceLabel: "$20", unlocks: ["Ambient monitoring", "Benchmark proof"], services: ["Shared context ops", "Workflow optimization"] },
  { id: "scale", label: "Stage 4: Scale", priceLabel: "Custom", unlocks: ["Hosted monitoring", "Workspace collaboration"], services: ["Premium scoring", "Enterprise support"] },
];

function buildFallbackProgressionProfile(
  packet: ResultPacket,
  strategicAngles: ResultStrategicAngle[],
): ResultFounderProgressionProfile {
  const hiddenRisks = strategicAngles
    .filter((angle) => angle.status !== "strong")
    .map((angle) => `${angle.title}: ${angle.summary}`);
  const readinessScore = packet.readinessScore ?? Math.max(40, packet.confidence - hiddenRisks.length * 4);
  const currentStage =
    readinessScore >= 82 ? "scale" :
    readinessScore >= 70 ? "leverage" :
    readinessScore >= 58 ? "readiness" :
    readinessScore >= 45 ? "foundation" :
    "clarity";
  const currentStageLabel = DEFAULT_PROGRESSION_TIERS.find((tier) => tier.id === currentStage)?.label ?? "Stage 0: Clarity";
  const nextUnlocks: ResultUnlockCriteria[] = packet.unlocks ?? [
    {
      id: "useful-packet",
      title: "Generate one useful founder packet and use it in a real decision",
      status: readinessScore >= 55 ? "ready" : "watch",
      requiredSignals: ["Founder packet exported", "Decision memo reused"],
    },
    {
      id: "delegation",
      title: "Delegate one bounded task from the packet",
      status: readinessScore >= 60 ? "ready" : "watch",
      requiredSignals: ["Shared task exists", "Handoff reused"],
    },
  ];
  return {
    currentStage,
    currentStageLabel,
    readinessScore,
    missingFoundations: packet.materialsChecklist?.filter((item) => item.status === "missing").map((item) => item.label) ?? [],
    hiddenRisks,
    nextUnlocks,
    delegableWork: ["Collect diligence evidence", "Prepare the Slack report", "Refresh the packet"],
    founderOnlyWork: ["Choose the wedge", "Decide what stays stealthy", "Own the investor narrative"],
    onTrackStatus: readinessScore >= 60 ? "on_track" : readinessScore >= 48 ? "watch" : "off_track",
    recommendedNextAction:
      packet.recommendedNextAction ??
      nextUnlocks.find((unlock) => unlock.status !== "ready")?.title ??
      "Turn the packet into the main founder workflow this week.",
  };
}

function buildFallbackDiligencePack(packet: ResultPacket): ResultDiligencePackDefinition {
  const healthcare = /healthcare|life science|biotech|medtech|clinical|trial|fda/i.test(`${packet.query} ${packet.answer}`);
  if (healthcare) {
    return {
      id: "healthcare_life_sciences",
      label: "Healthcare / Life Sciences Diligence Pack",
      summary: "Evidence, regulatory path, and institutional credibility that later diligence will ask for.",
      externalEvaluators: ["Healthcare investors", "Banks", "Strategic partners"],
      evidenceClasses: [
        { id: "patents", label: "Patents and IP", description: "Patents, filings, or IP chain of title.", required: true },
        { id: "publications", label: "Publications", description: "Peer-reviewed work and research outputs.", required: true },
        { id: "regulatory", label: "Regulatory path", description: "Regulatory submission path and diligence notes.", required: true },
      ],
      requirements: [
        { id: "ip-proof", title: "Patent and claim verifiability", status: "watch", whyItMatters: "Healthcare claims get challenged quickly without IP and source-backed evidence.", evidenceClassIds: ["patents", "publications"] },
        { id: "regulatory-path", title: "Regulatory and submission clarity", status: "missing", whyItMatters: "Serious diligence expects a credible regulatory path.", evidenceClassIds: ["regulatory"] },
      ],
      highRiskClaims: ["patent defensibility", "clinical efficacy", "regulatory readiness"],
      materials: ["Patent summary", "Publication list", "Regulatory path memo"],
      readyDefinition: "Ready means the core claims can be backed by verifiable evidence and a credible path through diligence.",
    };
  }
  return {
    id: "ai_software",
    label: "AI / Software Diligence Pack",
    summary: "Workflow adoption, installability, benchmark proof, and distribution surfaces for software wedges.",
    externalEvaluators: ["Developers", "Founders", "Early-stage investors"],
    evidenceClasses: [
      { id: "workflow", label: "Workflow adoption", description: "Proof that the product fits existing habits.", required: true },
      { id: "installation", label: "Installability", description: "One-command install and clear update path.", required: true },
      { id: "benchmarks", label: "Benchmark proof", description: "Visible before/after or workflow-optimization evidence.", required: true },
    ],
    requirements: [
      { id: "workflow-fit", title: "Workflow-native adoption", status: "watch", whyItMatters: "Products win faster when they land in current habits like Claude Code and MCP.", evidenceClassIds: ["workflow"] },
      { id: "install-surface", title: "Installability and maintenance boundary", status: "watch", whyItMatters: "Setup and support friction blocks distribution.", evidenceClassIds: ["installation"] },
    ],
    highRiskClaims: ["workflow lock-in", "maintainability", "distribution moat"],
    materials: ["Founder packet", "Install plan", "Benchmark memo", "Slack one-page report"],
    readyDefinition: "Ready means the wedge is installable, benchmarked, and attached to a workflow users already repeat.",
  };
}

function buildWorkflowAsset(packet: ResultPacket): ResultWorkflowAsset {
  const canonicalPacketId = packet.packetId ?? buildPacketId(packet);
  const canonicalPacketType = packet.packetType ?? "founder_packet";
  const canonicalEntity = packet.canonicalEntity ?? packet.entityName;
  const existing = packet.workflowAsset;

  return {
    assetId: buildWorkflowAssetId(packet),
    assetType: existing?.assetType ?? "research_packet",
    state: existing?.state ?? "generated",
    canonicalPacketId,
    canonicalPacketType,
    canonicalEntity,
    generatedAt: existing?.generatedAt ?? new Date().toISOString(),
    stages:
      existing?.stages?.length
        ? existing.stages
        : ["ask_surface", "pipeline_search", "packetized_truth", "shared_context_ready"],
    replayReady: existing?.replayReady ?? true,
    delegationReady: existing?.delegationReady ?? Boolean(packet.operatingModel?.packetRouter.shouldDelegate ?? true),
    currentContextId: existing?.currentContextId,
    lastTaskId: existing?.lastTaskId,
    targetAgents:
      existing?.targetAgents?.length
        ? existing.targetAgents
        : packet.companyReadinessPacket?.allowedDestinations ?? ["claude_code", "openclaw"],
    envelopeId: existing?.envelopeId,
    envelopeType: existing?.envelopeType,
    lineage: {
      sourceRunId: existing?.lineage?.sourceRunId ?? canonicalPacketId,
      sourceContextId: existing?.lineage?.sourceContextId,
      parentAssetId: existing?.lineage?.parentAssetId,
    },
  };
}

export function ensureProofPacket(
  packet: ResultPacket,
  lens: LensId = "founder",
): ProofReadyResultPacket {
  const normalizedPacket = normalizeInputPacket(packet);
  const normalizedEntityName = resolveDisplayEntityName(normalizedPacket);
  const normalizedPacketType = resolvePacketType(normalizedPacket, lens);
  const identityPacket: ResultPacket = {
    ...normalizedPacket,
    entityName: normalizedEntityName,
    canonicalEntity:
      typeof normalizedPacket.canonicalEntity === "string" && !isGenericWorkspaceLabel(normalizedPacket.canonicalEntity)
        ? normalizedPacket.canonicalEntity
        : normalizedEntityName,
    packetType: normalizedPacketType,
  };
  const sources = normalizeSources(identityPacket);
  const claims = buildClaimRefs(identityPacket, sources);
  const answerBlocks = buildAnswerBlocks(identityPacket, sources, claims);
  const memory = buildExplorationMemory(identityPacket, sources, claims, answerBlocks);
  const proofStatus = identityPacket.proofStatus ?? inferProofStatus(identityPacket, sources, answerBlocks);
  const founderScaffoldingEnabled = shouldIncludeFounderScaffolding(identityPacket, lens);
  const graphNodes =
    identityPacket.graphNodes ??
    buildGraphNodes(identityPacket, lens, sources, claims, answerBlocks, proofStatus);
  const graphEdges =
    identityPacket.graphEdges ??
    buildGraphEdges(
      sources,
      claims,
      answerBlocks,
      Boolean(identityPacket.recommendedNextAction || identityPacket.nextQuestions?.length),
    );
  const graphSummary = buildGraphSummary(identityPacket, memory, graphNodes.length, graphEdges.length);
  const strategicAngles = founderScaffoldingEnabled ? buildStrategicAngles(identityPacket, sources, lens) : [];
  const diligencePack = identityPacket.diligencePack ?? buildFallbackDiligencePack(identityPacket);
  const materialsChecklist = identityPacket.materialsChecklist ?? diligencePack.materials.map((label, index) => ({
    id: `material:${index + 1}`,
    label,
    status: index === 0 ? "watch" : "missing",
    audience: index < 2 ? "internal" : "external",
    whyItMatters: `External evaluators will later ask for ${label.toLowerCase()}.`,
  }));
  const progressionProfile = identityPacket.progressionProfile ?? buildFallbackProgressionProfile({ ...identityPacket, materialsChecklist }, strategicAngles);
  const visibility = identityPacket.visibility ?? "workspace";
  const distributionSurfaceStatus = identityPacket.distributionSurfaceStatus ?? [
    {
      surfaceId: "mcp_cli",
      label: "MCP / CLI",
      status: /mcp|claude code|cli|local/i.test(`${identityPacket.query} ${identityPacket.answer}`) ? "ready" : "partial",
      whyItMatters: "Open-core install surface with the lowest setup friction.",
    },
    {
      surfaceId: "dashboard",
      label: "Hosted dashboard",
      status: /dashboard|subscription|team|service/i.test(`${identityPacket.query} ${identityPacket.answer}`) ? "partial" : "missing",
      whyItMatters: "Retained value and collaboration surface for paid stages.",
    },
  ];
  const scorecards = identityPacket.scorecards ?? [
    {
      id: "two_week",
      label: "2-week scorecard",
      status: progressionProfile.readinessScore >= 58 ? "on_track" : progressionProfile.readinessScore >= 45 ? "watch" : "off_track",
      summary: "Ship one useful packet, one delegated task, and one shareable artifact.",
      mustHappen: [
        "Produce one useful founder packet",
        "Generate a progression diagnosis",
        "Delegate one bounded task",
        "Export one shareable artifact",
      ],
    },
    {
      id: "three_month",
      label: "3-month scorecard",
      status: progressionProfile.currentStage === "leverage" || progressionProfile.currentStage === "scale" ? "on_track" : "watch",
      summary: "Prove repeated use, packet reuse, and one benchmark-backed proof story.",
      mustHappen: [
        "Show repeated packet reuse",
        "Demonstrate ambient intervention value",
        "Retain at least one paid-stage workflow",
        "Publish one benchmark-backed proof story",
      ],
    },
  ];
  const shareableArtifacts = identityPacket.shareableArtifacts ?? (
    founderScaffoldingEnabled
      ? [
          {
            id: "artifact:slack_onepage",
            type: "slack_onepage",
            title: "Founder one-page Slack report",
            visibility,
            summary: "One-page founder report for Slack with stage, risks, and next moves.",
            payload: {
              text: [
                "*NodeBench Founder Report*",
                `Stage: ${progressionProfile.currentStageLabel}`,
                `Readiness: ${progressionProfile.readinessScore}/100`,
                `Next move: ${progressionProfile.recommendedNextAction}`,
              ].join("\n"),
            },
          },
        ]
      : []
  );
  const benchmarkEvidence = identityPacket.benchmarkEvidence ?? [];
  const workflowComparison = identityPacket.workflowComparison ?? {
    objective: identityPacket.query,
    currentPath: [
      "Restate the founder context manually",
      "Search for comparables from scratch",
      "Draft a memo without a canonical packet",
      "Hand off work without durable lineage",
    ],
    optimizedPath: [
      "Reuse the founder packet",
      "Refresh only missing diligence",
      "Export the Slack one-page report",
      "Delegate from shared context with packet lineage",
    ],
    rationale:
      "The optimized path removes repeated restatement and keeps the work tied to a durable packet, export adapter, and shared delegation spine.",
    validationChecks: [
      "The same decision artifact still exists at the end",
      "Required diligence fields remain present",
      "Contradictory evidence stays visible instead of being overwritten",
    ],
    estimatedSavings: {
      timePercent: 38,
      costPercent: 24,
    },
    verdict: "valid",
  };
  const operatingModel = identityPacket.operatingModel ?? {
    executionOrder: [
      { id: "ingest", label: "Ingest", description: "Collect the query, uploads, and allowed source context." },
      { id: "classify", label: "Classify", description: "Resolve role, company mode, and vertical before routing." },
      { id: "canonicalize", label: "Canonicalize", description: "Stabilize the company or entity into a canonical packet identity." },
      { id: "score", label: "Score", description: "Score readiness, contradictions, and missing evidence." },
      { id: "packet", label: "Choose Packet", description: "Pick the packet and artifact type from policy, not ad hoc UI logic." },
      { id: "act", label: "Act", description: "Decide whether to monitor, export, delegate, or keep gathering evidence." },
      { id: "replay", label: "Replay", description: "Store before and after state so the run can be audited and replayed." },
    ],
    queueTopology: [
      { id: "ingestion", label: "Ingestion", purpose: "Normalize incoming context into canonical inputs.", upstream: ["query", "upload"], outputs: ["structured claims", "source receipts"] },
      { id: "packet_refresh", label: "Packet Refresh", purpose: "Run sweeps, delta computation, and packet refreshes.", upstream: ["sweeps", "delta"], outputs: ["updated packets", "staleness receipts"] },
      { id: "artifact_render", label: "Artifacts", purpose: "Render exports, delivery payloads, and reminders.", upstream: ["packet_refresh"], outputs: ["rendered artifacts", "delivery receipts"] },
      { id: "benchmark_runs", label: "Autonomy", purpose: "Dispatch delegation and benchmark runs with replay.", upstream: ["manual benchmark", "packet_refresh"], outputs: ["benchmark runs", "oracle verdicts"] },
    ],
    sourcePolicies: [
      { sourceType: "uploads", canRead: true, canStore: true, canSummarize: true, exportPolicy: "redact", notes: "Founder uploads can drive packets, but external export stays private by default." },
      { sourceType: "web_research", canRead: true, canStore: false, canSummarize: true, exportPolicy: "allow", notes: "Public web evidence can be summarized and exported with provenance." },
      { sourceType: "agent_outputs", canRead: true, canStore: true, canSummarize: true, exportPolicy: "redact", notes: "Generated agent outputs must be validated before broad sharing." },
      { sourceType: "slack", canRead: true, canStore: true, canSummarize: true, exportPolicy: "redact", notes: "Slack context remains owner-scoped and redacted in exports." },
    ],
    roleDefault: {
      role: lens,
      defaultPacketType:
        lens === "banker"
          ? "banking_readiness_packet"
          : lens === "ceo"
            ? "operating_brief"
            : lens === "legal"
              ? "diligence_verification_packet"
              : lens === "student"
                ? "study_brief"
                : "founder_progression_packet",
      defaultArtifactType: lens === "student" ? "study_brief" : "slack_onepage",
      shouldMonitorByDefault: lens !== "student",
      shouldDelegateByDefault: lens === "founder",
    },
    packetRouter: {
      role: lens,
      companyMode: identityPacket.query.toLowerCase().includes("my company") ? "own_company" : "external_company",
      packetType: identityPacket.packetType ?? "founder_packet",
      artifactType: shareableArtifacts[0]?.type ?? "slack_onepage",
      shouldMonitor: true,
      shouldExport: shareableArtifacts.length > 0,
      shouldDelegate: progressionProfile.delegableWork.length > 0,
      needsMoreEvidence: materialsChecklist.some((item) => item.status === "missing"),
      requiredEvidence: materialsChecklist.filter((item) => item.status !== "ready").map((item) => item.label),
      visibility,
      rationale: "Route from role, company mode, evidence completeness, and founder sensitivity defaults.",
    },
    progressionRubric: {
      currentStage: progressionProfile.currentStage,
      onTrack: progressionProfile.onTrackStatus === "on_track",
      mandatorySatisfied: materialsChecklist.filter((item) => item.status === "ready").map((item) => item.label),
      mandatoryMissing: materialsChecklist.filter((item) => item.status !== "ready").map((item) => item.label),
      optionalStrengths: [
        ...(shareableArtifacts.length > 0 ? ["shareable_artifact"] : []),
        ...(benchmarkEvidence.length > 0 ? ["benchmark_proof"] : []),
      ],
      rationale: progressionProfile.recommendedNextAction,
    },
    benchmarkOracles: [
      {
        lane: "weekly_founder_reset",
        deterministicChecks: ["stage present", "next action present", "packet reusable"],
        probabilisticJudges: ["advice usefulness", "clarity"],
        baseline: "manual founder weekly recap",
        heldOutScenarios: ["messy early-stage context", "contradictory signals"],
      },
      {
        lane: "cheapest_valid_workflow",
        deterministicChecks: workflowComparison.validationChecks,
        probabilisticJudges: ["shortcut quality preservation"],
        baseline: workflowComparison.currentPath.join(" -> "),
        heldOutScenarios: ["high-uncertainty founder query", "shared-context delegation"],
      },
    ],
  };
  const companyNamingPack = identityPacket.companyNamingPack ?? {
    suggestedNames: [identityPacket.entityName || "Northstar Labs", "Signal Forge", "Atlas Foundry"],
    recommendedName: identityPacket.entityName || "Northstar Labs",
    starterProfile: {
      companyName: identityPacket.entityName || "Northstar Labs",
      oneLineDescription: identityPacket.answer || "Founder operating system with reusable packets and workflow proof.",
      categories: [diligencePack.label],
      stage: progressionProfile.currentStageLabel,
      initialCustomers: ["Founders", "Operators"],
      wedge: progressionProfile.recommendedNextAction,
    },
  };
  const companyReadinessPacket = identityPacket.companyReadinessPacket ?? {
    packetId: identityPacket.packetId ?? buildPacketId(identityPacket),
    visibility,
    identity: {
      companyName: companyNamingPack.recommendedName,
      vertical: diligencePack.label.includes("Healthcare") ? "healthcare/life sciences" : "AI/software",
      subvertical: diligencePack.label.includes("Healthcare") ? "biotech and clinical" : "developer and agent tooling",
      stage: progressionProfile.currentStageLabel,
      mission: companyNamingPack.starterProfile.oneLineDescription,
      wedge: companyNamingPack.starterProfile.wedge,
    },
    founderTeamCredibility: ["Make the right-to-win explicit", "Map founder background to the wedge"],
    productAndWedge: [companyNamingPack.starterProfile.oneLineDescription],
    marketAndGtm: ["Meet users in an existing workflow", "Use open-core for trust and the app for retained value"],
    financialReadiness: ["Track runway and burn clearly"],
    operatingReadiness: [...progressionProfile.delegableWork, ...progressionProfile.founderOnlyWork],
    diligenceEvidence: diligencePack.materials,
    contradictionsAndHiddenRisks: progressionProfile.hiddenRisks,
    nextUnlocks: progressionProfile.nextUnlocks.map((unlock) => unlock.title),
    pricingStage: {
      stageId: progressionProfile.currentStage,
      label: progressionProfile.currentStageLabel,
      priceLabel: DEFAULT_PROGRESSION_TIERS.find((tier) => tier.id === progressionProfile.currentStage)?.priceLabel ?? "Free",
    },
    distributionSurfaceStatus,
    provenance: {
      sourceRefIds: sources.map((source) => source.id),
      confidence: identityPacket.confidence,
      freshness: new Date().toISOString(),
    },
    allowedDestinations: ["slack_onepage", "investor_memo", "banker_readiness", "pitchbook_like", "crunchbase_like", "yc_context"],
    sensitivity: visibility === "public" ? "workspace" : visibility,
  };
  const workflowAsset = buildWorkflowAsset({
    ...identityPacket,
    packetId: identityPacket.packetId ?? buildPacketId(identityPacket),
    packetType: identityPacket.packetType ?? "founder_packet",
    canonicalEntity: identityPacket.canonicalEntity ?? identityPacket.entityName,
    companyReadinessPacket,
    operatingModel,
  });

  const enriched: ProofReadyResultPacket = {
    ...identityPacket,
    packetId: buildPacketId(identityPacket),
    packetType: identityPacket.packetType ?? "founder_packet",
    canonicalEntity: identityPacket.canonicalEntity ?? identityPacket.entityName,
    sourceRefs: sources,
    claimRefs: claims,
    answerBlocks,
    explorationMemory: memory,
    graphSummary,
    proofStatus,
    uncertaintyBoundary:
      packet.uncertaintyBoundary ??
      "This answer is grounded in currently retained evidence and may omit unresolved or unavailable private context.",
    recommendedNextAction:
      packet.recommendedNextAction ??
      packet.interventions?.[0]?.action ??
      packet.nextQuestions?.[0] ??
      "Review the strongest contradiction and decide what to verify next.",
    graphNodes,
    graphEdges,
    strategicAngles,
    progressionProfile,
    progressionTiers: packet.progressionTiers ?? DEFAULT_PROGRESSION_TIERS,
    diligencePack,
    readinessScore: packet.readinessScore ?? progressionProfile.readinessScore,
    unlocks: packet.unlocks ?? progressionProfile.nextUnlocks,
    materialsChecklist,
    scorecards,
    shareableArtifacts,
    visibility,
    benchmarkEvidence,
    workflowComparison,
    operatingModel,
    workflowAsset,
    distributionSurfaceStatus,
    companyReadinessPacket,
    companyNamingPack,
  };

  const answerBlockIds = new Set(enriched.answerBlocks.map((block) => block.id));
  enriched.claimRefs = enriched.claimRefs.map((claim) => ({
    ...claim,
    answerBlockIds: claim.answerBlockIds.filter((id) => answerBlockIds.has(id)),
  }));
  return enriched;
}

function stageStatusFromTrace(trace: TraceStep[], matcher: (step: TraceStep) => boolean): ProgressStage["status"] {
  const matching = trace.filter(matcher);
  if (!matching.length) return "pending";
  if (matching.some((step) => step.status === "error")) return "error";
  if (matching.some((step) => step.isRunning)) return "running";
  return "completed";
}

export function buildLiveProgressModel(args: {
  query: string;
  lens: LensId;
  trace: TraceStep[];
  packet?: ResultPacket | null;
}): LiveProgressModel {
  const packet = args.packet ? ensureProofPacket(args.packet, args.lens) : null;
  const counts =
    packet?.explorationMemory ?? {
      exploredSourceCount: Math.max(
        0,
        args.trace.filter(
          (step) =>
            step.step === "tool_call" &&
            Boolean(step.tool?.includes("search") || step.tool?.includes("recon")),
        ).length,
      ),
      citedSourceCount: 0,
      discardedSourceCount: 0,
      entityCount: stageStatusFromTrace(args.trace, (step) => step.step === "llm_extract") !== "pending" ? 1 : 0,
      claimCount: stageStatusFromTrace(args.trace, (step) => step.step === "judge" || step.step === "assemble_response") === "completed" ? 1 : 0,
      contradictionCount: 0,
    };

  const stages: ProgressStage[] = [
    {
      id: "intent",
      label: "Intent parsed",
      countLabel: args.query ? "1 query" : "Waiting",
      status: stageStatusFromTrace(args.trace, (step) => step.step === "classify_query"),
    },
    {
      id: "context",
      label: "Context loaded",
      countLabel: stageStatusFromTrace(args.trace, (step) => step.step === "build_context_bundle") === "pending" ? "Pending" : "1 bundle",
      status: stageStatusFromTrace(args.trace, (step) => step.step === "build_context_bundle"),
    },
    {
      id: "sources",
      label: "Sources explored",
      countLabel: `${counts.exploredSourceCount} explored`,
      status: stageStatusFromTrace(
        args.trace,
        (step) =>
          step.step === "tool_call" &&
          Boolean(step.tool?.includes("search") || step.tool?.includes("recon")),
      ),
    },
    {
      id: "entities",
      label: "Entities extracted",
      countLabel: `${counts.entityCount} retained`,
      status: stageStatusFromTrace(
        args.trace,
        (step) => step.step === "llm_extract" || step.step === "tool_call",
      ),
    },
    {
      id: "claims",
      label: "Claims retained",
      countLabel: `${counts.claimCount} claims`,
      status: stageStatusFromTrace(
        args.trace,
        (step) => step.step === "judge" || step.step === "assemble_response",
      ),
    },
    {
      id: "contradictions",
      label: "Contradictions",
      countLabel: `${counts.contradictionCount} tracked`,
      status:
        counts.contradictionCount > 0
          ? "completed"
          : stageStatusFromTrace(args.trace, (step) => step.step === "judge"),
    },
    {
      id: "answer",
      label: "Answer assembling",
      countLabel: packet ? `${packet.answerBlocks.length} blocks` : "In progress",
      status:
        packet ||
        stageStatusFromTrace(args.trace, (step) => step.step === "assemble_response") ===
          "completed"
          ? "completed"
          : stageStatusFromTrace(args.trace, (step) => step.step === "assemble_response"),
    },
  ];

  return {
    personaId: PUBLIC_LENS_PERSONA_MAP[args.lens],
    proofStatus: packet?.proofStatus ?? "loading",
    stages,
    counts,
    graphSummary:
      packet?.graphSummary ?? {
        nodeCount: 2 + counts.exploredSourceCount + counts.claimCount,
        edgeCount: 1 + counts.exploredSourceCount + counts.claimCount,
        clusterCount: Math.max(1, counts.entityCount),
        primaryPath: [
          "Query received",
          counts.exploredSourceCount
            ? `${counts.exploredSourceCount} live sources`
            : "Searching",
          counts.claimCount ? `${counts.claimCount} retained claims` : "Drafting claims",
        ],
      },
  };
}
