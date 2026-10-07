export type ExactRuntimeSource = {
  n: number;
  fav: string;
  domain: string;
  title: string;
  url?: string;
  cached?: boolean;
};

type RuntimeEvidenceRow = {
  idx?: number;
  quote?: string;
  source?: string;
  verificationState?: string;
};

function sourceDomain(source: string | undefined) {
  if (!source) return "source";
  try {
    const parsed = new URL(source);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return source.replace(/^https?:\/\//, "").split("/")[0] || "source";
  }
}

function exactHttpSourceUrl(source: string | undefined): string | undefined {
  const value = source?.trim();
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function sourceFav(domain: string) {
  return (domain.match(/[a-z0-9]/i)?.[0] ?? "S").toUpperCase();
}

export function projectExactRuntimeSources(rows: RuntimeEvidenceRow[]): ExactRuntimeSource[] {
  return rows.slice(0, 8).map((row, index) => {
    const domain = sourceDomain(row.source);
    return {
      n: row.idx ?? index + 1,
      fav: sourceFav(domain),
      domain,
      title: row.quote || row.source || `Source ${index + 1}`,
      url: exactHttpSourceUrl(row.source),
      cached: row.verificationState === "cached_reference"
        ? true
        : row.verificationState === "provider_grounded"
          ? false
          : undefined,
    };
  });
}

export function isExactChatRunInFlight(
  status: string,
  activeTurnId: string | null,
  submissionPending = false,
) {
  return submissionPending || status === "thinking" || activeTurnId !== null;
}

export function acquireExactChatSubmitLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function requireSuccessfulInboxMutation(result: unknown): void {
  if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) {
    throw new Error("The inbox action was not confirmed by the runtime.");
  }
}

export function hasSavedEntityReport(entity: {
  reportCount?: unknown;
  latestReportUpdatedAt?: unknown;
}): boolean {
  return (
    (typeof entity.reportCount === "number" && entity.reportCount > 0) ||
    typeof entity.latestReportUpdatedAt === "number"
  );
}
