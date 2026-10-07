/**
 * langgraphClient.ts — JS client for the LangGraph social matching agent.
 *
 * Calls the Python FastAPI service (local or Cloud Run).
 * Used by NodeBench search routes and MCP tools.
 */

const LANGGRAPH_URL = process.env.LANGGRAPH_URL ?? "http://localhost:8090";
const TIMEOUT_MS = 10_000;

// ─── Types ───────────────────────────────────────────────────────

export interface MatchRequest {
  query: string;
  user_id?: string;
  name?: string;
  interests?: string[];
  preferences?: Record<string, unknown>;
  location?: string;
  bio?: string;
}

export interface MatchCandidate {
  candidate_id: string;
  name: string;
  score: number;
  reasoning: string;
  shared_interests: string[];
  compatibility_signals: string[];
}

export interface TraceStep {
  node: string;
  status: string;
  duration_ms: number;
  detail: string;
}

export interface MatchResponse {
  intent: string;
  intent_confidence: number;
  candidates: MatchCandidate[];
  selected_match: MatchCandidate | null;
  conversation_opener: string;
  outcome: Record<string, unknown> | null;
  learning: Record<string, unknown>;
  trace: TraceStep[];
  total_duration_ms: number;
}

export interface GraphInfo {
  nodes: string[];
  edges: Array<{ source: string; target: string; condition?: string }>;
  entry_point: string;
  description: string;
}

// ─── Client ──────────────────────────────────────────────────────

export async function runMatchGraph(req: MatchRequest): Promise<MatchResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${LANGGRAPH_URL}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "unknown error");
      throw new Error(`LangGraph service returned ${resp.status}: ${text}`);
    }

    return await resp.json() as MatchResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLangGraphHealth(): Promise<{ status: string; graph_nodes: number } | null> {
  try {
    const resp = await fetch(`${LANGGRAPH_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) return await resp.json();
    return null;
  } catch {
    return null;
  }
}

export async function getGraphInfo(): Promise<GraphInfo | null> {
  try {
    const resp = await fetch(`${LANGGRAPH_URL}/graph`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) return await resp.json();
    return null;
  } catch {
    return null;
  }
}
