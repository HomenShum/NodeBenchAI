/**
 * Task Tracking Tools - 2025 Deep Agents Pattern
 * 
 * Based on:
 * - LangChain "Deep Agents" (July 2025) - Planning Tool pattern
 * - Anthropic "Effective harnesses for long-running agents" (Nov 2025) - Feature List pattern
 * 
 * These tools implement the Feature List pattern to prevent the "premature victory"
 * failure mode where agents declare tasks complete too early.
 */

export {
  initTaskTracker,
  updateTaskStatus,
  getTaskSummary,
  TaskStatus,
  type TaskStatusType,
  type TrackedTask,
  type TaskTrackerState,
} from "./taskTrackerTool";

