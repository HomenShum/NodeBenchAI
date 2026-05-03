/**
 * Nodebench Research MCP tools (v1)
 *
 * Minimal external-agent surface for the canonical entity graph:
 *
 *   - nodebench.research_run       → start a research run
 *   - nodebench.expand_resource    → expand a Nodebench URI by one ring
 *
 * Shares the resource URI scheme with the Nodebench HTTP API
 * (see shared/research/resourceCards.ts).
 *
 * Wiring to the active toolset registry is deliberately deferred so this
 * module is net-additive. Import the export into toolsetRegistry.ts when
 * ready to expose to live MCP clients.
 */

import type { McpTool } from "../types.js";

function getNodebenchApiUrl(): string {
  return process.env.NODEBENCH_API_URL ?? "";
}

function ensureApi(): string | null {
  if (!getNodebenchApiUrl()) {
    return "NODEBENCH_API_URL not configured. Set it to the Nodebench api-headless base URL (e.g. https://api.nodebench.ai).";
  }
  return null;
}

interface ResearchRunArgs {
  objective: string;
  mode?: "auto" | "analyze" | "prepare" | "monitor" | "compare" | "decision_support" | "summarize";
  subjects: Array<{
    type:
      | "email"
      | "person"
      | "company"
      | "event"
      | "topic"
      | "repo"
      | "document"
      | "url"
      | "text";
    name?: string;
    url?: string;
    text?: string;
    hints?: string[];
    raw?: Record<string, unknown>;
  }>;
  lens_id?: "company_dossier";
  depth?: "quick" | "standard";
  angles?: string[];
  constraints?: {
    freshness_days?: number;
    latency_budget_ms?: number;
    prefer_cache?: boolean;
    max_external_calls?: number;
    evidence_min_sources_per_major_claim?: number;
  };
  deliverables?: Array<
    | "json_full"
    | "compact_alert"
    | "ntfy_brief"
    | "notion_markdown"
    | "executive_brief"
    | "dossier_markdown"
    | "email_digest"
    | "ui_card_bundle"
  >;
}

interface ExpandResourceArgs {
  uri: string;
  lens_id?: "company_dossier";
  depth?: "quick" | "standard";
  expand_mode?: "ring_plus_one" | "ring_two" | "single_card";
}

type PublicEntityType = "company" | "person" | "role" | "product" | "investor" | "school" | "source";

interface PublicEntitySignal {
  entityId?: string;
  entityType?: PublicEntityType;
  name?: string;
  domain?: string;
  url?: string;
  aliases?: string[];
  linkedinUrl?: string;
  githubUrl?: string;
}

interface EntityResolveArgs extends PublicEntitySignal {}

interface PublicResearchCompanyArgs {
  companyName: string;
  domain?: string;
  goal?: string;
  visibility?: "public" | "private_guided";
}

interface PublicResearchPersonArgs {
  personName: string;
  goal?: string;
  visibility?: "public" | "private_guided";
}

interface PublicResearchRoleArgs {
  roleTitle: string;
  companyName?: string;
  goal?: string;
}

interface PublicDossierArgs {
  entityKey?: string;
  entityType?: PublicEntityType;
  name?: string;
}

interface PublicContextPackArgs extends PublicDossierArgs {
  useCase?: "job_match" | "interview_prep" | "sales_research" | "general";
}

interface SubmitPublicClaimArgs {
  entity: PublicEntitySignal;
  claim: string;
  claimType: string;
  sourceUrl: string;
  sourceTitle?: string;
  evidenceSnippet: string;
  confidence?: number;
  submittedBySurface?: string;
}

interface VerifyPublicClaimArgs {
  claimId: string;
}

interface WatchEntityArgs {
  entity: PublicEntitySignal;
  goal?: string;
}

interface PrivateSignalLinkArgs {
  ownerKey: string;
  entity: PublicEntitySignal;
  privateSignalKind: string;
  privateSignalSummary: string;
  publicPurpose: string;
}

interface EventCaptureArgs {
  text: string;
  workspaceId?: string;
  eventId?: string;
  eventSessionId?: string;
  anonymousSessionId?: string;
  title?: string;
  kind?: "text" | "voice" | "image" | "screenshot" | "file";
}

interface NotebookAppendArgs {
  reportId: string;
  text: string;
  anonymousSessionId?: string;
}

interface ReportExportPreviewArgs {
  reportId: string;
  format?: "crm_csv" | "csv" | "hubspot_csv" | "salesforce_csv" | "attio_csv" | "affinity_csv" | "notion_csv" | "json" | "markdown";
  anonymousSessionId?: string;
}

interface ReportExportCompleteArgs {
  reportId: string;
  exportKey: string;
  anonymousSessionId?: string;
}

