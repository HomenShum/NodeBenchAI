import { findConvexDir } from "../project.js";
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { schemaTools } from "../tools/schemaTools.js";
import { functionTools } from "../tools/functionTools.js";
import { deploymentTools } from "../tools/deploymentTools.js";
import { learningTools } from "../tools/learningTools.js";
import { methodologyTools } from "../tools/methodologyTools.js";
import { integrationBridgeTools } from "../tools/integrationBridgeTools.js";
import { cronTools } from "../tools/cronTools.js";
import { componentTools } from "../tools/componentTools.js";
import { httpTools } from "../tools/httpTools.js";
import { critterTools } from "../tools/critterTools.js";
import { authorizationTools } from "../tools/authorizationTools.js";
import { queryEfficiencyTools } from "../tools/queryEfficiencyTools.js";
import { actionAuditTools } from "../tools/actionAuditTools.js";
import { typeSafetyTools } from "../tools/typeSafetyTools.js";
import { transactionSafetyTools } from "../tools/transactionSafetyTools.js";
import { storageAuditTools } from "../tools/storageAuditTools.js";
import { paginationTools as paginationAuditTools } from "../tools/paginationTools.js";
import { dataModelingTools } from "../tools/dataModelingTools.js";
import { devSetupTools } from "../tools/devSetupTools.js";
import { migrationTools } from "../tools/migrationTools.js";
import { reportingTools } from "../tools/reportingTools.js";
import { vectorSearchTools } from "../tools/vectorSearchTools.js";
import { schedulerTools } from "../tools/schedulerTools.js";
import { qualityGateTools } from "../tools/qualityGateTools.js";
import { architectTools } from "../tools/architectTools.js";
import { getDb, seedGotchasIfEmpty } from "../db.js";
import { CONVEX_GOTCHAS } from "../gotchaSeed.js";

// Path to the actual nodebench-ai project root
const PROJECT_DIR = resolve(__dirname, "../../../..");

beforeAll(() => {
  getDb();
  seedGotchasIfEmpty(CONVEX_GOTCHAS as any);
});

describe("Schema Tools", () => {
  it("convex_audit_schema runs against nodebench-ai", async () => {
    const tool = schemaTools.find((t) => t.name === "convex_audit_schema")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalIssues).toBe("number");
    console.log(`Schema audit: ${result.summary.totalIssues} issues (${result.summary.critical} critical, ${result.summary.warnings} warnings)`);
  }, 30_000);

  it("convex_suggest_indexes runs against nodebench-ai", async () => {
    const tool = schemaTools.find((t) => t.name === "convex_suggest_indexes")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(typeof result.totalSuggestions).toBe("number");
    console.log(`Index suggestions: ${result.totalSuggestions}`);
  }, 60_000);

  it("convex_check_validator_coverage runs against nodebench-ai", async () => {
    const tool = schemaTools.find((t) => t.name === "convex_check_validator_coverage")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalFunctions).toBe("number");
    console.log(`Validator coverage: ${result.summary.argsValidatorCoverage} args, ${result.summary.returnsValidatorCoverage} returns, ${result.summary.oldSyntaxCount} old syntax`);
  });
});

describe("Function Tools", () => {
  it("convex_audit_functions runs against nodebench-ai", async () => {
    const tool = functionTools.find((t) => t.name === "convex_audit_functions")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalFunctions).toBe("number");
    console.log(`Function audit: ${result.summary.totalFunctions} functions, ${result.summary.totalIssues} issues (${result.summary.critical} critical)`);
  }, 30_000); // scans the whole backend/convex tree, like the 30s/60s repo scans above

  it("convex_check_function_refs runs against nodebench-ai", async () => {
    const tool = functionTools.find((t) => t.name === "convex_check_function_refs")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    console.log(`Function refs: ${result.summary.totalReferences} refs, ${result.summary.directPassAntiPatterns} direct pass anti-patterns`);
  });
});

