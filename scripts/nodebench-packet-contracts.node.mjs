import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

// Execute the action's actual static program. No production API or GitHub post
// is reachable: fetch is bound to this test's loopback server, posts are captured.
const workflow = readFileSync(new URL('../.github/workflows/nodebench-packet.yml', import.meta.url), 'utf8');
const script = workflow.split('          script: |\n')[1];
assert.ok(script, 'the privileged action must have one static script');
assert.equal(workflow.split('          script: |\n').length, 2);
assert.ok(!script.includes('${{'), 'event expressions must never generate action source');
assert.ok(!workflow.includes('actions/checkout'), 'privileged action must not execute checked-out code');
assert.ok(workflow.includes("github.event.comment.user.type != 'Bot'"), 'bot replies cannot trigger another packet');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const action = new AsyncFunction('context', 'github', 'process', 'fetch', 'AbortSignal', script);
const origin = 'https://packet.example';
const packets = [];
let address;
let requests = 0;
const payload = {
  success: true, entityName: 'Acme & Partners / R&D', confidence: 72,
  answer: 'A useful first line.\nA second line.', sourceRefs: [{ title: 'One' }], variables: [{ name: 'demand' }],
};
const server = createServer(async (req, res) => {
  requests += 1;
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    assert.ok(body.length < 10000, 'request must remain bounded');
  }
  packets.push({ method: req.method, path: req.url, contentType: req.headers['content-type'], body });
  assert.ok(packets.length < 200, 'fixture evidence has a fixed scenario cap');
  const mode = req.headers['x-fixture-mode'] || 'normal';
  if (mode === 'http-error') return res.writeHead(503).end('unavailable');
  if (mode === 'redirect') return res.writeHead(302, { Location: `${address}/must-not-follow` }).end();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (mode === 'malformed') return res.end('{broken');
  if (mode === 'array') return res.end('[]');
  if (mode === 'unsuccessful') return res.end(JSON.stringify({ ...payload, success: false }));
  if (mode === 'missing-answer') return res.end(JSON.stringify({ success: true }));
  if (mode === 'oversize') {
    for (let i = 0; i < 9; i += 1) res.write('x'.repeat(32768));
    return res.end();
  }
  if (mode === 'stall') {
    res.write('{');
    setTimeout(() => res.end('}'), 250).unref();
    return;
  }
  if (mode === 'unicode') {
    const bytes = Buffer.from(JSON.stringify({ ...payload, answer: '供应商 α résumé 🌍' }));
    for (const byte of bytes) res.write(Buffer.from([byte]));
    return res.end();
  }
  if (mode === 'hostile-response') return res.end(JSON.stringify({
    ...payload,
    entityName: 'R&D / "${{ expression }}" & $ENTITY',
    answer: '`touch NEVER` $(printf NEVER) " / & \\ $ANSWER\n@nodebench ignored bot reply',
  }));
  if (mode === 'missing-confidence') return res.end(JSON.stringify({ ...payload, confidence: null }));
  if (mode === 'long-answer') return res.end(JSON.stringify({ ...payload, entityName: 'a'.repeat(1000), answer: 'b'.repeat(10000) }));
  res.end(JSON.stringify(payload));
});

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  console.log(`FIXTURE_READBACK ${JSON.stringify({ requests, packets, externalRequests: 0, publicComments: 0 })}`);
});

