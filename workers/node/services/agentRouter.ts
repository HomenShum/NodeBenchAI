/**
 * Agent Router — Capability-based auto-routing for task dispatch
 *
 * When a task has no explicit targetAgentId, the router scores all connected
 * agents by capability overlap and current load, then dispatches to the best match.
 */

// ── Types ────────────────────────────────────────────────────────────────

interface AgentProfile {
  agentId: string;
  name: string;
  agentType: string;
  capabilities: string[];
  status: "healthy" | "blocked" | "waiting" | "drifting" | "ambiguous";
  currentTaskCount: number;
  lastHeartbeatAt: number;
}

interface TaskSpec {
  taskId: string;
  taskType: string;
  requestedCapabilities: string[];
  priority: "low" | "medium" | "high" | "critical";
}

interface RoutingResult {
  agentId: string;
  agentName: string;
  score: number;
  reason: string;
}

// ── Router ───────────────────────────────────────────────────────────────

const MAX_TASKS_PER_AGENT = 5;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Score an agent for a given task based on:
 * 1. Capability overlap (0-100 points)
 * 2. Current load penalty (-10 per active task)
 * 3. Health bonus (+20 for healthy, -30 for blocked)
 * 4. Freshness bonus (+10 if heartbeat < 1 min ago)
 */
function scoreAgent(agent: AgentProfile, task: TaskSpec): number {
  // Capability overlap
  const requested = new Set(task.requestedCapabilities);
  const matched = agent.capabilities.filter((c) => requested.has(c)).length;
  const capabilityScore = requested.size > 0
    ? (matched / requested.size) * 100
    : 50; // No specific capabilities = generic match

  // Load penalty
  const loadPenalty = agent.currentTaskCount * 10;

  // Health bonus
  const healthBonus = agent.status === "healthy" ? 20
    : agent.status === "waiting" ? 10
    : agent.status === "blocked" ? -30
    : agent.status === "drifting" ? -20
    : 0;

  // Freshness bonus
  const timeSinceHeartbeat = Date.now() - agent.lastHeartbeatAt;
  const freshnessBonus = timeSinceHeartbeat < 60_000 ? 10
    : timeSinceHeartbeat < 300_000 ? 0
    : -15;

  // Priority boost for high/critical tasks — prefer less loaded agents
  const priorityMultiplier = task.priority === "critical" ? 1.5
    : task.priority === "high" ? 1.2
    : 1.0;

  return Math.round((capabilityScore + healthBonus + freshnessBonus - loadPenalty) * priorityMultiplier);
}

/**
 * Route a task to the best available agent.
 * Returns null if no suitable agent is available.
 */
export function routeTask(agents: AgentProfile[], task: TaskSpec): RoutingResult | null {
  // P1: ERROR_BOUNDARY — validate inputs
  if (!Array.isArray(agents) || !task) return null;

  try {
    const now = Date.now();

    // Filter out stale and overloaded agents
    const eligible = agents.filter((a) => {
      if (!a || typeof a.status !== "string") return false;
      if (a.status === "blocked") return false;
      if (typeof a.currentTaskCount !== "number" || a.currentTaskCount >= MAX_TASKS_PER_AGENT) return false;
      if (typeof a.lastHeartbeatAt !== "number" || now - a.lastHeartbeatAt > STALE_THRESHOLD_MS) return false;
      return true;
    });

    if (eligible.length === 0) return null;

    // Score and sort
    const scored = eligible.map((a) => ({
      agent: a,
      score: scoreAgent(a, task),
    })).sort((a, b) => b.score - a.score);

    const best = scored[0];

    // Minimum score threshold — don't route to a terrible match
    if (best.score < 20) return null;

    return {
      agentId: best.agent.agentId,
      agentName: best.agent.name,
      score: best.score,
      reason: `Best match: ${best.agent.name} (score=${best.score}, capabilities=${best.agent.capabilities.length}, load=${best.agent.currentTaskCount})`,
    };
  } catch {
    return null; // Graceful degradation — no routing is safer than bad routing
  }
}

/**
 * Detect stale agents (no heartbeat for 5+ minutes).
 * Returns list of agent IDs that should be marked stale.
 */
export function detectStaleAgents(agents: AgentProfile[]): string[] {
  if (!Array.isArray(agents)) return [];
  try {
    const now = Date.now();
    return agents
      .filter((a) => a && a.status === "healthy" && typeof a.lastHeartbeatAt === "number" && now - a.lastHeartbeatAt > STALE_THRESHOLD_MS)
      .map((a) => a.agentId);
  } catch {
    return [];
  }
}
