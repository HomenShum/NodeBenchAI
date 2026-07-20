/**
 * Voice Agent - Real-time voice integration with Fast Agents
 *
 * Based on OpenAI Agents JS voice pattern:
 * https://openai.github.io/openai-agents-js/guides/voice-agents/build/
 *
 * This module provides voice-optimized agents that integrate with:
 * - RTVI / Daily Bots for voice orchestration
 * - Convex Fast Agents for reasoning and tool execution
 * - Real-time streaming for incremental TTS
 */

"use node";

import { Agent, stepCountIs } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { components } from "../../../_generated/api";

// Helper to get the appropriate language model based on model name
function getLanguageModel(modelName: string) {
  if (modelName.startsWith("claude-")) return anthropic(modelName);
  if (modelName.startsWith("gemini-")) return google(modelName);
  return openai.chat(modelName);
}
import { createCoordinatorAgent } from "../../agents/core/coordinatorAgent";

// Import all tools for voice agent access
import { linkupSearch } from "../../../tools/media/linkupSearch";
import { youtubeSearch } from "../../../tools/media/youtubeSearch";
import {
  findDocument,
  getDocumentContent,
  analyzeDocument,
  analyzeMultipleDocuments,
  updateDocument,
  createDocument,
  generateEditProposals,
  createDocumentFromAgentContentTool,
} from "../../../tools/document/documentTools";
import {
  searchMedia,
  analyzeMediaFile,
  getMediaDetails,
  listMediaFiles
} from "../../../tools/media/mediaTools";
import {
  listTasks,
  createTask,
  updateTask,
  listEvents,
  createEvent,
  getFolderContents
} from "../../../tools/integration/dataAccessTools";
import {
  searchSecFilings,
  downloadSecFiling,
  getCompanyInfo
} from "../../../tools/sec/secFilingTools";
import {
  searchHashtag,
  createHashtagDossier,
  getOrCreateHashtagDossier
} from "../../../tools/document/hashtagSearchTools";

/**
 * Voice plan schema - determines routing strategy
 */
export const voicePlanSchema = z.object({
  mode: z.enum(["simple", "complex"]).default("simple"),
  requiresTools: z.boolean().default(false),
  estimatedSteps: z.number().default(1),
});

/**
 * Create a voice-optimized agent with fast response times
 *
 * This agent has access to all tools but with reduced step budget for voice responsiveness.
 * For simple queries: Responds quickly without tool usage
 * For complex queries: Uses tools efficiently with concise responses
 *
 * @param model - Model name (e.g., "gpt-5.4", "claude-sonnet-4.6")
 * @returns Agent instance optimized for voice interactions
 */
export const createVoiceAgent = (model: string) =>
  new Agent(components.agent, {
    name: "VoiceFastAgent",
    languageModel: getLanguageModel(model),
    instructions: `You are a helpful voice assistant with access to the user's documents, tasks, events, and media.

VOICE-SPECIFIC BEHAVIOR:
1. Keep responses CONCISE and CONVERSATIONAL - you're speaking, not writing
2. Avoid long lists or complex formatting - summarize key points
3. For simple questions, answer directly in 1-2 sentences
4. For complex requests, acknowledge and use tools to help

RESPONSE STYLE:
- Use natural, spoken language
- Break complex info into digestible chunks
- Confirm actions before executing them
- Provide brief status updates for multi-step tasks

When the user asks a simple question, respond immediately.
When they need multi-step help or tool usage, say you'll work on it and proceed.`,

    // Full tool access for voice interactions
    tools: {
      // Web search
      linkupSearch,
      youtubeSearch,

      // Document operations
      findDocument,
      getDocumentContent,
      analyzeDocument,
      analyzeMultipleDocuments,
      updateDocument,
      createDocument,
      generateEditProposals,
      createDocumentFromAgentContentTool,

      // Media operations
      searchMedia,
      analyzeMediaFile,
      getMediaDetails,
      listMediaFiles,

      // Data access (tasks, events, folders)
      listTasks,
      createTask,
      updateTask,
      listEvents,
      createEvent,
      getFolderContents,

      // SEC filings
      searchSecFilings,
      downloadSecFiling,
      getCompanyInfo,

      // Hashtag and dossier tools
      searchHashtag,
      createHashtagDossier,
      getOrCreateHashtagDossier,
    },

    stopWhen: stepCountIs(5), // Limit steps for voice responsiveness
    textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  });

/**
 * Create a voice-optimized coordinator agent for complex tasks
 * 
 * This agent has full tool access and can handle multi-step workflows
 * while maintaining voice-appropriate response formatting.
 * 
 * @param model - OpenAI model name
 * @returns Coordinator agent with voice-optimized instructions
 */
export const createVoiceCoordinatorAgent = (model: string) => {
  const baseAgent = createCoordinatorAgent(model);

  // Override instructions to be voice-optimized
  return new Agent(components.agent, {
    ...baseAgent.options,
    name: "VoiceCoordinatorAgent",
    instructions: `${baseAgent.options.instructions}

VOICE MODE ACTIVE:
- Keep responses concise and conversational
- Summarize results rather than listing everything
- Confirm actions: "I've created that task" instead of showing full details
- For searches, mention top 2-3 results, not all
- Use natural speech patterns`,
    stopWhen: stepCountIs(8), // Reduced from 15 for voice responsiveness
  });
};

/**
 * Voice planner agent - decides routing strategy
 * 
 * Analyzes the user's voice input and determines:
 * - Whether to use simple or complex agent
 * - Whether tools are needed
 * - Estimated number of steps
 */
export const createVoicePlannerAgent = (model: string) =>
  new Agent(components.agent, {
    name: "VoicePlanner",
    languageModel: getLanguageModel(model),
    instructions: `Analyze the user's voice request and classify it:

SIMPLE requests (mode: "simple"):
- Greetings, small talk
- Simple questions about general knowledge
- Quick status checks
- Single-fact lookups

COMPLEX requests (mode: "complex"):
- Document searches or creation
- Multi-step tasks
- Data analysis
- Anything requiring tools or external data

Set requiresTools=true if the request needs:
- Document/file access
- Task/event management
- Web search
- SEC filings or media search

Estimate steps conservatively (1-8).`,
    stopWhen: stepCountIs(2), // Very fast classification
  });
