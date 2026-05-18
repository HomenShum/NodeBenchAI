export type EvidenceVerificationState =
  | "verified"
  | "cached_reference"
  | "provider_grounded"
  | "fetch_blocked"
  | "unsupported";

export interface EvidenceVerificationDecision {
  state: EvidenceVerificationState;
  status: string;
  verified: boolean;
  blocking: boolean;
  detail: string;
}

const BLOCKED_FETCH_RE = /^(global_timeout|timeout|fetch_|http_(401|403|408|409|425|429|5\d\d))/i;

export function classifyEvidenceVerification(input: {
  source: string;
  sourceProvider?: string;
  fetchedOk?: boolean;
  fetchReason?: string;
  quoteMatched?: boolean;
}): EvidenceVerificationDecision {
  const provider = input.sourceProvider?.toLowerCase() ?? "";
  const hasUrl = /^https?:\/\//i.test(input.source);
  const providerGrounded =
    /gemini|google|ground|linkup|search|provider/.test(provider);

  if (!hasUrl) {
    return {
      state: "cached_reference",
      status: "cached_reference",
      verified: false,
      blocking: false,
      detail: "Cached memory/source-cache reference. No public URL fetch was available for substring validation.",
    };
  }

  if (input.fetchedOk && input.quoteMatched) {
    return {
      state: "verified",
      status: "source_validation_passed",
      verified: true,
      blocking: false,
      detail: "Quote substring confirmed in source body.",
    };
  }

  if (input.fetchReason && BLOCKED_FETCH_RE.test(input.fetchReason)) {
    return {
      state: "fetch_blocked",
      status: "source_fetch_blocked",
      verified: false,
      blocking: false,
      detail: `Provider supplied the source, but post-hoc page fetch was blocked or timed out (${input.fetchReason}).`,
    };
  }

  if (input.fetchedOk && input.quoteMatched === false && providerGrounded) {
    return {
      state: "provider_grounded",
      status: "provider_grounded_unmatched",
      verified: false,
      blocking: false,
      detail: "Search provider supplied the source, but the exact cited snippet was not found in the fetched page body.",
    };
  }

  return {
    state: "unsupported",
    status: "source_validation_failed",
    verified: false,
    blocking: true,
    detail: input.fetchReason
      ? `Source validation failed (${input.fetchReason}).`
      : "Source fetched, but the cited quote was not confirmed in the page body.",
  };
}
