/**
 * Live graph rail fed by RECORDED research events.
 *
 * The fixture is a committed eval transcript: 24 persona-episode runs where the
 * NodeBench agent resolved real entities (DISCO Pharmaceuticals, Salesforce,
 * QuickJS, SoundCloud, ...) against ground truth. This module derives every
 * label VERBATIM from strings in that file and streams them through
 * `session.observe()`. Nothing is invented here:
 *
 *   - counts are always `undefined` — the transcript records resolved facts,
 *     not measured two-entity conjunction counts, so no edge may carry a
 *     magnitude;
 *   - `assertEdge` is never called — no record in the fixture carries the
 *     complete receipt (source + release + two stable ids + http(s) url) an
 *     assertion demands;
 *   - the capture script re-asserts that every rendered label is a literal
 *     substring of the fixture file.
 */
import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { GraphSession } from "../../vendor/nodegraph-live/index.js";
import { NodeGraph } from "../../vendor/nodegraph-live/react.js";

export const FIXTURE_URL =
  "../../benchmarks/history/archived-2026-q1/persona-episode-eval-pack-20260105-153100.json";

const session = new GraphSession({ maxNodes: 400, maxEdges: 900, maxSeen: 2000 });
window.__graphRail = { session, done: false, fixtureUrl: FIXTURE_URL };

const KIND_BY_ENTITY_TYPE = {
  private_company: "company",
  public_company: "company",
  private_company_incident: "company",
  oss_project: "project",
  model_platform: "product",
  research_signal: "topic",
};

/** Derive replay events from one recorded run. Labels are verbatim fixture strings. */
function eventsFromRun(run) {
  const d = run.debrief;
  if (!d || !d.entity || !d.entity.canonicalName) return [];
  const main = {
    kind: KIND_BY_ENTITY_TYPE[d.entity.type] ?? "topic",
    label: d.entity.canonicalName,
  };
  const events = [{ id: `${run.id}:entity`, entities: [main] }];
  const kf = d.keyFacts ?? {};
  const people = [kf.people?.ceo, ...(kf.people?.founders ?? [])].filter(
    (p) => typeof p === "string" && p.length > 0,
  );
  for (const p of new Set(people)) {
    events.push({ id: `${run.id}:person:${p}`, entities: [main, { kind: "person", label: p }] });
  }
  const platform = kf.product?.platform;
  if (typeof platform === "string" && platform.length > 0 && platform.length <= 60) {
    events.push({ id: `${run.id}:product`, entities: [main, { kind: "product", label: platform }] });
  }
  if (typeof kf.hqLocation === "string" && kf.hqLocation.length > 0) {
    events.push({ id: `${run.id}:place`, entities: [main, { kind: "place", label: kf.hqLocation }] });
  }
  for (const g of d.grounding ?? []) {
    if (typeof g !== "string" || g.length === 0) continue;
    // "{{fact:ground_truth:DISCO}}" -> "ground_truth:DISCO" (still a fixture substring).
    const m = /^\{\{fact:(.+)\}\}$/.exec(g);
    const label = m ? m[1] : g;
    // Long prose grounding notes are provenance text, not an entity; skip, never truncate.
    if (label.length > 60) continue;
    events.push({ id: `${run.id}:source:${label}`, entities: [main, { kind: "source", label }] });
  }
  return events;
}

function Rail() {
  const snapshot = useSyncExternalStore(
    (l) => session.subscribe(l),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );
  const stats = document.querySelector("#stats");
  if (stats) {
    stats.textContent =
      `${snapshot.nodes.length} entities · ${snapshot.edges.length} edges · ` +
      `${window.__graphRail.done ? "replay complete" : "replaying…"}`;
  }
  return React.createElement(NodeGraph, {
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    visits: session.visitsById(),
    height: 620,
    dark: true,
  });
}

const fixture = await (await fetch(FIXTURE_URL)).json();
const runs = fixture.result?.runs ?? [];
const events = runs.flatMap(eventsFromRun);

const caption = document.querySelector("#caption");
if (caption) {
  caption.textContent =
    `Fixture: benchmarks/history/archived-2026-q1/persona-episode-eval-pack-20260105-153100.json — ` +
    `${runs.length} recorded runs (model ${fixture.model}, generated ${fixture.generatedAt}, ` +
    `git ${String(fixture.gitSha).slice(0, 9)}) yielding ${events.length} observe() events. ` +
    `Facts shown are the agent's recorded output, replayed — not re-verified.`;
}

createRoot(document.querySelector("#root")).render(React.createElement(Rail));

// Stream in recorded order; stagger encodes arrival order only, never magnitude.
events.forEach((ev, i) => {
  setTimeout(() => {
    session.observe(ev.entities, undefined, { eventId: ev.id });
    if (i === events.length - 1) window.__graphRail.done = true;
  }, 150 + i * 90);
});
if (events.length === 0) window.__graphRail.done = true;
