/**
 * @vitest-environment node
 */

import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createSearchRouter } from "./routes/search.js";
import { synthesizeResults, type HarnessExecution } from "./agentHarness.js";
import type { McpTool } from "../packages/mcp-local/src/types.js";

const weeklyResetTool: McpTool = {
  name: "founder_local_weekly_reset",
  description: "Returns a deterministic weekly reset packet for tests.",
  inputSchema: {},
  handler: async () => ({
    summary: "Weekly founder reset summary",
    confidence: 82,
    keyFindings: ["Ship streaming support"],
    risks: ["Streaming can silently regress without contract coverage"],
    nextSteps: ["Deploy the unified GET/POST route"],
  }),
};

const founderDirectionTool: McpTool = {
  name: "founder_direction_assessment",
  description: "Returns deterministic founder direction pressure-test output for tests.",
  inputSchema: {},
  handler: async () => ({
    assessmentId: "assess_test",
    packetId: "packet_test",
    packetType: "founder_direction_assessment",
    generatedAt: new Date().toISOString(),
    generatedBy: "founder_local_pipeline",
    query: "founder weekly reset",
    lens: "founder",
    summary: "Pressure test completed.",
    confidence: 88,
    sourceRefs: [
      {
        id: "source:claude",
        label: "CLAUDE.md",
        title: "Product identity",
        type: "local",
        status: "cited",
        excerpt: "Local product identity",
      },
    ],
    strategicAngles: [
      {
        id: "stealth-moat",
        title: "Stealth and moat timing",
        status: "watch",
        summary: "Stay relatively stealthy until the moat and market diligence are clearer.",
        whyItMatters: "Premature posting can teach the market what we are doing before the wedge is harder to copy.",
        evidenceRefIds: ["source:claude"],
        nextQuestion: "What are competitors actually doing, and what moat justifies posting now?",
      },
      {
        id: "team-shape",
        title: "Team shape",
        status: "watch",
        summary: "The team needs stronger complementary GTM coverage.",
        whyItMatters: "Founder edge is necessary but not sufficient.",
        evidenceRefIds: ["source:claude"],
        nextQuestion: "What complementary capability closes the GTM gap fastest?",
      },
    ],
    recommendedNextAction: "Resolve team shape before broadening the roadmap.",
    nextQuestions: ["What complementary capability closes the GTM gap fastest?"],
    issueAngles: ["team-shape"],
    progressionProfile: {
      currentStage: "foundation",
      currentStageLabel: "Stage 1: Foundation",
      readinessScore: 62,
      missingFoundations: ["Investor-ready memo"],
      hiddenRisks: ["Team shape remains narrow"],
      nextUnlocks: [
        {
          id: "useful-packet",
          title: "Generate one useful founder packet and use it in a real decision",
          status: "ready",
          requiredSignals: ["Founder packet exported"],
        },
      ],
      delegableWork: ["Prepare the Slack report"],
      founderOnlyWork: ["Choose the wedge"],
      onTrackStatus: "watch",
      recommendedNextAction: "Resolve team shape before broadening the roadmap.",
    },
    progressionTiers: [
      { id: "clarity", label: "Stage 0: Clarity", priceLabel: "Free", unlocks: [], services: [] },
      { id: "foundation", label: "Stage 1: Foundation", priceLabel: "$1", unlocks: [], services: [] },
    ],
    diligencePack: {
      id: "ai_software",
      label: "AI / Software Diligence Pack",
      summary: "Workflow adoption and installability proof.",
      externalEvaluators: ["Developers"],
      evidenceClasses: [],
      requirements: [],
      highRiskClaims: ["workflow lock-in"],
      materials: ["Founder packet", "Slack one-page report"],
      readyDefinition: "Ready when the workflow is installable and benchmarked.",
    },
    readinessScore: 62,
    unlocks: [
      {
        id: "useful-packet",
        title: "Generate one useful founder packet and use it in a real decision",
        status: "ready",
        requiredSignals: ["Founder packet exported"],
      },
    ],
    materialsChecklist: [
      {
        id: "material:1",
        label: "Slack one-page report",
        status: "watch",
        audience: "external",
        whyItMatters: "Makes the founder packet easy to share.",
      },
    ],
    scorecards: [
      {
        id: "two_week",
        label: "2-week scorecard",
        status: "watch",
        summary: "Ship one packet and one exported artifact.",
        mustHappen: ["Produce one useful founder packet"],
      },
    ],
    shareableArtifacts: [
      {
        id: "artifact:slack_onepage",
        type: "slack_onepage",
        title: "Founder one-page Slack report",
        visibility: "workspace",
        summary: "Slack report",
        payload: { text: "*NodeBench Founder Report*" },
      },
    ],
    visibility: "workspace",
    benchmarkEvidence: [
      {
        benchmarkId: "bench_1",
        lane: "weekly_founder_reset",
        objective: "Build weekly founder reset proof.",
        packetRef: "packet_test",
        agentsInvolved: ["nodebench"],
        actionsTaken: ["Gather context"],
        beforeState: "Scattered context",
        afterState: "Packet ready",
        artifactsProduced: ["Founder packet"],
        validationPasses: ["Packet assembled"],
        validationFailures: [],
        timeMs: 1200,
        estimatedCostUsd: 0.2,
        humanInterventions: ["Approve"],
        reuseScore: 60,
        summary: "Weekly founder reset benchmark.",
      },
    ],
    workflowComparison: {
      objective: "Pressure-test the direction and export the founder packet.",
      currentPath: ["Restate the company context manually", "Draft a memo from scratch"],
      optimizedPath: ["Reuse the founder packet", "Export the Slack one-page report"],
      rationale: "Packet reuse removes repeated restatement and keeps the workflow auditable.",
      validationChecks: ["The same artifact still exists", "Required diligence fields remain present"],
      estimatedSavings: {
        timePercent: 38,
        costPercent: 24,
      },
      verdict: "valid",
    },
    operatingModel: {
      executionOrder: [
        { id: "ingest", label: "Ingest", description: "Collect allowed founder context." },
        { id: "route", label: "Route", description: "Choose packet and artifact types." },
      ],
      queueTopology: [
        {
          id: "packet_refresh",
          label: "Refresh",
          purpose: "Refresh sweeps and packet state.",
          upstream: ["sweeps"],
          outputs: ["packet refresh"],
        },
      ],
      sourcePolicies: [
        {
          sourceType: "uploads",
          canRead: true,
          canStore: true,
          canSummarize: true,
          exportPolicy: "redact",
          notes: "Uploads stay private by default.",
        },
      ],
      roleDefault: {
        role: "founder",
        defaultPacketType: "founder_progression_packet",
        defaultArtifactType: "slack_onepage",
        shouldMonitorByDefault: true,
        shouldDelegateByDefault: true,
      },
      packetRouter: {
        role: "founder",
        companyMode: "own_company",
        packetType: "founder_progression_packet",
        artifactType: "slack_onepage",
        shouldMonitor: true,
        shouldExport: true,
        shouldDelegate: true,
        needsMoreEvidence: false,
        requiredEvidence: [],
        visibility: "workspace",
        rationale: "Use the founder packet as the canonical route for own-company questions.",
      },
      progressionRubric: {
        currentStage: "foundation",
        onTrack: false,
        mandatorySatisfied: ["Founder packet exported"],
        mandatoryMissing: ["External proof story"],
        optionalStrengths: ["shareable_artifact"],
        rationale: "External proof story is still missing.",
      },
      benchmarkOracles: [
        {
          lane: "weekly_founder_reset",
          deterministicChecks: ["packet present"],
          probabilisticJudges: ["usefulness"],
          baseline: "manual founder recap",
          heldOutScenarios: ["messy startup context"],
        },
      ],
    },
    distributionSurfaceStatus: [
      {
        surfaceId: "mcp_cli",
        label: "MCP / CLI",
        status: "ready",
        whyItMatters: "Low-friction install surface.",
      },
    ],
    companyReadinessPacket: {
      packetId: "packet_test",
      visibility: "workspace",
      identity: {
        companyName: "NodeBench",
        vertical: "AI/software",
        subvertical: "developer and agent tooling",
        stage: "Stage 1: Foundation",
        mission: "Founder operating system",
        wedge: "Founder packet workflow",
      },
      founderTeamCredibility: ["Map background to wedge"],
      productAndWedge: ["Founder operating system"],
      marketAndGtm: ["Meet users in existing workflows"],
      financialReadiness: ["Track runway"],
      operatingReadiness: ["Delegate the Slack report"],
      diligenceEvidence: ["Founder packet"],
      contradictionsAndHiddenRisks: ["Team shape remains narrow"],
      nextUnlocks: ["Generate one useful founder packet and use it in a real decision"],
      pricingStage: {
        stageId: "foundation",
        label: "Stage 1: Foundation",
        priceLabel: "$1",
      },
      distributionSurfaceStatus: [
        {
          surfaceId: "mcp_cli",
          label: "MCP / CLI",
          status: "ready",
          whyItMatters: "Low-friction install surface.",
        },
      ],
      provenance: {
        sourceRefIds: ["source:claude"],
        confidence: 88,
        freshness: new Date().toISOString(),
      },
      allowedDestinations: ["slack_onepage"],
      sensitivity: "workspace",
    },
    companyNamingPack: {
      suggestedNames: ["NodeBench", "Signal Forge"],
      recommendedName: "NodeBench",
      starterProfile: {
        companyName: "NodeBench",
        oneLineDescription: "Founder operating system for reusable packets.",
        categories: ["AI/software"],
        stage: "Stage 1: Foundation",
        initialCustomers: ["Founders"],
        wedge: "Founder packet workflow",
      },
    },
  }),
};

