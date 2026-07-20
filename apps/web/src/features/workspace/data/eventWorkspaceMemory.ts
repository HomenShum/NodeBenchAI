export type WorkspaceMemoryLayer =
  | "event_corpus"
  | "private_capture"
  | "team_memory"
  | "source_cache"
  | "workspace_memory";

export type WorkspaceEntityType =
  | "event"
  | "person"
  | "company"
  | "market"
  | "job"
  | "customer_segment"
  | "claim"
  | "source";

export type WorkspaceClaimStatus =
  | "field_note"
  | "needs_evidence"
  | "provisional"
  | "verified"
  | "stale"
  | "contradicted";

export type WorkspaceVisibility = "private" | "team" | "tenant" | "public";

export interface WorkspaceMemoryEntity {
  id: string;
  uri: string;
  type: WorkspaceEntityType;
  name: string;
  layer: WorkspaceMemoryLayer;
  confidence: number;
}

export interface WorkspaceMemoryEvidence {
  id: string;
  sourceId: number;
  layer: WorkspaceMemoryLayer;
  title: string;
  visibility: WorkspaceVisibility;
  reusable: boolean;
}

export interface WorkspaceMemoryClaim {
  id: string;
  subjectId: string;
  claim: string;
  status: WorkspaceClaimStatus;
  visibility: WorkspaceVisibility;
  evidenceIds: string[];
  promotionGate: "none" | "needs_public_source" | "needs_human_review" | "approval_required";
}

export interface WorkspaceMemoryFollowUp {
  id: string;
  owner: string;
  action: string;
  linkedEntityIds: string[];
  due: "today" | "this_week" | "later";
  priority: "low" | "medium" | "high";
}

export interface WorkspaceBudgetDecision {
  scenario: string;
  actorType: "event_guest" | "member" | "research_lead" | "agent";
  route: Array<"event_corpus" | "tenant_memory" | "source_cache" | "free_public_search" | "paid_search">;
  paidCallsUsed: number;
  requiresApproval: boolean;
  persistedLayer: WorkspaceMemoryLayer;
}

export const EVENT_WORKSPACE_ENTITIES: WorkspaceMemoryEntity[] = [
  {
    id: "event.ship-demo-day",
    uri: "nodebench://event/ship-demo-day",
    type: "event",
    name: "Ship Demo Day",
    layer: "event_corpus",
    confidence: 0.96,
  },
  {
    id: "company.orbital-labs",
    uri: "nodebench://org/orbital-labs",
    type: "company",
    name: "Orbital Labs",
    layer: "workspace_memory",
    confidence: 0.84,
  },
  {
    id: "person.alex-chen",
    uri: "nodebench://person/alex-chen",
    type: "person",
    name: "Alex Chen",
    layer: "private_capture",
    confidence: 0.72,
  },
  {
    id: "market.healthcare-ops",
    uri: "nodebench://market/healthcare-ops",
    type: "market",
    name: "Healthcare Ops",
    layer: "team_memory",
    confidence: 0.81,
  },
  {
    id: "job.acme-ai-staff-engineer",
    uri: "nodebench://job/acme-ai-staff-engineer",
    type: "job",
    name: "Acme AI Staff Engineer",
    layer: "private_capture",
    confidence: 0.79,
  },
  {
    id: "customer.clinic-operators",
    uri: "nodebench://segment/clinic-operators",
    type: "customer_segment",
    name: "Clinic Operators",
    layer: "private_capture",
    confidence: 0.86,
  },
];

