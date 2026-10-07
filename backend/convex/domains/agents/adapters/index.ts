/**
 * Multi-SDK Sub-Agent Adapters
 *
 * Central export for all adapter types, registry, and SDK-specific adapters.
 * Provides a unified interface for multi-SDK agent orchestration.
 *
 * @see docs/architecture/2025-12-30-multi-sdk-subagent-architecture.md
 */

"use node";

// Core types and configuration
export type {
  SDKType,
  AdapterMessage,
  HandoffContext,
  AdapterResult,
  AdapterInput,
  SubAgentAdapter,
  SDKConfig,
} from "./types";

export {
  DEFAULT_SDK_CONFIG,
  SubAgentError,
  detectSDKFromQuery,
} from "./types";

// Registry for adapter management
export {
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  getAdaptersBySDK,
  listAdapters,
  listAdaptersWithSDK,
  updateConfig,
  getConfig,
  routeQuery,
  executeWithAdapter,
  executeParallel,
  handoffToAdapter,
  getRegistryStats,
  clearRegistry,
} from "./registry";

// Convex Agent adapter
export {
  createConvexAgentAdapter,
  createConvexHandoffTool,
  createConvexParallelDelegationTool,
  convertConvexMessagesToAdapterFormat,
} from "./convex/convexAgentAdapter";
export type { ConvexAdapterConfig } from "./convex/convexAgentAdapter";

// OpenAI Agents SDK adapter
export {
  createOpenAIAgentsAdapter,
  createTriageAgentSystem,
  createManagerAgentSystem,
  createResearchAgent,
  createOpenAITool,
} from "./openai/openaiAgentsAdapter";
export type { OpenAIAgentsConfig } from "./openai/openaiAgentsAdapter";

// Anthropic reasoning adapter
export {
  createAnthropicReasoningAdapter,
  createDeepReasoningAgent,
  createCodeAnalysisAgent,
  runWithTools as runAnthropicWithTools,
  calculateThinkingBudget,
} from "./anthropic/anthropicReasoningAdapter";
export type {
  AnthropicAdapterConfig,
  AnthropicToolDefinition,
  ExtendedThinkingConfig,
} from "./anthropic/anthropicReasoningAdapter";

export {
  createGoogleInteractionsAdapter,
  getNodeBenchResearchMcpToolFromEnv,
  DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
  DEFAULT_GEMINI_DEEP_RESEARCH_MAX_AGENT,
  LEGACY_GEMINI_DEEP_RESEARCH_AGENT,
} from "./google/googleInteractionsAdapter";
export type {
  GoogleInteractionsAdapterConfig,
  GoogleInteractionAdapterPayload,
  GoogleInteractionExecutionOptions,
  GoogleInteractionTool,
  GoogleDeepResearchAgentConfig,
  GoogleAllowedToolsConfig,
} from "./google/googleInteractionsAdapter";

export {
  createVercelAiSdkAdapter,
} from "./vercel/vercelAiSdkAdapter";
export type { VercelAiSdkAdapterConfig, VercelAiSdkToolDefinition } from "./vercel/vercelAiSdkAdapter";

export {
  createLangGraphAdapter,
  createTemporalForecastGraphAdapter,
} from "./langgraph/langgraphAdapter";
export type { LangGraphAdapterConfig, TemporalForecastGraphResult } from "./langgraph/langgraphAdapter";

// Cross-SDK handoff bridge
export {
  generateHandoffId,
  serializeHandoffContext,
  deserializeHandoffContext,
  normalizeMessages,
  executeHandoff,
  findBestAdapterForTask,
  createHandoffContextFromResult,
  compressMessagesForHandoff,
  logHandoff,
} from "./handoffBridge";
export type {
  SerializedHandoffState,
  HandoffResult,
} from "./handoffBridge";

// Multi-SDK delegation tools (for coordinator agent)
export {
  delegateToSdkAdapter,
  autoRouteToSdk,
  listSdkAdapters,
  parallelSdkExecution,
  crossSdkHandoff,
  useExtendedThinking,
  createTriageFlow,
  multiSdkTools,
} from "./multiSdkDelegation";

export {
  ensureDefaultAdaptersRegistered,
} from "./registerDefaultAdapters";
