import assert from "node:assert/strict";
import { decode, encode } from "@toon-format/toon";
import { describe, it } from "vitest";
import { decodeToon, encodeToon } from "../tools/toonCodec.js";
import { toonTools } from "../tools/toonTools.js";

const encodeTool = toonTools.find((tool) => tool.name === "toon_encode")!;
const decodeTool = toonTools.find((tool) => tool.name === "toon_decode")!;
const marker = "toonSecurityProofMarker";

function auditRecord(id: string) {
  return JSON.parse(`{"id":${JSON.stringify(id)},"__proto__":{"kept":true},"constructor":{"prototype":{"kept":true}},"prototype":{"kept":true},"rows":[{"tool":"search","ok":true},{"tool":"review","ok":false}]}`);
}

async function toolRoundTrip(value: unknown) {
  const encoded = await encodeTool.handler({ data: value }) as { error?: boolean; toon: string };
  assert.equal(encoded.error, undefined);
  assert.equal(encoded.toon, encode(value));
  const decoded = await decodeTool.handler({ toon: encoded.toon }) as { error?: boolean; format?: string; data?: unknown };
  assert.equal(decoded.error, undefined);
  assert.equal(decoded.format, "json");
  assert.deepEqual(decoded.data, value);
  return encoded.toon as string;
}

describe("an operator safely exchanges audit results through the real TOON codec", () => {
  it("round-trips nested, mixed, tabular and empty results through wrappers and tool handlers", async () => {
    const values = [
      null, false, 0, "quoted \"text\"\nnext line", [], {}, { empty: {} },
      { rows: [{ id: 1, ok: true }, { id: 2, ok: false }] },
      { items: [{ nested: { id: 1 }, tags: ["a", "b"] }, { extra: true }] },
      { items: [{ users: [{ id: 1, name: "Ada" }, { id: 2, name: "Bob" }], status: "active" }] },
      { items: [{ users: [{ id: 1 }, { id: 2 }] }] },
      { items: [null, 7, "text", { id: 4 }, [true, false]], empty: [] },
    ];
    for (const value of values) {
      const wire = await encodeToon(value);
      assert.equal(wire, encode(value));
      assert.deepEqual(await decodeToon(wire), value);
      await toolRoundTrip(value);
    }
    // This cannot be satisfied by the optional JSON fallback.
    assert.equal(await encodeToon({ proof: "sdk" }), "proof: sdk");
    assert.deepEqual(await decodeToon("proof: sdk"), { proof: "sdk" });
  });

  it("accepts the SDK's valid empty-string representation of an empty audit record", async () => {
    assert.equal(await encodeToon({}), "");
    assert.deepEqual(await decodeToon(""), {});
    assert.equal(await toolRoundTrip({}), "");
  });

  it("preserves special keys as own data without changing the runtime prototype", async () => {
    const value = auditRecord("special-keys");
    await toolRoundTrip(value);
    for (const wire of [
      "__proto__:\n  kept: true\nconstructor:\n  prototype:\n    kept: true\nprototype: ordinary",
      '"__proto__":\n  kept: true',
      "rows[1]{__proto__,constructor,prototype}:\n  ordinary,constructor,prototype",
    ]) {
      const decoded: any = await decodeToon(wire);
      const object = decoded.rows ? decoded.rows[0] : decoded;
      assert.equal(Object.hasOwn(object, "__proto__"), true);
      assert.equal(Object.getPrototypeOf(object), Object.prototype);
      assert.equal(Object.hasOwn(Object.prototype, "kept"), false);
    }
  });

  it("does not call the inherited prototype setter while encoding caller-owned keys", () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!;
    let setterCalls = 0;
    let wire: string;
    try {
      Object.defineProperty(Object.prototype, "__proto__", {
        ...original,
        set() { setterCalls += 1; },
      });
      wire = encode(JSON.parse('{"__proto__":{"kept":true},"id":"encoder"}'));
    } finally {
      Object.defineProperty(Object.prototype, "__proto__", original);
    }
    assert.equal(setterCalls, 0);
    assert.deepEqual(decode(wire!), JSON.parse('{"__proto__":{"kept":true},"id":"encoder"}'));
  });

  it("keeps dotted prototype keys local when another SDK caller requests safe expansion", () => {
    assert.equal(Object.hasOwn(Object.prototype, marker), false);
    try {
      const value: any = decode(`audit.__proto__.${marker}: local`, { expandPaths: "safe" });
      assert.equal(Object.hasOwn(Object.prototype, marker), false);
      assert.equal(Object.hasOwn(value.audit, "__proto__"), true);
      assert.equal(value.audit.__proto__[marker], "local");
    } finally {
      // A vulnerable baseline runs only in an isolated subprocess; restore its test marker.
      Reflect.deleteProperty(Object.prototype, marker);
    }
  });

  it("returns explicit handler errors for malformed JSON, missing input and truncated TOON", async () => {
    for (const args of [{}, { jsonString: "{" }]) {
      assert.equal((await encodeTool.handler(args) as { error?: boolean }).error, true);
    }
    for (const args of [{}, { toon: null }, { toon: 0 }, { toon: false }, { toon: [] }, { toon: "items[2]:\n  - first" }]) {
      assert.equal((await decodeTool.handler(args) as { error?: boolean }).error, true);
    }
  });

  it("keeps identities and special keys across 100 simultaneous and 1000 sustained handoffs", async () => {
    await Promise.all(Array.from({ length: 100 }, (_, index) => toolRoundTrip(auditRecord(`burst-${index}`))));
    for (let index = 0; index < 1000; index += 1) {
      await toolRoundTrip(auditRecord(`sustained-${index}`));
    }
    assert.equal(Object.hasOwn(Object.prototype, marker), false);
    assert.equal(Object.hasOwn(Object.prototype, "kept"), false);
  });
});