describe("Deployment Tools", () => {
  it("convex_pre_deploy_gate runs against nodebench-ai", async () => {
    const tool = deploymentTools.find((t) => t.name === "convex_pre_deploy_gate")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(typeof result.passed).toBe("boolean");
    expect(result.checks).toBeDefined();
    expect(Array.isArray(result.checks)).toBe(true);
    console.log(`Deploy gate: ${result.passed ? "PASSED" : "BLOCKED"} (${result.checks.length} checks, ${result.blockers.length} blockers)`);
  });

  it("convex_check_env_vars runs against nodebench-ai", async () => {
    const tool = deploymentTools.find((t) => t.name === "convex_check_env_vars")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.envFilesFound).toBeDefined();
    console.log(`Env vars: ${result.envVarsInCode.length} in code, ${result.envVarsInEnvFile.length} in env files, ${result.missingInEnvFile.length} missing`);
  });
});

describe("Learning Tools", () => {
  it("convex_search_gotchas finds seeded gotchas", async () => {
    const tool = learningTools.find((t) => t.name === "convex_search_gotchas")!;
    const result = (await tool.handler({ query: "bigint deprecated" })) as any;
    expect(result).toBeDefined();
    expect(result.totalResults).toBeGreaterThan(0);
    expect(result.gotchas[0].key).toBe("validator_bigint_deprecated");
    console.log(`Gotcha search 'bigint deprecated': ${result.totalResults} results`);
  });

  it("convex_search_gotchas finds index gotchas", async () => {
    const tool = learningTools.find((t) => t.name === "convex_search_gotchas")!;
    const result = (await tool.handler({ query: "index order field" })) as any;
    expect(result).toBeDefined();
    expect(result.totalResults).toBeGreaterThan(0);
    console.log(`Gotcha search 'index order field': ${result.totalResults} results`);
  });

  it("convex_record_gotcha creates and updates", async () => {
    const tool = learningTools.find((t) => t.name === "convex_record_gotcha")!;
    const result1 = (await tool.handler({
      key: "test_gotcha_vitest",
      content: "Test gotcha from vitest",
      category: "general",
      severity: "info",
      tags: "test,vitest",
    })) as any;
    expect(["created", "updated"]).toContain(result1.action);

    const result2 = (await tool.handler({
      key: "test_gotcha_vitest",
      content: "Updated test gotcha from vitest",
      category: "general",
      severity: "info",
    })) as any;
    expect(result2.action).toBe("updated");
  });
});

describe("Methodology Tools", () => {
  it("convex_get_methodology returns overview", async () => {
    const tool = methodologyTools.find((t) => t.name === "convex_get_methodology")!;
    const result = (await tool.handler({ topic: "overview" })) as any;
    expect(result).toBeDefined();
    expect(result.title).toContain("Overview");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("convex_get_methodology returns schema_audit steps", async () => {
    const tool = methodologyTools.find((t) => t.name === "convex_get_methodology")!;
    const result = (await tool.handler({ topic: "convex_schema_audit" })) as any;
    expect(result).toBeDefined();
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it("convex_discover_tools finds schema tools", async () => {
    const tool = methodologyTools.find((t) => t.name === "convex_discover_tools")!;
    const result = (await tool.handler({ query: "schema audit" })) as any;
    expect(result).toBeDefined();
    expect(result.matchingTools).toBeGreaterThan(0);
    console.log(`Discover 'schema audit': ${result.matchingTools} tools found`);
  });

  it("convex_discover_tools filters by category", async () => {
    const tool = methodologyTools.find((t) => t.name === "convex_discover_tools")!;
    const result = (await tool.handler({ query: "deploy", category: "deployment" })) as any;
    expect(result).toBeDefined();
    expect(result.tools.every((t: any) => t.category === "deployment")).toBe(true);
  });
});

describe("Integration Bridge Tools", () => {
  it("convex_generate_rules_md generates rules content", async () => {
    const tool = integrationBridgeTools.find((t) => t.name === "convex_generate_rules_md")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.action).toBe("generated");
    expect(result.content).toContain("Convex Development Rules");
    expect(result.lines).toBeGreaterThan(10);
    console.log(`Rules generation: ${result.lines} lines`);
  });

  it("convex_snapshot_schema captures snapshot", async () => {
    const tool = integrationBridgeTools.find((t) => t.name === "convex_snapshot_schema")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.snapshotId).toBeDefined();
    expect(result.tableCount).toBeGreaterThan(0);
    console.log(`Schema snapshot: ${result.tableCount} tables`);
  });

  it("convex_bootstrap_project scans project", async () => {
    const tool = integrationBridgeTools.find((t) => t.name === "convex_bootstrap_project")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.checks).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.improvementPlan).toBeDefined();
    console.log(`Bootstrap: ${result.summary.good} good, ${result.summary.warnings} warnings, ${result.summary.criticals} criticals`);
  });
});

