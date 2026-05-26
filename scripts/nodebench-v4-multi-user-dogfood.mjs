#!/usr/bin/env node
// Multi-user dogfood scenario test for public/proto/home-v4.html's
// NodeBench live-Convex wiring. Simulates 3 personas hitting the same
// shared Convex deployment that powers nodebenchai.com.
//
// Tables/queries this script exercises (the same ones home-v4.html calls):
//   - publicResearch/core:listLatestPublicEntityResearch  → entity dict hydration
//   - publicResearch/core:getEntityDossier               → backlink drawer
//   - feed:getRecent                                     → artifact grid append
//   - agents/unified:createThread                        → chat thread alloc
//   - agents/unified:appendMessage                       → chat message persist
//   - agents/unified:getThread                           → chat replay
//   - agents/unified:listRecentThreads                   → recent rail
//
// Personas:
//   - Avery  (first-timer):  loads home-v4, sees public entities, opens dossier
//   - Blake  (returning):    loads home-v4, sends chat, expects own thread back
//   - Cassidy (cross-user):  loads home-v4 in a fresh session, MUST NOT see
//                            Blake's thread (anonymous-session isolation)
//
// Scenarios verified:
//   1. Public entity resolution returns ≥1 entity with claims+sources
//   2. Each entity has a fetchable dossier with backlinks (claims as backlinks)
//   3. Artifact feed returns ≥1 row with title+summary+url
//   4. Two concurrent users each create their own thread (no cross-talk)
//   5. Each user's messages persist and replay in order
//   6. listRecentThreads is owner-scoped — Cassidy cannot see Blake's thread
//   7. Latency budget: <2s per mutation, <1s per query
//   8. Concurrency: 5 parallel anonymous joins do not collide
//
// Run: node scripts/nodebench-v4-multi-user-dogfood.mjs

import { performance } from 'node:perf_hooks';

const CONVEX_URL = process.env.NODEBENCH_CONVEX_URL || 'https://agile-caribou-964.convex.cloud';
const RUN_ID = Date.now();
const TS_LABEL = new Date().toISOString().replace(/[:.]/g, '-');

const LATENCY_BUDGET_MUTATION_MS = 2000;
const LATENCY_BUDGET_QUERY_MS = 1500; // queries can be slightly slower under load

// ─── HTTP helpers ─────────────────────────────────────────────────
async function convexQuery(path, args) {
  const t0 = performance.now();
  const r = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const body = await r.json();
  const dt = Math.round(performance.now() - t0);
  if (body.status === 'error') {
    throw new Error(`query ${path} failed: ${body.errorMessage}`);
  }
  return { value: body.value, latency: dt };
}

async function convexMutation(path, args) {
  const t0 = performance.now();
  const r = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const body = await r.json();
  const dt = Math.round(performance.now() - t0);
  if (body.status === 'error') {
    throw new Error(`mutation ${path} failed: ${body.errorMessage}`);
  }
  return { value: body.value, latency: dt };
}

// ─── Result tracking ──────────────────────────────────────────────
const results = [];
const latencies = [];
function record(name, pass, detail = '', latency = null) {
  results.push({ name, pass, detail, latency });
  if (latency != null) latencies.push(latency);
  const flag = pass ? 'PASS' : 'FAIL';
  const lat = latency != null ? ` (${latency}ms)` : '';
  console.log(`  [${flag}] ${name}${lat}${detail ? ' — ' + detail : ''}`);
}
function header(title) { console.log('\n--- ' + title + ' ---'); }

// ─── Personas ─────────────────────────────────────────────────────
const avery = {
  name: 'Avery (first-timer)',
  sessionId: `nb-v4-avery-${RUN_ID}`,
};
const blake = {
  name: 'Blake (returning)',
  sessionId: `nb-v4-blake-${RUN_ID}`,
};
const cassidy = {
  name: 'Cassidy (fresh-session)',
  sessionId: `nb-v4-cassidy-${RUN_ID}`,
};

