/** @vitest-environment node */
import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real route/stage/packet code runs. Only external transport and durable writes
// are replaced before imports; native SQLite is not exercised by this harness.
const writes = vi.hoisted(() => ({
  trajectory: vi.fn(), report: vi.fn(() => "fixture-report"), nudge: vi.fn(),
  evaluate: vi.fn(), promote: vi.fn(), context: vi.fn(),
}));
vi.mock("../../packages/mcp-local/src/db.js", () => ({
  getDb: () => { throw new Error("Unexpected real SQLite access in route proof"); },
  genId: () => "fixture-id", getOptionalDatabaseCtor: () => null,
  openOptionalSqliteDatabase: () => null,
}));
vi.mock("../../packages/mcp-local/src/sync/hyperloopEval.js", () => ({ evaluateTask: writes.evaluate }));
vi.mock("../../packages/mcp-local/src/sync/hyperloopArchive.js", () => ({ runPromotionCycle: writes.promote }));
vi.mock("./lib/canonicalModels.js", async (actual) => ({ ...(await actual()), saveReport: writes.report, createNudge: writes.nudge }));
vi.mock("./lib/trajectoryStore.js", async (actual) => ({ ...(await actual()), saveSearchTrajectory: writes.trajectory, findTrajectoryByEntityLens: () => null }));
vi.mock("./lib/searchContext.js", async (actual) => {
  const mod = await actual<typeof import("./lib/searchContext.js")>();
  return { ...mod, setSearchContext: (entry: Parameters<typeof mod.setSearchContext>[0]) => { writes.context(entry); mod.setSearchContext(entry); } };
});

const nativeFetch = globalThis.fetch;
let server: Server | undefined;
let base = "";
let calls: Array<{ host: string; query: string; signal?: AbortSignal | null }> = [];
let retention: any[] = [];
let cancelledBodies = 0;
let active = 0;
let peak = 0;
let allPaidFail = false;
let edgarMode = "failure";
let edgarTickerCalls = 0;
let totalBudgetScenario = false;
let budgetGeminiAttempts = 0;
let admissionRowCount: number | null = null;
const routeWork = new Set<Promise<unknown>>();
let pipeline: typeof import("./pipeline/searchPipeline.js");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Observe the actual Express async-handler boundary, including work that remains
// after a disconnected response closes. Forward its original promise unchanged.
function observeRouter(router: ReturnType<typeof express.Router>) {
  for (const layer of router.stack) {
    for (const handler of layer.route?.stack ?? []) {
      const original = handler.handle;
      handler.handle = function (this: unknown, ...args: any[]) {
        const result = original.apply(this, args);
        if (result && typeof result.then === "function") {
          routeWork.add(result);
          result.then(() => routeWork.delete(result), () => routeWork.delete(result));
        }
        return result;
      };
    }
  }
  return router;
}

async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!condition() && performance.now() < deadline) await sleep(5);
  if (!condition()) throw new Error(`Owned fixture deadline exceeded: ${label}`);
}
async function drainRoutes() { await until(() => routeWork.size === 0 && active === 0, "async route/provider drain"); }

function analysis(query: string) {
  const value: any = {
    entityName: "Acme", answer: "Acme builds a research product. [S1]",
    confidence: 12, signals: [], risks: [], comparables: [], nextActions: [], nextQuestions: [],
    keyMetrics: [{ label: "ARR or Revenue", value: query.includes("edgar") ? "Not disclosed" : "$2M" }],
  };
  if (query.includes("noanswer")) value.answer = "   ";
  if (query.includes("noconfidence")) delete value.confidence;
  if (query.includes("zeroconfidence")) value.confidence = 0;
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 45, totalTokenCount: 168 } };
}