// ── BM25 A/B Comparison Tests ─────────────────────────────────────────────

import { findTools } from "../tools/toolRegistry.js";

describe("BM25 Tool Discovery — A/B Comparison", () => {
  it("ranks exact-name match above tag-only match", () => {
    const results = findTools("audit schema");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("convex_audit_schema");
  });

  it("uses OR logic — partial terms still return results", () => {
    const results = findTools("deploy");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const names = results.map((r) => r.name);
    expect(names).toContain("convex_pre_deploy_gate");
    expect(names).toContain("convex_check_env_vars");
  });

  it("field weighting: name > tags", () => {
    const results = findTools("gotcha");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Both gotcha tools should rank in top 2 (name contains 'gotcha')
    const top2 = results.slice(0, 2).map((r) => r.name);
    expect(top2).toContain("convex_record_gotcha");
    expect(top2).toContain("convex_search_gotchas");
  });

  it("IDF: rare term 'bootstrap' ranks convex_bootstrap_project first", () => {
    const results = findTools("bootstrap");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("convex_bootstrap_project");
  });
});

describe("BM25 Gotcha Search — A/B Comparison", () => {
  it("FTS5 primary path finds relevant gotchas", async () => {
    const tool = learningTools.find((t) => t.name === "convex_search_gotchas")!;
    const result = (await tool.handler({ query: "validator deprecated bigint" })) as any;
    expect(result).toBeDefined();
    expect(result.totalResults).toBeGreaterThan(0);
  });

  it("searches across multiple seeded gotchas", async () => {
    const tool = learningTools.find((t) => t.name === "convex_search_gotchas")!;
    const result = (await tool.handler({ query: "function action mutation" })) as any;
    expect(result).toBeDefined();
    expect(result.totalResults).toBeGreaterThan(0);
  });

  it("category filter works with search", async () => {
    const tool = learningTools.find((t) => t.name === "convex_search_gotchas")!;
    const result = (await tool.handler({ query: "index", category: "schema" })) as any;
    expect(result).toBeDefined();
    if (result.totalResults > 0) {
      expect(result.gotchas.every((g: any) => g.category === "schema")).toBe(true);
    }
  });
});

describe("Cron Tools", () => {
  it("convex_check_crons validates crons.ts", async () => {
    const tool = cronTools.find((t) => t.name === "convex_check_crons")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.hasCrons).toBe(true);
    expect(result.totalCrons).toBeGreaterThan(10);
    console.log(`Crons: ${result.totalCrons} total (${result.byType.interval} interval, ${result.byType.daily} daily, ${result.byType.weekly} weekly, ${result.byType.monthly} monthly)`);
    console.log(`Cron issues: ${result.issues.total} (${result.issues.critical} critical, ${result.issues.warnings} warnings)`);
  });
});

describe("Component Tools", () => {
  it("convex_analyze_components parses convex.config.ts", async () => {
    const tool = componentTools.find((t) => t.name === "convex_analyze_components")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.hasConfig).toBe(true);
    expect(result.totalComponents).toBeGreaterThan(5);
    expect(result.activeComponents).toBeGreaterThan(0);
    console.log(`Components: ${result.totalComponents} total, ${result.activeComponents} active, ${result.conditionalComponents} conditional`);
    console.log(`Component issues: ${result.issues.total}`);
  });
});

