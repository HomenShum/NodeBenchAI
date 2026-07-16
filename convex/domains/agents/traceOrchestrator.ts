"use node";
/**
 * traceOrchestrator.ts
 *
 * TRACE (Tool-Routed Architecture for Controlled Execution) Decision Loop Engine.
 *
 * Core principle: The LLM is an Orchestrator of Deterministic Tools, NOT an Analyst.
 *
 * The TRACE Decision Loop:
 * 1. Receive query + agent results (as METADATA summaries, NOT raw text)
 * 2. Loop:
 *    a. Ask LLM: "Given these metadata summaries, what's your next choice?"
 *       â†’ LLM returns one of: gather_info, execute_data_op, execute_output, finalize
 *    b. Execute the chosen tool DETERMINISTICALLY
 *    c. Record audit entry (CODE-generated, not LLM)
 *    d. Return ONLY metadata to LLM (row counts, column names, errors)
 *    e. If finalize â†’ break
 * 3. Produce three outputs:
 *    - Raw data reference (from data store)
 *    - Audit log (from traceAuditEntries)
 *    - Optional analysis (LLM-generated, labeled non-deterministic)
 *
 * Addresses all 5 risks:
 * - Risk 1 (Hallucination): LLM doesn't generate raw data
 * - Risk 2 (Probabilistic logic): All computation in deterministic tools
 * - Risk 3 (Outdated knowledge): gather_info grounds in current data
 * - Risk 4 (Cost/latency): LLM sees metadata, not raw data
 * - Risk 5 (Trust/opacity): Code-generated audit log
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "./mcp_tools/models";
import { emitWithReceipt } from "./receipts/emitWithReceipt";
import {
  extractMetadataSummary,
  formatMetadataSummary,
  type TraceAuditEntry,
  type TraceMetadataFeedback,
  type TraceOutput,
  type TraceChoice,
} from "./traceTypes";

// ============================================================================
// Configuration
// ============================================================================

const MAX_TRACE_ITERATIONS = 10;
const TRACE_MODEL = "qwen3-coder-free"; // FREE model for orchestration decisions

// ============================================================================
// TRACE Decision Loop â€” Core Engine
// ============================================================================

/**
 * Execute the TRACE finalization loop for a completed swarm/tree.
 *
 * This replaces the old `synthesizeResults()` which passed raw agent outputs
 * to the LLM for merging (Risk 1: Hallucination, Risk 4: Cost).
 *
 * Instead:
 * - Agent results are summarized deterministically (extractMetadataSummary)
 * - LLM receives ONLY metadata summaries
 * - LLM decides which tools to call (orchestrator role)
 * - Tools execute deterministically and record audit entries
 * - Final output has three clearly separated parts
 */
