import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("runtime trust boundary guards", () => {
  it("does not expose a caller-selected thread model action", () => {
    const source = read("backend/convex/domains/agents/fastAgentPanelStreaming.ts");

    expect(source).not.toContain("export const generateDocumentContent");
    expect(source).not.toContain("[generateDocumentContent]");
  });

  it("has no legacy bearer-stream renderer, query, or HTTP driver", () => {
    const streaming = read("backend/convex/domains/agents/fastAgentPanelStreaming.ts");
    const router = read("backend/convex/router.ts");
    const legacyRenderer = resolve(
      process.cwd(),
      "apps/web/src/features/agents/components/FastAgentPanel/FastAgentPanel.StreamingMessage.tsx",
    );

    expect(existsSync(legacyRenderer)).toBe(false);
    expect(streaming).not.toContain("export const getMessageByStreamId");
    expect(streaming).not.toContain("export const getStreamBody");
    expect(streaming).not.toContain("export const createAssistantMessage");
    expect(router).not.toContain('path: "/api/chat-stream"');
  });

  it("checks exact document-link ownership before inserting the document", () => {
    const source = read("backend/convex/domains/agents/fastAgentPanelStreaming.ts");
    const start = source.indexOf("export const createDocumentFromAgentContent");
    const end = source.indexOf("export const getThreadByStreamIdInternal", start);
    const body = source.slice(start, end);

    expect(body).toContain('.withIndex("by_agentThreadId"');
    expect(body).toContain("Thread not found or unauthorized");
    expect(body.indexOf("Thread not found or unauthorized"))
      .toBeLessThan(body.indexOf('ctx.db.insert("documents"'));
    expect(body).toContain("MAX_AGENT_DOCUMENT_TITLE_LENGTH");
    expect(body).toContain("MAX_AGENT_DOCUMENT_CONTENT_LENGTH");
    expect(body).not.toContain("console.log");
  });

  it("does not write user prompt or message previews to runtime logs", () => {
    const streaming = read("backend/convex/domains/agents/fastAgentPanelStreaming.ts");
    const documentCreation = read("backend/convex/domains/agents/fastAgentDocumentCreation.ts");

    expect(streaming).not.toContain("args.prompt.substring");
    expect(streaming).not.toContain("sanitizedPrompt.substring");
    expect(streaming).not.toContain("Starting with message:', args.message");
    expect(streaming).not.toContain("args.message.slice(0, 100)");
    expect(streaming).not.toContain("textPreview: m.text?.slice");
    expect(documentCreation).not.toContain("args.prompt.substring");
  });

  it("requires TRACE receipts and binds them to the exact output payload", () => {
    const helper = read("backend/convex/domains/agents/receipts/emitWithReceipt.ts");
    const trace = read("backend/convex/domains/agents/traceOrchestrator.ts");

    expect(helper).toContain("resultOutputHash");
    expect(helper).toContain("hashTraceResultOutput(resultOutput)");
    expect(helper).not.toContain("Receipt emission is best-effort");
    expect(trace).toContain("resultOutput: mergedRawData");
    expect(trace).toContain("resultOutput: analysis");
  });

  it("does not expose response-shape heuristics as confidence", () => {
    const trace = read("backend/convex/domains/agents/traceOrchestrator.ts");
    const swarm = read("apps/web/src/features/agents/components/FastAgentPanel/SwarmLanesView.tsx");
    const removedTimeline = resolve(
      process.cwd(),
      "apps/web/src/features/agents/components/FastAgentPanel/FastAgentPanel.ParallelTaskTimeline.tsx",
    );

    expect(trace).not.toContain("traceOutput.confidence");
    expect(trace).not.toContain("const confidence = Math.min(0.95");
    expect(swarm).not.toContain("% confidence");
    expect(existsSync(removedTimeline)).toBe(false);
  });

  it("removes the unused parallel UI/API and keeps only bounded owner-bound storage", () => {
    const tree = read("backend/convex/domains/agents/parallelTaskTree.ts");
    const panel = read("apps/web/src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");
    const designSystem = read("apps/web/src/design/designSystem.ts");
    const generatedApi = read("backend/convex/_generated/api.d.ts");

    for (const removedPath of [
      "backend/convex/domains/agents/parallelTaskOrchestrator.ts",
      "apps/web/src/features/agents/hooks/useParallelTaskExecution.ts",
      "apps/web/src/features/agents/components/FastAgentPanel/FastAgentPanel.ParallelTaskTimeline.tsx",
      "apps/web/src/features/agents/components/FastAgentPanel/FastAgentPanel.DecisionTreeKanban.tsx",
    ]) {
      expect(existsSync(resolve(process.cwd(), removedPath))).toBe(false);
    }

    expect(tree).not.toMatch(/export const \w+ = (?:query|mutation|action|internalAction)\(/);
    expect(tree.match(/export const \w+ = internalMutation/g)).toHaveLength(4);
    expect(tree).toContain("requireOwnedTaskInTree");
    expect(tree).toContain("MAX_BRANCHES");
    expect(tree).toContain("MAX_QUERY_LENGTH");
    expect(tree).toContain("task.status !== args.status");
    expect(panel).not.toContain("ParallelTaskTimeline");
    expect(designSystem).not.toContain("live ParallelTaskTimeline");
    expect(generatedApi).not.toContain("parallelTaskOrchestrator");
  });

  it("keeps core due-diligence storage and orchestration behind owner-bound internal APIs", () => {
    const mutations = read("backend/convex/domains/agents/dueDiligence/ddMutations.ts");
    const orchestrator = read("backend/convex/domains/agents/dueDiligence/ddOrchestrator.ts");
    const enhanced = read("backend/convex/domains/agents/dueDiligence/ddEnhancedOrchestrator.ts");
    const triggerQueries = read("backend/convex/domains/agents/dueDiligence/ddTriggerQueries.ts");
    const triggers = read("backend/convex/domains/agents/dueDiligence/ddTriggers.ts");
    const encounter = read("backend/convex/domains/operations/encounters/encounterCapture.ts");
    const slack = read("backend/convex/domains/integrations/slack/slackAgent.ts");
    const evaluation = read("backend/convex/domains/evaluation/ddEvaluation.ts");
    const vite = read("vite.config.ts");

    expect(mutations).not.toMatch(/export const \w+ = (?:query|mutation|action)\(/);
    expect(mutations).toContain("getDDJobDetailInternal");
    expect(mutations).toContain("requireOwnedJob(ctx, jobId, userId)");
    expect(mutations).toContain("return await requireOwnedJob(ctx, jobId, userId)");
    expect(mutations).toContain('q.eq(q.field("userId"), args.userId)');
    expect(mutations).not.toContain("export const getDDJob =");
    expect(mutations).not.toContain("export const getUserDDJobs =");

    expect(orchestrator).toContain("startDueDiligenceJobInternal = internalAction");
    expect(orchestrator).not.toContain("startDueDiligenceJob = action");
    expect(orchestrator).toContain("{ jobId, userId }");
    expect(orchestrator).toContain("let ownerValidated = false");
    expect(orchestrator).toContain("if (ownerValidated)");
    expect(orchestrator.indexOf("Validate the scheduled owner"))
      .toBeLessThan(orchestrator.indexOf("Phase 1: Analyzing complexity signals"));
    expect(enhanced).toContain("startEnhancedDDJobInternal = internalAction");
    expect(enhanced).not.toContain("startEnhancedDDJob = action");
    expect(enhanced).toContain("{ jobId, userId }");
    expect(enhanced).toContain("let ownerValidated = false");
    expect(enhanced).toContain("if (ownerValidated)");
    expect(triggerQueries).not.toMatch(/export const \w+ = query\(/);
    expect(triggerQueries).toContain("shouldTriggerDDForFundingInternal = internalQuery");
    expect(triggerQueries).toContain('q.eq(q.field("userId"), userId)');
    expect(triggers).not.toMatch(/export const \w+ = action\(/);
    expect(triggers).not.toContain("triggerManualDD");
    expect(triggers).toContain("triggerDDFromFundingInternal = internalAction");

    expect(encounter).toContain("const authUserId = await getAuthUserId(ctx)");
    expect(encounter).toContain("encounterOwnerId !== authUserId");
    expect(encounter).toContain("ddOrchestrator.startDueDiligenceJobInternal");
    expect(slack).toContain("ddOrchestrator.startDueDiligenceJobInternal");
    expect(evaluation).toContain("evaluateDDJobInternal = internalAction");
    expect(evaluation).toContain("ddMutations.getDDJobDetailInternal");
    expect(evaluation).toContain("{ jobId, userId }");
    expect(vite).not.toContain(".ParallelTaskTimeline");
    expect(vite).not.toContain(".DecisionTreeKanban");
  });
});