describe("HTTP Tools", () => {
  it("convex_analyze_http analyzes http.ts", async () => {
    const tool = httpTools.find((t) => t.name === "convex_analyze_http")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    // Project may or may not have http.ts
    if (result.hasHttp) {
      expect(result.totalStaticRoutes).toBeGreaterThanOrEqual(0);
      expect(result.issues).toBeDefined();
      expect(result.filesScanned).toBeDefined();
      console.log(`HTTP: ${result.totalStaticRoutes} static routes across ${result.filesScanned.length} files, ${result.compositeRouteSources} composites, CORS: ${result.hasCors}, issues: ${result.issues.total}`);
    } else {
      console.log("HTTP: no http.ts found");
    }
  });
});

describe("Critter Tools", () => {
  it("convex_critter_check scores a well-intentioned task as proceed", async () => {
    const tool = critterTools.find((t) => t.name === "convex_critter_check")!;
    const result: any = await tool.handler({
      task: "Add an index on users.email for the login query",
      why: "The login page takes 3 seconds because we do a full table scan on email lookups",
      who: "End users logging in via the web app — currently 2000 DAU experiencing slow logins",
      success_looks_like: "Login query drops from 3s to under 200ms in the Convex dashboard",
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.verdict).toBe("proceed");
    console.log(`Critter check: score=${result.score}, verdict=${result.verdict}`);
  });

  it("convex_critter_check catches circular reasoning", async () => {
    const tool = critterTools.find((t) => t.name === "convex_critter_check")!;
    const result: any = await tool.handler({
      task: "Add a new table for user preferences",
      why: "We need to add a table for user preferences",
      who: "users",
    });
    expect(result.score).toBeLessThan(70);
    expect(result.feedback.some((f: string) => f.toLowerCase().includes("circular") || f.toLowerCase().includes("vague"))).toBe(true);
    console.log(`Critter check (bad): score=${result.score}, verdict=${result.verdict}`);
  });
});

// ── New Tier 1-4 Tools ──────────────────────────────────────────────────────

describe("Authorization Tools", () => {
  it("convex_audit_authorization runs against nodebench-ai", async () => {
    const tool = authorizationTools.find((t) => t.name === "convex_audit_authorization")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalPublicFunctions).toBe("number");
    expect(typeof result.summary.publicWithAuth).toBe("number");
    expect(typeof result.summary.authCoverage).toBe("string");
    console.log(`Auth audit: ${result.summary.totalPublicFunctions} public functions, ${result.summary.authCoverage} with auth, ${result.summary.totalIssues} issues`);
  });
});

describe("Query Efficiency Tools", () => {
  it("convex_audit_query_efficiency runs against nodebench-ai", async () => {
    const tool = queryEfficiencyTools.find((t) => t.name === "convex_audit_query_efficiency")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.collectWithoutLimit).toBe("number");
    expect(typeof result.summary.filterWithoutIndex).toBe("number");
    console.log(`Query efficiency: ${result.summary.totalIssues} issues (${result.summary.collectWithoutLimit} unbounded collect, ${result.summary.filterWithoutIndex} filter without index, ${result.summary.mutationAsRead} mutation-as-read)`);
  });
});

describe("Action Audit Tools", () => {
  it("convex_audit_actions runs against nodebench-ai", async () => {
    const tool = actionAuditTools.find((t) => t.name === "convex_audit_actions")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalActions).toBe("number");
    console.log(`Action audit: ${result.summary.totalActions} actions, ${result.summary.totalIssues} issues (${result.summary.actionsWithDbAccess} db access, ${result.summary.actionsWithoutErrorHandling} no error handling)`);
  });
});

describe("Type Safety Tools", () => {
  it("convex_check_type_safety runs against nodebench-ai", async () => {
    const tool = typeSafetyTools.find((t) => t.name === "convex_check_type_safety")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.asAnyCastCount).toBe("number");
    expect(typeof result.summary.undefinedReturns).toBe("number");
    console.log(`Type safety: ${result.summary.totalFiles} files, ${result.summary.asAnyCastCount} as-any casts across ${result.summary.filesWithAsAny} files, ${result.summary.undefinedReturns} undefined returns, ${result.summary.looseIdTypes} loose IDs`);
  });
});

