/**
 * Multi-SDK Sub-Agent Adapter Registry
 *
 * Central registry for managing and discovering SDK adapters.
 * Provides lookup, registration, and SDK-aware routing.
 *
 * @see docs/architecture/2025-12-30-multi-sdk-subagent-architecture.md
 */

import type {
  SubAgentAdapter,
  AdapterInput,
  AdapterResult,
  SDKType,
  SDKConfig,
  HandoffContext,
} from "./types";
import { DEFAULT_SDK_CONFIG, detectSDKFromQuery, SubAgentError } from "./types";

/**
 * Adapter registry singleton
 */
const adapterRegistry = new Map<string, SubAgentAdapter<AdapterInput, unknown>>();

/**
 * SDK to adapter name mapping for quick lookup
 */
const sdkToAdapters = new Map<SDKType, Set<string>>();

/**
 * Current SDK configuration
 */
let currentConfig: SDKConfig = DEFAULT_SDK_CONFIG;

/**
 * Register an adapter in the registry
 */
export function registerAdapter(
  adapter: SubAgentAdapter<AdapterInput, unknown>
): void {
  adapterRegistry.set(adapter.name, adapter);

  // Track SDK mapping
  if (!sdkToAdapters.has(adapter.sdk)) {
    sdkToAdapters.set(adapter.sdk, new Set());
  }
  sdkToAdapters.get(adapter.sdk)!.add(adapter.name);

  console.log(`[AdapterRegistry] Registered adapter: ${adapter.name} (${adapter.sdk})`);
}

/**
 * Unregister an adapter from the registry
 */
export function unregisterAdapter(name: string): boolean {
  const adapter = adapterRegistry.get(name);
  if (!adapter) return false;

  adapterRegistry.delete(name);
  sdkToAdapters.get(adapter.sdk)?.delete(name);

  console.log(`[AdapterRegistry] Unregistered adapter: ${name}`);
  return true;
}

/**
 * Get an adapter by name
 */
export function getAdapter(
  name: string
): SubAgentAdapter<AdapterInput, unknown> | undefined {
  return adapterRegistry.get(name);
}

/**
 * Get all adapters for a specific SDK
 */
export function getAdaptersBySDK(
  sdk: SDKType
): SubAgentAdapter<AdapterInput, unknown>[] {
  const adapterNames = sdkToAdapters.get(sdk);
  if (!adapterNames) return [];

  return Array.from(adapterNames)
    .map((name) => adapterRegistry.get(name))
    .filter((a): a is SubAgentAdapter<AdapterInput, unknown> => a !== undefined);
}

/**
 * List all registered adapter names
 */
export function listAdapters(): string[] {
  return Array.from(adapterRegistry.keys());
}

/**
 * List all registered adapters with their SDK types
 */
export function listAdaptersWithSDK(): Array<{ name: string; sdk: SDKType; description: string }> {
  return Array.from(adapterRegistry.values()).map((a) => ({
    name: a.name,
    sdk: a.sdk,
    description: a.description,
  }));
}

/**
 * Update SDK configuration
 */
