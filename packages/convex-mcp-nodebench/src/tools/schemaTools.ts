import { findConvexDir } from "../project.js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, genId } from "../db.js";
import { getQuickRef } from "./toolRegistry.js";
import type { McpTool, SchemaIssue } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function readSchemaFile(convexDir: string): string | null {
  const schemaPath = join(convexDir, "schema.ts");
  if (!existsSync(schemaPath)) return null;
  return readFileSync(schemaPath, "utf-8");
}

function collectTsFiles(dir: string, ext = ".ts"): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "_generated") {
      results.push(...collectTsFiles(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

// ── Schema Analysis Engine ──────────────────────────────────────────

function analyzeSchema(schemaContent: string, filePath: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const lines = schemaContent.split("\n");

  // Check: v.bigint() usage (deprecated)
  lines.forEach((line, i) => {
    if (/v\.bigint\s*\(/.test(line)) {
      issues.push({
        severity: "critical",
        location: `${filePath}:${i + 1}`,
        message: "v.bigint() is deprecated. Use v.int64() instead.",
        fix: "Replace v.bigint() with v.int64()",
        gotchaKey: "validator_bigint_deprecated",
      });
    }
  });

  // Check: v.map() or v.set() usage (unsupported)
  lines.forEach((line, i) => {
    if (/v\.(map|set)\s*\(/.test(line)) {
      const match = line.match(/v\.(map|set)/);
      issues.push({
        severity: "critical",
        location: `${filePath}:${i + 1}`,
        message: `v.${match?.[1]}() is not supported. Use v.record(keys, values) instead.`,
        fix: "Replace with v.record(keyValidator, valueValidator)",
        gotchaKey: "no_map_set_validators",
      });
    }
  });

  // Check: fields starting with $ or _
  const fieldNamePattern = /["'](\$|_)[\w]+["']\s*:/g;
  lines.forEach((line, i) => {
    let match;
    while ((match = fieldNamePattern.exec(line)) !== null) {
      // Ignore system fields in comments
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
      issues.push({
        severity: "critical",
        location: `${filePath}:${i + 1}`,
        message: `Field name starts with '${match[1]}' which is reserved for system use.`,
        fix: "Rename the field to not start with '$' or '_'",
        gotchaKey: "field_no_dollar_underscore",
      });
    }
  });

  // Check: defineTable without any indexes
  const tablePattern = /defineTable\s*\(/g;
  const indexPattern = /\.index\s*\(/g;
  const tableCount = (schemaContent.match(tablePattern) || []).length;
  const indexCount = (schemaContent.match(indexPattern) || []).length;
  if (tableCount > 0 && indexCount === 0) {
    issues.push({
      severity: "warning",
      location: filePath,
      message: `Schema defines ${tableCount} table(s) but has no indexes. Most apps need indexes for efficient queries.`,
      fix: "Add .index() calls to defineTable for fields you query by",
      gotchaKey: "index_field_order",
    });
  }

  // Check: index names don't include field names (aggregate — not individual issues)
  const indexDefPattern = /\.index\s*\(\s*["']([^"']+)["']\s*,\s*\[([^\]]+)\]/g;
  let idxMatch;
  const namingViolations: string[] = [];
  while ((idxMatch = indexDefPattern.exec(schemaContent)) !== null) {
    const indexName = idxMatch[1];
    const fieldsRaw = idxMatch[2];
    const fields = fieldsRaw.match(/["']([^"']+)["']/g)?.map((f) => f.replace(/["']/g, "")) || [];
    const allFieldsInName = fields.every((f) => indexName.toLowerCase().includes(f.toLowerCase()));
    if (!allFieldsInName && fields.length > 0) {
      namingViolations.push(`${indexName} -> by_${fields.join("_and_")}`);
    }
  }
  if (namingViolations.length > 0) {
    const examples = namingViolations.slice(0, 5).join("; ");
    const more = namingViolations.length > 5 ? ` (+${namingViolations.length - 5} more)` : "";
    issues.push({
      severity: "info",
      location: filePath,
      message: `${namingViolations.length} indexes don't follow naming convention. Examples: ${examples}${more}`,
      fix: "Consider renaming indexes to include field names (by_fieldA_and_fieldB)",
      gotchaKey: "index_name_include_fields",
    });
  }

  // Check: v.any() usage (defeats validator purpose) — aggregate
  const vAnyLines: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
    if (/v\.any\s*\(\s*\)/.test(line)) {
      vAnyLines.push(i + 1);
    }
  });
  if (vAnyLines.length > 0) {
    const examples = vAnyLines.slice(0, 5).map((l) => `line ${l}`).join(", ");
    const more = vAnyLines.length > 5 ? ` (+${vAnyLines.length - 5} more)` : "";
    issues.push({
      severity: "warning",
      location: filePath,
      message: `${vAnyLines.length} uses of v.any() defeat the purpose of validators. Locations: ${examples}${more}`,
      fix: "Replace v.any() with specific validators (v.string(), v.object({...}), v.union(...), etc.)",
      gotchaKey: "avoid_v_any",
    });
  }

  // Check: _creationTime or _id in schema definition (system fields)
  lines.forEach((line, i) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
    if (/["']_creationTime["']|["']_id["']/.test(line) && /v\./.test(line)) {
      issues.push({
        severity: "warning",
        location: `${filePath}:${i + 1}`,
        message: "System fields (_id, _creationTime) are auto-added. Don't include them in schema.",
        fix: "Remove the system field from your schema definition",
        gotchaKey: "system_fields_auto",
      });
    }
  });

  return issues;
}

// ── Search & Vector Index Inventory ─────────────────────────────────

interface SearchIndexInfo {
  table: string;
  name: string;
  searchField: string;
  filterFields: string[];
  line: number;
}

interface VectorIndexInfo {
  table: string;
  name: string;
  dimensions?: number;
  filterFields: string[];
  line: number;
}

function analyzeAdvancedIndexes(schemaContent: string): {
  searchIndexes: SearchIndexInfo[];
  vectorIndexes: VectorIndexInfo[];
} {
  const searchIndexes: SearchIndexInfo[] = [];
  const vectorIndexes: VectorIndexInfo[] = [];
  const lines = schemaContent.split("\n");

  let currentTable = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current table context
    const tableDef = line.match(/(\w+)\s*[:=]\s*defineTable\s*\(/);
    if (tableDef) currentTable = tableDef[1];

    // Detect .searchIndex("name", { ... })
    const searchMatch = line.match(/\.searchIndex\s*\(\s*["']([^"']+)["']/);
    if (searchMatch && currentTable) {
      // Look ahead for searchField and filterFields
      const chunk = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");
      const searchFieldMatch = chunk.match(/searchField\s*:\s*["']([^"']+)["']/);
      const filterFieldsMatch = chunk.match(/filterFields\s*:\s*\[([^\]]*)\]/);
      const filterFields = filterFieldsMatch
        ? (filterFieldsMatch[1].match(/["']([^"']+)["']/g) || []).map(f => f.replace(/["']/g, ""))
        : [];
      searchIndexes.push({
        table: currentTable,
        name: searchMatch[1],
        searchField: searchFieldMatch?.[1] || "unknown",
        filterFields,
        line: i + 1,
      });
    }

    // Detect .vectorIndex("name", { ... })
    const vectorMatch = line.match(/\.vectorIndex\s*\(\s*["']([^"']+)["']/);
    if (vectorMatch && currentTable) {
      const chunk = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");
      const dimMatch = chunk.match(/dimensions\s*:\s*(\d+)/);
      const filterFieldsMatch = chunk.match(/filterFields\s*:\s*\[([^\]]*)\]/);
      const filterFields = filterFieldsMatch
        ? (filterFieldsMatch[1].match(/["']([^"']+)["']/g) || []).map(f => f.replace(/["']/g, ""))
        : [];
      vectorIndexes.push({
        table: currentTable,
        name: vectorMatch[1],
        dimensions: dimMatch ? parseInt(dimMatch[1]) : undefined,
        filterFields,
        line: i + 1,
      });
    }
  }

  return { searchIndexes, vectorIndexes };
}

// ── Validator Coverage Analysis ─────────────────────────────────────

interface ValidatorCoverageResult {
  totalFunctions: number;
  withArgs: number;
  withReturns: number;
  missingArgs: string[];
  missingReturns: string[];
  usingOldSyntax: string[];
}

function analyzeValidatorCoverage(convexDir: string): ValidatorCoverageResult {
  const files = collectTsFiles(convexDir);
  const result: ValidatorCoverageResult = {
    totalFunctions: 0,
    withArgs: 0,
    withReturns: 0,
    missingArgs: [],
    missingReturns: [],
    usingOldSyntax: [],
  };

  const funcTypes = ["query", "internalQuery", "mutation", "internalMutation", "action", "internalAction"];
  const funcPattern = new RegExp(
    `export\\s+(?:const|default)\\s+(\\w+)?\\s*=\\s*(${funcTypes.join("|")})\\s*\\(`,
    "g"
  );

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");

    let match;
    while ((match = funcPattern.exec(content)) !== null) {
      const funcName = match[1] || "default";
      const location = `${relativePath}:${funcName}`;
      result.totalFunctions++;

      // Find the function body (rough heuristic - look for args: and returns: nearby)
      const startIdx = match.index;
      const chunk = content.slice(startIdx, startIdx + 500);

      if (/args\s*:\s*\{/.test(chunk) || /args\s*:\s*v\./.test(chunk)) {
        result.withArgs++;
      } else {
        result.missingArgs.push(location);
      }

      if (/returns\s*:\s*v\./.test(chunk)) {
        result.withReturns++;
      } else {
        result.missingReturns.push(location);
      }

      // Check for old syntax (handler as second argument, not in object)
      if (/\(\s*async\s*\(ctx/.test(chunk) && !/handler\s*:/.test(chunk)) {
        result.usingOldSyntax.push(location);
      }
    }
  }

  return result;
}

// ── Index Suggestion Engine ─────────────────────────────────────────

interface IndexSuggestion {
  table: string;
  fields: string[];
  suggestedName: string;
  reason: string;
}

function suggestIndexes(convexDir: string): IndexSuggestion[] {
  const suggestions: IndexSuggestion[] = [];
  const files = collectTsFiles(convexDir);

  // Track query patterns: db.query("table").withIndex("name", ...) or .filter(q => q.eq(q.field("x"), ...))
  const queryPattern = /\.query\s*\(\s*["'](\w+)["']\s*\)/g;
  const filterFieldPattern = /q\.field\s*\(\s*["'](\w+)["']\s*\)/g;
  const withIndexPattern = /\.withIndex\s*\(\s*["'](\w+)["']/g;

  const tableQueryFields = new Map<string, Set<string>>();
  const existingIndexes = new Set<string>();

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");

    // Collect existing indexes
    let idxMatch;
    while ((idxMatch = withIndexPattern.exec(content)) !== null) {
      existingIndexes.add(idxMatch[1]);
    }

    // Collect query + filter patterns
    let qMatch;
    while ((qMatch = queryPattern.exec(content)) !== null) {
      const tableName = qMatch[1];
      // Look for filter fields nearby
      const nearbyContent = content.slice(qMatch.index, qMatch.index + 300);
      let fMatch;
      while ((fMatch = filterFieldPattern.exec(nearbyContent)) !== null) {
        const field = fMatch[1];
        if (field === "_id" || field === "_creationTime") continue;
        if (!tableQueryFields.has(tableName)) {
          tableQueryFields.set(tableName, new Set());
        }
        tableQueryFields.get(tableName)!.add(field);
      }
    }
  }

  // Generate suggestions for frequently queried fields
  for (const [table, fields] of tableQueryFields) {
    for (const field of fields) {
      const indexName = `by_${field}`;
      if (!existingIndexes.has(indexName)) {
        suggestions.push({
          table,
          fields: [field],
          suggestedName: indexName,
          reason: `Queries filter on "${table}.${field}" but no index exists for it`,
        });
      }
    }
  }

  return suggestions;
}

// ── Tool Definitions ────────────────────────────────────────────────

export const schemaTools: McpTool[] = [
  {
    name: "convex_audit_schema",
    description:
      "Analyze a Convex project's schema.ts for anti-patterns, deprecated validators, reserved field names, missing indexes, and naming convention violations. Scans the convex/ directory and returns categorized issues with fix suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root containing a convex/ directory",
        },
      },
      required: ["projectDir"],
    },
    handler: async (args: { projectDir: string }) => {
      const projectDir = resolve(args.projectDir);
      const convexDir = findConvexDir(projectDir);
      if (!convexDir) {
        return {
          error: "No configured Convex functions directory found",
          hint: "Check projectDir and the functions path in convex.json",
        };
      }

      const schemaContent = readSchemaFile(convexDir);
      if (!schemaContent) {
        return {
          error: "No schema.ts found in the resolved functions directory",
          hint: "Create schema.ts in the configured functions directory",
          quickRef: getQuickRef("convex_audit_schema"),
        };
      }

      const schemaPath = join(convexDir, "schema.ts");
      const issues = analyzeSchema(schemaContent, schemaPath);
      const advancedIndexes = analyzeAdvancedIndexes(schemaContent);

      // Store audit result
      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, file_path, issues_json, issue_count) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "schema", schemaPath, JSON.stringify(issues), issues.length);

      const critical = issues.filter((i) => i.severity === "critical");
      const warnings = issues.filter((i) => i.severity === "warning");
      const info = issues.filter((i) => i.severity === "info");

      // Count tables and regular indexes
      const tableCount = (schemaContent.match(/defineTable\s*\(/g) || []).length;
      const regularIndexCount = (schemaContent.match(/\.index\s*\(/g) || []).length;

      return {
        summary: {
          totalIssues: issues.length,
          critical: critical.length,
          warnings: warnings.length,
          info: info.length,
          schemaFile: schemaPath,
          tables: tableCount,
          regularIndexes: regularIndexCount,
          searchIndexes: advancedIndexes.searchIndexes.length,
          vectorIndexes: advancedIndexes.vectorIndexes.length,
        },
        issues,
        searchIndexes: advancedIndexes.searchIndexes.length > 0
          ? advancedIndexes.searchIndexes
          : undefined,
        vectorIndexes: advancedIndexes.vectorIndexes.length > 0
          ? advancedIndexes.vectorIndexes
          : undefined,
        quickRef: getQuickRef("convex_audit_schema"),
      };
    },
  },
  {
    name: "convex_suggest_indexes",
    description:
      "Analyze query patterns across all Convex functions and suggest missing indexes. Scans for .query().filter() patterns and compares against defined indexes in schema.ts.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root containing a convex/ directory",
        },
      },
      required: ["projectDir"],
    },
    handler: async (args: { projectDir: string }) => {
      const projectDir = resolve(args.projectDir);
      const convexDir = findConvexDir(projectDir);
      if (!convexDir) {
        return { error: "No configured Convex functions directory found" };
      }

      const suggestions = suggestIndexes(convexDir);

      // Add existing index context per table mentioned in suggestions
      const schemaContent = readSchemaFile(convexDir);
      const existingByTable: Record<string, string[]> = {};
      if (schemaContent) {
        let currentTable = "";
        for (const line of schemaContent.split("\n")) {
          const tableDef = line.match(/(\w+)\s*[:=]\s*defineTable\s*\(/);
          if (tableDef) currentTable = tableDef[1];
          const idxMatch = line.match(/\.index\s*\(\s*["']([^"']+)["']/);
          if (idxMatch && currentTable) {
            if (!existingByTable[currentTable]) existingByTable[currentTable] = [];
            existingByTable[currentTable].push(idxMatch[1]);
          }
        }
      }

      // Group suggestions by table for cleaner output
      const byTable: Record<string, typeof suggestions> = {};
      for (const s of suggestions) {
        if (!byTable[s.table]) byTable[s.table] = [];
        byTable[s.table].push(s);
      }

      return {
        totalSuggestions: suggestions.length,
        tablesNeedingIndexes: Object.keys(byTable).length,
        suggestionsByTable: Object.entries(byTable)
          .sort(([, a], [, b]) => b.length - a.length)
          .map(([table, sugs]) => ({
            table,
            existingIndexes: existingByTable[table] || [],
            suggestions: sugs,
          })),
        quickRef: getQuickRef("convex_suggest_indexes"),
      };
    },
  },
  {
    name: "convex_check_validator_coverage",
    description:
      "Check that all exported Convex functions (query, mutation, action, and their internal variants) have both args and returns validators. Reports functions missing validators and those using deprecated old syntax.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root containing a convex/ directory",
        },
      },
      required: ["projectDir"],
    },
    handler: async (args: { projectDir: string }) => {
      const projectDir = resolve(args.projectDir);
      const convexDir = findConvexDir(projectDir);
      if (!convexDir) {
        return { error: "No configured Convex functions directory found" };
      }

      const result = analyzeValidatorCoverage(convexDir);

      const passed = result.missingArgs.length === 0 && result.missingReturns.length === 0;

      // Store audit result
      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(
        genId("audit"),
        projectDir,
        "validator_coverage",
        JSON.stringify(result),
        result.missingArgs.length + result.missingReturns.length
      );

      return {
        passed,
        summary: {
          totalFunctions: result.totalFunctions,
          argsValidatorCoverage: `${result.withArgs}/${result.totalFunctions}`,
          returnsValidatorCoverage: `${result.withReturns}/${result.totalFunctions}`,
          oldSyntaxCount: result.usingOldSyntax.length,
        },
        missingArgs: result.missingArgs.length > 0 ? result.missingArgs : undefined,
        missingReturns: result.missingReturns.length > 0 ? result.missingReturns : undefined,
        usingOldSyntax: result.usingOldSyntax.length > 0 ? result.usingOldSyntax : undefined,
        quickRef: getQuickRef("convex_check_validator_coverage"),
      };
    },
  },
];
