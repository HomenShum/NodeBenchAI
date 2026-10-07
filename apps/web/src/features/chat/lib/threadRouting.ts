import { buildEntityPath } from "@/features/entities/lib/entityExport";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";

type ChatPathArgs = {
  entitySlug?: string | null;
  lens?: string | null;
  sessionId?: string | null;
};

type ChatShareUrlArgs = {
  origin: string;
  currentHref?: string | null;
  resolvedEntitySlug?: string | null;
  activeSessionId?: string | null;
  entitySlug?: string | null;
  startedQuery?: string | null;
  lens?: string | null;
};

export function buildChatSessionPath({
  entitySlug,
  lens,
  sessionId,
}: ChatPathArgs) {
  const normalizedEntity = String(entitySlug ?? "").trim();
  const normalizedLens = String(lens ?? "").trim();
  const normalizedSession = String(sessionId ?? "").trim();
  const nextSearch = new URLSearchParams();
  nextSearch.set("surface", "chat");
  if (normalizedLens) nextSearch.set("lens", normalizedLens);
  if (normalizedEntity) nextSearch.set("entity", normalizedEntity);
  if (normalizedSession) nextSearch.set("session", normalizedSession);
  return `/?${nextSearch.toString()}`;
}

export function buildChatShareUrl({
  origin,
  currentHref,
  resolvedEntitySlug,
  activeSessionId,
  entitySlug,
  startedQuery,
  lens,
}: ChatShareUrlArgs) {
  const normalizedEntity = String(entitySlug ?? "").trim() || null;
  const normalizedResolvedEntity = String(resolvedEntitySlug ?? "").trim() || null;
  const normalizedSession = String(activeSessionId ?? "").trim() || null;
  const normalizedQuery = String(startedQuery ?? "").trim() || null;
  const normalizedLens = String(lens ?? "").trim() || null;

  if (normalizedResolvedEntity) {
    return new URL(`${origin}${buildEntityPath(normalizedResolvedEntity)}`).toString();
  }

  if (normalizedSession) {
    return new URL(
      buildCockpitPath({
        surfaceId: "workspace",
        entity: normalizedEntity,
        extra: { session: normalizedSession },
      }),
      origin,
    ).toString();
  }

  const fallback = currentHref ? new URL(currentHref) : new URL(origin);
  const next = new URL(buildChatSessionPath({ entitySlug: normalizedEntity, lens: normalizedLens }), origin);
  if (normalizedQuery) next.searchParams.set("q", normalizedQuery);
  return normalizedQuery || normalizedLens || normalizedEntity ? next.toString() : fallback.toString();
}
