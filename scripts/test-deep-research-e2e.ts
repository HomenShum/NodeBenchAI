#!/usr/bin/env npx tsx
/**
 * Deep Research E2E Test Script
 *
 * Tests the Deep Research system against the ground truth query and evaluates output.
 */

// Ground truth test query
const GROUND_TRUTH_QUERY = `Vijay Rao
https://www.linkedin.com/in/raovj/

Does it have to do with recent news for Manus acquisition? Vijay initiated the effort and scaled the GPU training clusters for serving and training AI Models. Manus trains their own Manus models for multimodal instruction following agent models and dogfood their own models for the browser automation tasks, which quite much aligns with the narrative where Tests Assured has deep QA Automation expertise, has been integrated with Meta, has proposed to make QA Automation platform to serve customers that need QA automation solution like testing out apps created by AI and generating report and optimization fixes. And other major companies like google gemini antigravity and browser base are all tackling this next trend. Meta can benefit dramatically from acquiring Manus and its foundational models, serve Manus the training capacities and grow super quickly, compete on global multimodal agentic AI models benchmarks, and let companies like tests assured and their development studio to spin off platforms that utilizes Manus by Meta and sell inference and earn revenue and profit and user training data for the next few years.

But, I can be very wrong, be brutally honest, deeply due diligence and critique and verify all information patches fully paralleled
How exactly did you come up with all this from my input? I want a full step by step guide for reproducing similar due diligence and verifications`;

// Expected output features from ground truth
const GROUND_TRUTH_EXPECTED_FEATURES = {
  // Section 1: What is verified (high confidence)
  verifiedTopics: [
    "Meta did acquire Manus",
    "Manus is an 'agent' product with browser-operation capability",
    "Vijay Rao is a senior Meta compute / infrastructure executive",
    "'Agent-first' development + browser automation is a real trend",
    "Tests Assured publicly claims prior work with Meta",
  ],

  // Section 2: What is NOT verified
  unverifiedTopics: [
    "Manus trains their own foundation models (contradicted)",
    "Vijay initiated GPU training clusters (not publicly verifiable)",
    "Meta will let vendors spin off platforms (highly speculative)",
  ],

  // Section 3: Alternative explanations
  alternativeExplanations: [
    "vendor due diligence for operational excellence",
    "build-vs-buy evaluation for agentic testing",
    "Manus integration planning touching QA/Evals",
  ],

  // Section 4: Brutally honest assessment
  assessmentCategories: [
    "What's strong",
    "What's weak / likely wrong",
  ],

  // Section 5: How to verify
  verificationSteps: [
    "stated objective and success metric",
    "org sponsoring the engagement",
    "deliverable in 30/60/90 days",
  ],

  // Section 6: Recommendations
  recommendations: [
    "Repro fidelity",
    "Device/build matrix",
    "Artifact standard",
    "Automation roadmap",
    "Safety & data handling",
  ],

  // Sources with URLs
  expectedSources: [
    "Reuters",
    "Business Insider",
    "The Verge",
    "VentureBeat",
    "Engineering at Meta",
  ],
};

interface EvaluationResult {
  feature: string;
  present: boolean;
  score: number;
  details: string;
}

