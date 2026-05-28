export const OUTPUT_REGISTRY = {
  public_knowledge: {
    event_wiki: [
      "wiki.need_to_know_item",
      "wiki.what_changed_item",
      "wiki.followup_item",
      "wiki.people_item",
      "wiki.company_item",
      "wiki.source_item",
      "wiki.trace_summary",
    ],
    event_faq: [
      "faq.canonical_question",
      "faq.answer_candidate",
      "faq.host_promoted_answer",
      "faq.cached_reuse_answer",
      "faq.delta_refreshed_answer",
    ],
    public_agent_answer: [
      "answer.public_event_card",
      "answer.cached_event_answer",
      "answer.delta_refreshed_answer",
    ],
  },
  private_memory: {
    private_note: [
      "note.raw_shorthand",
      "note.agent_enhanced",
      "note.voice_transcript",
      "note.anchored_to_chat",
      "note.followup_task",
    ],
    private_notebook_patch: [
      "notebook.append_block",
      "notebook.update_block",
      "notebook.followup_task",
    ],
  },
  retrieval_context: {
    index_search: [
      "retrieval.typesense_hit",
      "retrieval.convex_exact",
      "retrieval.redis_semantic_cache_hit",
      "retrieval.linkup_result",
      "retrieval.source_bundle",
      "retrieval.context_packet",
    ],
  },
  graph_memory: {
    lightrag_memory: [
      "memory.entity",
      "memory.atomic_claim",
      "memory.semantic_edge",
      "memory.citation",
      "memory.compacted_summary",
      "memory.famous_branch",
      "memory.versioned_snapshot",
    ],
  },
  agent_trace: {
    output_node: [
      "trace.output.public_answer",
      "trace.output.private_note_patch",
      "trace.output.wiki_update",
      "trace.output.artifact_created",
    ],
    phase: [
      "trace.phase.context_resolved",
      "trace.phase.cache_lookup",
      "trace.phase.context_retrieval",
      "trace.phase.verification",
      "trace.phase.persistence",
    ],
    tool_call: [
      "trace.tool.semantic_cache_lookup",
      "trace.tool.retrieve_context",
      "trace.tool.linkup_search",
      "trace.tool.save_private_note_patch",
    ],
  },
  generated_artifact: {
    presentation: ["artifact.presentation_html"],
    source_bundle: ["artifact.source_bundle"],
    export: ["artifact.csv_export", "artifact.crm_export"],
    event_archive: ["artifact.published_event_wiki"],
  },
  operational_cache: {
    semantic_answer_cache: [
      "cache.public_faq_answer",
      "cache.private_answer_forbidden",
      "cache.stale_public_answer",
      "cache.delta_refresh_required",
    ],
  },
  ui_renderable: {
    ui_card: [
      "ui.agent_answer_card",
      "ui.trace_drawer",
      "ui.private_note_marker",
      "ui.mention_chip",
    ],
  },
} as const;

export type OutputL1 = keyof typeof OUTPUT_REGISTRY;

export type OutputL2<L1 extends OutputL1 = OutputL1> = {
  [K in OutputL1]: keyof (typeof OUTPUT_REGISTRY)[K];
}[L1] &
  string;

export type OutputL3 = {
  [K in OutputL1]: {
    [L in keyof (typeof OUTPUT_REGISTRY)[K]]: (typeof OUTPUT_REGISTRY)[K][L][number];
  }[keyof (typeof OUTPUT_REGISTRY)[K]];
}[OutputL1];

export type OutputVisibility = "event_public" | "private" | "workspace" | "host_draft";

export type AgentOutputTarget = {
  eventId?: string;
  notebookId?: string;
  artifactId?: string;
  entityId?: string;
  messageId?: string;
  traceId?: string;
};

export type AgentOutputEnvelope = {
  id: string;
  l1: OutputL1;
  l2: string;
  l3: string;
  target: AgentOutputTarget;
  visibility: OutputVisibility;
  sourceRefs: string[];
  citationRefs: string[];
  traceRef: string;
  producedBy: {
    runId: string;
    skill: string;
    model?: string;
    toolChain: string[];
  };
  version: {
    wikiVersion?: number;
    sourceBundleVersion?: number;
    memorySnapshotVersion?: number;
  };
  output: Record<string, unknown>;
};

export type AgentOutputPolicy = {
  l1: OutputL1;
  l2: string;
  l3: OutputL3;
  storage: "convex" | "redis" | "typesense" | "artifact_lake" | "ui_only";
  renderer: string;
  evaluator: string;
  allowedVisibility: OutputVisibility[];
};

