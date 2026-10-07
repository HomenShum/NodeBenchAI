import type {
  WorkspaceBudgetDecision,
  WorkspaceEntityType,
  WorkspaceMemoryClaim,
  WorkspaceMemoryEntity,
  WorkspaceMemoryEvidence,
  WorkspaceMemoryFollowUp,
} from "@/features/workspace/data/eventWorkspaceMemory";
import type { CaptureEntityType, CaptureRoute } from "@/features/product/lib/captureRouter";
import {
  EVENT_WORKSPACE_BUDGET_DECISIONS,
  EVENT_WORKSPACE_CLAIMS,
  EVENT_WORKSPACE_ENTITIES,
  EVENT_WORKSPACE_EVIDENCE,
  EVENT_WORKSPACE_FOLLOW_UPS,
} from "@/features/workspace/data/eventWorkspaceMemory";

export type EventWorkspaceMemorySnapshot = {
  entities: WorkspaceMemoryEntity[];
  evidence: WorkspaceMemoryEvidence[];
  claims: WorkspaceMemoryClaim[];
  followUps: WorkspaceMemoryFollowUp[];
  budgetDecisions: WorkspaceBudgetDecision[];
  captureCount: number;
  runCount: number;
  live: boolean;
};

type LiveSnapshot = {
  entities?: Array<{
    entityKey: string;
    uri: string;
    entityType: WorkspaceMemoryEntity["type"];
    name: string;
    layer: WorkspaceMemoryEntity["layer"];
    confidence: number;
  }>;
  evidence?: Array<{
    evidenceKey: string;
    sourceId?: number;
    sourceRefId?: string;
    layer: WorkspaceMemoryEvidence["layer"];
    title: string;
    visibility: WorkspaceMemoryEvidence["visibility"];
    reusable: boolean;
  }>;
  claims?: Array<{
    claimKey: string;
    subjectEntityKey: string;
    claim: string;
    status: WorkspaceMemoryClaim["status"];
    visibility: WorkspaceMemoryClaim["visibility"];
    evidenceKeys: string[];
    promotionGate: WorkspaceMemoryClaim["promotionGate"];
  }>;
  followUps?: Array<{
    followUpKey: string;
    owner: string;
    action: string;
    linkedEntityKeys: string[];
    due: WorkspaceMemoryFollowUp["due"];
    priority: WorkspaceMemoryFollowUp["priority"];
  }>;
  budgetDecisions?: WorkspaceBudgetDecision[];
  captures?: unknown[];
  runRecords?: unknown[];
};

export function mapLiveSnapshotToMemory(snapshot: LiveSnapshot | null | undefined): EventWorkspaceMemorySnapshot {
  if (!snapshot) {
    return emptyMemorySnapshot();
  }

  return {
    entities: (snapshot.entities ?? []).map((entity) => ({
      id: entity.entityKey,
      uri: entity.uri,
      type: entity.entityType,
      name: entity.name,
      layer: entity.layer,
      confidence: entity.confidence,
    })),
    evidence: (snapshot.evidence ?? []).map((item) => ({
      id: item.evidenceKey,
      sourceId: item.sourceId ?? Number(item.sourceRefId ?? 0),
      layer: item.layer,
      title: item.title,
      visibility: item.visibility,
      reusable: item.reusable,
    })),
    claims: (snapshot.claims ?? []).map((claim) => ({
      id: claim.claimKey,
      subjectId: claim.subjectEntityKey,
      claim: claim.claim,
      status: claim.status,
      visibility: claim.visibility,
      evidenceIds: claim.evidenceKeys,
      promotionGate: claim.promotionGate,
    })),
    followUps: (snapshot.followUps ?? []).map((followUp) => ({
      id: followUp.followUpKey,
      owner: followUp.owner,
      action: followUp.action,
      linkedEntityIds: followUp.linkedEntityKeys,
      due: followUp.due,
      priority: followUp.priority,
    })),
    budgetDecisions: snapshot.budgetDecisions ?? [],
    captureCount: snapshot.captures?.length ?? 0,
    runCount: snapshot.runRecords?.length ?? 0,
    live: true,
  };
}

export function emptyMemorySnapshot(): EventWorkspaceMemorySnapshot {
  return {
    entities: [],
    evidence: [],
    claims: [],
    followUps: [],
    budgetDecisions: [],
    captureCount: 0,
    runCount: 0,
    live: false,
  };
}

export function fixtureMemorySnapshot(): EventWorkspaceMemorySnapshot {
  return {
    entities: EVENT_WORKSPACE_ENTITIES,
    evidence: EVENT_WORKSPACE_EVIDENCE,
    claims: EVENT_WORKSPACE_CLAIMS,
    followUps: EVENT_WORKSPACE_FOLLOW_UPS,
    budgetDecisions: EVENT_WORKSPACE_BUDGET_DECISIONS,
    captureCount: 0,
    runCount: 0,
    live: false,
  };
}

export function buildFixtureSeedArgs(workspaceId: string) {
  const title = titleizeWorkspaceId(workspaceId);
  return {
    workspaceId,
    eventId: workspaceId,
    title,
    eventSessionId: `session.${workspaceId}`,
    source: "fixture_seed" as const,
    runId: `fixture-seed.${workspaceId}`,
    runStatus: "complete" as const,
    entities: EVENT_WORKSPACE_ENTITIES,
    evidence: EVENT_WORKSPACE_EVIDENCE,
    claims: EVENT_WORKSPACE_CLAIMS,
    followUps: EVENT_WORKSPACE_FOLLOW_UPS,
    budgetDecisions: EVENT_WORKSPACE_BUDGET_DECISIONS,
  };
}

