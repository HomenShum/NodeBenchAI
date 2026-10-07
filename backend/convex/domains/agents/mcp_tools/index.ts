/**
 * MCP Tools - 2025 Deep Agents Architecture
 *
 * This directory contains tools and subagents organized following the 2025
 * best practices from LangChain and Anthropic research.
 *
 * Directory Structure:
 * - models/: Centralized model resolver (7 approved models only)
 * - context/: Context initialization tools (Initializer Agent pattern)
 * - tracking/: Task tracking tools (Feature List pattern)
 *
 * 2025 Model Consolidation (7 models only):
 * - OpenAI: GPT-5.2 (Dec 11, 2025)
 * - Anthropic: Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 (Sep-Nov 2025)
 * - Google: Gemini 3 Pro Preview, Gemini 2.5 Flash/Pro (June-Nov 2025)
 *
 * Key Patterns Implemented:
 * 1. Initializer Agent - Prevents "wasted time" failure mode
 * 2. Feature List - Prevents "premature victory" failure mode
 * 3. Centralized Model Resolver - Type-safe model routing with logging
 */

// Model Resolver (2025 Consolidated - 7 models only)
export {
  getLanguageModel,
  getLanguageModelSafe,
  getLanguageModelOrThrow,
  resolveModelAlias,
  MODEL_SPECS,
  LEGACY_ALIASES,
  DEFAULT_MODEL,
  APPROVED_MODELS,
  type ApprovedModel,
  type Provider,
  type ModelSpec,
  type ModelResolutionEvent,
} from "./models";

// Context Tools
export {
  contextInitializerTool,
  type SessionContext,
} from "./context";

// Task Tracking Tools
export {
  initTaskTracker,
  updateTaskStatus,
  getTaskSummary,
  TaskStatus,
  type TaskStatusType,
  type TrackedTask,
  type TaskTrackerState,
} from "./tracking";

