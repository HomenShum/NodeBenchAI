/**
 * Research Tool Evaluation Scenarios
 *
 * Tests "Never lose context of what matters to me" — continuation value that drives retention.
 *
 * Each scenario evaluates whether the research output provides:
 * 1. Actionable next steps (not just information)
 * 2. Context preservation (can resume where left off)
 * 3. Follow-up hooks (clear trigger to return)
 * 4. Personal relevance (tied to user's actual goals)
 */

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import { api } from "../../../_generated/api";

// Scenario types for research tool evaluation
export type ResearchScenarioType =
  | "job_prep"           // Prepare for interview
  | "event_prep"         // Prepare for conference/meeting
  | "founder_diligence"  // Evaluate startup
  | "sales_prep"         // Account research
  | "competitor_monitor" // Track competition
  | "topic_deep_dive";   // Research new domain

interface ResearchEvalScenario {
  id: string;
  type: ResearchScenarioType;
  query: string;
  userGoal: string;           // What the user is actually trying to achieve
  expectedNextActions: number; // Min number of specific next actions expected
  requiresFollowUpHook: boolean; // Should suggest a specific follow-up
  contextToPreserve: string[]; // Key facts that must be remembered
  retentionSignal: string;     // What would bring user back
}

// Scenarios that test continuation value
export const RESEARCH_EVAL_SCENARIOS: ResearchEvalScenario[] = [
  {
    id: "stripe_interview_prep",
    type: "job_prep",
    query: "I'm interviewing at Stripe next week for a PM role",
    userGoal: "Get the job offer",
    expectedNextActions: 3,
    requiresFollowUpHook: true,
    contextToPreserve: ["interview_date", "role", "interviewer_names", "company_intel"],
    retentionSignal: "Post-interview debrief",
  },
  {
    id: "demo_day_speaker_research",
    type: "event_prep",
    query: "YC Demo Day is tomorrow, which startups should I prioritize?",
    userGoal: "Find investment opportunities",
    expectedNextActions: 4,
    requiresFollowUpHook: true,
    contextToPreserve: ["demo_day_date", "startups_ranked", "meeting_schedule"],
    retentionSignal: "Post-event follow-up tracking",
  },
  {
    id: "competitor_funding_alert",
    type: "competitor_monitor",
    query: "Monitor OpenAI's latest moves and competitive threats",
    userGoal: "Stay ahead of competition",
    expectedNextActions: 2,
    requiresFollowUpHook: true,
    contextToPreserve: ["competitor_name", "key_moves", "response_strategies"],
    retentionSignal: "Weekly competitive briefing",
  },
  {
    id: "founder_background_check",
    type: "founder_diligence",
    query: "Should I invest in this founder's new startup?",
    userGoal: "Make investment decision",
    expectedNextActions: 3,
    requiresFollowUpHook: true,
    contextToPreserve: ["founder_name", "previous_exits", "red_flags", "deal_terms"],
    retentionSignal: "Investment decision checkpoint",
  },
  {
    id: "ai_regulation_deep_dive",
    type: "topic_deep_dive",
    query: "How will EU AI Act affect my product roadmap?",
    userGoal: "Ensure compliance + find opportunities",
    expectedNextActions: 3,
    requiresFollowUpHook: true,
    contextToPreserve: ["regulation_scope", "compliance_deadlines", "competitive_advantage"],
    retentionSignal: "Compliance status update",
  },
  {
    id: "enterprise_account_prep",
    type: "sales_prep",
    query: "I'm meeting with Walmart's tech procurement team",
    userGoal: "Close enterprise deal",
    expectedNextActions: 4,
    requiresFollowUpHook: true,
    contextToPreserve: ["account_name", "decision_makers", "budget_cycle", "evaluation_criteria"],
    retentionSignal: "Deal progress tracking",
  },
];

// Evaluation criteria for continuation value
export interface ContinuationValueScore {
  scenarioId: string;
  totalScore: number;           // 0-100
  hasNextActions: boolean;      // Has specific actionable steps
  nextActionCount: number;      // Number of actions provided
  hasContextPreservation: boolean; // Key facts will be remembered
  hasFollowUpHook: boolean;     // Clear trigger to return
  isPersonallyRelevant: boolean; // Tied to user's stated goal
  wouldReturn: boolean;         // Would user come back based on this output?
}

// Scoring weights
const WEIGHTS = {
  nextActions: 30,        // 30% - Must have actionable steps
  contextPreservation: 25, // 25% - Must remember what matters
  followUpHook: 25,        // 25% - Must have clear return trigger
  personalRelevance: 20,    // 20% - Must tie to user's goal
};

/**
 * Evaluate a research tool output for continuation value
 */
