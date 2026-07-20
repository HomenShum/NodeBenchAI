/**
 * Enterprise SpecDoc Schema
 * The B2B "Outcome API" — VP Engineering and CISOs buy a SpecDoc
 * that guarantees a Zero-Bug Deployment with an immutable Proof Pack.
 *
 * SpecDoc = specification + execution contract + verification audit trail
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

/* ================================================================== */
/* SPEC DOC SCHEMA VALIDATORS                                          */
/* ================================================================== */

const specCheckValidator = v.object({
  checkId: v.string(),
  category: v.union(
    v.literal("functional"),
    v.literal("security"),
    v.literal("performance"),
    v.literal("accessibility"),
    v.literal("compliance"),
    v.literal("data_integrity"),
    v.literal("ux_quality"),
  ),
  title: v.string(),
  description: v.string(),
  verificationMethod: v.union(
    v.literal("automated_test"),
    v.literal("visual_qa"),
    v.literal("video_qa"),
    v.literal("manual_review"),
    v.literal("metric_threshold"),
    v.literal("playwright_assertion"),
  ),
  threshold: v.optional(v.object({
    metric: v.string(),
    operator: v.union(v.literal("gt"), v.literal("gte"), v.literal("lt"), v.literal("lte"), v.literal("eq")),
    value: v.number(),
    units: v.optional(v.string()),
  })),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("passed"),
    v.literal("failed"),
    v.literal("skipped"),
    v.literal("blocked"),
  ),
  result: v.optional(v.object({
    passed: v.boolean(),
    actualValue: v.optional(v.number()),
    evidence: v.optional(v.string()),
    screenshotUrl: v.optional(v.string()),
    videoClipUrl: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    verifiedAt: v.number(),
  })),
  priority: v.union(v.literal("P0"), v.literal("P1"), v.literal("P2"), v.literal("P3")),
});

const deploymentTargetValidator = v.object({
  environment: v.union(
    v.literal("staging"),
    v.literal("production"),
    v.literal("preview"),
    v.literal("canary"),
  ),
  url: v.optional(v.string()),
  branch: v.optional(v.string()),
  commitSha: v.optional(v.string()),
  deployedAt: v.optional(v.number()),
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

export const createSpecDoc = mutation({
  args: {
    specKey: v.string(),
    title: v.string(),
    description: v.string(),
    projectId: v.optional(v.string()),
    clientOrg: v.optional(v.string()),
    contractValue: v.optional(v.number()),
    deadline: v.optional(v.number()),
    target: deploymentTargetValidator,
    checks: v.array(specCheckValidator),
    complianceFrameworks: v.optional(v.array(v.union(
      v.literal("SOC2"),
      v.literal("HIPAA"),
      v.literal("GDPR"),
      v.literal("ISO27001"),
      v.literal("PCI_DSS"),
      v.literal("FedRAMP"),
    ))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("specDocs", {
      ...args,
      status: "draft" as const,
      overallVerdict: "pending" as const,
      passRate: 0,
      totalChecks: args.checks.length,
      passedChecks: 0,
      failedChecks: 0,
      proofPackId: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateSpecCheckResult = mutation({
  args: {
    specDocId: v.id("specDocs"),
    checkId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("passed"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("blocked"),
    ),
    result: v.optional(v.object({
      passed: v.boolean(),
      actualValue: v.optional(v.number()),
      evidence: v.optional(v.string()),
      screenshotUrl: v.optional(v.string()),
      videoClipUrl: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      durationMs: v.optional(v.number()),
      verifiedAt: v.number(),
    })),
  },
  handler: async (ctx, { specDocId, checkId, status, result }) => {
    const doc = await ctx.db.get(specDocId);
    if (!doc) throw new Error(`SpecDoc ${specDocId} not found`);

    const updatedChecks = doc.checks.map((c: { checkId: string; status: string; result?: unknown }) =>
      c.checkId === checkId ? { ...c, status, result } : c
    );

    const passed = updatedChecks.filter((c: { status: string }) => c.status === "passed").length;
    const failed = updatedChecks.filter((c: { status: string }) => c.status === "failed").length;
    const total = updatedChecks.length;

    await ctx.db.patch(specDocId, {
      checks: updatedChecks,
      passedChecks: passed,
      failedChecks: failed,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      overallVerdict: failed > 0 ? "failed" as const
        : passed === total ? "passed" as const
        : "pending" as const,
      updatedAt: Date.now(),
    });
  },
});

export const finalizeSpecDoc = mutation({
  args: {
    specDocId: v.id("specDocs"),
    proofPackId: v.optional(v.id("proofPacks")),
  },
  handler: async (ctx, { specDocId, proofPackId }) => {
    const doc = await ctx.db.get(specDocId);
    if (!doc) throw new Error(`SpecDoc ${specDocId} not found`);

    const hasP0Failures = doc.checks.some(
      (c: { priority: string; status: string }) => c.priority === "P0" && c.status === "failed"
    );

    await ctx.db.patch(specDocId, {
      status: hasP0Failures ? "blocked" as const : "finalized" as const,
      overallVerdict: doc.failedChecks > 0 ? "failed" as const : "passed" as const,
      proofPackId,
      updatedAt: Date.now(),
    });
  },
});

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

export const getSpecDoc = query({
  args: { specDocId: v.id("specDocs") },
  handler: async (ctx, { specDocId }) => {
    return await ctx.db.get(specDocId);
  },
});

export const getSpecDocByKey = query({
  args: { specKey: v.string() },
  handler: async (ctx, { specKey }) => {
    return await ctx.db
      .query("specDocs")
      .withIndex("by_spec_key", (q) => q.eq("specKey", specKey))
      .first();
  },
});

export const listSpecDocs = query({
  args: {
    status: v.optional(v.union(
      v.literal("draft"),
      v.literal("executing"),
      v.literal("finalized"),
      v.literal("blocked"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit }) => {
    if (status) {
      let q = ctx.db
        .query("specDocs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc");
      const r = limit ? await q.take(limit) : await q.collect();
      return r;
    }
    let q = ctx.db.query("specDocs").order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getSpecDocDashboard = query({
  args: {},
  handler: async (ctx) => {
    const allDocs = await ctx.db.query("specDocs").collect();
    const active = allDocs.filter((d) => d.status === "executing");
    const finalized = allDocs.filter((d) => d.status === "finalized");
    const blocked = allDocs.filter((d) => d.status === "blocked");

    const totalContractValue = allDocs
      .filter((d) => d.contractValue)
      .reduce((sum, d) => sum + (d.contractValue ?? 0), 0);

    return {
      total: allDocs.length,
      active: active.length,
      finalized: finalized.length,
      blocked: blocked.length,
      totalContractValue,
      avgPassRate: allDocs.length > 0
        ? Math.round(allDocs.reduce((sum, d) => sum + d.passRate, 0) / allDocs.length)
        : 0,
      recentDocs: allDocs.slice(0, 5).map((d) => ({
        specKey: d.specKey,
        title: d.title,
        status: d.status,
        passRate: d.passRate,
        verdict: d.overallVerdict,
      })),
    };
  },
});
