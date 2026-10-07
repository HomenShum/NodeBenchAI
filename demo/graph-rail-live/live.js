import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { GraphSession } from "../../vendor/nodegraph-live/index.js";
import { NodeGraph } from "../../vendor/nodegraph-live/react.js";

// The deployment URL comes from the page query (?deployment=https://...) so
// this file never hardcodes an environment. The functions are NodeBench's
// real backend — the same getEntityContext the product and its seed script
// use — subscribed reactively over the Convex WebSocket client.
const params = new URLSearchParams(location.search);
const DEPLOYMENT = params.get("deployment");
const status = document.querySelector("#status");
if (!DEPLOYMENT) {
  status.textContent = "missing ?deployment=<convex url>";
  throw new Error("deployment required");
}

const SEED_ENTITIES = [
  { entityName: "Anthropic", entityType: "company" },
  { entityName: "OpenAI", entityType: "company" },
  { entityName: "Google DeepMind", entityType: "company" },
  { entityName: "Sam Altman", entityType: "person" },
  { entityName: "Dario Amodei", entityType: "person" },
];

const session = new GraphSession({ maxNodes: 400, maxEdges: 900, maxSeen: 2000 });
const getEntityContext = makeFunctionReference(
  "domains/knowledge/entityContexts:getEntityContext",
);

const client = new ConvexClient(DEPLOYMENT);
let updates = 0;

for (const target of SEED_ENTITIES) {
  client.onUpdate(getEntityContext, target, (doc) => {
    updates += 1;
    if (doc) {
      // A real research context arrived from the live backend: the entity
      // lands (no measured count — research prose is not a measurement),
      // and each of its sources lands with a traversal edge. eventIds carry
      // the document identity so re-deliveries are idempotent.
      const entity = { kind: doc.entityType, label: doc.entityName };
      session.observe([entity], undefined, { eventId: `ctx:${doc._id}` });
      for (const [i, src] of (doc.sources ?? []).entries()) {
        session.observe(
          [entity, { kind: "source", label: src.name ?? src.url ?? `source ${i + 1}` }],
          undefined,
          { eventId: `src:${doc._id}:${i}` },
        );
      }
    }
    const s = session.getSnapshot();
    status.textContent =
      `live subscription updates: ${updates} · ${s.nodes.length} entities · ` +
      `${s.edges.length} edges — all traversal (nothing measured, nothing receipted)`;
    status.dataset.entities = String(s.nodes.length);
  });
}
status.textContent = `subscribed to ${SEED_ENTITIES.length} live queries on ${new URL(DEPLOYMENT).host}; waiting for data…`;
status.dataset.entities = "0";

function App() {
  const snap = useSyncExternalStore(
    (l) => session.subscribe(l),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );
  return React.createElement(NodeGraph, {
    nodes: snap.nodes,
    edges: snap.edges,
    height: 620,
    dark: true,
  });
}
createRoot(document.querySelector("#root")).render(React.createElement(App));
