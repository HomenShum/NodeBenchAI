export type BooleanGateResult = {
  passed: boolean;
  checks: Record<string, boolean>;
  errors: string[];
  warnings: string[];
  details?: Record<string, unknown>;
};

export type LinkedInArchiveAuditResult = {
  scanned: number;
  duplicates: { duplicateGroups: number; duplicateRows: number };
  postUrnReuse: { distinctPostUrns: number; reusedPostUrns: number; reusedPostUrnsDifferentContent: number };
  issues: {
    missingPostUrn: number;
    missingPostUrl: number;
    overLength: number;
    mojibake: number;
    unknownCompany: number;
    demoMarkers: number;
  };
};

export function evaluateLinkedInArchiveAudit(audit: LinkedInArchiveAuditResult): BooleanGateResult {
  const checks = {
    noDuplicateRows: audit.duplicates.duplicateRows === 0,
    noReusedPostUrnsDifferentContent: audit.postUrnReuse.reusedPostUrnsDifferentContent === 0,
    noMissingPostUrn: audit.issues.missingPostUrn === 0,
    noMissingPostUrl: audit.issues.missingPostUrl === 0,
    noOverLength: audit.issues.overLength === 0,
    noMojibake: audit.issues.mojibake === 0,
    noUnknownCompany: audit.issues.unknownCompany === 0,
  };

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!checks.noDuplicateRows) errors.push(`LinkedIn archive has duplicateRows=${audit.duplicates.duplicateRows}`);
  if (!checks.noReusedPostUrnsDifferentContent) {
    errors.push(
      `LinkedIn archive has reusedPostUrnsDifferentContent=${audit.postUrnReuse.reusedPostUrnsDifferentContent}`
    );
  }
  if (!checks.noMissingPostUrn) errors.push(`LinkedIn archive has missingPostUrn=${audit.issues.missingPostUrn}`);
  if (!checks.noMissingPostUrl) errors.push(`LinkedIn archive has missingPostUrl=${audit.issues.missingPostUrl}`);
  if (!checks.noOverLength) errors.push(`LinkedIn archive has overLength=${audit.issues.overLength}`);
  if (!checks.noMojibake) errors.push(`LinkedIn archive has mojibake=${audit.issues.mojibake}`);
  if (!checks.noUnknownCompany) errors.push(`LinkedIn archive has unknownCompany=${audit.issues.unknownCompany}`);

  if (audit.issues.demoMarkers > 0) warnings.push(`LinkedIn archive demoMarkers=${audit.issues.demoMarkers}`);
  if (audit.duplicates.duplicateGroups > 0) warnings.push(`LinkedIn archive duplicateGroups=${audit.duplicates.duplicateGroups}`);
  if (audit.postUrnReuse.reusedPostUrns > 0) warnings.push(`LinkedIn archive reusedPostUrns=${audit.postUrnReuse.reusedPostUrns}`);

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    errors,
    warnings,
    details: {
      scanned: audit.scanned,
      duplicates: audit.duplicates,
      postUrnReuse: audit.postUrnReuse,
      issues: audit.issues,
    },
  };
}

export type DidYouKnowSourceUsed = {
  url?: string;
  canonicalUrl?: string;
  title?: string;
  sourceName?: string;
  publishedAtIso?: string;
  publishedAtMs?: number;
};

function isIsoDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

export function evaluateDidYouKnowSourcesUsed(sourcesUsed: unknown): BooleanGateResult {
  const sources = Array.isArray(sourcesUsed) ? (sourcesUsed as DidYouKnowSourceUsed[]) : [];
  const checks = {
    hasAtLeastOneSource: sources.length > 0,
    allSourcesHaveUrl: sources.length > 0 && sources.every((s) => typeof (s.url || s.canonicalUrl) === "string" && String(s.url || s.canonicalUrl).length > 0),
    allSourcesHavePublishedAtIso: sources.length > 0 && sources.every((s) => isIsoDateString(s.publishedAtIso)),
  };

  const errors: string[] = [];
  if (!checks.hasAtLeastOneSource) errors.push("DidYouKnow sourcesUsed is empty or missing");
  if (!checks.allSourcesHaveUrl) errors.push("DidYouKnow sourcesUsed has missing url/canonicalUrl");
  if (!checks.allSourcesHavePublishedAtIso) errors.push("DidYouKnow sourcesUsed has missing or invalid publishedAtIso");

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    errors,
    warnings: [],
    details: { sourceCount: sources.length },
  };
}

