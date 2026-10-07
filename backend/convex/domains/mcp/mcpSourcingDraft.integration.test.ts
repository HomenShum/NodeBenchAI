// @vitest-environment node
/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { mcpGatewayHandler } from "./mcpGatewayDispatcher";
import { FALLBACK_MODEL, getModelSpec } from "../agents/mcp_tools/models/modelResolver";
import { canonicalSourcingValue, SOURCING_MAX_BYTES, SOURCING_PROVIDER_TIMEOUT_MS, validateSourcingDraft } from "./mcpSourcingContract";

function reroot(path: string) {
  const parts = path.replace(/^\.\//, "").split("/"), base = ["domains", "mcp"];
  while (parts[0] === "..") { parts.shift(); base.pop(); }
  return [...base, ...parts].join("/");
}
const modules = Object.fromEntries(Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(([path, loader]) => [reroot(path), loader]));
const action = internal.domains.mcp.mcpSourcingDraft.generate;
const ledger = internal.domains.mcp.mcpToolLedger;
const lifecycle = internal.domains.operations.taskManager.mutations;
const sha = (value: unknown) => createHash("sha256").update(canonicalSourcingValue(value)).digest("hex");
const draft = { requirements: [{ name: "Housing", value: "Confirm material from supplied sample", status: "approved" }], components: [], questions: ["Which material grade was used?"], checklist: [{ en: "Measure wall thickness", zh: "测量壁厚" }], rationale: "The brief lacks a verified material grade." };
const input = { brief: "Prepare a draft for a reusable desk accessory; material grade needs verification.", priorSpecification: null, sources: [], offers: [], samples: [] };
const responseBody = (extra: Record<string, unknown> = {}) => ({ status: "completed", model: "test-provider-model-snapshot", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(draft) }] }], usage: { input_tokens: 100, output_tokens: 60, total_tokens: 160 }, ...extra });

async function fixture() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "sourcing-owner@example.com" }));
  vi.stubEnv("MCP_SERVICE_USER_ID", userId);
  return { t, userId };
}
function requestArgs(userId: string, requestId = "attempt_1", evidence: unknown = input) {
  return { userId, requestId, projectId: "desk_accessory", expectedRevision: 3, inputHash: sha({ projectId: "desk_accessory", expectedRevision: 3, input: evidence }), inputJson: JSON.stringify(evidence) };
}
async function stored(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => ({ traces: await ctx.db.query("agentTaskTraces").collect(), sessions: await ctx.db.query("agentTaskSessions").collect(), steps: await ctx.db.query("agentTaskSpans").collect() }));
}
function gatewayRequest(args: unknown, secret = "test-service-secret", fn = "mcpGenerateSourcingDraft") {
  return new Request("https://example.com/api/mcpGateway", { method: "POST", headers: { "content-type": "application/json", "x-mcp-secret": secret }, body: JSON.stringify({ fn, args }) });
}
const invokeGateway = (ctx: unknown, request: Request): Promise<Response> => (mcpGatewayHandler as any)._handler(ctx, request);
// The repository's Convex type shims erase reference types. This test-only bridge
// forwards those untyped references to real convex-test validators/transactions.
function gatewayContext(t: ReturnType<typeof convexTest>) { return { runMutation: (ref: any, args: any) => t.mutation(ref, args), runAction: (ref: any, args: any) => t.action(ref, args), runQuery: (ref: any, args: any) => t.query(ref, args) }; }