export const EVENT_WORKSPACE_EVIDENCE: WorkspaceMemoryEvidence[] = [
  {
    id: "e.voice-memo-alex",
    sourceId: 1,
    layer: "private_capture",
    title: "Voice memo transcript - Alex at Orbital Labs",
    visibility: "private",
    reusable: true,
  },
  {
    id: "e.event-company-list",
    sourceId: 3,
    layer: "event_corpus",
    title: "Ship Demo Day public company list",
    visibility: "tenant",
    reusable: true,
  },
  {
    id: "e.orbital-site",
    sourceId: 4,
    layer: "source_cache",
    title: "Orbital Labs company site",
    visibility: "tenant",
    reusable: true,
  },
  {
    id: "e.recruiter-email",
    sourceId: 6,
    layer: "private_capture",
    title: "Recruiter email - Acme AI Staff Engineer",
    visibility: "private",
    reusable: false,
  },
  {
    id: "e.customer-transcripts",
    sourceId: 8,
    layer: "private_capture",
    title: "Customer discovery transcript batch",
    visibility: "private",
    reusable: true,
  },
];

export const EVENT_WORKSPACE_CLAIMS: WorkspaceMemoryClaim[] = [
  {
    id: "claim.orbital-builds-eval-infra",
    subjectId: "company.orbital-labs",
    claim: "Orbital Labs builds voice-agent evaluation infrastructure.",
    status: "provisional",
    visibility: "team",
    evidenceIds: ["e.voice-memo-alex", "e.orbital-site"],
    promotionGate: "needs_human_review",
  },
  {
    id: "claim.orbital-seed-stage",
    subjectId: "company.orbital-labs",
    claim: "Orbital Labs is seed-stage.",
    status: "field_note",
    visibility: "private",
    evidenceIds: ["e.voice-memo-alex"],
    promotionGate: "needs_public_source",
  },
  {
    id: "claim.healthcare-wedge",
    subjectId: "market.healthcare-ops",
    claim: "Healthcare operations is the clearest design-partner wedge.",
    status: "needs_evidence",
    visibility: "team",
    evidenceIds: ["e.voice-memo-alex", "e.customer-transcripts"],
    promotionGate: "needs_human_review",
  },
  {
    id: "claim.acme-role-fit",
    subjectId: "job.acme-ai-staff-engineer",
    claim: "The Acme AI role needs interview prep before reply.",
    status: "provisional",
    visibility: "private",
    evidenceIds: ["e.recruiter-email"],
    promotionGate: "none",
  },
];

export const EVENT_WORKSPACE_FOLLOW_UPS: WorkspaceMemoryFollowUp[] = [
  {
    id: "fu.verify-seed",
    owner: "HS",
    action: "Verify Orbital Labs seed-stage claim with a public source.",
    linkedEntityIds: ["company.orbital-labs"],
    due: "today",
    priority: "high",
  },
  {
    id: "fu.ask-alex",
    owner: "HS",
    action: "Ask Alex for pilot criteria and healthcare design-partner fit.",
    linkedEntityIds: ["person.alex-chen", "market.healthcare-ops"],
    due: "this_week",
    priority: "high",
  },
  {
    id: "fu.reply-recruiter",
    owner: "HS",
    action: "Draft a grounded recruiter reply from the Acme AI job card.",
    linkedEntityIds: ["job.acme-ai-staff-engineer"],
    due: "today",
    priority: "medium",
  },
];

export const EVENT_WORKSPACE_BUDGET_DECISIONS: WorkspaceBudgetDecision[] = [
  {
    scenario: "At-event capture",
    actorType: "event_guest",
    route: ["event_corpus", "source_cache"],
    paidCallsUsed: 0,
    requiresApproval: false,
    persistedLayer: "private_capture",
  },
  {
    scenario: "Internal member interview prep",
    actorType: "member",
    route: ["tenant_memory", "source_cache", "free_public_search"],
    paidCallsUsed: 0,
    requiresApproval: false,
    persistedLayer: "workspace_memory",
  },
  {
    scenario: "Investment-grade diligence",
    actorType: "research_lead",
    route: ["tenant_memory", "event_corpus", "source_cache", "free_public_search", "paid_search"],
    paidCallsUsed: 0,
    requiresApproval: true,
    persistedLayer: "team_memory",
  },
];
