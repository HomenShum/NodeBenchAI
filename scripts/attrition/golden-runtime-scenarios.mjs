import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

// Actual CLI and HTTP, with controlled answers. This is runner regression proof,
// not a provider-quality evaluation. Temporary reports are retained for inspection.
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const loader = process.env.NODEBENCH_TEST_TSX ?? pathToFileURL(require.resolve('tsx')).href;
const golden = JSON.parse(await readFile(path.join(here, 'golden-queries.json'), 'utf8')).queries;

async function runtime(mode, run) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (requests.length >= 500) { res.writeHead(429).end(); return; }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16384) { res.writeHead(413).end(); return; }
    }
    const parsed = body ? JSON.parse(body) : null;
    requests.push({ method: req.method, path: req.url, body: parsed });
    const json = (status, data) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (req.url === '/api/pipeline/health') {
      if (mode === 'timeout') return;
      if (mode === 'redirect') { res.writeHead(302, { location: '/redirect-target' }).end(); return; }
      if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }).end('<html>Static frontend</html>'); return; }
      if (mode === 'oversized-health') { json(200, { padding: 'x'.repeat(65537) }); return; }
      json(200, { status: 'ok', pipeline: 'v2', components: { linkup: mode !== 'missing-provider', gemini: true } });
      return;
    }
    if (req.url !== '/api/pipeline/search') { json(404, { error: true }); return; }
    if (parsed?.query === '') {
      if (mode === 'wrong-post') { res.writeHead(405).end(); return; }
      json(400, { error: true, message: 'Query is required' }); return;
    }
    const query = golden.find(q => q.query === parsed?.query);
    if (!query) { json(400, { error: true, message: 'Unexpected test query' }); return; }
    if (mode === 'degraded' && query.id === golden[0].id) { json(503, { error: true }); return; }
    if (mode === 'oversized-answer' && query.id === golden[0].id) { json(200, { padding: 'x'.repeat(1048577) }); return; }
    json(200, { entityName: query.expectedEntity ?? 'Controlled scenario', confidence: 85, variables: [{ name: 'test' }], sourceRefs: [{}, {}, {}], ...(query.expectDCF ? { dcf: { controlled: true } } : {}) });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, requests); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

async function cli(url) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nodebench-pipeline-contract-'));
  await copyFile(path.join(here, 'run-golden-queries.ts'), path.join(dir, 'run-golden-queries.ts'));
  await copyFile(path.join(here, 'golden-queries.json'), path.join(dir, 'golden-queries.json'));
  // A blocked invocation must overwrite a previous successful local report.
  await writeFile(path.join(dir, 'golden-results.json'), '{"status":"completed","passRate":100,"stale":true}');
  const start = Date.now();
  const child = spawn(process.execPath, ['--import', loader, path.join(dir, 'run-golden-queries.ts')], {
    cwd: dir, windowsHide: true, env: { ...process.env, NODEBENCH_API_URL: url }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = chunk => { output += chunk; if (output.length > 100000) child.kill(); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const deadline = setTimeout(() => child.kill(), 20000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
  finally { clearTimeout(deadline); }
  await writeFile(path.join(dir, 'cli-output.log'), output);
  const report = JSON.parse(await readFile(path.join(dir, 'golden-results.json'), 'utf8'));
  assert.equal(report.stale, undefined, output);
  console.log(JSON.stringify({ evidence: dir, pid: child.pid, closed: true, exitCode: code, elapsedMs: Date.now() - start, status: report.status }));
  return { code, report, elapsedMs: Date.now() - start, output };
}

function blocked(result) {
  assert.equal(result.code, 1, result.output);
  assert.equal(result.report.status, 'blocked');
  assert.equal(result.report.failureKind, 'runtime_contract');
  assert.equal(result.report.plannedTotal, golden.length);
  assert.equal(result.report.notRun, golden.length);
  assert.equal(result.report.total, 0);
  assert.equal(result.report.passRate, null);
  assert.equal(result.report.avgConfidence, null);
  assert.equal(result.report.avgLatency, null);
  assert.deepEqual(result.report.results, []);
}

test('an evaluator gets a completed scorecard only after health and empty-query contracts pass', async () => {
  await runtime('healthy', async (url, requests) => {
    const { code, report } = await cli(url + '/');
    assert.equal(code, 0); assert.equal(report.status, 'completed');
    assert.equal(report.passed, golden.length); assert.equal(report.notRun, 0);
    assert.equal(requests.length, golden.length + 2);
    assert.equal(requests[0].path, '/api/pipeline/health');
    assert.equal(requests[1].body.query, '');
  });
});

for (const mode of ['html', 'wrong-post', 'missing-provider', 'oversized-health', 'redirect', 'timeout']) {
  test(`a developer targeting ${mode} gets no provider queries and no quality grade`, { timeout: 30000 }, async () => {
    await runtime(mode, async (url, requests) => {
      const result = await cli(url); blocked(result);
      assert.equal(requests.length, mode === 'wrong-post' ? 2 : 1);
      assert.equal(requests.filter(r => r.body?.query).length, 0);
      if (mode === 'wrong-post') assert.match(result.report.message, /HTTP 405/);
      if (mode === 'timeout') assert.ok(result.elapsedMs >= 9500 && result.elapsedMs < 18000);
    });
  });
}

for (const mode of ['degraded', 'oversized-answer']) {
  test(`an evaluator retains a real query failure when the service becomes ${mode} after preflight`, async () => {
    await runtime(mode, async (url, requests) => {
      const { code, report } = await cli(url);
      assert.equal(code, 1); assert.equal(report.status, 'completed');
      assert.equal(report.passed, golden.length - 1); assert.equal(report.total, golden.length);
      assert.equal(report.notRun, 0); assert.equal(requests.length, golden.length + 2);
      assert.match(report.results[0].failures[0], mode === 'degraded' ? /HTTP 503/ : /byte limit/);
    });
  });
}

test('parallel evaluators and repeated failed runs keep separate fresh reports without accumulating requests', async () => {
  await runtime('wrong-post', async (url, requests) => {
    const burst = await Promise.all(Array.from({ length: 4 }, () => cli(url)));
    burst.forEach(blocked);
    for (let i = 0; i < 8; i++) blocked(await cli(url));
    assert.equal(requests.length, 24);
    assert.ok(requests.every(r => !r.body?.query));
  });
});

test('operator URL mistakes cannot leak embedded credentials or initiate network requests', async () => {
  const marker = 'private-url-canary';
  for (const url of [`https://user:${marker}@example.invalid`, `https://example.invalid/?token=${marker}`, 'file:///tmp/pipeline']) {
    const result = await cli(url); blocked(result);
    assert.equal(result.report.apiUrl, null);
    assert.ok(!result.output.includes(marker));
    assert.ok(!JSON.stringify(result.report).includes(marker));
  }
});