export function evaluateContinuationValue(
  scenario: ResearchEvalScenario,
  researchOutput: {
    next_actions?: string[];
    talking_points?: string[];
    questions?: string[];
    risks?: string[];
    briefing?: any;
    prep?: any;
  }
): ContinuationValueScore {
  const prep = researchOutput.prep || {};
  const nextActions: string[] = prep.next_actions ?? researchOutput.next_actions ?? [];
  const talkingPoints: string[] = prep.talking_points ?? researchOutput.talking_points ?? [];
  const questions: string[] = prep.questions ?? researchOutput.questions ?? [];
  
  // Check if actions are specific and contextual (not generic "review materials")
  const genericPatterns = /review (provided|the|all) materials|generic placeholder|todo/i;
  const specificActions = nextActions.filter(a => !genericPatterns.test(a.toLowerCase()));
  const hasNextActions = specificActions.length >= scenario.expectedNextActions;
  
  // Context preservation - does output include entity/context clues?
  // Check if research mentions the subject by name or includes specific follow-up hooks
  const fullOutput = JSON.stringify(researchOutput).toLowerCase();
  const entityName = scenario.query.split(" ").find(w => w.length > 3 && !["interview", "meeting", "research", "prepare", "should", "will", "with", "this", "that"].includes(w.toLowerCase())) || "";
  const mentionsEntity = entityName.length > 3 && fullOutput.includes(entityName.toLowerCase());
  
  // Check for temporal context (dates, timelines, follow-up triggers)
  const hasTemporalContext = /follow.?up|after|before|schedule|remind|next week|tomorrow|debrief|recap/i.test(fullOutput);
  
  // Context preservation score - combination of entity mention + temporal hooks
  const contextPreserved = mentionsEntity || hasTemporalContext;
  
  // Follow-up hook - is there a clear trigger to return?
  const hasFollowUpHook = scenario.requiresFollowUpHook
    ? nextActions.some(a => 
        /follow.?up|check.?back|schedule|remind|track|debrief|recap|alert|monitor/i.test(a)
      )
    : true;
  
  // Personal relevance - does output tie to user's goal?
  // Check if next actions reference the specific scenario type
  const goalIndicators: Record<string, string[]> = {
    job_prep: ["interview", "role", "hiring", "position", "linkedin", "questions"],
    event_prep: ["event", "speakers", "networking", "connections", "meet"],
    competitor_monitor: ["competitor", "monitor", "alert", "landscape", "market"],
    founder_diligence: ["investment", "due diligence", "cap table", "financial", "roadmap"],
    sales_prep: ["pitch", "decision maker", "roi", "deal", "account"],
  };
  
  const relevantIndicators = goalIndicators[scenario.type] || ["follow up", "schedule"];
  const hasRelevantIndicators = relevantIndicators.some(ind => 
    fullOutput.includes(ind.toLowerCase())
  );
  const isRelevant = hasRelevantIndicators || mentionsEntity;
  
  // Calculate score with proper weights
  // Next actions: count specific, contextual actions (not generic ones)
  const actionQuality = specificActions.length / Math.max(scenario.expectedNextActions, 1);
  const nextActionScore = Math.min(WEIGHTS.nextActions, actionQuality * WEIGHTS.nextActions);
  
  // Context: entity mention + temporal hooks
  const contextScore = (mentionsEntity ? WEIGHTS.contextPreservation * 0.6 : 0) + 
                       (hasTemporalContext ? WEIGHTS.contextPreservation * 0.4 : 0);
  
  // Follow-up hook
  const hookScore = hasFollowUpHook ? WEIGHTS.followUpHook : 0;
  
  // Personal relevance
  const relevanceScore = isRelevant ? WEIGHTS.personalRelevance : 0;
  
  const totalScore = nextActionScore + contextScore + hookScore + relevanceScore;
  
  return {
    scenarioId: scenario.id,
    totalScore: Math.round(totalScore),
    hasNextActions: specificActions.length > 0,
    nextActionCount: specificActions.length,
    hasContextPreservation: contextPreserved,
    hasFollowUpHook,
    isPersonallyRelevant: isRelevant,
    wouldReturn: totalScore >= 70,
  };
}

/**
 * Run evaluation for all research scenarios
 */
export const runResearchToolEvaluation = action({
  args: {},
  returns: v.object({
    overallScore: v.number(),
    scenarioResults: v.array(v.object({
      scenarioId: v.string(),
      score: v.number(),
      passed: v.boolean(),
    })),
    passed: v.boolean(),
  }),
  
  handler: async (ctx, _args) => {
    const results: { scenarioId: string; score: number; passed: boolean }[] = [];
    
    for (const scenario of RESEARCH_EVAL_SCENARIOS) {
      // Call the research tool
      const result: any = await ctx.runAction(
        api.domains.research.researchRunAction.runResearch,
        {
          goal: { objective: scenario.query, mode: "auto" },
          subjects: [{ type: "text", raw: { query: scenario.query } }],
          depth: "standard",
          deliverables: ["json_full"],
        }
      );
      
      // Evaluate continuation value
      const evalResult = evaluateContinuationValue(scenario, {
        next_actions: result.outputs?.prep?.next_actions ?? [],
        talking_points: result.outputs?.prep?.talking_points ?? [],
        questions: result.outputs?.prep?.questions ?? [],
        risks: result.outputs?.prep?.risks ?? [],
        briefing: result.outputs?.briefing,
      });
      
      results.push({
        scenarioId: scenario.id,
        score: evalResult.totalScore,
        passed: evalResult.wouldReturn,
      });
    }
    
    const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    const allPassed = results.every(r => r.passed);
    
    return {
      overallScore,
      scenarioResults: results,
      passed: allPassed,
    };
  },
});
