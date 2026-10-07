/** @vitest-environment node */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";
import type { ContentBlock, McpTool } from "../types.js";
import { getOptionalDatabaseCtor } from "../db.js";
import { wrapToolsWithProxy } from "../profiler/mcpProxy.js";
import { initEventCollectorTables } from "../profiler/eventCollector.js";
import { createSession, endSession, executeToolInSession, listSessions } from "../engine/session.js";
import { computeConformance } from "../engine/conformance.js";
import { startEngineServer, stopEngineServer, type EngineServerConfig } from "../engine/server.js";
import * as contextBridge from "../engine/contextBridge.js";
import { auditLog, flushAuditLog, _resetAuditForTesting } from "../security/auditLog.js";
import { _resetSecurityConfigForTesting } from "../security/config.js";
import { createMcpGateway } from "../../../../workers/node/mcpGateway.js";
import { hashApiKey, hashPrefix } from "../../../../workers/node/mcpAuth.js";
import type { SessionTelemetry } from "../../../../workers/node/mcpSession.js";
describe("coding agent compiled stdio and CLI handoff", () => {
  const packageRoot = resolve(import.meta.dirname, "../..");
  const entry = join(packageRoot, "dist/index.js");
  const literal = '{"error":true} is screenshot content';
  const imageBytes = Buffer.from("controlled screenshot bytes");
  function environment(data: string) {
    return Object.fromEntries(Object.entries({
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      USERPROFILE: data, HOME: data, TEMP: data, TMP: data, NODEBENCH_DATA_DIR: data,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
  function fixture() {
    const data = mkdtempSync(join(tmpdir(), "mcp-outcome-process-"));
    const loader = join(data, "playwright-fixture.mjs");
    // Browser I/O and one malformed local receipt are controlled; dispatch, SDK, DB and transports are real.
    writeFileSync(loader, [
      "export async function resolve(s,c,n){if(s==='playwright')return {url:'fixture:playwright',shortCircuit:true};if(s==='./tools/metaTools.js')return {url:'fixture:meta',shortCircuit:true};return n(s,c)}",
      "export async function load(u,c,n){if(u==='fixture:meta')return {format:'module',shortCircuit:true,source:",
      JSON.stringify("export function createMetaTools(){return [{name:'getMethodology',description:'Malformed local receipt fixture',inputSchema:{type:'object'},handler:async()=>{const result={};result.self=result;return result;}}];}"),
      "};if(u!=='fixture:playwright')return n(u,c);return {format:'module',shortCircuit:true,source:",
      JSON.stringify("import {writeFileSync} from 'node:fs'; const bytes=Buffer.from('controlled screenshot bytes'); const page={on(){},async goto(){},async waitForSelector(){},async title(){return 'controlled';},url(){return 'https://example.invalid/';},async $(selector){return null;},accessibility:{async snapshot(){return {role:'document',name:'" + literal + "'};}},async screenshot(opts){if(opts.path)writeFileSync(opts.path,bytes);return bytes;}}; const context={async newPage(){return page;},async close(){}}; const browser={async newPage(){return page;},async newContext(){return context;},async close(){}}; export const chromium={async launch(){return browser;}};"),
      "};}",
    ].join("\n"));
    return { data, env: environment(data), nodeArgs: ["--experimental-loader", pathToFileURL(loader).href] };
  }
  it("lets a coding agent stop after returned failure and preserves successful ordered image evidence across dynamic loading", async () => {
    const { data, env, nodeArgs } = fixture();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [...nodeArgs, entry, "--toolsets", "ui_ux_dive,delta", "--no-embedding", "--no-toon", "--profile"],
      cwd: packageRoot, env, stderr: "pipe",
    });
    const client = new Client({ name: "honest-result-proof", version: "1" });
    const callTool = async (params: Parameters<Client["callTool"]>[0]): Promise<CallToolResult> =>
      await client.callTool(params) as CallToolResult;
    function firstText(result: CallToolResult): string {
      const first = result.content[0];
      if (first.type !== "text") throw new Error("Expected a leading text receipt");
      return first.text;
    }
    try {
      await client.connect(transport);
      const failed = await callTool({ name: "dive_snapshot", arguments: { sessionId: "absent" } });
      expect.soft(failed.isError).toBe(true);
      expect(JSON.parse(firstText(failed)).message).toContain("No active browser");
      const wrapped = await callTool({ name: "call_loaded_tool", arguments: { tool: "dive_snapshot", args: { sessionId: "absent" } } });
      expect.soft(wrapped.isError).toBe(true);
      const malformed = await callTool({ name: "getMethodology", arguments: {} });
      expect(malformed.isError).toBe(true);
      expect(firstText(malformed)).toContain("circular");
      const started = await callTool({ name: "start_ui_dive", arguments: { appUrl: "https://example.invalid/", autoDiscover: false } });
      const sessionId = JSON.parse(firstText(started)).sessionId;
      const screenshot = await callTool({ name: "dive_snapshot", arguments: { sessionId, label: "retained" } });
      expect(screenshot.isError).toBe(false);
      expect(screenshot.content.map((block) => block.type)).toEqual(["text", "image"]);
      expect(screenshot.content[1]).toEqual({ type: "image", data: imageBytes.toString("base64"), mimeType: "image/png" });
      const text = await callTool({ name: "dive_snapshot", arguments: { sessionId, mode: "accessibility" } });
      expect(text.isError).toBe(false);
      expect(firstText(text)).toContain('\\"error\\":true');
      await callTool({ name: "load_toolset", arguments: { toolset: "ui_capture" } });
      const loaded = await callTool({ name: "capture_ui_screenshot", arguments: { url: "https://example.invalid/", waitMs: 0 } });
      expect(loaded.isError).toBe(false);
      expect(loaded.content.map((block) => block.type)).toEqual(["text", "image"]);
      expect(loaded.content[1]).toEqual({ type: "image", data: imageBytes.toString("base64"), mimeType: "image/png" });
      const thrown = await callTool({ name: "capture_ui_screenshot", arguments: { url: "https://example.invalid/", viewport: "custom" } });
      expect(thrown.isError).toBe(true);
      expect(firstText(thrown)).toContain("Custom viewport requires");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(join(data, "nodebench.db"));
      const rows = db.prepare("SELECT result_status,error FROM tool_call_log WHERE tool_name='dive_snapshot' ORDER BY rowid").all();
      expect.soft(rows.map((row: any) => row.result_status)).toEqual(["error", "success", "success"]);
      const events = db.prepare("SELECT tool_name,success FROM unified_events WHERE tool_name IN ('dive_snapshot','capture_ui_screenshot') ORDER BY rowid").all();
      expect.soft(events.map((row: any) => [row.tool_name, row.success])).toEqual([
        ["dive_snapshot", 0], ["dive_snapshot", 0], ["dive_snapshot", 1], ["dive_snapshot", 1], ["capture_ui_screenshot", 1], ["capture_ui_screenshot", 0],
      ]);
      const malformedRows = db.prepare("SELECT result_status FROM tool_call_log WHERE tool_name='getMethodology'").all();
      expect.soft(malformedRows).toEqual([{ result_status: "error" }]);
      db.close();
      const audit = new Database(join(data, "security_audit.db"));
      const auditRows = audit.prepare("SELECT allowed,metadata FROM audit_log WHERE tool_name='dive_snapshot' ORDER BY rowid").all() as any[];
      expect.soft(auditRows.map(row => [row.allowed, JSON.parse(row.metadata).resultStatus])).toEqual([[1,"error"],[1,"success"],[1,"success"]]);
      const thrownAudit = audit.prepare("SELECT allowed,metadata FROM audit_log WHERE tool_name='capture_ui_screenshot' ORDER BY rowid").all() as any[];
      expect.soft(thrownAudit.map(row => [row.allowed, JSON.parse(row.metadata).resultStatus])).toEqual([[1,"success"],[1,"error"]]);
      const malformedAudit = audit.prepare("SELECT allowed,metadata FROM audit_log WHERE tool_name='getMethodology'").all() as any[];
      expect.soft(malformedAudit.map(row => [row.allowed, JSON.parse(row.metadata).resultStatus])).toEqual([[1,"error"]]);
      audit.close();
      const analytics = new Database(join(data, ".nodebench", "analytics.db"));
      const tracked = analytics.prepare("SELECT success FROM tool_usage WHERE tool_name='dive_snapshot' ORDER BY rowid").all() as any[];
      expect.soft(tracked.map(row => row.success)).toEqual([0,1,1]);
      analytics.close();
    } finally { await client.close(); }
  }, 30_000);
  it("gives an automation caller nonzero exits for invalid work and preserves the local success path", () => {
    const { env, nodeArgs } = fixture();
    const cli = (args: string[]) => spawnSync(process.execPath, [...nodeArgs, entry, ...args, "--no-embedding"], {
      cwd: packageRoot, env, encoding: "utf8", timeout: 20_000, shell: false,
    });
    const generic = cli(["call", "dive_snapshot", '{"sessionId":"absent"}']);
    expect.soft(generic.status).toBe(1);
    expect(generic.stdout).toContain("No active browser");
    for (const args of [{action:"add"},{action:"remove"},{action:"check"},{action:"invalid"}]) {
      const delta = cli(["watch", JSON.stringify(args)]);
      expect.soft(delta.status).toBe(1);
      expect(delta.stdout).toContain("Error:");
    }
    const success = cli(["watch", '{"action":"list"}']);
    expect(success.status).toBe(0);
    expect(success.stdout).toContain('"watchlist"');
  }, 60_000);
});

// Keep the real SQLite collector/audit code; replace only its database location.
// getDb's existing opaque return type also covers the native statement spies.
const storage = vi.hoisted(() => ({
  collector: null as ReturnType<typeof import("../db.js")["getDb"]>,
  audit: null as ReturnType<typeof import("../db.js")["getDb"]>,
}));
vi.mock("../db.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db.js")>();
  return {
    ...original,
    getDb: () => storage.collector,
    openOptionalSqliteDatabase: () => storage.audit,
  };
});

