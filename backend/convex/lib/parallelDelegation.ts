/**
 * parallelDelegation.ts
 *
 * Parallel Delegation Optimization for Deep Agent 2.0
 *
 * Problem: Sequential delegation takes Sum(agent_times)
 *   Agent A: 60s + Agent B: 60s = 120s total
 *
 * Solution: Parallel delegation takes Max(agent_times)
 *   Agent A: 60s || Agent B: 60s = 60s total
 *
 * Expected Improvement: 40-50% faster for multi-agent operations
 */

import type { Agent } from "@convex-dev/agent";

export interface DelegationTask<T = any> {
  agentName: string;
  agent: Agent;
  query: string;
  context?: any;
  metadata?: Record<string, any>;
  transform?: (result: any) => T;
}

export interface DelegationResult<T = any> {
  agentName: string;
  success: boolean;
  result?: T;
  error?: string;
  duration: number;
  metadata?: Record<string, any>;
}

/**
 * Execute multiple agent delegations in parallel
 *
 * @param tasks - Array of delegation tasks to execute
 * @param options - Execution options
 * @returns Array of results in the same order as tasks
 */
export async function delegateInParallel<T = any>(
  tasks: DelegationTask<T>[],
  options: {
    maxConcurrency?: number;
    timeout?: number;
    continueOnError?: boolean;
  } = {}
): Promise<DelegationResult<T>[]> {
  const {
    maxConcurrency = 5, // Max 5 parallel delegations
    timeout = 120000, // 2 minutes per delegation
    continueOnError = true, // Continue if one fails
  } = options;

  console.log(`[Parallel Delegation] Starting ${tasks.length} delegations (max concurrency: ${maxConcurrency})`);

  // Split into batches if needed
  const batches: DelegationTask<T>[][] = [];
  for (let i = 0; i < tasks.length; i += maxConcurrency) {
    batches.push(tasks.slice(i, i + maxConcurrency));
  }

  const allResults: DelegationResult<T>[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`[Parallel Delegation] Batch ${batchIndex + 1}/${batches.length}: ${batch.length} tasks`);

    // Execute batch in parallel
    const batchPromises = batch.map(async (task): Promise<DelegationResult<T>> => {
      const startTime = Date.now();

      try {
        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Delegation to ${task.agentName} timed out`)), timeout);
        });

        // Create delegation promise
        const delegationPromise = (async () => {
          const result = await task.agent.generateText(
            task.context || {},
            {},
            {
              prompt: task.query,
            }
          );

          return task.transform ? task.transform(result) : result;
        })();

        // Race between delegation and timeout
        const result = await Promise.race([delegationPromise, timeoutPromise]);
        const duration = Date.now() - startTime;

        console.log(`[Parallel Delegation] ✅ ${task.agentName} completed in ${duration}ms`);

        return {
          agentName: task.agentName,
          success: true,
          result: result as T,
          duration,
          metadata: task.metadata,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        console.error(`[Parallel Delegation] ❌ ${task.agentName} failed after ${duration}ms:`, errorMessage);

        if (!continueOnError) {
          throw error;
        }

        return {
          agentName: task.agentName,
          success: false,
          error: errorMessage,
          duration,
          metadata: task.metadata,
        };
      }
    });

    // Wait for all in batch
    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults);

    const batchDuration = Math.max(...batchResults.map(r => r.duration));
    console.log(`[Parallel Delegation] Batch ${batchIndex + 1} completed in ${batchDuration}ms (sequential would be ${batchResults.reduce((sum, r) => sum + r.duration, 0)}ms)`);
  }

  const totalDuration = allResults.reduce((max, r) => Math.max(max, r.duration), 0);
  const sequentialDuration = allResults.reduce((sum, r) => sum + r.duration, 0);
  const savings = sequentialDuration - totalDuration;
  const savingsPercent = Math.round((savings / sequentialDuration) * 100);

  console.log(`[Parallel Delegation] Complete: ${allResults.length} delegations`);
  console.log(`  Parallel time: ${totalDuration}ms`);
  console.log(`  Sequential time: ${sequentialDuration}ms`);
  console.log(`  Time saved: ${savings}ms (${savingsPercent}%)`);

  return allResults;
}

/**
 * Merge results from multiple agents into a cohesive response
 */
export function mergeAgentResults<T = any>(
  results: DelegationResult<T>[],
  options: {
    strategy?: 'concatenate' | 'synthesize' | 'prioritize';
    priorityOrder?: string[];
  } = {}
): {
  mergedResult: any;
  stats: {
    total: number;
    successful: number;
    failed: number;
    totalDuration: number;
    avgDuration: number;
  };
} {
  const { strategy = 'concatenate', priorityOrder = [] } = options;

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  let mergedResult: any;

  switch (strategy) {
    case 'prioritize':
      // Use first successful result from priority order
      for (const agentName of priorityOrder) {
        const result = successful.find(r => r.agentName === agentName);
        if (result?.result) {
          mergedResult = result.result;
          break;
        }
      }
      // Fallback to first successful
      if (!mergedResult) {
        mergedResult = successful[0]?.result;
      }
      break;

    case 'synthesize':
      // Combine all successful results into structured format
      mergedResult = {
        responses: successful.map(r => ({
          agent: r.agentName,
          result: r.result,
          duration: r.duration,
        })),
        summary: `Received ${successful.length} successful responses from agents: ${successful.map(r => r.agentName).join(', ')}`,
      };
      break;

    case 'concatenate':
    default:
      // Concatenate all successful results
      mergedResult = successful
        .map(r => {
          const result = r.result;
          if (result && typeof result === 'object' && 'text' in result) {
            return (result as { text: string }).text;
          }
          return typeof result === 'string' ? result : JSON.stringify(result);
        })
        .join('\n\n---\n\n');
      break;
  }

  return {
    mergedResult,
    stats: {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      totalDuration: Math.max(...results.map(r => r.duration), 0),
      avgDuration: Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length),
    },
  };
}

/**
 * Example usage for common multi-agent scenarios
 */
export const ParallelDelegationPatterns = {
  /**
   * Multi-source research: Query multiple specialist agents simultaneously
   */
  multiSourceResearch: async (
    agents: { name: string; agent: Agent }[],
    query: string,
    context: any
  ) => {
    const tasks: DelegationTask[] = agents.map(({ name, agent }) => ({
      agentName: name,
      agent,
      query,
      context,
    }));

    const results = await delegateInParallel(tasks, {
      maxConcurrency: 5,
      timeout: 90000, // 90s per agent
      continueOnError: true,
    });

    return mergeAgentResults(results, {
      strategy: 'synthesize',
    });
  },

  /**
   * Fact verification: Check claim across multiple sources
   */
  factVerification: async (
    agents: { name: string; agent: Agent }[],
    claim: string,
    context: any
  ) => {
    const tasks: DelegationTask[] = agents.map(({ name, agent }) => ({
      agentName: name,
      agent,
      query: `Verify this claim and provide supporting evidence: "${claim}"`,
      context,
      transform: (result) => ({
        source: name,
        verified: result.text?.includes('true') || result.text?.includes('confirmed'),
        evidence: result.text,
      }),
    }));

    const results = await delegateInParallel(tasks, {
      maxConcurrency: 3,
      timeout: 60000,
      continueOnError: true,
    });

    return mergeAgentResults(results, {
      strategy: 'synthesize',
    });
  },

  /**
   * Multi-perspective analysis: Get different viewpoints
   */
  multiPerspectiveAnalysis: async (
    agents: { name: string; agent: Agent; perspective: string }[],
    topic: string,
    context: any
  ) => {
    const tasks: DelegationTask[] = agents.map(({ name, agent, perspective }) => ({
      agentName: name,
      agent,
      query: `Analyze "${topic}" from the perspective of: ${perspective}`,
      context,
      metadata: { perspective },
    }));

    const results = await delegateInParallel(tasks);

    return mergeAgentResults(results, {
      strategy: 'synthesize',
    });
  },
};
