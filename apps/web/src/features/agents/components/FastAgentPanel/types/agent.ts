// src/components/FastAgentPanel/types/agent.ts

export type AgentStatus = "running" | "complete" | "error";

export interface SpawnedAgent {
  id: string;
  name: string;
  status: AgentStatus;
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
}

