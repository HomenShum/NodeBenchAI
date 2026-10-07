/**
 * Data Access Agent Configuration
 * 
 * Handles calendar events, tasks, and folder operations
 */

import { z } from "zod";

// Agent metadata
export const DATA_ACCESS_AGENT_CONFIG = {
  name: "DataAccessAgent",
  description: "Specialist agent for calendar, tasks, and file operations",
  version: "1.0.0",
};

// Generate dynamic system prompt with current date
export function getDataAccessSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { 
    weekday: "long", 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });
  
  return `You are a Data Access Agent specialized in managing the user's calendar events, tasks, and files.

## Your Capabilities
- **Calendar**: List, create, and manage calendar events
- **Tasks**: List, create, update, and manage tasks/todos
- **Files**: Browse and access folder contents

## Guidelines
1. Always use the appropriate tool to fetch REAL data - never make up events or tasks
2. When listing events/tasks, provide clear summaries with dates and times
3. For calendar queries, determine the appropriate time range (today, tomorrow, week, month)
4. For task queries, apply appropriate filters (status, due date)
5. Present results in a clear, organized format

## Current Date
Today is ${dateStr}. Use this date for all "today" references.
`;
}

// Legacy export for backwards compatibility
export const DATA_ACCESS_SYSTEM_PROMPT = getDataAccessSystemPrompt();

// Tool schemas
export const listEventsSchema = z.object({
  timeRange: z.enum(["today", "tomorrow", "week", "month"])
    .default("today")
    .describe("Time range to query for events"),
});

export const createEventSchema = z.object({
  title: z.string().describe("Event title"),
  startTime: z.string().describe("Start time in ISO format"),
  endTime: z.string().optional().describe("End time in ISO format"),
  location: z.string().optional().describe("Event location"),
  description: z.string().optional().describe("Event description"),
});

export const listTasksSchema = z.object({
  filter: z.enum(["all", "today", "week", "overdue"])
    .default("all")
    .describe("Filter tasks by time period"),
  status: z.enum(["todo", "in_progress", "done", "all"])
    .default("all")
    .describe("Filter by task status"),
});

export const createTaskSchema = z.object({
  title: z.string().describe("Task title"),
  description: z.string().optional().describe("Task description"),
  dueDate: z.string().optional().describe("Due date in ISO format"),
  priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
});

export const updateTaskSchema = z.object({
  taskId: z.string().describe("Task ID to update"),
  status: z.enum(["todo", "in_progress", "done"]).optional().describe("New status"),
  title: z.string().optional().describe("New title"),
  dueDate: z.string().optional().describe("New due date"),
});

// Type exports
export type ListEventsInput = z.infer<typeof listEventsSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
