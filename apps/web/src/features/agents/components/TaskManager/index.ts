/**
 * Task Manager Components
 * 
 * UI components for browsing and viewing agent task sessions
 * with full telemetry tracking (traces and spans).
 * 
 * Components:
 * - TaskManagerView: Main view with session list and filters
 * - TaskSessionCard: Summary card for a task session
 * - TaskSessionDetail: Detailed view with traces and spans
 * - TelemetrySpanTree: Hierarchical span visualization
 */

// Main view component
export { TaskManagerView } from './TaskManagerView';

// Session components
export { TaskSessionCard } from './TaskSessionCard';
export { TaskSessionDetail } from './TaskSessionDetail';

// Telemetry components
export { TelemetrySpanTree } from './TelemetrySpanTree';

// Types
export type {
  TaskSession,
  TaskSessionStatus,
  TaskSessionType,
  TaskVisibility,
  TaskTrace,
  TraceStatus,
  TaskSpan,
  SpanStatus,
  SpanType,
  TaskFilters,
  DateRange,
} from './types';

