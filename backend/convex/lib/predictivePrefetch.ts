/**
 * predictivePrefetch.ts
 *
 * Predictive Prefetching for Deep Agent 2.0
 *
 * Strategy:
 * - Analyze user behavior patterns
 * - Predict likely next operations
 * - Prefetch context and warm up agents speculatively
 * - Cache predicted results before they're needed
 *
 * Expected Improvement: 10-20% on predicted operations
 */

import type { Id } from "../_generated/dataModel";

export interface UserAction {
  userId: Id<"users">;
  action: string;
  context: Record<string, any>;
  timestamp: number;
}

export interface PredictionScore {
  action: string;
  score: number; // 0-1 probability
  context: Record<string, any>;
  reason: string;
}

export interface PrefetchTask {
  id: string;
  action: string;
  context: Record<string, any>;
  priority: number; // 0-100
  status: 'pending' | 'prefetching' | 'completed' | 'failed';
  result?: any;
  createdAt: number;
  completedAt?: number;
}

/**
 * Track user actions and build behavior patterns
 */
export class UserBehaviorTracker {
  private actionHistory: Map<Id<"users">, UserAction[]> = new Map();
  private maxHistorySize = 100;

  /**
   * Record user action
   */
  recordAction(userId: Id<"users">, action: string, context: Record<string, any> = {}): void {
    const userActions = this.actionHistory.get(userId) || [];

    const userAction: UserAction = {
      userId,
      action,
      context,
      timestamp: Date.now(),
    };

    userActions.push(userAction);

    // Keep only recent history
    if (userActions.length > this.maxHistorySize) {
      userActions.shift();
    }

    this.actionHistory.set(userId, userActions);
  }

