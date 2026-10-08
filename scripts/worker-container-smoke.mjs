// Run inside the built container with --network none and no provider credentials.
// This proves startup and rejection contracts, not provider answer quality.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

const base = 'http://127.0.0.1:3100';
async function request(route, options = {}) {
  const response = await fetch(base + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(1500) });
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) { await reader.cancel(); throw new Error('Smoke response exceeds64KiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8');
  let data = null;
  try { data = JSON.parse(text); } catch { /* Express malformed-JSON rejection may be HTML. */ }
  return { status: response.status, data };
}

const start = Date.now();
let ready = false;
let lastError = '';
for (let attempt = 0; attempt < 60 && Date.now() - start < 45000; attempt++) {
  try {
    const result = await request('/health');
    assert.equal(result.status, 200);
    assert.equal(result.data?.service, 'nodebench-server');
    assert.equal(result.data.status, 'ok');
    ready = true; break;
  } catch (error) { lastError = String(error).slice(0, 500); }
  await pause(500);
}
assert.ok(ready, `Worker did not become ready: ${lastError}`);

const mcp = await request('/mcp/health');
assert.equal(mcp.status, 200);
assert.equal(mcp.data.status, 'healthy');
assert.ok(mcp.data.tools.count > 0, 'A worker without loaded tools is not ready');
const pipeline = await request('/api/pipeline/health');
assert.equal(pipeline.status, 200);
assert.equal(pipeline.data.pipeline, 'v2');
assert.equal(pipeline.data.components.linkup, false);
assert.equal(pipeline.data.components.gemini, false);
console.log(JSON.stringify({ phase: 'startup-health', root: await request('/health'), mcp, pipeline }));

async function rejectEmpty(query) {
  const result = await request('/api/pipeline/search', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  });
  assert.equal(result.status, 400);
  assert.deepEqual(result.data, { error: true, message: 'Query is required' });
}
// Burst and repeated invalid requests must remain rejected before provider hooks.
await Promise.all(Array.from({ length: 12 }, (_, i) => rejectEmpty(i % 2 ? '   ' : '')));
for (let i = 0; i < 20; i++) await rejectEmpty('');
const malformed = await request('/api/pipeline/search', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
});
assert.equal(malformed.status, 400);
const after = await request('/mcp/health');
assert.equal(after.data.tools.count, mcp.data.tools.count);
assert.equal(after.data.sessions, 0);

for (const file of ['/app/.env', '/app/.env.local', '/app/packages/mcp-local/.mcpregistry_registry_token', '/app/packages/mcp-local/.mcpregistry_github_token']) {
  assert.equal(existsSync(file), false, `Credential path reached runtime image: ${file}`);
}
assert.equal(readFileSync('/app/.npmrc', 'utf8').trim(), 'legacy-peer-deps=true');
console.log(JSON.stringify({ status: 'PASS', node: process.version, service: 'nodebench-server', tools: mcp.data.tools.count, pipeline: 'v2', concurrentRejections: 12, repeatedRejections: 20, malformedJson: 400, linkupConfigured: pipeline.data.components.linkup, geminiConfigured: pipeline.data.components.gemini, requiredNetworkMode: 'none (verify externally with Docker inspect)', elapsedMs: Date.now() - start }));
