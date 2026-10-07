/**
 * Data Access Agent Module
 * 
 * Exports agent actions and tool definitions for calendar/task operations
 */

// Agent actions
export { query, execute } from "./agent";

// Configuration
export { 
  DATA_ACCESS_AGENT_CONFIG,
  DATA_ACCESS_SYSTEM_PROMPT,
  listEventsSchema,
  createEventSchema,
  listTasksSchema,
  createTaskSchema,
  updateTaskSchema,
} from "./config";

// Tool definitions
export { calendarToolDefinitions, taskToolDefinitions } from "./tools";

// Tool executors (for use in coordinator)
export { executeListEvents, executeCreateEvent } from "./tools/calendarTools";
export { executeListTasks, executeCreateTask, executeUpdateTask } from "./tools/taskTools";