beforeEach(() => {
  vi.stubEnv("MCP_SECRET", "test-service-secret");
  vi.stubEnv("OPENAI_API_KEY", "test-provider-credential");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(responseBody())));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("A sourcing owner receives a reviewable proposal without moving provider credentials to the local app", () => {
  it("binds the supplied revision and actual provider result to a completed private run, while overriding a forged owner and approval", async () => {
    const { t, userId } = await fixture();
    const result = await invokeGateway(gatewayContext(t), gatewayRequest(requestArgs("forged-owner")));
    expect(result.status).toBe(200);
    const { data } = await result.json();
    expect(data.draft.requirements[0].status).toBe("model-suggestion-unverified");
    expect(data.receipt).toMatchObject({ inputHash: requestArgs(userId).inputHash, outputHash: sha(data.draft), projectId: "desk_accessory", expectedRevision: 3, model: "test-provider-model-snapshot", reviewRequired: true, usage: { input: 100, output: 60, total: 160 } });
    const records = await stored(t);
    expect(records.traces).toHaveLength(1); expect(records.sessions).toHaveLength(1);
    expect(records.traces[0]).toMatchObject({ sessionId: records.sessions[0]._id, status: "completed" });
    expect(records.sessions[0]).toMatchObject({ userId, status: "completed", visibility: "private" });
    expect(JSON.stringify(data)).not.toContain("test-provider-credential");
    expect(JSON.stringify(records)).not.toContain("test-provider-credential");
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options).toMatchObject({ redirect: "error", method: "POST" });
    expect(JSON.parse(options!.body as string)).toMatchObject({ model: getModelSpec(FALLBACK_MODEL).sdkId, store: false, max_output_tokens: 3500, text: { format: { strict: true, type: "json_schema" } } });
  });

  it("refuses anonymous and wrong-secret requests before spending or creating a ledger row", async () => {
    const { t, userId } = await fixture();
    for (const secret of ["", "wrong"]) expect((await invokeGateway(gatewayContext(t), gatewayRequest(requestArgs(userId), secret))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("mcpToolCallLedger").collect())).toHaveLength(0);
  });

  it("does not treat inherited object names as real allowlisted tools", async () => {
    const { t } = await fixture();
    for (const fn of ["constructor", "__proto__", "toString"]) expect((await invokeGateway(gatewayContext(t), gatewayRequest({}, "test-service-secret", fn))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("mcpToolCallLedger").collect())).toHaveLength(0);
  });

  it.each(["wrong owner", "changed evidence", "invalid revision", "missing key", "oversized evidence"])("rejects %s before any provider request", async (scenario) => {
    const { t, userId } = await fixture(); const args = requestArgs(userId);
    if (scenario === "wrong owner") args.userId = "foreign-owner";
    if (scenario === "changed evidence") args.inputJson = JSON.stringify({ ...input, brief: "Changed after hashing" });
    if (scenario === "invalid revision") args.expectedRevision = 0;
    if (scenario === "missing key") vi.stubEnv("OPENAI_API_KEY", "");
    if (scenario === "oversized evidence") args.inputJson = " ".repeat(SOURCING_MAX_BYTES + 1);
    await expect(t.action(action, args)).rejects.toThrow(/SOURCING_/);
    expect(fetch).not.toHaveBeenCalled(); expect((await stored(t)).traces).toHaveLength(0);
  });

  it("caps the serialized request including schema and escaped evidence, not only the source JSON", async () => {
    const { t, userId } = await fixture();
    const evidence = { ...input, sources: Array.from({ length: 7 }, () => ({ text: "\\".repeat(8500) })) };
    const args = requestArgs(userId, "escaped", evidence);
    expect(Buffer.byteLength(args.inputJson)).toBeLessThan(SOURCING_MAX_BYTES);
    await expect(t.action(action, args)).rejects.toThrow("SOURCING_INPUT_LIMIT");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["http", "refusal", "incomplete", "malformed", "invalid schema", "oversized", "missing model"])("returns a non-success response and terminal owned run after provider %s failure", async (scenario) => {
    const { t, userId } = await fixture();
    vi.mocked(fetch).mockImplementation(async () => {
      if (scenario === "http") return new Response("provider private error", { status: 429 });
      if (scenario === "malformed") return new Response("{broken");
      if (scenario === "oversized") return new Response("x".repeat(SOURCING_MAX_BYTES + 1));
      return Response.json(responseBody(scenario === "refusal" ? { output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] } : scenario === "incomplete" ? { status: "incomplete" } : scenario === "missing model" ? { model: null } : { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ approved: true }) }] }] }));
    });
    const response = await invokeGateway(gatewayContext(t), gatewayRequest(requestArgs(userId)));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("provider private error");
    const records = await stored(t); expect(records.traces[0].status).toBe("error"); expect(records.sessions[0].status).toBe("failed");
  });

  it("aborts a stalled request at its budget, then a retry completes in a new trace", async () => {
    const { t, userId } = await fixture(); vi.useFakeTimers();
    let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async (_url, options) => new Promise((_resolve, reject) => { options!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); started(); }));
    const attempt = t.action(action, requestArgs(userId)).then(() => null, (error: Error) => error);
    await Promise.race([ready, attempt.then((error) => { throw error ?? new Error("The stalled provider unexpectedly completed"); })]);
    await vi.advanceTimersByTimeAsync(SOURCING_PROVIDER_TIMEOUT_MS);
    expect((await attempt)?.message).toContain("SOURCING_MODEL_TIMEOUT");
    vi.useRealTimers();
    const retried = await t.action(action, requestArgs(userId, "attempt_2"));
    expect(retried.receipt.reviewRequired).toBe(true);
    const records = await stored(t); expect(records.traces.map((trace) => trace.status).sort()).toEqual(["completed", "error"]);
    expect(records.sessions.map((session) => session.status).sort()).toEqual(["completed", "failed"]);
  });

  it("keeps a provider's inconsistent usage unavailable instead of inventing token accounting", async () => {
    const { t, userId } = await fixture();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(responseBody({ usage: { input_tokens: 100, output_tokens: 60, total_tokens: 10 } })));
    expect((await t.action(action, requestArgs(userId))).receipt.usage).toBeNull();
  });

  it("does not mistake comma-containing keys for the required draft fields or depend on key order", () => {
    expect(() => validateSourcingDraft({ "checklist,components": [], questions: [], rationale: "x", requirements: [] })).toThrow("SOURCING_MODEL_SCHEMA");
    expect(sha({ b: 2, a: 1 })).toBe(sha({ a: 1, b: 2 }));
    expect(validateSourcingDraft({ ...draft, requirements: [{ ...draft.requirements[0], status: "verified" }] }).requirements[0].status).toBe("model-suggestion-unverified");
  });
});

