// @vitest-environment node
/**
 * Eval harness wiring (SPEC-v9 A.2.10 PR 1): the harness must be able to name the
 * candidate it measures, because a migration receipt that cannot name its candidate
 * is rejected (A.0.3).
 *
 * Persona: an engineer deciding whether to move the Claude agent lane to a new model.
 * They run `EVAL_MODEL=<candidate> runner.ts --tier tier1 --seeds N`. Failure modes:
 * the runner measures a model other than the one named (the old hard-coded
 * claude-sonnet-4-6), the Messages call is still a scaffold that sends nothing, or
 * a request carries a parameter the new models answer 400 to. No network, no spend:
 * the stub backend is $0 and the Anthropic backend gets a fake transport.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVAL_DATASET } from "./dataset";
import { buildAnthropicRequest, invokeAgent } from "./agentInvoker";
import { main } from "./runner";
import type { EvalTask, RunConfig, RunTelemetry } from "./types";

const task: EvalTask = EVAL_DATASET.tasks.find((t) => t.tier === "tier1_deterministic")!;
const config = (agentMode: RunConfig["agentMode"], model = "candidate-model"): RunConfig => ({
  taskId: task.id,
  agentMode,
  model,
  seed: 1,
  timeout: 5_000,
});

function fakeMessagesTransport(responseBody: unknown, status = 200) {
  const seen: Array<{ url: string; body: Record<string, any> }> = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(responseBody), { status });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe("agentInvoker Anthropic backend", () => {
  it("sends the named candidate with no sampling keys and tool_choice auto", async () => {
    const { seen, fetchImpl } = fakeMessagesTransport({
      model: "candidate-model-echo",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "done" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const telemetry = await invokeAgent(config("mcp_core"), task, {
      backend: "anthropic",
      apiKey: "test-key-not-real",
      model: "candidate-model",
      fetchImpl,
    });
    expect(seen).toHaveLength(1);
    const { url, body } = seen[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.model).toBe("candidate-model");
    for (const key of ["temperature", "top_p", "top_k"]) expect(body, `${key} must be absent`).not.toHaveProperty(key);
    expect(body.max_tokens).toBe(8192);
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.tools.length).toBeGreaterThan(0);
    for (const tool of body.tools) expect(tool.input_schema).toMatchObject({ type: "object" });
    expect(body.messages).toEqual([{ role: "user", content: task.description }]);
    // the model string the provider returned is recorded next to the requested one
    expect(telemetry.echoedModel).toBe("candidate-model-echo");
    expect(telemetry.config.model).toBe("candidate-model");
    expect(telemetry.error).toBeUndefined();
    expect(telemetry.scorecard.efficiency.tokenCount).toBe(150);
    // a completed call is not a passed task: acceptance criteria are not graded here
    expect(telemetry.scorecard.correctness.taskSuccessRate).toBe(0);
  });

  it("bare mode offers no tools and therefore no tool_choice", () => {
    const body = buildAnthropicRequest(config("bare"), task, "candidate-model");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("reads blocks by type: text after a thinking block; a tool_use is a request, not an executed call", async () => {
    const { fetchImpl } = fakeMessagesTransport({
      model: "m",
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "…", signature: "s" },
        { type: "text", text: "plan" },
        { type: "tool_use", id: "t1", name: "convex_search_gotchas", input: { path: "schema.ts" } },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const telemetry = await invokeAgent(config("mcp_core"), task, {
      backend: "anthropic",
      apiKey: "k",
      model: "candidate-model",
      fetchImpl,
    });
    // No tool runs in this harness: the request is recorded apart and earns no score.
    // (Before: it was recorded as a successful ToolCallRecord and set knowledgeReuseRate to 1.)
    expect(telemetry.requestedTools?.map((c) => c.toolName)).toEqual(["convex_search_gotchas"]);
    expect(telemetry.toolCalls).toEqual([]);
    expect(telemetry.scorecard.efficiency.toolCallCount).toBe(0);
    expect(telemetry.scorecard.compounding.knowledgeReuseRate).toBe(0);
    expect(telemetry.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks an unfinished tool_use turn as an error", async () => {
    const { fetchImpl } = fakeMessagesTransport({
      model: "m",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "convex_audit_schema", input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const telemetry = await invokeAgent(config("mcp_lite"), task, { backend: "anthropic", apiKey: "k", model: "candidate-model", fetchImpl });
    expect(telemetry.error).toMatch(/tool_use.*none executed/);
    expect(telemetry.toolCalls).toEqual([]);
  });

  it("marks a response that echoes no model as an error: it is not identity evidence", async () => {
    const { fetchImpl } = fakeMessagesTransport({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "done" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const telemetry = await invokeAgent(config("bare"), task, { backend: "anthropic", apiKey: "k", model: "candidate-model", fetchImpl });
    expect(telemetry.error).toMatch(/no model string/);
    expect(telemetry.echoedModel).toBeUndefined();
  });

  it("reports an HTTP failure and a refusal as errors, never as a clean run", async () => {
    const failed = await invokeAgent(config("bare"), task, {
      backend: "anthropic",
      apiKey: "k",
      model: "candidate-model",
      fetchImpl: fakeMessagesTransport({ error: { type: "invalid_request_error" } }, 400).fetchImpl,
    });
    expect(failed.error).toMatch(/HTTP 400/);
    expect(failed.echoedModel).toBeUndefined();

    const refused = await invokeAgent(config("bare"), task, {
      backend: "anthropic",
      apiKey: "k",
      model: "candidate-model",
      fetchImpl: fakeMessagesTransport({ model: "m", stop_reason: "refusal", content: [] }).fetchImpl,
    });
    expect(refused.error).toMatch(/refusal/);
  });

  it("counts only end_turn as a clean run: max_tokens, pause_turn and a missing stop_reason are errors", async () => {
    for (const stop_reason of ["max_tokens", "pause_turn", undefined]) {
      const telemetry = await invokeAgent(config("bare"), task, {
        backend: "anthropic",
        apiKey: "k",
        model: "candidate-model",
        fetchImpl: fakeMessagesTransport({ model: "m", stop_reason, content: [{ type: "text", text: "cut off" }] }).fetchImpl,
      });
      expect(telemetry.error, `stop_reason ${String(stop_reason)}`).toMatch(/stop_reason: (max_tokens|pause_turn|missing)/);
    }
  });

  it("bounds the read: an oversized stream is cancelled, not buffered", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(1_000_000));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
        if (pulled > 50) controller.close();
      },
    });
    const telemetry = await invokeAgent(config("bare"), task, {
      backend: "anthropic",
      apiKey: "k",
      model: "candidate-model",
      fetchImpl: (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch,
    });
    expect(telemetry.error).toMatch(/exceeded/);
    expect(pulled).toBeLessThan(10);
  });

  it("refuses a declared content-length over the cap without reading the body", async () => {
    const telemetry = await invokeAgent(config("bare"), task, {
      backend: "anthropic",
      apiKey: "k",
      model: "candidate-model",
      fetchImpl: (async () =>
        new Response("{}", { status: 200, headers: { "content-length": "999999999" } })) as unknown as typeof fetch,
    });
    expect(telemetry.error).toMatch(/exceeded/);
  });

  it("refuses to run without a key", async () => {
    await expect(invokeAgent(config("bare"), task, { backend: "anthropic", model: "m" })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("stays a no-op stub by default", async () => {
    const telemetry = await invokeAgent(config("bare"), task, { backend: "stub" });
    expect(telemetry.error).toMatch(/^STUB/);
  });
});

describe("runner --tier / --seeds", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eval-harness-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const readAll = () =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ file: f, telemetry: JSON.parse(readFileSync(join(dir, f), "utf8")) as RunTelemetry }));

  it("writes two telemetry files per tier1 task for --seeds 2, each naming EVAL_MODEL", async () => {
    vi.stubEnv("EVAL_BACKEND", "stub");
    vi.stubEnv("EVAL_MODEL", "candidate-under-test");
    const tier1 = EVAL_DATASET.tasks.filter((t) => t.tier.startsWith("tier1"));
    expect(tier1.length).toBeGreaterThan(1);

    expect(await main(["--tier", "tier1", "--seeds", "2"], dir)).toBe(0);

    const rows = readAll();
    expect(rows).toHaveLength(tier1.length * 2);
    for (const t of tier1) {
      expect(rows.filter((r) => r.telemetry.config.taskId === t.id).map((r) => r.telemetry.config.seed).sort()).toEqual([1, 2]);
    }
    for (const { telemetry } of rows) {
      expect(telemetry.config.model).toBe(process.env.EVAL_MODEL);
      expect(telemetry.config).not.toHaveProperty("modelVersion");
    }
  });

  it("keeps the singular --seed for one-off runs", async () => {
    vi.stubEnv("EVAL_BACKEND", "stub");
    vi.stubEnv("EVAL_MODEL", "candidate-under-test");
    expect(await main(["--task", task.id, "--mode", "bare", "--seed", "3"], dir)).toBe(0);
    const rows = readAll();
    expect(rows.map((r) => r.file)).toEqual([`${task.id}_bare_s3.json`]);
  });

  it("requires EVAL_MODEL for a real backend, so a receipt always names its candidate", async () => {
    vi.stubEnv("EVAL_BACKEND", "anthropic");
    vi.stubEnv("EVAL_MODEL", "");
    expect(await main(["--tier", "tier1", "--seeds", "1"], dir)).toBe(1);
    expect(readAll()).toHaveLength(0);
  });

  it("exits non-zero when a real backend answers HTTP 400 on every run, and still writes the error rows", async () => {
    // Before: ten HTTP 400 responses wrote ten error rows and the runner exited 0, so the
    // declared migrationEvalCommand could pass without a single successful provider call.
    vi.stubEnv("EVAL_BACKEND", "anthropic");
    vi.stubEnv("EVAL_MODEL", "candidate-under-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchSpy);
    const tier1 = EVAL_DATASET.tasks.filter((t) => t.tier.startsWith("tier1"));

    expect(await main(["--tier", "tier1", "--seeds", "1"], dir)).toBe(1);

    expect(fetchSpy).toHaveBeenCalledTimes(tier1.length);
    const rows = readAll();
    expect(rows).toHaveLength(tier1.length);
    for (const { telemetry } of rows) expect(telemetry.error).toMatch(/HTTP 400/);
    vi.unstubAllGlobals();
  });

  it("exits 0 when every real-backend run completes cleanly", async () => {
    vi.stubEnv("EVAL_BACKEND", "anthropic");
    vi.stubEnv("EVAL_MODEL", "candidate-under-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ model: "candidate-under-test", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }),
          { status: 200 },
        ),
      ),
    );
    expect(await main(["--task", task.id, "--mode", "bare", "--seed", "1"], dir)).toBe(0);
    vi.unstubAllGlobals();
  });

  it("rejects an empty tier selection and a bad --seeds", async () => {
    vi.stubEnv("EVAL_BACKEND", "stub");
    expect(await main(["--tier", "tier9", "--seeds", "1"], dir)).toBe(1);
    expect(await main(["--tier", "tier1", "--seeds", "0"], dir)).toBe(1);
    expect(readAll()).toHaveLength(0);
  });
});