export function buildLiveCaptureArgs(args: {
  workspaceId: string;
  input: string;
  now?: number;
  route?: CaptureRoute | null;
  kind?: "text" | "voice" | "image" | "screenshot" | "file";
}) {
  const now = args.now ?? Date.now();
  const captureId = `capture.${args.workspaceId}.${now}`;
  const eventSessionId = `session.${args.workspaceId}`;
  const rawText = args.input.trim();
  const title = titleizeWorkspaceId(args.workspaceId);
  const route = args.route ?? null;
  const eventEntityId = `event.${slugifyKey(args.workspaceId)}`;
  const evidenceId = `e.${slugifyKey(captureId)}`;
  const routeEntities = buildRouteEntities(route);
  const entities: WorkspaceMemoryEntity[] = [
    {
      id: eventEntityId,
      uri: `nodebench://event/${slugifyKey(args.workspaceId)}`,
      type: "event",
      name: title,
      layer: "event_corpus",
      confidence: 0.88,
    },
    ...routeEntities,
  ];
  const evidence: WorkspaceMemoryEvidence[] = [
    {
      id: evidenceId,
      sourceId: now,
      layer: "private_capture",
      title: captureEvidenceTitle(rawText),
      visibility: "private",
      reusable: true,
    },
  ];
  const subjectId =
    routeEntities.find((entity) => entity.type === "company")?.id ??
    routeEntities.find((entity) => entity.type === "person")?.id ??
    routeEntities.find((entity) => entity.type === "market")?.id ??
    eventEntityId;
  const claims = buildRouteClaims(route, subjectId, evidenceId);
  const followUps = buildRouteFollowUps(route, routeEntities);

  return {
    workspaceId: args.workspaceId,
    eventId: args.workspaceId,
    title,
    eventSessionId,
    runId: `run.${args.workspaceId}.${now}`,
    entities,
    evidence,
    claims,
    followUps,
    capture: {
      captureId,
      eventSessionId,
      kind: args.kind ?? ("text" as const),
      rawText,
      extractedEntityIds: entities.map((entity) => entity.id),
      extractedClaimIds: claims.map((claim) => claim.id),
      confidence: route?.confidence ?? (rawText.length > 0 ? 0.68 : 0),
      status: route?.needsConfirmation ? ("needs_confirmation" as const) : ("attached" as const),
      createdAt: now,
    },
    budgetDecisions: [EVENT_WORKSPACE_BUDGET_DECISIONS[0]],
  };
}

export function shouldPersistRouteToEventWorkspace(route: Pick<CaptureRoute, "target"> | null | undefined) {
  return route?.target === "active_event_session";
}

export function resolveEventWorkspaceIdFromContext(activeContextLabel?: string | null) {
  const normalized = activeContextLabel?.trim();
  if (!normalized || /workspace inbox/i.test(normalized)) return "ship-demo-day";
  return slugifyKey(normalized);
}

function titleizeWorkspaceId(workspaceId: string) {
  if (workspaceId === "ship-demo-day") return "Ship Demo Day";
  return workspaceId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Event Workspace";
}

function slugifyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "capture";
}

function mapCaptureEntityType(type: CaptureEntityType): WorkspaceEntityType {
  if (type === "product") return "market";
  if (type === "role") return "job";
  return type;
}

function entityUri(type: WorkspaceEntityType, slug: string) {
  if (type === "company") return `nodebench://org/${slug}`;
  if (type === "person") return `nodebench://person/${slug}`;
  if (type === "event") return `nodebench://event/${slug}`;
  if (type === "job") return `nodebench://job/${slug}`;
  if (type === "source") return `nodebench://source/${slug}`;
  if (type === "customer_segment") return `nodebench://segment/${slug}`;
  return `nodebench://${type}/${slug}`;
}

function buildRouteEntities(route: CaptureRoute | null): WorkspaceMemoryEntity[] {
  if (!route) return [];
  const seen = new Set<string>();
  return route.entities.flatMap((entity) => {
    const type = mapCaptureEntityType(entity.type);
    const slug = slugifyKey(entity.name);
    const id = `${type}.${slug}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      uri: entityUri(type, slug),
      type,
      name: entity.name,
      layer: "private_capture" as const,
      confidence: entity.confidence,
    }];
  });
}

function buildRouteClaims(
  route: CaptureRoute | null,
  subjectId: string,
  evidenceId: string,
): WorkspaceMemoryClaim[] {
  if (!route) return [];
  return route.claims.slice(0, 6).map((claim, index) => ({
    id: `claim.${slugifyKey(claim.text).slice(0, 64) || index}`,
    subjectId,
    claim: claim.text,
    status: claim.verificationStatus === "needs_verification" ? "needs_evidence" : "field_note",
    visibility: "private",
    evidenceIds: [evidenceId],
    promotionGate: claim.verificationStatus === "needs_verification" ? "needs_public_source" : "needs_human_review",
  }));
}

function buildRouteFollowUps(
  route: CaptureRoute | null,
  entities: WorkspaceMemoryEntity[],
): WorkspaceMemoryFollowUp[] {
  if (!route) return [];
  const linkedEntityIds = entities.slice(0, 3).map((entity) => entity.id);
  return route.followUps.slice(0, 6).map((followUp, index) => ({
    id: `fu.${slugifyKey(followUp.text).slice(0, 64) || index}`,
    owner: "HS",
    action: followUp.text,
    linkedEntityIds,
    due: followUp.priority === "high" ? "today" : "this_week",
    priority: followUp.priority,
  }));
}

function captureEvidenceTitle(rawText: string) {
  const preview = rawText.replace(/\s+/g, " ").trim().slice(0, 72);
  return preview ? `Private capture - ${preview}` : "Private event capture";
}
