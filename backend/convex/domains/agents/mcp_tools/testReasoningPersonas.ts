/**
 * Test Reasoning Tool Across Personas
 *
 * Validates reasoning tool quality and cost for each persona's use cases
 */

import { internalAction } from "../../../_generated/server";

/**
 * Test JPM_STARTUP_BANKER: Deal Thesis Generation
 */
export const testJPMBankerThesis = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: JPM_STARTUP_BANKER - Deal Thesis with Reasoning");
    console.log("=".repeat(80));

    try {
      // Mock deal data
      const dealData = {
        company: "TechStartup Inc.",
        round: "Series B",
        amount: "$25M",
        valuation: "$100M",
        traction: "10M ARR, 200% YoY growth",
        team: "Former founders with 1 exit",
        market: "AI-powered analytics, $5B TAM",
        competition: "3 well-funded competitors",
      };

      const startTime = Date.now();

      // Import reasoning tool
      const { getReasoning } = await import("./reasoningTool");

      const result = await getReasoning(ctx, {
        prompt: `Generate investment thesis for ${dealData.company}:

Company: ${dealData.company}
Round: ${dealData.round}
Amount: ${dealData.amount}
Valuation: ${dealData.valuation}
Traction: ${dealData.traction}
Team: ${dealData.team}
Market: ${dealData.market}
Competition: ${dealData.competition}

Think step-by-step about:
1. Market opportunity and timing
2. Competitive positioning
3. Team quality and execution
4. Financial metrics and unit economics
5. Risks and mitigation strategies
6. Investment recommendation`,
        systemPrompt: "You are a JPMorgan startup investment banker.",
        maxTokens: 1500,
        extractStructured: true,
      });

      const duration = Date.now() - startTime;

      console.log("\n📊 RESULTS:");
      console.log(`✅ Success: ${result.success}`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`💰 Cost: $${result.cost.toFixed(6)}`);
      console.log(`🧠 Reasoning Tokens: ${result.reasoningTokens || "N/A"}`);

      if (result.structured) {
        console.log(`\n📝 Structured Output:`);
        console.log(`   Main Points: ${result.structured.mainPoints?.length || 0}`);
        console.log(`   Summary: ${result.structured.summary?.slice(0, 100)}...`);
        console.log(`   Conclusion: ${result.structured.conclusion?.slice(0, 100)}...`);
      }

      console.log(`\n💡 Raw Content Preview:`);
      console.log(`   ${result.content.slice(0, 300)}...`);

      // Quality assessment
      const quality = assessJPMThesisQuality(result);
      console.log(`\n✨ Quality Score: ${quality.score}%`);
      console.log(`   Completeness: ${quality.completeness ? "✅" : "❌"}`);
      console.log(`   Risk Coverage: ${quality.riskCoverage ? "✅" : "❌"}`);
      console.log(`   Action Items: ${quality.hasActions ? "✅" : "❌"}`);

      return {
        success: true,
        persona: "JPM_STARTUP_BANKER",
        useCase: "deal_thesis",
        duration,
        cost: result.cost,
        quality,
        recommendation: quality.score >= 80 ? "DEPLOY" : "NEEDS_IMPROVEMENT",
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Test CTO_TECH_LEAD: Security Impact Assessment
 */
export const testCTOSecurityAssessment = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: CTO_TECH_LEAD - Security Impact Assessment");
    console.log("=".repeat(80));

    try {
      const cveData = {
        cve: "CVE-2024-1234",
        severity: "Critical",
        description: "Remote code execution vulnerability in logging library",
        affectedVersions: "log4j 2.0-2.16",
        cvssScore: "9.8",
        exploitAvailable: true,
      };

      const systemContext = {
        dependencies: "log4j 2.14 in production",
        exposure: "Public-facing API",
        dataAccess: "Customer data, PII",
        uptime: "99.9% SLA",
      };

      const { getReasoning } = await import("./reasoningTool");

      const result = await getReasoning(ctx, {
        prompt: `Assess security impact of ${cveData.cve}:

CVE: ${cveData.cve}
Severity: ${cveData.severity}
Description: ${cveData.description}
Affected: ${cveData.affectedVersions}
CVSS: ${cveData.cvssScore}
Exploit Available: ${cveData.exploitAvailable}

Our System:
Dependencies: ${systemContext.dependencies}
Exposure: ${systemContext.exposure}
Data: ${systemContext.dataAccess}
SLA: ${systemContext.uptime}

Think critically about:
1. Attack vector feasibility
2. Data exposure risk level
3. Service availability impact
4. Cascade effects on dependent systems
5. Immediate mitigation priority
6. Long-term remediation plan`,
        systemPrompt: "You are a security architect performing threat analysis.",
        maxTokens: 2000,
        extractStructured: true,
      });

      console.log("\n📊 RESULTS:");
      console.log(`✅ Success: ${result.success}`);
      console.log(`⏱️  Duration: ${(result.duration / 1000).toFixed(2)}s`);
      console.log(`💰 Cost: $${result.cost.toFixed(6)}`);
      console.log(`🧠 Reasoning Tokens: ${result.reasoningTokens || "N/A"}`);

      if (result.structured) {
        console.log(`\n📝 Structured Analysis:`);
        console.log(`   Main Points: ${result.structured.mainPoints?.length || 0}`);
        console.log(`   Summary: ${result.structured.summary?.slice(0, 100)}...`);
      }

      const quality = assessCTOSecurityQuality(result);
      console.log(`\n✨ Quality Score: ${quality.score}%`);
      console.log(`   Threat Analysis: ${quality.threatAnalysis ? "✅" : "❌"}`);
      console.log(`   Mitigations: ${quality.hasMitigations ? "✅" : "❌"}`);
      console.log(`   Timeline: ${quality.hasTimeline ? "✅" : "❌"}`);

      return {
        success: true,
        persona: "CTO_TECH_LEAD",
        useCase: "security_assessment",
        duration: result.duration,
        cost: result.cost,
        quality,
        recommendation: quality.score >= 90 ? "DEPLOY" : "NEEDS_IMPROVEMENT",
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Test EARLY_STAGE_VC: Investment Thesis
 */
export const testVCInvestmentThesis = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: EARLY_STAGE_VC - Investment Thesis with Reasoning");
    console.log("=".repeat(80));

    try {
      const startupData = {
        company: "DevTools Co.",
        stage: "Seed",
        ask: "$2M",
        valuation: "$10M",
        founders: "Ex-Google engineers, 2nd time founders",
        traction: "5K users, $50K MRR, 40% MoM growth",
        market: "Developer tools, $10B TAM",
        competition: "GitHub Copilot, TabNine, Cursor",
      };

      const { analyzeStrategically } = await import("./reasoningTool");

      const result = await analyzeStrategically(ctx, {
        topic: `Seed investment analysis for ${startupData.company}`,
        context: `
Company: ${startupData.company}
Stage: ${startupData.stage}
Ask: ${startupData.ask}
Valuation: ${startupData.valuation}
Founders: ${startupData.founders}
Traction: ${startupData.traction}
Market: ${startupData.market}
Competition: ${startupData.competition}
        `,
        focusAreas: ["founder quality", "market timing", "traction", "competitive moat"],
      });

      console.log("\n📊 RESULTS:");
      console.log(`✅ Success: ${result.success}`);
      console.log(`⏱️  Duration: ${(result.duration! / 1000).toFixed(2)}s`);
      console.log(`💰 Cost: $${result.cost?.toFixed(6)}`);

      if (result.analysis) {
        console.log(`\n📝 Strategic Analysis:`);
        console.log(`   Key Factors: ${result.analysis.keyFactors?.length || 0}`);
        console.log(`   Strengths: ${result.analysis.strengths?.length || 0}`);
        console.log(`   Weaknesses: ${result.analysis.weaknesses?.length || 0}`);
        console.log(`   Opportunities: ${result.analysis.opportunities?.length || 0}`);
        console.log(`   Threats: ${result.analysis.threats?.length || 0}`);
        console.log(`   Strategic Options: ${result.analysis.strategicOptions?.length || 0}`);
        console.log(`   Recommendation: ${result.analysis.recommendation?.slice(0, 100)}...`);
      }

      const quality = assessVCThesisQuality(result);
      console.log(`\n✨ Quality Score: ${quality.score}%`);

      return {
        success: true,
        persona: "EARLY_STAGE_VC",
        useCase: "investment_thesis",
        duration: result.duration,
        cost: result.cost,
        quality,
        recommendation: quality.score >= 75 ? "DEPLOY" : "NEEDS_IMPROVEMENT",
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Test FOUNDER_STRATEGY: Competitive Positioning
 */
export const testFounderCompetitiveAnalysis = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: FOUNDER_STRATEGY - Competitive Positioning");
    console.log("=".repeat(80));

    try {
      const companyData = {
        company: "MyStartup",
        product: "AI-powered CRM",
        stage: "Series A",
        arr: "$5M",
        customers: "150 SMBs",
        pricing: "$500/seat/month",
        competitors: "Salesforce, HubSpot, Pipedrive",
        differentiator: "AI automation + vertical specialization",
      };

      const { analyzeStrategically } = await import("./reasoningTool");

      const result = await analyzeStrategically(ctx, {
        topic: `Competitive positioning for ${companyData.company}`,
        context: `
Product: ${companyData.product}
Stage: ${companyData.stage}
ARR: ${companyData.arr}
Customers: ${companyData.customers}
Pricing: ${companyData.pricing}
Competitors: ${companyData.competitors}
Differentiator: ${companyData.differentiator}
        `,
        focusAreas: ["differentiation", "pricing power", "go-to-market", "defensibility"],
      });

      console.log("\n📊 RESULTS:");
      console.log(`✅ Success: ${result.success}`);
      console.log(`⏱️  Duration: ${(result.duration! / 1000).toFixed(2)}s`);
      console.log(`💰 Cost: $${result.cost?.toFixed(6)}`);

      if (result.analysis) {
        console.log(`\n📝 Strategic Positioning:`);
        console.log(`   Strengths: ${result.analysis.strengths?.length || 0}`);
        console.log(`   Strategic Options: ${result.analysis.strategicOptions?.length || 0}`);
        result.analysis.strategicOptions?.forEach((opt: any, i: number) => {
          console.log(`      ${i + 1}. ${opt.option}`);
          console.log(`         Pros: ${opt.pros?.length || 0}, Cons: ${opt.cons?.length || 0}`);
        });
        console.log(`   Recommendation: ${result.analysis.recommendation?.slice(0, 100)}...`);
      }

      const quality = assessFounderStrategyQuality(result);
      console.log(`\n✨ Quality Score: ${quality.score}%`);

      return {
        success: true,
        persona: "FOUNDER_STRATEGY",
        useCase: "competitive_positioning",
        duration: result.duration,
        cost: result.cost,
        quality,
        recommendation: quality.score >= 75 ? "DEPLOY" : "NEEDS_IMPROVEMENT",
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Run all persona tests
 */
export const testAllPersonas = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("COMPREHENSIVE TEST: Reasoning Tool Across Personas");
    console.log("=".repeat(80));

    const results: Array<{
      success: boolean;
      cost?: number;
      duration?: number;
      recommendation?: string;
      persona?: string;
      useCase?: string;
      quality?: {score?: number};
      error?: any;
    }> = [];

    console.log("\n1️⃣  Testing JPM_STARTUP_BANKER...");
    const jpmResult = await testJPMBankerThesis(ctx, {});
    results.push(jpmResult);

    console.log("\n2️⃣  Testing CTO_TECH_LEAD...");
    const ctoResult = await testCTOSecurityAssessment(ctx, {});
    results.push(ctoResult);

    console.log("\n3️⃣  Testing EARLY_STAGE_VC...");
    const vcResult = await testVCInvestmentThesis(ctx, {});
    results.push(vcResult);

    console.log("\n4️⃣  Testing FOUNDER_STRATEGY...");
    const founderResult = await testFounderCompetitiveAnalysis(ctx, {});
    results.push(founderResult);

    console.log("\n" + "=".repeat(80));
    console.log("📊 SUMMARY");
    console.log("=".repeat(80));

    const successful = results.filter(r => r.success);
    const totalCost = results.reduce((sum, r) => sum + (r.cost || 0), 0);
    const avgDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length;
    const deployRecommended = results.filter(r => r.recommendation === "DEPLOY");

    console.log(`\n✅ Tests Passed: ${successful.length}/${results.length}`);
    console.log(`💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`⏱️  Average Duration: ${(avgDuration / 1000).toFixed(2)}s`);
    console.log(`🎯 Deploy Recommended: ${deployRecommended.length}/${results.length} personas`);

    console.log(`\n📋 By Persona:`);
    results.forEach(r => {
      if (r.success) {
        const status = r.recommendation === "DEPLOY" ? "✅" : "⚠️";
        console.log(`   ${status} ${r.persona}: ${r.useCase}`);
        console.log(`      Quality: ${r.quality?.score}%, Cost: $${r.cost?.toFixed(6)}, Duration: ${(r.duration! / 1000).toFixed(2)}s`);
      } else {
        console.log(`   ❌ ${r.persona}: FAILED - ${r.error}`);
      }
    });

    console.log(`\n🎯 FINAL RECOMMENDATION:`);
    if (deployRecommended.length >= results.length * 0.75) {
      console.log(`   ✅ DEPLOY to production for tested personas`);
      console.log(`   Cost: $${totalCost.toFixed(6)} per test run`);
      console.log(`   Quality: High across strategic personas`);
      console.log(`   Latency: ${(avgDuration / 1000).toFixed(2)}s average (acceptable for non-real-time)`);
    } else {
      console.log(`   ⚠️  NEEDS IMPROVEMENT`);
      console.log(`   Only ${deployRecommended.length}/${results.length} personas passed quality threshold`);
    }

    return {
      success: true,
      results,
      summary: {
        totalTests: results.length,
        passed: successful.length,
        totalCost,
        avgDuration,
        deployRecommended: deployRecommended.length,
      },
    };
  },
});

// Quality assessment functions

function assessJPMThesisQuality(result: any): { score: number; completeness: boolean; riskCoverage: boolean; hasActions: boolean } {
  const content = result.content.toLowerCase();
  const structured = result.structured;

  let score = 0;

  // Completeness (40 points)
  const hasMarket = content.includes("market") || content.includes("tam");
  const hasTeam = content.includes("team") || content.includes("founder");
  const hasFinancials = content.includes("valuation") || content.includes("metrics");
  const hasCompetition = content.includes("compet");
  if (hasMarket) score += 10;
  if (hasTeam) score += 10;
  if (hasFinancials) score += 10;
  if (hasCompetition) score += 10;

  // Risk coverage (30 points)
  const hasRisks = content.includes("risk") || content.includes("threat") || content.includes("challenge");
  const multipleRisks = (content.match(/risk/gi) || []).length >= 3;
  if (hasRisks) score += 15;
  if (multipleRisks) score += 15;

  // Action items (30 points)
  const hasRecommendation = content.includes("recommend") || structured?.conclusion;
  const hasNextSteps = content.includes("next") || content.includes("action");
  if (hasRecommendation) score += 20;
  if (hasNextSteps) score += 10;

  return {
    score: Math.min(100, score),
    completeness: hasMarket && hasTeam && hasFinancials,
    riskCoverage: multipleRisks,
    hasActions: hasRecommendation && hasNextSteps,
  };
}

function assessCTOSecurityQuality(result: any): { score: number; threatAnalysis: boolean; hasMitigations: boolean; hasTimeline: boolean } {
  const content = result.content.toLowerCase();
  const structured = result.structured;

  let score = 0;

  // Threat analysis (40 points)
  const hasExposure = content.includes("exposure") || content.includes("attack");
  const hasImpact = content.includes("impact") || content.includes("risk");
  const hasDataAssessment = content.includes("data") || content.includes("pii");
  const hasAvailability = content.includes("availability") || content.includes("downtime");
  if (hasExposure) score += 10;
  if (hasImpact) score += 10;
  if (hasDataAssessment) score += 10;
  if (hasAvailability) score += 10;

  // Mitigations (40 points)
  const hasMitigations = content.includes("mitigat") || content.includes("remediat");
  const hasImmediate = content.includes("immediate") || content.includes("urgent");
  const hasLongTerm = content.includes("long") || content.includes("strategic");
  const multipleMitigations = (content.match(/patch|update|fix|remediat/gi) || []).length >= 3;
  if (hasMitigations) score += 10;
  if (hasImmediate) score += 10;
  if (hasLongTerm) score += 10;
  if (multipleMitigations) score += 10;

  // Timeline (20 points)
  const hasTimeline = content.includes("timeline") || content.includes("priority");
  const hasUrgency = content.includes("critical") || content.includes("immediate");
  if (hasTimeline) score += 10;
  if (hasUrgency) score += 10;

  return {
    score: Math.min(100, score),
    threatAnalysis: hasExposure && hasImpact,
    hasMitigations: hasMitigations && multipleMitigations,
    hasTimeline: hasTimeline && hasUrgency,
  };
}

function assessVCThesisQuality(result: any): { score: number } {
  const analysis = result.analysis;

  let score = 0;

  if (analysis?.keyFactors && analysis.keyFactors.length >= 4) score += 20;
  if (analysis?.strengths && analysis.strengths.length >= 3) score += 20;
  if (analysis?.weaknesses && analysis.weaknesses.length >= 2) score += 15;
  if (analysis?.opportunities && analysis.opportunities.length >= 2) score += 15;
  if (analysis?.threats && analysis.threats.length >= 2) score += 15;
  if (analysis?.strategicOptions && analysis.strategicOptions.length >= 2) score += 10;
  if (analysis?.recommendation && analysis.recommendation.length > 50) score += 5;

  return { score: Math.min(100, score) };
}

function assessFounderStrategyQuality(result: any): { score: number } {
  const analysis = result.analysis;

  let score = 0;

  if (analysis?.keyFactors && analysis.keyFactors.length >= 3) score += 20;
  if (analysis?.strengths && analysis.strengths.length >= 3) score += 20;
  if (analysis?.weaknesses && analysis.weaknesses.length >= 2) score += 15;
  if (analysis?.opportunities && analysis.opportunities.length >= 2) score += 15;
  if (analysis?.strategicOptions && analysis.strategicOptions.length >= 2) score += 20;
  if (analysis?.recommendation && analysis.recommendation.length > 50) score += 10;

  return { score: Math.min(100, score) };
}