const blocks: ContentBlock[] = [
  { type: "text", text: 'Literal evidence: {"error":true}\nKeep this text unchanged.' },
  { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", mimeType: "image/png" },
  { type: "text", text: "Last receipt stays last." },
];
const returnedFailure = { error: true, message: "Capture failed: no active session." };
const thrownFailure = new Error("Original capture exception.");
function tool(name: string, handler: McpTool["handler"], rawContent = false): McpTool {
  return { name, description: name, inputSchema: { type: "object" }, handler, rawContent };
}
function fixtureTools(): McpTool[] {
  return [
    tool("capture_failed", async () => returnedFailure, true),
    tool("capture_success", async () => blocks, true),
    tool("capture_thrown", async () => { throw thrownFailure; }),
    tool("run_recon", async () => ({ receipt: "recon completed" })),
    tool("receipt", async () => "retained receipt"),
  ];
}
function engineConfig(tools = fixtureTools()): EngineServerConfig {
  return {
    allTools: tools,
    toolMap: new Map(tools.map((item) => [item.name, item])),
    presets: { full: ["proof"] },
    toolsetMap: { proof: tools },
    toolToToolset: new Map(tools.map((item) => [item.name, "proof"])),
    workflowChains: {
      capture: { name: "Capture evidence", description: "Fail then recover", steps: [
        { tool: "capture_failed", action: "Attempt capture" },
        { tool: "capture_success", action: "Recover capture" },
      ] },
      recovered: { name: "Recovered capture", description: "This chain succeeds after an earlier failed attempt", steps: [
        { tool: "capture_success", action: "Recover capture" },
      ] },
    },
  };
}
async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  return address.port;
}
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
async function engineUrl(config = engineConfig()): Promise<string> {
  // startEngineServer does not report the actual port when passed zero.
  const reservation = createServer();
  const preferredPort = await listen(reservation);
  await closeServer(reservation);
  return `http://127.0.0.1:${await startEngineServer(config, preferredPort)}`;
}
function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(2_000),
  });
}
function rpc(ws: WebSocket, id: number, name: string): Promise<{ result: { content: ContentBlock[]; isError: boolean } }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", receive);
      reject(new Error(`Missing response ${id}`));
    }, 2_000);
    function receive(data: Buffer) {
      const message = JSON.parse(data.toString());
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.off("message", receive);
      resolve(message);
    }
    ws.on("message", receive);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } }));
  });
}