export type DidYouKnowArchiveRow = {
  postType: string;
  metadata?: any;
};

export function evaluateDidYouKnowArchiveRow(row: DidYouKnowArchiveRow): BooleanGateResult {
  const meta: any = row.metadata;
  const didYouKnow: any = meta?.didYouKnow;

  const sourcesGate = evaluateDidYouKnowSourcesUsed(didYouKnow?.sourcesUsed);

  const llmJudgePassed = didYouKnow?.llmJudge?.passed === true;
  const topPassed = didYouKnow?.passed === true;
  const embeddedCheck = didYouKnow?.checks?.allSourcesHavePublishedAtIso;
  const embeddedCheckBool = typeof embeddedCheck === "boolean" ? embeddedCheck : null;

  const checks = {
    isDidYouKnowType: row.postType === "did_you_know",
    didYouKnowMetadataPresent: Boolean(didYouKnow && typeof didYouKnow === "object"),
    didYouKnowPassedFlag: topPassed,
    llmJudgePassed: llmJudgePassed,
    sourcesUsedGatePassed: sourcesGate.passed,
    embeddedAllSourcesHavePublishedAtIso:
      embeddedCheckBool === null ? sourcesGate.checks.allSourcesHavePublishedAtIso : embeddedCheckBool === true,
  };

  const errors: string[] = [];
  if (!checks.isDidYouKnowType) errors.push("Archive row postType is not did_you_know");
  if (!checks.didYouKnowMetadataPresent) errors.push("Archive row missing metadata.didYouKnow");
  if (!checks.didYouKnowPassedFlag) errors.push("Archive row metadata.didYouKnow.passed is not true");
  if (!checks.llmJudgePassed) errors.push("Archive row metadata.didYouKnow.llmJudge.passed is not true");
  for (const e of sourcesGate.errors) errors.push(e);
  if (!checks.embeddedAllSourcesHavePublishedAtIso) errors.push("Archive row metadata.didYouKnow.checks.allSourcesHavePublishedAtIso is not true");

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    errors,
    warnings: [],
  };
}

export type DailyBriefDidYouKnowPayload = {
  passed?: boolean;
  sourcesUsed?: unknown;
  checks?: any;
  llmJudge?: any;
};

export function evaluateDailyBriefDidYouKnow(didYouKnow: unknown): BooleanGateResult {
  const payload = (didYouKnow && typeof didYouKnow === "object" ? (didYouKnow as DailyBriefDidYouKnowPayload) : null);
  const sourcesGate = evaluateDidYouKnowSourcesUsed(payload?.sourcesUsed);

  const checks = {
    didYouKnowPresent: Boolean(payload),
    didYouKnowPassedFlag: payload?.passed === true,
    llmJudgePassed: payload?.llmJudge?.passed === true,
    sourcesUsedGatePassed: sourcesGate.passed,
    embeddedAllSourcesHavePublishedAtIso:
      typeof payload?.checks?.allSourcesHavePublishedAtIso === "boolean"
        ? payload?.checks?.allSourcesHavePublishedAtIso === true
        : sourcesGate.checks.allSourcesHavePublishedAtIso,
  };

  const errors: string[] = [];
  if (!checks.didYouKnowPresent) errors.push("Daily brief missing didYouKnow payload");
  if (!checks.didYouKnowPassedFlag) errors.push("Daily brief didYouKnow.passed is not true");
  if (!checks.llmJudgePassed) errors.push("Daily brief didYouKnow.llmJudge.passed is not true");
  for (const e of sourcesGate.errors) errors.push(e);
  if (!checks.embeddedAllSourcesHavePublishedAtIso) errors.push("Daily brief didYouKnow.checks.allSourcesHavePublishedAtIso is not true");

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    errors,
    warnings: [],
  };
}

