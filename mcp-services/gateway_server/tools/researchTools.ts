/**
 * Research & Intelligence tools for external agents.
 * Proxies Convex queries/actions from research, forYouFeed, dashboard, and dossier domains.
 */

import { convexQuery, convexMutation, convexAction } from "../convexClient.js";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<unknown>;
};

export const researchTools: McpTool[] = [
  {
    name: "nodebench.entities.resolve",
    description:
      "Resolve a public company, person, role, product, investor, school, or source into a stable NodeBench entity ID with aliases and confidence.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Entity name, such as OpenAI or Sam Altman." },
        kind: {
          type: "string",
          enum: ["Company", "Person", "Role", "Product", "Investor", "School", "Source"],
          description: "Optional entity kind hint.",
        },
        domain: { type: "string", description: "Optional website or email domain hint." },
        url: { type: "string", description: "Optional public URL hint." },
        aliases: {
          type: "array",
          items: { type: "string" },
          description: "Optional known aliases.",
        },
      },
      required: ["name"],
    },
    handler: async (args) => {
      return await convexMutation("domains/publicResearch/core:resolveEntity", args);
    },
  },
  {
    name: "nodebench.search_public_sources",
    description:
      "Search NodeBench public research memory and source cache for public facts about an entity. Private email, resume, and inbox text must not be sent here.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Public research query." },
        kind: {
          type: "string",
          enum: ["Company", "Person", "Role", "Product", "Investor", "School", "Source"],
        },
        limit: { type: "number", description: "Maximum results to return." },
      },
      required: ["query"],
    },
    handler: async (args) => {
      return await convexAction("domains/publicResearch/actions:searchPublicSources", args);
    },
  },
  {
    name: "nodebench.research_company",
    description:
      "Run or reuse public-source company research, store verified public claims, and return a compact company dossier.",
    inputSchema: {
      type: "object",
      properties: {
        companyName: { type: "string", description: "Company name to research." },
        domain: { type: "string", description: "Optional company domain." },
        goal: { type: "string", description: "Research goal, such as job_match or interview_prep." },
        visibility: {
          type: "string",
          enum: ["public", "private_guided"],
          description: "Use private_guided only when private signals guide research without entering public storage.",
        },
        forceRefresh: { type: "boolean", description: "Force a fresh run." },
      },
      required: ["companyName"],
    },
    handler: async (args) => {
      return await convexAction("domains/publicResearch/actions:researchCompany", args);
    },
  },
  {
    name: "nodebench.research_person",
    description:
      "Run or reuse public-source person research, store verified public claims, and return a compact person dossier.",
    inputSchema: {
      type: "object",
      properties: {
        personName: { type: "string", description: "Person name to research." },
        domain: { type: "string", description: "Optional related domain." },
        goal: { type: "string", description: "Research goal." },
        visibility: {
          type: "string",
          enum: ["public", "private_guided"],
        },
        forceRefresh: { type: "boolean" },
      },
      required: ["personName"],
    },
    handler: async (args) => {
      return await convexAction("domains/publicResearch/actions:researchPerson", args);
    },
  },
  {
    name: "nodebench.research_role",
    description:
      "Run or reuse public role research, store public hiring or market claims, and return a compact role dossier.",
    inputSchema: {
      type: "object",
      properties: {
        roleTitle: { type: "string", description: "Role title to research." },
        companyName: { type: "string", description: "Optional company context." },
        goal: { type: "string", description: "Research goal." },
        visibility: {
          type: "string",
          enum: ["public", "private_guided"],
        },
        forceRefresh: { type: "boolean" },
      },
      required: ["roleTitle"],
    },
    handler: async (args) => {
      return await convexAction("domains/publicResearch/actions:researchRole", args);
    },
  },
  {
    name: "nodebench.dossiers.get",
    description:
      "Get a sourced public dossier for an entity by entity ID, key, name, or domain.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        entityKey: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
      },
    },
    handler: async (args) => {
      return await convexQuery("domains/publicResearch/core:getEntityDossier", args);
    },
  },
  {
    name: "nodebench.context.pack",
    description:
      "Return a compact context pack for a use case like job_match, interview_prep, sales_research, or product_intel. Apps should do private scoring locally.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        entityKey: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
        useCase: {
          type: "string",
          enum: ["job_match", "interview_prep", "sales_research", "product_intel", "general"],
        },
      },
      required: ["useCase"],
    },
    handler: async (args) => {
      return await convexQuery("domains/publicResearch/core:getContextPack", args);
    },
  },
  {
    name: "nodebench.get_matching_context",
    description:
      "Alias for nodebench.context.pack optimized for app-local matching and scoring flows.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        entityKey: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
        useCase: { type: "string" },
      },
      required: ["useCase"],
    },
    handler: async (args) => {
      return await convexQuery("domains/publicResearch/core:getContextPack", args);
    },
  },
  {
    name: "nodebench.compile_interview_packet",
    description:
      "Compile a public interview-prep context pack for a company or person. Resume-specific fit scoring must happen in the calling app.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        entityKey: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
      },
    },
    handler: async (args) => {
      return await convexQuery("domains/publicResearch/core:getContextPack", {
        ...args,
        useCase: "interview_prep",
      });
    },
  },
  {
    name: "nodebench.claims.submit_public",
    description:
      "Submit a sourced public claim. The verifier rejects private sources, raw email/resume/private artifact text, and uncited claims.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        claim: { type: "string" },
        claimType: { type: "string" },
        sourceUrl: { type: "string" },
        sourceTitle: { type: "string" },
        evidenceSnippet: { type: "string" },
        confidence: { type: "number" },
        freshnessTtlDays: { type: "number" },
      },
      required: ["entityId", "claim", "claimType", "sourceUrl", "evidenceSnippet"],
    },
    handler: async (args) => {
      return await convexMutation("domains/publicResearch/core:submitPublicClaim", args);
    },
  },
  {
    name: "nodebench.claims.verify",
    description:
      "Re-run deterministic public/private boundary and source-evidence verification for a stored public claim.",
    inputSchema: {
      type: "object",
      properties: {
        claimId: { type: "string" },
      },
      required: ["claimId"],
    },
    handler: async (args) => {
      return await convexMutation("domains/publicResearch/core:verifyClaim", args);
    },
  },
  {
    name: "nodebench.watch_entity",
    description:
      "Create a watch request for an entity. Current MVP returns the entity and recommended refresh cadence.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        entityKey: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
        cadence: {
          type: "string",
          enum: ["daily", "weekly", "monthly"],
        },
      },
    },
    handler: async (args) => {
      const dossier = await convexQuery("domains/publicResearch/core:getEntityDossier", args);
      return {
        ok: true,
        cadence: args.cadence ?? "weekly",
        dossier,
      };
    },
  },
  {
    name: "nodebench.link_private_signal_to_public_entity",
    description:
      "Link an app-private signal to a public entity by hash only. Raw Gmail, resume, inbox, and private artifact text must not be sent.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        app: { type: "string" },
        privateSignalHash: { type: "string" },
        signalType: { type: "string" },
        expiresAt: { type: "number" },
      },
      required: ["entityId", "app", "privateSignalHash", "signalType"],
    },
    handler: async (args) => {
      return await convexMutation("domains/publicResearch/core:linkPrivateSignalToPublicEntity", args);
    },
  },
  {
    name: "getForYouFeed",
    description:
      "Get the personalized For You feed with ranked research items, funding events, and industry signals. Returns verification-tagged items grouped by date.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max items to return (default 20)",
        },
      },
    },
    handler: async (args) => {
      return await convexQuery("domains/research/forYouFeed:getPublicForYouFeed", {
        limit: args.limit,
      });
    },
  },
  {
    name: "getLatestDashboard",
    description:
      "Get the latest research dashboard snapshot with metrics on deal flow, entity coverage, verification health, and model costs.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return await convexQuery(
        "domains/research/dashboardQueries:getLatestDashboardSnapshot",
        {}
      );
    },
  },
  {
    name: "getTrendingRepos",
    description:
      "Get trending GitHub repositories tracked by NodeBench AI, sorted by growth velocity.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max repos to return (default 10)",
        },
      },
    },
    handler: async (args) => {
      return await convexQuery(
        "domains/research/githubExplorer:getTrendingRepos",
        { limit: args.limit }
      );
    },
  },
  {
    name: "getFastestGrowingRepos",
    description:
      "Get fastest-growing GitHub repositories by star velocity over the past week.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max repos to return (default 10)",
        },
      },
    },
    handler: async (args) => {
      return await convexQuery(
        "domains/research/githubExplorer:getFastestGrowingRepos",
        { limit: args.limit }
      );
    },
  },
  {
    name: "getLatestPublicDossier",
    description:
      "Get the latest public company/industry dossier with competitive analysis and market positioning.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return await convexQuery(
        "domains/research/publicDossierQueries:getLatestPublicDossier",
        {}
      );
    },
  },
  {
    name: "getDealFlow",
    description:
      "Get the current deal flow pipeline with funding events, company data, and investment signals.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return await convexQuery(
        "domains/research/dealFlowQueries:getDealFlow",
        {}
      );
    },
  },
  {
    name: "getEntityInsights",
    description:
      "Get deep entity insights for a company or person, including funding, key people, product pipeline, and persona-specific hooks (banker, VC, CTO, founder).",
    inputSchema: {
      type: "object",
      properties: {
        entityName: {
          type: "string",
          description: "Name of the entity to research",
        },
        entityType: {
          type: "string",
          enum: ["company", "person"],
          description: "Type of entity",
        },
        forceRefresh: {
          type: "boolean",
          description: "Force fresh LLM analysis (default false)",
        },
      },
      required: ["entityName", "entityType"],
    },
    handler: async (args) => {
      return await convexAction(
        "domains/knowledge/entityInsights:getEntityInsights",
        {
          entityName: args.entityName,
          entityType: args.entityType,
          forceRefresh: args.forceRefresh ?? false,
        }
      );
    },
  },
  {
    name: "getSignalTimeseries",
    description:
      "Get time-series signal data for research metrics like funding volume, entity mentions, or verification health over time.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Keyword to search for in signal titles, summaries, and tags.",
        },
        signalType: {
          type: "string",
          description: "Legacy alias for keyword. Prefer keyword for new callers.",
        },
        days: {
          type: "number",
          description: "Number of days to look back (default 30)",
        },
      },
    },
    handler: async (args) => {
      const keyword = typeof args.keyword === "string" ? args.keyword : args.signalType;
      return await convexQuery(
        "domains/research/signalTimeseries:getSignalTimeseries",
        { keyword, signalType: args.signalType, days: args.days }
      );
    },
  },
];
