export type TopologyViewMode = "density" | "pca" | "centroid";

export interface TopologyInputNode {
  id: string;
  label: string;
  graphType?: string;
  provenance?: string;
  weight?: number;
  attentionScore?: number;
  staleHours?: number;
  sources?: string;
  verified?: string;
  coverage?: string[];
  signals?: string[];
}

export interface TopologyInputLink {
  source: string;
  target: string;
  type?: string;
  strength?: number;
  confidence?: number;
  sourceRefs?: number;
  claimRefs?: number;
}

export interface TopologyNodeProjection {
  id: string;
  densityScore: number;
  attentionScore: number;
  degree: number;
  pc1: number;
  pc2: number;
  centroidDistance: number;
  outlierScore: number;
  mapperClusterIds: string[];
  x: number;
  y: number;
}

export interface TopologyMapperCluster {
  id: string;
  label: string;
  memberIds: string[];
  x: number;
  y: number;
  densityScore: number;
  attentionScore: number;
}

export interface TopologyPcaAxis {
  label: string;
  weight: number;
}

export interface TopologySnapshot {
  view: TopologyViewMode;
  nodes: TopologyNodeProjection[];
  nodesById: Record<string, TopologyNodeProjection>;
  mapperClusters: TopologyMapperCluster[];
  mapperEdges: Array<{ source: string; target: string; sharedMembers: number }>;
  summary: {
    nodeCount: number;
    edgeCount: number;
    hotNodeId: string | null;
    centroidNodeId: string | null;
    outlierNodeId: string | null;
    clusterCount: number;
    viewRationale: string;
  };
  pcaAxes: {
    pc1: TopologyPcaAxis[];
    pc2: TopologyPcaAxis[];
  };
}

const FEATURE_LABELS = [
  "attention",
  "degree",
  "weight",
  "sources",
  "verified",
  "freshness",
  "signals",
  "causal",
] as const;

type FeatureLabel = typeof FEATURE_LABELS[number];

