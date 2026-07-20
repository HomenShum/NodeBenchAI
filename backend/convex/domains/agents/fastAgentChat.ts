// Modern Fast Agent Chat - NO LEGACY FRAMEWORK
// This is the main entry point for FastAgentPanel's AI chat functionality
"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { getLlmModel, resolveModelAlias, getModelWithFailover } from "../../../shared/llm/modelCatalog";

/**
 * Modern fast agent chat action
 * 
 * This replaces the legacy multi-agent framework with a streamlined approach:
 * - For document editing: Uses fast_agents orchestrator
 * - For chat/questions: Direct LLM call
 * - Streams progress via SSE events
 */
export const chatWithAgentModern = action({
  args: {
    message: v.string(),
    selectedDocumentId: v.optional(v.id("documents")),
    model: v.optional(v.union(v.literal("openai"), v.literal("gemini"))),
    runId: v.optional(v.id("agentRuns")),
    fastMode: v.optional(v.boolean()),
  },
  returns: v.object({
    response: v.string(),
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const { message, selectedDocumentId, model = "openai", runId, fastMode = true } = args;

    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) throw new Error("Not authenticated");

      // Update run status to running
      if (runId) {
        await ctx.runMutation(internal.domains.agents.fastAgentChatHelpers.updateRunStatus, {
          runId,
          status: "running",
        });
      }

      // Detect if this is a document editing request
      const isEditRequest = selectedDocumentId &&
        /\b(edit|modify|change|update|add|insert|create|write|append|prepend|delete|remove)\b/i.test(message);

      let response: string;

      if (isEditRequest) {
        // Document editing flow - use fast_agents orchestrator
        response = await handleDocumentEdit(ctx, {
          message,
          documentId: selectedDocumentId!,
          userId,
          runId,
          model,
          fastMode,
        });
      } else {
        // Chat/question flow - direct LLM call
        response = await handleChatResponse(ctx, {
          message,
          documentId: selectedDocumentId,
          userId,
          runId,
          model,
          fastMode,
        });
      }

      // Update run status to completed
      if (runId) {
        await ctx.runMutation(internal.domains.agents.fastAgentChatHelpers.updateRunStatus, {
          runId,
          status: "completed",
          finalResponse: response,
        });

        // Update the assistant message with the response
        const messages: any[] = await ctx.runQuery(internal.domains.agents.fastAgentChatHelpers.getMessagesByRun, {
          runId,
        });

        if (messages.length > 0) {
          await ctx.runMutation(internal.domains.agents.fastAgentChatHelpers.updateMessageContent, {
            messageId: messages[0]._id,
            content: response,
          });
        }
      }

      return { response, success: true };
    } catch (error: any) {
      console.error("[fastAgentChat] Error:", error);

      // Update run status to error
      if (runId) {
        await ctx.runMutation(internal.domains.agents.fastAgentChatHelpers.updateRunStatus, {
          runId,
          status: "error",
          errorMessage: error.message || "Unknown error",
        });

        // Update the assistant message with error
        const messages: any[] = await ctx.runQuery(internal.domains.agents.fastAgentChatHelpers.getMessagesByRun, {
          runId,
        });

        if (messages.length > 0) {
          await ctx.runMutation(internal.domains.agents.fastAgentChatHelpers.updateMessageContent, {
            messageId: messages[0]._id,
            content: `Error: ${error.message || "Unknown error"}`,
            status: "error",
          });
        }
      }

      return {
        response: "",
        success: false,
        error: error.message || "Unknown error",
      };
    }
  },
});

/**
 * Handle document editing requests
 * Uses the fast_agents orchestrator for structured editing
 */
