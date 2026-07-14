type AgentPlanSummarySource = {
  _id: unknown;
  userId: unknown;
  goal: string;
  steps: Array<{
    description: string;
    status: "pending" | "in_progress" | "completed";
  }>;
  createdAt: number;
  updatedAt: number;
};

/**
 * Keep public plan reads aligned with their strict Convex return validator.
 * Database documents also contain `_creationTime` and may contain initializer
 * metadata; returning the raw document makes authenticated subscriptions throw.
 */
export function projectAgentPlanSummary<T extends AgentPlanSummarySource>(plan: T) {
  return {
    _id: plan._id,
    userId: plan.userId,
    goal: plan.goal,
    steps: plan.steps,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
