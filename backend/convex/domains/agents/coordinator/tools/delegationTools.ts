/**
 * Delegation Tools for Coordinator Agent
 * 
 * LangChain-style tool-as-subagent pattern
 */

import { z } from "zod";
import type { ActionCtx } from "../../../../_generated/server";
import { delegationSchema, type DelegationInput } from "../config";

// Import subagent executors
import { executeListEvents } from "../../dataAccess/tools/calendarTools";
import { executeListTasks } from "../../dataAccess/tools/taskTools";
import type { ListEventsInput, ListTasksInput } from "../../dataAccess/config";

/**
 * Delegate to Data Access Agent
 */
export async function delegateToDataAccess(
  ctx: ActionCtx,
  args: DelegationInput
): Promise<string> {
  console.log(`[Coordinator] Delegating to DataAccessAgent: ${args.query.substring(0, 50)}...`);
  
  // Determine if this is a calendar or task query
  const query = args.query.toLowerCase();
  const isCalendar = query.includes("calendar") || query.includes("event") || query.includes("schedule");
  const isTask = query.includes("task") || query.includes("todo") || query.includes("reminder");

  try {
    if (isCalendar) {
      // Determine time range from query
      let timeRange: "today" | "tomorrow" | "week" | "month" = "today";
      if (query.includes("tomorrow")) timeRange = "tomorrow";
      else if (query.includes("week")) timeRange = "week";
      else if (query.includes("month")) timeRange = "month";

      const result = await executeListEvents(ctx, { timeRange });
      return JSON.stringify(result);
    } else if (isTask) {
      const result = await executeListTasks(ctx, { filter: "all", status: "all" });
      return JSON.stringify(result);
    } else {
      // Default to calendar events
      const result = await executeListEvents(ctx, { timeRange: "today" });
      return JSON.stringify(result);
    }
  } catch (error: any) {
    return JSON.stringify({ success: false, error: error.message });
  }
}

/**
 * Delegation tool definitions for coordinator
 */
export const delegationToolDefinitions = {
  delegateToDataAccess: {
    description: `Delegate calendar/task queries to the DataAccessAgent.
Use when the user asks about:
- Calendar events, schedule, appointments
- Tasks, todos, reminders
- Creating or managing events/tasks`,
    inputSchema: delegationSchema,
    execute: delegateToDataAccess,
  },
  
  // Placeholder for other subagent delegations
  // These will call the existing subagent tools
  delegateToDocument: {
    description: `Delegate document operations to the DocumentAgent.
Use when the user asks to search, read, create, or edit documents.`,
    inputSchema: delegationSchema,
    execute: async (ctx: ActionCtx, args: DelegationInput) => {
      console.log(`[Coordinator] Delegating to DocumentAgent: ${args.query.substring(0, 50)}...`);
      // TODO: Integrate with existing DocumentAgent
      return JSON.stringify({ 
        success: true, 
        message: "DocumentAgent delegation - implementation pending",
        query: args.query 
      });
    },
  },

  delegateToMedia: {
    description: `Delegate media search to the MediaAgent.
Use when the user asks for videos, images, or web content.`,
    inputSchema: delegationSchema,
    execute: async (ctx: ActionCtx, args: DelegationInput) => {
      console.log(`[Coordinator] Delegating to MediaAgent: ${args.query.substring(0, 50)}...`);
      return JSON.stringify({ 
        success: true, 
        message: "MediaAgent delegation - implementation pending",
        query: args.query 
      });
    },
  },

  delegateToSEC: {
    description: `Delegate SEC/regulatory queries to the SECAgent.
Use when the user asks about SEC filings, company financials, EDGAR.`,
    inputSchema: delegationSchema,
    execute: async (ctx: ActionCtx, args: DelegationInput) => {
      console.log(`[Coordinator] Delegating to SECAgent: ${args.query.substring(0, 50)}...`);
      return JSON.stringify({ 
        success: true, 
        message: "SECAgent delegation - implementation pending",
        query: args.query 
      });
    },
  },

  delegateToOpenBB: {
    description: `Delegate financial/market queries to the OpenBBAgent.
Use when the user asks about stocks, crypto, market data.`,
    inputSchema: delegationSchema,
    execute: async (ctx: ActionCtx, args: DelegationInput) => {
      console.log(`[Coordinator] Delegating to OpenBBAgent: ${args.query.substring(0, 50)}...`);
      return JSON.stringify({ 
        success: true, 
        message: "OpenBBAgent delegation - implementation pending",
        query: args.query 
      });
    },
  },
};