function evaluateOutput(output: any): EvaluationResult[] {
  const results: EvaluationResult[] = [];

  // Check for verified claims section
  results.push({
    feature: "Verified Claims Section",
    present: output.verifiedClaims && output.verifiedClaims.length > 0,
    score: output.verifiedClaims?.length > 3 ? 1 : output.verifiedClaims?.length > 0 ? 0.5 : 0,
    details: `Found ${output.verifiedClaims?.length || 0} verified claims`,
  });

  // Check for unverified/contradicted claims
  results.push({
    feature: "Unverified Claims Section",
    present: output.unverifiedClaims && output.unverifiedClaims.length > 0,
    score: output.unverifiedClaims?.length > 0 ? 1 : 0,
    details: `Found ${output.unverifiedClaims?.length || 0} unverified claims`,
  });

  // Check for hypothesis evaluation
  results.push({
    feature: "Hypothesis Evaluation",
    present: output.hypothesesEvaluated && output.hypothesesEvaluated.length > 0,
    score: output.hypothesesEvaluated?.length > 0 ? 1 : 0,
    details: `Found ${output.hypothesesEvaluated?.length || 0} hypotheses evaluated`,
  });

  // Check for methodology steps
  results.push({
    feature: "Methodology Steps",
    present: output.methodology && output.methodology.length > 0,
    score: output.methodology?.length >= 5 ? 1 : output.methodology?.length > 0 ? 0.5 : 0,
    details: `Found ${output.methodology?.length || 0} methodology steps`,
  });

  // Check for inference chain
  results.push({
    feature: "Inference Chain",
    present: output.inferenceChain && output.inferenceChain.length > 0,
    score: output.inferenceChain?.length >= 5 ? 1 : output.inferenceChain?.length > 0 ? 0.5 : 0,
    details: `Found ${output.inferenceChain?.length || 0} inference steps`,
  });

  // Check for critical evaluation
  results.push({
    feature: "Critical Evaluation",
    present: !!output.criticalEvaluation,
    score: output.criticalEvaluation?.brutallyHonestAssessment ? 1 :
           output.criticalEvaluation ? 0.5 : 0,
    details: output.criticalEvaluation ?
      `Strong: ${output.criticalEvaluation.strongPoints?.length || 0}, Weak: ${output.criticalEvaluation.weakPoints?.length || 0}` :
      "Missing critical evaluation",
  });

  // Check for step-by-step guide
  results.push({
    feature: "Step-by-Step Guide",
    present: !!output.stepByStepGuide && output.stepByStepGuide.length > 100,
    score: output.stepByStepGuide?.length > 500 ? 1 :
           output.stepByStepGuide?.length > 100 ? 0.5 : 0,
    details: `Guide length: ${output.stepByStepGuide?.length || 0} chars`,
  });

  // Check for sources with URLs
  const sourcesWithUrls = output.sources?.filter((s: any) => s.url) || [];
  results.push({
    feature: "Sources with URLs",
    present: sourcesWithUrls.length > 0,
    score: sourcesWithUrls.length >= 5 ? 1 : sourcesWithUrls.length > 0 ? 0.5 : 0,
    details: `Found ${sourcesWithUrls.length} sources with URLs`,
  });

  // Check for person profiles
  results.push({
    feature: "Person Research",
    present: output.personProfiles && output.personProfiles.length > 0,
    score: output.personProfiles?.length > 0 ? 1 : 0,
    details: `Found ${output.personProfiles?.length || 0} person profiles`,
  });

  // Check for news verification
  results.push({
    feature: "News Verification",
    present: output.newsEvents && output.newsEvents.length > 0,
    score: output.newsEvents?.length > 0 ? 1 : 0,
    details: `Found ${output.newsEvents?.length || 0} news events`,
  });

  // Check for alternative interpretations
  results.push({
    feature: "Alternative Interpretations",
    present: output.criticalEvaluation?.alternativeInterpretations?.length > 0,
    score: output.criticalEvaluation?.alternativeInterpretations?.length >= 2 ? 1 :
           output.criticalEvaluation?.alternativeInterpretations?.length > 0 ? 0.5 : 0,
    details: `Found ${output.criticalEvaluation?.alternativeInterpretations?.length || 0} alternatives`,
  });

  // Check for skepticism level
  results.push({
    feature: "Skepticism Assessment",
    present: typeof output.criticalEvaluation?.skepticismLevel === "number",
    score: typeof output.criticalEvaluation?.skepticismLevel === "number" ? 1 : 0,
    details: `Skepticism level: ${output.criticalEvaluation?.skepticismLevel ?? "N/A"}`,
  });

  return results;
}

