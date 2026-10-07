// Shared agent planning and memory types for Convex tools and MCP wrappers

export type PlanStepStatus = "pending" | "in_progress" | "completed";

export type PlanStep = {
  step: string;
  status: PlanStepStatus;
  assignedAgent?: string;
  notes?: string;
};

export type PlanPayload = {
  source?: "mcp" | "convex";
  planId: string;
  goal?: string;
  steps?: PlanStep[];
  markdown?: string;
  message?: string;
};

export type MemoryEntry = {
  key: string;
  content: string;
  metadata?: Record<string, any>;
  createdAt?: number;
  updatedAt?: number;
};