export function updateConfig(config: Partial<SDKConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * Get current SDK configuration
 */
export function getConfig(): SDKConfig {
  return currentConfig;
}

/**
 * Route a query to the best matching adapter based on content analysis
 */
export function routeQuery(
  query: string,
  preferredSDK?: SDKType
): SubAgentAdapter<AdapterInput, unknown> | undefined {
  // First check preferred SDK
  if (preferredSDK) {
    const adapters = getAdaptersBySDK(preferredSDK);
    if (adapters.length > 0) {
      return adapters[0];
    }
  }

  // Detect SDK from query keywords
  const detectedSDK = detectSDKFromQuery(query, currentConfig);
  if (detectedSDK) {
    const adapters = getAdaptersBySDK(detectedSDK);
    if (adapters.length > 0) {
      return adapters[0];
    }
  }

  // Fallback to first Convex adapter
  const convexAdapters = getAdaptersBySDK("convex");
  if (convexAdapters.length > 0) {
    return convexAdapters[0];
  }

  // Return any available adapter
  const allNames = listAdapters();
  return allNames.length > 0 ? getAdapter(allNames[0]) : undefined;
}

/**
 * Execute a task using the specified adapter
 */
export async function executeWithAdapter<T>(
  adapterName: string,
  input: AdapterInput
): Promise<AdapterResult<T>> {
  const adapter = getAdapter(adapterName);
  if (!adapter) {
    throw new SubAgentError(
      adapterName,
      "convex",
      new Error(`Adapter not found: ${adapterName}`),
      false
    );
  }

  const startTime = Date.now();

  try {
    // Lifecycle: onStart
    if (adapter.onStart) {
      await adapter.onStart(input);
    }

    // Execute
    const result = (await adapter.execute(input)) as AdapterResult<T>;

    // Lifecycle: onComplete
    if (adapter.onComplete) {
      await adapter.onComplete(result);
    }

    return result;
  } catch (error) {
    const wrappedError =
      error instanceof SubAgentError
        ? error
        : new SubAgentError(
            adapterName,
            adapter.sdk,
            error instanceof Error ? error : new Error(String(error)),
            true
          );

    // Lifecycle: onError
    if (adapter.onError) {
      await adapter.onError(wrappedError);
    }

    return {
      agentName: adapterName,
      sdk: adapter.sdk,
      status: "error",
      result: null as T,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute multiple adapters in parallel
 */
export async function executeParallel<T>(
  tasks: Array<{ adapterName: string; input: AdapterInput }>
): Promise<AdapterResult<T>[]> {
  const results = await Promise.allSettled(
    tasks.map((task) => executeWithAdapter<T>(task.adapterName, task.input))
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const task = tasks[index];
    const adapter = getAdapter(task.adapterName);

    return {
      agentName: task.adapterName,
      sdk: adapter?.sdk ?? "convex",
      status: "error" as const,
      result: null as T,
      executionTimeMs: 0,
    };
  });
}

/**
 * Perform a handoff between adapters
 */
export async function handoffToAdapter<T>(
  sourceAdapterName: string,
  targetAdapterName: string,
  context: HandoffContext
): Promise<AdapterResult<T>> {
  const sourceAdapter = getAdapter(sourceAdapterName);
  const targetAdapter = getAdapter(targetAdapterName);

  if (!sourceAdapter) {
    throw new SubAgentError(
      sourceAdapterName,
      "convex",
      new Error(`Source adapter not found: ${sourceAdapterName}`),
      false
    );
  }

  if (!targetAdapter) {
    throw new SubAgentError(
      targetAdapterName,
      "convex",
      new Error(`Target adapter not found: ${targetAdapterName}`),
      false
    );
  }

  if (!targetAdapter.supportsHandoff || !targetAdapter.handoff) {
    throw new SubAgentError(
      targetAdapterName,
      targetAdapter.sdk,
      new Error(`Adapter does not support handoffs: ${targetAdapterName}`),
      false
    );
  }

  // Enrich context with source info
  const enrichedContext: HandoffContext = {
    ...context,
    sourceAgent: sourceAdapterName,
    initiatedAt: Date.now(),
  };

  return (await targetAdapter.handoff(
    targetAdapterName,
    enrichedContext
  )) as AdapterResult<T>;
}

/**
 * Get registry statistics
 */
export function getRegistryStats(): {
  totalAdapters: number;
  adaptersBySDK: Record<SDKType, number>;
  handoffCapable: number;
} {
  const stats: { totalAdapters: number; adaptersBySDK: Record<SDKType, number>; handoffCapable: number } = {
    totalAdapters: adapterRegistry.size,
    adaptersBySDK: {} as Record<SDKType, number>,
    handoffCapable: 0,
  };

  for (const [sdk, names] of sdkToAdapters) {
    stats.adaptersBySDK[sdk] = names.size;
  }

  for (const adapter of adapterRegistry.values()) {
    if (adapter.supportsHandoff) {
      stats.handoffCapable++;
    }
  }

  return stats;
}

/**
 * Clear all registered adapters (for testing)
 */
export function clearRegistry(): void {
  adapterRegistry.clear();
  sdkToAdapters.clear();
  console.log("[AdapterRegistry] Registry cleared");
}