export const executeTraceFinalization = internalAction({
  args: {
    userId: v.id("users"),
    executionId: v.string(),
    executionType: v.union(
      v.literal("swarm"),
      v.literal("tree"),
      v.literal("chat"),
    ),
    query: v.string(),
    agentResults: v.array(
      v.object({
        agentName: v.string(),
        role: v.string(),
        result: v.string(),
      })
    ),
    generateAnalysis: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<TraceOutput> => {
    const startTime = Date.now();
    const {
      executionId,
      executionType,
      userId,
      query,
      agentResults,
      generateAnalysis = true,
    } = args;

    let seq = 0;

    // â”€â”€ Step 1: Extract metadata from agent results DETERMINISTICALLY â”€â”€
    // The LLM NEVER sees the raw results. Only these metadata summaries.
    const agentMetadata = agentResults.map((r) => {
      const meta = extractMetadataSummary(r.result);
      return {
        agentName: r.agentName,
        role: r.role,
        metadata: meta,
        metadataSummary: formatMetadataSummary(meta),
        resultLength: r.result.length,
      };
    });

    // Record the initial gather_info step (deterministic metadata extraction)
    // emitWithReceipt logs both the TRACE audit entry AND a tamper-evident action receipt
    const receiptCtx = {
      agentId: `trace-${executionType}-${executionId.slice(0, 8)}`,
      userId,
    };
    await emitWithReceipt(
      ctx,
      {
        executionId,
        executionType,
        seq: seq++,
        choiceType: "gather_info",
        toolName: "extractMetadataSummary",
        provenance: "deterministic_code",
        toolParams: { agentCount: agentResults.length },
        metadata: {
          rowCount: agentResults.length,
          charCount: agentResults.reduce((sum, r) => sum + r.result.length, 0),
          wordCount: agentResults.reduce(
            (sum, r) => sum + r.result.split(/\s+/).length,
            0
          ),
          keyTopics: agentMetadata.flatMap(
            (m) => m.metadata.keyTopics || []
          ).slice(0, 10),
          durationMs: Date.now() - startTime,
          success: true,
        },
        resultOutput: agentMetadata,
        description: `Extracted deterministic metadata from ${agentResults.length} agent results. Total chars: ${agentResults.reduce((s, r) => s + r.result.length, 0)}. LLM will see metadata only, not raw data.`,
      },
      receiptCtx,
    );

    // â”€â”€ Step 2: Self-correction check (intended vs actual) â”€â”€
    // Detect any mismatches between what was requested and what was returned
    const expectedAgentCount = agentResults.length;
    const successfulAgents = agentResults.filter(
      (r) => r.result && r.result.length > 50
    );

    if (successfulAgents.length < expectedAgentCount) {
      // Self-correction detected: some agents returned empty/minimal results
      await emitWithReceipt(
        ctx,
        {
          executionId,
          executionType,
          seq: seq++,
          choiceType: "gather_info",
          toolName: "selfCorrectionCheck",
          provenance: "deterministic_code",
          metadata: {
            durationMs: 0,
            success: true,
            intendedState: `${expectedAgentCount} agents with substantial results`,
            actualState: `${successfulAgents.length} agents with substantial results (${expectedAgentCount - successfulAgents.length} returned minimal data)`,
            correctionApplied: true,
          },
          resultOutput: {
            expectedAgentCount,
            successfulAgentCount: successfulAgents.length,
          },
          description: `Self-correction: ${expectedAgentCount - successfulAgents.length} agent(s) returned minimal results. Proceeding with ${successfulAgents.length} substantial results.`,
        },
        receiptCtx,
      );
    }

    // â”€â”€ Step 3: Deterministic merge of agent results â”€â”€
    // This is the key TRACE principle: merge is done by CODE, not by LLM.
    // We concatenate results with clear provenance markers.
    const mergedRawData = agentResults
      .filter((r) => r.result && r.result.length > 50)
      .map(
        (r) =>
          `[Source: ${r.agentName} (${r.role})]\n${r.result}`
      )
      .join("\n\n---\n\n");

    // Record the data operation
    await emitWithReceipt(
      ctx,
      {
        executionId,
        executionType,
        seq: seq++,
        choiceType: "execute_data_op",
        toolName: "mergeAgentResults",
        provenance: "deterministic_code",
        toolParams: {
          strategy: "concatenate_with_provenance",
          agentsIncluded: successfulAgents.map((r) => r.agentName),
        },
        metadata: {
          rowCount: successfulAgents.length,
          charCount: mergedRawData.length,
          wordCount: mergedRawData.split(/\s+/).length,
          durationMs: Date.now() - startTime,
          success: true,
        },
        resultOutput: mergedRawData,
        description: `Merged ${successfulAgents.length} agent results with provenance markers. Total: ${mergedRawData.length} chars. Each section labeled with source agent.`,
      },
      receiptCtx,
    );

    // â”€â”€ Step 4: Detect cross-agent agreement/disagreement deterministically â”€â”€
    // Use simple text analysis to find overlapping and unique topics per agent
    const topicsByAgent: Array<{ agent: string; topics: Set<string> }> = agentMetadata.map((m) => ({
      agent: m.agentName,
      topics: new Set((m.metadata.keyTopics || []) as string[]),
    }));

    const allTopics = new Set<string>(topicsByAgent.flatMap((a) => [...a.topics]));
    const sharedTopics: string[] = [...allTopics].filter((topic) =>
      topicsByAgent.filter((a) => a.topics.has(topic)).length > 1
    );
    const uniqueTopicsByAgent = topicsByAgent.map((a) => ({
      agent: a.agent,
      uniqueTopics: [...a.topics].filter((t) => !sharedTopics.includes(t)),
    }));

    await emitWithReceipt(
      ctx,
      {
        executionId,
        executionType,
        seq: seq++,
        choiceType: "execute_data_op",
        toolName: "crossAgentTopicAnalysis",
        provenance: "deterministic_code",
        toolParams: {
          totalTopics: allTopics.size,
          sharedCount: sharedTopics.length,
        },
        metadata: {
          rowCount: topicsByAgent.length,
          keyTopics: sharedTopics.slice(0, 5) as string[],
          durationMs: Date.now() - startTime,
          success: true,
        },
        resultOutput: {
          sharedTopics,
          uniqueTopicsByAgent,
        },
        description: `Cross-agent topic analysis: ${allTopics.size} total topics, ${sharedTopics.length} shared across agents. Shared: [${sharedTopics.slice(0, 3).join(", ")}]. ${uniqueTopicsByAgent.map((a) => `${a.agent}: ${a.uniqueTopics.length} unique`).join(", ")}.`,
      },
      receiptCtx,
    );

    // â”€â”€ Step 5: Generate LLM analysis (CLEARLY LABELED as non-deterministic) â”€â”€
    let analysis: string | undefined;

    if (generateAnalysis) {
      try {
        // The LLM receives ONLY metadata, NOT raw data
        const metadataPrompt = `You are a synthesis analyst. Based on the METADATA SUMMARIES below (you do NOT have access to the raw data), provide a brief analysis of the findings.

IMPORTANT: Your analysis is NON-DETERMINISTIC and will be clearly labeled as AI-generated in the UI. The raw data and audit log are the source of truth.

Original Query: "${query}"

Agent Metadata Summaries (${agentMetadata.length} agents):
${agentMetadata
  .map(
    (m) => `
- ${m.agentName} (${m.role}):
  - Result size: ${m.resultLength} chars, ${m.metadata.wordCount} words
  - Key topics: [${(m.metadata.keyTopics || []).join(", ")}]
  - Summary: ${m.metadataSummary}`
  )
  .join("\n")}

Cross-Agent Analysis:
- Shared topics: [${sharedTopics.slice(0, 5).join(", ")}]
- ${uniqueTopicsByAgent.map((a) => `${a.agent} unique topics: [${a.uniqueTopics.slice(0, 3).join(", ")}]`).join("\n- ")}

Provide a concise synthesis (3-5 paragraphs) that:
1. Highlights the key consensus across agents
2. Notes any unique insights from individual agents
3. Identifies gaps or areas needing further research
4. Provides actionable takeaways

Remember: You are analyzing metadata summaries, not raw data. Be transparent about this limitation.`;

        const { text } = await generateText({
          model: getLanguageModelSafe(TRACE_MODEL),
          prompt: metadataPrompt,
          maxOutputTokens: 2000,
        });

        analysis = text;

        await emitWithReceipt(
          ctx,
          {
            executionId,
            executionType,
            seq: seq++,
            choiceType: "execute_output",
            toolName: "generateAnalysis",
            provenance: "ai_model",
            toolParams: { model: TRACE_MODEL, maxTokens: 2000 },
            metadata: {
              charCount: analysis.length,
              wordCount: analysis.split(/\s+/).length,
              durationMs: Date.now() - startTime,
              success: true,
            },
            resultOutput: analysis,
            description: `Generated LLM analysis (NON-DETERMINISTIC, labeled as AI-generated). ${analysis.length} chars. Model: ${TRACE_MODEL}. This content is clearly separated from deterministic outputs in the UI.`,
          },
          receiptCtx,
        );
      } catch (error: any) {
        await emitWithReceipt(
          ctx,
          {
            executionId,
            executionType,
            seq: seq++,
            choiceType: "execute_output",
            toolName: "generateAnalysis",
            provenance: "ai_model",
            metadata: {
              durationMs: Date.now() - startTime,
              success: false,
              errorMessage: error.message,
            },
            resultOutput: { errorMessage: error.message },
            description: `LLM analysis generation failed: ${error.message}. Raw data and audit log remain valid.`,
          },
          receiptCtx,
        );
      }
    }

    // â”€â”€ Step 6: Finalize â”€â”€
    const totalDuration = Date.now() - startTime;
    const selfCorrections = successfulAgents.length < expectedAgentCount ? 1 : 0;

    await emitWithReceipt(
      ctx,
      {
        executionId,
        executionType,
        seq: seq++,
        choiceType: "finalize",
        toolName: "traceFinalize",
        provenance: "deterministic_code",
        metadata: {
          rowCount: successfulAgents.length,
          charCount: mergedRawData.length,
          durationMs: totalDuration,
          success: true,
          // Completion traceability â€” link finalize entry back to original query
          originalRequest: query.length > 500 ? query.slice(0, 500) + "â€¦" : query,
          deliverySummary: `${successfulAgents.length} agent(s), ${seq} steps, ${mergedRawData.length} chars raw data`,
        },
        resultOutput: {
          mergedRawData,
          analysis: analysis ?? null,
          successfulAgents: successfulAgents.map((agent) => agent.agentName),
          totalSteps: seq,
          selfCorrections,
        },
        description: `TRACE finalization complete. ${seq} steps, ${totalDuration}ms, ${selfCorrections} self-correction(s). Raw data: ${mergedRawData.length} chars from ${successfulAgents.length} agents. Audit log: ${seq} entries.`,
      },
      receiptCtx,
    );

    // â”€â”€ Build the three-part output â”€â”€
    const traceOutput: TraceOutput = {
      executionId,
      executionType,
      rawDataViewName: `trace_${executionId}_merged`,
      auditLog: [], // Will be populated by the caller via getAuditLog query
      analysis,
      analysisIsNonDeterministic: true,
      totalDurationMs: totalDuration,
      totalSteps: seq,
      selfCorrections,
    };

    return traceOutput;
  },
});

// ============================================================================
// Helper: Build TRACE-enhanced merged result
// ============================================================================

/**
 * Build a TRACE-enhanced merged result string.
 * This wraps the raw merged data with provenance and labels.
 *
 * The output format clearly separates:
 * 1. Deterministic raw data (with source attribution)
 * 2. AI analysis (clearly labeled as non-deterministic)
 * 3. Audit log reference
 */
export function buildTraceEnhancedResult(
  rawMergedData: string,
  analysis: string | undefined,
  auditSummary: {
    totalSteps: number;
    selfCorrections: number;
    toolsUsed: string[];
    totalDurationMs: number;
  },
): string {
  const parts: string[] = [];

  // Part 1: Raw data with provenance
  parts.push(rawMergedData);

  // Part 2: AI Analysis (clearly labeled)
  if (analysis) {
    parts.push(`\n\n---\n\nâš¡ **AI Analysis** _(This content was generated by AI and is non-deterministic. The raw data above is the source of truth.)_\n\n${analysis}`);
  }

  // Part 3: Audit trail summary
  parts.push(`\n\n---\n\nðŸ”’ **Execution Trace** _(Deterministic audit log â€” ${auditSummary.totalSteps} steps, ${auditSummary.totalDurationMs}ms, ${auditSummary.selfCorrections} self-correction(s). Tools: ${auditSummary.toolsUsed.join(", ")})_`);

  return parts.join("");
}
