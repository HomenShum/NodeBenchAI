export type NotebookAction =
  | "organize_notes"
  | "create_dossier"
  | "clone_structure"
  | "link_concepts"
  | "extract_followups"
  | "audit_claims"
  | "merge_entities"
  | "refresh_stale_sections"
  | "turn_into_template";

export type NotebookBlockChange =
  | {
      kind: "insert_section";
      title: string;
      body: string;
      sourceCaptureIds?: string[];
      entityKeys?: string[];
    }
  | {
      kind: "insert_callout";
      title: string;
      body: string;
      tone: "info" | "warning" | "action";
    }
  | {
      kind: "clone_section";
      sourceTemplateId: string;
      title: string;
      body: string;
    };

export type NotebookEntityChange = {
  kind: "upsert_entity";
  entityKey: string;
  name: string;
  entityType: "company" | "person" | "product" | "market" | "event" | "topic";
  confidence: number;
  sourceCaptureIds?: string[];
};

export type NotebookClaimChange = {
  kind: "propose_claim_update";
  claimId: string;
  claim: string;
  status: "field_note" | "needs_review" | "verified" | "rejected";
  evidenceIds: string[];
  reason: string;
};

export type NotebookFollowUpChange = {
  kind: "create_followup";
  action: string;
  linkedEntityKeys: string[];
  priority: "low" | "medium" | "high";
  sourceCaptureIds?: string[];
};

export type NotebookEdgeChange = {
  kind: "create_edge";
  fromKey: string;
  toKey: string;
  edgeType:
    | "BUILDS"
    | "MENTIONED_IN"
    | "CLAIMS"
    | "ATTENDED"
    | "COMPETES_WITH"
    | "RELATED_TO"
    | "HAS_PROFILE";
  explanation: string;
  confidence: number;
};

export type NotebookActionTraceStep = {
  label: string;
  detail: string;
};

export type NotebookActionPatch = {
  actionId: string;
  action: NotebookAction;
  summary: string;
  proposedBlockChanges: NotebookBlockChange[];
  proposedEntityChanges: NotebookEntityChange[];
  proposedClaimChanges: NotebookClaimChange[];
  proposedFollowUpChanges: NotebookFollowUpChange[];
  proposedEdgeChanges: NotebookEdgeChange[];
  requiresConfirmation: boolean;
  runTrace: NotebookActionTraceStep[];
};

export type NotebookCaptureInput = {
  captureId: string;
  rawText: string;
  extractedEntityIds?: string[];
};

export type NotebookClaimInput = {
  id: string;
  claim: string;
  status?: "field_note" | "needs_review" | "verified" | "rejected";
  evidenceIds?: string[];
};

export type NotebookTemplateInput = {
  templateId: string;
  sections: Array<{
    title: string;
    body: string;
  }>;
};

