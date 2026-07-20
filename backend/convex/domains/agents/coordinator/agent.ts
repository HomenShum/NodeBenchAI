/**
 * Coordinator Agent
 * 
 * Supervisor agent that orchestrates specialized subagents.
 * Based on LangChain multi-agent supervisor pattern.
 */
"use node";

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import { generateText, stepCountIs } from "ai";

import { getCoordinatorSystemPrompt, delegationSchema, type DelegationInput } from "./config";
import { delegateToDataAccess } from "./tools/delegationTools";

// Import data access tools directly for simple queries
import { executeListEvents } from "../dataAccess/tools/calendarTools";
import { executeListTasks } from "../dataAccess/tools/taskTools";
import { listEventsSchema, listTasksSchema, type ListEventsInput, type ListTasksInput } from "../dataAccess/config";

// Import centralized model resolver (2025 consolidated - 7 models only)
import { getLanguageModelSafe, DEFAULT_MODEL } from "../mcp_tools/models";

/**
 * Coordinator Agent - Main entry point
 * Orchestrates subagents based on user query
 */
export const orchestrate = action({
  args: {
    prompt: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const modelName = args.model || DEFAULT_MODEL;
    console.log(`[Coordinator] Model: ${modelName}`);
    console.log(`[Coordinator] Prompt: ${args.prompt.substring(0, 100)}...`);

    try {
      const result = await generateText({
        model: getLanguageModelSafe(modelName),
        maxRetries: 3,
        stopWhen: stepCountIs(8),
        tools: {
          // Direct tools for simple queries
          listEvents: {
            description: "List calendar events. Use for schedule/calendar questions.",
            inputSchema: listEventsSchema,
            execute: async (input: ListEventsInput) => executeListEvents(ctx, input),
          },
          listTasks: {
            description: "List tasks/todos. Use for task-related questions.",
            inputSchema: listTasksSchema,
            execute: async (input: ListTasksInput) => executeListTasks(ctx, input),
          },
          
          // Delegation tools for complex queries
          delegateToDataAccess: {
            description: "Delegate calendar/task queries to DataAccessAgent for complex operations.",
            inputSchema: delegationSchema,
            execute: async (input: DelegationInput) => delegateToDataAccess(ctx, input),
          },
          delegateToDocument: {
            description: "Delegate document operations to DocumentAgent.",
            inputSchema: delegationSchema,
            execute: async (input: DelegationInput) => {
              console.log(`[Coordinator] DocumentAgent delegation: ${input.query}`);
              return JSON.stringify({ message: "DocumentAgent - pending integration", query: input.query });
            },
          },
          delegateToMedia: {
            description: "Delegate media/video search to MediaAgent.",
            inputSchema: delegationSchema,
            execute: async (input: DelegationInput) => {
              console.log(`[Coordinator] MediaAgent delegation: ${input.query}`);
              return JSON.stringify({ message: "MediaAgent - pending integration", query: input.query });
            },
          },
          delegateToSEC: {
            description: "Delegate SEC/regulatory queries to SECAgent.",
            inputSchema: delegationSchema,
            execute: async (input: DelegationInput) => {
              console.log(`[Coordinator] SECAgent delegation: ${input.query}`);
              return JSON.stringify({ message: "SECAgent - pending integration", query: input.query });
            },
          },
          delegateToOpenBB: {
            description: "Delegate financial/market queries to OpenBBAgent.",
            inputSchema: delegationSchema,
            execute: async (input: DelegationInput) => {
              console.log(`[Coordinator] OpenBBAgent delegation: ${input.query}`);
              return JSON.stringify({ message: "OpenBBAgent - pending integration", query: input.query });
            },
          },
        },
        system: getCoordinatorSystemPrompt(),
        prompt: args.prompt,
      });

      console.log(`[Coordinator] Steps: ${result.steps?.length || 0}`);
      console.log(`[Coordinator] Tool calls: ${result.toolCalls?.length || 0}`);
      
      return result.text || "No response generated.";
    } catch (error: any) {
      console.error(`[Coordinator] Error:`, error);
      return `Error: ${error.message}`;
    }
  },
});