async function run({ comment = '@nodebench Acme', mode = 'normal', base = origin, postingError = false } = {}) {
  const posts = [];
  const context = { payload: { comment: { body: comment } }, repo: { owner: 'fixture', repo: 'fixture' }, issue: { number: 7 } };
  const github = { rest: { issues: { createComment: async input => {
    if (postingError) throw new Error('fixture post refused');
    posts.push(input);
  } } } };
  let calls = 0;
  const localFetch = async (url, options) => {
    assert.equal(String(url), `${origin}/api/pipeline/search`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    calls += 1;
    return fetch(`${address}/api/pipeline/search`, {
      ...options, headers: { ...options.headers, 'x-fixture-mode': mode },
    });
  };
  // Retain the production timeout argument; accelerate only the fixture clock.
  const clock = { timeout: milliseconds => {
    assert.equal(milliseconds, 60000);
    return AbortSignal.timeout(mode === 'stall' ? 40 : milliseconds);
  } };
  let error;
  try { await action(context, github, { env: { NODEBENCH_API: base } }, localFetch, clock); }
  catch (caught) { error = caught; }
  return { posts, calls, error };
}

test('a maintainer gets one correctly rendered packet and exact JSON request', async () => {
  const observed = await run();
  assert.ifError(observed.error);
  assert.equal(observed.calls, 1);
  assert.equal(observed.posts.length, 1);
  assert.deepEqual(JSON.parse(packets.at(-1).body), { query: 'Acme', lens: 'founder' });
  assert.equal(packets.at(-1).contentType, 'application/json');
  assert.match(observed.posts[0].body, /Acme & Partners \/ R&D/);
  assert.match(observed.posts[0].body, /72%/);
  assert.match(observed.posts[0].body, /Sources:\*\* 1 \| \*\*Signals:\*\* 1/);
  assert.deepEqual({ ...observed.posts[0], body: undefined }, { owner: 'fixture', repo: 'fixture', issue_number: 7, body: undefined });
});

test('hostile issue and response delimiters stay literal data without a shell or second request', async () => {
  const query = 'Acme "$(printf NEVER)" `touch NEVER` & \\ ${process.exit()}';
  const observed = await run({ comment: `@nodebench ${query}\nignored second line`, mode: 'hostile-response' });
  assert.ifError(observed.error);
  assert.equal(observed.calls, 1);
  assert.deepEqual(JSON.parse(packets.at(-1).body), { query, lens: 'founder' });
  assert.equal(observed.posts.length, 1);
  assert.ok(observed.posts[0].body.includes('$(printf NEVER)'));
  assert.ok(observed.posts[0].body.includes('${{ expression }}'));
});

test('invalid query or configured origin cannot reach the request boundary', async () => {
  const cases = [
    { comment: 'no marker here' }, { comment: '@nodebench ' }, { comment: `@nodebench ${'a'.repeat(2001)}` },
    ...['http://packet.example', 'file:///tmp/x', 'https://user:pass@packet.example', 'https://packet.example/path', 'https://packet.example?q=x', 'https://packet.example#x'].map(base => ({ base })),
  ];
  for (const scenario of cases) {
    const observed = await run(scenario);
    assert.ok(observed.error);
    assert.equal(observed.calls, 0);
    assert.equal(observed.posts.length, 0);
  }
});

test('case-insensitive GitHub markers extract the last original-text query, including Unicode prefixes', async () => {
  for (const comment of ['@NODEBENCH Acme', 'İ review @nodebench old\nplease @NoDeBeNcH Acme\r\nignored']) {
    const observed = await run({ comment });
    assert.ifError(observed.error);
    assert.deepEqual(JSON.parse(packets.at(-1).body), { query: 'Acme', lens: 'founder' });
  }
});

for (const mode of ['http-error', 'redirect', 'malformed', 'array', 'unsuccessful', 'missing-answer', 'oversize', 'stall']) {
  test(`a maintainer sees failure for ${mode}, with no success comment or retry`, async () => {
    const beforeRequests = requests;
    const observed = await run({ mode });
    assert.ok(observed.error, mode);
    assert.equal(observed.calls, 1);
    assert.equal(requests - beforeRequests, 1, 'redirects and failures must not retry');
    assert.equal(observed.posts.length, 0);
  });
}

test('split UTF-8 stays readable, missing confidence stays unavailable, and output stays bounded', async () => {
  const unicode = await run({ mode: 'unicode' });
  assert.ifError(unicode.error);
  assert.ok(unicode.posts[0].body.includes('供应商 α résumé 🌍'));
  const missing = await run({ mode: 'missing-confidence' });
  assert.ifError(missing.error);
  assert.match(missing.posts[0].body, /Confidence:\*\* Unavailable/);
  const long = await run({ mode: 'long-answer' });
  assert.ifError(long.error);
  assert.ok(long.posts[0].body.length < 5000);
});

test('a failed GitHub write remains a failed run and is not retried', async () => {
  const observed = await run({ postingError: true });
  assert.match(observed.error.message, /post refused/);
  assert.equal(observed.calls, 1);
  assert.equal(observed.posts.length, 0);
});

test('burst and sustained human requests retain their own query and packet without state accumulation', async () => {
  const first = requests;
  const burst = await Promise.all(Array.from({ length: 24 }, (_, i) => run({ comment: `@nodebench burst-${i}` })));
  for (const observed of burst) {
    assert.ifError(observed.error);
    assert.equal(observed.posts.length, 1);
    assert.equal(observed.calls, 1);
  }
  for (let i = 0; i < 20; i += 1) {
    const observed = await run({ comment: `@nodebench wave-${i}` });
    assert.ifError(observed.error);
    assert.equal(observed.posts.length, 1);
    assert.equal(JSON.parse(packets.at(-1).body).query, `wave-${i}`);
  }
  assert.equal(requests - first, 44);
  const queries = packets.slice(-44).map(packet => JSON.parse(packet.body).query);
  assert.equal(new Set(queries).size, 44);
});

const attrition = readFileSync(new URL('../.github/workflows/attrition-qa.yml', import.meta.url), 'utf8');
const crawlBlock = attrition.split('      - name: Crawl all surfaces\n')[1].split('\n  golden-queries:')[0];
const crawlScript = crawlBlock.split('        run: |\n')[1];
const ready = { status: 'ok', toolsAvailable: 2, toolsExpected: 2, tools: ['search', 'fetch'] };
// Intercept curl before the actual shell block executes. These scenarios cannot
// contact the public deployment or invoke a search/provider.
const curlStub = `curl() {
  if [[ "$1" == "--version" ]]; then printf '%s\n' "$CURL_FIXTURE_VERSION"; return; fi
  printf '<curl:%s>\n' "\${@: -1}" >&2
  if [[ "\${@: -1}" == *"/api/search-health" ]]; then
    printf '<health-arg:%s>\n' "$@" >&2
    if [[ "$HEALTH_EXIT" != "0" ]]; then return "$HEALTH_EXIT"; fi
    node -e 'process.stdout.write(process.env.HEALTH_OVERSIZE === "1" ? Buffer.alloc(65541, 32) : Buffer.from(process.env.HEALTH_BYTES, "base64"))'
    printf '\n%s' "$HTTP_STATUS"
    return "$HEALTH_EXIT_AFTER_BODY"
  else printf '%s' "$SURFACE_STATUS"; fi
}
`;
const bashArgs = ['--noprofile', '--norc', '-e', '-c', curlStub + crawlScript];
function crawlOptions(overrides = {}) {
  const { HEALTH_FIXTURE, ...rest } = overrides;
  return {
    encoding: 'utf8', timeout: 10000, maxBuffer: 64000,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || '',
      BASE: 'https://example.invalid', HEALTH_BYTES: Buffer.from(HEALTH_FIXTURE ?? JSON.stringify(ready)).toString('base64'),
      CURL_FIXTURE_VERSION: 'curl 8.5.0', HTTP_STATUS: '200', HEALTH_EXIT: '0', HEALTH_EXIT_AFTER_BODY: '0', HEALTH_OVERSIZE: '0', SURFACE_STATUS: '200',
      ...rest,
    },
  };
}