export type EvalIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type EvalResult = {
  passed: boolean;
  issues: EvalIssue[];
  policy?: AgentOutputPolicy;
};

const VISIBILITIES: OutputVisibility[] = ["event_public", "private", "workspace", "host_draft"];

export const AGENT_OUTPUT_POLICIES: AgentOutputPolicy[] = [
  policy("public_knowledge", "event_wiki", "wiki.need_to_know_item", "convex", "WikiSectionItem", "wiki_validator", ["event_public", "host_draft"]),
  policy("public_knowledge", "event_wiki", "wiki.what_changed_item", "convex", "WikiSectionItem", "wiki_validator", ["event_public", "host_draft"]),
  policy("public_knowledge", "event_wiki", "wiki.followup_item", "convex", "WikiSectionItem", "wiki_validator", ["event_public", "host_draft"]),
  policy("public_knowledge", "event_wiki", "wiki.people_item", "convex", "WikiSectionItem", "wiki_validator", ["event_public", "host_draft"]),
  policy("public_knowledge", "event_wiki", "wiki.company_item", "convex", "WikiSectionItem", "wiki_validator", ["event_public", "host_draft"]),
  policy("public_knowledge", "event_wiki", "wiki.source_item", "convex", "WikiSectionItem", "wiki_validator", ["event_public", "host_draft"]),
  policy("public_knowledge", "event_wiki", "wiki.trace_summary", "convex", "WikiSectionItem", "wiki_validator", ["event_public", "host_draft"]),
  policy("public_knowledge", "event_faq", "faq.answer_candidate", "convex", "AgentAnswerCard", "faq_validator", ["event_public"]),
  policy("public_knowledge", "event_faq", "faq.host_promoted_answer", "convex", "AgentAnswerCard", "faq_validator", ["event_public"]),
  policy("public_knowledge", "event_faq", "faq.cached_reuse_answer", "convex", "AgentAnswerCard", "faq_validator", ["event_public"]),
  policy("public_knowledge", "event_faq", "faq.delta_refreshed_answer", "convex", "AgentAnswerCard", "faq_validator", ["event_public"]),
  policy("public_knowledge", "public_agent_answer", "answer.public_event_card", "convex", "AgentAnswerCard", "answer_validator", ["event_public"]),
  policy("public_knowledge", "public_agent_answer", "answer.cached_event_answer", "convex", "AgentAnswerCard", "answer_validator", ["event_public"]),
  policy("public_knowledge", "public_agent_answer", "answer.delta_refreshed_answer", "convex", "AgentAnswerCard", "answer_validator", ["event_public"]),
  policy("private_memory", "private_note", "note.raw_shorthand", "convex", "PrivateNoteSheet", "note_validator", ["private"]),
  policy("private_memory", "private_note", "note.agent_enhanced", "convex", "PrivateNoteSheet", "note_validator", ["private"]),
  policy("private_memory", "private_note", "note.voice_transcript", "convex", "PrivateNoteSheet", "note_validator", ["private"]),
  policy("private_memory", "private_note", "note.anchored_to_chat", "convex", "PrivateNoteMarker", "note_validator", ["private"]),
  policy("private_memory", "private_note", "note.followup_task", "convex", "PrivateNoteSheet", "note_validator", ["private"]),
  policy("private_memory", "private_notebook_patch", "notebook.append_block", "convex", "NotebookPatchCard", "notebook_patch_validator", ["private", "workspace"]),
  policy("private_memory", "private_notebook_patch", "notebook.update_block", "convex", "NotebookPatchCard", "notebook_patch_validator", ["private", "workspace"]),
  policy("private_memory", "private_notebook_patch", "notebook.followup_task", "convex", "NotebookPatchCard", "notebook_patch_validator", ["private", "workspace"]),
  policy("retrieval_context", "index_search", "retrieval.typesense_hit", "typesense", "RetrievalHit", "retrieval_evaluator", ["event_public", "private", "workspace"]),
  policy("retrieval_context", "index_search", "retrieval.convex_exact", "convex", "RetrievalHit", "retrieval_evaluator", ["event_public", "private", "workspace"]),
  policy("retrieval_context", "index_search", "retrieval.redis_semantic_cache_hit", "redis", "RetrievalHit", "retrieval_evaluator", ["event_public", "private", "workspace"]),
  policy("retrieval_context", "index_search", "retrieval.linkup_result", "convex", "RetrievalHit", "retrieval_evaluator", ["event_public", "private", "workspace"]),
  policy("retrieval_context", "index_search", "retrieval.source_bundle", "convex", "RetrievalHit", "retrieval_evaluator", ["event_public", "private", "workspace"]),
  policy("retrieval_context", "index_search", "retrieval.context_packet", "convex", "ContextPacket", "context_resolver_evaluator", ["event_public", "private", "workspace"]),
  policy("graph_memory", "lightrag_memory", "memory.entity", "convex", "GraphNode", "graph_integrity_validator", ["event_public", "private", "workspace"]),
  policy("graph_memory", "lightrag_memory", "memory.atomic_claim", "convex", "ClaimCard", "memory_compaction_evaluator", ["event_public", "private", "workspace"]),
  policy("graph_memory", "lightrag_memory", "memory.semantic_edge", "convex", "GraphEdge", "graph_integrity_validator", ["event_public", "private", "workspace"]),
  policy("graph_memory", "lightrag_memory", "memory.citation", "convex", "CitationChip", "graph_integrity_validator", ["event_public", "private", "workspace"]),
  policy("graph_memory", "lightrag_memory", "memory.compacted_summary", "convex", "MemorySummary", "memory_compaction_evaluator", ["event_public", "private", "workspace"]),
  policy("graph_memory", "lightrag_memory", "memory.famous_branch", "convex", "FamousBranch", "memory_compaction_evaluator", ["event_public", "private", "workspace"]),
  policy("graph_memory", "lightrag_memory", "memory.versioned_snapshot", "convex", "MemorySnapshot", "memory_compaction_evaluator", ["event_public", "private", "workspace"]),
  policy("agent_trace", "output_node", "trace.output.public_answer", "convex", "TraceNode", "trace_evaluator", ["event_public"]),
  policy("agent_trace", "output_node", "trace.output.private_note_patch", "convex", "TraceNode", "trace_evaluator", ["private", "workspace"]),
  policy("agent_trace", "output_node", "trace.output.wiki_update", "convex", "TraceNode", "trace_evaluator", ["event_public", "host_draft"]),
  policy("agent_trace", "output_node", "trace.output.artifact_created", "convex", "TraceNode", "trace_evaluator", ["event_public", "workspace"]),
  policy("agent_trace", "phase", "trace.phase.context_resolved", "convex", "TracePhase", "trace_evaluator", ["event_public", "private", "workspace", "host_draft"]),
  policy("agent_trace", "phase", "trace.phase.cache_lookup", "convex", "TracePhase", "trace_evaluator", ["event_public", "private", "workspace", "host_draft"]),
  policy("agent_trace", "phase", "trace.phase.context_retrieval", "convex", "TracePhase", "trace_evaluator", ["event_public", "private", "workspace", "host_draft"]),
  policy("agent_trace", "phase", "trace.phase.verification", "convex", "TracePhase", "trace_evaluator", ["event_public", "private", "workspace", "host_draft"]),
  policy("agent_trace", "phase", "trace.phase.persistence", "convex", "TracePhase", "trace_evaluator", ["event_public", "private", "workspace", "host_draft"]),
  policy("agent_trace", "tool_call", "trace.tool.semantic_cache_lookup", "convex", "TraceToolCall", "tool_call_evaluator", ["event_public", "private", "workspace"]),
  policy("agent_trace", "tool_call", "trace.tool.retrieve_context", "convex", "TraceToolCall", "tool_call_evaluator", ["event_public", "private", "workspace"]),
  policy("agent_trace", "tool_call", "trace.tool.linkup_search", "convex", "TraceToolCall", "tool_call_evaluator", ["event_public", "private", "workspace"]),
  policy("agent_trace", "tool_call", "trace.tool.save_private_note_patch", "convex", "TraceToolCall", "tool_call_evaluator", ["private", "workspace"]),
  policy("generated_artifact", "presentation", "artifact.presentation_html", "artifact_lake", "PresentationArtifact", "artifact_validator", ["event_public", "workspace"]),
  policy("generated_artifact", "source_bundle", "artifact.source_bundle", "artifact_lake", "SourceBundleArtifact", "artifact_validator", ["event_public", "workspace"]),
  policy("generated_artifact", "export", "artifact.csv_export", "artifact_lake", "ExportArtifact", "artifact_validator", ["private", "workspace"]),
  policy("generated_artifact", "export", "artifact.crm_export", "artifact_lake", "ExportArtifact", "artifact_validator", ["private", "workspace"]),
  policy("generated_artifact", "event_archive", "artifact.published_event_wiki", "artifact_lake", "EventArchiveArtifact", "artifact_validator", ["event_public"]),
  policy("operational_cache", "semantic_answer_cache", "cache.public_faq_answer", "redis", "CacheTraceRow", "cache_safety_evaluator", ["event_public"]),
  policy("operational_cache", "semantic_answer_cache", "cache.private_answer_forbidden", "redis", "CacheTraceRow", "cache_safety_evaluator", ["private"]),
  policy("operational_cache", "semantic_answer_cache", "cache.stale_public_answer", "redis", "CacheTraceRow", "cache_safety_evaluator", ["event_public"]),
  policy("operational_cache", "semantic_answer_cache", "cache.delta_refresh_required", "redis", "CacheTraceRow", "cache_safety_evaluator", ["event_public"]),
  policy("ui_renderable", "ui_card", "ui.agent_answer_card", "ui_only", "AgentAnswerCard", "ui_snapshot_evaluator", ["event_public"]),
  policy("ui_renderable", "ui_card", "ui.trace_drawer", "ui_only", "TraceDrawer", "ui_snapshot_evaluator", ["event_public", "private", "workspace"]),
  policy("ui_renderable", "ui_card", "ui.private_note_marker", "ui_only", "PrivateNoteMarker", "ui_snapshot_evaluator", ["private"]),
  policy("ui_renderable", "ui_card", "ui.mention_chip", "ui_only", "MentionChip", "ui_snapshot_evaluator", ["event_public", "private", "workspace"]),
];

