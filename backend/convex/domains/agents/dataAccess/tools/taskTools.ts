/**
 * Task Tools for Data Access Agent
 */

import { api } from "../../../../_generated/api";
import type { ActionCtx } from "../../../../_generated/server";
import { 
  listTasksSchema, 
  createTaskSchema, 
  updateTaskSchema,
  type ListTasksInput, 
  type CreateTaskInput,
  type UpdateTaskInput 
} from "../config";

/**
 * List tasks tool execution
 */
export async function executeListTasks(
  ctx: ActionCtx,
  args: ListTasksInput
): Promise<{
  success: boolean;
  message: string;
  tasks: Array<{
    index: number;
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
  }>;
}> {
  console.log(`[taskTools.listTasks] Querying tasks - filter: ${args.filter}, status: ${args.status}`);
  
  let tasks: any[] = [];
  
  try {
    if (args.filter === "today") {
      tasks = await ctx.runQuery(api.domains.tasks.userEvents.listUserEventsDueToday, {});
    } else if (args.filter === "week") {
      tasks = await ctx.runQuery(api.domains.tasks.userEvents.listUserEventsDueThisWeek, {});
    } else {
      tasks = await ctx.runQuery(api.domains.tasks.userEvents.listUserEventsByUpdatedDesc, { limit: 50 });
    }
  } catch (err) {
    console.error(`[taskTools.listTasks] Error querying tasks:`, err);
    return { success: false, message: "Failed to query tasks", tasks: [] };
  }

  // Apply status filter
  if (args.status !== "all") {
    tasks = tasks.filter((task: any) => task.status === args.status);
  }

  if (tasks.length === 0) {
    return {
      success: true,
      message: `No tasks found for filter: ${args.filter}, status: ${args.status}`,
      tasks: []
    };
  }

  const formattedTasks = tasks.slice(0, 20).map((task: any, idx: number) => ({
    index: idx + 1,
    id: task._id,
    title: task.title,
    status: task.status || "todo",
    priority: task.priority || "medium",
    dueDate: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null,
  }));

  console.log(`[taskTools.listTasks] Found ${tasks.length} tasks`);
  return {
    success: true,
    message: `Found ${tasks.length} task(s).`,
    tasks: formattedTasks,
  };
}

/**
 * Create task tool execution
 */
export async function executeCreateTask(
  ctx: ActionCtx,
  args: CreateTaskInput
): Promise<{
  success: boolean;
  message: string;
  taskId?: string;
}> {
  console.log(`[taskTools.createTask] Creating task: ${args.title}`);
  
  try {
    const taskId = await ctx.runMutation(api.domains.tasks.userEvents.createUserEvent, {
      title: args.title,
      description: args.description,
      dueDate: args.dueDate ? new Date(args.dueDate).getTime() : undefined,
      priority: args.priority,
      status: "todo",
    });

    return {
      success: true,
      message: `Task "${args.title}" created successfully.`,
      taskId: taskId as string,
    };
  } catch (error: any) {
    console.error(`[taskTools.createTask] Error:`, error);
    return {
      success: false,
      message: `Failed to create task: ${error.message}`,
    };
  }
}

/**
 * Update task tool execution
 */
export async function executeUpdateTask(
  ctx: ActionCtx,
  args: UpdateTaskInput
): Promise<{
  success: boolean;
  message: string;
}> {
  console.log(`[taskTools.updateTask] Updating task: ${args.taskId}`);
  
  try {
    await ctx.runMutation(api.domains.tasks.userEvents.updateUserEvent, {
      userEventId: args.taskId as any,
      status: args.status,
      title: args.title,
      dueDate: args.dueDate ? new Date(args.dueDate).getTime() : undefined,
    });

    return {
      success: true,
      message: `Task updated successfully.`,
    };
  } catch (error: any) {
    console.error(`[taskTools.updateTask] Error:`, error);
    return {
      success: false,
      message: `Failed to update task: ${error.message}`,
    };
  }
}

// Tool definitions for AI SDK
export const taskToolDefinitions = {
  listTasks: {
    description: "List tasks/todos with optional filtering. Use this when the user asks about their tasks, todos, or things to do.",
    inputSchema: listTasksSchema,
    execute: executeListTasks,
  },
  createTask: {
    description: "Create a new task/todo. Use this when the user wants to add a task to their list.",
    inputSchema: createTaskSchema,
    execute: executeCreateTask,
  },
  updateTask: {
    description: "Update an existing task's status, title, or due date.",
    inputSchema: updateTaskSchema,
    execute: executeUpdateTask,
  },
};