describe("Transaction Safety Tools", () => {
  it("convex_audit_transaction_safety runs against nodebench-ai", async () => {
    const tool = transactionSafetyTools.find((t) => t.name === "convex_audit_transaction_safety")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalMutations).toBe("number");
    console.log(`Transaction safety: ${result.summary.totalMutations} mutations, ${result.summary.readModifyWrite} read-modify-write, ${result.summary.multipleRunMutation} multiple-runMutation`);
  });
});

describe("Storage Audit Tools", () => {
  it("convex_audit_storage_usage runs against nodebench-ai", async () => {
    const tool = storageAuditTools.find((t) => t.name === "convex_audit_storage_usage")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.filesUsingStorage).toBe("number");
    console.log(`Storage usage: ${result.summary.filesUsingStorage} files, ${result.summary.storageStoreCalls} stores, ${result.summary.storageDeleteCalls} deletes, ${result.summary.missingNullChecks} missing null checks`);
  });
});

describe("Pagination Tools", () => {
  it("convex_audit_pagination runs against nodebench-ai", async () => {
    const tool = paginationAuditTools.find((t) => t.name === "convex_audit_pagination")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.paginateCalls).toBe("number");
    console.log(`Pagination: ${result.summary.paginateCalls} paginate calls, ${result.summary.missingPaginationOptsValidator} missing validator, ${result.summary.functionsUsingPagination} functions`);
  });
});

describe("Data Modeling Tools", () => {
  it("convex_audit_data_modeling runs against nodebench-ai", async () => {
    const tool = dataModelingTools.find((t) => t.name === "convex_audit_data_modeling")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalTables).toBe("number");
    expect(result.summary.totalTables).toBeGreaterThan(0);
    console.log(`Data modeling: ${result.summary.totalTables} tables, ${result.summary.tablesWithArrays} with arrays, ${result.summary.tablesWithDeepNesting} deep nesting, ${result.summary.danglingIdRefs} dangling refs, ${result.summary.vAnyCount} v.any()`);
  });
});

describe("Dev Setup Tools", () => {
  it("convex_audit_dev_setup runs against nodebench-ai", async () => {
    const tool = devSetupTools.find((t) => t.name === "convex_audit_dev_setup")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.checks).toBeDefined();
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.summary.totalChecks).toBeGreaterThan(0);
    console.log(`Dev setup: ${result.summary.passed} passed, ${result.summary.warned} warned, ${result.summary.failed} failed`);
  });
});

describe("Migration Tools", () => {
  it("convex_schema_migration_plan needs 2 snapshots", async () => {
    // First ensure we have at least 2 snapshots
    const snapshotTool = integrationBridgeTools.find((t) => t.name === "convex_snapshot_schema")!;
    await snapshotTool.handler({ projectDir: PROJECT_DIR });
    await snapshotTool.handler({ projectDir: PROJECT_DIR });

    const tool = migrationTools.find((t) => t.name === "convex_schema_migration_plan")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    // Either has steps (diff found) or summary (no changes)
    if (result.steps) {
      expect(result.summary).toBeDefined();
      expect(result.summary.riskLevel).toBeDefined();
      console.log(`Migration plan: ${result.steps.length} steps, risk=${result.summary.riskLevel}`);
    } else if (result.error) {
      // Less than 2 snapshots — acceptable in clean test env
      console.log(`Migration plan: ${result.error}`);
    }
  });
});

describe("Reporting Tools", () => {
  it("convex_export_sarif exports SARIF 2.1.0 format", async () => {
    const tool = reportingTools.find((t) => t.name === "convex_export_sarif")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.sarif).toBeDefined();
    expect(result.sarif.version).toBe("2.1.0");
    expect(result.sarif.runs).toBeDefined();
    expect(result.sarif.runs.length).toBe(1);
    expect(result.sarif.runs[0].tool.driver.name).toBe("convex-mcp-nodebench");
    expect(result.summary.format).toBe("SARIF 2.1.0");
    console.log(`SARIF export: ${result.summary.totalResults} results, types: ${result.summary.auditTypesIncluded.join(", ")}`);
  });

  it("convex_audit_diff computes baseline diff", async () => {
    // Run a schema audit twice to create baseline data
    const schemaTool = schemaTools.find((t) => t.name === "convex_audit_schema")!;
    await schemaTool.handler({ projectDir: PROJECT_DIR });
    await schemaTool.handler({ projectDir: PROJECT_DIR });

    const tool = reportingTools.find((t) => t.name === "convex_audit_diff")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalNew).toBe("number");
    expect(typeof result.summary.totalFixed).toBe("number");
    expect(typeof result.summary.totalExisting).toBe("number");
    expect(["improving", "stable", "degrading"]).toContain(result.summary.trend);
    console.log(`Audit diff: ${result.summary.totalNew} new, ${result.summary.totalFixed} fixed, trend=${result.summary.trend}`);
  });
});

