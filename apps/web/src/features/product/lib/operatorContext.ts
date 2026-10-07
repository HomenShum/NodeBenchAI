export type OperatorCommunicationStyle = "concise" | "balanced" | "detailed";
export type OperatorEvidenceStyle = "balanced" | "citation_heavy" | "fast";

export interface OperatorContextPreferences {
  communicationStyle?: OperatorCommunicationStyle;
  evidenceStyle?: OperatorEvidenceStyle;
  avoidCorporateTone?: boolean;
}

export interface OperatorContextProfileLike {
  backgroundSummary?: string | null;
  preferredLens?: string | null;
  rolesOfInterest?: string[] | null;
  preferences?: OperatorContextPreferences | null;
}

function normalizeText(value?: string | null) {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeRolesOfInterest(input: string): string[] {
  if (!input.trim()) return [];
  return Array.from(
    new Set(
      input
        .split(/[,\n]/)
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

export function rolesOfInterestToText(roles?: string[] | null) {
  return Array.isArray(roles) ? roles.join(", ") : "";
}

export function buildOperatorContextHint(profile?: OperatorContextProfileLike | null): string | null {
  if (!profile) return null;

  const background = normalizeText(profile.backgroundSummary).slice(0, 220);
  const preferredLens = normalizeText(profile.preferredLens);
  const roles = (profile.rolesOfInterest ?? []).map((role) => normalizeText(role)).filter(Boolean).slice(0, 5);
  const communicationStyle = profile.preferences?.communicationStyle;
  const evidenceStyle = profile.preferences?.evidenceStyle;
  const avoidCorporateTone = profile.preferences?.avoidCorporateTone;

  const parts = [
    background ? `Background: ${background}.` : null,
    preferredLens ? `Preferred lens: ${preferredLens}.` : null,
    roles.length > 0 ? `Roles of interest: ${roles.join(", ")}.` : null,
    communicationStyle ? `Communication style: ${communicationStyle}.` : null,
    evidenceStyle ? `Evidence mode: ${evidenceStyle.replaceAll("_", " ")}.` : null,
    avoidCorporateTone ? "Avoid corporate or filler-heavy tone." : null,
  ].filter((value): value is string => Boolean(value));

  if (!parts.length) return null;
  return parts.join(" ").slice(0, 400);
}

export function buildOperatorContextLabel(profile?: OperatorContextProfileLike | null): string | null {
  if (!profile) return null;

  const labels = [
    normalizeText(profile.preferredLens) || null,
    profile.preferences?.communicationStyle ?? null,
    profile.preferences?.evidenceStyle ? profile.preferences.evidenceStyle.replaceAll("_", " ") : null,
    profile.preferences?.avoidCorporateTone ? "no corporate tone" : null,
  ].filter((value): value is string => Boolean(value));

  if (!labels.length) return null;
  return labels.join(" | ");
}