interface FeatureRow {
  node: TopologyInputNode;
  raw: number[];
  vector: number[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sourceCount(value?: string): number {
  return Number(value?.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
}

function verifiedScore(value?: string): number {
  const text = (value ?? "").toLowerCase();
  const pct = Number(text.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? NaN);
  if (Number.isFinite(pct)) return pct / 100;
  if (/verified|passed|ready/.test(text)) return 0.86;
  if (/review|pending|unknown/.test(text)) return 0.46;
  if (/failing|blocked|stale/.test(text)) return 0.22;
  return 0.58;
}

function normalizedColumns(rows: number[][]): number[][] {
  if (rows.length === 0) return [];
  const width = rows[0]?.length ?? 0;
  const mins = Array.from({ length: width }, (_, column) => Math.min(...rows.map((row) => row[column] ?? 0)));
  const maxs = Array.from({ length: width }, (_, column) => Math.max(...rows.map((row) => row[column] ?? 0)));
  return rows.map((row) => row.map((value, column) => {
    const range = maxs[column] - mins[column];
    if (range <= 1e-9) return 0.5;
    return (value - mins[column]) / range;
  }));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(dot(vector, vector));
  if (magnitude <= 1e-9) return vector.map(() => 0);
  return vector.map((value) => value / magnitude);
}

function covarianceMatrix(rows: number[][]): number[][] {
  const width = rows[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) =>
    rows.reduce((sum, row) => sum + (row[column] ?? 0), 0) / Math.max(1, rows.length),
  );
  return Array.from({ length: width }, (_, rowIndex) =>
    Array.from({ length: width }, (_, columnIndex) => {
      const variance = rows.reduce((sum, row) =>
        sum + ((row[rowIndex] ?? 0) - means[rowIndex]) * ((row[columnIndex] ?? 0) - means[columnIndex]),
      0);
      return variance / Math.max(1, rows.length - 1);
    }),
  );
}

function matVec(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

function powerIteration(matrix: number[][], seedShift = 0): { vector: number[]; value: number } {
  const width = matrix.length;
  let vector = normalizeVector(Array.from({ length: width }, (_, index) => 1 + ((index + seedShift) % 3) * 0.17));
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const next = normalizeVector(matVec(matrix, vector));
    if (next.every((value) => Math.abs(value) < 1e-9)) break;
    vector = next;
  }
  const value = dot(vector, matVec(matrix, vector));
  return { vector, value };
}

function deflate(matrix: number[][], eigen: { vector: number[]; value: number }): number[][] {
  return matrix.map((row, rowIndex) =>
    row.map((value, columnIndex) => value - eigen.value * eigen.vector[rowIndex] * eigen.vector[columnIndex]),
  );
}

function pca(rows: FeatureRow[]): {
  pc1: number[];
  pc2: number[];
  loadings1: number[];
  loadings2: number[];
} {
  if (rows.length <= 1) {
    return {
      pc1: rows.map(() => 0),
      pc2: rows.map(() => 0),
      loadings1: FEATURE_LABELS.map((_, index) => index === 0 ? 1 : 0),
      loadings2: FEATURE_LABELS.map((_, index) => index === 1 ? 1 : 0),
    };
  }
  const matrix = covarianceMatrix(rows.map((row) => row.vector));
  const first = powerIteration(matrix, 0);
  const second = powerIteration(deflate(matrix, first), 1);
  return {
    pc1: rows.map((row) => dot(row.vector, first.vector)),
    pc2: rows.map((row) => dot(row.vector, second.vector)),
    loadings1: first.vector,
    loadings2: second.vector,
  };
}

function scale(values: number[]): number[] {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min;
  if (range <= 1e-9) return values.map(() => 0.5);
  return values.map((value) => (value - min) / range);
}

function topLoadings(loadings: number[]): TopologyPcaAxis[] {
  return loadings
    .map((weight, index) => ({ label: FEATURE_LABELS[index] as FeatureLabel, weight }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3);
}

function edgeEndpoint(value: string | { id?: string } | undefined): string {
  if (typeof value === "object" && value?.id) return value.id;
  return String(value ?? "");
}

function buildFeatureRows(nodes: TopologyInputNode[], links: TopologyInputLink[]): FeatureRow[] {
  const degree = new Map<string, number>();
  const causal = new Map<string, number>();
  links.forEach((link) => {
    const source = edgeEndpoint(link.source);
    const target = edgeEndpoint(link.target);
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    if (link.type === "causes" || link.type === "correlates_with") {
      const score = (link.strength ?? 0.5) + (link.confidence ?? 0.5);
      causal.set(source, (causal.get(source) ?? 0) + score);
      causal.set(target, (causal.get(target) ?? 0) + score);
    }
  });
  const rawRows = nodes.map((node) => [
    clamp01((node.attentionScore ?? 0) / 100),
    degree.get(node.id) ?? 0,
    Math.max(1, node.weight ?? 1),
    sourceCount(node.sources),
    verifiedScore(node.verified),
    1 / (1 + Math.max(0, node.staleHours ?? 0) / 24),
    (node.signals?.length ?? 0) + (node.coverage?.length ?? 0) * 0.5,
    causal.get(node.id) ?? 0,
  ]);
  const normalized = normalizedColumns(rawRows);
  return nodes.map((node, index) => ({ node, raw: rawRows[index] ?? [], vector: normalized[index] ?? [] }));
}

function buildMapperClusters(
  projections: Omit<TopologyNodeProjection, "mapperClusterIds">[],
  links: TopologyInputLink[],
): { clusters: TopologyMapperCluster[]; edges: Array<{ source: string; target: string; sharedMembers: number }>; nodeClusters: Record<string, string[]> } {
  const bins = 4;
  const overlap = 0.12;
  const adjacency = new Map<string, Set<string>>();
  links.forEach((link) => {
    const source = edgeEndpoint(link.source);
    const target = edgeEndpoint(link.target);
    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  });

  const clusters: TopologyMapperCluster[] = [];
  const nodeClusters: Record<string, string[]> = {};
  const binSize = 1 / bins;

  for (let bx = 0; bx < bins; bx += 1) {
    for (let by = 0; by < bins; by += 1) {
      const minX = bx * binSize - overlap;
      const maxX = (bx + 1) * binSize + overlap;
      const minY = by * binSize - overlap;
      const maxY = (by + 1) * binSize + overlap;
      const members = projections.filter((node) => node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY);
      const unvisited = new Set(members.map((node) => node.id));
      while (unvisited.size > 0) {
        const [start] = unvisited;
        if (!start) break;
        const queue = [start];
        const component = new Set<string>();
        unvisited.delete(start);
        while (queue.length > 0) {
          const current = queue.shift();
          if (!current) continue;
          component.add(current);
          adjacency.get(current)?.forEach((next) => {
            if (unvisited.has(next)) {
              unvisited.delete(next);
              queue.push(next);
            }
          });
        }
        const memberIds = [...component];
        if (memberIds.length === 0) continue;
        const memberNodes = memberIds
          .map((id) => projections.find((node) => node.id === id))
          .filter((node): node is Omit<TopologyNodeProjection, "mapperClusterIds"> => Boolean(node));
        const cluster: TopologyMapperCluster = {
          id: `mapper:${bx}:${by}:${clusters.length}`,
          label: `Mapper ${bx + 1}.${by + 1}`,
          memberIds,
          x: memberNodes.reduce((sum, node) => sum + node.x, 0) / memberNodes.length,
          y: memberNodes.reduce((sum, node) => sum + node.y, 0) / memberNodes.length,
          densityScore: clamp100(memberNodes.reduce((sum, node) => sum + node.densityScore, 0) / memberNodes.length),
          attentionScore: clamp100(memberNodes.reduce((sum, node) => sum + node.attentionScore, 0) / memberNodes.length),
        };
        clusters.push(cluster);
        memberIds.forEach((id) => {
          nodeClusters[id] = [...(nodeClusters[id] ?? []), cluster.id];
        });
      }
    }
  }

  const edges: Array<{ source: string; target: string; sharedMembers: number }> = [];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const a = clusters[i];
      const b = clusters[j];
      if (!a || !b) continue;
      const bMembers = new Set(b.memberIds);
      const sharedMembers = a.memberIds.filter((id) => bMembers.has(id)).length;
      if (sharedMembers > 0) edges.push({ source: a.id, target: b.id, sharedMembers });
    }
  }

  return { clusters, edges, nodeClusters };
}

export function buildTopologySnapshot(
  nodes: TopologyInputNode[],
  links: TopologyInputLink[],
  view: TopologyViewMode,
): TopologySnapshot {
  const rows = buildFeatureRows(nodes, links);
  const { pc1, pc2, loadings1, loadings2 } = pca(rows);
  const pc1Scaled = scale(pc1);
  const pc2Scaled = scale(pc2);
  const centroid = rows[0]?.vector.map((_, column) =>
    rows.reduce((sum, row) => sum + (row.vector[column] ?? 0), 0) / Math.max(1, rows.length),
  ) ?? [];
  const distances = rows.map((row) => Math.sqrt(row.vector.reduce((sum, value, column) => sum + Math.pow(value - (centroid[column] ?? 0), 2), 0)));
  const distanceScaled = scale(distances);
  const densityValues = rows.map((row) => {
    const attention = row.vector[0] ?? 0;
    const degree = row.vector[1] ?? 0;
    const sources = row.vector[3] ?? 0;
    const verified = row.vector[4] ?? 0;
    const freshness = row.vector[5] ?? 0;
    const causalSignal = row.vector[7] ?? 0;
    return clamp01(attention * 0.34 + degree * 0.22 + sources * 0.16 + verified * 0.1 + freshness * 0.08 + causalSignal * 0.1);
  });
  const densityScaled = scale(densityValues);

  const withoutClusters = rows.map((row, index): Omit<TopologyNodeProjection, "mapperClusterIds"> => {
    const density = densityScaled[index] ?? 0.5;
    const distance = distanceScaled[index] ?? 0;
    const angle = Math.atan2((pc2Scaled[index] ?? 0.5) - 0.5, (pc1Scaled[index] ?? 0.5) - 0.5);
    const radius = 0.08 + distance * 0.42;
    const centroidX = 0.5 + Math.cos(angle) * radius;
    const centroidY = 0.5 + Math.sin(angle) * radius;
    const coordinates = view === "density"
      ? { x: pc1Scaled[index] ?? 0.5, y: 1 - density }
      : view === "pca"
        ? { x: pc1Scaled[index] ?? 0.5, y: pc2Scaled[index] ?? 0.5 }
        : { x: clamp01(centroidX), y: clamp01(centroidY) };
    return {
      id: row.node.id,
      densityScore: clamp100(density * 100),
      attentionScore: clamp100(row.raw[0] * 100),
      degree: Math.round(row.raw[1] ?? 0),
      pc1: Number((pc1Scaled[index] ?? 0.5).toFixed(4)),
      pc2: Number((pc2Scaled[index] ?? 0.5).toFixed(4)),
      centroidDistance: Number(distance.toFixed(4)),
      outlierScore: clamp100(distance * 100),
      x: Number(coordinates.x.toFixed(4)),
      y: Number(coordinates.y.toFixed(4)),
    };
  });

  const mapper = buildMapperClusters(withoutClusters, links);
  const projected = withoutClusters.map((node) => ({
    ...node,
    mapperClusterIds: mapper.nodeClusters[node.id] ?? [],
  }));
  const nodesById = Object.fromEntries(projected.map((node) => [node.id, node]));
  const hotNode = [...projected].sort((a, b) => b.densityScore - a.densityScore)[0] ?? null;
  const centroidNode = [...projected].sort((a, b) => a.centroidDistance - b.centroidDistance)[0] ?? null;
  const outlierNode = [...projected].sort((a, b) => b.centroidDistance - a.centroidDistance)[0] ?? null;
  const viewRationale =
    view === "density"
      ? "Density ranks where human and agent attention repeatedly accumulates."
      : view === "pca"
        ? "PCA exposes the dominant axes separating reports, entities, sources, and artifacts."
        : "Centroid distance separates typical coverage-book nodes from edge-case outliers.";

  return {
    view,
    nodes: projected,
    nodesById,
    mapperClusters: mapper.clusters,
    mapperEdges: mapper.edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: links.length,
      hotNodeId: hotNode?.id ?? null,
      centroidNodeId: centroidNode?.id ?? null,
      outlierNodeId: outlierNode?.id ?? null,
      clusterCount: mapper.clusters.length,
      viewRationale,
    },
    pcaAxes: {
      pc1: topLoadings(loadings1),
      pc2: topLoadings(loadings2),
    },
  };
}