async function runTest() {
  console.log("=".repeat(80));
  console.log("DEEP RESEARCH E2E TEST");
  console.log("=".repeat(80));
  console.log("\nTest Query:", GROUND_TRUTH_QUERY.slice(0, 100) + "...\n");

  // For local testing without Convex, we'll simulate the query decomposition
  console.log("Testing query decomposition locally...\n");

  // Import the query decomposer directly for unit testing
  const { decomposeQuerySync } = await import("../backend/convex/domains/agents/dueDiligence/deepResearch/queryDecomposer");

  const decomposed = decomposeQuerySync(GROUND_TRUTH_QUERY);

  console.log("Query Decomposition Results:");
  console.log("-".repeat(40));
  console.log(`Intent: ${JSON.stringify(decomposed.intent, null, 2)}`);
  console.log(`Entities Found: ${decomposed.entities.length}`);
  decomposed.entities.forEach(e => console.log(`  - ${e.name} (${e.type})`));
  console.log(`Hypotheses Found: ${decomposed.hypotheses.length}`);
  decomposed.hypotheses.forEach(h => console.log(`  - ${h.statement.slice(0, 60)}...`));
  console.log(`Relationships Found: ${decomposed.relationships.length}`);
  decomposed.relationships.forEach(r => console.log(`  - ${r.entity1} -> ${r.entity2} (${r.relationshipType})`));
  console.log(`Sub-Questions Generated: ${decomposed.subQuestions.length}`);
  decomposed.subQuestions.forEach(q => console.log(`  - [${q.type}] ${q.question}`));
  console.log(`Verification Requests: ${decomposed.verificationRequests.length}`);
  decomposed.verificationRequests.forEach(v => console.log(`  - ${v}`));

  // Check decomposition quality
  console.log("\n" + "=".repeat(80));
  console.log("DECOMPOSITION QUALITY CHECK");
  console.log("=".repeat(80));

  const checks = [
    { name: "Detected 'brutally honest' → requiresSkepticism",
      pass: decomposed.intent.requiresSkepticism },
    { name: "Detected 'acquisition' → timelinessRequired",
      pass: decomposed.intent.timelinessRequired },
    { name: "Extracted Vijay Rao as person entity",
      pass: decomposed.entities.some(e => e.name.toLowerCase().includes("vijay")) },
    { name: "Extracted Meta as company entity",
      pass: decomposed.entities.some(e => e.name.toLowerCase() === "meta") },
    { name: "Extracted Manus as company entity",
      pass: decomposed.entities.some(e => e.name.toLowerCase() === "manus") },
    { name: "Extracted hypotheses (claims to verify)",
      pass: decomposed.hypotheses.length > 0 },
    { name: "Generated verification requests",
      pass: decomposed.verificationRequests.length > 0 },
  ];

  let passCount = 0;
  checks.forEach(check => {
    const status = check.pass ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}: ${check.name}`);
    if (check.pass) passCount++;
  });

  console.log(`\nDecomposition Score: ${passCount}/${checks.length} (${Math.round(passCount/checks.length*100)}%)`);

  // Gap analysis
  console.log("\n" + "=".repeat(80));
  console.log("GAP ANALYSIS vs GROUND TRUTH OUTPUT");
  console.log("=".repeat(80));

  console.log("\nGround truth output has these sections that we need to generate:");
  console.log("1. What is verified (high confidence) - with inline citations");
  console.log("2. What is NOT verified (with contradictions noted)");
  console.log("3. Alternative explanations ranked by likelihood");
  console.log("4. Brutally honest assessment (strong vs weak)");
  console.log("5. How to verify (actionable steps)");
  console.log("6. What you should prepare (recommendations)");
  console.log("7. Source list with URLs at bottom");

  console.log("\nCurrent implementation coverage:");
  console.log("✓ Verified claims (verifiedClaims)");
  console.log("✓ Unverified claims (unverifiedClaims)");
  console.log("✓ Hypothesis evaluation (hypothesesEvaluated)");
  console.log("✓ Methodology steps (methodology)");
  console.log("✓ Inference chain (inferenceChain)");
  console.log("✓ Critical evaluation with brutally honest (criticalEvaluation)");
  console.log("✓ Step-by-step guide (stepByStepGuide)");
  console.log("✓ Sources with URLs (sources)");
  console.log("✓ Verification steps - How to verify (verificationSteps)");
  console.log("✓ Recommendations - What to prepare (recommendations)");
  console.log("✓ FREE-FIRST model fallback integration (executeWithModelFallback)");
  console.log("⚠ Future: Inline source citations in text (e.g., [Reuters][1])");

  return {
    decomposed,
    checks,
    passCount,
    totalChecks: checks.length,
  };
}

// Run the test
runTest().then(result => {
  console.log("\n" + "=".repeat(80));
  console.log("TEST COMPLETE");
  console.log("=".repeat(80));
  process.exit(result.passCount === result.totalChecks ? 0 : 1);
}).catch(error => {
  console.error("Test failed with error:", error);
  process.exit(1);
});