async function handleDocumentEdit(
  ctx: ActionCtx,
  args: {
    message: string;
    documentId: Id<"documents">;
    userId: Id<"users">;
    runId?: Id<"agentRuns">;
    model: string;
    fastMode: boolean;
  }
): Promise<string> {
  const { message, documentId, userId, runId, model, fastMode } = args;

  try {
    // Legacy editing/validation agents were removed - this functionality needs to be reimplemented
    if (runId) {
      await emitEvent(ctx, runId, "error", "Document editing agent is currently unavailable");
    }

    return `Document editing feature is currently unavailable. The editing and validation agents were removed as part of the Deep Agents 2.0 refactor. Please edit the document manually or request this feature to be reimplemented using the new architecture.`;

    // TODO: Reimplement using Deep Agents 2.0 architecture
    /*
    // Emit thinking event
    if (runId) {
      await emitEvent(ctx, runId, "thinking", "Analyzing document edit request...");
    }

    // Get document context
    const doc = await ctx.runQuery(api.domains.documents.documents.getById, { documentId });
    if (!doc) throw new Error("Document not found");

    // Emit thinking event
    if (runId) {
      await emitEvent(ctx, runId, "thinking", `Working on document: ${doc.title}`);
    }

    // Import editing and validation agents (REMOVED - part of Deep Agents 2.0 refactor)
    // const { generateEdits } = await import("../../fast_agents/editingAgent");
    // const { validateEdits } = await import("../../fast_agents/validationAgent");

    // Generate edit proposals
    if (runId) {
      await emitEvent(ctx, runId, "thinking", "Generating edit proposals...");
    }

    const editOutput = await generateEdits(ctx, {
      message,
      documentId,
      currentContent: doc.content || "",
      currentTitle: doc.title,
    });

    // Validate proposals
    if (runId) {
      await emitEvent(ctx, runId, "thinking", "Validating edit proposals...");
    }

    const validationOutput = await validateEdits(ctx, {
      proposals: editOutput.proposals,
      documentId: String(documentId),
      currentContent: doc.content || "",
      currentTitle: doc.title,
    });

    if (!validationOutput.valid) {
      const errorMsg = validationOutput.errors.join("; ");
      return `I encountered issues with the edit proposals: ${errorMsg}. Please try again with a clearer request.`;
    }

    // Apply approved proposals
    if (runId) {
      await emitEvent(ctx, runId, "thinking", "Applying edits...");
    }

    let appliedCount = 0;
    for (const proposal of validationOutput.approvedProposals) {
      try {
        if (proposal.type === "title") {
          await ctx.runMutation(api.domains.documents.documents.update, {
            id: documentId,
            title: proposal.newValue,
          });
          appliedCount++;
        } else if (proposal.type === "content") {
          await ctx.runMutation(api.domains.documents.documents.update, {
            id: documentId,
            content: proposal.newValue,
          });
          appliedCount++;
        } else if (proposal.type === "append") {
          // Append to existing content
          const newContent = (doc.content || "") + "\n\n" + proposal.newValue;
          await ctx.runMutation(api.domains.documents.documents.update, {
            id: documentId,
            content: newContent,
          });
          appliedCount++;
        } else if (proposal.type === "replace") {
          // Replace specific section (if target is provided)
          if (proposal.target) {
            const newContent = (doc.content || "").replace(
              new RegExp(proposal.target, "gi"),
              proposal.newValue
            );
            await ctx.runMutation(api.domains.documents.documents.update, {
              id: documentId,
              content: newContent,
            });
          }
          appliedCount++;
        }
      } catch (error) {
        console.error("[handleDocumentEdit] Error applying proposal:", error);
      }
    }

    // Build response
    let response = `✅ Successfully edited "${doc.title}"!\n\n`;
    response += `Applied ${appliedCount} edit(s):\n`;
    for (const proposal of validationOutput.approvedProposals) {
      response += `• ${proposal.type}: ${proposal.reason}\n`;
    }

    if (validationOutput.warnings.length > 0) {
      response += `\n⚠️ Warnings:\n`;
      for (const warning of validationOutput.warnings) {
        response += `• ${warning}\n`;
      }
    }

    response += `\n${editOutput.explanation}`;

    return response;
    */
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return `❌ Error editing document: ${errorMsg}. Please try again.`;
  }
}

/**
 * Handle chat/question requests
 * Uses direct LLM call for quick responses
 */
async function handleChatResponse(
  ctx: ActionCtx,
  args: {
    message: string;
    documentId?: Id<"documents">;
    userId: Id<"users">;
    runId?: Id<"agentRuns">;
    model: string;
    fastMode: boolean;
  }
): Promise<string> {
  const { message, documentId, userId, runId, model, fastMode } = args;

  // Emit thinking event
  if (runId) {
    await emitEvent(ctx, runId, "thinking", "Processing your question...");
  }

  // Get document context if provided
  let context = "";
  if (documentId) {
    const doc = await ctx.runQuery(api.domains.documents.documents.getById, { documentId });
    if (doc) {
      context = `\n\nCurrent document context:\nTitle: ${doc.title}\nContent: ${doc.content || "(empty)"}`;
    }
  }

  // Multi-provider LLM support
  const preferredModel = model === "gemini" ? getLlmModel("chat", "gemini") : model === "anthropic" ? getLlmModel("chat", "anthropic") : getLlmModel("chat", "openai");
  const { model: modelName, provider } = getModelWithFailover(resolveModelAlias(preferredModel));
  
  const systemPrompt = "You are a helpful AI assistant. Provide clear, concise, and accurate responses." + context;
  
  let response: string;
  
  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const completion = await anthropic.messages.create({
      model: modelName,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });
    response = completion.content[0]?.type === "text" ? completion.content[0].text : "I apologize, but I couldn't generate a response.";
  } else if (provider === "gemini") {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await generateText({
      model: google(modelName),
      system: systemPrompt,
      prompt: message,
      maxOutputTokens: 2000,
    });
    response = result.text || "I apologize, but I couldn't generate a response.";
  } else {
    // OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      max_completion_tokens: 2000,
    });
    response = completion.choices[0]?.message?.content || "I apologize, but I couldn't generate a response.";
  }

  return response;
}

/**
 * Emit a streaming event for the agent run
 */
async function emitEvent(
  ctx: ActionCtx,
  runId: Id<"agentRuns">,
  kind: string,
  message: string,
  data?: any
): Promise<void> {
  await ctx.runMutation(internal.domains.agents.fastAgentChatHelpers.appendRunEvent, {
    runId,
    kind,
    message,
    ...(data === undefined ? {} : { data }),
  });
}