function admissionSources(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = String(index).padStart(2, "0");
    return {
      name: `Acme research source ${id}`, title: `Acme research source ${id}`,
      url: `https://source-${id}.example/acme`,
      snippet: `Acme builds research software, source ${id}.`,
      description: `Acme builds research software, source ${id}.`,
      thumbnailUrl: `https://images.example/acme-${id}.png`,
      images: [{ url: `https://images.example/acme-${id}-second.png` }],
      faviconUrl: `https://source-${id}.example/favicon.png`, siteName: `Source ${id}`,
    };
  });
}

function sources(query: string) {
  if (admissionRowCount !== null) return admissionSources(admissionRowCount);
  return [
    { name: "Acme research launch", title: "Acme research launch", url: "https://businesswire.com/news/acme", snippet: "Acme builds research software.", description: "Acme builds research software.", thumbnailUrl: "https://images.example/acme.png" },
    { name: "Acme product", title: "Acme product", url: "https://techcrunch.com/acme", snippet: "Acme product helps teams research.", description: "Acme product helps teams research." },
  ];
}

function oversized(bytes: number, declared = false) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"padding":"'));
      controller.enqueue(new Uint8Array(bytes).fill(97));
      controller.enqueue(new TextEncoder().encode('"}'));
      // Keep the stream open until its owner cancels it or the fixture guard ends.
      setTimeout(() => { try { controller.close(); } catch { /* already cancelled */ } }, 30);
    },
    cancel() { cancelledBodies++; },
  });
  return new Response(body, { headers: { "content-type": "application/json", ...(declared ? { "content-length": String(bytes + 20) } : {}) } });
}

async function providerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === base) return nativeFetch(input, init);
  const host = url.hostname;
  const body: any = init?.body ? JSON.parse(String(init.body)) : {};
  const query = String(body.q ?? body.query ?? body.contents?.[0]?.parts?.[0]?.text ?? url.searchParams.get("q") ?? "");
  calls.push({ host, query, signal: init?.signal });
  if (calls.length > 5000) throw new Error("Fixture call budget exceeded");
  if (host === "retention.fixture") { retention.push(body); return json({ ok: true }); }
  if (host === "www.sec.gov") {
    edgarTickerCalls++;
    if (edgarMode === "firstfail" && edgarTickerCalls === 1) return json({}, 503);
    if (edgarMode === "oversize") return oversized(2_200_000);
    if (edgarMode === "entries") return json(Object.fromEntries(Array.from({ length: 25_001 }, (_, index) => [String(index), { cik_str: 1, ticker: `A${index}`, title: `Acme${index}` }])));
    if (edgarMode === "valid" || edgarMode === "firstfail") return json({ "0": { cik_str: 1, ticker: "ACME", title: "Acme" } });
    if (edgarMode === "stall") {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 150); init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true }); });
    }
    return json({}, 503);
  }
  if (host === "data.sec.gov") return json({ facts: { "us-gaap": { Revenues: { units: { USD: [{ form: "10-K", val: 2_000_000, end: "2025-12-31", fy: 2025 }] } } } } });
  if (!["api.linkup.so", "api.search.brave.com", "google.serper.dev", "api.tavily.com", "generativelanguage.googleapis.com"].includes(host)) throw new Error(`Unexpected external fixture host: ${host}`);
  active++; peak = Math.max(peak, active);
  try {
    if (init?.signal?.aborted) throw init.signal.reason;
    const gemini = host === "generativelanguage.googleapis.com";
    if (totalBudgetScenario && gemini) budgetGeminiAttempts++;
    if (totalBudgetScenario || query.includes("stall")) {
      await new Promise<void>((resolve, reject) => {
        // Guard ensures old non-cancelling behavior is observed without a hung test.
        const delay = totalBudgetScenario ? gemini ? budgetGeminiAttempts <= 2 ? 9000 : 2000 : host === "api.linkup.so" ? 29_000 : 7000 : 150;
        const timer = setTimeout(done, delay);
        const signal = init?.signal;
        function done() { signal?.removeEventListener("abort", abort); resolve(); }
        function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); }
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (totalBudgetScenario && gemini && budgetGeminiAttempts <= 2) return json({}, 503);
    if ((!gemini && query.includes("searchfail")) || (gemini && query.includes("analyzefail")) || (host === "api.linkup.so" && allPaidFail) || (host === "api.search.brave.com" && query.includes("partial"))) {
      return new Response("private_dummy_upstream_response", { status: query.includes("429") ? 429 : query.includes("400") ? 400 : 503 });
    }
    if (gemini && query.includes("malformed")) return new Response("<html>private_dummy_upstream_response</html>");
    if (gemini && query.includes("invalidutf8")) return new Response(new Uint8Array([0xff, 0xfe, 0xfd]));
    if (gemini && query.includes("geminicapped")) return oversized(300_000, query.includes("declared"));
    if (!gemini && query.includes("searchcapped")) return oversized(1_100_000, query.includes("declared"));
    if (gemini) return json(analysis(query));
    const found = query.includes("empty") ? [] : sources(query);
    if (host === "api.search.brave.com") return json({ web: { results: found } });
    if (host === "google.serper.dev") return json({ organic: found.map((s) => ({ title: s.title, link: s.url, snippet: s.snippet })) });
    if (host === "api.tavily.com") return json({ results: found.map((s) => ({ ...s, content: s.snippet, score: 0.5 })) });
    return json({ answer: "Acme research sources", sources: found, results: found });
  } finally { active--; }
}