const founderGatherTool: McpTool = {
  name: "founder_local_gather",
  description: "Returns deterministic local founder context for tests.",
  inputSchema: {},
  handler: async () => ({
    identity: {
      projectName: "NodeBench",
      packageName: "NodeBench",
    },
    publicSurfaces: {
      indexHtmlSiteName: "NodeBench",
      indexHtmlTitle: "NodeBench — Entity Intelligence for Any Company, Market, or Question",
    },
    company: {
      name: "Your Workspace",
      canonicalMission: "NodeBench is a founder operating system with reusable packets.",
      identityConfidence: 72,
    },
    summary: "Founder context gathered from the local workspace.",
    recentActions: [
      { description: "Founder packet loop shipped", date: "2026-03-30" },
    ],
    signals: [
      { name: "Founder packet workflow active", direction: "up", impact: "high" },
    ],
    contradictions: [
      { claim: "Routing still drifts into generic workspace mode", evidence: "Own-company prompts should not look generic." },
    ],
    nextActions: [
      { action: "Route own-company founder queries into the founder progression packet." },
    ],
  }),
};

const linkupSearchTool: McpTool = {
  name: "linkup_search",
  description: "Returns deterministic Linkup-style search output for competitor tests.",
  inputSchema: {},
  handler: async () => ({
    answer:
      "Anthropic is competing for enterprise AI budgets with an estimated $12B annualized revenue run-rate and roughly 18% enterprise share in the cited market framing.",
    sources: [
      {
        name: "Enterprise AI market update",
        url: "https://example.com/enterprise-ai-market",
        snippet:
          "Anthropic is being compared against OpenAI, Google, and Cohere as enterprise buyers evaluate model performance, safety posture, and contract flexibility.",
      },
      {
        name: "Anthropic traction note",
        url: "https://example.com/anthropic-traction",
        snippet:
          "Anthropic expanded enterprise deployments and partner relationships while pricing pressure from larger platforms remained a live risk.",
      },
      {
        name: "OpenAI Still Leads in Enterprise AI Arms Race - eWeek",
        url: "https://example.com/ewweek-arms-race",
        snippet:
          "Article framing emphasizes a broad arms race headline, but the underlying buyer discussion still focuses on OpenAI, Google, and Anthropic contract economics.",
      },
    ],
  }),
};

const webSearchTool: McpTool = {
  name: "web_search",
  description: "Returns deterministic web search results for competitor tests.",
  inputSchema: {},
  handler: async () => ({
    results: [
      {
        title: "Anthropic vs OpenAI enterprise contracts",
        url: "https://example.com/contracts",
        snippet:
          "Enterprise buyers compare Anthropic versus OpenAI on pricing, retention, and bundle pressure from larger platform ecosystems.",
      },
      {
        title: "Google pressures model pricing",
        url: "https://example.com/google-pricing",
        snippet:
          "Google's broader cloud footprint increases pricing pressure and creates a distribution challenge for Anthropic in large accounts.",
      },
      {
        title: "Ramp AI Index March 2026 update",
        url: "https://example.com/ramp-ai-index",
        snippet:
          "The index aggregates enterprise AI usage trends, but it is a source artifact rather than an operating peer for Anthropic.",
      },
    ],
  }),
};

const reconTool: McpTool = {
  name: "run_recon",
  description: "Returns deterministic recon results for competitor tests.",
  inputSchema: {},
  handler: async () => ({
    findings: [
      { name: "Enterprise contract velocity improved", direction: "up", impact: "high" },
      { name: "Platform bundling remains a real pricing pressure", direction: "down", impact: "high" },
    ],
    nextSteps: [
      { action: "Review enterprise retention disclosures and partner concentration." },
    ],
    summary:
      "Recon suggests Anthropic is improving enterprise traction but still faces bundling pressure from larger ecosystems.",
  }),
};

const enrichEntityTool: McpTool = {
  name: "enrich_entity",
  description: "Returns deterministic entity enrichment for competitor tests.",
  inputSchema: {},
  handler: async () => ({
    description:
      "Anthropic is positioned as a safety- and enterprise-oriented frontier model provider competing most directly with OpenAI and Google in large-account deployments.",
    signals: [
      { name: "Enterprise positioning is becoming clearer", direction: "up", impact: "high" },
    ],
  }),
};

