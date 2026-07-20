/**
 * Task Manager Domain
 *
 * Unified task session management with full telemetry tracking.
 * Implements OpenTelemetry-aligned Sessions → Traces → Spans hierarchy.
 *
 * Key Features:
 * - Public visibility for cron job monitoring (unauthenticated access)
 * - Real-time updates via Convex subscriptions
 * - Full telemetry: token usage, tool invocations, timing
 * - Date-based navigation for historical task browsing
 * - Integration with existing agentRuns, disclosureEvents
 *
 * Schema Tables:
 * - agentTaskSessions: Top-level task containers
 * - agentTaskTraces: OpenTelemetry-compatible traces
 * - agentTaskSpans: Individual operations within traces
 */

export * from "./queries";
export * from "./mutations";
export * from "./cronWrapper";