describe("Vector Search Tools", () => {
  it("convex_audit_vector_search runs against nodebench-ai", async () => {
    const tool = vectorSearchTools.find((t) => t.name === "convex_audit_vector_search")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.vectorIndexCount).toBe("number");
    expect(typeof result.summary.vectorSearchCallCount).toBe("number");
    expect(Array.isArray(result.summary.tablesWithVectors)).toBe(true);
    expect(result.summary.knownDimensions).toBeDefined();
    console.log(`Vector search audit: ${result.summary.vectorIndexCount} indexes, ${result.summary.vectorSearchCallCount} search calls, tables: ${result.summary.tablesWithVectors.join(", ") || "none"}`);
  });
});

describe("Scheduler Tools", () => {
  it("convex_audit_schedulers runs against nodebench-ai", async () => {
    const tool = schedulerTools.find((t) => t.name === "convex_audit_schedulers")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalSchedulerCalls).toBe("number");
    expect(typeof result.summary.runAfterCalls).toBe("number");
    expect(typeof result.summary.runAtCalls).toBe("number");
    expect(typeof result.summary.selfSchedulingFunctions).toBe("number");
    console.log(`Scheduler audit: ${result.summary.totalSchedulerCalls} calls (${result.summary.runAfterCalls} runAfter, ${result.summary.runAtCalls} runAt), ${result.summary.selfSchedulingFunctions} self-scheduling, ${result.summary.totalIssues} issues`);
  });
});

describe("Quality Gate Tools", () => {
  it("convex_quality_gate runs with default thresholds", async () => {
    const tool = qualityGateTools.find((t) => t.name === "convex_quality_gate")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(typeof result.passed).toBe("boolean");
    expect(typeof result.score).toBe("number");
    expect(["A", "B", "C", "D", "F"]).toContain(result.grade);
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.thresholdsUsed).toBeDefined();
    console.log(`Quality gate: ${result.passed ? "PASSED" : "FAILED"}, score=${result.score}, grade=${result.grade}, ${result.checks.length} checks`);
  });

  it("convex_quality_gate respects custom thresholds", async () => {
    const tool = qualityGateTools.find((t) => t.name === "convex_quality_gate")!;
    const result = (await tool.handler({
      projectDir: PROJECT_DIR,
      thresholds: { maxCritical: 99999, maxWarnings: 99999 },
    })) as any;
    expect(result).toBeDefined();
    expect(result.thresholdsUsed.maxCritical).toBe(99999);
    expect(result.thresholdsUsed.maxWarnings).toBe(99999);
    // With very generous thresholds, critical and warning checks should pass
    const criticalCheck = result.checks.find((c: any) => c.metric === "critical_issues");
    const warningCheck = result.checks.find((c: any) => c.metric === "warning_issues");
    if (criticalCheck) expect(criticalCheck.passed).toBe(true);
    if (warningCheck) expect(warningCheck.passed).toBe(true);
  });
});

