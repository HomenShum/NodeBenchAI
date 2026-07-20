import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, genId } from "../db.js";
import { getQuickRef } from "./toolRegistry.js";
import type { McpTool } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function findConvexDir(projectDir: string): string | null {
  const candidates = [join(projectDir, "convex"), join(projectDir, "src", "convex"), join(projectDir, "backend", "convex")];
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

// ── Vector Search Audit ─────────────────────────────────────────────

interface VectorIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  message: string;
  fix: string;
}

// Common embedding model dimensions
const KNOWN_DIMENSIONS: Record<number, string> = {
  384: "all-MiniLM-L6-v2",
  512: "e5-small",
  768: "text-embedding-004 / all-mpnet-base-v2",
  1024: "e5-large / cohere-embed-v3",
  1536: "text-embedding-3-small / text-embedding-ada-002",
  3072: "text-embedding-3-large",
};

function auditVectorSearch(convexDir: string): {
  issues: VectorIssue[];
  stats: {
    vectorIndexCount: number;
    vectorSearchCallCount: number;
    tablesWithVectors: string[];
    dimensions: number[];
  };
} {
  const issues: VectorIssue[] = [];
  const schemaPath = join(convexDir, "schema.ts");

  // Parse schema for vectorIndex definitions
  const vectorIndexes: Array<{ tableName: string; indexName: string; dimensions: number; filterFields: string[]; line: number }> = [];

  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    const lines = schema.split("\n");

    // Track current table context: scan for "tableName: defineTable(" or "tableName = defineTable("
    let currentTable = "";
    for (let i = 0; i < lines.length; i++) {
      const tableMatch = lines[i].match(/(\w+)\s*[:=]\s*defineTable\s*\(/);
      if (tableMatch) {
        currentTable = tableMatch[1];
      }

      // Match .vectorIndex("name", { ... })
      const viMatch = lines[i].match(/\.vectorIndex\s*\(\s*["']([^"']+)["']/);
      if (viMatch) {
        // Look ahead for dimensions and filterFields
        const chunk = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");
        const dimMatch = chunk.match(/dimensions\s*:\s*(\d+)/);
        const filterMatch = chunk.match(/filterFields\s*:\s*\[([^\]]*)\]/);

        const dims = dimMatch ? parseInt(dimMatch[1], 10) : 0;
        const filters = filterMatch
          ? filterMatch[1].match(/["']([^"']+)["']/g)?.map(s => s.replace(/["']/g, "")) ?? []
          : [];

        vectorIndexes.push({ tableName: currentTable || viMatch[1], indexName: viMatch[1], dimensions: dims, filterFields: filters, line: i + 1 });

        // Check: uncommon dimension size
        if (dims > 0 && !KNOWN_DIMENSIONS[dims]) {
          const nearest = Object.keys(KNOWN_DIMENSIONS)
            .map(Number)
            .sort((a, b) => Math.abs(a - dims) - Math.abs(b - dims))[0];
          issues.push({
            severity: "warning",
            location: `schema.ts:${i + 1}`,
            message: `Vector index "${viMatch[1]}" has ${dims} dimensions — not a standard embedding size. Did you mean ${nearest} (${KNOWN_DIMENSIONS[nearest]})?`,
            fix: `Verify your embedding model output size matches ${dims} dimensions`,
          });
        }

        // Check: no filter fields
        if (filters.length === 0) {
          issues.push({
            severity: "info",
            location: `schema.ts:${i + 1}`,
            message: `Vector index "${viMatch[1]}" has no filterFields. Vector searches will scan all vectors — add filters for better performance.`,
            fix: 'Add filterFields: ["field1", "field2"] to narrow vector search scope',
          });
        }
      }

      // Check: vector field declared as v.array(v.number()) instead of v.array(v.float64())
      if (/v\.array\s*\(\s*v\.number\s*\(\s*\)\s*\)/.test(lines[i]) &&
          /embed|vector|embedding/i.test(lines.slice(Math.max(0, i - 3), i + 1).join("\n"))) {
        issues.push({
          severity: "warning",
          location: `schema.ts:${i + 1}`,
          message: "Vector field uses v.array(v.number()) — Convex vector search requires v.array(v.float64()) for proper storage.",
          fix: "Change to v.array(v.float64()) for vector fields",
        });
      }
    }
  }

  // Scan code files for .vectorSearch() usage
  const files = collectTsFiles(convexDir);
  let vectorSearchCallCount = 0;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      // vectorSearch("tableName", "indexName", options) — first arg is TABLE name
      const vsMatch = lines[i].match(/\.vectorSearch\s*\(\s*["']([^"']+)["']/);
      if (vsMatch) {
        vectorSearchCallCount++;
        const tableName = vsMatch[1];

        // Check if the referenced table has any vector index
        const matchingIdx = vectorIndexes.find(vi => vi.tableName === tableName);
        if (!matchingIdx && vectorIndexes.length > 0) {
          issues.push({
            severity: "critical",
            location: `${relativePath}:${i + 1}`,
            message: `vectorSearch references table "${tableName}" which has no vectorIndex defined in schema.ts.`,
            fix: `Add a .vectorIndex("by_embedding", { ... }) to the "${tableName}" table in schema.ts`,
          });
        }

        // Check: no filter parameter when filterFields exist
        const chunk = lines.slice(i, Math.min(i + 5, lines.length)).join("\n");
        if (matchingIdx && matchingIdx.filterFields.length > 0 && !/filter\s*:/.test(chunk)) {
          issues.push({
            severity: "info",
            location: `${relativePath}:${i + 1}`,
            message: `vectorSearch on "${tableName}" doesn't use filter — available filterFields: ${matchingIdx.filterFields.join(", ")}`,
            fix: "Add filter parameter to narrow results and improve performance",
          });
        }

        // Check: hardcoded vector dimensions in code (should match schema)
        const vecLiteralMatch = chunk.match(/new\s+Float64Array\s*\(\s*(\d+)\s*\)|Array\s*\(\s*(\d+)\s*\)\.fill/);
        if (vecLiteralMatch && matchingIdx) {
          const codeDims = parseInt(vecLiteralMatch[1] || vecLiteralMatch[2], 10);
          if (codeDims !== matchingIdx.dimensions && matchingIdx.dimensions > 0) {
            issues.push({
              severity: "critical",
              location: `${relativePath}:${i + 1}`,
              message: `Vector dimensions mismatch: code uses ${codeDims} but schema defines ${matchingIdx.dimensions} for table "${tableName}".`,
              fix: `Ensure embedding model output (${codeDims}) matches schema dimensions (${matchingIdx.dimensions})`,
            });
          }
        }
      }
    }
  }

  const tablesWithVectors = [...new Set(vectorIndexes.map(vi => vi.tableName))];
  const dimensions = [...new Set(vectorIndexes.map(vi => vi.dimensions).filter(d => d > 0))];

  return {
    issues,
    stats: {
      vectorIndexCount: vectorIndexes.length,
      vectorSearchCallCount,
      tablesWithVectors,
      dimensions,
    },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const vectorSearchTools: McpTool[] = [
  {
    name: "convex_audit_vector_search",
    description:
      "Audit Convex vector search implementation: validates vectorIndex dimensions against known embedding models, checks for missing filterFields, v.array(v.float64()) usage, dimension mismatches between schema and code, and undefined index references.",
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
        return { error: "No convex/ directory found" };
      }

      const { issues, stats } = auditVectorSearch(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "vector_search", JSON.stringify(issues), issues.length);

      return {
        summary: {
          ...stats,
          totalIssues: issues.length,
          critical: issues.filter(i => i.severity === "critical").length,
          warnings: issues.filter(i => i.severity === "warning").length,
          knownDimensions: KNOWN_DIMENSIONS,
        },
        issues: issues.slice(0, 30),
        quickRef: getQuickRef("convex_audit_vector_search"),
      };
    },
  },
];
