import { classifyForecastGate } from "../temporal/forecastGatePolicy";
import type { ForecastGateDecision } from "../temporal/forecastGatePolicy";

type SearchSessionLike = {
  _id?: unknown;
  lens?: string;
  result?: unknown;
  completedAt?: number;
  startedAt?: number;
};

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function resultRecord(session: SearchSessionLike): Record<string, unknown> | null {
  return session.result && typeof session.result === "object" && !Array.isArray(session.result)
    ? (session.result as Record<string, unknown>)
    : null;
}

function sessionEntityName(session: SearchSessionLike): string {
  const result = resultRecord(session);
  return String(result?.entityName ?? result?.canonicalEntity ?? "");
}

function sessionConfidence(session: SearchSessionLike): number | null {
  const result = resultRecord(session);
  const confidence = Number(result?.confidence);
  return Number.isFinite(confidence) ? confidence : null;
}

export function buildSearchForecastGate(args: {
  recentSessions: SearchSessionLike[];
  entityName: string;
  lens: string;
  currentConfidence: number;
  currentSessionId?: unknown;
  packetId?: string;
}): ForecastGateDecision {
  const targetEntity = normalized(args.entityName);
  const targetLens = normalized(args.lens);
  const currentSessionKey = String(args.currentSessionId ?? "");

  const historical = args.recentSessions
    .filter((session) => String(session._id ?? "") !== currentSessionKey)
    .filter((session) => normalized(session.lens) === targetLens)
    .filter((session) => normalized(sessionEntityName(session)) === targetEntity)
    .map((session) => ({
      value: sessionConfidence(session),
      at: session.completedAt ?? session.startedAt ?? 0,
    }))
    .filter((point): point is { value: number; at: number } => point.value !== null)
    .sort((a, b) => a.at - b.at)
    .slice(-12);

  const values = [...historical.map((point) => point.value), args.currentConfidence];
  const delegateEligible = values.length >= 8 && args.packetId !== undefined;

  return classifyForecastGate({
    streamKey: `search_confidence:${targetLens}:${targetEntity || "unknown"}`,
    values,
    modelUsed: values.length >= 3 ? "search_session_confidence_stream" : "insufficient_data",
    delegateEligible,
    evidenceRefs: [
      `entity:${args.entityName}`,
      `lens:${args.lens}`,
      ...(args.packetId ? [`packet:${args.packetId}`] : []),
    ],
  });
}