describe("Repeated coding-agent requests remain bounded and auditable", () => {
  it("keeps twenty permitted provider drafts and twelve rejected retries distinct during overlapping and sustained gateway calls", async () => {
    const { t, userId } = await fixture(); const ctx = gatewayContext(t);
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => invokeGateway(ctx, gatewayRequest(requestArgs(userId, `burst_${index}`)))));
    for (let index = 0; index < 24; index++) responses.push(await invokeGateway(ctx, gatewayRequest(requestArgs(userId, `sustained_${index}`))));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(20);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(12);
    expect(fetch).toHaveBeenCalledTimes(20);
    const records = await stored(t);
    expect(records.traces).toHaveLength(20); expect(records.sessions).toHaveLength(20);
    expect(records.traces.every((trace) => trace.status === "completed")).toBe(true);
    expect(records.sessions.every((session) => session.userId === userId && session.status === "completed")).toBe(true);
    const receipts = await Promise.all(responses.filter((response) => response.status === 200).map((response) => response.json()));
    expect(new Set(receipts.map((result) => result.data.receipt.traceId)).size).toBe(20);
  });

  it("reserves at most twenty daily calls across a burst and a sustained sequence, then resets at the next UTC day", async () => {
    const { t } = await fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T10:00:00Z"));
    const args = { toolName: "mcpGenerateSourcingDraft", toolType: "action", riskTier: "external_read", args: {} };
    const burst = await Promise.all(Array.from({ length: 12 }, () => t.mutation(ledger.startToolCallInternal, args)));
    const sustained: Array<{ allowed: boolean }> = [];
    for (let i = 0; i < 40; i++) { vi.setSystemTime(Date.now() + 30_000); sustained.push(await t.mutation(ledger.startToolCallInternal, args)); }
    expect([...burst, ...sustained].filter((item) => item.allowed)).toHaveLength(20);
    expect((await t.run((ctx) => ctx.db.query("mcpToolUsageDaily").collect())).filter((row) => row.scope === "tool")[0].count).toBe(20);
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    expect((await t.mutation(ledger.startToolCallInternal, args)).allowed).toBe(true);
  });

  it("enforces a lower owner-configured budget even when legacy observation mode is enabled", async () => {
    const { t, userId } = await fixture();
    await t.run((ctx) => ctx.db.insert("mcpPolicyConfigs", { name: "default", enforce: false, dailyLimitsByTool: { mcpGenerateSourcingDraft: 0 }, createdAt: Date.now(), updatedAt: Date.now() }));
    expect((await invokeGateway(gatewayContext(t), gatewayRequest(requestArgs(userId)))).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rolls back both lifecycle writes when a corrupted session owner rejects completion", async () => {
    const { t, userId } = await fixture();
    const run = await t.mutation(internal.domains.mcp.mcpExecutionTraceEndpoints.mcpStartExecutionRun, { userId, title: "Owner review", workflowName: "sourcing-specification-draft", type: "agent", visibility: "private" });
    await t.run(async (ctx) => { const foreign = await ctx.db.insert("users", { email: "other-owner@example.com" }); await ctx.db.patch(run.sessionId, { userId: foreign }); });
    const before = await stored(t);
    await expect(t.mutation(lifecycle.completeExecutionRunForService, { userId, traceId: run.traceId, status: "completed" })).rejects.toThrow();
    expect(await stored(t)).toEqual(before);
  });

  it.each(["missing service owner", "ledger completion failure"])("never returns 2xx for %s after a permitted dispatch", async (scenario) => {
    const { t, userId } = await fixture(); const ctx = gatewayContext(t);
    if (scenario === "missing service owner") vi.stubEnv("MCP_SERVICE_USER_ID", "");
    else {
      const original = ctx.runMutation;
      ctx.runMutation = (ref, args) => args.callId && args.success ? Promise.reject(new Error("Audit write unavailable")) : original(ref, args);
    }
    expect((await invokeGateway(ctx, gatewayRequest(requestArgs(userId)))).status).toBe(500);
    const rows = await t.run((context) => context.db.query("mcpToolCallLedger").collect());
    expect(rows[0].success).toBe(false);
  });

  it("preserves an existing feed query while surfacing its failed ledger completion honestly", async () => {
    const { t } = await fixture(); const ctx = gatewayContext(t);
    ctx.runQuery = async () => ({ items: [], hasMore: false });
    const first = await invokeGateway(ctx, gatewayRequest({}, "test-service-secret", "getPublicForYouFeed"));
    expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ success: true, data: { items: [], hasMore: false } });
    const original = ctx.runMutation;
    ctx.runMutation = (ref, args) => args.callId && args.success ? Promise.reject(new Error("Audit write unavailable")) : original(ref, args);
    expect((await invokeGateway(ctx, gatewayRequest({}, "test-service-secret", "getPublicForYouFeed"))).status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
  });
});
