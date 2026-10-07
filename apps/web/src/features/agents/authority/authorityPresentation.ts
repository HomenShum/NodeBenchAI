export const AUTHORITY_OPERATION = "notebook.update_block" as const;

export type AuthorityMode = "review" | "run" | "workspace";

export type AuthorityGrantStatus =
  | "inactive"
  | "active"
  | "paused"
  | "revoked"
  | "expired"
  | "consumed";

export interface AuthorityModeOption {
  id: AuthorityMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const AUTHORITY_MODE_OPTIONS: readonly AuthorityModeOption[] = [
  {
    id: "review",
    label: "Review every change",
    shortLabel: "Review",
    description: "You approve every eligible Live intelligence replacement.",
  },
  {
    id: "run",
    label: "Autonomous this run",
    shortLabel: "This run",
    description:
      "Eligible existing-block replacements may commit for this live run until its grant ends.",
  },
  {
    id: "workspace",
    label: "Autonomous workspace",
    shortLabel: "Workspace",
    description:
      "Eligible existing-block replacements may commit in your notebooks until the grant ends.",
  },
] as const;

export const RESTRICTED_AUTHORITY_OPERATIONS = [
  "Insert blocks",
  "Change block kind or structure",
  "Publish",
  "Share",
  "Export",
  "Delete",
  "Change access",
  "External sync",
  "Network egress",
  "File access",
] as const;

export interface AuthorityStatusPresentation {
  label: string;
  tone: "neutral" | "active" | "paused" | "ended";
}

export function getAuthorityStatusPresentation(
  mode: AuthorityMode,
  grantStatus: AuthorityGrantStatus,
): AuthorityStatusPresentation {
  if (mode === "review") {
    return { label: "Review required", tone: "neutral" };
  }

  switch (grantStatus) {
    case "active":
      return { label: "Delegated · active", tone: "active" };
    case "paused":
      return { label: "Delegated · paused", tone: "paused" };
    case "revoked":
      return { label: "Grant revoked", tone: "ended" };
    case "expired":
      return { label: "Grant expired", tone: "ended" };
    case "consumed":
      return { label: "Operation cap reached", tone: "ended" };
    case "inactive":
    default:
      return { label: "Grant not active", tone: "neutral" };
  }
}

export function getAuthoritySummary(
  mode: AuthorityMode,
  grantStatus: AuthorityGrantStatus,
): string {
  if (mode === "review") {
    return "Live intelligence may prepare an eligible replacement, but it will not apply until you approve.";
  }

  if (grantStatus === "active") {
    return mode === "run"
      ? "Eligible Live intelligence replacements may commit without repeated approval for this run."
      : "Eligible Live intelligence replacements may commit without repeated approval in notebooks you own.";
  }

  if (grantStatus === "paused") {
    return "Delegated commits are paused. New eligible Live intelligence replacements require review until you resume.";
  }

  if (grantStatus === "revoked") {
    return "This grant was revoked. New eligible Live intelligence replacements require review.";
  }

  if (grantStatus === "expired") {
    return "This grant expired. New eligible Live intelligence replacements require review.";
  }

  if (grantStatus === "consumed") {
    return "This grant reached its operation cap. New eligible Live intelligence replacements require review.";
  }

  return "This selection is not active yet. New eligible Live intelligence replacements still require review.";
}
