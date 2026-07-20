/**
 * Architect Tools — Structural code analysis for Convex projects.
 *
 * Convex-specific variant of the mcp-local architect tools. Instead of
 * generic React/Express patterns, these scan for Convex function types,
 * schema constructs, data access patterns, auth guards, storage usage,
 * scheduler calls, and client-side hooks.
 *
 * 3 tools:
 * - convex_scan_capabilities: Analyze a file for Convex structural patterns
 * - convex_verify_concept: Check if a file has required code signatures
 * - convex_generate_plan: Build a plan for missing signatures
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, genId } from "../db.js";
import { getQuickRef } from "./toolRegistry.js";
import type { McpTool } from "../types.js";

// ── DB setup ────────────────────────────────────────────────────────────────

function ensureConceptTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS concept_verifications (
      id TEXT PRIMARY KEY,
      concept_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL,
      match_score REAL NOT NULL,
      signatures_total INTEGER NOT NULL,
      signatures_found INTEGER NOT NULL,
      gap_list TEXT,
      verified_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ── Convex-specific pattern definitions ──────────────────────────────────

interface PatternCategory {
  [key: string]: { pattern: RegExp; count?: boolean };
}

const FUNCTION_TYPE_PATTERNS: PatternCategory = {
  queries: { pattern: /(?:export\s+(?:const|default)\s+\w+\s*=\s*)?query\s*\(/g, count: true },
  internal_queries: { pattern: /internalQuery\s*\(/g, count: true },
  mutations: { pattern: /(?:export\s+(?:const|default)\s+\w+\s*=\s*)?mutation\s*\(/g, count: true },
  internal_mutations: { pattern: /internalMutation\s*\(/g, count: true },
  actions: { pattern: /(?:export\s+(?:const|default)\s+\w+\s*=\s*)?action\s*\(/g, count: true },
  internal_actions: { pattern: /internalAction\s*\(/g, count: true },
  http_actions: { pattern: /httpAction\s*\(/g, count: true },
  cron_handlers: { pattern: /cronJobs\.|crons\./g, count: true },
};

const SCHEMA_PATTERNS: PatternCategory = {
  define_schema: { pattern: /defineSchema\s*\(/ },
  define_table: { pattern: /defineTable\s*\(/g, count: true },
  indexes: { pattern: /\.index\s*\(/g, count: true },
  search_indexes: { pattern: /\.searchIndex\s*\(/g, count: true },
  vector_indexes: { pattern: /\.vectorIndex\s*\(/g, count: true },
  validators: { pattern: /v\.\w+\s*\(/g, count: true },
  v_id_refs: { pattern: /v\.id\s*\(\s*["']/g, count: true },
  v_optional: { pattern: /v\.optional\s*\(/g, count: true },
  v_union: { pattern: /v\.union\s*\(/g, count: true },
};

const DATA_ACCESS_PATTERNS: PatternCategory = {
  db_query: { pattern: /ctx\.db\.query\s*\(/g, count: true },
  db_get: { pattern: /ctx\.db\.get\s*\(/g, count: true },
  db_insert: { pattern: /ctx\.db\.insert\s*\(/g, count: true },
  db_patch: { pattern: /ctx\.db\.patch\s*\(/g, count: true },
  db_replace: { pattern: /ctx\.db\.replace\s*\(/g, count: true },
  db_delete: { pattern: /ctx\.db\.delete\s*\(/g, count: true },
  collect: { pattern: /\.collect\s*\(/g, count: true },
  first: { pattern: /\.first\s*\(/g, count: true },
  unique: { pattern: /\.unique\s*\(/g, count: true },
  paginate: { pattern: /\.paginate\s*\(/g, count: true },
  with_index: { pattern: /\.withIndex\s*\(/g, count: true },
  with_search_index: { pattern: /\.withSearchIndex\s*\(/g, count: true },
  filter: { pattern: /\.filter\s*\(/g, count: true },
  order: { pattern: /\.order\s*\(/g, count: true },
};

const AUTH_AND_CONTEXT_PATTERNS: PatternCategory = {
  get_user_identity: { pattern: /ctx\.auth\.getUserIdentity\s*\(/g, count: true },
  identity_check: { pattern: /if\s*\(\s*!?\s*identity|if\s*\(\s*!?\s*user/g, count: true },
  run_mutation: { pattern: /ctx\.runMutation\s*\(/g, count: true },
  run_query: { pattern: /ctx\.runQuery\s*\(/g, count: true },
  run_action: { pattern: /ctx\.runAction\s*\(/g, count: true },
  scheduler_run_after: { pattern: /ctx\.scheduler\.runAfter\s*\(/g, count: true },
  scheduler_run_at: { pattern: /ctx\.scheduler\.runAt\s*\(/g, count: true },
};

const STORAGE_PATTERNS: PatternCategory = {
  storage_store: { pattern: /ctx\.storage\.store\s*\(/g, count: true },
  storage_get: { pattern: /ctx\.storage\.get\s*\(/g, count: true },
  storage_get_url: { pattern: /ctx\.storage\.getUrl\s*\(/g, count: true },
  storage_delete: { pattern: /ctx\.storage\.delete\s*\(/g, count: true },
  generate_upload_url: { pattern: /ctx\.storage\.generateUploadUrl\s*\(/g, count: true },
};

const CLIENT_PATTERNS: PatternCategory = {
  use_query: { pattern: /useQuery\s*\(/g, count: true },
  use_mutation: { pattern: /useMutation\s*\(/g, count: true },
  use_action: { pattern: /useAction\s*\(/g, count: true },
  use_convex: { pattern: /useConvex\s*\(/ },
  convex_provider: { pattern: /ConvexProvider|ConvexReactClient/ },
  convex_react_import: { pattern: /from\s+["']convex\/react["']/ },
  api_import: { pattern: /from\s+["']\.\.?\/_generated\/api["']/ },
};

function analyzePatterns(content: string, patterns: PatternCategory): Record<string, number | boolean> {
  const result: Record<string, number | boolean> = {};
  for (const [key, { pattern, count }] of Object.entries(patterns)) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (count) {
      const matches = content.match(pattern);
      result[key] = matches ? matches.length : 0;
    } else {
      result[key] = pattern.test(content);
      pattern.lastIndex = 0; // Reset after test
    }
  }
  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────

function findConvexDir(projectDir: string): string | null {
  // convex.json "functions" overrides the default directory, same as the Convex CLI.
  const configPath = join(projectDir, "convex.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as { functions?: string };
      if (typeof config.functions === "string" && config.functions.length > 0) {
        const configured = join(projectDir, config.functions);
        if (existsSync(configured)) return configured;
      }
    } catch {
      // fall through to the conventional candidates
    }
  }
  const candidates = [
    join(projectDir, "convex"),
    join(projectDir, "src", "convex"),
    join(projectDir, "backend", "convex"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "_generated") {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

// ── Tools ──────────────────────────────────────────────────────────────────

export const architectTools: McpTool[] = [
  {
    name: "convex_scan_capabilities",
    description:
      "Analyze Convex source files for structural patterns. Scans a single file or entire convex/ directory and returns a capability report: function types (queries, mutations, actions, crons, http), schema constructs (tables, indexes, validators), data access (query, get, insert, patch, delete, collect, paginate), auth/context (getUserIdentity, runMutation, scheduler), storage (store, getUrl, delete), and client-side hooks (useQuery, useMutation, useAction). Pure regex — no LLM needed.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root containing a convex/ directory. If provided, scans all .ts files in convex/.",
        },
        filePath: {
          type: "string",
          description: "Absolute path to a single file to analyze. Takes priority over projectDir.",
        },
      },
      required: [],
    },
    handler: async (args: { projectDir?: string; filePath?: string }) => {
      if (args.filePath) {
        // Single file mode
        if (!existsSync(args.filePath)) {
          return { error: `File not found: ${args.filePath}` };
        }
        const content = readFileSync(args.filePath, "utf-8");
        const lines = content.split("\n").length;

        return {
          mode: "single_file",
          file: {
            path: args.filePath,
            lines,
            sizeBytes: Buffer.byteLength(content, "utf-8"),
          },
          function_types: analyzePatterns(content, FUNCTION_TYPE_PATTERNS),
          schema_constructs: analyzePatterns(content, SCHEMA_PATTERNS),
          data_access: analyzePatterns(content, DATA_ACCESS_PATTERNS),
          auth_and_context: analyzePatterns(content, AUTH_AND_CONTEXT_PATTERNS),
          storage: analyzePatterns(content, STORAGE_PATTERNS),
          client_side: analyzePatterns(content, CLIENT_PATTERNS),
          imports: {
            count: (content.match(/^import /gm) || []).length,
            has_convex_server: /from\s+["']convex\/server["']/.test(content),
            has_convex_values: /from\s+["']convex\/values["']/.test(content),
            has_convex_react: /from\s+["']convex\/react["']/.test(content),
            has_generated_api: /from\s+["']\.\.?\/_generated\/api["']/.test(content),
            has_generated_server: /from\s+["']\.\.?\/_generated\/server["']/.test(content),
          },
          exports: {
            default_export: /export default/.test(content),
            named_exports: (content.match(/^export (?:const|function|class|type|interface)/gm) || []).length,
          },
          quickRef: getQuickRef("convex_scan_capabilities"),
        };
      }

      // Directory mode — scan all convex/ files
      if (!args.projectDir) {
        return { error: "Provide either projectDir or filePath" };
      }

      const projectDir = resolve(args.projectDir);
      const convexDir = findConvexDir(projectDir);
      if (!convexDir) {
        return { error: "No convex/ directory found" };
      }

      const files = collectTsFiles(convexDir);
      const aggregate: Record<string, Record<string, number>> = {
        function_types: {},
        schema_constructs: {},
        data_access: {},
        auth_and_context: {},
        storage: {},
      };

      const fileCapabilities: Array<{
        file: string;
        lines: number;
        functionTypes: number;
        dataAccess: number;
      }> = [];

      for (const filePath of files) {
        const content = readFileSync(filePath, "utf-8");
        const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
        const lines = content.split("\n").length;

        const ft = analyzePatterns(content, FUNCTION_TYPE_PATTERNS);
        const da = analyzePatterns(content, DATA_ACCESS_PATTERNS);

        // Aggregate counts
        for (const [category, patterns] of [
          ["function_types", FUNCTION_TYPE_PATTERNS],
          ["schema_constructs", SCHEMA_PATTERNS],
          ["data_access", DATA_ACCESS_PATTERNS],
          ["auth_and_context", AUTH_AND_CONTEXT_PATTERNS],
          ["storage", STORAGE_PATTERNS],
        ] as const) {
          const results = analyzePatterns(content, patterns);
          for (const [key, val] of Object.entries(results)) {
            if (typeof val === "number") {
              aggregate[category][key] = (aggregate[category][key] ?? 0) + val;
            } else if (val === true) {
              aggregate[category][key] = (aggregate[category][key] ?? 0) + 1;
            }
          }
        }

        const ftTotal: number = Object.values(ft).reduce<number>((s, v) => s + (typeof v === "number" ? v : v ? 1 : 0), 0);
        const daTotal: number = Object.values(da).reduce<number>((s, v) => s + (typeof v === "number" ? v : v ? 1 : 0), 0);

        if (ftTotal > 0 || daTotal > 0) {
          fileCapabilities.push({
            file: relativePath,
            lines,
            functionTypes: ftTotal,
            dataAccess: daTotal,
          });
        }
      }

      // Sort by most active files
      fileCapabilities.sort((a, b) => (b.functionTypes + b.dataAccess) - (a.functionTypes + a.dataAccess));

      return {
        mode: "directory",
        convexDir,
        totalFiles: files.length,
        activeFiles: fileCapabilities.length,
        aggregate,
        topFiles: fileCapabilities.slice(0, 20),
        quickRef: getQuickRef("convex_scan_capabilities"),
      };
    },
  },
  {
    name: "convex_verify_concept",
    description:
      "Check if Convex source files contain all required code signatures for a concept. Provide a concept name (e.g., 'Real-time Subscriptions', 'Vector Search RAG', 'File Upload Pipeline') and regex patterns that MUST exist. Returns match score (0-100%), status, evidence, and gap analysis. Persisted to SQLite for tracking progress. Works on a single file or scans the entire convex/ directory.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root. Scans all convex/ files.",
        },
        filePath: {
          type: "string",
          description: "Path to a single file to verify. Takes priority over projectDir.",
        },
        concept_name: {
          type: "string",
          description: 'The Convex feature/concept to verify (e.g., "Vector Search RAG", "Real-time Pagination", "Scheduled Retry Queue")',
        },
        required_signatures: {
          type: "array",
          items: { type: "string" },
          description:
            'Regex patterns that MUST exist for the concept. E.g., ["vectorIndex", "ctx\\.db\\.query.*withSearchIndex", "v\\.array.*v\\.float64"]',
        },
      },
      required: ["concept_name", "required_signatures"],
    },
    handler: async (args: {
      projectDir?: string;
      filePath?: string;
      concept_name: string;
      required_signatures: string[];
    }) => {
      ensureConceptTable();

      // Gather content
      let content: string;
      let sourcePath: string;

      if (args.filePath) {
        if (!existsSync(args.filePath)) {
          return { error: `File not found: ${args.filePath}` };
        }
        content = readFileSync(args.filePath, "utf-8");
        sourcePath = args.filePath;
      } else if (args.projectDir) {
        const projectDir = resolve(args.projectDir);
        const convexDir = findConvexDir(projectDir);
        if (!convexDir) {
          return { error: "No convex/ directory found" };
        }
        const files = collectTsFiles(convexDir);
        content = files.map(f => readFileSync(f, "utf-8")).join("\n// ── file boundary ──\n");
        sourcePath = convexDir;
      } else {
        return { error: "Provide either projectDir or filePath" };
      }

      const found: Array<{ signature: string; evidence: string }> = [];
      const missing: string[] = [];

      for (const sig of args.required_signatures) {
        try {
          const regex = new RegExp(sig, "i");
          const match = content.match(regex);
          if (match) {
            // Extract surrounding context for evidence
            const idx = content.indexOf(match[0]);
            const lineNum = content.slice(0, idx).split("\n").length;
            const line = content.split("\n")[lineNum - 1]?.trim() || match[0];
            found.push({
              signature: sig,
              evidence: `Line ${lineNum}: ${line.slice(0, 120)}`,
            });
          } else {
            missing.push(sig);
          }
        } catch {
          // Invalid regex — try literal search
          if (content.toLowerCase().includes(sig.toLowerCase())) {
            found.push({ signature: sig, evidence: "(literal match)" });
          } else {
            missing.push(sig);
          }
        }
      }

      const score = args.required_signatures.length > 0
        ? Math.round((found.length / args.required_signatures.length) * 100)
        : 0;

      const status =
        score === 100
          ? "Fully Implemented"
          : score > 50
            ? "Partially Implemented"
            : "Not Implemented";

      // Persist
      const id = genId("cv");
      const db = getDb();
      db.prepare(
        `INSERT INTO concept_verifications (id, concept_name, file_path, status, match_score, signatures_total, signatures_found, gap_list)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        args.concept_name,
        sourcePath,
        status,
        score,
        args.required_signatures.length,
        found.length,
        JSON.stringify(missing)
      );

      return {
        id,
        concept: args.concept_name,
        source: sourcePath,
        status,
        match_score: `${score}%`,
        signatures_total: args.required_signatures.length,
        evidence_found: found,
        gap_analysis: missing,
        recommendation:
          missing.length === 0
            ? "All required signatures found. Concept is fully implemented in your Convex project."
            : missing.length <= 2
              ? `Nearly there — ${missing.length} signature(s) missing: ${missing.join(", ")}`
              : `${missing.length} of ${args.required_signatures.length} signatures missing. Major implementation work needed.`,
        quickRef: getQuickRef("convex_verify_concept"),
      };
    },
  },
  {
    name: "convex_generate_plan",
    description:
      "Generate a Convex-specific implementation plan for missing code signatures. Takes the gap analysis from convex_verify_concept and produces step-by-step instructions with Convex-aware injection strategies (schema changes, function registration, auth guards, index creation, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        concept_name: {
          type: "string",
          description: "The Convex concept being implemented",
        },
        missing_signatures: {
          type: "array",
          items: { type: "string" },
          description: "List of missing regex patterns from convex_verify_concept gap_analysis",
        },
        current_context: {
          type: "string",
          description:
            "Brief description or JSON of current capabilities (from convex_scan_capabilities). Helps avoid conflicts.",
        },
        target_file: {
          type: "string",
          description: "Path to the target file for changes (optional)",
        },
      },
      required: ["concept_name", "missing_signatures"],
    },
    handler: async (args: {
      concept_name: string;
      missing_signatures: string[];
      current_context?: string;
      target_file?: string;
    }) => {
      const steps = args.missing_signatures.map((sig, i) => ({
        step: i + 1,
        requirement: sig,
        description: `Inject pattern matching: ${sig}`,
        strategy: inferConvexStrategy(sig),
        convex_file_hint: inferTargetFile(sig),
        conflicts: args.current_context
          ? `Review current context for overlap with: ${sig}`
          : "No context provided — run convex_scan_capabilities first for conflict detection",
      }));

      return {
        concept: args.concept_name,
        target_file: args.target_file || "(not specified)",
        total_steps: steps.length,
        estimated_complexity:
          steps.length <= 2 ? "low" : steps.length <= 5 ? "medium" : "high",
        context_provided: !!args.current_context,
        steps,
        workflow: [
          "1. Run convex_scan_capabilities on the project (if not already done)",
          "2. Review each step below and implement in order",
          "3. After implementation, run convex_verify_concept to track progress",
          "4. When all signatures match, run the relevant audit tools to validate quality",
          "5. Run convex_quality_gate before deploying",
        ],
        quickRef: getQuickRef("convex_generate_plan"),
      };
    },
  },
];

// ── Convex-specific strategy inference ──────────────────────────────────

function inferConvexStrategy(signature: string): string {
  const lower = signature.toLowerCase();

  // Schema patterns
  if (/definetable|defineschema/i.test(lower))
    return "Add to schema.ts — define table with defineTable() inside defineSchema()";
  if (/vectorindex/i.test(lower))
    return "Add .vectorIndex() to table definition in schema.ts — specify dimensions (must match embedding model) and filterFields";
  if (/searchindex/i.test(lower))
    return "Add .searchIndex() to table definition in schema.ts — specify searchField and filterFields";
  if (/\.index\b/i.test(lower))
    return "Add .index() to table definition in schema.ts — field order matters for query efficiency (equality fields first, then range)";
  if (/v\.id\b/i.test(lower))
    return "Use v.id('tableName') for foreign key references — ensures referential type safety";
  if (/v\.float64|v\.array.*float64/i.test(lower))
    return "Use v.array(v.float64()) for vector embedding fields — NOT v.array(v.number())";
  if (/v\.optional/i.test(lower))
    return "Wrap optional fields with v.optional() — avoids runtime errors on missing fields";
  if (/v\.union/i.test(lower))
    return "Use v.union() for discriminated types — add a 'type' field as discriminator for type safety";

  // Data access (BEFORE generic function types — ctx.db.query must match before query)
  if (/ctx\.db\.query/i.test(lower))
    return "Add ctx.db.query('table') — chain .withIndex() for indexed lookups (avoid full-table .filter())";
  if (/ctx\.db\.insert/i.test(lower))
    return "Use ctx.db.insert('table', { ...fields }) — within a mutation for transactional guarantee";
  if (/ctx\.db\.patch/i.test(lower))
    return "Use ctx.db.patch(id, { ...fields }) — partial update, only specified fields change";
  if (/ctx\.db\.delete/i.test(lower))
    return "Use ctx.db.delete(id) — remember to clean up related records and storage files";
  if (/withindex/i.test(lower))
    return "Use .withIndex('indexName', q => q.eq('field', value)) — ensure index exists in schema.ts first";
  if (/withsearchindex/i.test(lower))
    return "Use .withSearchIndex('indexName', q => q.search('field', searchText)) — ensure .searchIndex() defined";
  if (/\.collect\b/i.test(lower))
    return "Add .collect() to get all results — WARNING: add .take(limit) for bounded queries to avoid scanning entire table";
  if (/\.paginate\b/i.test(lower))
    return "Use .paginate(opts) with paginationOptsValidator in args — return { page, isDone, continueCursor }";

  // Cross-function calls (BEFORE generic function types — ctx.runMutation must match before mutation)
  if (/ctx\.runmutation|runmutation/i.test(lower))
    return "Use ctx.runMutation(internal.module.functionName, args) — prefer internal functions for server-to-server mutation calls";
  if (/ctx\.runquery|runquery/i.test(lower))
    return "Use ctx.runQuery(internal.module.functionName, args) — prefer internal functions for server-to-server query calls";
  if (/ctx\.runaction|runaction/i.test(lower))
    return "Use ctx.runAction(internal.module.functionName, args) — prefer internal functions for server-to-server action calls";

  // Auth (BEFORE generic function types)
  if (/getuseridentity/i.test(lower))
    return "Add `const identity = await ctx.auth.getUserIdentity()` — throw if null for protected endpoints";
  if (/identity.*check|if.*identity/i.test(lower))
    return "Add identity null check after getUserIdentity() — return 401/throw for unauthenticated users";

  // Scheduler (BEFORE generic function types)
  if (/scheduler.*runafter/i.test(lower))
    return "Add ctx.scheduler.runAfter(delayMs, api.module.functionName, args) — use at least 1s delay for retries, add termination condition for loops";
  if (/scheduler.*runat/i.test(lower))
    return "Add ctx.scheduler.runAt(timestamp, api.module.functionName, args) — use for one-time future execution";

  // Storage (BEFORE generic function types)
  if (/storage.*generateuploadurl/i.test(lower))
    return "Use ctx.storage.generateUploadUrl() in a mutation — return URL to client for direct upload";
  if (/storage.*store/i.test(lower))
    return "Use ctx.storage.store(blob) — returns storageId, save it to a document for later retrieval";
  if (/storage.*geturl/i.test(lower))
    return "Use ctx.storage.getUrl(storageId) — returns URL or null, always null-check the result";

  // Client-side (BEFORE generic function types — useQuery before query)
  if (/usequery/i.test(lower))
    return "Add useQuery(api.module.queryName, args) — reactive subscription, re-renders on data change";
  if (/usemutation/i.test(lower))
    return "Add useMutation(api.module.mutationName) — returns async function to call mutation";
  if (/useaction/i.test(lower))
    return "Add useAction(api.module.actionName) — returns async function, use for external API calls";
  if (/convexprovider|convexreactclient/i.test(lower))
    return "Wrap app with <ConvexProvider client={convex}> — create client with new ConvexReactClient(url)";

  // Function types (GENERIC — must come AFTER all specific patterns above)
  if (/internalmutation/i.test(lower))
    return "Create internalMutation — only callable by other server functions, not from client. Import from _generated/server";
  if (/internalaction/i.test(lower))
    return "Create internalAction — for server-side-only work like API calls. Cannot access ctx.db directly, use ctx.runMutation/ctx.runQuery";
  if (/internalquery/i.test(lower))
    return "Create internalQuery — server-side-only reads. Not subscribable from client";
  if (/httpaction/i.test(lower))
    return "Create httpAction in http.ts — register with httpRouter.route({ method, path, handler })";
  if (/mutation\b/i.test(lower))
    return "Create public mutation — add args validator, return validator, and auth check (ctx.auth.getUserIdentity)";
  if (/action\b/i.test(lower))
    return "Create public action — for external API calls. Wrap in try/catch, use ctx.runMutation for DB writes";
  if (/query\b/i.test(lower))
    return "Create public query — reactive subscription from client. Must be deterministic, no side effects";

  return "Inject this pattern into the appropriate Convex file — check existing patterns with convex_scan_capabilities first";
}

function inferTargetFile(signature: string): string {
  const lower = signature.toLowerCase();

  if (/definetable|defineschema|vectorindex|searchindex|\.index\b|v\.\w+/i.test(lower))
    return "convex/schema.ts";
  if (/httpaction|httprouter/i.test(lower))
    return "convex/http.ts";
  if (/cronjobs|crons\./i.test(lower))
    return "convex/crons.ts";
  if (/usequery|usemutation|useaction|convexprovider/i.test(lower))
    return "src/ (React component file)";
  if (/ctx\.auth|getuseridentity/i.test(lower))
    return "convex/ (mutation or action file)";
  if (/ctx\.storage/i.test(lower))
    return "convex/ (mutation or action handling file uploads)";

  return "convex/ (appropriate module file)";
}
