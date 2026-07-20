export type NodeBenchGraphNodeType =
  | "company"
  | "org"
  | "person"
  | "event"
  | "product"
  | "topic"
  | "claim"
  | "source"
  | "follow_up"
  | "chat_thread"
  | "notebook_section"
  | "report"
  | "entity";

export type NodeBenchGraphEdgeType =
  | "MET_AT"
  | "WORKS_AT"
  | "FOUNDED"
  | "BUILDS"
  | "MENTIONED_IN"
  | "CLAIMS"
  | "SUPPORTED_BY"
  | "FOLLOW_UP_WITH"
  | "DISCUSSED_IN_THREAD"
  | "WRITTEN_IN_NOTEBOOK"
  | "RELATED_TO";

export type NodeBenchGraphNode = {
  id: string;
  label: string;
  type: NodeBenchGraphNodeType | string;
  privacyScope?: string;
  claimStatus?: string;
  uri?: string;
  confidence?: number;
};

export type NodeBenchGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: NodeBenchGraphEdgeType | string;
};

export type NodeBenchGraphCluster = {
  id: string;
  label: string;
  nodeIds: string[];
  type?: string;
};

export type NodeBenchGraphStats = {
  nodeCount?: number;
  edgeCount?: number;
  cacheHitRate?: number;
  searchesAvoided?: number;
  lastRefreshedAt?: number;
};

export type NodeBenchGraphBundle = {
  rootUri?: string;
  nodes?: NodeBenchGraphNode[];
  edges?: NodeBenchGraphEdge[];
  clusters?: NodeBenchGraphCluster[];
  stats?: NodeBenchGraphStats;
};