export type NotebookActionContext = {
  reportId: string;
  workspaceId?: string;
  selectedText?: string;
  captures?: NotebookCaptureInput[];
  claims?: NotebookClaimInput[];
  template?: NotebookTemplateInput;
};

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['".,()[\]{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "uncategorized";
}

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function splitSentences(value: string) {
  return value
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function inferEntityName(text: string) {
  const fromMatch = text.match(/\bfrom\s+([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,4})/);
  if (fromMatch?.[1]) return fromMatch[1].split(/[;:,]/)[0]!.split(". ")[0]!.trim();

  const companyMatch = text.match(/\b([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+){1,4})\b/);
  return companyMatch?.[1]?.split(/[;:,]/)[0]!.split(". ")[0]!.trim() || "Unassigned";
}

function inferEntityType(name: string, text: string): NotebookEntityChange["entityType"] {
  const lower = `${name} ${text}`.toLowerCase();
  if (lower.includes("market") || lower.includes("category")) return "market";
  if (lower.includes("event") || lower.includes("demo day")) return "event";
  if (lower.includes("agent") || lower.includes("api") || lower.includes("product")) return "product";
  return "company";
}

function captureGroups(captures: NotebookCaptureInput[]) {
  const groups = new Map<string, NotebookCaptureInput[]>();
  for (const capture of captures) {
    const name = inferEntityName(capture.rawText);
    const existing = groups.get(name) ?? [];
    existing.push(capture);
    groups.set(name, existing);
  }
  return groups;
}

function actionId(action: NotebookAction, reportId: string) {
  return `notebook.${action}.${slugify(reportId)}`;
}

function emptyPatch(action: NotebookAction, context: NotebookActionContext): NotebookActionPatch {
  return {
    actionId: actionId(action, context.reportId),
    action,
    summary: "No notebook changes proposed.",
    proposedBlockChanges: [],
    proposedEntityChanges: [],
    proposedClaimChanges: [],
    proposedFollowUpChanges: [],
    proposedEdgeChanges: [],
    requiresConfirmation: false,
    runTrace: [],
  };
}

function organizeNotes(context: NotebookActionContext): NotebookActionPatch {
  const captures = context.captures ?? [];
  const groups = captureGroups(captures);
  const patch = emptyPatch("organize_notes", context);
  patch.summary = `Grouped ${captures.length} captures into ${groups.size} notebook sections.`;
  patch.runTrace = [
    { label: "Search memory", detail: `Read ${captures.length} captures for ${context.reportId}.` },
    { label: "Group captures", detail: "Grouped notes by inferred company, market, or topic." },
    { label: "Propose sections", detail: "Preserved original capture ids for traceability." },
  ];

  for (const [name, group] of groups) {
    const entityKey = slugify(name);
    patch.proposedEntityChanges.push({
      kind: "upsert_entity",
      entityKey,
      name,
      entityType: inferEntityType(name, group.map((item) => item.rawText).join(" ")),
      confidence: name === "Unassigned" ? 0.35 : 0.72,
      sourceCaptureIds: group.map((item) => item.captureId),
    });
    patch.proposedBlockChanges.push({
      kind: "insert_section",
      title: name,
      body: group.map((item) => `- ${item.rawText.trim()}`).join("\n"),
      sourceCaptureIds: group.map((item) => item.captureId),
      entityKeys: [entityKey],
    });
  }

  return patch;
}

function createDossier(context: NotebookActionContext): NotebookActionPatch {
  const text = context.selectedText || context.captures?.[0]?.rawText || context.reportId;
  const name = inferEntityName(text);
  const entityKey = slugify(name);
  const patch = emptyPatch("create_dossier", context);
  patch.summary = `Create a web report dossier for ${name}.`;
  patch.proposedEntityChanges.push({
    kind: "upsert_entity",
    entityKey,
    name,
    entityType: inferEntityType(name, text),
    confidence: 0.76,
    sourceCaptureIds: context.captures?.map((capture) => capture.captureId),
  });
  patch.proposedBlockChanges.push(
    {
      kind: "insert_section",
      title: `${name} overview`,
      body: text.trim(),
      sourceCaptureIds: context.captures?.map((capture) => capture.captureId),
      entityKeys: [entityKey],
    },
    {
      kind: "insert_section",
      title: "Claims to verify",
      body: "List field-note claims here before promotion to canonical memory.",
      entityKeys: [entityKey],
    },
    {
      kind: "insert_section",
      title: "Next actions",
      body: "Add follow-ups, source checks, and workspace handoff decisions.",
      entityKeys: [entityKey],
    },
  );
  patch.runTrace = [
    { label: "Infer entity", detail: `Resolved ${name} from selected text or capture context.` },
    { label: "Create structure", detail: "Proposed overview, claim review, and next-action sections." },
  ];
  return patch;
}

function extractFollowUps(context: NotebookActionContext): NotebookActionPatch {
  const text = [
    context.selectedText,
    ...(context.captures ?? []).map((capture) => capture.rawText),
  ]
    .filter(Boolean)
    .join("\n");
  const candidates = splitSentences(text).filter((sentence) =>
    /\b(ask|follow up|follow-up|send|intro|verify|schedule|email|draft|call|needs|wants)\b/i.test(sentence),
  );
  const patch = emptyPatch("extract_followups", context);
  patch.summary = `Extracted ${candidates.length} follow-up candidates from notebook text.`;
  patch.proposedFollowUpChanges = candidates.map((candidate) => {
    const entityName = inferEntityName(candidate);
    return {
      kind: "create_followup",
      action: sentenceCase(candidate.replace(/^[-*]\s*/, "")),
      linkedEntityKeys: [slugify(entityName)],
      priority: /\b(verify|needs|wants|pilot|intro)\b/i.test(candidate) ? "high" : "medium",
      sourceCaptureIds: context.captures
        ?.filter((capture) => capture.rawText.includes(candidate))
        .map((capture) => capture.captureId),
    };
  });
  patch.runTrace = [
    { label: "Scan notebook", detail: "Searched selected text and captures for action language." },
    { label: "Create follow-ups", detail: "Linked each action to the inferred entity when possible." },
  ];
  return patch;
}

function auditClaims(context: NotebookActionContext): NotebookActionPatch {
  const claims = context.claims ?? [];
  const unsupported = claims.filter((claim) => (claim.evidenceIds ?? []).length === 0);
  const patch = emptyPatch("audit_claims", context);
  patch.summary = `Found ${unsupported.length} claims without evidence.`;
  patch.proposedClaimChanges = unsupported.map((claim) => ({
    kind: "propose_claim_update",
    claimId: claim.id,
    claim: claim.claim,
    status: "needs_review",
    evidenceIds: [],
    reason: "Claim has no evidence ids attached, so it should stay out of canonical verified memory.",
  }));
  patch.runTrace = [
    { label: "Read claims", detail: `Checked ${claims.length} notebook claims.` },
    { label: "Gate evidence", detail: "Claims with no evidence ids are proposed as needs_review." },
  ];
  return patch;
}

function linkConcepts(context: NotebookActionContext): NotebookActionPatch {
  const text = context.selectedText?.trim() || "";
  const parts = text
    .split(/\b(?:and|to|with|vs\.?|versus|because)\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const from = parts[0] || "source concept";
  const to = parts[1] || "target concept";
  const patch = emptyPatch("link_concepts", context);
  patch.summary = `Propose a typed relation between ${from} and ${to}.`;
  patch.proposedEdgeChanges.push({
    kind: "create_edge",
    fromKey: slugify(from),
    toKey: slugify(to),
    edgeType: "RELATED_TO",
    explanation: text || `Connect ${from} to ${to} with a user-reviewed explanation.`,
    confidence: text ? 0.62 : 0.35,
  });
  patch.proposedBlockChanges.push({
    kind: "insert_callout",
    title: "Explanation link",
    body: text || `Why ${from} relates to ${to}.`,
    tone: "info",
  });
  patch.requiresConfirmation = true;
  patch.runTrace = [
    { label: "Parse selection", detail: "Identified two concepts from selected notebook text." },
    { label: "Propose edge", detail: "Created a typed relation proposal; no graph write occurs until accepted." },
  ];
  return patch;
}

function cloneStructure(context: NotebookActionContext): NotebookActionPatch {
  const template = context.template;
  const patch = emptyPatch("clone_structure", context);
  if (!template) {
    patch.summary = "No template supplied for clone_structure.";
    return patch;
  }
  patch.summary = `Clone ${template.sections.length} sections from ${template.templateId}.`;
  patch.proposedBlockChanges = template.sections.map((section) => ({
    kind: "clone_section",
    sourceTemplateId: template.templateId,
    title: section.title,
    body: section.body,
  }));
  patch.runTrace = [
    { label: "Load template", detail: `Loaded section structure from ${template.templateId}.` },
    { label: "Clone structure", detail: "Copied structure only; live report data still needs source-backed fill." },
  ];
  return patch;
}

export function createNotebookActionPatch(
  action: NotebookAction,
  context: NotebookActionContext,
): NotebookActionPatch {
  switch (action) {
    case "organize_notes":
      return organizeNotes(context);
    case "create_dossier":
      return createDossier(context);
    case "extract_followups":
      return extractFollowUps(context);
    case "audit_claims":
      return auditClaims(context);
    case "link_concepts":
      return linkConcepts(context);
    case "clone_structure":
      return cloneStructure(context);
    case "merge_entities":
    case "refresh_stale_sections":
    case "turn_into_template": {
      const patch = emptyPatch(action, context);
      patch.summary = `${action} is intentionally proposal-only until the accepting mutation is implemented.`;
      patch.requiresConfirmation = true;
      patch.runTrace = [
        { label: "Hold action", detail: "This action needs a dedicated accepting mutation before graph writes." },
      ];
      return patch;
    }
    default:
      return emptyPatch(action, context);
  }
}
