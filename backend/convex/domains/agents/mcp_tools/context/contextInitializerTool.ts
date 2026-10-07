/**
 * Context Initializer Tool - 2025 Deep Agents Pattern
 * 
 * Based on:
 * - Anthropic "Effective harnesses for long-running agents" (Nov 2025)
 * - CLAUDE.md pattern from Claude Code Best Practices (Apr 2025)
 * 
 * Purpose:
 * The Initializer Agent pattern ensures agents start each session with:
 * 1. Project context (what the project is, how to run it)
 * 2. User preferences and settings
 * 3. Session history and progress tracking
 * 4. Feature list with completion status
 * 
 * This prevents the "wasted time" failure mode where agents spend time
 * figuring out how to run the app or understanding the project structure.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import type { ToolCtx } from "@convex-dev/agent";
import { api } from "../../../../_generated/api";

/**
 * Session context structure following the 2025 Initializer Agent pattern
 */
export interface SessionContext {
  // Project context (like CLAUDE.md)
  projectName: string;
  projectDescription: string;
  capabilities: string[];
  
  // User context
  userId: string;
  userPreferences: Record<string, unknown>;
  trackedTopics: string[];
  
  // Session state
  sessionId: string;
  previousSessionSummary: string | null;
  
  // Feature list (prevents premature completion claims)
  featureList: Array<{
    id: string;
    name: string;
    status: "not_started" | "in_progress" | "completed" | "blocked";
    testCriteria: string;
  }>;
  
  // Progress tracking
  progressLog: Array<{
    timestamp: number;
    action: string;
    result: string;
  }>;
  
  // Timestamps
  initializedAt: number;
}

/**
 * Context Initializer Tool
 * 
 * Call this at the START of every agent session to:
 * 1. Load project context (capabilities, structure)
 * 2. Load user preferences and tracked topics
 * 3. Restore previous session state if available
 * 4. Initialize feature list for tracking
 */
export const contextInitializerTool = createTool({
  description: `Initialize agent session with full context.

Call this at the START of every agent session to prevent the "wasted time" failure mode.

This tool:
1. Loads project capabilities and structure (like CLAUDE.md)
2. Retrieves user preferences and tracked topics
3. Restores previous session state if available
4. Initializes feature list for progress tracking

Based on Anthropic's "Effective harnesses for long-running agents" (Nov 2025).`,

  args: z.object({
    agentThreadId: z.string().describe("The agent thread ID for session persistence"),
    userId: z.string().describe("The user ID to load preferences for"),
    taskDescription: z.string().optional().describe("Optional description of the current task"),
    features: z.array(z.object({
      name: z.string(),
      testCriteria: z.string(),
    })).optional().describe("Optional list of features to track for this session"),
  }),

  handler: async (ctx: ToolCtx, args): Promise<SessionContext> => {
    console.log('[contextInitializerTool] Initializing session context:', {
      agentThreadId: args.agentThreadId,
      userId: args.userId,
    });

    const now = Date.now();
    const sessionId = `session_${now}_${Math.random().toString(36).slice(2, 8)}`;

    // Load previous scratchpad if exists
    let previousSessionSummary: string | null = null;
    try {
      const scratchpad = await ctx.runQuery(api.domains.agents.agentScratchpads.getByAgentThread, {
        agentThreadId: args.agentThreadId,
      });
      if (scratchpad?.scratchpad?.compactContext?.summary) {
        previousSessionSummary = scratchpad.scratchpad.compactContext.summary;
      }
    } catch (e) {
      console.log('[contextInitializerTool] No previous scratchpad found');
    }

    // Load user preferences
    let userPreferences: Record<string, unknown> = {};
    let trackedTopics: string[] = [];
    try {
      const userSettings = await ctx.runQuery(api.domains.auth.userPreferences.getUserPreferences, {});
      if (userSettings && !('needsReauth' in userSettings && userSettings.needsReauth)) {
        userPreferences = userSettings as Record<string, unknown>;
        trackedTopics = (userSettings).trackedHashtags ?? [];
      }
    } catch (e) {
      console.log('[contextInitializerTool] Could not load user settings');
    }

    // Build feature list from args or empty
    const featureList = (args.features ?? []).map((f, idx) => ({
      id: `feature_${idx + 1}`,
      name: f.name,
      status: "not_started" as const,
      testCriteria: f.testCriteria,
    }));

    const context: SessionContext = {
      projectName: "NodeBench AI",
      projectDescription: "AI-powered research and document management platform",
      capabilities: [
        "Document creation and editing",
        "Web research with LinkUp and YouTube",
        "SEC filings analysis",
        "Entity research and dossier building",
        "Calendar and task management",
        "Multi-agent orchestration",
      ],
      userId: args.userId,
      userPreferences,
      trackedTopics,
      sessionId,
      previousSessionSummary,
      featureList,
      progressLog: [{
        timestamp: now,
        action: "session_initialized",
        result: args.taskDescription ?? "Session started",
      }],
      initializedAt: now,
    };

    console.log('[contextInitializerTool] Session initialized:', {
      sessionId,
      hasFeatures: featureList.length > 0,
      hasPreviousSession: !!previousSessionSummary,
    });

    return context;
  },
});