const POLICY_BY_L3 = new Map<string, AgentOutputPolicy>(
  AGENT_OUTPUT_POLICIES.map((entry) => [entry.l3, entry]),
);

function policy(
  l1: OutputL1,
  l2: string,
  l3: OutputL3,
  storage: AgentOutputPolicy["storage"],
  renderer: string,
  evaluator: string,
  allowedVisibility: OutputVisibility[],
): AgentOutputPolicy {
  return { l1, l2, l3, storage, renderer, evaluator, allowedVisibility };
}

export function isValidTaxonomy(l1: string, l2: string, l3: string): boolean {
  const l2Registry = OUTPUT_REGISTRY[l1 as OutputL1] as Record<string, readonly string[]> | undefined;
  return !!l2Registry?.[l2]?.includes(l3);
}

export function getOutputPolicy(l3: string): AgentOutputPolicy | undefined {
  return POLICY_BY_L3.get(l3);
}

export function evaluateAgentOutput(envelope: AgentOutputEnvelope): EvalResult {
  const issues: EvalIssue[] = [];
  const addError = (code: string, message: string) => issues.push({ code, message, severity: "error" });

  if (!envelope.id) addError("EVAL-SCHEMA-000", "Envelope id is required.");
  if (!isValidTaxonomy(envelope.l1, envelope.l2, envelope.l3)) {
    addError("EVAL-SCHEMA-001", "l1/l2/l3 must be present and match the output registry.");
  }
  if (!VISIBILITIES.includes(envelope.visibility)) {
    addError("EVAL-POLICY-000", "visibility must be one of the supported output visibilities.");
  }
  if (!hasTarget(envelope.target)) addError("EVAL-SCHEMA-006", "At least one target id is required.");
  if (!envelope.traceRef) addError("EVAL-TRACE-001", "traceRef is required.");
  if (!envelope.producedBy?.runId) addError("EVAL-TRACE-002", "producedBy.runId is required.");
  if (!envelope.producedBy?.skill) addError("EVAL-TRACE-003", "producedBy.skill is required.");
  if (!Array.isArray(envelope.producedBy?.toolChain)) addError("EVAL-TRACE-004", "producedBy.toolChain must be an array.");
  if (!Array.isArray(envelope.sourceRefs)) addError("EVAL-CITE-000", "sourceRefs must be an array.");
  if (!Array.isArray(envelope.citationRefs)) addError("EVAL-CITE-001", "citationRefs must be an array.");

  const policyEntry = getOutputPolicy(envelope.l3);
  if (!policyEntry) {
    addError("EVAL-SCHEMA-005", "l3 must have a storage, renderer, and evaluator policy.");
  } else {
    if (policyEntry.l1 !== envelope.l1 || policyEntry.l2 !== envelope.l2) {
      addError("EVAL-SCHEMA-003", "l3 belongs to a different l1/l2 pair than the envelope declares.");
    }
    if (!policyEntry.allowedVisibility.includes(envelope.visibility)) {
      addError("EVAL-POLICY-006", `${envelope.l3} cannot be stored with visibility=${envelope.visibility}.`);
    }
    if (!policyEntry.renderer) addError("EVAL-UI-001", "l3 must map to a renderer.");
    if (!policyEntry.evaluator) addError("EVAL-SCHEMA-007", "l3 must map to an evaluator.");
  }

  validatePublicPrivateBoundary(envelope, addError);
  validateSpecificContract(envelope, addError);

  return {
    passed: issues.every((issue) => issue.severity !== "error"),
    issues,
    policy: policyEntry,
  };
}

