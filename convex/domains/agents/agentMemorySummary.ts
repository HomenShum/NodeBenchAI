type AgentMemorySummarySource = {
  _id: unknown;
  userId: unknown;
  key: string;
  content: string;
  metadata?: unknown;
  createdAt: number;
  updatedAt: number;
};

/** Project stored memory documents onto the strict public query contract. */
export function projectAgentMemorySummary<T extends AgentMemorySummarySource>(memory: T) {
  const summary = {
    _id: memory._id,
    userId: memory.userId,
    key: memory.key,
    content: memory.content,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };

  return memory.metadata === undefined
    ? summary
    : { ...summary, metadata: memory.metadata };
}

type AgentEpisodicSummarySource = {
  _id: unknown;
  runId: string;
  userId: unknown;
  ts: number;
  tags?: string[];
  data: unknown;
};

/** Keep episodic reads from leaking database-only `_creationTime`. */
export function projectAgentEpisodicSummary<T extends AgentEpisodicSummarySource>(entry: T) {
  const summary = {
    _id: entry._id,
    runId: entry.runId,
    userId: entry.userId,
    ts: entry.ts,
    data: entry.data,
  };

  return entry.tags === undefined
    ? summary
    : { ...summary, tags: entry.tags };
}
