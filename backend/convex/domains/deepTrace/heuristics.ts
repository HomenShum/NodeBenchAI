import { buildCanonicalKey, slugify } from "../../lib/entityResolution";
import type { ExtractionResult } from "../temporal/langExtract";
import type {
  DDSource,
  FinancialDeepFindings,
  MarketCompetitiveFindings,
  NetworkMappingFindings,
  RegulatoryFindings,
  TeamMemberProfile,
  TeamFoundersFindings,
} from "../agents/dueDiligence/types";

export interface DeepTraceSourceRef {
  label: string;
  href?: string;
  note?: string;
  kind?: string;
  publishedAtIso?: string;
}

export interface RelationshipObservationSeed {
  subjectEntityKey: string;
  relatedEntityKey: string;
  relatedEntityName: string;
  relatedEntityType?: string;
  relationshipType: string;
  direction?: "outbound" | "inbound" | "bidirectional";
  claimText: string;
  summary?: string;
  confidence: number;
  observedAt: number;
  effectiveAt?: number;
  freshness?: number;
  status?: "active" | "watch" | "historical" | "disputed";
  sourceRefs?: DeepTraceSourceRef[];
  metadata?: Record<string, unknown>;
}

export interface WorldEventSeed {
  title: string;
  summary: string;
  topic: string;
  severity: "low" | "medium" | "high" | "critical";
  status?: "open" | "watch" | "resolved" | "dismissed";
  happenedAt: number;
  detectedAt?: number;
  countryCode?: string;
  region?: string;
  placeName?: string;
  latitude?: number;
  longitude?: number;
  primaryEntityKey?: string;
  linkedEntityKeys?: string[];
  sourceRefs: DeepTraceSourceRef[];
  metadata?: Record<string, unknown>;
  causalSummary?: string;
}

export interface CausalChainSeed {
  title: string;
  entityKey?: string;
  rootQuestion: string;
  summary: string;
  plainEnglish: string;
  outcome?: string;
  happenedAt: number;
  sourceRefs?: DeepTraceSourceRef[];
  nodes: Array<{
    timestamp: number;
    label: string;
    description: string;
  }>;
}

const RELATIONSHIP_PATTERNS: Array<{ regex: RegExp; type: string; direction?: "outbound" | "inbound" | "bidirectional" }> = [
  { regex: /\bcompetes?\s+with\b|\bcompetitor\b/i, type: "competitor", direction: "bidirectional" },
  { regex: /\bsupplier\b|\bsupplies\b|\bsupplied\b/i, type: "supplier", direction: "outbound" },
  { regex: /\bcustomer\b|\bbuys from\b|\bbuyer\b/i, type: "customer", direction: "outbound" },
  { regex: /\bpartner(?:ed|s|ship)?\b/i, type: "partner", direction: "bidirectional" },
  { regex: /\binvest(?:or|ed|ment)\b|\bled by\b|\bbacked by\b/i, type: "investor", direction: "outbound" },
  { regex: /\bsubsidiar(?:y|ies)\b|\bowned by\b|\bacquired\b/i, type: "subsidiary", direction: "outbound" },
  { regex: /\bboard\b|\bdirector\b/i, type: "board_member", direction: "outbound" },
  { regex: /\bchief\b|\bceo\b|\bcto\b|\bcfo\b|\bexecutive\b|\bpresident\b/i, type: "executive", direction: "outbound" },
  { regex: /\bfounder\b|\bco-founder\b/i, type: "founder", direction: "outbound" },
  { regex: /\bholder\b|\bbeneficial owner\b|\bowns?\b/i, type: "holder", direction: "outbound" },
];

const EVENT_PATTERNS: Array<{ regex: RegExp; topic: string; severity: WorldEventSeed["severity"] }> = [
  { regex: /\bapproved\b|\bclearance\b|\bcleared\b/i, topic: "regulatory approval", severity: "medium" },
  { regex: /\bban(?:ned)?\b|\brestricted\b|\bsanction(?:ed)?\b/i, topic: "policy restriction", severity: "high" },
  { regex: /\blawsuit\b|\bsued\b|\binvestigation\b/i, topic: "legal action", severity: "high" },
  { regex: /\bfunding\b|\braised\b|\bseries [a-z]\b/i, topic: "funding", severity: "medium" },
  { regex: /\bacqui(?:re|red|sition)\b|\bmerger\b/i, topic: "m&a", severity: "high" },
  { regex: /\blaunch(?:ed)?\b|\brelease(?:d)?\b/i, topic: "product launch", severity: "medium" },
  { regex: /\boutage\b|\bdisruption\b|\bshortage\b/i, topic: "operational disruption", severity: "high" },
  { regex: /\btariff\b|\btrade\b|\bexport control\b/i, topic: "macro policy", severity: "high" },
];