describe("Architect Tools", () => {
  it("convex_scan_capabilities scans convex directory", async () => {
    const tool = architectTools.find((t) => t.name === "convex_scan_capabilities")!;
    const result = (await tool.handler({ projectDir: PROJECT_DIR })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.mode).toBe("directory");
    expect(typeof result.totalFiles).toBe("number");
    expect(result.totalFiles).toBeGreaterThan(0);
    expect(typeof result.activeFiles).toBe("number");
    expect(result.aggregate).toBeDefined();
    expect(result.aggregate.function_types).toBeDefined();
    expect(result.aggregate.data_access).toBeDefined();
    console.log(`Scan capabilities: ${result.totalFiles} files, ${result.activeFiles} active, top file: ${result.topFiles[0]?.file ?? "none"}`);
  });

  it("convex_scan_capabilities scans a single file", async () => {
    const convexDir = findConvexDir(PROJECT_DIR);
    expect(convexDir).not.toBeNull();
    const schemaPath = resolve(convexDir!, "schema.ts");
    const tool = architectTools.find((t) => t.name === "convex_scan_capabilities")!;
    const result = (await tool.handler({ filePath: schemaPath })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.mode).toBe("single_file");
    expect(result.schema_constructs).toBeDefined();
    // schema.ts should have defineSchema and defineTable
    expect(result.schema_constructs.define_schema).toBe(true);
    expect(result.schema_constructs.define_table).toBeGreaterThan(0);
    console.log(`Scan schema.ts: ${result.schema_constructs.define_table} tables, ${result.schema_constructs.indexes} indexes, ${result.schema_constructs.validators} validators`);
  });

  it("convex_verify_concept checks for vector search support", async () => {
    const tool = architectTools.find((t) => t.name === "convex_verify_concept")!;
    const result = (await tool.handler({
      projectDir: PROJECT_DIR,
      concept_name: "Vector Search",
      required_signatures: ["vectorIndex", "withSearchIndex|vectorSearch", "v\\.array.*v\\.float64"],
    })) as any;
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.concept).toBe("Vector Search");
    expect(typeof result.match_score).toBe("string");
    expect(["Fully Implemented", "Partially Implemented", "Not Implemented"]).toContain(result.status);
    expect(result.evidence_found.length + result.gap_analysis.length).toBe(3);
    console.log(`Verify concept 'Vector Search': ${result.match_score}, status=${result.status}, found=${result.evidence_found.length}, missing=${result.gap_analysis.length}`);
  });

  it("convex_generate_plan produces Convex-specific steps", async () => {
    const tool = architectTools.find((t) => t.name === "convex_generate_plan")!;
    const result = (await tool.handler({
      concept_name: "Scheduled Retry Queue",
      missing_signatures: ["scheduler.*runAfter", "internalMutation", "if.*retryCount"],
    })) as any;
    expect(result).toBeDefined();
    expect(result.concept).toBe("Scheduled Retry Queue");
    expect(result.total_steps).toBe(3);
    expect(result.steps.length).toBe(3);
    // Should have Convex-specific strategies
    expect(result.steps[0].strategy).toContain("scheduler");
    expect(result.steps[1].strategy).toContain("internalMutation");
    expect(result.steps[0].convex_file_hint).toBeDefined();
    expect(result.workflow.length).toBe(5);
    console.log(`Generate plan: ${result.total_steps} steps, complexity=${result.estimated_complexity}`);
  });
});

describe("Tool Count", () => {
  it("has exactly 36 tools", () => {
    const allTools = [
      ...schemaTools,
      ...functionTools,
      ...deploymentTools,
      ...learningTools,
      ...methodologyTools,
      ...integrationBridgeTools,
      ...cronTools,
      ...componentTools,
      ...httpTools,
      ...critterTools,
      ...authorizationTools,
      ...queryEfficiencyTools,
      ...actionAuditTools,
      ...typeSafetyTools,
      ...transactionSafetyTools,
      ...storageAuditTools,
      ...paginationAuditTools,
      ...dataModelingTools,
      ...devSetupTools,
      ...migrationTools,
      ...reportingTools,
      ...vectorSearchTools,
      ...schedulerTools,
      ...qualityGateTools,
      ...architectTools,
    ];
    expect(allTools.length).toBe(36);
    console.log(`Total tools: ${allTools.length}`);
    console.log("Tools:", allTools.map((t) => t.name).join(", "));
  });
});

// ── Embedding search A/B ─────────────────────────────────────────────────

import { findToolsWithEmbedding, REGISTRY } from "../tools/toolRegistry.js";
import { isEmbeddingReady, _resetForTesting as resetEmbedding, _setIndexForTesting, _setProviderForTesting } from "../tools/embeddingProvider.js";
import type { EmbeddingProvider } from "../tools/embeddingProvider.js";

