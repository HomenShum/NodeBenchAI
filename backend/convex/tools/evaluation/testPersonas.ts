
import {
    evaluateBankerPersona,
    evaluateVCPersona,
    evaluateCTOPersona,
    evaluateFounderStrategyPersona,
    evaluateAcademicRDPersona,
    evaluateEnterpriseExecPersona,
    evaluateEcosystemPartnerPersona,
    evaluateQuantAnalystPersona,
    type EnrichedEntityPayload
} from "../../domains/knowledge/entityInsights";
import { action } from "../../_generated/server";

const HOLLOW_ENTITY: EnrichedEntityPayload = {
    entityId: "hollow_1",
    entityType: "private_company",
    summary: "A generic AI company",
    // Missing all high-value fields
};

const BANKER_GRADE_ENTITY: EnrichedEntityPayload = {
    entityId: "banker_1",
    entityType: "private_company",
    summary: "A deeply enriched AI company",
    funding: {
        lastRound: { roundType: "Series A", amount: { amount: 15, unit: "M", currency: "USD" }, participants: ["Sequoia", "Benchmark"] },
        bankerTakeaway: "Strong unit economics, ready for scale."
    },
    crmFields: { hqLocation: "San Francisco, CA" },
    contactPoints: { primary: { channel: "email", value: "ceo@example.com" } },
    recentNews: { items: [{ title: "New funding", publishedDate: new Date().toISOString() }] },
    sources: [{ name: "Pitchbook", url: "pitchbook.com", sourceType: "primary" }, { name: "TechCrunch", url: "techcrunch.com", sourceType: "secondary" }],
    freshness: { newsAgeDays: 2, withinBankerWindow: true },
    productPipeline: {
        platform: "Agentic OS",
        modalities: ["Text", "Voice"],
        differentiation: ["Proprietary kernel", "Low latency"],
        leadPrograms: [{ program: "Core" }]
    },
    // NEW FIELDS
    performanceMetrics: { failureRate: 0.1, churn: 1.5, latency: 45, uptime: 99.99 },
    financials: { burnRate: 200000, costToServe: 0.5, revenue: 5000000 },
    academicData: { methodology: "Transformer++ with recurrence", citations: 150 },
    ecosystem: { dependencies: ["CUDA", "PyTorch"], downstreamImpact: ["FinTech", "HealthTech"], secondOrderEffects: ["GPU shortage"] },
    technicalSpecs: { cveIds: [], repoStats: { stars: 5000, forks: 400, issues: 20, contributors: 50, starVelocity: 150 } }
};

export const runPersonaTest = action({
    args: {},
    handler: async (ctx) => {
        const results: Array<{ persona: string; hollowPass: boolean; fullPass: boolean }> = [];

        // Test 1: JPM Banker
        const bankerHollow = evaluateBankerPersona(HOLLOW_ENTITY);
        const bankerFull = evaluateBankerPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "JPM Banker", hollowPass: bankerHollow.passCriteria.length > 0 && bankerHollow.failTriggers.length > 0, fullPass: bankerFull.failTriggers.length === 0 });

        // Test 2: VC
        const vcHollow = evaluateVCPersona(HOLLOW_ENTITY);
        const vcFull = evaluateVCPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "Series A VC", hollowPass: vcHollow.failTriggers.length > 0, fullPass: vcFull.failTriggers.length === 0 });

        // Test 3: CTO
        const ctoHollow = evaluateCTOPersona(HOLLOW_ENTITY);
        const ctoFull = evaluateCTOPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "CTO", hollowPass: ctoHollow.failTriggers.length > 0, fullPass: ctoFull.failTriggers.length === 0 });

        // Test 4: Founder
        const founderHollow = evaluateFounderStrategyPersona(HOLLOW_ENTITY);
        const founderFull = evaluateFounderStrategyPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "Founder (Pivot)", hollowPass: founderHollow.failTriggers.length > 0, fullPass: founderFull.failTriggers.length === 0 });

        // Test 5: Academic
        const academicHollow = evaluateAcademicRDPersona(HOLLOW_ENTITY);
        const academicFull = evaluateAcademicRDPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "Academic Lead", hollowPass: academicHollow.failTriggers.length > 0, fullPass: academicFull.failTriggers.length === 0 });

        // Test 6: Enterprise Exec
        const execHollow = evaluateEnterpriseExecPersona(HOLLOW_ENTITY);
        const execFull = evaluateEnterpriseExecPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "Enterprise Exec", hollowPass: execHollow.failTriggers.length > 0, fullPass: execFull.failTriggers.length === 0 });

        // Test 7: Ecosystem
        const ecoHollow = evaluateEcosystemPartnerPersona(HOLLOW_ENTITY);
        const ecoFull = evaluateEcosystemPartnerPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "Ecosystem Partner", hollowPass: ecoHollow.failTriggers.length > 0, fullPass: ecoFull.failTriggers.length === 0 });

        // Test 8: Quant
        const quantHollow = evaluateQuantAnalystPersona(HOLLOW_ENTITY);
        const quantFull = evaluateQuantAnalystPersona(BANKER_GRADE_ENTITY);
        results.push({ persona: "Quant Analyst", hollowPass: quantHollow.failTriggers.length > 0, fullPass: quantFull.failTriggers.length === 0 });

        return {
            status: "COMPLETED",
            results
        };
    }
});