describe("createSearchRouter", () => {
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl = "";
  let tempDir = "";
  const savedEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    LINKUP_API_KEY: process.env.LINKUP_API_KEY,
    NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS: process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS,
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "nodebench-search-route-"));
    process.env.NODEBENCH_DATA_DIR = tempDir;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LINKUP_API_KEY;
    delete process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS;

    const app = express();
    app.use(express.json());
    app.use(createSearchRouter([
      weeklyResetTool,
      founderDirectionTool,
      founderGatherTool,
      linkupSearchTool,
      webSearchTool,
      reconTool,
      enrichEntityTool,
    ]));

    server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind ephemeral test server");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    process.env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY;
    process.env.GOOGLE_AI_API_KEY = savedEnv.GOOGLE_AI_API_KEY;
    process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = savedEnv.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY;
    process.env.LINKUP_API_KEY = savedEnv.LINKUP_API_KEY;
    process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS = savedEnv.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Windows can keep the sqlite handle open briefly in tests.
      }
    }
  });

  it("streams weekly-reset responses over both GET and POST", async () => {
    const encodedQuery = encodeURIComponent("founder weekly reset");

    const getResponse = await fetch(`${baseUrl}/?query=${encodedQuery}&stream=true`, {
      headers: { Accept: "text/event-stream" },
    });
    const getText = await getResponse.text();

    const postResponse = await fetch(`${baseUrl}/?stream=true`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "founder weekly reset" }),
    });
    const postText = await postResponse.text();

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(getResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(postResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(getText).toContain('"type":"plan"');
    expect(getText).toContain('"routingMode":"executive"');
    expect(getText).toContain('"type":"step_start"');
    expect(getText).toContain('"type":"step_done"');
    expect(getText).toContain('"type":"trace"');
    expect(getText).toContain('"type":"result"');
    expect(getText).toContain('"classification":"weekly_reset"');
    expect(getText).toContain('"strategicAngles"');
    expect(postText).toContain('"type":"plan"');
    expect(postText).toContain('"routingMode":"executive"');
    expect(postText).toContain('"type":"step_start"');
    expect(postText).toContain('"type":"step_done"');
    expect(postText).toContain('"type":"trace"');
    expect(postText).toContain('"type":"result"');
    expect(postText).toContain('"classification":"weekly_reset"');
    expect(postText).toContain('"strategicAngles"');
    expect(postText).toContain('"team-shape"');
    expect(postText).toContain('"stealth-moat"');
    expect(postText).toContain('"progressionProfile"');
    expect(postText).toContain('"diligencePack"');
      expect(postText).toContain('"shareableArtifacts"');
      expect(postText).toContain('"workflowComparison"');
      expect(postText).toContain('"operatingModel"');
      expect(postText).toContain('"companyNamingPack"');
  });

  it("routes own-company founder queries into founder progression packets instead of generic workspace packets", async () => {
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Given everything about my company, what should I do next? We are building founder-first MCP and dashboard tooling.",
        lens: "founder",
      }),
    });

    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.classification).toBe("founder_progression");
    expect(payload.result?.packetType).toBe("founder_progression_packet");
    expect(payload.resultPacket?.packetType).toBe("founder_progression_packet");
    expect(payload.result?.canonicalEntity?.name).toBe("NodeBench");
    expect(payload.resultPacket?.entityName).toBe("NodeBench");
    expect(payload.result?.companyReadinessPacket?.identity?.companyName).toBe("NodeBench");
    expect(payload.result?.companyNamingPack?.recommendedName).toBe("NodeBench");
    expect(payload.result?.companyNamingPack?.starterProfile?.companyName).toBe("NodeBench");
    expect(payload.result?.operatingModel?.packetRouter?.companyMode).toBe("own_company");
  });

  it("routes lowercase bare company queries into company search instead of founder progression", async () => {
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "tests assured",
        lens: "founder",
      }),
    });

    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.classification).toBe("company_search");
    expect(payload.result?.packetType).toBe("company_search_packet");
    expect(payload.result?.canonicalEntity?.name).toBe("Tests Assured");
  });

  it("filters low-signal names and generic filler before serializing founder packets", async () => {
    const noisyFounderGatherTool: McpTool = {
      name: "founder_local_gather",
      description: "Returns intentionally noisy founder context for packet filtering tests.",
      inputSchema: {},
      handler: async () => ({
        identity: {
          projectName: "NodeBench",
          packageName: "NodeBench",
        },
        publicSurfaces: {
          indexHtmlSiteName: "NodeBench",
        },
        company: {
          name: "NodeBench",
          canonicalMission: "Imad Abdelgawad Sujesh Pulikkal. No personnel data found for Tests Assured.",
          identityConfidence: 61,
        },
        summary: "There is no specific information available about NodeBench facing lawsuits in 2026.",
        recentActions: [
          { description: "NodeBench shipped a reusable founder packet with inline citations", date: "2026-04-01" },
          { description: "S.", date: "2026-04-02" },
        ],
        signals: [
          { name: "Imad Abdelgawad", direction: "up", impact: "medium" },
          { name: "Sujesh Pulikkal", direction: "up", impact: "medium" },
          { name: "NodeBench shipped reusable founder packets with inline citations", direction: "up", impact: "high" },
        ],
        contradictions: [
          { claim: "There is no specific information available about NodeBench facing lawsuits in 2026.", evidence: "Generic filler." },
          { claim: "NodeBench still lacks a durable proof story for external sharing", evidence: "The packet is stronger than before, but external proof is still thin." },
        ],
        nextActions: [
          { action: "Ship the founder packet." },
        ],
      }),
    };

    const app = express();
    app.use(express.json());
    app.use(createSearchRouter([noisyFounderGatherTool]));

    const localServer = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });

    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind noisy founder test server");
    }

    const localBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${localBaseUrl}/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "Given everything about my company, what should I do next?",
          lens: "founder",
        }),
      });

      const payload = await response.json() as any;

      expect(response.status).toBe(200);
    expect(payload.resultPacket?.answer).not.toMatch(/There is no specific information available/i);
    expect(payload.resultPacket?.answer).not.toMatch(/Imad Abdelgawad|Sujesh Pulikkal/i);
    expect(payload.resultPacket?.variables?.some((item: any) => /Imad Abdelgawad|Sujesh Pulikkal/.test(item.name))).toBe(false);
    expect(payload.resultPacket?.changes?.some((item: any) => /^S\.$/.test(item.description))).toBe(false);
    expect((payload.resultPacket?.changes ?? []).length).toBeLessThanOrEqual(1);
    expect(payload.resultPacket?.risks?.some((item: any) => /There is no specific information available/i.test(item.title))).toBe(false);
    expect(payload.resultPacket?.claimRefs?.some((item: any) => /Imad Abdelgawad|Sujesh Pulikkal/.test(item.text))).toBe(false);
    expect(typeof payload.resultPacket?.workflowAsset?.assetId).toBe("string");
    expect(typeof payload.resultPacket?.workflowAsset?.envelopeId).toBe("string");
    } finally {
      await new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("builds a deeper competitor packet without synthetic decision-noise risks", async () => {
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Analyze Anthropic competitive position in enterprise AI for an investor.",
        lens: "investor",
      }),
    });

    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.resultPacket?.entityName).toBe("Anthropic");
    expect(payload.resultPacket?.comparables?.some((item: any) => item.name === "OpenAI")).toBe(true);
    expect(payload.resultPacket?.comparables?.some((item: any) => item.name === "Google")).toBe(true);
    expect(
      payload.resultPacket?.comparables?.some((item: any) => /^(Sacra|AI|API|YoY|Ramp)$/i.test(String(item.name ?? ""))),
    ).toBe(false);
    expect(payload.resultPacket?.risks?.some((item: any) => /Key decision:/i.test(item.title))).toBe(false);
    expect(payload.resultPacket?.risks?.some((item: any) => /\?/.test(item.title))).toBe(false);
    expect(payload.resultPacket?.sourceCount).toBeGreaterThan(1);
    expect(payload.resultPacket?.answerBlocks?.some((block: any) => block.title === "Competitive frame")).toBe(true);
    expect(payload.resultPacket?.answerBlocks?.some((block: any) => block.title === "Bottom line")).toBe(true);
    expect(payload.resultPacket?.answer).toMatch(/enterprise|pricing|OpenAI|Google/i);
    expect(payload.resultPacket?.answer).not.toMatch(/arms race|Ramp AI Index/i);
    expect(payload.resultPacket?.workflowAsset?.canonicalPacketId).toBe(payload.resultPacket?.packetId);
    expect(payload.result?.workflowAsset?.assetId).toBe(payload.resultPacket?.workflowAsset?.assetId);
  });

  it("overrides founder-default lens for explicit banker prompts and strips founder-only scaffolding from external research", async () => {
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI. Focus on comparables, diligence flags, and next diligence questions.",
        lens: "founder",
      }),
    });

    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.lens).toBe("banker");
    expect(payload.classification).toBe("multi_entity");
    expect(payload.resultPacket?.entityName).toMatch(/Anthropic/i);
    expect(payload.resultPacket?.comparables?.some((item: any) => item.name === "OpenAI")).toBe(true);
    expect(payload.resultPacket?.comparables?.some((item: any) => item.name === "Google")).toBe(true);
    expect(
      payload.resultPacket?.comparables?.some((item: any) => /^(AI|API|YoY|Ramp)$/i.test(String(item.name ?? ""))),
    ).toBe(false);
    expect(payload.resultPacket?.strategicAngles).toBeUndefined();
    expect(payload.resultPacket?.companyReadinessPacket).toBeUndefined();
    expect(payload.resultPacket?.companyNamingPack).toBeUndefined();
    expect(payload.result?.strategicAngles).toBeUndefined();
    expect(payload.result?.companyReadinessPacket).toBeUndefined();
    expect(payload.result?.companyNamingPack).toBeUndefined();
    expect(payload.resultPacket?.interventions?.some((item: any) => /\bbenchmark\b.+\bagainst\b/i.test(item.action))).toBe(false);
  });

  it("streams banker comparison packets with a fully populated result surface", async () => {
    const response = await fetch(`${baseUrl}/?stream=true`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI. Focus on comparables, diligence flags, and next diligence questions.",
        lens: "banker",
      }),
    });

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain('"type":"result"');
    expect(text).toContain('"routingMode":"advisor"');
    expect(text).toContain('"classification":"multi_entity"');
    expect(text).toContain('"packetType":"multi_entity_packet"');
    expect(text).toContain('"title":"Bottom line"');
    expect(text).toContain('"title":"Competitive frame"');
    expect(text).toContain('"OpenAI"');
    expect(text).toContain('"Google"');
    expect(text).toContain('"nextActions"');
  });

  it("keeps founder lens on external company searches without leaking own-company founder scaffolding", async () => {
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Anthropic",
        lens: "founder",
      }),
    });

    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.lens).toBe("founder");
    expect(payload.classification).toBe("company_search");
    expect(payload.resultPacket?.entityName).toBe("Anthropic");
    expect(payload.resultPacket?.packetType).toBe("company_search_packet");
    expect(payload.resultPacket?.strategicAngles).toBeUndefined();
    expect(payload.resultPacket?.companyReadinessPacket).toBeUndefined();
    expect(payload.resultPacket?.companyNamingPack).toBeUndefined();
    expect(payload.result?.strategicAngles).toBeUndefined();
    expect(payload.result?.companyReadinessPacket).toBeUndefined();
    expect(payload.result?.companyNamingPack).toBeUndefined();
  });

  it("sanitizes production-style noisy llm synthesis before packaging banker-grade output", async () => {
    const originalFetch = global.fetch;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalExternalFallback = process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS = "1";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("api.openai.com")) {
        throw new Error(`Unexpected fetch target: ${url}`);
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entityName: "Anthropic",
                  answer: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race. Anthropic's Revenue Nearly Doubled in Two Months. Now It's Targeting a $60 Billion IPO.",
                  confidence: 91,
                  whyThisTeam: {
                    founderCredibility: "Former OpenAI team with enterprise credibility.",
                    trustSignals: ["Amazon partnership", "Google partnership"],
                    visionMagnitude: "Company-scale platform opportunity.",
                    reinventionCapacity: "Can adapt distribution strategy.",
                    hiddenRequirements: ["Durable retention", "Compute discipline"],
                  },
                  signals: [
                    { name: "Anthropic raises $30 billion in Series G funding at $380 billion post-money valuation", direction: "up", impact: "high", score: 91, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Anthropic raised $30 billion in Series G funding at a $380 billion post-money valuation." },
                    { name: "Anthropic's Revenue Nearly Doubled in Two Months. Now It's Targeting a $60 Billion IPO.", direction: "up", impact: "high", score: 12, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Anthropic's Revenue Nearly Doubled in Two Months." },
                  ],
                  changes: [
                    { description: "Anthropic raises $30 billion in Series G funding at $380 billion post-money valuation", score: 90, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Anthropic raised $30 billion in Series G funding." },
                    { description: "Anthropic's $380 Billion Valuation Marks A Turning Point For Enterprise AI", score: 20, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Anthropic's $380 Billion Valuation Marks A Turning Point." },
                  ],
                  risks: [
                    { title: "AI Regulation In 2026: What Businesses Need To Know About Risks And Realities", description: "Enterprises in 2026 face data leakage, hallucinations, and regulatory non-compliance.", score: 18, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Businesses need to know about risks and realities." },
                    { title: "Execution risk", description: "Platform bundling remains a real pricing pressure in large enterprise accounts.", score: 82, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Platform bundling remains a real pricing pressure in large enterprise accounts." },
                  ],
                  comparables: [
                    { name: "Google", relevance: "high", note: "Cloud and distribution overlap.", score: 88, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Enterprise buyers compare Anthropic versus OpenAI and Google." },
                    { name: "Pentagon", relevance: "medium", note: "Noise from a defense article.", score: 12, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Noise from a defense article." },
                    { name: "RPA", relevance: "medium", note: "A category, not a company.", score: 10, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "A category, not a company." },
                    { name: "Nvidia GPUs. These", relevance: "medium", note: "Hardware mention, not a company.", score: 9, sourceLabel: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", sourceHref: "https://example.com/race", evidenceQuote: "Hardware mention, not a company." },
                  ],
                  nextActions: [
                    { action: "Benchmark Anthropic against Google on pricing and enterprise traction.", impact: "high" },
                  ],
                  nextQuestions: [
                    "What evidence would change the relative ranking?",
                  ],
                  sources: [
                    { label: "Anthropic vs. OpenAI: Why Claude is Winning the 2026 Enterprise Growth Race", href: "https://example.com/race", type: "web" },
                  ],
                }),
              },
            },
          ],
        }),
      } as Response;
    }));

    try {
      const execution: HarnessExecution = {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
          synthesisPrompt: "Synthesize competitive intelligence.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 10,
            result: {
              answer: "Anthropic is competing for enterprise AI budgets with an estimated $19B annualized revenue run-rate and rising enterprise share.",
              sources: [
                {
                  name: "Enterprise AI buyer note",
                  url: "https://example.com/buyer-note",
                  snippet: "Enterprise buyers compare Anthropic versus OpenAI and Google on pricing, distribution leverage, and contract flexibility.",
                },
              ],
            },
          },
          {
            stepId: "recon",
            toolName: "run_recon",
            success: true,
            durationMs: 9,
            result: {
              findings: [
                { name: "Enterprise contract velocity improved as Anthropic expanded large-account deployments", direction: "up", impact: "high" },
                { name: "Platform bundling remains a real pricing pressure in large enterprise accounts", direction: "down", impact: "high" },
              ],
              nextSteps: [
                { action: "Review retention disclosures and partner concentration." },
              ],
            },
          },
        ],
        totalDurationMs: 19,
        totalCostUsd: 0,
        adaptations: 0,
      };

      const result = await synthesizeResults(
        execution,
        "Analyze Anthropic competitive position in enterprise AI for an investor.",
        "investor",
        async () => {
          throw new Error("call_llm tool unavailable in this test");
        },
      );

      expect(result.signals.some((item) => /series g funding|targeting a \$60 billion ipo/i.test(item.name))).toBe(false);
      expect(result.signals.length).toBeGreaterThanOrEqual(2);
      expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
      expect(result.comparables.some((item) => /Pentagon|RPA|Nvidia GPUs/i.test(item.name))).toBe(false);
      expect(result.risks.some((item) => /what businesses need to know/i.test(item.title))).toBe(false);
      expect(result.risks.length).toBeGreaterThanOrEqual(1);
      expect(result.risks.some((item) => /pricing|execution|distribution/i.test(item.title))).toBe(true);
      expect(result.answer).not.toMatch(/arms race|worth buying|turns the tables|targeting a \$60 billion ipo/i);
      expect(result.keyMetrics.some((item) => item.label === "growth")).toBe(false);
      expect(result.risks.some((item) => Boolean(item.evidenceQuote))).toBe(true);
      expect(result.comparables.find((item) => item.name === "Google")?.sourceHref).toBeTruthy();
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      process.env.OPENAI_API_KEY = originalOpenAiKey;
      process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS = originalExternalFallback;
    }
  });

  it("selects banker metrics from the relevant figure instead of generic or mismatched values", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Compare Anthropic vs OpenAI vs Google",
          classification: "multi_entity",
          entityTargets: ["Anthropic", "OpenAI", "Google"],
          steps: [],
          synthesisPrompt: "Synthesize banking-grade comparables.",
        },
        stepResults: [
          {
            stepId: "linkup-anthropic",
            toolName: "linkup_search",
            success: true,
            durationMs: 10,
            result: {
              answer: "Anthropic raised $30 billion in Series G funding at a $380 billion post-money valuation while annualized revenue reached $19B in March 2026.",
              sources: [
                {
                  name: "Anthropic funding update",
                  url: "https://example.com/anthropic-funding",
                  snippet: "Anthropic raised $30 billion in Series G funding at a $380 billion post-money valuation while annualized revenue reached $19B in March 2026.",
                },
              ],
            },
          },
          {
            stepId: "web-openai",
            toolName: "web_search",
            success: true,
            durationMs: 8,
            result: {
              results: [
                {
                  title: "OpenAI margin profile",
                  url: "https://example.com/openai-margin",
                  snippet: "OpenAI posted a 33% gross margin in 2025 as inference costs remained elevated.",
                },
                {
                  title: "Google revenue growth",
                  url: "https://example.com/google-growth",
                  snippet: "Alphabet reported Q4 revenue of $113.83B, up 18% year-over-year.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 18,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.keyMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Anthropic valuation", value: "$380B" }),
        expect.objectContaining({ label: "Anthropic revenue", value: "$19B" }),
        expect.objectContaining({ label: "OpenAI gross margin", value: "33%" }),
      ]),
    );
    expect(result.keyMetrics.some((item) => item.label === "growth")).toBe(false);
    expect(result.keyMetrics.some((item) => item.label === "Anthropic growth" && item.value === "1,167%")).toBe(false);
    expect(result.keyMetrics.some((item) => item.label === "Anthropic valuation" && item.value === "$30B")).toBe(false);
  });

  it("overrides weaker llm-provided banker metrics with evidence-grounded figures from the source sentences", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Compare Anthropic vs OpenAI vs Google",
          classification: "multi_entity",
          entityTargets: ["Anthropic", "OpenAI", "Google"],
          steps: [],
          synthesisPrompt: "Build a banker-grade comparison packet.",
        },
        stepResults: [
          {
            stepId: "openai-web",
            toolName: "web_search",
            success: true,
            durationMs: 10,
            result: {
              results: [
                {
                  title: "OpenAI margin profile",
                  url: "https://example.com/openai-margin",
                  snippet: "OpenAI posted a 33% gross margin in 2025 as inference costs remained elevated, with paying users accounting for approximately 66% of inference spend.",
                },
              ],
            },
          },
          {
            stepId: "anthropic-linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 8,
            result: {
              answer: "Anthropic raised $30 billion in Series G funding at a $380 billion post-money valuation while annualized revenue reached $19B in March 2026.",
            },
          },
        ],
        totalDurationMs: 18,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI.",
      "banker",
      async (toolName) => {
        if (toolName !== "call_llm") {
          throw new Error(`Unexpected tool ${toolName}`);
        }
        return {
          response: JSON.stringify({
            entityName: "Anthropic vs OpenAI vs Google",
            answer: "Across Anthropic, OpenAI, and Google, the core underwriting issue is whether enterprise revenue quality and pricing power can outrun compute intensity.",
            confidence: 93,
            keyMetrics: [
              { label: "OpenAI gross margin", value: "66%" },
              { label: "Anthropic valuation", value: "$380B" },
            ],
            signals: [
              { name: "OpenAI posted a 33% gross margin in 2025 as inference costs remained elevated.", direction: "up", impact: "high" },
              { name: "Anthropic raised $30 billion in Series G funding at a $380 billion post-money valuation while annualized revenue reached $19B in March 2026.", direction: "up", impact: "high" },
            ],
            nextActions: [
              { action: "Build a side-by-side diligence matrix.", impact: "high" },
            ],
          }),
        };
      },
    );

    expect(result.keyMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "OpenAI gross margin", value: "33%" }),
        expect.objectContaining({ label: "Anthropic valuation", value: "$380B" }),
      ]),
    );
    expect(result.keyMetrics.some((item) => item.label === "OpenAI gross margin" && item.value === "66%")).toBe(false);
    expect(result.answer).toContain("OpenAI gross margin of 33%");
    expect(result.answer).not.toContain("OpenAI gross margin of 66%");
  });

  it("drops unsupported banker metrics from llm synthesis and prefers signal-backed evidence when source snippets conflict", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Compare Anthropic vs OpenAI vs Google",
          classification: "multi_entity",
          entityTargets: ["Anthropic", "OpenAI", "Google"],
          steps: [],
          synthesisPrompt: "Build a banker-grade comparison packet.",
        },
        stepResults: [
          {
            stepId: "openai-web",
            toolName: "web_search",
            success: true,
            durationMs: 10,
            result: {
              results: [
                {
                  title: "OpenAI economics",
                  url: "https://example.com/openai-economics",
                  snippet: "OpenAI posted a 33% gross margin, constrained by inference costs that reached $8.4B in 2025 and are projected to rise to $14.1B in 2026, with paying users accounting for approximately 66% of inference spend.",
                },
              ],
            },
          },
          {
            stepId: "anthropic-linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 8,
            result: {
              answer: "Anthropic raised $30 billion in Series G funding at a $380 billion post-money valuation while annualized revenue reached $19B in March 2026.",
            },
          },
        ],
        totalDurationMs: 18,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI.",
      "banker",
      async (toolName) => {
        if (toolName !== "call_llm") {
          throw new Error(`Unexpected tool ${toolName}`);
        }
        return {
          response: JSON.stringify({
            entityName: "Anthropic vs OpenAI vs Google",
            answer: "Across Anthropic, OpenAI, and Google, the core underwriting issue is whether enterprise revenue quality and pricing power can outrun compute intensity.",
            confidence: 94,
            keyMetrics: [
              { label: "OpenAI valuation", value: "$14.1B" },
              { label: "OpenAI gross margin", value: "66%" },
              { label: "Anthropic valuation", value: "$380B" },
            ],
            signals: [
              { name: "OpenAI posted a 33% gross margin, constrained by inference costs that reached $8.4B in 2025 and are projected to rise to $14.1B in 2026.", direction: "up", impact: "high" },
              { name: "Anthropic raised $30 billion in Series G funding at a $380 billion post-money valuation while annualized revenue reached $19B in March 2026.", direction: "up", impact: "high" },
            ],
            changes: [
              { description: "OpenAI posted a 33% gross margin, constrained by inference costs that reached $8.4B in 2025." },
            ],
            nextActions: [
              { action: "Build a side-by-side diligence matrix.", impact: "high" },
            ],
            comparables: [
              { name: "OpenAI", relevance: "high", note: "Peer in the scoped comparison set." },
            ],
          }),
        };
      },
    );

    expect(result.keyMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "OpenAI gross margin", value: "33%" }),
        expect.objectContaining({ label: "Anthropic valuation", value: "$380B" }),
      ]),
    );
    expect(result.keyMetrics.some((item) => item.label === "OpenAI valuation" && item.value === "$14.1B")).toBe(false);
    expect(result.keyMetrics.some((item) => item.label === "OpenAI gross margin" && item.value === "66%")).toBe(false);
    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
    expect(result.answer).toContain("OpenAI gross margin of 33%");
  });

  it("does not relabel generic margin figures as gross margin in banker packets", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Compare Anthropic vs OpenAI vs Google",
          classification: "multi_entity",
          entityTargets: ["Anthropic", "OpenAI", "Google"],
          steps: [],
          synthesisPrompt: "Build a banker-grade comparison packet.",
        },
        stepResults: [
          {
            stepId: "google-web",
            toolName: "web_search",
            success: true,
            durationMs: 9,
            result: {
              results: [
                {
                  title: "Google cloud profitability",
                  url: "https://example.com/google-margin",
                  snippet: "Google Cloud reported an operating margin of 32.9% as revenue rose 18% year-over-year.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 9,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.keyMetrics.some((item) => item.label === "Google gross margin")).toBe(false);
    expect(result.keyMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Google growth", value: "18%" }),
      ]),
    );
  });

  it("prefers authoritative banker sources and hard underwriting datapoints over soft market commentary", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Compare Anthropic vs OpenAI vs Google",
          classification: "multi_entity",
          entityTargets: ["Anthropic", "OpenAI", "Google"],
          steps: [],
          synthesisPrompt: "Build a banker-grade comparison packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 15,
            result: {
              answer: "Anthropic, OpenAI, and Google are separating on enterprise traction and pricing leverage.",
              sources: [
                {
                  name: "Anthropic revenue, valuation & funding | Sacra",
                  url: "https://sacra.com/c/anthropic/",
                  snippet: "Sacra estimates that Anthropic hit $19B in annualized revenue in March 2026, up 1,167% year-over-year.",
                },
                {
                  name: "A business that scales with the value of intelligence | OpenAI",
                  url: "https://openai.com/index/a-business-that-scales-with-the-value-of-intelligence/",
                  snippet: "OpenAI posted a 33% gross margin while inference costs reached $8.4B in 2025.",
                },
                {
                  name: "Google Plans to Double Spending Amid A.I. Race - The New York Times",
                  url: "https://www.nytimes.com/2026/02/04/business/google-earnings-ai.html",
                  snippet: "Google Cloud grew 48% to $17.664 billion with a $240 billion backlog of enterprise contracts.",
                },
                {
                  name: "OpenAI Revenue, Losses, and Profitability in 2026: Full Financial Breakdown",
                  url: "https://futuresearch.ai/openai-revenue-forecast/",
                  snippet: "OpenAI maintains a leading position in enterprise AI adoption, with business usage rebounding to record highs.",
                },
                {
                  name: "Google's AI Dominance Is Being Tested. Here's What Investors Need to Know - 24/7",
                  url: "https://247wallst.com/investing/2026/03/11/googles-ai-dominance-is-being-tested-heres-what-investors-need-to-know/",
                  snippet: "Investors need to know Google remains a powerhouse hiding in plain sight.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 15,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.sources.map((source) => source.label)).toEqual(
      expect.arrayContaining([
        "Anthropic revenue, valuation & funding | Sacra",
        "A business that scales with the value of intelligence | OpenAI",
        "Google Plans to Double Spending Amid A.I. Race - The New York Times",
      ]),
    );
    expect(result.sources.some((source) => /full financial breakdown|investors need to know/i.test(source.label))).toBe(false);
    expect(result.answer).toMatch(/Current hard datapoints include .*Anthropic revenue at \$19B/i);
    expect(result.answer).toMatch(/OpenAI gross margin of 33%/i);
    expect(result.answer).toMatch(/The underwriting question is which platform can keep pricing power and contract durability once buyers consolidate spend/i);
    expect(result.answer).not.toMatch(/leading position in enterprise AI adoption|record highs/i);
  });

  it("derives single-entity comparables from cited source titles when the model omits them", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 10,
            result: {
              answer: "Anthropic is gaining enterprise traction, but buyer evaluation increasingly references direct operating peers.",
              sources: [
                {
                  name: "OpenAI vs Anthropic enterprise pricing and retention",
                  url: "https://example.com/openai-vs-anthropic",
                },
                {
                  name: "Google pressures frontier model pricing in large accounts",
                  url: "https://example.com/google-pricing",
                },
              ],
            },
          },
          {
            stepId: "recon",
            toolName: "run_recon",
            success: true,
            durationMs: 8,
            result: {
              findings: [
                { name: "Enterprise pricing pressure persists in large accounts", direction: "down", impact: "high" },
              ],
            },
          },
        ],
        totalDurationMs: 18,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "investor",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
    expect(result.answer).toMatch(/closest operating comparables/i);
  });

  it("retains single-entity sources when the matched source snippet grounds the company", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "company_search",
          entityTargets: ["Anthropic"],
          steps: [],
        },
        stepResults: [
          {
            stepId: "web",
            toolName: "web_search",
            success: true,
            durationMs: 9,
            result: {
              results: [
                {
                  title: "Anthropic vs OpenAI enterprise contracts",
                  url: "https://example.com/contracts",
                  snippet:
                    "Enterprise buyers compare Anthropic versus OpenAI on pricing, retention, and bundle pressure from larger platform ecosystems.",
                },
                {
                  title: "Google pressures model pricing",
                  url: "https://example.com/google-pricing",
                  snippet:
                    "Google's broader cloud footprint increases pricing pressure and creates a distribution challenge for Anthropic in large accounts.",
                },
                {
                  title: "Ramp AI Index March 2026 update",
                  url: "https://example.com/ramp-ai-index",
                  snippet:
                    "The index aggregates enterprise AI usage trends, but it is a source artifact rather than an operating peer for Anthropic.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 9,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "investor",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.sources.map((source) => source.label)).toEqual(
      expect.arrayContaining([
        "Anthropic vs OpenAI enterprise contracts",
        "Google pressures model pricing",
      ]),
    );
    expect(result.sources.some((source) => /Ramp AI Index/i.test(source.label))).toBe(false);
  });

  it("filters investor, regulatory, and acronym noise from single-entity comparable extraction", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 12,
            result: {
              answer: "Anthropic is gaining share in enterprise AI as buyers compare it with OpenAI while pricing pressure remains live.",
              sources: [
                {
                  name: "OpenAI versus Anthropic enterprise pricing",
                  url: "https://example.com/openai-vs-anthropic",
                },
                {
                  name: "Anthropic market update with GIC and Coatue commentary",
                  url: "https://example.com/investor-commentary",
                },
                {
                  name: "It and We are not operating peers for Anthropic",
                  url: "https://example.com/pronouns",
                },
                {
                  name: "HIPAA compliance questions for enterprise AI",
                  url: "https://example.com/hipaa",
                },
              ],
            },
          },
          {
            stepId: "web",
            toolName: "web_search",
            success: true,
            durationMs: 10,
            result: {
              results: [
                {
                  title: "Google pressures frontier model pricing in large accounts",
                  url: "https://example.com/google-pricing",
                  snippet: "Enterprise buyers increasingly compare Anthropic, OpenAI, and Google on pricing and retention.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 22,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "investor",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
    expect(result.comparables.some((item) => /^(GIC|Coatue|HIPAA|It|We|Ventures|Dragoneer)$/i.test(item.name))).toBe(false);
  });

  it("strips narrative fluff and loose capitalized noise from banker-style outputs", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
          synthesisPrompt: "Build a banker-grade packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 15,
            result: {
              answer: "Reality check: Anthropic is being compared against OpenAI and Google as enterprise buyers evaluate pricing and retention.",
              sources: [
                {
                  name: "Enterprise AI buyer note",
                  url: "https://example.com/buyer-note",
                  snippet: "This report highlights that Anthropic is being compared against OpenAI and Google on pricing, retention, and contract durability.",
                },
                {
                  name: "Anthropic market-share note",
                  url: "https://example.com/market-share",
                  snippet: "Anthropic may hold approximately 40% of enterprise LLM spend while Cowork deployments remain anecdotal.",
                },
                {
                  name: "Cloud distribution note",
                  url: "https://example.com/cloud-distribution",
                  snippet: "Anthropic is expanding distribution across major cloud platforms like AWS and Google while enterprise buyers still compare contract durability and pricing.",
                },
              ],
            },
          },
          {
            stepId: "recon",
            toolName: "run_recon",
            success: true,
            durationMs: 10,
            result: {
              findings: [
                { name: "Business subscriptions to Claude Code have quadrupled since the start of 2026, and enterprise use has grown to represent over half of all Claude Code revenue.", direction: "up", impact: "high" },
                { name: "Platform bundling remains a real pricing pressure in large enterprise accounts.", direction: "down", impact: "high" },
              ],
            },
          },
          {
            stepId: "web",
            toolName: "web_search",
            success: true,
            durationMs: 9,
            result: {
              results: [
                {
                  title: "Anthropic enterprise pricing",
                  url: "https://example.com/enterprise-pricing",
                  snippet: "Anthropic is reported to hold a significant share of the enterprise AI market, leveraging its availability across major cloud platforms like AWS, Goog",
                },
                {
                  title: "Bundling risk note",
                  url: "https://example.com/bundling-risk",
                  snippet: "Large enterprise buyers can use bundled suites and multi-vendor negotiations to pressure pricing and shorten contract dur",
                },
              ],
            },
          },
        ],
        totalDurationMs: 25,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
    expect(result.comparables.some((item) => /^(Approximately|AWS|Cowork|Pentagon|Instagram)$/i.test(item.name))).toBe(false);
    expect(result.comparables.some((item) => /[.,;:]$/.test(item.name))).toBe(false);
    expect(result.signals.some((item) => /^This report highlights/i.test(item.name))).toBe(false);
    expect(result.signals.some((item) => /\*\*|^\[?\d+\]?|^##\s/i.test(item.name))).toBe(false);
    expect(result.risks.some((item) => /Instagram|trajectory resembles|feature into a core revenue driver/i.test(`${item.title} ${item.description}`))).toBe(false);
    expect(result.whatChanged?.some((item) => /\bGoog$|\bGoog\b/i.test(item.description)) ?? false).toBe(false);
    expect(result.risks.some((item) => /\bdur$|\bcontr$|\bGoog$|\bAWS\b/i.test(item.description))).toBe(false);
    expect(result.risks.some((item) => /multi-vendor negotiations to pressure pricing/i.test(item.description))).toBe(true);
    expect(result.answer).toMatch(/The underwriting question is whether Anthropic can keep pricing power and contract durability/i);
    expect(result.answer).not.toMatch(/\.(?:\s*\.)+/);
  });

  it("recovers comparables from banker narrative signals when source titles are weak", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
          synthesisPrompt: "Build a banker-grade packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 11,
            result: {
              answer: "Anthropic's operating momentum is real, but enterprise buyers still compare it with OpenAI and Google on pricing and retention.",
              sources: [
                {
                  name: "Enterprise AI companies landscape breakdown",
                  url: "https://example.com/landscape",
                  snippet: "While OpenAI currently leads in general-purpose enterprise use cases, Anthropic and Google are rapidly gaining market share as buyers compare pricing and contract durability.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 11,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
    expect(result.comparables.some((item) => /^(While OpenAI|While|Anthropic and Google)$/i.test(item.name))).toBe(false);
  });

  it("recovers comparables from company-list source titles without explicit versus phrasing", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
          synthesisPrompt: "Build a banker-grade packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 8,
            result: {
              answer: "Anthropic is one of the leading frontier AI vendors in enterprise deployment.",
              sources: [
                {
                  name: "Anthropic, OpenAI and Google probably acted because in 2025 proprietary enterprise AI shifted from pilot to budget line item",
                  url: "https://example.com/peer-title",
                },
              ],
            },
          },
        ],
        totalDurationMs: 8,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
  });

  it("rewrites multi-entity banker summaries into cleaner underwriting language", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Compare Anthropic vs OpenAI vs Google",
          classification: "multi_entity",
          entityTargets: ["Anthropic", "OpenAI", "Google"],
          steps: [],
          synthesisPrompt: "Build a banker-grade comparison packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 12,
            result: {
              answer: "Anthropic, OpenAI, and Google are separating on pricing leverage, contract durability, and enterprise distribution.",
              sources: [
                {
                  name: "Enterprise AI peer note",
                  url: "https://example.com/peer-note",
                  snippet: "Rapid Revenue Acceleration: Anthropic has grown from approximately $1 billion annual run-rate in early 2025 to over $5 billion by August 2025.",
                },
                {
                  name: "OpenAI enterprise note",
                  url: "https://example.com/openai-enterprise",
                  snippet: "OpenAI says it's on pace to generate $25 billion in revenue this year, versus Anthropic's $19 billion.",
                },
                {
                  name: "Google pricing note",
                  url: "https://example.com/google-pricing",
                  snippet: "Google's bundled infrastructure stack creates real pricing pressure in large enterprise accounts.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 12,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.signals.some((item) => /^Rapid Revenue Acceleration:/i.test(item.name))).toBe(false);
    expect(result.signals.some((item) => /approximately \$1 billion annual run-rate/i.test(item.name))).toBe(true);
    expect(result.answer).toMatch(/The underwriting question is which platform can keep pricing power and contract durability once buyers consolidate spend/i);
    expect(result.answer).toContain("Current hard datapoints include Anthropic revenue at $25B.");
    expect(result.answer).not.toContain("The underwriting split is showing up in");
  });

  it("extracts banker key metrics and prefers cited web sources over local narrative labels", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Compare Anthropic vs OpenAI vs Google",
          classification: "multi_entity",
          entityTargets: ["Anthropic", "OpenAI", "Google"],
          steps: [],
          synthesisPrompt: "Build a banker-grade comparison packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 15,
            result: {
              answer: "Anthropic, OpenAI, and Google are separating on enterprise traction and pricing leverage.",
              sources: [
                {
                  name: "Anthropic revenue, valuation & funding | Sacra",
                  url: "https://sacra.com/c/anthropic/",
                  snippet: "Sacra estimates that Anthropic hit $19 billion in annualized revenue in March 2026.",
                },
                {
                  name: "OpenAI enterprise note",
                  url: "https://example.com/openai-enterprise",
                  snippet: "OpenAI posted a 33% gross margin, constrained by inference costs that reached $8.4B in 2025.",
                },
                {
                  name: "Google pricing note",
                  url: "https://example.com/google-pricing",
                  snippet: "Google's bundled infrastructure stack creates real pricing pressure in large enterprise accounts.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 15,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Prepare an investment-banking style competitive briefing on Anthropic versus OpenAI and Google in enterprise AI.",
      "banker",
      async (toolName) => {
        if (toolName !== "call_llm") {
          throw new Error(`Unexpected tool ${toolName}`);
        }
        return {
          response: JSON.stringify({
            entityName: "Anthropic vs OpenAI vs Google",
            answer: "Anthropic is separating on enterprise traction and pricing discipline.",
            confidence: 92,
            keyMetrics: [
              { label: "Anthropic revenue", value: "$19 billion" },
              { label: "OpenAI gross margin", value: "33%" },
            ],
            signals: [
              { name: "Sacra estimates that Anthropic hit $19B in annualized revenue in March 2026.", direction: "up", impact: "high" },
              { name: "OpenAI posted a 33% gross margin, constrained by inference costs that reached $8.4B in 2025.", direction: "up", impact: "high" },
            ],
            changes: [
              { description: "Anthropic reached $19B in annualized revenue by March 2026." },
            ],
            risks: [
              { title: "Pricing pressure", description: "Google's bundled infrastructure stack creates real pricing pressure in large enterprise accounts." },
            ],
            comparables: [
              { name: "OpenAI", relevance: "high", note: "Direct operating peer." },
              { name: "Google", relevance: "high", note: "Bundled platform pressure." },
            ],
            nextActions: [
              { action: "Build a side-by-side diligence matrix for Anthropic, OpenAI, and Google.", impact: "high" },
            ],
            nextQuestions: [
              "Where does Anthropic's pricing durability look strongest against OpenAI and Google?",
            ],
            sources: [
              { label: "Anthropic revenue, valuation & funding | Sacra", href: "https://sacra.com/c/anthropic/", type: "web" },
              { label: "OpenAI enterprise note", href: "https://example.com/openai-enterprise", type: "web" },
              { label: "Google pricing note", href: "https://example.com/google-pricing", type: "web" },
              { label: "Anthropic's enterprise AI business is rapidly growing, with estimated annualized revenue reaching $19 billion by March 2026.", type: "local" },
            ],
          }),
        };
      },
    );

    expect(result.keyMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Anthropic revenue", value: "$19B" }),
        expect.objectContaining({ label: "OpenAI gross margin", value: "33%" }),
      ]),
    );
    expect(result.keyMetrics.some((metric) => /growth/i.test(metric.label) && /\$/i.test(metric.value))).toBe(false);
    expect(result.sources.every((source) => source.type === "web")).toBe(true);
    expect(result.sources.some((source) => /rapidly growing/i.test(source.label))).toBe(false);
  });

  it("suppresses sentence-leading comparable junk and avoids overstacking duplicate revenue signals", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
          synthesisPrompt: "Build a banker-grade packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 13,
            result: {
              answer: "Anthropic's enterprise momentum is accelerating as buyers compare it with OpenAI and Google on pricing and contract durability.",
              sources: [
                {
                  name: "Enterprise AI market note",
                  url: "https://example.com/market-note",
                  snippet: "Many enterprise buyers compare Anthropic, OpenAI, and Google on pricing, retention, and contract durability.",
                },
                {
                  name: "Anthropic revenue update",
                  url: "https://example.com/revenue-update",
                  snippet: "As of March 2026, Anthropic's annualized revenue reached an estimated $19 billion, reflecting rapid year-over-year growth.",
                },
                {
                  name: "Anthropic distribution update",
                  url: "https://example.com/distribution-update",
                  snippet: "Anthropic's enterprise distribution widened as Claude Code business subscriptions quadrupled and partner channels expanded.",
                },
              ],
            },
          },
          {
            stepId: "recon",
            toolName: "run_recon",
            success: true,
            durationMs: 11,
            result: {
              findings: [
                { name: "Sacra estimates that Anthropic hit $19B in annualized revenue in March 2026, up 1,167% year-over-year.", direction: "up", impact: "high" },
                { name: "By early March 2026, the company's total run-rate revenue reached approximately $19 billion, with Claude Code and enterprise subscriptions serving as key growth drivers.", direction: "up", impact: "high" },
                { name: "Business subscriptions to Claude Code have quadrupled since the start of 2026, and enterprise use has grown to represent over half of all Claude Code revenue.", direction: "up", impact: "high" },
                { name: "Large enterprise buyers can use bundled suites and multi-vendor negotiations to pressure pricing and shorten contract duration.", direction: "down", impact: "high" },
              ],
            },
          },
        ],
        totalDurationMs: 24,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
    expect(result.comparables.some((item) => /^(Many|As|By)$/i.test(item.name))).toBe(false);
    expect(result.signals.some((item) => /pricing and contract durability|multi-vendor negotiations to pressure pricing/i.test(item.name))).toBe(true);
    expect(result.signals.filter((item) => /\b(revenue|run-rate|annualized revenue)\b/i.test(item.name)).length).toBeLessThanOrEqual(2);
    expect(result.changes?.some((item) => /Claude Code business subscriptions quadrupled/i.test(item.description))).toBe(true);
  });

  it("filters leading connector words like Despite from banker comparable extraction", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
          synthesisPrompt: "Build a banker-grade packet.",
        },
        stepResults: [
          {
            stepId: "linkup",
            toolName: "linkup_search",
            success: true,
            durationMs: 14,
            result: {
              answer: "Anthropic is being evaluated against OpenAI and Google as enterprise buyers pressure pricing and demand contract durability.",
              sources: [
                {
                  name: "Enterprise AI buyer note",
                  url: "https://example.com/buyer-note",
                  snippet: "Despite Google's bundled distribution, enterprise buyers still compare Anthropic, OpenAI, and Google on pricing, retention, and contract durability.",
                },
              ],
            },
          },
        ],
        totalDurationMs: 14,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "banker",
      async () => {
        throw new Error("call_llm tool unavailable in this test");
      },
    );

    expect(result.comparables.map((item) => item.name)).toEqual(expect.arrayContaining(["OpenAI", "Google"]));
    expect(result.comparables.some((item) => /^Despite$/i.test(item.name))).toBe(false);
  });

  it("prefers fallback operational changes when llm change bullets are clipped mid-sentence", async () => {
    const result = await synthesizeResults(
      {
        plan: {
          objective: "Analyze Anthropic",
          classification: "competitor",
          entityTargets: ["Anthropic"],
          steps: [],
          synthesisPrompt: "Build a banker-grade packet.",
        },
        stepResults: [
          {
            stepId: "recon",
            toolName: "run_recon",
            success: true,
            durationMs: 12,
            result: {
              findings: [
                { name: "Business subscriptions to Claude Code have quadrupled since the start of 2026, and enterprise use has grown to represent over half of all Claude Code revenue.", direction: "up", impact: "high" },
                { name: "OpenAI posted a 33% gross margin, constrained by inference costs that reached $8.4B in 2025 and are projected to rise to $14.1B in 2026, with paying users accounting for approximately 66% of inference spend.", direction: "up", impact: "high" },
              ],
            },
          },
        ],
        totalDurationMs: 12,
        totalCostUsd: 0,
        adaptations: 0,
      },
      "Analyze Anthropic competitive position in enterprise AI for an investor.",
      "banker",
      async (toolName) => {
        if (toolName !== "call_llm") {
          throw new Error(`Unexpected tool ${toolName}`);
        }
        return {
          response: JSON.stringify({
            entityName: "Anthropic",
            answer: "Anthropic's enterprise operating momentum is accelerating.",
            confidence: 91,
            signals: [
              { name: "Anthropic's enterprise operating momentum is accelerating.", direction: "up", impact: "high" },
            ],
            changes: [
              { description: "Business subscriptions to Claude Code have quadrupled since the start of 2026, and enterprise use has grown to represent over half of all Claude Code" },
              { description: "OpenAI posted a 33% gross margin, constrained by inference costs that reached $8.4B in 2025 and are projected to rise to $14.1B in 2026, with paying u" },
            ],
            risks: [
              { title: "Pricing pressure", description: "Large enterprise buyers can use bundled suites to pressure pricing." },
            ],
            comparables: [
              { name: "OpenAI", relevance: "high", note: "Direct operating peer." },
              { name: "Google", relevance: "medium", note: "Bundled platform pressure." },
            ],
            nextActions: [
              { action: "Benchmark Anthropic against OpenAI on enterprise pricing.", impact: "high" },
            ],
            nextQuestions: [
              "How durable is Anthropic's contract expansion versus peers?",
            ],
            sources: [
              { label: "Enterprise AI buyer note", href: "https://example.com/buyer-note", type: "web" },
            ],
          }),
        };
      },
    );

    expect(result.changes.some((item) => /Claude Code revenue$/i.test(item.description))).toBe(true);
    expect(result.changes.some((item) => /paying users accounting for approximately 66% of inference spend$/i.test(item.description))).toBe(true);
    expect(result.changes.some((item) => /\bpaying u\b/i.test(item.description))).toBe(false);
  });
});