let dataDir: string;
beforeAll(() => {
  expect(getOptionalDatabaseCtor(), "This proof requires actual native SQLite, not a noop store").toBeTypeOf("function");
});
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "nodebench-result-status-"));
  vi.stubEnv("NODEBENCH_DATA_DIR", dataDir);
  vi.stubEnv("NODEBENCH_AUDIT_ENABLED", "true");
  const Database = getOptionalDatabaseCtor();
  storage.collector = new Database(":memory:");
  storage.audit = new Database(":memory:");
  _resetAuditForTesting();
  _resetSecurityConfigForTesting();
});
afterEach(async () => {
  _resetAuditForTesting();
  _resetSecurityConfigForTesting();
  stopEngineServer();
  for (const session of listSessions()) endSession(session.id);
  vi.restoreAllMocks();
  vi.useRealTimers();
  storage.collector?.close();
  storage.audit?.close();
  vi.unstubAllEnvs();
});

describe("MCP-HONEST-RESULT-02: a developer needs trustworthy capture evidence", () => {
  it("keeps empty-message and truthy explicit failures distinct from false markers and literal content", async () => {
    initEventCollectorTables();
    const outcomes = [
      { error: true, message: "" }, { error: "not available" }, { error: 1 },
      { error: false }, { error: 0 }, { error: null }, blocks,
    ];
    const tools = outcomes.map((value, index) => tool(`outcome_${index}`, async () => value, Array.isArray(value)));
    const config = engineConfig(tools);
    const session = createSession("full", config.presets, config.toolsetMap, config.toolMap);
    const records = [];
    for (const item of tools) records.push(await executeToolInSession(session, item.name, {}));
    expect(records.map(record => record.status)).toEqual(["error","error","error","success","success","success","success"]);
    const proxied = wrapToolsWithProxy(tools, { sessionId: "marker-contract" });
    for (let index = 0; index < outcomes.length; index++) expect(await proxied[index].handler({})).toBe(outcomes[index]);
    expect(storage.collector.prepare("SELECT success FROM unified_events ORDER BY rowid").all().map((row: {success:number}) => row.success)).toEqual([0,0,0,1,1,1,1]);
  });
  it("keeps WebSocket result bytes/order and session failure counts aligned through failure and recovery", async () => {
    const telemetry: SessionTelemetry[] = [];
    const rawKey = `nb_key_${"1".repeat(32)}`; // fixed fixture, never a provider credential
    const keyHash = hashApiKey(rawKey);
    const gateway = createMcpGateway({
      tools: fixtureTools(),
      keyLookup: async () => ({ keyHash, keyHashPrefix: hashPrefix(keyHash), userId: "result-status-fixture",
        permissions: ["tools:read", "tools:execute"], rateLimits: { perMinute: 100, perDay: 10_000 },
        createdAt: 0, lastUsedAt: 0, revokedAt: null }),
      telemetryEmitter: async (record) => { telemetry.push(record); },
    });
    const http = createServer((_req, res) => { res.writeHead(404); res.end(); });
    http.on("upgrade", (req, socket, head) => { void gateway.handleUpgrade(req, socket, head); });
    const port = await listen(http);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/mcp`, { headers: { Authorization: `Bearer ${rawKey}` } });
    try {
      await once(ws, "open");
      const failed = await rpc(ws, 1, "capture_failed");
      const successes = await Promise.all(Array.from({ length: 8 }, (_, index) => rpc(ws, index + 2, "capture_success")));
      const thrown = await rpc(ws, 10, "capture_thrown");
      const closed = once(ws, "close");
      ws.close();
      await closed;
      expect(failed.result.isError).toBe(true);
      expect(JSON.parse(failed.result.content[0].type === "text" ? failed.result.content[0].text : "{}")).toEqual(returnedFailure);
      for (const success of successes) {
        expect(success.result).toMatchObject({ isError: false, content: blocks });
      }
      expect(thrown.result.isError).toBe(true);
      expect(thrown.result.content).toEqual([{ type: "text", text: "Error executing capture_thrown: Tool execution failed" }]);
      await vi.waitFor(() => expect(telemetry).toHaveLength(1), { timeout: 1_000 });
      expect(telemetry[0]).toMatchObject({ toolCallCount: 10, errorCount: 2 });
    } finally {
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      gateway.wss.close();
      await closeServer(http);
    }
  });

  it("returns non2xx engine failures, records them, and recovers without changing successful content", async () => {
    const url = await engineUrl();
    const created = await post(`${url}/api/sessions`, {});
    const { sessionId } = await created.json() as { sessionId: string };
    const failed = await post(`${url}/api/tools/capture_failed`, { sessionId });
    const failedBody = await failed.json();
    const success = await post(`${url}/api/tools/capture_success`, { sessionId });
    const successBody = await success.json();
    const thrown = await post(`${url}/api/tools/capture_thrown`, { sessionId });
    const thrownBody = await thrown.json();
    const workflow = await post(`${url}/api/workflows/capture`, { sessionId });
    const workflowBody = await workflow.json() as { ok: boolean };
    const trace = await (await fetch(`${url}/api/sessions/${sessionId}/trace`)).json() as { callHistory: Array<{ status: string }> };
    const streamed = await post(`${url}/api/workflows/capture`, { sessionId, streaming: true });
    const streamedText = await streamed.text();
    expect(streamedText).toMatch(/event: complete\ndata: \{"ok":false,/);
    const recovered = await post(`${url}/api/workflows/recovered`, { sessionId });
    expect(recovered.status).toBe(200);
    expect((await recovered.json() as { ok: boolean }).ok).toBe(true);
    const recoveredStream = await post(`${url}/api/workflows/recovered`, { sessionId, streaming: true });
    expect(await recoveredStream.text()).toMatch(/event: complete\ndata: \{"ok":true,/);
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(failedBody).toMatchObject({ ok: false, result: returnedFailure });
    expect(success.status).toBe(200);
    expect(successBody).toMatchObject({ ok: true, result: blocks });
    expect(thrown.status).toBeGreaterThanOrEqual(400);
    expect(thrownBody).toMatchObject({ ok: false, result: { error: thrownFailure.message } });
    expect(workflow.status).toBeGreaterThanOrEqual(400);
    expect(workflowBody.ok).toBe(false);
    expect(trace.callHistory.map((record: { status: string }) => record.status)).toEqual(["error", "success", "error", "error", "success"]);
  });

  it("bounds a sustained engine session while preserving the failure, completed checks, and lifetime totals", async () => {
    const config = engineConfig();
    const session = createSession("full", config.presets, config.toolsetMap, config.toolMap);
    await executeToolInSession(session, "capture_failed", {});
    await executeToolInSession(session, "run_recon", {});
    for (let index = 0; index < 10_000; index++) await executeToolInSession(session, "receipt", {});
    const report = computeConformance(session);
    const url = await engineUrl(config);
    const detail = await (await fetch(`${url}/api/sessions/${session.id}`)).json() as { callCount: number };
    expect(session.callHistory.length).toBeLessThanOrEqual(10_000);
    expect(detail.callCount).toBe(10_002);
    expect(report).toMatchObject({ totalSteps: 10_002, successfulSteps: 10_001, failedSteps: 1,
      breakdown: { noErrors: false, reconPerformed: true } });
  });

  it("bounds repeated streamed disclosures and exposes a retained tail rather than silently shrinking total calls", async () => {
    const config = engineConfig();
    config.workflowChains.soak = { name: "Repeated local receipts", description: "One bounded session", steps:
      Array.from({ length: 10_001 }, () => ({ tool: "receipt", action: "Store receipt" })) };
    const session = createSession("full", config.presets, config.toolsetMap, config.toolMap);
    const url = await engineUrl(config);
    const response = await post(`${url}/api/workflows/soak`, { sessionId: session.id, streaming: true });
    const events = await response.text();
    const trace = await (await fetch(`${url}/api/sessions/${session.id}/trace`)).json() as { events: unknown[]; callHistory: unknown[] };
    const detail = await (await fetch(`${url}/api/sessions/${session.id}`)).json() as { callCount: number };
    expect(events).toContain("event: complete");
    expect(events).toMatch(/event: complete\ndata: \{"ok":true,/);
    expect(trace.events.length).toBeLessThanOrEqual(20_000);
    expect(trace.callHistory.length).toBeLessThanOrEqual(10_000);
    expect(detail.callCount).toBe(10_001);
    expect(JSON.stringify(trace)).toMatch(/retained|truncat|historyLimit|disclosureLimit/i);
  });

  it("records malformed results as failed steps and closes a separate infrastructure outage without false completion", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const config = engineConfig([tool("cyclic_receipt", async () => cyclic)]);
    config.workflowChains.cyclic = { name: "Serialization outage", description: "No false terminal success", steps:
      [{ tool: "cyclic_receipt", action: "Return local receipt" }] };
    storage.collector.exec(`
      CREATE TABLE engine_reports (id TEXT PRIMARY KEY,session_id TEXT,workflow TEXT,preset TEXT,score REAL,grade TEXT,
        breakdown TEXT,summary TEXT,total_steps INTEGER,successful_steps INTEGER,failed_steps INTEGER,total_duration_ms INTEGER,generated_at TEXT);
      CREATE TABLE engine_workflow_runs (id TEXT PRIMARY KEY,session_id TEXT,workflow TEXT,preset TEXT,step_count INTEGER,
        success_count INTEGER,failed_count INTEGER,duration_ms INTEGER,created_at TEXT);
    `);
    const session = createSession("full", config.presets, config.toolsetMap, config.toolMap);
    const url = await engineUrl(config);
    const malformed = await post(`${url}/api/workflows/cyclic`, { sessionId: session.id });
    expect(malformed.status).toBe(500);
    const body = await malformed.json() as { results: Array<{ result: { error: string } }> };
    expect(body).toMatchObject({ ok: false, results: [{ status: "error" }],
      conformance: { successfulSteps: 0, failedSteps: 1, breakdown: { noErrors: false } } });
    expect(body.results[0].result.error).toContain("circular");
    const failedStream = await post(`${url}/api/workflows/cyclic`, { sessionId: session.id, streaming: true });
    const failedEvents = await failedStream.text();
    expect(failedEvents).toMatch(/event: complete\ndata: \{"ok":false,/);
    expect(failedEvents).toContain('"status":"error"');
    expect(storage.collector.prepare("SELECT successful_steps,failed_steps,breakdown FROM engine_reports ORDER BY rowid").all()
      .map((row: any) => [row.successful_steps,row.failed_steps,JSON.parse(row.breakdown).noErrors])).toEqual([[0,1,false],[0,2,false]]);
    expect(storage.collector.prepare("SELECT success_count,failed_count FROM engine_workflow_runs ORDER BY rowid").all())
      .toEqual([{success_count:0,failed_count:1},{success_count:0,failed_count:2}]);
    endSession(session.id);
    vi.spyOn(contextBridge, "loadSessionContext").mockReturnValue({
      recentRuns: [], relevantLearnings: [], recentContentThemes: [], openGapCount: 0,
      conformanceTrend: { direction: "stable", avgScore: cyclic as unknown as number, runCount: 0 },
    });
    let events = "";
    try {
      const response = await post(`${url}/api/workflows/cyclic`, { streaming: true });
      events = await response.text();
    } catch { /* baseline may leave the stream open until the request budget expires */ }
    expect(events).toContain("event: error");
    expect(events).not.toContain("event: complete");
    const sessions = await (await fetch(`${url}/api/sessions`)).json() as { sessions: unknown[] };
    expect(sessions.sessions).toEqual([]);
  });

  it("profiles returned failures, thrown failures, and literal error text without changing their results", async () => {
    initEventCollectorTables();
    const proxied = wrapToolsWithProxy(fixtureTools(), { sessionId: "profile-outcome" });
    expect(await proxied[0].handler({})).toBe(returnedFailure);
    expect(await proxied[1].handler({})).toBe(blocks);
    await expect(proxied[2].handler({})).rejects.toBe(thrownFailure);
    const records = storage.collector.prepare("SELECT tool_name, success FROM unified_events ORDER BY rowid").all();
    expect(records).toEqual([
      { tool_name: "capture_failed", success: 0 }, { tool_name: "capture_success", success: 1 },
      { tool_name: "capture_thrown", success: 0 },
    ]);
  });

  it("preserves result and exception identity during actual SQLite collector and callback outages, then resumes recording", async () => {
    initEventCollectorTables();
    const proxied = wrapToolsWithProxy(fixtureTools(), { sessionId: "profile-storage-outage" });
    const unavailable = vi.spyOn(storage.collector, "prepare").mockImplementation(() => { throw new Error("SQLite unavailable"); });
    const success = await Promise.allSettled([proxied[1].handler({}), proxied[0].handler({}), proxied[2].handler({})]);
    unavailable.mockRestore();
    expect(success).toEqual([
      { status: "fulfilled", value: blocks }, { status: "fulfilled", value: returnedFailure },
      { status: "rejected", reason: thrownFailure },
    ]);
    expect(storage.collector.prepare("SELECT COUNT(*) AS count FROM unified_events").get().count).toBe(0);
    const callback = wrapToolsWithProxy(fixtureTools(), { sessionId: "profile-callback-outage", onEvent: () => { throw new Error("Callback unavailable"); } });
    const callbackResults = await Promise.allSettled([callback[1].handler({}), callback[2].handler({})]);
    expect(callbackResults).toEqual([{ status: "fulfilled", value: blocks }, { status: "rejected", reason: thrownFailure }]);
    expect(await proxied[0].handler({})).toBe(returnedFailure);
    expect(storage.collector.prepare("SELECT success FROM unified_events WHERE session_id = ?").all("profile-storage-outage")).toEqual([{ success: 0 }]);
  });

  it.each(["prepare", "transaction", "run"] as const)("keeps audit bursts bounded through three %s outages, timer flushes, and recovery", async (failurePoint) => {
    vi.useFakeTimers();
    auditLog("tool_call", "warmup", "isolated fixture", true);
    flushAuditLog();
    const nativePrepare = storage.audit.prepare.bind(storage.audit);
    const nativeTransaction = storage.audit.transaction.bind(storage.audit);
    const batches: number[] = [];
    const errors: unknown[] = [];
    let outage = false;
    vi.spyOn(storage.audit, "prepare").mockImplementation((...args: unknown[]) => {
      const sql = args[0] as string;
      if (outage && failurePoint === "prepare") throw new Error("Audit prepare unavailable");
      const statement = nativePrepare(sql);
      if (sql.includes("INSERT OR IGNORE INTO audit_log")) {
        const nativeRun = statement.run.bind(statement);
        vi.spyOn(statement, "run").mockImplementation((...args: unknown[]) => {
          if (outage && failurePoint === "run") throw new Error("Audit insert unavailable");
          return nativeRun(...args);
        });
      }
      return statement;
    });
    vi.spyOn(storage.audit, "transaction").mockImplementation((...args: unknown[]) => {
      const fn = args[0] as (entries: unknown[]) => void;
      if (outage && failurePoint === "transaction") throw new Error("Audit transaction unavailable");
      return nativeTransaction((entries: unknown[]) => { batches.push(entries.length); return fn(entries); });
    });
    for (let round = 0; round < 3; round++) {
      outage = true;
      for (let index = 0; index < 700; index++) auditLog("tool_call", `lost_${round}`, `${index}`, false);
      try { await vi.advanceTimersByTimeAsync(100); } catch (error) { errors.push(error); }
      outage = false;
      for (let index = 0; index < 700; index++) auditLog("tool_call", `recovered_${round}`, `${index}`, true);
      try { flushAuditLog(); } catch (error) { errors.push(error); }
    }
    const rows = nativePrepare("SELECT tool_name, COUNT(*) AS count, MIN(CAST(args_preview AS INTEGER)) AS first FROM audit_log GROUP BY tool_name ORDER BY tool_name").all();
    expect(errors).toEqual([]);
    expect(batches.every((size) => size <= 256)).toBe(true);
    expect(rows).toEqual([
      { tool_name: "recovered_0", count: 700, first: 0 },
      { tool_name: "recovered_1", count: 700, first: 0 },
      { tool_name: "recovered_2", count: 700, first: 0 },
      { tool_name: "warmup", count: 1, first: 0 },
    ]);
  });
});

// A developer must be able to distinguish failed captures from usable evidence.
describe("raw tool outcome contract", () => {
  const mocks = ["playwright", "sharp", "openai", "@google/genai", "os", "../db.js"];
  let home: string;
  beforeEach(async () => {
    vi.resetModules();
    home = await mkdtemp(join(tmpdir(), "raw-tool-outcome-"));
    vi.doMock("os", async (original) => ({ ...await original<typeof import("os")>(), homedir: () => home }));
    for (const key of ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]) vi.stubEnv(key, "");
  });
  afterEach(() => {
    for (const name of mocks) vi.doUnmock(name);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });
  async function tools() {
    return [
      ...(await import("../tools/uiCaptureTools.js")).uiCaptureTools,
      ...(await import("../tools/visionTools.js")).visionTools,
      ...(await import("../tools/uiUxDiveTools.js")).uiUxDiveTools,
      ...(await import("../tools/visualQaTools.js")).visualQaTools,
    ];
  }
  async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return (await tools()).find(t => t.name === name)!.handler(args);
  }
  function failure(result: any, message: RegExp) {
    expect(Array.isArray(result)).toBe(false);
    expect(result).toMatchObject({ error: true, message: expect.stringMatching(message) });
  }
  function browser(goto = vi.fn().mockResolvedValue(undefined)) {
    const bytes = Buffer.from("controlled screenshot bytes");
    const page = {
      on: vi.fn(), goto, waitForSelector: vi.fn(),
      screenshot: vi.fn(async (opts: any) => { if (opts.path) writeFileSync(opts.path, bytes); return bytes; }),
      title: vi.fn().mockResolvedValue("A developer's evidence"), url: () => "https://example.invalid/",
      $: vi.fn().mockResolvedValue(null), accessibility: { snapshot: vi.fn().mockResolvedValue({ role: "document" }) },
    };
    const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
    const instance = { newPage: vi.fn().mockResolvedValue(page), newContext: vi.fn().mockResolvedValue(context), close: vi.fn() };
    vi.doMock("playwright", () => ({ chromium: { launch: vi.fn().mockResolvedValue(instance) } }));
    return { page, instance, bytes };
  }

  it.each([
    ["capture_ui_screenshot", "playwright"], ["capture_responsive_suite", "playwright"],
    ["burst_capture", "playwright"], ["run_visual_qa_suite", "playwright"],
    ["manipulate_screenshot", "sharp"], ["generate_grid_collage", "sharp"],
  ])("lets a fresh-install developer identify the unavailable dependency for %s", async (name, dependency) => {
    vi.doMock(dependency, () => { throw new Error("Optional dependency unavailable in this consumer"); });
    failure(await call(name), /not installed/i);
  });

  it("reports missing provider and missing browser session without producing evidence", async () => {
    failure(await call("analyze_screenshot", { imageBase64: "ignored" }), /No vision provider/);
    failure(await call("dive_snapshot", { sessionId: "not-started" }), /No active browser/);
  });

  it.each(["capture_ui_screenshot", "capture_responsive_suite", "burst_capture", "run_visual_qa_suite"])("closes the failed browser and retains context for %s", async name => {
    const { instance } = browser(vi.fn().mockRejectedValue(new Error("Page closed during navigation")));
    const result = await call(name, { url: "https://example.invalid/", label: "failed", waitMs: 0, settleMs: 0 });
    failure(result, /Page closed during navigation/);
    expect(result.url).toBe("https://example.invalid/");
    expect(instance.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid visual viewports and empty or unreadable frames before calling them a collage", async () => {
    browser();
    for (const name of ["burst_capture", "run_visual_qa_suite"]) failure(await call(name, { viewport: "invalid" }), /Unknown viewport/);
    failure(await call("generate_grid_collage", { framePaths: [] }), /non-empty/);
    failure(await call("generate_grid_collage", { framePaths: [join(home, "missing.png")] }), /failed/i);
  });

  it("reports a suite's missing image decoder even when its browser is available", async () => {
    browser();
    vi.doMock("sharp", () => { throw new Error("Image dependency unavailable"); });
    failure(await call("run_visual_qa_suite"), /sharp is not installed/);
  });

  it("preserves single and responsive capture bytes and content ordering", async () => {
    const { bytes } = browser();
    const single = await call("capture_ui_screenshot", { url: "https://example.invalid/", waitMs: 0 });
    expect(single.map((b: any) => b.type)).toEqual(["text", "image"]);
    expect(single[1]).toEqual({ type: "image", data: bytes.toString("base64"), mimeType: "image/png" });
    const multi = await call("capture_responsive_suite", { url: "https://example.invalid/", label: "three-widths", waitMs: 0 });
    expect(multi.map((b: any) => b.type)).toEqual(["text", "text", "image", "text", "image", "text", "image"]);
    expect(multi.filter((b: any) => b.type === "image").map((b: any) => b.data)).toEqual(Array(3).fill(bytes.toString("base64")));
  });

  it("rejects malformed bytes and invalid crops, then processes a valid image in the same workflow", async () => {
    const sharp = (await import("sharp")).default;
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#224466" } }).png().toBuffer();
    failure(await call("manipulate_screenshot", { imageBase64: Buffer.from("not-an-image").toString("base64"), operation: "resize", width: 4 }), /Image manipulation failed/);
    failure(await call("manipulate_screenshot", { imageBase64: input.toString("base64"), operation: "crop", x: 99, y: 0, cropWidth: 2, cropHeight: 2 }), /Image manipulation failed/);
    const result = await call("manipulate_screenshot", { imageBase64: input.toString("base64"), operation: "resize", width: 4 });
    expect(result[1].type).toBe("image");
    expect(await sharp(Buffer.from(result[1].data, "base64")).metadata()).toMatchObject({ width: 4, height: 4 });
  });

  it("retains failed-provider context and successful text containing JSON error words", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("Controlled provider failure")).mockResolvedValueOnce({ choices: [{ message: { content: '{"error":true} is literal text in this screenshot' } }] });
    vi.doMock("openai", () => ({ default: class { chat = { completions: { create } }; } }));
    const failed = await call("analyze_screenshot", { imageBase64: "controlled", provider: "openai" });
    failure(failed, /Controlled provider failure/);
    expect(failed.provider).toBe("openai");
    const success = await call("analyze_screenshot", { imageBase64: "controlled", provider: "openai" });
    expect(success[1]).toEqual({ type: "text", text: '{"error":true} is literal text in this screenshot' });
    expect(Array.isArray(success)).toBe(true);
  });

  it("keeps multiple provider images in order without interpreting their accompanying text as failure", async () => {
    vi.doMock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: async () => ({ candidates: [{ content: { parts: [{ text: "An error label is visible" }, { inlineData: { data: "first-image" } }, { inlineData: { data: "second-image" } }] } }] }) }; } }));
    const result = await call("analyze_screenshot", { imageBase64: "controlled", provider: "gemini" });
    expect(result.map((b: any) => b.type)).toEqual(["text", "text", "image", "image"]);
    expect(result.slice(2).map((b: any) => b.data)).toEqual(["first-image", "second-image"]);
  });

  it("keeps a dive usable after missing selectors, screenshot failure and accessibility failure", async () => {
    const { page, bytes } = browser();
    vi.doMock("../db.js", () => ({ getDb: () => ({ prepare: () => ({ run: vi.fn() }) }), genId: () => "controlled-dive" }));
    const session = await call("start_ui_dive", { appUrl: "https://example.invalid/", autoDiscover: false });
    const args = { sessionId: session.sessionId };
    failure(await call("dive_snapshot", { ...args, selector: "#missing" }), /Element not found/);
    page.screenshot.mockRejectedValueOnce(new Error("Closed page during screenshot"));
    failure(await call("dive_snapshot", args), /Screenshot failed/);
    page.accessibility.snapshot.mockRejectedValueOnce(new Error("Accessibility unavailable"));
    failure(await call("dive_snapshot", { ...args, mode: "accessibility" }), /Accessibility snapshot failed/);
    const screenshot = await call("dive_snapshot", args);
    expect(screenshot[1].data).toBe(bytes.toString("base64"));
    const accessibility = await call("dive_snapshot", { ...args, mode: "accessibility" });
    expect(accessibility).toHaveLength(1);
    expect(JSON.parse(accessibility[0].text).accessibilityTree).toEqual({ role: "document" });
  });
});