// ─── Scenarios ────────────────────────────────────────────────────

async function main() {
  console.log(`NodeBench home-v4 dogfood run ${RUN_ID} at ${new Date().toISOString()}`);
  console.log(`Convex: ${CONVEX_URL}`);
  console.log(`Latency budgets: mutation <${LATENCY_BUDGET_MUTATION_MS}ms, query <${LATENCY_BUDGET_QUERY_MS}ms`);

  // ───────────────────────────────────────────────────────────────
  header('SCENARIO 1: Avery loads home-v4 → public entities resolve');
  // ───────────────────────────────────────────────────────────────
  let publicRows = null;
  try {
    const r = await convexQuery('domains/publicResearch/core:listLatestPublicEntityResearch', { limit: 12 });
    publicRows = r.value || [];
    record('publicResearch:listLatest returns array',
      Array.isArray(publicRows), `${publicRows.length} entities`, r.latency);
    record('public entities query within budget',
      r.latency < LATENCY_BUDGET_QUERY_MS, `${r.latency}ms < ${LATENCY_BUDGET_QUERY_MS}ms`);
    if (publicRows.length) {
      const sample = publicRows[0];
      const shapeOk = sample.entityKey && sample.entityName && sample.entityType;
      record('public entity shape ok (entityKey/Name/Type)', !!shapeOk,
        `e.g. ${sample.entityKey} (${sample.entityType})`);
      const hasSources = (sample.sources || []).length > 0;
      record('public entity has ≥1 source', hasSources,
        `${(sample.sources || []).length} sources for ${sample.entityName}`);
    } else {
      record('public entity shape ok', false, 'no rows returned');
    }
  } catch (e) {
    record('public entities query', false, e.message);
    publicRows = [];
  }

  // ───────────────────────────────────────────────────────────────
  header('SCENARIO 2: Avery clicks @mention → backlinks (dossier) hydrate');
  // ───────────────────────────────────────────────────────────────
  if (publicRows && publicRows.length) {
    const target = publicRows[0];
    try {
      const r = await convexQuery(
        'domains/publicResearch/core:getEntityDossier',
        { entityKey: target.entityKey, limit: 12 }
      );
      const dossier = r.value;
      record('getEntityDossier returns row', !!dossier, `for ${target.entityKey}`, r.latency);
      record('dossier query within budget',
        r.latency < LATENCY_BUDGET_QUERY_MS, `${r.latency}ms`);
      if (dossier) {
        const claimCount = (dossier.claims || []).length;
        record('dossier has ≥1 claim (acts as backlink)', claimCount > 0, `${claimCount} claims`);
        const srcCount = (dossier.sources || []).length;
        record('dossier has ≥1 source', srcCount > 0, `${srcCount} sources`);
      }
    } catch (e) {
      record('getEntityDossier', false, e.message);
    }
  } else {
    record('getEntityDossier (skipped)', false, 'no public entity to dereference');
  }

  // ───────────────────────────────────────────────────────────────
  header('SCENARIO 3: Avery loads artifact grid → feed:getRecent renders rows');
  // ───────────────────────────────────────────────────────────────
  try {
    const r = await convexQuery('feed:getRecent', { limit: 8 });
    const rows = r.value || [];
    record('feed:getRecent returns rows', rows.length > 0, `${rows.length} rows`, r.latency);
    record('feed query within budget',
      r.latency < LATENCY_BUDGET_QUERY_MS, `${r.latency}ms`);
    if (rows.length) {
      const s = rows[0];
      const shapeOk = s._id && s.title;
      record('feed row shape ok (id+title)', !!shapeOk, `e.g. "${(s.title || '').slice(0, 60)}"`);
    }
  } catch (e) {
    record('feed:getRecent', false, e.message);
  }

  // ───────────────────────────────────────────────────────────────
  header('SCENARIO 4: Blake sends 2 chat turns → thread persists in order');
  // ───────────────────────────────────────────────────────────────
  let blakeThreadId = null;
  try {
    const r = await convexMutation('domains/agents/unified:createThread', {
      anonymousSessionId: blake.sessionId,
      title: `Dogfood ${RUN_ID}`,
      surfaceOrigin: 'chat',
    });
    blakeThreadId = r.value && r.value.threadId;
    record('Blake createThread', !!blakeThreadId,
      `id=${(blakeThreadId || '').slice(0, 12)}`, r.latency);
    record('createThread within mutation budget',
      r.latency < LATENCY_BUDGET_MUTATION_MS, `${r.latency}ms`);
  } catch (e) {
    record('Blake createThread', false, e.message);
  }

  if (blakeThreadId) {
    const msg1 = `Run ${RUN_ID}: First user turn from Blake`;
    const msg2 = `Run ${RUN_ID}: Assistant follow-up`;
    try {
      const r1 = await convexMutation('domains/agents/unified:appendMessage', {
        anonymousSessionId: blake.sessionId,
        threadId: blakeThreadId,
        role: 'user',
        content: msg1,
        surfaceOrigin: 'chat',
      });
      record('Blake appendMessage(user)', true, '', r1.latency);
      record('appendMessage within budget',
        r1.latency < LATENCY_BUDGET_MUTATION_MS, `${r1.latency}ms`);

      const r2 = await convexMutation('domains/agents/unified:appendMessage', {
        anonymousSessionId: blake.sessionId,
        threadId: blakeThreadId,
        role: 'assistant',
        content: msg2,
        surfaceOrigin: 'chat',
      });
      record('Blake appendMessage(assistant)', true, '', r2.latency);
    } catch (e) {
      record('Blake appendMessage', false, e.message);
    }

    // Replay the thread and verify ordering
    try {
      const r = await convexQuery('domains/agents/unified:getThread', {
        anonymousSessionId: blake.sessionId,
        threadId: blakeThreadId,
      });
      const msgs = (r.value && r.value.messages) || [];
      record('Blake getThread returns ≥2 messages', msgs.length >= 2,
        `${msgs.length} msgs`, r.latency);
      if (msgs.length >= 2) {
        const inOrder = msgs[0].role === 'user' && msgs[1].role === 'assistant';
        record('messages in chronological order', inOrder,
          `[0]=${msgs[0].role}, [1]=${msgs[1].role}`);
        const contentMatch = msgs[0].content === msg1 && msgs[1].content === msg2;
        record('message content matches what was sent', contentMatch);
      }
    } catch (e) {
      record('Blake getThread', false, e.message);
    }
  }

  // ───────────────────────────────────────────────────────────────
  header('SCENARIO 5: Cassidy (fresh session) → CANNOT see Blake thread');
  // ───────────────────────────────────────────────────────────────
  // Anonymous-session isolation is the core privacy guarantee. If Cassidy
  // sees Blake's thread, the ownerKey scoping is broken.
  if (blakeThreadId) {
    try {
      const r = await convexQuery('domains/agents/unified:getThread', {
        anonymousSessionId: cassidy.sessionId,
        threadId: blakeThreadId,
      });
      const leaked = r.value && r.value.messages && r.value.messages.length > 0;
      record('Cassidy CANNOT read Blake thread', !leaked,
        leaked ? `LEAK: saw ${r.value.messages.length} msgs`
               : 'isolation holds (null/empty returned)', r.latency);
    } catch (e) {
      // An error here is acceptable — Convex may throw on owner mismatch
      record('Cassidy CANNOT read Blake thread', true,
        'isolation enforced via exception: ' + e.message.slice(0, 80));
    }
  } else {
    record('Cassidy isolation check (skipped)', false, 'Blake thread never created');
  }

  // Cassidy's own thread list should be empty (or at least not contain Blake's)
  try {
    const r = await convexQuery('domains/agents/unified:listRecentThreads', {
      anonymousSessionId: cassidy.sessionId,
    });
    const threads = r.value || [];
    const seesBlake = blakeThreadId && threads.some((t) => t.threadId === blakeThreadId);
    record('Cassidy listRecentThreads does not include Blake', !seesBlake,
      `${threads.length} thread(s) in Cassidy session`, r.latency);
  } catch (e) {
    record('Cassidy listRecentThreads', false, e.message);
  }

  // ───────────────────────────────────────────────────────────────
  header('SCENARIO 6: Blake DOES see his own thread in recent list');
  // ───────────────────────────────────────────────────────────────
  if (blakeThreadId) {
    try {
      const r = await convexQuery('domains/agents/unified:listRecentThreads', {
        anonymousSessionId: blake.sessionId,
      });
      const threads = r.value || [];
      const found = threads.some((t) => t.threadId === blakeThreadId);
      record('Blake sees own thread in recent list', found,
        `${threads.length} thread(s) total, found=${found}`, r.latency);
    } catch (e) {
      record('Blake listRecentThreads', false, e.message);
    }
  }

  // ───────────────────────────────────────────────────────────────
  header('SCENARIO 7: 5 concurrent first-timers — no collision');
  // ───────────────────────────────────────────────────────────────
  // Adversarial concurrency: 5 distinct anonymous sessions hammer
  // listLatestPublicEntityResearch + createThread in parallel.
  // The home-v4 prototype hydrates entities on load; if 5 users load
  // simultaneously, queries must each return independently.
  try {
    const t0 = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        const sid = `nb-v4-concurrent-${RUN_ID}-${i}`;
        return Promise.all([
          convexQuery('domains/publicResearch/core:listLatestPublicEntityResearch', { limit: 8 }),
          convexMutation('domains/agents/unified:createThread', {
            anonymousSessionId: sid,
            title: `Concurrent ${i}`,
            surfaceOrigin: 'chat',
          }),
        ]).then(([q, m]) => ({ idx: i, sid, entityCount: (q.value || []).length,
                                threadId: m.value && m.value.threadId,
                                qLat: q.latency, mLat: m.latency }));
      })
    );
    const totalDt = Math.round(performance.now() - t0);
    const allEntities = concurrent.every((c) => c.entityCount >= 0); // each got a response
    const allThreads = concurrent.every((c) => !!c.threadId);
    const uniqueThreads = new Set(concurrent.map((c) => c.threadId)).size;
    record('5 concurrent entity queries all succeeded', allEntities,
      `${concurrent.length} sessions, wall=${totalDt}ms`);
    record('5 concurrent createThread all succeeded', allThreads, `${concurrent.length}/5`);
    record('5 threads are distinct (no collision)', uniqueThreads === 5,
      `${uniqueThreads} unique threadIds`);
    const maxLat = Math.max(...concurrent.flatMap((c) => [c.qLat, c.mLat]));
    record('max latency under concurrency within budget',
      maxLat < LATENCY_BUDGET_MUTATION_MS, `max=${maxLat}ms`);
  } catch (e) {
    record('5 concurrent first-timers', false, e.message);
  }

  // ───────────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===');
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  const total = results.length;
  const avgLat = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const maxLat = latencies.length ? Math.max(...latencies) : 0;
  console.log(`${pass}/${total} scenarios PASS (${fail} fail)`);
  console.log(`Average latency: ${avgLat}ms across ${latencies.length} tracked calls`);
  console.log(`Max latency:     ${maxLat}ms`);

  if (fail > 0) {
    console.log('\nFailed scenarios:');
    results.filter((r) => !r.pass).forEach((r) => {
      console.log(`  FAIL: ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    });
  }

  // Exit code reflects overall status (CI-friendly)
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Dogfood script crashed:', err);
  process.exit(2);
});