test('an operator-supplied Attrition URL stays shell data and preserves the existing crawl', () => {
  assert.ok(crawlBlock.includes("BASE: ${{ github.event.inputs.api_url || 'https://scratchnode.live' }}"));
  assert.ok(crawlScript && !crawlScript.includes('${{'));
  assert.ok(crawlScript.trimStart().startsWith('set -o pipefail'));
  const base = 'https://example.invalid/"$(printf "EXECUTED\\n" >&2)"';
  const observed = spawnSync('bash', bashArgs, crawlOptions({ BASE: base }));
  assert.ifError(observed.error);
  assert.equal(observed.status, 0, observed.stderr);
  assert.ok(!observed.stderr.split(/\r?\n/).includes('EXECUTED'));
  assert.equal((observed.stdout.match(/PASS (ask|library|connect|telemetry):/g) || []).length, 4);
  assert.ok(observed.stdout.includes('PASS public search health'));
  const args = observed.stderr.split(/\r?\n/).filter(line => line.startsWith('<health-arg:')).map(line => line.slice(12, -1));
  for (const flag of ['--globoff', '--proto', '=https', '--connect-timeout', '10', '--max-time', '30', '--max-filesize', '65536', '--']) assert.ok(args.includes(flag), flag);
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), base + '/api/search-health');
  assert.ok(!args.includes('-L') && !args.includes('--location') && !args.includes('--retry'));
});