async function configure(profile: "none" | "missinggemini" | "free" | "partial" | "paid" | "paidfree" | "brave" | "serper" | "tavily" | "linkup" = "free") {
  allPaidFail = profile === "paidfree";
  vi.resetModules();
  for (const key of ["LINKUP_API_KEY", "GEMINI_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY", "TAVILY_API_KEY", "NODEBENCH_ALLOW_PAID_SEARCH", "LINKUP_SEARCH_ALLOW_PAID", "CONVEX_URL", "CONVEX_DEPLOYMENT", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(key, "");
  if (profile !== "none") vi.stubEnv("BRAVE_SEARCH_API_KEY", "fixture-only");
  if (profile === "partial") vi.stubEnv("SERPER_API_KEY", "fixture-only");
  if (profile === "serper" || profile === "tavily") {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv(profile === "serper" ? "SERPER_API_KEY" : "TAVILY_API_KEY", "fixture-only");
  }
  if (profile === "paid" || profile === "paidfree" || profile === "linkup") {
    vi.stubEnv("LINKUP_API_KEY", "fixture-only"); vi.stubEnv("NODEBENCH_ALLOW_PAID_SEARCH", "true");
    if (profile === "paid" || profile === "linkup") vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
  }
  if (profile !== "none" && profile !== "missinggemini") vi.stubEnv("GEMINI_API_KEY", "fixture-only");
  vi.stubEnv("ATTRITION_URL", "https://retention.fixture");
  vi.stubGlobal("fetch", providerFetch);
  pipeline = await import("./pipeline/searchPipeline.js");
  const { createPipelineRouter } = await import("./routes/pipelineRoute.js");
  const { createStreamingSearchRouter } = await import("./routes/streamingSearch.js");
  const app = express(); app.use(express.json());
  app.use("/api/pipeline", observeRouter(createPipelineRouter())); app.use("/api/search", observeRouter(createStreamingSearchRouter()));
  server = await new Promise<Server>((resolve) => { const handle = app.listen(0, "127.0.0.1", () => resolve(handle)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function request(query: string, stream = false, signal?: AbortSignal) {
  const response = await nativeFetch(`${base}${stream ? "/api/search/stream" : "/api/pipeline/search"}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, lens: "founder" }),
    signal: signal ?? AbortSignal.timeout(4000),
  });
  const text = await response.text();
  expect(Buffer.byteLength(text)).toBeLessThan(1_048_576);
  return { response, text, data: stream && response.headers.get("content-type")?.includes("event-stream") ? null : JSON.parse(text) };
}

function noSuccessWrites() {
  expect(writes.trajectory).not.toHaveBeenCalled(); expect(writes.report).not.toHaveBeenCalled();
  expect(writes.nudge).not.toHaveBeenCalled(); expect(writes.context).not.toHaveBeenCalled();
  expect(writes.evaluate).not.toHaveBeenCalled(); expect(writes.promote).not.toHaveBeenCalled();
  expect(retention).toHaveLength(0);
}

beforeEach(() => { vi.clearAllMocks(); calls = []; retention = []; cancelledBodies = 0; active = 0; peak = 0; totalBudgetScenario = false; budgetGeminiAttempts = 0; admissionRowCount = null; });
afterEach(async () => {
  await drainRoutes();
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve())); server = undefined; }
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("Researcher and coding-agent real-route failure contract", () => {
  it.each(["none", "missinggemini"] as const)("configuration %s rejects JSON and SSE before provider work", async (profile) => {
    await configure(profile);
    for (const stream of [false, true]) {
      const result = await request("Acme configuration", stream);
      expect(result.response.status).toBe(503); expect(result.response.headers.get("content-type")).not.toContain("event-stream");
    }
    expect(calls).toHaveLength(0); noSuccessWrites();
  });

  it.each(["searchfail400", "searchfail429", "searchfail503", "analyzefail400", "analyzefail429", "analyzefail503", "malformed", "invalidutf8", "noanswer", "noconfidence", "searchcapped", "searchcappeddeclared", "geminicapped", "geminicappeddeclared"])("%s cannot create a successful research packet", async (scenario) => {
    await configure(); const result = await request(`Acme ${scenario}`);
    expect(result.response.status).toBe(502); expect(result.data.error).toBe(true);
    expect(result.data.success).not.toBe(true); expect(result.text).not.toContain("private_dummy_upstream_response");
    noSuccessWrites();
    if (scenario.includes("capped")) expect(cancelledBodies).toBeGreaterThan(0);
  });

  it("valid empty evidence returns422 and no success artifacts", async () => {
    await configure(); const result = await request("Acme empty");
    expect(result.response.status).toBe(422); noSuccessWrites();
  });

  it.each(["free", "paid", "partial", "paidfree"] as const)("%s retains usable evidence and reports unknown total cost honestly", async (profile) => {
    await configure(profile); const result = await request(`Acme ${profile === "paidfree" ? "paidfail" : profile === "partial" ? "partial" : "valid"}`);
    expect(result.response.status).toBe(200); expect(result.data.success).toBe(true);
    expect(result.data.answer).toContain("Acme builds"); expect(result.data.sourceRefs[0].href).toBe("https://businesswire.com/news/acme");
    expect(result.data.realCost).toBeNull(); expect(result.data.costMeasurementStatus).toBe("not_measured");
    expect(result.data.tokenUsage.totalTokens).toBe(168);
    expect(result.data.evaluation).toEqual({ status: "skipped", reason: "cost_not_measured" });
    expect(writes.evaluate).not.toHaveBeenCalled(); expect(writes.promote).not.toHaveBeenCalled();
    await until(() => retention.some((item) => item.type === "delta.pipeline_run"), "expected retention record");
    const retained = retention.find((item) => item.type === "delta.pipeline_run");
    expect(retained.data.realCost).toBeNull(); expect(retained.data.costMeasurementStatus).toBe("not_measured");
    expect(retained.summary).not.toContain("Cost: $");
    expect(writes.trajectory).toHaveBeenCalledTimes(1);
  });

  it("SSE failure after headers emits one terminal error and no complete/report", async () => {
    await configure(); const result = await request("Acme analyzefail503", true);
    expect(result.response.status).toBe(200); expect(result.text.match(/event: error/g)).toHaveLength(1);
    expect(result.text).not.toContain("event: complete"); noSuccessWrites();
  });

  it("valid SSE preserves output and the same unmeasured-cost projection", async () => {
    await configure(); const result = await request("Acme valid", true);
    const match = result.text.match(/event: complete\ndata: ([^\n]+)/);
    expect(match).not.toBeNull(); const complete = JSON.parse(match![1]);
    const packet = complete.result ?? complete.packet ?? complete;
    expect(packet.realCost).toBeNull(); expect(packet.costMeasurementStatus).toBe("not_measured");
    expect(writes.report).toHaveBeenCalledTimes(1);
  });

  it("already cancelled agent run performs no external work or package stage", async () => {
    await configure(); const controller = new AbortController(); controller.abort();
    const stages: string[] = [];
    const state = await (pipeline.runSearchPipeline as any)("Acme stall", "founder", (event: any) => stages.push(event.stage), undefined, controller.signal);
    expect(state.error).toBeTruthy(); expect(state.confidence).toBe(0); expect(calls).toHaveLength(0); expect(stages).not.toContain("package"); noSuccessWrites();
  });

  it("caller cancellation during provider headers stops fallback and later success writes", async () => {
    await configure(); const controller = new AbortController(); setTimeout(() => controller.abort(), 15);
    const state = await (pipeline.runSearchPipeline as any)("Acme stall", "founder", undefined, undefined, controller.signal);
    expect(state.error).toBeTruthy(); expect(state.confidence).toBe(0);
    expect(calls.every((call) => call.host !== "generativelanguage.googleapis.com")).toBe(true); noSuccessWrites();
  });

  it("closed streaming client cancels provider work and never stores a report", async () => {
    await configure(); const controller = new AbortController();
    const response = await nativeFetch(`${base}/api/search/stream?query=Acme%20stall`, { signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("event-stream"); controller.abort();
    await drainRoutes(); expect(calls.some((call) => call.signal?.aborted)).toBe(true); noSuccessWrites();
  });

  it("55-second owned budget terminates the real paced provider cascade without packaging", async () => {
    await configure("paidfree"); allPaidFail = false; totalBudgetScenario = true;
    const start = performance.now();
    const state: any = await pipeline.runSearchPipeline("Acme budgetstall", "founder");
    process.stdout.write("PIPELINE_TOTAL_BUDGET_OBSERVATION " + JSON.stringify({ elapsedMs: performance.now() - start, failure: state.failure ?? null, providerCalls: calls.map((call) => call.host), active }) + "\n");
    expect(state.error).toBeTruthy(); expect(state.failure?.code).toBe("TIMEOUT");
    expect(performance.now() - start).toBeLessThan(56_000); expect(active).toBe(0); noSuccessWrites();
  }, 65_000);

  it("actual zero model confidence stays zero on usable research", async () => {
    await configure(); const result = await request("Acme zeroconfidence"); expect(result.response.status).toBe(200); expect(result.data.confidence).toBe(0);
  });

  it("optional EDGAR outage leaves usable research intact and failed cache admission can retry", async () => {
    await configure(); edgarMode = "firstfail"; edgarTickerCalls = 0;
    const first = await pipeline.runSearchPipeline("Acme edgar", "investor"); expect(first.error).toBeNull(); expect(first.dcf).toBeNull();
    const second = await pipeline.runSearchPipeline("Acme edgar", "investor"); expect(second.error).toBeNull(); expect(second.dcf).not.toBeNull(); expect(edgarTickerCalls).toBe(2);
  });

  it.each(["oversize", "entries"])("optional EDGAR %s never admits a partial ticker cache", async (mode) => {
    await configure(); edgarMode = mode; edgarTickerCalls = 0;
    const first = await pipeline.runSearchPipeline("Acme edgar", "investor"); expect(first.error).toBeNull(); expect(first.dcf).toBeNull();
    edgarMode = "valid";
    const second = await pipeline.runSearchPipeline("Acme edgar", "investor"); expect(second.dcf).not.toBeNull(); expect(edgarTickerCalls).toBe(2);
  });

  it("abort during optional EDGAR cannot become a completed research artifact", async () => {
    await configure(); edgarMode = "stall"; edgarTickerCalls = 0;
    const controller = new AbortController(); setTimeout(() => controller.abort(), 30);
    const state = await (pipeline.runSearchPipeline as any)("Acme edgar", "investor", undefined, undefined, controller.signal);
    expect(state.error).toBeTruthy(); expect(state.confidence).toBe(0); expect(edgarTickerCalls).toBe(1); noSuccessWrites();
  });

  it("12 mixed coding-agent requests isolate failures and recover with valid health", async () => {
    await configure(); const results = await Promise.all(Array.from({ length: 12 }, (_, index) => request(`Acme ${index % 3 === 0 ? "malformed" : index % 3 === 1 ? "searchfail503" : "valid"} request${index}`)));
    expect(results.map((r) => r.response.status)).toEqual(Array.from({ length: 12 }, (_, index) => index % 3 === 2 ? 200 : 502));
    expect(writes.trajectory).toHaveBeenCalledTimes(4); expect(active).toBe(0); expect(peak).toBeLessThanOrEqual(12);
    expect((await nativeFetch(`${base}/api/pipeline/health`)).status).toBe(200);
  });

  it("60-second paced malformed/stall/success observation remains bounded and recovers", async () => {
    await configure(); const start = performance.now(); const startMemory = process.memoryUsage(); const statuses: number[] = []; const errors: string[] = [];
    let count = 0;
    while (performance.now() - start < 60_000 && count < 65) {
      const scenario = count % 3 === 0 ? "malformed" : count % 3 === 1 ? "stall" : "valid";
      const result = await request(`Acme ${scenario} paced${count}`); statuses.push(result.response.status);
      const expected = scenario === "malformed" ? 502 : 200;
      if (result.response.status !== expected) errors.push(`request${count}:${result.response.status} expected${expected}`);
      count++; await sleep(Math.max(0, Math.min(1000, 60_000 - (performance.now() - start))));
    }
    const recovery = await request("Acme valid recovery");
    const context = await import("./lib/searchContext.js");
    process.stdout.write("PIPELINE_PACED_OBSERVATION " + JSON.stringify({ elapsedMs: performance.now() - start, count, statuses, errors, startMemory, endMemory: process.memoryUsage(), active, peak, cache: context.getContextCacheStats(), providerCalls: calls.length }) + "\n");
    expect(errors).toEqual([]); expect(count).toBeLessThanOrEqual(65); expect(performance.now() - start).toBeGreaterThanOrEqual(60_000);
    expect(recovery.response.status).toBe(200); expect(active).toBe(0); expect(context.getContextCacheStats().size).toBeLessThanOrEqual(50);
    expect(writes.trajectory).toHaveBeenCalledTimes(statuses.filter((_, index) => index % 3 !== 0).length + 1);
  }, 75_000);

  it.each([0, 0.5, 12, 44.5, 95, 100, -5, 105, undefined, NaN, Infinity])("provided source score %s survives server/client projection without invented certainty", async (score) => {
    await configure(); const state = pipeline.createInitialPipelineState("Acme score", "founder");
    state.answer = "Acme evidence [S1]."; state.entityName = "Acme"; state.confidence = 12;
    state.searchSources = [{ name: "Acme source", url: "https://businesswire.com/acme", snippet: "Acme facts", qualityScore: score }];
    const packet: any = pipeline.stateToResultPacket(state);
    const { ensureProofPacket } = await import("../../apps/web/src/features/controlPlane/components/proofModel.js");
    const proof = ensureProofPacket(packet);
    if (typeof score === "number" && Number.isFinite(score)) {
      expect(packet.sourceRefs[0].confidence).toBe(Math.max(0, Math.min(100, score))); expect(proof.sourceRefs[0].confidence).toBe(packet.sourceRefs[0].confidence);
    } else { expect(packet.sourceRefs[0]).not.toHaveProperty("confidence"); expect(proof.sourceRefs[0]).not.toHaveProperty("confidence"); }
  });

  it("low readiness and synthetic sources keep unknown or low values; supplied readiness wins", async () => {
    await configure(); const state = pipeline.createInitialPipelineState("Acme risk", "founder"); state.entityName = "Acme"; state.answer = "Uncertain brief"; state.confidence = 0;
    state.risks = Array.from({ length: 8 }, (_, index) => ({ title: `Risk${index}`, description: "Not corroborated" }));
    const packet: any = pipeline.stateToResultPacket(state);
    const { ensureProofPacket } = await import("../../apps/web/src/features/controlPlane/components/proofModel.js");
    const proof = ensureProofPacket(packet); expect(proof.readinessScore).toBe(0); expect(proof.sourceRefs.every((source) => !Object.hasOwn(source, "confidence"))).toBe(true);
    expect(ensureProofPacket({ ...packet, readinessScore: 73 }).readinessScore).toBe(73);
  });

  it.each(["brave", "serper", "tavily", "linkup"] as const)("%s researcher admits30 rows, rejects31 without success artifacts, then recovers", async (provider) => {
    const rows = admissionSources(31);
    expect(Buffer.byteLength(JSON.stringify({ answer: "Acme research sources", sources: rows, results: rows }))).toBeLessThan(1_048_576);
    await configure(provider);
    const checkOrderedSources = (packet: any) => {
      const accepted = admissionSources(30).slice(0, 6);
      expect(packet.sourceRefs.map((source: any) => source.href)).toEqual(accepted.map((source) => source.url));
      expect(packet.sourceRefs.map((source: any) => source.label)).toEqual(accepted.map((source) => source.name));
      expect(packet.sourceRefs.map((source: any) => source.id)).toEqual(accepted.map((_, index) => `src_${index + 1}`));
      if (provider === "linkup") {
        expect(packet.sourceRefs.map((source: any) => source.thumbnailUrl)).toEqual(accepted.map((source) => source.thumbnailUrl));
        expect(packet.sourceRefs.map((source: any) => source.imageCandidates)).toEqual(accepted.map((source) => [source.thumbnailUrl, source.images[0].url]));
        expect(packet.sourceRefs.map((source: any) => source.faviconUrl)).toEqual(accepted.map((source) => source.faviconUrl));
        expect(packet.sourceRefs.map((source: any) => source.siteName)).toEqual(accepted.map((source) => source.siteName));
      } else {
        expect(packet.sourceRefs.every((source: any) => source.thumbnailUrl === undefined && source.imageCandidates === undefined)).toBe(true);
      }
    };
    admissionRowCount = 30;
    const accepted = await request("Acme rowadmission30");
    expect(accepted.response.status).toBe(200); expect(accepted.data.success).toBe(true);
    checkOrderedSources(accepted.data);
    await drainRoutes();
    expect(writes.trajectory).toHaveBeenCalledTimes(1);

    vi.clearAllMocks(); retention = [];
    const beforeRejected = calls.length;
    admissionRowCount = 31;
    const rejected = await request("Acme rowadmission31");
    expect(rejected.response.status).toBe(502); expect(rejected.data.error).toBe(true);
    expect(rejected.data.failure.code).toBe("INVALID_PROVIDER_RESPONSE");
    expect(rejected.data.success).not.toBe(true);
    expect(rejected.data).not.toHaveProperty("sourceRefs");
    await drainRoutes(); noSuccessWrites();
    expect(calls.slice(beforeRejected).every((call) => call.host !== "generativelanguage.googleapis.com")).toBe(true);
    expect(active).toBe(0);

    admissionRowCount = 30;
    const recovery = await request("Acme rowadmission recovery");
    expect(recovery.response.status).toBe(200); expect(recovery.data.success).toBe(true);
    checkOrderedSources(recovery.data);
    await drainRoutes();
    expect(writes.trajectory).toHaveBeenCalledTimes(1); expect(active).toBe(0);
  });
});