function dedupeSourceRefs(refs: DeepTraceSourceRef[]): DeepTraceSourceRef[] {
  const seen = new Set<string>();
  const deduped: DeepTraceSourceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}|${ref.kind ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

function inferEntityType(label: string): "company" | "person" {
  return /\b(inc|corp|llc|ltd|technologies|capital|ventures|partners|labs|systems)\b/i.test(label)
    ? "company"
    : label.includes(" ") && /^[A-Z]/.test(label)
      ? "person"
      : "company";
}

function buildEntityKey(name: string, explicitType?: string): string {
  const normalizedType =
    explicitType === "person" || explicitType === "company"
      ? explicitType
      : inferEntityType(name);
  return buildCanonicalKey(normalizedType, name);
}

function guessRelationshipType(claimText: string): { relationshipType: string; direction?: "outbound" | "inbound" | "bidirectional" } | null {
  for (const pattern of RELATIONSHIP_PATTERNS) {
    if (pattern.regex.test(claimText)) {
      return { relationshipType: pattern.type, direction: pattern.direction };
    }
  }
  return null;
}

function guessEventPattern(text: string): { topic: string; severity: WorldEventSeed["severity"] } | null {
  for (const pattern of EVENT_PATTERNS) {
    if (pattern.regex.test(text)) return pattern;
  }
  return null;
}

function severityFromRisk(text: string): WorldEventSeed["severity"] {
  if (/\bcritical\b|\bfraud\b|\bwarning letter\b/i.test(text)) return "critical";
  if (/\bhigh\b|\blawsuit\b|\binvestigation\b|\bban\b/i.test(text)) return "high";
  if (/\bmedium\b|\bpending\b|\bapproval\b/i.test(text)) return "medium";
  return "low";
}

function dedupeObservations(items: RelationshipObservationSeed[]): RelationshipObservationSeed[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.subjectEntityKey,
      item.relatedEntityKey,
      item.relationshipType,
      item.claimText.toLowerCase(),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeEvents(items: WorldEventSeed[]): WorldEventSeed[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.title.toLowerCase(),
      item.topic.toLowerCase(),
      item.primaryEntityKey ?? "",
      item.happenedAt,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildEntityContextObservationSeeds(input: {
  entityName: string;
  entityType: "company" | "person";
  entityKey?: string;
  researchedAt?: number;
  summary?: string;
  people?: {
    founders?: Array<{ name: string; title?: string; role?: string }>;
    executives?: Array<{ name: string; title?: string; role?: string }>;
    boardMembers?: Array<{ name: string; title?: string; role?: string }>;
  };
  crmFields?: {
    investors?: string[];
    competitors?: string[];
    partnerships?: string[];
  };
  funding?: {
    investors?: string[];
    lastRound?: {
      coLeads?: string[];
      participants?: string[];
    };
  };
  sources?: Array<{ name: string; url?: string; snippet?: string }>;
}): RelationshipObservationSeed[] {
  const entityKey = input.entityKey ?? buildCanonicalKey(input.entityType, input.entityName);
  const observedAt = input.researchedAt ?? Date.now();
  const sourceRefs = dedupeSourceRefs(
    (input.sources ?? []).map((source) => ({
      label: source.name,
      href: source.url,
      note: source.snippet,
      kind: "entity_context",
    })),
  );
  const observations: RelationshipObservationSeed[] = [];
  const pushPerson = (name: string, relationshipType: string, title?: string) => {
    if (!name?.trim()) return;
    observations.push({
      subjectEntityKey: entityKey,
      relatedEntityKey: buildCanonicalKey("person", name),
      relatedEntityName: name,
      relatedEntityType: "person",
      relationshipType,
      direction: "outbound",
      claimText: `${input.entityName} is linked to ${name} as ${relationshipType.replace(/_/g, " ")}.`,
      summary: title ?? input.summary,
      confidence: 0.62,
      observedAt,
      freshness: 30,
      sourceRefs,
      metadata: { source: "entity_context" },
    });
  };
  const pushOrg = (name: string, relationshipType: string) => {
    if (!name?.trim()) return;
    observations.push({
      subjectEntityKey: entityKey,
      relatedEntityKey: buildCanonicalKey("company", name),
      relatedEntityName: name,
      relatedEntityType: "company",
      relationshipType,
      direction: relationshipType === "competitor" ? "bidirectional" : "outbound",
      claimText: `${input.entityName} is linked to ${name} as ${relationshipType.replace(/_/g, " ")}.`,
      summary: input.summary,
      confidence: 0.58,
      observedAt,
      freshness: 30,
      sourceRefs,
      metadata: { source: "entity_context" },
    });
  };

  for (const founder of input.people?.founders ?? []) pushPerson(founder.name, "founder", founder.title ?? founder.role);
  for (const executive of input.people?.executives ?? []) pushPerson(executive.name, "executive", executive.title ?? executive.role);
  for (const boardMember of input.people?.boardMembers ?? []) pushPerson(boardMember.name, "board_member", boardMember.title ?? boardMember.role);
  for (const investor of [
    ...(input.crmFields?.investors ?? []),
    ...(input.funding?.investors ?? []),
    ...(input.funding?.lastRound?.coLeads ?? []),
    ...(input.funding?.lastRound?.participants ?? []),
  ]) {
    pushOrg(investor, "investor");
  }
  for (const competitor of input.crmFields?.competitors ?? []) pushOrg(competitor, "competitor");
  for (const partner of input.crmFields?.partnerships ?? []) {
    const lowered = partner.toLowerCase();
    const relationshipType = lowered.includes("supplier")
      ? "supplier"
      : lowered.includes("customer")
        ? "customer"
        : lowered.includes("subsidiar")
          ? "subsidiary"
          : "partner";
    pushOrg(partner, relationshipType);
  }
  return dedupeObservations(observations);
}

export function buildEntityContextWorldEventSeeds(input: {
  entityName: string;
  entityKey?: string;
  recentNewsItems?: Array<{ headline?: string; title?: string; summary?: string; source?: string; url?: string; publishedAt?: number | string }>;
}): WorldEventSeed[] {
  const entityKey = input.entityKey ?? buildCanonicalKey("company", input.entityName);
  const events: WorldEventSeed[] = [];
  for (const item of input.recentNewsItems ?? []) {
    const title = item.headline ?? item.title;
    if (!title) continue;
    const pattern = guessEventPattern(`${title}. ${item.summary ?? ""}`) ?? { topic: "entity development", severity: "low" as const };
    const happenedAt =
      typeof item.publishedAt === "number"
        ? item.publishedAt
        : item.publishedAt
          ? Date.parse(item.publishedAt) || Date.now()
          : Date.now();
    events.push({
      title,
      summary: item.summary ?? title,
      topic: pattern.topic,
      severity: pattern.severity,
      happenedAt,
      primaryEntityKey: entityKey,
      linkedEntityKeys: [entityKey],
      sourceRefs: [{
        label: item.source ?? "Recent news",
        href: item.url,
        note: item.summary,
        kind: "entity_context",
      }],
      metadata: { source: "entity_context" },
    });
  }
  return dedupeEvents(events);
}

export function buildRelationshipObservationSeedsFromExtraction(input: {
  entityKey?: string;
  entityName?: string;
  extraction: ExtractionResult;
  observedAt?: number;
  sourceRefs?: DeepTraceSourceRef[];
}): RelationshipObservationSeed[] {
  const observedAt = input.observedAt ?? Date.now();
  const focusEntityKey = input.entityKey;
  const focusEntityName = input.entityName;
  const entityTypeByName = new Map(input.extraction.entities.map((entity) => [entity.name, entity.type]));
  const observations: RelationshipObservationSeed[] = [];

  for (const claim of input.extraction.claims) {
    const relationship = guessRelationshipType(claim.claimText);
    if (!relationship) continue;
    const namedEntities = claim.entities.filter((name) => !!name?.trim());
    if (namedEntities.length === 0) continue;
    const subjectEntityName = focusEntityName ?? namedEntities[0];
    const subjectEntityKey = focusEntityKey ?? buildEntityKey(subjectEntityName, entityTypeByName.get(subjectEntityName));
    const relatedCandidates = namedEntities.filter((name) => name !== subjectEntityName);
    for (const relatedEntityName of relatedCandidates.slice(0, 4)) {
      observations.push({
        subjectEntityKey,
        relatedEntityKey: buildEntityKey(relatedEntityName, entityTypeByName.get(relatedEntityName)),
        relatedEntityName,
        relatedEntityType:
          entityTypeByName.get(relatedEntityName) === "person" ? "person" : "company",
        relationshipType: relationship.relationshipType,
        direction: relationship.direction,
        claimText: claim.claimText,
        summary: claim.sourceSpan.excerpt,
        confidence: Math.max(0.45, Math.min(0.92, claim.confidence)),
        observedAt,
        effectiveAt: claim.temporalMarker ? Date.parse(claim.temporalMarker) || undefined : undefined,
        freshness: 14,
        sourceRefs: dedupeSourceRefs([
          ...(input.sourceRefs ?? []),
          {
            label: "Structured extraction",
            note: claim.sourceSpan.excerpt,
            kind: "structured_extraction",
          },
        ]),
        metadata: { claimType: claim.claimType, source: "structured_text" },
      });
    }
  }
  return dedupeObservations(observations);
}

export function buildWorldEventSeedsFromExtraction(input: {
  entityKey?: string;
  entityName?: string;
  extraction: ExtractionResult;
  observedAt?: number;
  sourceRefs?: DeepTraceSourceRef[];
}): WorldEventSeed[] {
  const observedAt = input.observedAt ?? Date.now();
  const focusEntityKey = input.entityKey;
  const entityTypeByName = new Map(input.extraction.entities.map((entity) => [entity.name, entity.type]));
  const events: WorldEventSeed[] = [];

  for (const claim of input.extraction.claims) {
    const event = guessEventPattern(claim.claimText);
    if (!event) continue;
    const linkedEntityKeys = claim.entities
      .map((name) => buildEntityKey(name, entityTypeByName.get(name)))
      .slice(0, 6);
    const primaryEntityKey = focusEntityKey ?? linkedEntityKeys[0];
    events.push({
      title: claim.claimText.length > 120 ? `${claim.claimText.slice(0, 117)}...` : claim.claimText,
      summary: claim.sourceSpan.excerpt,
      topic: event.topic,
      severity: event.severity,
      happenedAt: observedAt,
      primaryEntityKey,
      linkedEntityKeys,
      sourceRefs: dedupeSourceRefs([
        ...(input.sourceRefs ?? []),
        {
          label: "Structured extraction",
          note: claim.sourceSpan.excerpt,
          kind: "structured_extraction",
        },
      ]),
      metadata: { claimType: claim.claimType, source: "structured_text" },
      causalSummary: claim.claimType === "causal" ? claim.claimText : undefined,
    });
  }
  return dedupeEvents(events);
}

function buildDDSourceRefs(sources: DDSource[]): DeepTraceSourceRef[] {
  return dedupeSourceRefs(
    sources.map((source) => ({
      label: source.title ?? source.sourceType,
      href: source.url,
      note: source.section,
      kind: source.sourceType,
    })),
  );
}

function getTeamMemberSummary(member: Pick<TeamMemberProfile, "currentRole" | "highlights">): string | undefined {
  return member.currentRole || member.highlights?.[0];
}

export function buildObservationSeedsFromDueDiligence(input: {
  entityName: string;
  entityType: "company" | "person" | "fund";
  branchType: string;
  findings: unknown;
  sources: DDSource[];
  confidence?: number;
  observedAt?: number;
}): RelationshipObservationSeed[] {
  const observedAt = input.observedAt ?? Date.now();
  const subjectEntityKey = buildCanonicalKey(input.entityType === "fund" ? "company" : input.entityType, input.entityName);
  const sourceRefs = buildDDSourceRefs(input.sources);
  const baseConfidence = Math.max(0.5, Math.min(0.95, input.confidence ?? 0.65));
  const observations: RelationshipObservationSeed[] = [];
  const push = (name: string, relationshipType: string, type: "person" | "company", summary?: string) => {
    if (!name?.trim()) return;
    observations.push({
      subjectEntityKey,
      relatedEntityKey: buildCanonicalKey(type, name),
      relatedEntityName: name,
      relatedEntityType: type,
      relationshipType,
      direction: relationshipType === "competitor" ? "bidirectional" : "outbound",
      claimText: `${input.entityName} is linked to ${name} as ${relationshipType.replace(/_/g, " ")}.`,
      summary,
      confidence: baseConfidence,
      observedAt,
      freshness: 30,
      sourceRefs,
      metadata: { branchType: input.branchType, source: "due_diligence" },
    });
  };

  if (input.branchType === "team_founders") {
    const findings = input.findings as TeamFoundersFindings;
    for (const founder of findings.founders ?? []) push(founder.name, "founder", "person", getTeamMemberSummary(founder));
    for (const executive of findings.executives ?? []) push(executive.name, "executive", "person", getTeamMemberSummary(executive));
    for (const boardMember of findings.boardMembers ?? []) push(boardMember.name, "board_member", "person", getTeamMemberSummary(boardMember));
    for (const advisor of findings.advisors ?? []) push(advisor.name, "advisor", "person", getTeamMemberSummary(advisor));
  } else if (input.branchType === "market_competitive") {
    const findings = input.findings as MarketCompetitiveFindings;
    for (const competitor of findings.competitors ?? []) {
      push(competitor.name, "competitor", "company", competitor.differentiator ?? competitor.description);
    }
  } else if (input.branchType === "financial_deep") {
    const findings = input.findings as FinancialDeepFindings;
    for (const round of findings.fundingHistory ?? []) {
      for (const investor of round.leadInvestors ?? []) {
        push(investor, "investor", "company", `${round.roundType}${round.amount ? ` ${round.amount}` : ""}`);
      }
    }
  } else if (input.branchType === "network_mapping") {
    const findings = input.findings as NetworkMappingFindings;
    for (const investor of findings.investorNetwork ?? []) push(investor, "investor", "company");
    for (const advisor of findings.advisorNetwork ?? []) push(advisor, "advisor", "person");
    for (const edge of findings.networkGraph?.edges ?? []) {
      const sourceNode = findings.networkGraph.nodes.find((node) => node.id === edge.source);
      if (!sourceNode || sourceNode.name === input.entityName) continue;
      push(
        sourceNode.name,
        slugify(edge.relationship).replace(/-/g, "_"),
        sourceNode.type === "person" ? "person" : "company",
      );
    }
  }

  return dedupeObservations(observations);
}

export function buildWorldEventSeedsFromDueDiligence(input: {
  entityName: string;
  entityType: "company" | "person" | "fund";
  branchType: string;
  findings: unknown;
  sources: DDSource[];
  confidence?: number;
  observedAt?: number;
}): WorldEventSeed[] {
  const observedAt = input.observedAt ?? Date.now();
  const primaryEntityKey = buildCanonicalKey(input.entityType === "fund" ? "company" : input.entityType, input.entityName);
  const sourceRefs = buildDDSourceRefs(input.sources);
  const events: WorldEventSeed[] = [];

  if (input.branchType === "regulatory") {
    const findings = input.findings as RegulatoryFindings;
    for (const approval of findings.approvals ?? []) {
      events.push({
        title: `${input.entityName}: ${approval}`,
        summary: findings.currentStatus ?? approval,
        topic: "regulatory approval",
        severity: "medium",
        happenedAt: observedAt,
        primaryEntityKey,
        linkedEntityKeys: [primaryEntityKey],
        sourceRefs,
        metadata: { branchType: input.branchType, source: "due_diligence" },
        causalSummary: `${approval} may change commercial readiness and competitive pressure for ${input.entityName}.`,
      });
    }
    for (const risk of findings.complianceRisks ?? []) {
      events.push({
        title: `${input.entityName}: ${risk}`,
        summary: risk,
        topic: "regulatory risk",
        severity: severityFromRisk(risk),
        happenedAt: observedAt,
        primaryEntityKey,
        linkedEntityKeys: [primaryEntityKey],
        sourceRefs,
        metadata: { branchType: input.branchType, source: "due_diligence" },
        causalSummary: `${risk} may constrain distribution, approvals, or investor confidence for ${input.entityName}.`,
      });
    }
  }

  if (input.branchType === "financial_deep") {
    const findings = input.findings as FinancialDeepFindings;
    for (const round of findings.fundingHistory ?? []) {
      if (!round.roundType && !round.amount) continue;
      events.push({
        title: `${input.entityName}: ${round.roundType ?? "Funding round"}`,
        summary: [round.amount, round.valuation].filter(Boolean).join(" | ") || "Funding event identified during due diligence.",
        topic: "funding",
        severity: "medium",
        happenedAt: observedAt,
        primaryEntityKey,
        linkedEntityKeys: [primaryEntityKey],
        sourceRefs,
        metadata: { branchType: input.branchType, source: "due_diligence" },
      });
    }
  }

  return dedupeEvents(events);
}

export function buildCausalChainSeedFromWorldEvent(event: WorldEventSeed): CausalChainSeed | null {
  const summary = event.causalSummary ?? event.summary;
  if (!summary || !/\bimpact|pressure|risk|opportunit|response|affect|constrain|change\b/i.test(summary)) {
    return null;
  }

  return {
    title: `${event.title} impact chain`,
    entityKey: event.primaryEntityKey,
    rootQuestion: `How does "${event.title}" affect the linked entity set?`,
    summary,
    plainEnglish: summary,
    outcome: event.summary,
    happenedAt: event.happenedAt,
    sourceRefs: event.sourceRefs,
    nodes: [
      {
        timestamp: event.happenedAt,
        label: event.topic,
        description: event.title,
      },
      {
        timestamp: event.happenedAt + 1,
        label: "entity impact",
        description: summary,
      },
    ],
  };
}