describe("Embedding-enhanced tool discovery", () => {
  it("findToolsWithEmbedding returns same as findTools when no provider", async () => {
    resetEmbedding();
    const bm25 = findTools("audit schema");
    const enhanced = await findToolsWithEmbedding("audit schema");
    // Without embeddings, results should be identical
    expect(enhanced.map((r) => r.name)).toEqual(bm25.map((r) => r.name));
  });

  it("findToolsWithEmbedding fuses BM25 + embedding when index is loaded", async () => {
    // Mock embedding index where convex_search_gotchas is closest to "find past mistakes"
    const mockEntries = [
      { name: "convex_audit_schema", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.9]) },
      { name: "convex_suggest_indexes", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.8]) },
      { name: "convex_check_validator_coverage", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.7]) },
      { name: "convex_audit_functions", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.6]) },
      { name: "convex_check_function_refs", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.5]) },
      { name: "convex_pre_deploy_gate", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.4]) },
      { name: "convex_check_env_vars", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.3]) },
      { name: "convex_record_gotcha", nodeType: "tool" as const, vector: new Float32Array([0.7, 0.3, 0.0]) },
      { name: "convex_search_gotchas", nodeType: "tool" as const, vector: new Float32Array([0.9, 0.1, 0.0]) },
      { name: "convex_get_methodology", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.2]) },
      { name: "convex_discover_tools", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.1]) },
      { name: "convex_generate_rules_md", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.05]) },
      { name: "convex_snapshot_schema", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.04]) },
      { name: "convex_bootstrap_project", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.03]) },
      { name: "convex_check_crons", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.02]) },
      { name: "convex_analyze_components", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.01]) },
      { name: "convex_analyze_http", nodeType: "tool" as const, vector: new Float32Array([0.1, 0.1, 0.005]) },
    ];
    _setIndexForTesting(mockEntries);

    const enhanced = await findToolsWithEmbedding("gotcha");
    const names = enhanced.map((r) => r.name);
    // BM25 already ranks gotcha tools high, but embedding should reinforce them
    expect(names).toContain("convex_search_gotchas");
    expect(names).toContain("convex_record_gotcha");

    resetEmbedding();
  });

  it("bipartite domain expansion surfaces tools from matched domain even without BM25 hit", async () => {
    // Build index where ONLY the "learning" domain node is close — no tool nodes close.
    // The domain expansion loop (lines 430-438) should surface learning tools
    // even though BM25 didn't find them and no tool embedding matched.
    const allToolNames = REGISTRY.map((e) => e.name);
    const categories = [...new Set(REGISTRY.map((e) => e.category))];

    const toolEntries = allToolNames.map((name) => ({
      name,
      nodeType: "tool" as const,
      vector: new Float32Array([0.1, 0.1, 0.8]), // ALL tools distant
    }));

    const domainEntries = categories.map((cat) => ({
      name: `domain:${cat}`,
      nodeType: "domain" as const,
      vector: cat === "learning"
        ? new Float32Array([0.95, 0.05, 0.0])  // Only learning domain close
        : new Float32Array([0.05, 0.05, 0.9]),
    }));

    // Mock provider so embedQuery() returns a vector instead of null
    const mockProvider: EmbeddingProvider = {
      name: "mock",
      dimensions: 3,
      embed: async (texts: string[]) => texts.map(() => new Float32Array([1.0, 0.0, 0.0])),
    };
    _setProviderForTesting(mockProvider);
    _setIndexForTesting([...toolEntries, ...domainEntries]);

    // Use a query with minimal lexical overlap — forces embedding path to matter
    const results = await findToolsWithEmbedding("remember findings insights");
    const learningTools = results.filter((r) => r.category === "learning");

    // Learning tools should appear from domain expansion
    expect(learningTools.length).toBeGreaterThanOrEqual(1);
    // At least one learning tool should be present
    expect(learningTools.some((r) =>
      r.name === "convex_record_gotcha" || r.name === "convex_search_gotchas"
    )).toBe(true);

    resetEmbedding();
  });
});