export function assertValidAgentOutput(envelope: AgentOutputEnvelope): AgentOutputEnvelope {
  const result = evaluateAgentOutput(envelope);
  if (!result.passed) {
    const details = result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
    throw new Error(`Invalid agent output envelope: ${details}`);
  }
  return envelope;
}

function hasTarget(target: AgentOutputTarget | undefined): boolean {
  return !!target && Object.values(target).some((value) => typeof value === "string" && value.length > 0);
}

function validatePublicPrivateBoundary(
  envelope: AgentOutputEnvelope,
  addError: (code: string, message: string) => void,
) {
  const hasPrivateRef = [...(envelope.sourceRefs ?? []), ...(envelope.citationRefs ?? [])].some(isPrivateRef);
  const serializedOutput = JSON.stringify(envelope.output ?? {});
  const outputMentionsPrivateNote =
    /"(?:privateNoteIds?|private_source_refs?|privateNotesUsed)"\s*:\s*true/i.test(serializedOutput);

  if (envelope.visibility === "event_public") {
    if (hasPrivateRef || outputMentionsPrivateNote) {
      addError("EVAL-POLICY-001", "event_public output cannot reference private notes or private sources.");
    }
  }

  if (envelope.l1 === "private_memory" && envelope.visibility !== "private") {
    addError("NOTE-001", "private_memory outputs must use visibility=private.");
  }
}