interface ActivityTimelineArgs {
  reportId: string;
  anonymousSessionId?: string;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const apiKey = process.env.NODEBENCH_API_KEY ?? process.env.NODEBENCH_API_TOKEN ?? "";
  const res = await fetch(`${getNodebenchApiUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nodebench ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

async function getJson(path: string): Promise<unknown> {
  const apiKey = process.env.NODEBENCH_API_KEY ?? process.env.NODEBENCH_API_TOKEN ?? "";
  const res = await fetch(`${getNodebenchApiUrl()}${path}`, {
    method: "GET",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nodebench ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

export const nodebenchResearchTools: McpTool[] = [
  {
    name: "nodebench.entities.resolve",
    description:
      "Resolve or create a stable NodeBench public entity registry record from a company, person, domain, URL, or alias. Returns canonical entity_id/entity_key and candidates.",
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["company", "person", "role", "product", "investor", "school", "source"] },
        name: { type: "string" },
        domain: { type: "string" },
        url: { type: "string" },
        aliases: { type: "array", items: { type: "string" } },
        linkedinUrl: { type: "string" },
        githubUrl: { type: "string" },
      },
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: EntityResolveArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/entities/resolve", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.search_public_sources",
    description:
      "Search public sources through NodeBench without using private user context. Optionally associates the query with an entity signal.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        entity: { type: "object", additionalProperties: true },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: async (args: { query: string; entity?: PublicEntitySignal; maxResults?: number }) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/search-public-sources", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.research_company",
    description:
      "Run public-source company research, store reusable claim-level public facts, and return a sourced compact dossier. Do not pass raw email or resume text.",
    inputSchema: {
      type: "object",
      properties: {
        companyName: { type: "string" },
        domain: { type: "string" },
        goal: { type: "string" },
        visibility: { type: "string", enum: ["public", "private_guided"] },
      },
      required: ["companyName"],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: async (args: PublicResearchCompanyArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/research/company", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.research_person",
    description:
      "Run public-source person research, store only sourced public claims, and return a compact dossier. Avoid sensitive trait inference.",
    inputSchema: {
      type: "object",
      properties: {
        personName: { type: "string" },
        goal: { type: "string" },
        visibility: { type: "string", enum: ["public", "private_guided"] },
      },
      required: ["personName"],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: async (args: PublicResearchPersonArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/research/person", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.research_role",
    description:
      "Build public role/company context for job matching without storing private email or resume content. Returns a context pack suitable for Gmail-local scoring.",
    inputSchema: {
      type: "object",
      properties: {
        roleTitle: { type: "string" },
        companyName: { type: "string" },
        goal: { type: "string" },
      },
      required: ["roleTitle"],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: async (args: PublicResearchRoleArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/research/role", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.get_entity_dossier",
    description:
      "Get a sourced public entity dossier from NodeBench public research memory by entity_key or name/type.",
    inputSchema: {
      type: "object",
      properties: {
        entityKey: { type: "string" },
        entityType: { type: "string", enum: ["company", "person", "role", "product", "investor", "school", "source"] },
        name: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args: PublicDossierArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        if (args.entityKey) return await getJson(`/v1/public-research/dossiers/${encodeURIComponent(args.entityKey)}`);
        return await postJson("/v1/public-research/context/pack", { ...args, useCase: "general" });
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.context.pack",
    description:
      "Return a compact public context pack for a use case such as job_match, interview_prep, or sales_research. Calling apps keep private scoring locally.",
    inputSchema: {
      type: "object",
      properties: {
        entityKey: { type: "string" },
        entityType: { type: "string", enum: ["company", "person", "role", "product", "investor", "school", "source"] },
        name: { type: "string" },
        useCase: { type: "string", enum: ["job_match", "interview_prep", "sales_research", "general"] },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args: PublicContextPackArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/context/pack", {
          ...args,
          useCase: args.useCase ?? "general",
        });
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.get_matching_context",
    description:
      "Get public job-match context for an entity. This is the Gmail-safe tool: it returns public signals and source refs, not private fit scoring.",
    inputSchema: {
      type: "object",
      properties: {
        entityKey: { type: "string" },
        entityType: { type: "string", enum: ["company", "person", "role", "product", "investor", "school", "source"] },
        name: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args: PublicDossierArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/context/pack", { ...args, useCase: "job_match" });
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.compile_interview_packet",
    description:
      "Compile a sourced public interview-prep packet for a company/person/role. Private resume matching remains outside NodeBench.",
    inputSchema: {
      type: "object",
      properties: {
        entityKey: { type: "string" },
        entityType: { type: "string", enum: ["company", "person", "role", "product", "investor", "school", "source"] },
        name: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args: PublicDossierArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/context/pack", { ...args, useCase: "interview_prep" });
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.submit_public_claim",
    description:
      "Submit a sourced public claim to NodeBench. The verifier rejects private email/resume-derived text and non-public URLs.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "object", additionalProperties: true },
        claim: { type: "string" },
        claimType: { type: "string" },
        sourceUrl: { type: "string" },
        sourceTitle: { type: "string" },
        evidenceSnippet: { type: "string" },
        confidence: { type: "number" },
        submittedBySurface: { type: "string" },
      },
      required: ["entity", "claim", "claimType", "sourceUrl", "evidenceSnippet"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: SubmitPublicClaimArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/claims/submit-public", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.claims.verify",
    description:
      "Re-run deterministic public-source, evidence, freshness, and private-boundary verification for a stored public claim.",
    inputSchema: {
      type: "object",
      properties: {
        claimId: { type: "string" },
      },
      required: ["claimId"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: VerifyPublicClaimArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/claims/verify", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.watch_entity",
    description:
      "Start a public-guided research run for an entity so it appears in NodeBench public research memory and can be refreshed by later infrastructure.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "object", additionalProperties: true },
        goal: { type: "string" },
      },
      required: ["entity"],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: async (args: WatchEntityArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/research/start", {
          entity: args.entity,
          kind: args.entity.entityType ?? "company",
          goal: args.goal ?? "Watch entity for public research refresh",
          visibility: "public",
        });
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.link_private_signal_to_public_entity",
    description:
      "Link a private app signal to a public entity without storing raw private text. NodeBench stores only a hash and purpose; the app keeps private data.",
    inputSchema: {
      type: "object",
      properties: {
        ownerKey: { type: "string" },
        entity: { type: "object", additionalProperties: true },
        privateSignalKind: { type: "string" },
        privateSignalSummary: { type: "string" },
        publicPurpose: { type: "string" },
      },
      required: ["ownerKey", "entity", "privateSignalKind", "privateSignalSummary", "publicPurpose"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: PrivateSignalLinkArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/public-research/private-links", args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "unknown error" };
      }
    },
  },
  {
    name: "nodebench.research_run",
    description:
      "Start an adaptive, evidence-backed research run on one or more subjects (companies, people, events, topics). Reuses precomputed angles when available. Returns a runId the client can poll or stream. v1 ships the company_dossier lens only.",
    inputSchema: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description:
            "What the user is trying to decide or learn (e.g., 'understand Acme AI before a meeting').",
        },
        subjects: {
          type: "array",
          description: "1–10 research subjects.",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "email",
                  "person",
                  "company",
                  "event",
                  "topic",
                  "repo",
                  "document",
                  "url",
                  "text",
                ],
              },
              name: { type: "string" },
              url: { type: "string" },
              text: { type: "string" },
              hints: { type: "array", items: { type: "string" } },
              raw: { type: "object", additionalProperties: true },
            },
            required: ["type"],
          },
          minItems: 1,
          maxItems: 10,
        },
        lens_id: { type: "string", enum: ["company_dossier"] },
        depth: { type: "string", enum: ["quick", "standard"] },
        mode: {
          type: "string",
          enum: ["auto", "analyze", "prepare", "monitor", "compare", "decision_support", "summarize"],
        },
        angles: {
          type: "array",
          items: { type: "string" },
          description: "Optional explicit NodeBench angle IDs to run.",
        },
        constraints: {
          type: "object",
          additionalProperties: true,
          description: "Optional runtime constraints passed through to NodeBench research runs.",
        },
        deliverables: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "json_full",
              "compact_alert",
              "ntfy_brief",
              "notion_markdown",
              "executive_brief",
              "dossier_markdown",
              "email_digest",
              "ui_card_bundle",
            ],
          },
        },
      },
      required: ["objective", "subjects"],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: async (args: ResearchRunArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        const angles = args.angles?.filter(Boolean) ?? [];
        const body = {
          goal: { objective: args.objective, mode: args.mode ?? ("analyze" as const) },
          subjects: args.subjects.map((s) => ({
            type: s.type,
            name: s.name,
            url: s.url,
            hints: s.hints,
            raw: { ...(s.raw ?? {}), ...(s.text ? { text: s.text } : {}) },
          })),
          angle_strategy: angles.length > 0 ? ("explicit" as const) : ("auto" as const),
          ...(angles.length > 0 ? { angles } : {}),
          depth: args.depth ?? "standard",
          constraints: args.constraints ?? {
            freshness_days: 365,
            latency_budget_ms: 8_000,
            prefer_cache: true,
            max_external_calls: 4,
            evidence_min_sources_per_major_claim: 1,
          },
          deliverables: args.deliverables ?? ["json_full", "ui_card_bundle"],
          context: {
            lens_id: args.lens_id ?? "company_dossier",
            surface: "mcp",
          },
        };
        return await postJson("/v1/research/runs", body);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { error: message };
      }
    },
  },
  {
    name: "nodebench.capture",
    description:
      "Persist a messy event capture into the active NodeBench event workspace without live paid search. Uses event corpus / memory-first policy and returns budget-aware status copy.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Raw field note, transcript, screenshot OCR text, or follow-up captured at the event.",
        },
        workspaceId: {
          type: "string",
          description: "Event workspace slug. Defaults to ship-demo-day for local/demo runs.",
        },
        eventId: { type: "string" },
        eventSessionId: { type: "string" },
        anonymousSessionId: {
          type: "string",
          description: "Optional anonymous/session owner key so captures can be read by the matching browser session.",
        },
        title: { type: "string" },
        kind: {
          type: "string",
          enum: ["text", "voice", "image", "screenshot", "file"],
        },
      },
      required: ["text"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: EventCaptureArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/event-captures", {
          text: args.text,
          workspaceId: args.workspaceId ?? "ship-demo-day",
          eventId: args.eventId,
          eventSessionId: args.eventSessionId,
          anonymousSessionId: args.anonymousSessionId,
          title: args.title,
          kind: args.kind ?? "text",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { error: message };
      }
    },
  },
  {
    name: "nodebench.notebook_append",
    description:
      "Append reviewed text into a NodeBench report notebook through the same Convex-backed report notebook persistence used by the web UI.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: { type: "string" },
        text: { type: "string" },
        anonymousSessionId: {
          type: "string",
          description: "Optional anonymous/session owner key matching the report owner.",
        },
      },
      required: ["reportId", "text"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: NotebookAppendArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson(`/v1/reports/${encodeURIComponent(args.reportId)}/notebook/append`, {
          text: args.text,
          anonymousSessionId: args.anonymousSessionId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { error: message };
      }
    },
  },
  {
    name: "nodebench.report_export_preview",
    description:
      "Prepare a reviewable NodeBench report export. Returns mapped contacts, companies, interactions, follow-ups, claims, and sources before any completed export.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: { type: "string" },
        format: {
          type: "string",
          enum: ["crm_csv", "csv", "hubspot_csv", "salesforce_csv", "attio_csv", "affinity_csv", "notion_csv", "json", "markdown"],
        },
        anonymousSessionId: { type: "string" },
      },
      required: ["reportId"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: ReportExportPreviewArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson(`/v1/reports/${encodeURIComponent(args.reportId)}/exports/preview`, {
          format: args.format ?? "crm_csv",
          anonymousSessionId: args.anonymousSessionId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { error: message };
      }
    },
  },
  {
    name: "nodebench.report_export_complete",
    description:
      "Complete a previously previewed NodeBench report export after review. Writes the export completion event to the activity ledger.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: { type: "string" },
        exportKey: { type: "string" },
        anonymousSessionId: { type: "string" },
      },
      required: ["reportId", "exportKey"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args: ReportExportCompleteArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson(`/v1/reports/${encodeURIComponent(args.reportId)}/exports/complete`, {
          exportKey: args.exportKey,
          anonymousSessionId: args.anonymousSessionId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { error: message };
      }
    },
  },
  {
    name: "nodebench.activity_timeline",
    description:
      "Read the canonical activity ledger for a NodeBench report, including captures, notebook patches, graph clicks, export events, and search/cache decisions.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: { type: "string" },
        anonymousSessionId: { type: "string" },
      },
      required: ["reportId"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args: ActivityTimelineArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        const query = args.anonymousSessionId
          ? `?anonymousSessionId=${encodeURIComponent(args.anonymousSessionId)}`
          : "";
        return await getJson(`/v1/reports/${encodeURIComponent(args.reportId)}/timeline${query}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { error: message };
      }
    },
  },
  {
    name: "nodebench.expand_resource",
    description:
      "Expand a Nodebench resource URI (nodebench://org/{key}) by one ring using the requested lens + depth. Returns cards, evidence refs, and next-hop URIs shaped for recursive exploration.",
    inputSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description:
            "Nodebench URI. v1 supports nodebench://org/{entityKey} only.",
        },
        lens_id: { type: "string", enum: ["company_dossier"] },
        depth: { type: "string", enum: ["quick", "standard"] },
        expand_mode: {
          type: "string",
          enum: ["ring_plus_one", "ring_two", "single_card"],
        },
      },
      required: ["uri"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args: ExpandResourceArgs) => {
      const apiErr = ensureApi();
      if (apiErr) return { error: apiErr };
      try {
        return await postJson("/v1/resources/expand", {
          uri: args.uri,
          lens_id: args.lens_id ?? "company_dossier",
          depth: args.depth ?? "standard",
          expand_mode: args.expand_mode ?? "ring_plus_one",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { error: message };
      }
    },
  },
];
