/**
 * Document Editing Live API Test Runner
 * 
 * This action runs live API tests with real OpenAI calls
 * and LLM-based validation of edit quality.
 * 
 * Returns boolean pass/fail results (not subjective scores)
 */

"use node";

import { action } from "../../_generated/server";
import { v } from "convex/values";
import OpenAI from "openai";

interface TestResult {
  testName: string;
  pass: boolean;
  reasoning: string;
  apiCallsMade: number;
  executionTimeMs: number;
}

/**
 * LLM Judge - Validates edit quality using separate LLM
 * Returns boolean: true if edit passes, false otherwise
 */
async function judgeEditQuality(
  openai: OpenAI,
  originalContent: string,
  editProposal: string,
  userRequest: string,
  editType: string
): Promise<{ pass: boolean; reasoning: string }> {
  try {
    const judgmentPrompt = `You are a document quality judge. Evaluate if the following edit is appropriate and high-quality.

ORIGINAL DOCUMENT:
${originalContent}

USER REQUEST:
${userRequest}

EDIT TYPE: ${editType}

PROPOSED EDIT:
${editProposal}

Evaluate based on:
1. Does the edit address the user's request?
2. Is the content accurate and relevant?
3. Is the formatting appropriate?
4. Does it preserve existing content (for append edits)?
5. Is the writing quality good?

Respond with ONLY a JSON object:
{
  "pass": true/false,
  "reasoning": "brief explanation"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages: [
        {
          role: "user",
          content: judgmentPrompt,
        },
      ],
      max_completion_tokens: 200,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { pass: false, reasoning: "Failed to parse judge response" };
    }

    const judgment = JSON.parse(jsonMatch[0]);
    return {
      pass: judgment.pass === true,
      reasoning: judgment.reasoning || "No reasoning provided",
    };
  } catch (error) {
    console.error("[judgeEditQuality] Error:", error);
    return { pass: false, reasoning: `Judge error: ${error}` };
  }
}

/**
 * Generate edit proposals using real OpenAI API
 */
async function generateEditProposalLive(
  openai: OpenAI,
  userRequest: string,
  documentTitle: string,
  documentContent: string
): Promise<string> {
  try {
    const prompt = `You are a document editing assistant. Generate a specific edit proposal for this request.

DOCUMENT TITLE: ${documentTitle}
DOCUMENT CONTENT: ${documentContent.slice(0, 500)}...

USER REQUEST: "${userRequest}"

Generate a specific edit proposal. Return ONLY the proposed new content or changes, no JSON.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_completion_tokens: 500,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("[generateEditProposalLive] Error:", error);
    throw error;
  }
}

/**
 * Run a single test scenario
 */
async function runTestScenario(
  openai: OpenAI,
  testName: string,
  userRequest: string,
  documentTitle: string,
  documentContent: string,
  editType: string
): Promise<TestResult> {
  const startTime = Date.now();
  let apiCallsMade = 0;

  try {
    // Generate edit proposal (API call 1)
    const editProposal = await generateEditProposalLive(
      openai,
      userRequest,
      documentTitle,
      documentContent
    );
    apiCallsMade++;

    if (!editProposal || editProposal.length === 0) {
      return {
        testName,
        pass: false,
        reasoning: "Failed to generate edit proposal",
        apiCallsMade,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Judge the edit quality (API call 2)
    const judgment = await judgeEditQuality(
      openai,
      documentContent,
      editProposal,
      userRequest,
      editType
    );
    apiCallsMade++;

    return {
      testName,
      pass: judgment.pass,
      reasoning: judgment.reasoning,
      apiCallsMade,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      testName,
      pass: false,
      reasoning: `Test error: ${error}`,
      apiCallsMade,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Main test runner action
 */
export const runDocumentEditingLiveTests = action({
  args: {
    testCount: v.optional(v.number()),
  },
  returns: v.object({
    totalTests: v.number(),
    passedTests: v.number(),
    failedTests: v.number(),
    passRate: v.string(),
    results: v.array(
      v.object({
        testName: v.string(),
        pass: v.boolean(),
        reasoning: v.string(),
        apiCallsMade: v.number(),
        executionTimeMs: v.number(),
      })
    ),
    totalApiCalls: v.number(),
    totalExecutionTimeMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const openai = new OpenAI({ apiKey });
    const results: TestResult[] = [];
    const overallStartTime = Date.now();

    // Test scenarios
    const scenarios = [
      {
        name: "Company Research + Document Update",
        request: "Add information about Series B healthcare startups and their market opportunity",
        title: "Healthcare Investment Research",
        content: "Initial research notes on healthcare sector...",
        type: "append",
      },
      {
        name: "Founder Research + Document Enhancement",
        request: "Add detailed founder backgrounds and their expertise areas",
        title: "Company Leadership Analysis",
        content: "Company overview and basic information...",
        type: "append",
      },
      {
        name: "Market Analysis Question",
        request: "Add comprehensive market analysis including TAM, growth rate, and competitive landscape",
        title: "Market Analysis Report",
        content: "Executive summary of market research...",
        type: "append",
      },
      {
        name: "Title Update for Investment Thesis",
        request: "Update the title to reflect this is an investment opportunity analysis for a specific company",
        title: "Research Document",
        content: "Analysis of BioTech Innovations Inc...",
        type: "title",
      },
      {
        name: "Complex Multi-Section Edit",
        request: "Create a comprehensive investment thesis section that includes market opportunity, team strength, competitive advantages, and risk factors",
        title: "Investment Analysis",
        content: "Company: BioTech Innovations\nStage: Series B\nFunding: $15M",
        type: "append",
      },
      {
        name: "Competitive Analysis Question",
        request: "What are the key competitive advantages and how should we position against competitors?",
        title: "Competitive Analysis",
        content: "Initial competitive landscape overview...",
        type: "append",
      },
      {
        name: "Funding Strategy Question",
        request: "Develop a comprehensive funding strategy including Series C targets, investor profiles, and timeline",
        title: "Funding Strategy",
        content: "Current funding status: Series B, $15M raised...",
        type: "append",
      },
      {
        name: "Product Roadmap Question",
        request: "Add information about the company's product roadmap and development priorities",
        title: "Product Strategy",
        content: "Current product: AI diagnostic platform...",
        type: "append",
      },
    ];

    // Run tests (limit to testCount if specified)
    const testsToRun = args.testCount ? scenarios.slice(0, args.testCount) : scenarios;

    for (const scenario of testsToRun) {
      const result = await runTestScenario(
        openai,
        scenario.name,
        scenario.request,
        scenario.title,
        scenario.content,
        scenario.type
      );
      results.push(result);
      console.log(`[Test] ${result.testName}: ${result.pass ? "PASS" : "FAIL"}`);
    }

    // Calculate statistics
    const passedTests = results.filter((r) => r.pass).length;
    const failedTests = results.filter((r) => !r.pass).length;
    const totalApiCalls = results.reduce((sum, r) => sum + r.apiCallsMade, 0);
    const totalExecutionTimeMs = Date.now() - overallStartTime;
    const passRate = ((passedTests / results.length) * 100).toFixed(1);

    return {
      totalTests: results.length,
      passedTests,
      failedTests,
      passRate: `${passRate}%`,
      results,
      totalApiCalls,
      totalExecutionTimeMs,
    };
  },
});