function validateSpecificContract(
  envelope: AgentOutputEnvelope,
  addError: (code: string, message: string) => void,
) {
  if (envelope.l2 === "event_faq" || envelope.l2 === "public_agent_answer") {
    const out = envelope.output;
    if (!stringField(out, "parentAskMessageId")) addError("FAQ-001", "Public answer output requires parentAskMessageId.");
    if (readPath(out, ["reuseSummary", "privateNotesUsed"]) !== false) {
      addError("FAQ-003", "Public answer reuseSummary.privateNotesUsed must be false.");
    }
    if ((envelope.sourceRefs ?? []).length === 0 && readPath(out, ["answerMode"]) !== "room_signal_only") {
      addError("FAQ-009", "Public answer requires sourceRefs unless explicitly room-signal only.");
    }
  }

  if (envelope.l2 === "event_wiki") {
    if (!envelope.target?.eventId) addError("WIKI-STRUCT-001", "Wiki output requires target.eventId.");
    if (typeof envelope.version?.wikiVersion !== "number") addError("WIKI-STRUCT-007", "Wiki output requires wikiVersion.");
    if (envelope.visibility === "event_public" && envelope.sourceRefs.some(isPrivateRef)) {
      addError("WIKI-STRUCT-006", "Public wiki output cannot include private note refs.");
    }
  }

  if (envelope.l2 === "semantic_answer_cache") {
    if (!envelope.target?.eventId) addError("CACHE-002", "Event cache entries require target.eventId.");
    if (typeof envelope.version?.wikiVersion !== "number") addError("CACHE-003", "Event cache entries require wikiVersion.");
    if (typeof envelope.version?.sourceBundleVersion !== "number") {
      addError("CACHE-004", "Event cache entries require sourceBundleVersion.");
    }
    if (envelope.visibility === "event_public" && readPath(envelope.output, ["privateContextAllowed"]) !== false) {
      addError("CACHE-005", "Public cache entries must set privateContextAllowed=false.");
    }
  }

  if (envelope.l2 === "index_search") {
    const includePrivate = readPath(envelope.output, ["scope", "includePrivate"]);
    const results = readPath(envelope.output, ["results"]);
    if (envelope.visibility === "event_public" && includePrivate !== false) {
      addError("RET-003", "Public retrieval context must set includePrivate=false.");
    }
    if (Array.isArray(results) && envelope.visibility === "event_public") {
      const hasPrivateResult = results.some((result) => result?.visibility === "private");
      if (hasPrivateResult) addError("RET-003", "Public retrieval context cannot return private results.");
    }
  }

  if (envelope.l2 === "private_note") {
    if (envelope.visibility !== "private") addError("NOTE-001", "Private notes require visibility=private.");
    if (!stringField(envelope.output, "body")) addError("NOTE-002", "Private notes require a body.");
  }
}

function isPrivateRef(ref: string): boolean {
  return /^private[:/_-]|private_note|userNotes|note_private/i.test(ref);
}

function stringField(value: Record<string, unknown> | undefined, key: string): boolean {
  return typeof value?.[key] === "string" && String(value[key]).length > 0;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
