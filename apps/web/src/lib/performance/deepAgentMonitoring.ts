/**
 * deepAgentMonitoring.ts
 *
 * Performance Monitoring for Deep Agent 2.0 Workflows
 *
 * Tracks and analyzes latency across:
 * - Search and context gathering
 * - Reasoning and task tracking
 * - Delegation chains
 * - Multi-step workflows
 *
 * Provides insights for optimization and user experience improvements.
 */

export interface PerformanceMetric {
  operationId: string;
  operationType: 'search' | 'context' | 'reasoning' | 'delegation' | 'execution' | 'workflow';
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'error' | 'timeout';
  metadata?: Record<string, any>;
  subOperations?: PerformanceMetric[];
}

export interface PerformanceThresholds {
  search: { warning: number; critical: number };
  context: { warning: number; critical: number };
  reasoning: { warning: number; critical: number };
  delegation: { warning: number; critical: number };
  execution: { warning: number; critical: number };
  workflow: { warning: number; critical: number };
}

// Default thresholds (in milliseconds)
const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  search: { warning: 15000, critical: 30000 }, // 15s warning, 30s critical
  context: { warning: 20000, critical: 40000 }, // 20s warning, 40s critical
  reasoning: { warning: 10000, critical: 20000 }, // 10s warning, 20s critical
  delegation: { warning: 30000, critical: 60000 }, // 30s warning, 60s critical
  execution: { warning: 40000, critical: 80000 }, // 40s warning, 80s critical
  workflow: { warning: 90000, critical: 180000 }, // 90s warning, 180s critical
};

class DeepAgentPerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private thresholds: PerformanceThresholds = DEFAULT_THRESHOLDS;
  private listeners: Array<(metric: PerformanceMetric) => void> = [];

  /**
   * Start tracking an operation
   */
  startOperation(
    operationId: string,
    operationType: PerformanceMetric['operationType'],
    metadata?: Record<string, any>
  ): void {
    const metric: PerformanceMetric = {
      operationId,
      operationType,
      startTime: Date.now(),
      status: 'running',
      metadata,
      subOperations: [],
    };

    this.metrics.set(operationId, metric);

    if (this.isDebugMode()) {
      console.log(`[DeepAgent Monitor] Started ${operationType}: ${operationId}`, metadata);
    }
  }

  /**
   * End tracking an operation
   */
  endOperation(
    operationId: string,
    status: 'completed' | 'error' | 'timeout' = 'completed',
    metadata?: Record<string, any>
  ): PerformanceMetric | null {
    const metric = this.metrics.get(operationId);
    if (!metric) {
      console.warn(`[DeepAgent Monitor] No metric found for operation: ${operationId}`);
      return null;
    }

    const endTime = Date.now();
    const duration = endTime - metric.startTime;

    const updatedMetric: PerformanceMetric = {
      ...metric,
      endTime,
      duration,
      status,
      metadata: { ...metric.metadata, ...metadata },
    };

    this.metrics.set(operationId, updatedMetric);

    // Check thresholds
    this.checkThresholds(updatedMetric);

    // Notify listeners
    this.notifyListeners(updatedMetric);

    if (this.isDebugMode()) {
      console.log(
        `[DeepAgent Monitor] Ended ${metric.operationType}: ${operationId} (${duration}ms, ${status})`,
        metadata
      );
    }

    return updatedMetric;
  }

  /**
   * Add a sub-operation to a parent operation
   */
  addSubOperation(parentId: string, subMetric: PerformanceMetric): void {
    const parent = this.metrics.get(parentId);
    if (!parent) {
      console.warn(`[DeepAgent Monitor] Parent operation not found: ${parentId}`);
      return;
    }

    parent.subOperations = parent.subOperations || [];
    parent.subOperations.push(subMetric);
    this.metrics.set(parentId, parent);
  }

  /**
   * Get performance statistics
   */
  getStats(operationType?: PerformanceMetric['operationType']): {
    total: number;
    completed: number;
    errors: number;
    timeouts: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    const relevantMetrics = Array.from(this.metrics.values()).filter(
      m =>
        m.status !== 'running' &&
        m.duration !== undefined &&
        (!operationType || m.operationType === operationType)
    );

    if (relevantMetrics.length === 0) {
      return {
        total: 0,
        completed: 0,
        errors: 0,
        timeouts: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const durations = relevantMetrics.map(m => m.duration!).sort((a, b) => a - b);
    const total = relevantMetrics.length;
    const completed = relevantMetrics.filter(m => m.status === 'completed').length;
    const errors = relevantMetrics.filter(m => m.status === 'error').length;
    const timeouts = relevantMetrics.filter(m => m.status === 'timeout').length;

    const sum = durations.reduce((acc, d) => acc + d, 0);
    const avgDuration = sum / total;

    const percentile = (p: number) => {
      const index = Math.ceil((p / 100) * durations.length) - 1;
      return durations[Math.max(0, index)];
    };

    return {
      total,
      completed,
      errors,
      timeouts,
      avgDuration: Math.round(avgDuration),
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
    };
  }

  /**
   * Get detailed report for an operation
   */
  getOperationReport(operationId: string): string {
    const metric = this.metrics.get(operationId);
    if (!metric) {
      return `No data found for operation: ${operationId}`;
    }

    const lines: string[] = [];
    lines.push(`Operation: ${metric.operationType} (${metric.operationId})`);
    lines.push(`Status: ${metric.status}`);
    lines.push(`Duration: ${metric.duration ? `${metric.duration}ms` : 'In progress'}`);

    if (metric.metadata) {
      lines.push(`Metadata: ${JSON.stringify(metric.metadata, null, 2)}`);
    }

    if (metric.subOperations && metric.subOperations.length > 0) {
      lines.push(`\nSub-operations (${metric.subOperations.length}):`);
      metric.subOperations.forEach((sub, i) => {
        lines.push(
          `  ${i + 1}. ${sub.operationType}: ${sub.duration}ms (${sub.status})`
        );
      });
    }

    return lines.join('\n');
  }

  /**
   * Listen for metric updates
   */
  onMetricUpdate(callback: (metric: PerformanceMetric) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Export metrics for analysis
   */
  export(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Update thresholds
   */
  setThresholds(thresholds: Partial<PerformanceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  private checkThresholds(metric: PerformanceMetric): void {
    if (!metric.duration) return;

    const threshold = this.thresholds[metric.operationType];
    if (!threshold) return;

    if (metric.duration >= threshold.critical) {
      console.warn(
        `[DeepAgent Monitor] 🔴 CRITICAL: ${metric.operationType} took ${metric.duration}ms (threshold: ${threshold.critical}ms)`,
        metric
      );
    } else if (metric.duration >= threshold.warning) {
      console.warn(
        `[DeepAgent Monitor] ⚠️  WARNING: ${metric.operationType} took ${metric.duration}ms (threshold: ${threshold.warning}ms)`,
        metric
      );
    }
  }

  private notifyListeners(metric: PerformanceMetric): void {
    this.listeners.forEach(listener => {
      try {
        listener(metric);
      } catch (error) {
        console.error('[DeepAgent Monitor] Listener error:', error);
      }
    });
  }

  private isDebugMode(): boolean {
    return typeof window !== 'undefined' && (window as any).__DEEP_AGENT_DEBUG__ === true;
  }
}

// Singleton instance
export const deepAgentMonitor = new DeepAgentPerformanceMonitor();

/**
 * React hook for monitoring Deep Agent operations
 */
export function useDeepAgentMonitoring() {
  const startOperation = (
    operationId: string,
    operationType: PerformanceMetric['operationType'],
    metadata?: Record<string, any>
  ) => {
    deepAgentMonitor.startOperation(operationId, operationType, metadata);
  };

  const endOperation = (
    operationId: string,
    status: 'completed' | 'error' | 'timeout' = 'completed',
    metadata?: Record<string, any>
  ) => {
    return deepAgentMonitor.endOperation(operationId, status, metadata);
  };

  const getStats = (operationType?: PerformanceMetric['operationType']) => {
    return deepAgentMonitor.getStats(operationType);
  };

  const getReport = (operationId: string) => {
    return deepAgentMonitor.getOperationReport(operationId);
  };

  return {
    startOperation,
    endOperation,
    getStats,
    getReport,
    monitor: deepAgentMonitor,
  };
}

/**
 * Wrapper function for timing Deep Agent operations
 */
export async function measureDeepAgentOperation<T>(
  operationId: string,
  operationType: PerformanceMetric['operationType'],
  operation: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  deepAgentMonitor.startOperation(operationId, operationType, metadata);

  try {
    const result = await operation();
    deepAgentMonitor.endOperation(operationId, 'completed', metadata);
    return result;
  } catch (error) {
    deepAgentMonitor.endOperation(operationId, 'error', {
      ...metadata,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Enable debug mode to see detailed console logs
 */
export function enableDeepAgentDebug(): void {
  if (typeof window !== 'undefined') {
    (window as any).__DEEP_AGENT_DEBUG__ = true;
    console.log('[DeepAgent Monitor] Debug mode enabled');
  }
}

/**
 * Disable debug mode
 */
export function disableDeepAgentDebug(): void {
  if (typeof window !== 'undefined') {
    (window as any).__DEEP_AGENT_DEBUG__ = false;
    console.log('[DeepAgent Monitor] Debug mode disabled');
  }
}
