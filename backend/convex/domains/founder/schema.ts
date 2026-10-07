/**
 * Founder Platform Schema — 26 tables
 *
 * Tables 1-18: Core platform (workspaces, companies, imported assets,
 * products, initiatives, agents, signals, decisions, interventions,
 * outcomes, context snapshots, timeline events, evidence, pending actions,
 * task packets, agent presence, command messages, approval queue).
 *
 * Tables 19-26: Phase 10 — Causal Memory & Trajectory Intelligence
 * (event ledger, path steps, state diffs, time rollups, packet versions,
 * memo versions, important changes, trajectory scores).
 *
 * Supports the multi-company founder cockpit with agent orchestration,
 * signal ingestion, decision tracking, intervention lifecycle,
 * remote agent command layer, and compounding causal memory.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// 1. Workspaces — top-level container per founder
// ---------------------------------------------------------------------------

export const founderWorkspaces = defineTable({
  name: v.string(),
  ownerUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_owner", ["ownerUserId"]);

// ---------------------------------------------------------------------------
// 2. Companies — entities the founder is building / advising
// ---------------------------------------------------------------------------

export const founderCompanies = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  name: v.string(),
  canonicalMission: v.string(),
  wedge: v.string(),
  companyState: v.union(
    v.literal("idea"),
    v.literal("forming"),
    v.literal("operating"),
    v.literal("pivoting"),
  ),
  foundingMode: v.union(
    v.literal("start_new"),
    v.literal("continue_existing"),
    v.literal("merged"),
  ),
  status: v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("archived"),
  ),
  identityConfidence: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_status", ["status", "updatedAt"]);

// ---------------------------------------------------------------------------
// 3. Imported Assets — repos, docs, notes pulled into workspace
// ---------------------------------------------------------------------------

export const founderImportedAssets = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  companyId: v.optional(v.id("founderCompanies")),
  sourceType: v.union(
    v.literal("repo"),
    v.literal("doc"),
    v.literal("note"),
    v.literal("agent_summary"),
    v.literal("folder"),
    v.literal("other"),
  ),
  sourceRef: v.string(),
  title: v.string(),
  classification: v.union(
    v.literal("company"),
    v.literal("product"),
    v.literal("initiative"),
    v.literal("archive"),
    v.literal("unknown"),
  ),
  confidence: v.number(),
  createdAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_company", ["companyId"]);

// ---------------------------------------------------------------------------
// 4. Products — things a company ships
// ---------------------------------------------------------------------------

export const founderProducts = defineTable({
  companyId: v.id("founderCompanies"),
  name: v.string(),
  description: v.string(),
  status: v.union(
    v.literal("concept"),
    v.literal("active"),
    v.literal("paused"),
    v.literal("archived"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_company", ["companyId"]);

// ---------------------------------------------------------------------------
// 5. Initiatives — workstreams / projects under a company
// ---------------------------------------------------------------------------

export const founderInitiatives = defineTable({
  companyId: v.id("founderCompanies"),
  productId: v.optional(v.id("founderProducts")),
  title: v.string(),
  objective: v.string(),
  ownerType: v.union(
    v.literal("founder"),
    v.literal("agent"),
    v.literal("shared"),
  ),
  status: v.union(
    v.literal("active"),
    v.literal("blocked"),
    v.literal("paused"),
    v.literal("completed"),
    v.literal("archived"),
  ),
  riskLevel: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  ),
  priorityScore: v.number(),
  latestSummary: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_company", ["companyId"])
  .index("by_status", ["status", "updatedAt"])
  .index("by_product", ["productId"]);

// ---------------------------------------------------------------------------
// 6. Agents — AI agents registered to a workspace
// ---------------------------------------------------------------------------

export const founderAgents = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  companyId: v.optional(v.id("founderCompanies")),
  name: v.string(),
  agentType: v.union(
    v.literal("claude_code"),
    v.literal("openclaw"),
    v.literal("nodebench_background"),
    v.literal("other"),
  ),
  runtimeSurface: v.union(
    v.literal("local"),
    v.literal("remote"),
    v.literal("hybrid"),
  ),
  mode: v.union(
    v.literal("passive"),
    v.literal("guided"),
    v.literal("bounded_proactive"),
  ),
  status: v.union(
    v.literal("healthy"),
    v.literal("blocked"),
    v.literal("waiting"),
    v.literal("drifting"),
    v.literal("ambiguous"),
  ),
  currentGoal: v.optional(v.string()),
  lastHeartbeatAt: v.optional(v.number()),
  lastSummary: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_company", ["companyId"])
  .index("by_status", ["status"]);

// ---------------------------------------------------------------------------
// 7. Signals — inbound information from various sources
// ---------------------------------------------------------------------------

export const founderSignals = defineTable({
  companyId: v.id("founderCompanies"),
  initiativeId: v.optional(v.id("founderInitiatives")),
  sourceType: v.union(
    v.literal("founder_note"),
    v.literal("agent_output"),
    v.literal("market"),
    v.literal("customer"),
    v.literal("product"),
    v.literal("execution"),
    v.literal("memo"),
    v.literal("other"),
  ),
  title: v.string(),
  content: v.string(),
  importanceScore: v.number(),
  sourceRef: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_company", ["companyId"])
  .index("by_initiative", ["initiativeId"])
  .index("by_importance", ["importanceScore"]);

// ---------------------------------------------------------------------------
// 8. Decisions — key choices made for a company
// ---------------------------------------------------------------------------

export const founderDecisions = defineTable({
  companyId: v.id("founderCompanies"),
  initiativeId: v.optional(v.id("founderInitiatives")),
  title: v.string(),
  rationale: v.string(),
  status: v.union(
    v.literal("proposed"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("deferred"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_company", ["companyId"])
  .index("by_status", ["status", "updatedAt"]);

// ---------------------------------------------------------------------------
// 9. Interventions — actions taken to change trajectory
// ---------------------------------------------------------------------------

export const founderInterventions = defineTable({
  companyId: v.id("founderCompanies"),
  initiativeId: v.optional(v.id("founderInitiatives")),
  decisionId: v.optional(v.id("founderDecisions")),
  title: v.string(),
  description: v.string(),
  priorityScore: v.number(),
  confidence: v.number(),
  expectedImpact: v.string(),
  status: v.union(
    v.literal("suggested"),
    v.literal("accepted"),
    v.literal("in_progress"),
    v.literal("done"),
    v.literal("deferred"),
    v.literal("rejected"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_company", ["companyId"])
  .index("by_initiative", ["initiativeId"])
  .index("by_status", ["status", "updatedAt"]);

// ---------------------------------------------------------------------------
// 10. Outcomes — measured results of interventions
// ---------------------------------------------------------------------------

export const founderOutcomes = defineTable({
  companyId: v.id("founderCompanies"),
  interventionId: v.id("founderInterventions"),
  initiativeId: v.optional(v.id("founderInitiatives")),
  summary: v.string(),
  resultType: v.union(
    v.literal("positive"),
    v.literal("neutral"),
    v.literal("negative"),
    v.literal("unknown"),
  ),
  measuredImpact: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_company", ["companyId"])
  .index("by_intervention", ["interventionId"]);

// ---------------------------------------------------------------------------
// 11. Context Snapshots — periodic summaries for a company
// ---------------------------------------------------------------------------

export const founderContextSnapshots = defineTable({
  companyId: v.id("founderCompanies"),
  snapshotType: v.union(
    v.literal("daily"),
    v.literal("weekly"),
    v.literal("event_triggered"),
  ),
  summary: v.string(),
  topPriorities: v.array(v.string()),
  topRisks: v.array(v.string()),
  openQuestions: v.array(v.string()),
  generatedByAgentId: v.optional(v.id("founderAgents")),
  createdAt: v.number(),
})
  .index("by_company", ["companyId"])
  .index("by_type", ["snapshotType", "createdAt"]);

// ---------------------------------------------------------------------------
// 12. Timeline Events — cross-entity activity log
// ---------------------------------------------------------------------------

export const founderTimelineEvents = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  companyId: v.optional(v.id("founderCompanies")),
  entityType: v.string(),
  entityId: v.string(),
  eventType: v.string(),
  summary: v.string(),
  evidenceRefs: v.array(v.string()),
  correlationId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_company", ["companyId"])
  .index("by_entity", ["entityType", "entityId"]);

// ---------------------------------------------------------------------------
// 13. Evidence — raw evidence artifacts
// ---------------------------------------------------------------------------

export const founderEvidence = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  sourceType: v.union(
    v.literal("note"),
    v.literal("agent_output"),
    v.literal("repo_summary"),
    v.literal("snapshot"),
    v.literal("external_signal"),
    v.literal("execution_bundle"),
  ),
  sourceRef: v.optional(v.string()),
  content: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
}).index("by_workspace", ["workspaceId"]);

// ---------------------------------------------------------------------------
// 14. Pending Actions — founder/agent action queue
// ---------------------------------------------------------------------------

export const founderPendingActions = defineTable({
  companyId: v.id("founderCompanies"),
  initiativeId: v.optional(v.id("founderInitiatives")),
  title: v.string(),
  description: v.string(),
  priorityScore: v.number(),
  ownerType: v.union(
    v.literal("founder"),
    v.literal("agent"),
  ),
  status: v.union(
    v.literal("open"),
    v.literal("in_progress"),
    v.literal("done"),
    v.literal("deferred"),
  ),
  dueAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_company", ["companyId"])
  .index("by_status", ["status", "updatedAt"]);

// ---------------------------------------------------------------------------
// 15. Task Packets — structured outbound commands to agents
// ---------------------------------------------------------------------------

export const founderTaskPackets = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  companyId: v.optional(v.id("founderCompanies")),
  initiativeId: v.optional(v.id("founderInitiatives")),
  targetAgentId: v.id("founderAgents"),
  taskType: v.union(
    v.literal("retrieve_items"),
    v.literal("setup_resource"),
    v.literal("run_analysis"),
    v.literal("execute_action"),
    v.literal("check_status"),
    v.literal("generate_artifact"),
    v.literal("custom"),
  ),
  title: v.string(),
  instructions: v.string(),
  requestedCapabilities: v.array(v.string()),
  permissionMode: v.union(
    v.literal("auto_allowed"),
    v.literal("ask_first"),
    v.literal("manual_only"),
  ),
  approvalStatus: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("not_required"),
  ),
  approvedBy: v.optional(v.string()),
  taskStatus: v.union(
    v.literal("queued"),
    v.literal("dispatched"),
    v.literal("running"),
    v.literal("waiting_approval"),
    v.literal("blocked"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  priority: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("critical"),
  ),
  returnFormat: v.union(
    v.literal("summary_only"),
    v.literal("summary_plus_evidence"),
    v.literal("full_artifacts"),
    v.literal("structured_data"),
  ),
  requestedBy: v.union(
    v.literal("founder"),
    v.literal("orchestrator"),
    v.literal("background_job"),
  ),
  result: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  evidenceIds: v.array(v.string()),
  dispatchedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_agent", ["targetAgentId", "taskStatus"])
  .index("by_status", ["taskStatus", "updatedAt"])
  .index("by_company", ["companyId", "taskStatus"]);

// ---------------------------------------------------------------------------
// 16. Agent Presence — real-time agent connection state
// ---------------------------------------------------------------------------

export const founderAgentPresence = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  agentId: v.id("founderAgents"),
  connectionId: v.string(),
  connectionType: v.union(
    v.literal("websocket"),
    v.literal("local_bridge"),
    v.literal("polling"),
  ),
  isConnected: v.boolean(),
  lastPingAt: v.number(),
  capabilities: v.array(v.string()),
  runtimeInfo: v.optional(
    v.object({
      platform: v.string(),
      version: v.optional(v.string()),
      environment: v.optional(v.string()),
    }),
  ),
  connectedAt: v.number(),
  disconnectedAt: v.optional(v.number()),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_agent", ["agentId"])
  .index("by_connected", ["isConnected", "lastPingAt"]);

// ---------------------------------------------------------------------------
// 17. Command Messages — conversational messages between founder and agents
// ---------------------------------------------------------------------------

export const founderCommandMessages = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  conversationId: v.string(),
  senderType: v.union(
    v.literal("founder"),
    v.literal("orchestrator"),
    v.literal("agent"),
  ),
  senderAgentId: v.optional(v.id("founderAgents")),
  messageType: v.union(
    v.literal("text"),
    v.literal("task_request"),
    v.literal("task_result"),
    v.literal("approval_request"),
    v.literal("approval_response"),
    v.literal("status_update"),
    v.literal("evidence"),
    v.literal("error"),
  ),
  content: v.string(),
  taskPacketId: v.optional(v.id("founderTaskPackets")),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_conversation", ["conversationId", "createdAt"])
  .index("by_workspace", ["workspaceId", "createdAt"]);

// ---------------------------------------------------------------------------
// 18. Approval Queue — pending approvals for task dispatch
// ---------------------------------------------------------------------------

export const founderApprovalQueue = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  taskPacketId: v.id("founderTaskPackets"),
  agentId: v.id("founderAgents"),
  title: v.string(),
  description: v.string(),
  requestedCapabilities: v.array(v.string()),
  riskLevel: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  ),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("expired"),
  ),
  reviewedAt: v.optional(v.number()),
  reviewerNote: v.optional(v.string()),
  expiresAt: v.number(),
  createdAt: v.number(),
})
  .index("by_workspace", ["workspaceId", "status"])
  .index("by_status", ["status", "createdAt"]);

// ---------------------------------------------------------------------------
// 19. Related Entities — products, partners, competitors, investors, etc.
// ---------------------------------------------------------------------------

export const founderRelatedEntities = defineTable({
  companyId: v.id("founderCompanies"),
  entityType: v.union(
    v.literal("product"),
    v.literal("partner"),
    v.literal("competitor"),
    v.literal("comparable"),
    v.literal("market_signal"),
    v.literal("design_partner"),
    v.literal("investor"),
  ),
  name: v.string(),
  relationship: v.string(),
  whyItMatters: v.string(),
  externalRef: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_company", ["companyId"]);

// ===========================================================================
// PHASE 10 — Causal Memory & Trajectory Intelligence (tables 20-27)
// ===========================================================================

// ---------------------------------------------------------------------------
// 19. Event Ledger — typed write-ahead log of every meaningful state change
// ---------------------------------------------------------------------------

export const founderEventLedger = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  companyId: v.optional(v.id("founderCompanies")),
  // Canonical typed event — replaces the generic string eventType in timeline
  eventType: v.union(
    // Entity lifecycle
    v.literal("company.created"),
    v.literal("company.updated"),
    v.literal("company.archived"),
    v.literal("initiative.created"),
    v.literal("initiative.status_changed"),
    v.literal("initiative.completed"),
    v.literal("initiative.blocked"),
    v.literal("agent.registered"),
    v.literal("agent.heartbeat_lost"),
    v.literal("agent.drift_detected"),
    v.literal("agent.goal_changed"),
    // Decision + intervention lifecycle
    v.literal("decision.proposed"),
    v.literal("decision.accepted"),
    v.literal("decision.rejected"),
    v.literal("intervention.suggested"),
    v.literal("intervention.started"),
    v.literal("intervention.completed"),
    v.literal("intervention.outcome_recorded"),
    // Artifact lifecycle
    v.literal("packet.generated"),
    v.literal("packet.exported"),
    v.literal("packet.handed_to_agent"),
    v.literal("memo.generated"),
    v.literal("memo.shared"),
    v.literal("memo.exported"),
    // Signal + evidence
    v.literal("signal.ingested"),
    v.literal("evidence.attached"),
    v.literal("contradiction.detected"),
    // State changes
    v.literal("state.snapshot_taken"),
    v.literal("state.diff_recorded"),
    v.literal("override.applied"),
    v.literal("important_change.detected"),
    // System
    v.literal("rollup.generated"),
    v.literal("path.session_started"),
    v.literal("path.session_ended"),
  ),
  // Actor who caused this event
  actorType: v.union(
    v.literal("founder"),
    v.literal("agent"),
    v.literal("system"),
    v.literal("background_job"),
  ),
  actorRef: v.optional(v.string()), // agent ID, user ID, or job name
  // Entity this event is about (polymorphic)
  entityType: v.union(
    v.literal("company"),
    v.literal("initiative"),
    v.literal("agent"),
    v.literal("decision"),
    v.literal("intervention"),
    v.literal("packet"),
    v.literal("memo"),
    v.literal("signal"),
    v.literal("evidence"),
    v.literal("workspace"),
  ),
  entityId: v.string(), // Convex ID as string for polymorphism
  // Event payload
  summary: v.string(),
  details: v.optional(v.any()), // structured payload varies by event type
  // Causality chain
  causedByEventId: v.optional(v.id("founderEventLedger")),
  correlationId: v.optional(v.string()), // groups related events
  // Temporal
  createdAt: v.number(),
})
  .index("by_workspace", ["workspaceId", "createdAt"])
  .index("by_company", ["companyId", "createdAt"])
  .index("by_entity", ["entityType", "entityId", "createdAt"])
  .index("by_event_type", ["eventType", "createdAt"])
  .index("by_caused_by", ["causedByEventId"]);

// ---------------------------------------------------------------------------
// 20. Path Steps — session-scoped exploration graph
// ---------------------------------------------------------------------------

export const founderPathSteps = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  sessionId: v.string(), // unique per session (browser tab, agent run, etc.)
  stepIndex: v.number(), // ordered position in path
  // What was visited
  surfaceType: v.union(
    v.literal("view"),
    v.literal("entity"),
    v.literal("artifact"),
    v.literal("agent_task"),
    v.literal("search"),
    v.literal("external"),
  ),
  surfaceRef: v.string(), // route path, entity ID, artifact ID, etc.
  surfaceLabel: v.string(), // human-readable label
  // Context at this step
  entityType: v.optional(v.string()),
  entityId: v.optional(v.string()),
  companyId: v.optional(v.id("founderCompanies")),
  // Timing
  enteredAt: v.number(),
  exitedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  // What was produced at this step (if anything)
  producedArtifactType: v.optional(v.string()),
  producedArtifactId: v.optional(v.string()),
  // Navigation metadata
  transitionFrom: v.optional(v.string()), // how user got here (click, search, voice, direct)
})
  .index("by_session", ["sessionId", "stepIndex"])
  .index("by_workspace", ["workspaceId", "enteredAt"])
  .index("by_entity", ["entityType", "entityId"]);

// ---------------------------------------------------------------------------
// 21. State Diffs — before/after snapshots for significant changes
// ---------------------------------------------------------------------------

export const founderStateDiffs = defineTable({
  workspaceId: v.id("founderWorkspaces"),
  companyId: v.optional(v.id("founderCompanies")),
  // What entity changed
  entityType: v.union(
    v.literal("company"),
    v.literal("initiative"),
    v.literal("agent"),
    v.literal("decision"),
    v.literal("intervention"),
    v.literal("packet"),
    v.literal("memo"),
    v.literal("signal"),
  ),
  entityId: v.string(),
  // What kind of change
  changeType: v.union(
    v.literal("identity"),     // mission, wedge, name
    v.literal("status"),       // status transitions
    v.literal("priority"),     // priority/confidence score changes
    v.literal("content"),      // description, summary, rationale
    v.literal("confidence"),   // confidence score changes
    v.literal("assignment"),   // owner, agent assignment
    v.literal("structural"),   // new sub-entities, removed entities
  ),
  // State capture
  beforeState: v.any(), // JSON snapshot of relevant fields before change
  afterState: v.any(),  // JSON snapshot of relevant fields after change
  changedFields: v.array(v.string()), // which fields actually changed
  // Context
  triggeringEventId: v.optional(v.id("founderEventLedger")),
  actorType: v.union(
    v.literal("founder"),
    v.literal("agent"),
    v.literal("system"),
    v.literal("background_job"),
  ),
  actorRef: v.optional(v.string()),
  reason: v.optional(v.string()), // why the change was made
  createdAt: v.number(),
})
  .index("by_entity", ["entityType", "entityId", "createdAt"])
  .index("by_company", ["companyId", "createdAt"])
  .index("by_change_type", ["changeType", "createdAt"]);

// ---------------------------------------------------------------------------
// 22. Time Rollups — periodic metric snapshots for comparison
// ---------------------------------------------------------------------------

export const founderTimeRollups = defineTable({
  companyId: v.id("founderCompanies"),
  periodType: v.union(
    v.literal("daily"),
    v.literal("weekly"),
    v.literal("monthly"),
    v.literal("quarterly"),
    v.literal("yearly"),
  ),
  periodKey: v.string(), // 2026-03-23, 2026-W12, 2026-03, 2026-Q1, 2026
  // Metric snapshots
  metrics: v.object({
    // Initiative health
    initiativeCount: v.number(),
    initiativesActive: v.number(),
    initiativesBlocked: v.number(),
    initiativesCompleted: v.number(),
    // Intervention activity
    interventionsSuggested: v.number(),
    interventionsStarted: v.number(),
    interventionsCompleted: v.number(),
    // Signal volume
    signalsIngested: v.number(),
    avgSignalImportance: v.number(),
    // Confidence trajectory
    identityConfidence: v.number(), // company identity confidence at period end
    avgInitiativePriority: v.number(),
    // Activity volume
    eventsRecorded: v.number(),
    pathStepsRecorded: v.number(),
    diffsRecorded: v.number(),
    packetsGenerated: v.number(),
    memosGenerated: v.number(),
    // Agent health
    agentsHealthy: v.number(),
    agentsDrifting: v.number(),
    // Important changes
    importantChangesDetected: v.number(),
    importantChangesResolved: v.number(),
  }),
  // Comparison with prior period
  deltas: v.optional(v.object({
    initiativeCountDelta: v.number(),
    interventionsCompletedDelta: v.number(),
    signalsIngestedDelta: v.number(),
    identityConfidenceDelta: v.number(),
    eventsRecordedDelta: v.number(),
  })),
  // Narrative summary (Phase 2: LLM-generated)
  narrative: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_company_period", ["companyId", "periodType", "periodKey"])
  .index("by_period_type", ["periodType", "createdAt"]);

// ---------------------------------------------------------------------------
// 23. Packet Versions — artifact packet version history
// ---------------------------------------------------------------------------

export const founderPacketVersions = defineTable({
  companyId: v.id("founderCompanies"),
  workspaceId: v.id("founderWorkspaces"),
  versionNumber: v.number(), // 1, 2, 3, ...
  parentVersionId: v.optional(v.id("founderPacketVersions")),
  // Content
  packetContent: v.any(), // full ArtifactPacket JSON
  contentHash: v.string(), // SHA-256 for dedup detection
  // What triggered this version
  triggerType: v.union(
    v.literal("manual"),           // founder clicked "regenerate"
    v.literal("scheduled"),        // daily/weekly auto-generation
    v.literal("change_triggered"), // important change detected
    v.literal("agent_delivered"),  // agent produced new context
  ),
  triggeringEventId: v.optional(v.id("founderEventLedger")),
  // Input provenance
  inputSources: v.object({
    evidenceCount: v.number(),
    signalCount: v.number(),
    snapshotId: v.optional(v.string()),
    initiativeIds: v.array(v.string()),
    interventionIds: v.array(v.string()),
  }),
  // Audience
  audience: v.union(
    v.literal("founder"),
    v.literal("investor"),
    v.literal("agent"),
    v.literal("peer"),
    v.literal("team"),
  ),
  // Diff from parent
  diffSummary: v.optional(v.string()), // human-readable diff
  changedSections: v.optional(v.array(v.string())), // which sections changed
  createdAt: v.number(),
})
  .index("by_company", ["companyId", "createdAt"])
  .index("by_packet_chain", ["companyId", "versionNumber"]);

// ---------------------------------------------------------------------------
// 24. Memo Versions — decision memo version history
// ---------------------------------------------------------------------------

export const founderMemoVersions = defineTable({
  companyId: v.id("founderCompanies"),
  workspaceId: v.id("founderWorkspaces"),
  versionNumber: v.number(),
  parentVersionId: v.optional(v.id("founderMemoVersions")),
  // Content
  memoTitle: v.string(),
  memoContent: v.any(), // full memo JSON or markdown
  contentHash: v.string(),
  // Export tracking
  exportFormat: v.union(
    v.literal("markdown"),
    v.literal("html"),
    v.literal("pdf"),
    v.literal("docx"),
    v.literal("json"),
    v.literal("agent_brief"),
    v.literal("shareable_url"),
  ),
  // Source packet
  sourcePacketVersionId: v.optional(v.id("founderPacketVersions")),
  // Share history
  sharedWith: v.optional(v.array(v.object({
    audience: v.string(),
    method: v.string(), // "url", "email", "export", "agent_handoff"
    sharedAt: v.number(),
  }))),
  // Diff from parent
  diffSummary: v.optional(v.string()),
  changedSections: v.optional(v.array(v.string())),
  createdAt: v.number(),
})
  .index("by_company", ["companyId", "createdAt"])
  .index("by_memo_chain", ["companyId", "versionNumber"]);

// ---------------------------------------------------------------------------
// 25. Important Changes — detected changes that deserve attention
// ---------------------------------------------------------------------------

export const founderImportantChanges = defineTable({
  companyId: v.id("founderCompanies"),
  workspaceId: v.id("founderWorkspaces"),
  // What changed
  changeCategory: v.union(
    v.literal("identity_drift"),         // mission/wedge mismatch
    v.literal("initiative_blocked"),     // initiative became blocked
    v.literal("confidence_drop"),        // significant confidence decrease
    v.literal("agent_anomaly"),          // agent drift, heartbeat loss
    v.literal("contradiction_new"),      // new contradiction detected
    v.literal("intervention_overdue"),   // intervention past expected completion
    v.literal("signal_spike"),           // unusual signal volume or importance
    v.literal("priority_shift"),         // initiative priorities reshuffled
    v.literal("outcome_negative"),       // intervention produced negative outcome
    v.literal("external_disruption"),    // market/customer signal requiring attention
  ),
  // Impact assessment
  impactScore: v.number(), // 0-1, higher = more important
  impactReason: v.string(), // why this matters
  // Affected entities
  affectedEntities: v.array(v.object({
    entityType: v.string(),
    entityId: v.string(),
    entityLabel: v.string(),
  })),
  // What should happen
  shouldTriggerPacket: v.boolean(),
  shouldTriggerBrief: v.boolean(),
  shouldTriggerAlert: v.boolean(),
  suggestedAction: v.optional(v.string()),
  // Resolution
  status: v.union(
    v.literal("detected"),
    v.literal("acknowledged"),
    v.literal("investigating"),
    v.literal("resolved"),
    v.literal("dismissed"),
  ),
  resolvedAt: v.optional(v.number()),
  resolutionNote: v.optional(v.string()),
  // Provenance
  detectedByEventId: v.optional(v.id("founderEventLedger")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_company", ["companyId", "createdAt"])
  .index("by_status", ["status", "updatedAt"])
  .index("by_impact", ["impactScore"]);

// ---------------------------------------------------------------------------
// 26. Trajectory Scores — daily compound scoring for trend analysis
// ---------------------------------------------------------------------------

export const founderTrajectoryScores = defineTable({
  companyId: v.id("founderCompanies"),
  date: v.string(), // YYYY-MM-DD
  // Composite scores (0-1)
  overallScore: v.number(),
  dimensions: v.object({
    identityClarity: v.number(),     // how clear is mission/wedge
    executionVelocity: v.number(),   // initiative completion rate
    agentAlignment: v.number(),      // agent health + goal alignment
    signalStrength: v.number(),      // signal volume * avg importance
    interventionEffectiveness: v.number(), // positive outcomes / total
    contradictionLoad: v.number(),   // inverse of active contradictions
    confidenceTrend: v.number(),     // direction of confidence over last 7 days
  }),
  // Slope change detection
  slopeVsPriorDay: v.optional(v.number()),
  slopeVsPriorWeek: v.optional(v.number()),
  slopeVsPriorMonth: v.optional(v.number()),
  // Source data
  snapshotMetrics: v.optional(v.any()), // raw metrics used to compute scores
  createdAt: v.number(),
})
  .index("by_company_date", ["companyId", "date"]);

// ===========================================================================
// PHASE 11 — Ambient Intelligence Layer (tables 27-30)
// ===========================================================================

// ---------------------------------------------------------------------------
// 27. Ambient Ingestion Queue — raw input from all sources
// ---------------------------------------------------------------------------

export const ambientIngestionQueue = defineTable({
  sourceType: v.union(
    v.literal("chat"),
    v.literal("agent_output"),
    v.literal("mcp_tool"),
    v.literal("file_change"),
    v.literal("web_signal"),
    v.literal("user_action"),
    v.literal("import"),
  ),
  sourceProvider: v.string(), // "claude_code" | "openclaw" | "supermemory" | etc.
  sourceRef: v.string(),      // session ID, file path, URL, etc.
  rawContent: v.string(),
  metadata: v.optional(v.any()),
  companyId: v.optional(v.id("founderCompanies")),
  workspaceId: v.optional(v.id("founderWorkspaces")),
  processedAt: v.optional(v.number()),
  processingStatus: v.union(
    v.literal("queued"),
    v.literal("processing"),
    v.literal("canonicalized"),
    v.literal("failed"),
  ),
  createdAt: v.number(),
})
  .index("by_status", ["processingStatus", "createdAt"])
  .index("by_source", ["sourceType", "sourceProvider", "createdAt"])
  .index("by_company", ["companyId", "createdAt"]);

// ---------------------------------------------------------------------------
// 28. Ambient Canonical Objects — structured business truth
// ---------------------------------------------------------------------------

export const ambientCanonicalObjects = defineTable({
  objectType: v.union(
    v.literal("thesis"),
    v.literal("decision"),
    v.literal("competitor_signal"),
    v.literal("build_item"),
    v.literal("open_question"),
    v.literal("contradiction"),
    v.literal("artifact_ref"),
    v.literal("initiative_update"),
    v.literal("market_signal"),
    v.literal("strategic_insight"),
    v.literal("risk"),
    v.literal("opportunity"),
  ),
  companyId: v.optional(v.id("founderCompanies")),
  workspaceId: v.optional(v.id("founderWorkspaces")),
  title: v.string(),
  content: v.string(),
  confidence: v.number(), // 0-1
  sourceIngestionIds: v.array(v.string()), // provenance chain
  supersedes: v.optional(v.id("ambientCanonicalObjects")),
  isLatest: v.boolean(),
  tags: v.array(v.string()),
  extractedAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_type", ["objectType", "isLatest", "updatedAt"])
  .index("by_company", ["companyId", "objectType", "isLatest"])
  .index("by_latest", ["isLatest", "updatedAt"]);

// ---------------------------------------------------------------------------
// 29. Ambient Change Detections — what changed and what matters
// ---------------------------------------------------------------------------

export const ambientChangeDetections = defineTable({
  detectionType: v.union(
    v.literal("new_object"),
    v.literal("updated_object"),
    v.literal("contradiction"),
    v.literal("priority_shift"),
    v.literal("confidence_change"),
    v.literal("superseded"),
    v.literal("pattern_detected"),
  ),
  objectId: v.id("ambientCanonicalObjects"),
  companyId: v.optional(v.id("founderCompanies")),
  priorState: v.optional(v.any()),
  currentState: v.any(),
  impactScore: v.number(), // 0-1
  impactReason: v.string(),
  requiresAttention: v.boolean(),
  resolvedAt: v.optional(v.number()),
  detectedAt: v.number(),
})
  .index("by_attention", ["requiresAttention", "impactScore"])
  .index("by_company", ["companyId", "detectedAt"])
  .index("by_object", ["objectId", "detectedAt"]);

// ---------------------------------------------------------------------------
// 30. Ambient Packet Readiness — when artifacts need regeneration
// ---------------------------------------------------------------------------

export const ambientPacketReadiness = defineTable({
  companyId: v.id("founderCompanies"),
  packetType: v.union(
    v.literal("weekly_reset"),
    v.literal("pre_delegation"),
    v.literal("investor_update"),
    v.literal("competitor_readout"),
    v.literal("agent_brief"),
  ),
  lastGeneratedAt: v.optional(v.number()),
  staleSince: v.optional(v.number()),
  changesSinceLastGeneration: v.number(),
  readinessScore: v.number(), // 0-1, higher = more stale, needs regen
  suggestedRegenerationReason: v.optional(v.string()),
  updatedAt: v.number(),
})
  .index("by_company_type", ["companyId", "packetType"])
  .index("by_readiness", ["readinessScore"]);

// ===========================================================================
// PHASE 13 — Dogfood Judge Fix System (tables 31-34)
// ===========================================================================

// ---------------------------------------------------------------------------
// 31. Dogfood Sessions — internal usage tracking
// ---------------------------------------------------------------------------

export const dogfoodSessions = defineTable({
  workspaceId: v.optional(v.id("founderWorkspaces")),
  loopType: v.union(
    v.literal("weekly_reset"),
    v.literal("pre_delegation"),
    v.literal("company_search"),
  ),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  transcript: v.optional(v.string()),
  packetVersionUsed: v.optional(v.string()),
  artifactsProduced: v.optional(v.array(v.string())),
  manualCorrections: v.optional(v.array(v.object({
    field: v.string(),
    before: v.string(),
    after: v.string(),
  }))),
  repeatedQuestions: v.optional(v.array(v.string())),
  timeToFirstUsefulOutput: v.optional(v.number()),
  delegationSucceeded: v.optional(v.boolean()),
  packetExported: v.optional(v.boolean()),
  overallNotes: v.optional(v.string()),
})
  .index("by_loop", ["loopType", "startedAt"])
  .index("by_date", ["startedAt"]);

// ---------------------------------------------------------------------------
// 32. Judge Runs — session quality scoring
// ---------------------------------------------------------------------------

export const dogfoodJudgeRuns = defineTable({
  sessionId: v.id("dogfoodSessions"),
  judgedAt: v.number(),
  truthQuality: v.number(),        // 1-5
  compressionQuality: v.number(),  // 1-5
  anticipationQuality: v.number(), // 1-5
  outputQuality: v.number(),       // 1-5
  delegationQuality: v.number(),   // 1-5
  trustQuality: v.number(),        // 1-5
  overallScore: v.number(),        // average
  notes: v.optional(v.string()),
  failureClasses: v.optional(v.array(v.string())),
})
  .index("by_session", ["sessionId"])
  .index("by_score", ["overallScore"]);

// ---------------------------------------------------------------------------
// 33. Failure Cases — classified failures with root cause
// ---------------------------------------------------------------------------

export const dogfoodFailureCases = defineTable({
  sessionId: v.id("dogfoodSessions"),
  judgeRunId: v.id("dogfoodJudgeRuns"),
  symptom: v.string(),
  rootCause: v.string(),
  systemLayer: v.union(
    v.literal("ingestion"),
    v.literal("canonicalization"),
    v.literal("change_detection"),
    v.literal("contradiction"),
    v.literal("suppression"),
    v.literal("packet_construction"),
    v.literal("artifact_rendering"),
    v.literal("trace_lineage"),
    v.literal("provider_bus"),
    v.literal("role_overlay"),
    v.literal("ux_explanation"),
  ),
  severity: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("critical"),
  ),
  frequency: v.number(),
  status: v.union(
    v.literal("open"),
    v.literal("investigating"),
    v.literal("fixed"),
    v.literal("wont_fix"),
  ),
  createdAt: v.number(),
})
  .index("by_session", ["sessionId"])
  .index("by_layer", ["systemLayer", "status"])
  .index("by_status", ["status", "createdAt"]);

// ---------------------------------------------------------------------------
// 34. Fix Attempts — fixes with replay proof + regression protection
// ---------------------------------------------------------------------------

export const dogfoodFixAttempts = defineTable({
  caseId: v.id("dogfoodFailureCases"),
  failureClass: v.string(),
  rootCause: v.string(),
  layerCorrected: v.string(),
  description: v.string(),
  replayProof: v.optional(v.object({
    priorScore: v.number(),
    newScore: v.number(),
    improved: v.boolean(),
  })),
  regressionProtection: v.optional(v.string()),
  status: v.union(
    v.literal("proposed"),
    v.literal("applied"),
    v.literal("verified"),
    v.literal("rejected"),
  ),
  createdAt: v.number(),
})
  .index("by_case", ["caseId"])
  .index("by_status", ["status"]);

// ===========================================================================
// Phase 14 — Shared Context Persistence (Vercel-durable delegation flow)
// ===========================================================================

// ---------------------------------------------------------------------------
// 35. Shared Context Peers — agents/surfaces participating in delegation
// ---------------------------------------------------------------------------

export const sharedContextPeers = defineTable({
  peerId: v.string(),
  product: v.union(v.literal("nodebench"), v.literal("ta_studio")),
  tenantId: v.optional(v.string()),
  workspaceId: v.optional(v.string()),
  surface: v.union(
    v.literal("web"),
    v.literal("browser"),
    v.literal("runner"),
    v.literal("evaluator"),
    v.literal("packet_engine"),
    v.literal("qa_runner"),
    v.literal("monitor"),
    v.literal("local_runtime"),
    v.literal("api"),
  ),
  role: v.union(
    v.literal("researcher"),
    v.literal("compiler"),
    v.literal("judge"),
    v.literal("explorer"),
    v.literal("replay"),
    v.literal("environment_builder"),
    v.literal("runner"),
    v.literal("observer"),
    v.literal("monitor"),
    v.literal("router"),
  ),
  capabilities: v.array(v.string()),
  contextScopes: v.array(v.string()),
  status: v.union(v.literal("active"), v.literal("idle"), v.literal("stale")),
  summary: v.object({
    currentTask: v.optional(v.string()),
    focusEntity: v.optional(v.string()),
    focusWorkflow: v.optional(v.string()),
    currentState: v.optional(v.string()),
    confidence: v.optional(v.number()),
    lastUpdate: v.optional(v.string()),
    availableArtifacts: v.optional(v.array(v.string())),
    permissionScope: v.optional(v.array(v.string())),
  }),
  lastHeartbeatAt: v.number(),
  createdAt: v.number(),
})
  .index("by_peerId", ["peerId"])
  .index("by_tenant", ["tenantId", "status"])
  .index("by_workspace", ["workspaceId", "status"])
  .index("by_role", ["role", "status"]);

// ---------------------------------------------------------------------------
// 36. Shared Context Packets — durable context exchange units
// ---------------------------------------------------------------------------

export const sharedContextPackets = defineTable({
  contextId: v.string(),
  contextType: v.union(
    v.literal("entity_packet"),
    v.literal("workflow_packet"),
    v.literal("trace_packet"),
    v.literal("judge_packet"),
    v.literal("environment_packet"),
    v.literal("failure_packet"),
    v.literal("state_snapshot_packet"),
    v.literal("verdict_packet"),
    v.literal("scenario_packet"),
    v.literal("change_packet"),
  ),
  producerPeerId: v.string(),
  tenantId: v.optional(v.string()),
  workspaceId: v.optional(v.string()),
  scope: v.array(v.string()),
  subject: v.string(),
  summary: v.string(),
  claims: v.array(v.string()),
  evidenceRefs: v.array(v.string()),
  confidence: v.optional(v.number()),
  lineage: v.optional(v.object({
    parentContextIds: v.optional(v.array(v.string())),
    sourceRunId: v.optional(v.string()),
    sourceTraceId: v.optional(v.string()),
    supersedes: v.optional(v.string()),
  })),
  version: v.number(),
  invalidates: v.optional(v.array(v.string())),
  freshness: v.optional(v.object({
    status: v.optional(v.union(v.literal("fresh"), v.literal("warming"), v.literal("stale"))),
    expiresAt: v.optional(v.string()),
    trustTier: v.optional(v.union(v.literal("internal"), v.literal("verified"), v.literal("directional"))),
  })),
  visibility: v.optional(v.union(v.literal("internal"), v.literal("workspace"), v.literal("tenant"))),
  status: v.union(v.literal("active"), v.literal("superseded"), v.literal("invalidated")),
  createdAt: v.number(),
})
  .index("by_contextId", ["contextId"])
  .index("by_tenant_workspace", ["tenantId", "workspaceId", "status"])
  .index("by_producer", ["producerPeerId", "status"])
  .index("by_type", ["contextType", "status"]);

// ---------------------------------------------------------------------------
// 37. Shared Context Tasks — delegation handoffs between peers
// ---------------------------------------------------------------------------

export const sharedContextTasks = defineTable({
  taskId: v.string(),
  taskType: v.string(),
  proposerPeerId: v.string(),
  assigneePeerId: v.string(),
  tenantId: v.optional(v.string()),
  workspaceId: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.union(
    v.literal("proposed"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("completed"),
    v.literal("escalated"),
  ),
  taskSpec: v.optional(v.any()),
  inputContextIds: v.array(v.string()),
  outputContextId: v.optional(v.string()),
  reason: v.optional(v.string()),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_taskId", ["taskId"])
  .index("by_tenant", ["tenantId", "status"])
  .index("by_assignee", ["assigneePeerId", "status"])
  .index("by_proposer", ["proposerPeerId", "status"]);

// ---------------------------------------------------------------------------
// 38. Shared Context Messages — peer-to-peer messaging
// ---------------------------------------------------------------------------

export const sharedContextMessages = defineTable({
  fromPeerId: v.string(),
  toPeerId: v.string(),
  tenantId: v.optional(v.string()),
  messageType: v.union(
    v.literal("request"),
    v.literal("response"),
    v.literal("context_offer"),
    v.literal("context_pull"),
    v.literal("task_handoff"),
    v.literal("status_update"),
    v.literal("verdict"),
    v.literal("escalation"),
    v.literal("invalidation"),
  ),
  content: v.string(),
  acknowledged: v.boolean(),
  createdAt: v.number(),
})
  .index("by_to", ["toPeerId", "acknowledged"])
  .index("by_from", ["fromPeerId", "createdAt"])
  .index("by_tenant", ["tenantId", "createdAt"]);

// ---------------------------------------------------------------------------
// 39. Founder Harness Episodes — public founder-intelligence interaction log
// ---------------------------------------------------------------------------

export const founderHarnessEpisodes = defineTable({
  episodeId: v.string(),
  correlationId: v.string(),
  sessionKey: v.optional(v.string()),
  workspaceId: v.optional(v.string()),
  companyKey: v.optional(v.string()),
  surface: v.union(
    v.literal("web"),
    v.literal("api"),
    v.literal("browser"),
    v.literal("claude_code"),
    v.literal("openclaw"),
    v.literal("local_runtime"),
  ),
  episodeType: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("completed"),
    v.literal("error"),
    v.literal("aborted"),
  ),
  query: v.optional(v.string()),
  lens: v.optional(v.string()),
  entityName: v.optional(v.string()),
  packetId: v.optional(v.string()),
  packetType: v.optional(v.string()),
  contextId: v.optional(v.string()),
  taskId: v.optional(v.string()),
  summary: v.optional(v.string()),
  stateBefore: v.optional(v.any()),
  stateAfter: v.optional(v.any()),
  stateBeforeHash: v.optional(v.string()),
  stateAfterHash: v.optional(v.string()),
  spans: v.array(v.any()),
  traceStepCount: v.optional(v.number()),
  toolsInvoked: v.array(v.string()),
  artifactsProduced: v.array(v.string()),
  importantChangesDetected: v.optional(v.number()),
  contradictionsDetected: v.optional(v.number()),
  metadata: v.optional(v.any()),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_episodeId", ["episodeId"])
  .index("by_session", ["sessionKey", "startedAt"])
  .index("by_workspace_started", ["workspaceId", "startedAt"])
  .index("by_correlation", ["correlationId"])
  .index("by_status_started", ["status", "startedAt"]);