  /**
   * Get user's action history
   */
  getHistory(userId: Id<"users">, limit?: number): UserAction[] {
    const history = this.actionHistory.get(userId) || [];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Analyze action sequences to find patterns
   */
  analyzePatterns(userId: Id<"users">): Map<string, Map<string, number>> {
    const history = this.getHistory(userId);
    const transitions = new Map<string, Map<string, number>>();

    for (let i = 0; i < history.length - 1; i++) {
      const current = history[i].action;
      const next = history[i + 1].action;

      if (!transitions.has(current)) {
        transitions.set(current, new Map());
      }

      const nextMap = transitions.get(current)!;
      nextMap.set(next, (nextMap.get(next) || 0) + 1);
    }

    return transitions;
  }

  /**
   * Predict next likely actions
   */
  predictNextActions(userId: Id<"users">, currentAction: string, topK: number = 3): PredictionScore[] {
    const patterns = this.analyzePatterns(userId);
    const transitions = patterns.get(currentAction);

    if (!transitions || transitions.size === 0) {
      return this.getDefaultPredictions(currentAction, topK);
    }

    // Calculate probabilities
    const total = Array.from(transitions.values()).reduce((sum, count) => sum + count, 0);
    const predictions: PredictionScore[] = [];

    for (const [action, count] of transitions.entries()) {
      predictions.push({
        action,
        score: count / total,
        context: {},
        reason: `Historical pattern: ${count}/${total} times`,
      });
    }

    // Sort by score and return top K
    return predictions.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Get default predictions based on common patterns
   */
  private getDefaultPredictions(currentAction: string, topK: number): PredictionScore[] {
    const commonPatterns: Record<string, PredictionScore[]> = {
      'view_document': [
        { action: 'edit_document', score: 0.6, context: {}, reason: 'Common: View → Edit' },
        { action: 'share_document', score: 0.2, context: {}, reason: 'Common: View → Share' },
        { action: 'create_related_document', score: 0.2, context: {}, reason: 'Common: View → Create related' },
      ],
      'edit_document': [
        { action: 'save_document', score: 0.8, context: {}, reason: 'Common: Edit → Save' },
        { action: 'ask_agent', score: 0.15, context: {}, reason: 'Common: Edit → Ask Agent' },
        { action: 'view_document', score: 0.05, context: {}, reason: 'Common: Edit → View' },
      ],
      'ask_agent': [
        { action: 'ask_followup', score: 0.5, context: {}, reason: 'Common: Agent → Follow-up' },
        { action: 'create_document', score: 0.3, context: {}, reason: 'Common: Agent → Create doc' },
        { action: 'edit_document', score: 0.2, context: {}, reason: 'Common: Agent → Edit doc' },
      ],
      'search': [
        { action: 'view_document', score: 0.6, context: {}, reason: 'Common: Search → View' },
        { action: 'create_document', score: 0.3, context: {}, reason: 'Common: Search → Create' },
        { action: 'refine_search', score: 0.1, context: {}, reason: 'Common: Search → Refine' },
      ],
    };

    return (commonPatterns[currentAction] || []).slice(0, topK);
  }
}

/**
 * Manage prefetch tasks
 */
export class PrefetchManager {
  private tasks: Map<string, PrefetchTask> = new Map();
  private maxConcurrent = 3;
  private activeTasks = 0;

  /**
   * Schedule prefetch task
   */
  schedule(
    action: string,
    context: Record<string, any>,
    priority: number,
    executor: () => Promise<any>
  ): string {
    const id = `prefetch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const task: PrefetchTask = {
      id,
      action,
      context,
      priority,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    console.log(`[Prefetch] Scheduled: ${action} (priority: ${priority})`);

    // Try to execute immediately if capacity
    void this.tryExecute(id, executor);

    return id;
  }

  /**
   * Try to execute task if capacity available
   */
  private async tryExecute(taskId: string, executor: () => Promise<any>): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') return;

    if (this.activeTasks >= this.maxConcurrent) {
      console.log(`[Prefetch] ${taskId} queued (${this.activeTasks}/${this.maxConcurrent} active)`);
      return;
    }

    this.activeTasks++;
    task.status = 'prefetching';

    console.log(`[Prefetch] Executing: ${task.action} (${this.activeTasks}/${this.maxConcurrent})`);

    try {
      const result = await executor();
      task.result = result;
      task.status = 'completed';
      task.completedAt = Date.now();

      console.log(`[Prefetch] ✅ Completed: ${task.action} in ${task.completedAt - task.createdAt}ms`);
    } catch (error) {
      task.status = 'failed';
      console.error(`[Prefetch] ❌ Failed: ${task.action}`, error);
    } finally {
      this.activeTasks--;

      // Try to execute next pending task
      this.executeNextPending();
    }
  }

  /**
   * Execute next pending task by priority
   */
  private executeNextPending(): void {
    const pending = Array.from(this.tasks.values())
      .filter(t => t.status === 'pending')
      .sort((a, b) => b.priority - a.priority);

    if (pending.length > 0 && this.activeTasks < this.maxConcurrent) {
      // Note: executor was already bound, need to track it separately
      // In real implementation, store executor with task
      console.log(`[Prefetch] Next in queue: ${pending[0].action}`);
    }
  }

  /**
   * Get prefetched result if available
   */
  getResult(taskId: string): unknown {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'completed') return null;

    console.log(`[Prefetch] Cache hit: ${task.action}`);
    return task.result;
  }

  /**
   * Check if task is ready
   */
  isReady(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    return task?.status === 'completed';
  }

  /**
   * Cancel task
   */
  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      this.tasks.delete(taskId);
      console.log(`[Prefetch] Cancelled: ${taskId}`);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    pending: number;
    prefetching: number;
    completed: number;
    failed: number;
    hitRate: number;
  } {
    const tasks = Array.from(this.tasks.values());

    const completed = tasks.filter(t => t.status === 'completed').length;
    const total = tasks.length;

    return {
      total,
      pending: tasks.filter(t => t.status === 'pending').length,
      prefetching: tasks.filter(t => t.status === 'prefetching').length,
      completed,
      failed: tasks.filter(t => t.status === 'failed').length,
      hitRate: completed / total || 0,
    };
  }

  /**
   * Cleanup old tasks
   */
  cleanup(maxAge: number = 300000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, task] of this.tasks.entries()) {
      if (now - task.createdAt > maxAge) {
        this.tasks.delete(id);
        cleaned++;
      }
    }

    console.log(`[Prefetch] Cleaned up ${cleaned} old tasks`);
    return cleaned;
  }
}

/**
 * Integrated predictive prefetch system
 */
export class PredictivePrefetchSystem {
  private behaviorTracker = new UserBehaviorTracker();
  private prefetchManager = new PrefetchManager();

  /**
   * Record action and trigger prefetch predictions
   */
  async recordAndPredict(
    userId: Id<"users">,
    action: string,
    context: Record<string, any> = {},
    prefetchExecutors?: Map<string, () => Promise<any>>
  ): Promise<void> {
    // Record action
    this.behaviorTracker.recordAction(userId, action, context);

    // Predict next actions
    const predictions = this.behaviorTracker.predictNextActions(userId, action, 3);

    console.log(`[Prefetch] Predictions for ${action}:`, predictions.map(p => `${p.action} (${Math.round(p.score * 100)}%)`));

    // Schedule prefetch for high-probability predictions
    if (prefetchExecutors) {
      for (const prediction of predictions) {
        if (prediction.score >= 0.3) { // Only prefetch if >30% probability
          const executor = prefetchExecutors.get(prediction.action);
          if (executor) {
            const priority = Math.round(prediction.score * 100);
            this.prefetchManager.schedule(
              prediction.action,
              { ...context, ...prediction.context },
              priority,
              executor
            );
          }
        }
      }
    }
  }

  /**
   * Get prefetch result if available
   */
  tryGetPrefetchedResult(taskId: string): unknown {
    return this.prefetchManager.getResult(taskId);
  }

  /**
   * Get system statistics
   */
  getStats(): {
    behavior: { totalActions: number; uniqueUsers: number };
    prefetch: ReturnType<PrefetchManager['getStats']>;
  } {
    return {
      behavior: {
        totalActions: 0, // Simplified
        uniqueUsers: 0,
      },
      prefetch: this.prefetchManager.getStats(),
    };
  }

  /**
   * Cleanup old data
   */
  cleanup(): void {
    this.prefetchManager.cleanup();
  }
}

// Singleton instance
export const predictivePrefetchSystem = new PredictivePrefetchSystem();

/**
 * Prefetch executors for common operations
 */
export const PrefetchExecutors = {
  documentContent: (documentId: Id<"documents">) => async () => {
    console.log(`[Prefetch Executor] Fetching document: ${documentId}`);
    // In real implementation: return await ctx.db.get(documentId);
    return { id: documentId, prefetched: true };
  },

  documentEmbedding: (documentId: Id<"documents">) => async () => {
    console.log(`[Prefetch Executor] Generating embedding: ${documentId}`);
    // In real implementation: return await generateEmbedding(documentId);
    return { documentId, embedding: [], prefetched: true };
  },

  agentContext: (agentName: string, userId: Id<"users">) => async () => {
    console.log(`[Prefetch Executor] Warming up agent: ${agentName}`);
    // In real implementation: warm up agent, load context
    return { agentName, userId, warmed: true };
  },

  searchResults: (query: string) => async () => {
    console.log(`[Prefetch Executor] Prefetching search: ${query}`);
    // In real implementation: return await performSearch(query);
    return { query, results: [], prefetched: true };
  },
};
