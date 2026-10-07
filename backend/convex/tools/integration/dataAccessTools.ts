// convex/tools/dataAccessTools.ts
// Data access tools for tasks, events, folders, calendar, and email calendar integration
// Enables voice-controlled data operations

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/**
 * List tasks with optional filtering
 * Voice: "Show me my tasks" or "What tasks are due today?"
 */
export const listTasks = createTool({
  description: "List tasks with optional filtering by status, priority, due date, or other criteria. Returns a formatted list of tasks with their details.",
  
  args: z.object({
    filter: z.enum(["all", "today", "week", "overdue", "completed"]).default("all").describe("Filter tasks by time period or status"),
    status: z.enum(["todo", "in_progress", "done", "all"]).default("all").describe("Filter by task status"),
    priority: z.enum(["low", "medium", "high", "all"]).default("all").describe("Filter by priority level"),
    limit: z.number().default(20).describe("Maximum number of tasks to return"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[listTasks] Listing tasks with filter: ${args.filter}, status: ${args.status}`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    let tasks: any[] = [];

    // Get user events based on filter
    if (args.filter === "today") {
      tasks = await ctx.runQuery(api.domains.tasks.userEvents.listUserEventsDueToday, { userId });
    } else if (args.filter === "week") {
      tasks = await ctx.runQuery(api.domains.tasks.userEvents.listUserEventsDueThisWeek, { userId });
    } else {
      // Get all user events (using listUserEventsByUpdatedDesc)
      tasks = await ctx.runQuery(api.domains.tasks.userEvents.listUserEventsByUpdatedDesc, { limit: 100, userId });
    }

    // Apply status filter
    if (args.status !== "all") {
      tasks = tasks.filter((task: any) => task.status === args.status);
    }
    
    // Apply priority filter
    if (args.priority !== "all") {
      tasks = tasks.filter((task: any) => task.priority === args.priority);
    }
    
    // Handle overdue filter
    if (args.filter === "overdue") {
      const now = Date.now();
      tasks = tasks.filter((task: any) => 
        task.dueDate && task.dueDate < now && task.status !== "done"
      );
    }
    
    // Handle completed filter
    if (args.filter === "completed") {
      tasks = tasks.filter((task: any) => task.status === "done");
    }
    
    // Limit results
    const limitedTasks = tasks.slice(0, args.limit);
    
    const header = `Tasks (filter=${args.filter}, status=${args.status}, priority=${args.priority})`;

    if (limitedTasks.length === 0) {
      return `${header}\n\n- (none)\n\nTotal matching tasks: 0`;
    }
    
    // Format tasks for display
    const formattedTasks = limitedTasks.map((task: any, idx: number) => {
      const statusIcon = task.status === "done" ? "✅" : task.status === "in-progress" ? "🔄" : "⬜";
      const priorityIcon = task.priority === "high" ? "🔴" : task.priority === "medium" ? "🟡" : "🟢";
      const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date";
      
      return `${idx + 1}. ${statusIcon} ${priorityIcon} "${task.title}"
   ID: ${task._id}
   Status: ${task.status}
   Priority: ${task.priority || "none"}
   Due: ${dueDate}
   ${task.description ? `Description: ${task.description.substring(0, 100)}...` : ''}`;
    }).join('\n\n');
    
    return `${header}\n\nFound ${limitedTasks.length} task(s):\n\n${formattedTasks}\n\nTotal matching tasks: ${tasks.length}`;
  },
});

/**
 * Create a new user event (personal task/todo)
 * Voice: "Create a task to review the Q4 report"
 */
export const createUserEvent = createTool({
  description: "Create a new user event (personal task/todo) with title, description, due date, and priority. Returns the new event ID.",
  
  args: z.object({
    title: z.string().describe("Event/task title"),
    description: z.string().optional().describe("Event description"),
    dueDate: z.string().optional().describe("Due date in ISO format (YYYY-MM-DD) or natural language like 'tomorrow', 'next week'"),
    priority: z.enum(["low", "medium", "high"]).default("medium").describe("Priority level"),
    status: z.enum(["todo", "in_progress", "done"]).default("todo").describe("Initial status"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[createUserEvent] Creating user event: "${args.title}"`);

    // Parse due date if provided
    let dueDateMs: number | undefined;
    if (args.dueDate) {
      // Simple date parsing - in production, use a proper date parser
      const date = new Date(args.dueDate);
      if (!isNaN(date.getTime())) {
        dueDateMs = date.getTime();
      }
    }

    const eventId = await ctx.runMutation(api.domains.tasks.userEvents.createUserEvent, {
      title: args.title,
      description: args.description,
      dueDate: dueDateMs,
      priority: args.priority,
      status: args.status,
    });
    
    return `User event created successfully!

Title: "${args.title}"
ID: ${eventId}
Priority: ${args.priority}
Status: ${args.status}
${args.dueDate ? `Due: ${args.dueDate}` : 'No due date'}

The event has been added to your personal list.`;
  },
});

// Backward compatibility alias
export const createTask = createUserEvent;

/**
 * Update an existing user event
 * Voice: "Mark task [ID] as complete" or "Change priority of task [ID] to high"
 */
export const updateUserEvent = createTool({
  description: "Update an existing user event's properties including title, description, status, priority, or due date.",
  
  args: z.object({
    userEventId: z.string().describe("The user event ID to update"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["todo", "in_progress", "done"]).optional().describe("New status"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
    dueDate: z.string().optional().describe("New due date in ISO format"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[updateUserEvent] Updating user event: ${args.userEventId}`);
    
    const updates: any = {};
    if (args.title) updates.title = args.title;
    if (args.description) updates.description = args.description;
    if (args.status) updates.status = args.status;
    if (args.priority) updates.priority = args.priority;
    if (args.dueDate) {
      const date = new Date(args.dueDate);
      if (!isNaN(date.getTime())) {
        updates.dueDate = date.getTime();
      }
    }
    
    await ctx.runMutation(api.domains.tasks.userEvents.updateUserEvent, {
      userEventId: args.userEventId as any,
      ...updates,
    });
    
    const updatedFields = Object.keys(updates).join(', ');
    
    return `User event updated successfully!

Event ID: ${args.userEventId}
Updated fields: ${updatedFields}

The changes have been saved.`;
  },
});

// Backward compatibility alias
export const updateTask = updateUserEvent;

/**
 * List events in a date range
 * Voice: "What events do I have this week?" or "Show my calendar for tomorrow"
 */
export const listEvents = createTool({
  description: "List calendar events in a specified date range. Returns events with their details including time, location, and description.",
  
  args: z.object({
    timeRange: z.enum(["today", "tomorrow", "week", "month", "custom"]).default("today").describe("Time range to query"),
    startDate: z.string().optional().describe("Start date for custom range (ISO format)"),
    endDate: z.string().optional().describe("End date for custom range (ISO format)"),
    status: z.enum(["confirmed", "tentative", "cancelled", "all"]).default("all").describe("Filter by event status"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[listEvents] Listing events for: ${args.timeRange}`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    // Calculate date range
    let start: number;
    let end: number;
    const now = Date.now();

    if (args.timeRange === "today") {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
      end = start + 24 * 60 * 60 * 1000 - 1;
    } else if (args.timeRange === "tomorrow") {
      const d = new Date(now + 24 * 60 * 60 * 1000);
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
      end = start + 24 * 60 * 60 * 1000 - 1;
    } else if (args.timeRange === "week") {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
      end = start + 7 * 24 * 60 * 60 * 1000 - 1;
    } else if (args.timeRange === "month") {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
      end = start + 30 * 24 * 60 * 60 * 1000 - 1;
    } else {
      // Custom range
      start = args.startDate ? new Date(args.startDate).getTime() : now;
      end = args.endDate ? new Date(args.endDate).getTime() : start + 24 * 60 * 60 * 1000;
    }

    // Get events using unified calendar agenda (includes events table + document-based events)
    const agenda = await ctx.runQuery(api.domains.calendar.calendar.listAgendaInRange, {
      start,
      end,
      country: "US",
    });
    let events = agenda.events as any[];
    
    // Filter by status if needed
    if (args.status !== "all") {
      events = events.filter((event: any) => event.status === args.status);
    }
    
    const header = `Events (timeRange=${args.timeRange}${args.startDate ? `, startDate=${args.startDate}` : ""}${args.endDate ? `, endDate=${args.endDate}` : ""}, status=${args.status})`;

    if (events.length === 0) {
      return `${header}\n\n- (none)`;
    }
    
    // Format events
    const formattedEvents = events.map((event: any, idx: number) => {
      const startTime = new Date(event.startTime).toLocaleString();
      const endTime = event.endTime ? new Date(event.endTime).toLocaleString() : "No end time";
      const statusIcon = event.status === "confirmed" ? "✅" : event.status === "tentative" ? "❓" : "❌";
      
      return `${idx + 1}. ${statusIcon} "${event.title}"
   ID: ${event._id}
   Start: ${startTime}
   End: ${endTime}
   ${event.location ? `Location: ${event.location}` : ''}
   ${event.description ? `Description: ${event.description.substring(0, 100)}...` : ''}
   Status: ${event.status || 'confirmed'}`;
    }).join('\n\n');
    
    return `${header}\n\nFound ${events.length} event(s):\n\n${formattedEvents}`;
  },
});

/**
 * Create a new calendar event
 * Voice: "Schedule a meeting with the team tomorrow at 2pm"
 */
export const createEvent = createTool({
  description: "Create a new calendar event with title, time, location, and description. Returns the new event ID.",
  
  args: z.object({
    title: z.string().describe("Event title"),
    startTime: z.string().describe("Start time in ISO format or natural language"),
    endTime: z.string().optional().describe("End time in ISO format or natural language"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    allDay: z.boolean().default(false).describe("Whether this is an all-day event"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[createEvent] Creating event: "${args.title}"`);
    
    // Parse start time
    const startTimeMs = new Date(args.startTime).getTime();
    if (isNaN(startTimeMs)) {
      return `Invalid start time format: "${args.startTime}". Please use ISO format (YYYY-MM-DDTHH:MM:SS).`;
    }
    
    // Parse end time if provided
    let endTimeMs: number | undefined;
    if (args.endTime) {
      endTimeMs = new Date(args.endTime).getTime();
      if (isNaN(endTimeMs)) {
        return `Invalid end time format: "${args.endTime}". Please use ISO format.`;
      }
    }
    
    const eventId = await ctx.runMutation(api.domains.calendar.events.createEvent, {
      title: args.title,
      startTime: startTimeMs,
      endTime: endTimeMs,
      description: args.description,
      location: args.location,
      allDay: args.allDay,
      status: "confirmed",
    });
    
    return `Event created successfully!

Title: "${args.title}"
ID: ${eventId}
Start: ${new Date(startTimeMs).toLocaleString()}
${endTimeMs ? `End: ${new Date(endTimeMs).toLocaleString()}` : ''}
${args.location ? `Location: ${args.location}` : ''}
${args.allDay ? 'All-day event' : ''}

The event has been added to your calendar.`;
  },
});

/**
 * Get folder contents
 * Voice: "Show me what's in the Projects folder"
 */
export const getFolderContents = createTool({
  description: "Get all documents in a specific folder. Returns a list of documents with their metadata.",
  
  args: z.object({
    folderName: z.string().describe("Name of the folder to query"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[getFolderContents] Getting contents of folder: "${args.folderName}"`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    // Get all user folders
    const folders = await ctx.runQuery(api.domains.documents.folders.getUserFolders, { userId });
    
    // Find the folder by name
    const folder = folders.find((f: any) => 
      f.name.toLowerCase() === args.folderName.toLowerCase()
    );
    
    if (!folder) {
      return `Folder "${args.folderName}" not found. Available folders: ${folders.map((f: any) => f.name).join(', ')}`;
    }

    // Get folder with documents
    const folderWithDocs = await ctx.runQuery(api.domains.documents.folders.getFolderWithDocuments, {
      folderId: folder._id,
      userId, // Pass userId for evaluation
    });
    
    if (!folderWithDocs || !folderWithDocs.documents || folderWithDocs.documents.length === 0) {
      return `Folder "${args.folderName}" is empty.`;
    }
    
    // Format documents
    const formattedDocs = folderWithDocs.documents.map((doc: any, idx: number) => {
      const icon = doc.icon || '📄';
      const lastModified = new Date(doc.lastModified || doc._creationTime).toLocaleDateString();
      
      return `${idx + 1}. ${icon} "${doc.title}"
   ID: ${doc._id}
   Type: ${doc.documentType || 'text'}
   Last Modified: ${lastModified}`;
    }).join('\n\n');
    
    return `Folder "${args.folderName}" contains ${folderWithDocs.documents.length} document(s):

${formattedDocs}`;
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Email Calendar Integration Tools
// ────────────────────────────────────────────────────────────────────────────

/**
 * List today's email-extracted events
 * Voice: "What meetings do I have today from email?" or "Show my email calendar events"
 */
export const listTodaysEmailEvents = createTool({
  description: `List calendar events that were extracted from emails for today.
Use when:
- User asks "what meetings do I have today from email"
- User asks "what's on my calendar from Gmail"
- User wants to see email-sourced events specifically
- User asks about proposed events that need confirmation

Returns events with their details including whether they need user confirmation.`,

  args: z.object({
    includeProposed: z.boolean().default(true).describe("Include proposed events that need confirmation"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[listTodaysEmailEvents] Listing today's email events`);

    // Get today's email events
    const events = await ctx.runQuery(api.domains.calendar.events.listTodaysEmailEvents, {});

    // Filter by proposed status if needed
    let filteredEvents = events;
    if (!args.includeProposed) {
      filteredEvents = events.filter((e: any) => !e.proposed);
    }

    if (filteredEvents.length === 0) {
      return `No email-extracted events found for today.

To see all calendar events, use the listEvents tool instead.`;
    }

    // Separate confirmed and proposed events
    const confirmed = filteredEvents.filter((e: any) => !e.proposed);
    const proposed = filteredEvents.filter((e: any) => e.proposed);

    // Format events
    const formatEvent = (event: any, idx: number) => {
      const startTime = new Date(event.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const endTime = event.endTime ? new Date(event.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const timeStr = endTime ? `${startTime} - ${endTime}` : startTime;
      const confidenceIcon = event.ingestionConfidence === 'high' ? '✅' : event.ingestionConfidence === 'med' ? '⚠️' : '❓';

      return `${idx + 1}. ${confidenceIcon} "${event.title}"
   Time: ${event.allDay ? 'All day' : timeStr}
   ${event.location ? `Location: ${event.location}` : ''}
   Source: Gmail (${event.sourceId})
   Confidence: ${event.ingestionConfidence || 'unknown'}
   ${event.rawSummary ? `Summary: ${event.rawSummary.substring(0, 100)}...` : ''}`;
    };

    let response = `Found ${filteredEvents.length} email-extracted event(s) for today:\n\n`;

    if (confirmed.length > 0) {
      response += `**Confirmed Events (${confirmed.length}):**\n\n`;
      response += confirmed.map(formatEvent).join('\n\n');
      response += '\n\n';
    }

    if (proposed.length > 0) {
      response += `**Proposed Events Needing Confirmation (${proposed.length}):**\n\n`;
      response += proposed.map((e: any, i: number) => formatEvent(e, i)).join('\n\n');
      response += '\n\nTo confirm a proposed event, use the confirmEmailEvent tool with the event ID.';
    }

    return response;
  },
});

/**
 * List all proposed email events that need confirmation
 * Voice: "Show me proposed events" or "What events need my confirmation"
 */
export const listProposedEmailEvents = createTool({
  description: `List all email-extracted events that are proposed and need user confirmation.
Use when:
- User asks "what events need confirmation"
- User asks about proposed meetings
- User wants to review tentative events from email

These are events extracted with lower confidence that require user review.`,

  args: z.object({}),

  handler: async (ctx): Promise<string> => {
    console.log(`[listProposedEmailEvents] Listing proposed email events`);

    const events = await ctx.runQuery(api.domains.calendar.events.listProposedFromEmail, {});

    if (events.length === 0) {
      return `No proposed events need confirmation.

All email-extracted events have been reviewed.`;
    }

    const formattedEvents = events.map((event: any, idx: number) => {
      const startTime = new Date(event.startTime).toLocaleString();
      const endTime = event.endTime ? new Date(event.endTime).toLocaleString() : '';
      const timeStr = endTime ? `${startTime} - ${endTime}` : startTime;

      return `${idx + 1}. ❓ "${event.title}"
   ID: ${event._id}
   Time: ${event.allDay ? 'All day' : timeStr}
   ${event.location ? `Location: ${event.location}` : ''}
   Confidence: ${event.ingestionConfidence || 'low'}
   ${event.rawSummary ? `From email: ${event.rawSummary.substring(0, 100)}...` : ''}`;
    }).join('\n\n');

    return `Found ${events.length} proposed event(s) needing confirmation:

${formattedEvents}

To confirm an event, use the confirmEmailEvent tool with the event ID.
To dismiss an event, use the dismissEmailEvent tool with the event ID.`;
  },
});

/**
 * Confirm a proposed email event
 * Voice: "Confirm that meeting" or "Accept the proposed event"
 */
export const confirmEmailEvent = createTool({
  description: `Confirm a proposed email-extracted event. Changes the event from proposed/tentative to confirmed.
Use when:
- User says "confirm this event"
- User says "accept this meeting"
- User wants to add a proposed event to their calendar`,

  args: z.object({
    eventId: z.string().describe("The event ID to confirm"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[confirmEmailEvent] Confirming event: ${args.eventId}`);

    try {
      await ctx.runMutation(api.domains.calendar.events.confirmProposed, {
        eventId: args.eventId,
      });

      return `Event confirmed successfully!

The event has been added to your calendar as a confirmed event.`;
    } catch (error: any) {
      return `Failed to confirm event: ${error.message}

Make sure the event ID is correct and the event exists.`;
    }
  },
});

/**
 * Dismiss a proposed email event
 * Voice: "Dismiss that event" or "Remove the proposed meeting"
 */
export const dismissEmailEvent = createTool({
  description: `Dismiss/delete a proposed email-extracted event. Removes it from the calendar entirely.
Use when:
- User says "dismiss this event"
- User says "remove this meeting"
- User doesn't want the proposed event on their calendar`,

  args: z.object({
    eventId: z.string().describe("The event ID to dismiss"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[dismissEmailEvent] Dismissing event: ${args.eventId}`);

    try {
      await ctx.runMutation(api.domains.calendar.events.dismissProposed, {
        eventId: args.eventId,
      });

      return `Event dismissed successfully!

The proposed event has been removed from your calendar.`;
    } catch (error: any) {
      return `Failed to dismiss event: ${error.message}

Make sure the event ID is correct and the event exists.`;
    }
  },
});
