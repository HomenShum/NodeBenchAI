import assert from 'node:assert/strict';
import dns from 'node:dns';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// One frozen harness, identical bytes and budgets for both locked graphs.
const require = createRequire('/app/provider-http-study.mjs');
const utilsPath = require.resolve('@ai-sdk/provider-utils');
const consumerRequire = createRequire(utilsPath);
const undiciPath = consumerRequire.resolve('undici');
const undici = consumerRequire('undici'); // Real package; never mocked.
const { Agent, fetch, Response } = undici;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const originalLookup = dns.lookup;
const originalFetch = globalThis.fetch;
const results = [];
const sockets = new Set();
const MAX_RESULTS = 64, MAX_SOCKETS = 64, MAX_BODY = 65536;
let connections = 0, fixtureRequests = 0, wrapperCalls = 0;
let guardDnsCalls = 0;
const startedAt = new Date().toISOString();
const started = performance.now();
const wholeDeadline = setTimeout(() => { console.error('WHOLE_DEADLINE_90000MS'); process.exit(2); }, 90000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const boundedSignal = (ms = 1500) => AbortSignal.timeout(ms);
const agent = new Agent({ connections: 16, pipelining: 1, headersTimeout: 1500, bodyTimeout: 1500 });
const multipart = '--proof\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n--proof--\r\n';
const server = createServer((request, response) => {
  fixtureRequests++;
  const path = new URL(request.url, 'http://fixture.invalid').pathname;
  response.setHeader('x-study', 'actual-undici');
  if (path === '/redirect') { response.writeHead(302, { location: '/json' }); return response.end('redirect'); }
  if (path === '/loop') { response.writeHead(302, { location: '/loop' }); return response.end('loop'); }
  if (path === '/private-redirect') { response.writeHead(302, { location: 'http://127.0.0.1:1/private' }); return response.end('blocked'); }
  if (path === '/slow') { const timer = setTimeout(() => response.end('late'), 1000); response.on('close', () => clearTimeout(timer)); return; }
  if (path === '/stream') { response.write('first:'); const timer = setTimeout(() => response.end('second'), 20); response.on('close', () => clearTimeout(timer)); return; }
  if (path === '/cancel') { response.write('first'); const timer = setInterval(() => response.write('bounded'), 20); response.on('close', () => clearInterval(timer)); return; }
  if (path === '/multipart') { response.setHeader('content-type', 'multipart/form-data; boundary=proof'); return response.end(multipart); }
  if (path === '/malformed-multipart') { response.setHeader('content-type', 'multipart/form-data'); return response.end('missing boundary'); }
  if (path === '/prototype-multipart') { response.setHeader('content-type', 'multipart/form-data; boundary=proof'); return response.end('--proof\r\nContent-Disposition: form-data; name="field"\r\n__proto__: small fixture\r\n\r\nvalue\r\n--proof--\r\n'); }
  if (path === '/json') { response.setHeader('content-type', 'application/json'); return response.end(JSON.stringify({ ok: true, fixture: 'bounded' })); }
  response.end('bounded text');
});
server.on('connection', socket => {
  connections++;
  if (sockets.size >= MAX_SOCKETS) { socket.destroy(); return; }
  sockets.add(socket); socket.once('close', () => sockets.delete(socket));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const guardedUrl = `http://files.example.com:${server.address().port}/text`;

async function readBounded(response) {
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_BODY || chunks.length >= 64) throw new Error('BODY_CAP'); chunks.push(Buffer.from(value)); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(chunks).toString('utf8');
}
async function actual(path, init = {}) { return fetch(base + path, { dispatcher: agent, signal: boundedSignal(), ...init }); }
async function scenario(name, run, scope) {
  assert(results.length < MAX_RESULTS);
  const begin = performance.now();
  try { const observation = await run(); results.push({ name, scope, status: 'PASS', durationMs: performance.now() - begin, observation }); }
  catch (error) { results.push({ name, scope, status: 'FAIL', durationMs: performance.now() - begin, error: { name: error.name, message: error.message, causeName: error.cause?.name, causeMessage: error.cause?.message } }); }
}
function reloadUtils() { delete require.cache[utilsPath]; return require('@ai-sdk/provider-utils'); }
function workerMemory() {
  const text = readFileSync('/proc/1/status', 'utf8');
  const rss = text.match(/^VmRSS:\s+(\d+) kB$/m);
  let cgroupBytes = null; try { cgroupBytes = Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim()); } catch {}
  return { workerRssKiB: rss ? Number(rss[1]) : null, cgroupBytes, observer: process.memoryUsage() };
}
async function workerSnapshot() {
  const response = await fetch('http://127.0.0.1:3100/health', { dispatcher: agent, signal: boundedSignal() });
  assert.equal(response.status, 200);
  const health = JSON.parse(await readBounded(response));
  assert.equal(health.status, 'ok'); assert.equal(health.service, 'nodebench-server');
  const mcpResponse = await fetch('http://127.0.0.1:3100/mcp/health', { dispatcher: agent, signal: boundedSignal() });
  assert.equal(mcpResponse.status, 200);
  const mcp = JSON.parse(await readBounded(mcpResponse));
  assert.equal(mcp.status, 'healthy'); assert.equal(mcp.tools.count, 573); assert.equal(mcp.sessions, 0);
  const pipelineResponse = await fetch('http://127.0.0.1:3100/api/pipeline/health', { dispatcher: agent, signal: boundedSignal() });
  assert.equal(pipelineResponse.status, 200); const pipeline = JSON.parse(await readBounded(pipelineResponse));
  assert.equal(pipeline.pipeline, 'v2'); assert.equal(pipeline.components.linkup, false); assert.equal(pipeline.components.gemini, false);
  return { health, mcp, pipeline, memory: workerMemory() };
}
async function parseInChild(path) {
  const code = `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(utilsPath)});const u=r('undici');(async()=>{const response=await u.fetch(${JSON.stringify(base)}+process.argv[1],{signal:AbortSignal.timeout(1200)});try{const form=await response.formData();console.log(JSON.stringify({outcome:'parsed',entries:[...form.entries()].map(([k,v])=>[k,String(v)])}));}catch(e){console.log(JSON.stringify({outcome:'rejected',name:e.name,message:e.message}));}})().catch(e=>{console.error(e.stack);process.exitCode=2;});`;
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(['PATH', 'NODE_VERSION', 'YARN_VERSION'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const child = spawn(process.execPath, ['-e', code, path], { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '', bytes = 0, timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 2000);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', buffer => { bytes += buffer.length; if (bytes > MAX_BODY) { child.kill('SIGTERM'); return; } if (key === 'stdout') stdout += buffer; else stderr += buffer; });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => { clearTimeout(timeout); resolve({ exitCode, signal, timedOut, stdout, stderr }); });
  });
}

try {
  // Public default positive requires public egress and is deliberately not replaced by localhost trust.
  results.push({ name: 'default-guarded-public-success', scope: 'sdk-default-real-undici', status: 'NOT_VERIFIED', reason: 'Network-none isolation; localhost success would require bypassing the private-address guard.' });
  const dnsCases = {
    private: { addresses: [{ address: '127.0.0.1', family: 4 }], match: /disallowed IP address/ },
    mixed: { addresses: [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], match: /disallowed IP address/ },
    ipv6: { addresses: [{ address: '::1', family: 6 }], match: /disallowed IP address/ },
    empty: { addresses: [], match: /did not resolve to an address/ },
    error: { error: Object.assign(new Error('controlled DNS failure'), { code: 'ENOTFOUND' }), match: /controlled DNS failure/ },
  };
  for (const timing of ['before', 'after']) for (const entry of ['endpoint', 'redirects', 'forwarded-global']) for (const [kind, fixture] of Object.entries(dnsCases)) {
    await scenario(`sdk-default-${timing}-${entry}-${kind}`, async () => {
      globalThis.fetch = originalFetch;
      let lookupCalls = 0; const beforeConnections = connections; const beforeWrappers = wrapperCalls;
      dns.lookup = (hostname, options, callback) => { assert.equal(hostname, 'files.example.com'); assert.equal(options.all, true); lookupCalls++; guardDnsCalls++; queueMicrotask(() => callback(fixture.error ?? null, fixture.addresses)); };
      const wrapper = (input, init) => { wrapperCalls++; return originalFetch(input, init); };
      if (timing === 'before') globalThis.fetch = wrapper;
      const utils = reloadUtils();
      if (timing === 'after') globalThis.fetch = wrapper;
      let caught;
      try { if (entry === 'endpoint') await utils.fetchWithValidatedEndpoint({ url: guardedUrl, init: { signal: boundedSignal() } }); else await utils.fetchWithValidatedRedirects({ url: guardedUrl, abortSignal: boundedSignal(), fetch: entry === 'forwarded-global' ? globalThis.fetch : undefined }); }
      catch (error) { caught = error; }
      assert(caught, 'Guard must reject');
      assert.match(caught.cause?.message ?? caught.message, fixture.match);
      if (['private', 'mixed', 'ipv6'].includes(kind)) assert.equal(caught.cause?.name, 'AI_DownloadError');
      assert.equal(lookupCalls, 1); assert.equal(connections, beforeConnections); assert.equal(wrapperCalls, beforeWrappers);
      dns.lookup = originalLookup; globalThis.fetch = originalFetch;
      return { lookupCalls, allAddressesRequired: true, socketConnections: 0, globalWrapperCalls: 0, errorName: caught.name, causeName: caught.cause?.name, message: caught.cause?.message ?? caught.message };
    }, 'sdk-default-real-undici-dns-negative');
    dns.lookup = originalLookup; globalThis.fetch = originalFetch;
  }
  await scenario('sdk-default-literal-private-preflight', async () => {
    const before = connections; const utils = reloadUtils();
    await assert.rejects(utils.fetchWithValidatedEndpoint({ url: base + '/text', init: { signal: boundedSignal() } }));
    assert.equal(connections, before); return { socketConnections: 0 };
  }, 'sdk-default-url-negative');
  await scenario('direct-undici-json-headers', async () => { const response = await actual('/json'); assert.equal(response.status, 200); assert.equal(response.headers.get('x-study'), 'actual-undici'); const data = JSON.parse(await readBounded(response)); assert.deepEqual(data, { ok: true, fixture: 'bounded' }); return data; }, 'direct-real-undici-localhost');
  await scenario('direct-undici-text', async () => { assert.equal(await readBounded(await actual('/text')), 'bounded text'); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-stream', async () => { assert.equal(await readBounded(await actual('/stream')), 'first:second'); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-body-cancel-and-recovery', async () => { const response = await actual('/cancel'); const reader = response.body.getReader(); assert((await reader.read()).value.length > 0); await reader.cancel(); assert.equal(await readBounded(await actual('/text')), 'bounded text'); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-abort-and-recovery', async () => { await assert.rejects(actual('/slow', { signal: boundedSignal(40) })); assert.equal(await readBounded(await actual('/text')), 'bounded text'); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-follow-redirect', async () => { const response = await actual('/redirect'); assert.equal(response.status, 200); assert.equal(JSON.parse(await readBounded(response)).ok, true); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-manual-redirect', async () => { const response = await actual('/redirect', { redirect: 'manual' }); assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/json'); await readBounded(response); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-redirect-error-and-recovery', async () => { await assert.rejects(actual('/redirect', { redirect: 'error' })); assert.equal(await readBounded(await actual('/text')), 'bounded text'); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-redirect-loop-bound', async () => { await assert.rejects(actual('/loop')); assert.equal(await readBounded(await actual('/text')), 'bounded text'); }, 'direct-real-undici-localhost');
  await scenario('direct-undici-actual-response-multipart', async () => { const response = await actual('/multipart'); const form = await response.formData(); assert.equal(form.get('field'), 'value'); assert(response instanceof Response); }, 'direct-real-undici-localhost');
  for (const path of ['/malformed-multipart', '/prototype-multipart']) await scenario(`direct-undici-${path.slice(1)}-child-and-recovery`, async () => {
    const observation = await parseInChild(path);
    assert.equal(await readBounded(await actual('/text')), 'bounded text');
    assert.equal(observation.timedOut, false); assert.equal(observation.exitCode, 0); assert.equal(observation.signal, null);
    const outcome = JSON.parse(observation.stdout.trim());
    if (path === '/malformed-multipart') assert.equal(outcome.outcome, 'rejected');
    assert(['parsed', 'rejected'].includes(outcome.outcome));
    return { ...observation, recovery: true };
  }, 'direct-real-undici-small-malformed-http');
  await scenario('sdk-explicit-custom-fetch-separate', async () => { const utils = reloadUtils(); let calls = 0; const response = await utils.fetchWithValidatedEndpoint({ url: 'http://custom.example.com/text', fetch: (_url, init) => { calls++; return actual('/text', init); } }); assert.equal(await readBounded(response), 'bounded text'); assert.equal(calls, 1); return { calls, defaultGuardCoverage: false }; }, 'sdk-explicit-custom-branch');
  await scenario('sdk-configured-trusted-origin-separate', async () => { const utils = reloadUtils(); let calls = 0; globalThis.fetch = (input, init) => { calls++; return fetch(input, { ...init, dispatcher: agent, signal: boundedSignal() }); }; const response = await utils.fetchWithValidatedEndpoint({ url: base + '/text', trustedOrigin: base }); assert.equal(await readBounded(response), 'bounded text'); assert.equal(calls, 1); globalThis.fetch = originalFetch; return { calls, defaultGuardCoverage: false }; }, 'sdk-configured-trust-branch');
  await scenario('sdk-trusted-redirect-private-target-blocked', async () => { const utils = reloadUtils(); let calls = 0; globalThis.fetch = (input, init) => { calls++; return fetch(input, { ...init, dispatcher: agent, signal: boundedSignal() }); }; await assert.rejects(utils.fetchWithValidatedRedirects({ url: base + '/private-redirect', trustedOrigin: base, abortSignal: boundedSignal() })); assert.equal(calls, 1); globalThis.fetch = originalFetch; return { trustedFirstHop: true, untrustedPrivateSecondHopRequested: false, defaultGuardCoverage: false }; }, 'sdk-configured-trust-redirect-policy');
  await scenario('direct-undici-bounded-concurrent-burst', async () => { const before = fixtureRequests; const values = await Promise.all(Array.from({ length: 12 }, async (_, index) => { if (index % 3 === 0) return JSON.parse(await readBounded(await actual('/json'))).ok; if (index % 3 === 1) return (await readBounded(await actual('/stream'))) === 'first:second'; await assert.rejects(actual('/slow', { signal: boundedSignal(40) })); return (await readBounded(await actual('/text'))) === 'bounded text'; })); assert(values.every(Boolean)); return { clients: 12, actualFixtureRequests: fixtureRequests - before, maxSockets: MAX_SOCKETS }; }, 'direct-real-undici-burst');
  await scenario('same-image-worker-credential-free-health', workerSnapshot, 'worker-network-none-health');
  await scenario('direct-undici-and-worker-paced-60-seconds', async () => {
    const begin = performance.now(); const initial = await workerSnapshot(); const beforeRequests = fixtureRequests;
    let cycles = 0, recoveries = 0, negativeCases = 0, maxCycleMs = 0;
    while (performance.now() - begin < 60000) {
      const cycleStarted = performance.now();
      assert.equal(await readBounded(await actual('/text')), 'bounded text');
      const response = await actual('/cancel'); const reader = response.body.getReader(); await reader.read(); await reader.cancel();
      await assert.rejects(actual('/slow', { signal: boundedSignal(40) })); negativeCases++;
      assert.equal(JSON.parse(await readBounded(await actual('/json'))).ok, true); recoveries++;
      const responseInvalid = await fetch('http://127.0.0.1:3100/api/pipeline/search', { dispatcher: agent, signal: boundedSignal(), method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(responseInvalid.status, 400); assert.deepEqual(JSON.parse(await readBounded(responseInvalid)), { error: true, message: 'Query is required' });
      if (cycles % 5 === 0) await workerSnapshot();
      cycles++; maxCycleMs = Math.max(maxCycleMs, performance.now() - cycleStarted);
      await pause(Math.max(0, Math.min(1000 - (performance.now() - cycleStarted), 60000 - (performance.now() - begin))));
    }
    const final = await workerSnapshot();
    assert.equal(final.mcp.sessions, 0); assert(performance.now() - begin >= 60000); assert(performance.now() - begin < 65000); assert(cycles <= 64);
    return { durationMs: performance.now() - begin, cycles, recoveries, negativeCases, fixtureRequests: fixtureRequests - beforeRequests, maxCycleMs, initial, final, limit: 'One fixed 60-second paced observation; not a production SLA or long-term memory certificate.' };
  }, 'direct-real-undici-and-worker-60-second-observation');
} finally {
  dns.lookup = originalLookup; globalThis.fetch = originalFetch;
  await agent.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); clearTimeout(wholeDeadline);
}
const output = {
  proof: 'PIPELINE-PROVIDER-HTTP-SECURITY-01', startedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - started,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  sources: { providerUtils: { path: utilsPath, version: require('@ai-sdk/provider-utils/package.json').version, sha256: sha256(readFileSync(utilsPath)) }, undici: { path: undiciPath, version: consumerRequire('undici/package.json').version, sha256: sha256(readFileSync(undiciPath)) }, lockSha256: sha256(readFileSync('/app/package-lock.json')), harnessSha256: sha256(readFileSync('/app/actual-consumer-scenarios.mjs')) },
  bounds: { MAX_RESULTS, MAX_SOCKETS, MAX_BODY, defaultRequestBudgetMs: 1500, wholeDeadlineMs: 90000, providerQueries: 0 },
  totals: { pass: results.filter(x => x.status === 'PASS').length, fail: results.filter(x => x.status === 'FAIL').length, notVerified: results.filter(x => x.status === 'NOT_VERIFIED').length, scenarios: results.length, fixtureRequests, connections, guardDnsCalls }, results,
};
console.log(JSON.stringify(output, null, 2));
if (output.totals.fail) process.exitCode = 1;