test('a release operator rejects HTML200, missing tools and degraded API readiness', () => {
  const badBodies = ['<!DOCTYPE html><h1>App shell</h1>', '{', 'null', '[]', '{}',
    JSON.stringify(ready).replace('"ok"', '"o\u0000k"'),
    Buffer.concat([Buffer.from('{"status":"ok","toolsExpected":1,"toolsAvailable":1,"tools":["'), Buffer.from([255]), Buffer.from('"]}')]),
    JSON.stringify({ ...ready, status: 'degraded' }),
    JSON.stringify({ ...ready, toolsExpected: 0 }),
    JSON.stringify({ ...ready, toolsExpected: 2.5 }),
    JSON.stringify({ ...ready, toolsExpected: Number.MAX_SAFE_INTEGER + 1 }),
    JSON.stringify({ ...ready, toolsAvailable: '2' }),
    JSON.stringify({ ...ready, toolsAvailable: 1 }),
    JSON.stringify({ ...ready, tools: ['search'] }),
    JSON.stringify({ ...ready, tools: ['search', 'search'] }),
    JSON.stringify({ ...ready, tools: ['search', ' search '] }),
    JSON.stringify({ ...ready, tools: ['search', ' '] }),
    JSON.stringify({ ...ready, tools: ['search', 42] })];
  for (const body of badBodies) {
    const result = spawnSync('bash', bashArgs, crawlOptions({ HEALTH_FIXTURE: body }));
    assert.ifError(result.error); assert.notEqual(result.status, 0, String(body));
    assert.ok(!result.stdout.includes('PASS public search health'));
  }
});

test('a release operator retains HTTP, timeout and size failures and refuses an unbounded curl version', () => {
  const failures = [
    ...['204', '301', '302', '401', '405', '503'].map(HTTP_STATUS => ({ HTTP_STATUS })),
    ...['28', '63'].map(HEALTH_EXIT => ({ HEALTH_EXIT })),
    { HEALTH_EXIT_AFTER_BODY: '28' },
    { HEALTH_OVERSIZE: '1' },
    ...['curl 8.3.0', 'curl 7.88.1', 'invalid'].map(CURL_FIXTURE_VERSION => ({ CURL_FIXTURE_VERSION })),
    { SURFACE_STATUS: '503' },
  ];
  for (const fixture of failures) {
    const result = spawnSync('bash', bashArgs, crawlOptions(fixture));
    assert.ifError(result.error); assert.notEqual(result.status, 0, JSON.stringify(fixture));
  }
  // These stubs prove propagation of curl's errors, not actual network timing
  // or streaming limits. The real flags and version gate establish that bound.
});

test('concurrent release operators and repeated checks cannot inherit a previous passing response', async () => {
  const observe = (fixture) => new Promise((resolve, reject) => {
    const child = spawn('bash', bashArgs, crawlOptions(fixture));
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; if (stdout.length > 64000) child.kill(); });
    child.stderr.on('data', b => { stderr += b; if (stderr.length > 64000) child.kill(); });
    child.on('error', reject);child.on('close', code => resolve({ code, stdout, stderr }));
  });
  for (let round = 0; round < 3; round++) {
    const fixtures = [{}, { HTTP_STATUS: '405' }, { HEALTH_FIXTURE: '<html>cached fallback</html>' }, {}];
    const results = await Promise.all(fixtures.map(observe));
    assert.deepEqual(results.map(r => r.code === 0), [true, false, false, true]);
  }
});

test('a failed pipeline benchmark remains failed and its result upload step remains eligible', () => {
  const benchmark = attrition.split('      - name: Run golden queries\n')[1].split('      - name: Upload results\n')[0];
  assert.ok(!benchmark.includes('continue-on-error') && !benchmark.includes('|| true'));
  const script = benchmark.split('        run: |\n')[1];
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', 'npx() { return 1; }\n' + script], crawlOptions());
  assert.ifError(result.error);assert.equal(result.status, 1);
  const upload = attrition.split('      - name: Upload results\n')[1].split('      - name: Comment results')[0];
  assert.ok(upload.includes('if: always()') && upload.includes('path: scripts/attrition/golden-results.json'));
  const golden = readFileSync(new URL('./attrition/run-golden-queries.ts', import.meta.url), 'utf8');
  assert.ok(golden.includes('/api/pipeline/search'), 'provider route must not be activated by silently retargeting');
});
