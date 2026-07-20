/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import {
  extractJsonObjectCandidates,
  parseJsonObjectFromText,
  repairJsonishObject,
} from "./jsonObjectParser.js";

describe("jsonObjectParser", () => {
  it("parses valid JSON objects", () => {
    const result = parseJsonObjectFromText<{ entityName: string }>('{"entityName":"DISCO"}');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entityName).toBe("DISCO");
      expect(result.repaired).toBe(false);
    }
  });

  it("extracts fenced JSON even when prose surrounds it", () => {
    const result = parseJsonObjectFromText<{ answer: string }>(`
Here is the packet:
\`\`\`json
{"answer":"Ship the event brief","confidence":86}
\`\`\`
Done.
`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.answer).toBe("Ship the event brief");
    }
  });

  it("does not use greedy object matching across multiple objects", () => {
    const candidates = extractJsonObjectCandidates('first {"a":1} middle {"b":2}');
    const result = parseJsonObjectFromText<{ a: number }>('first {"a":1} middle {"b":2}');

    expect(candidates).toEqual(['{"a":1}', '{"b":2}']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 });
    }
  });

  it("keeps braces inside strings while finding the balanced object", () => {
    const result = parseJsonObjectFromText<{ evidenceQuote: string; score: number }>(
      'prefix {"evidenceQuote":"Use {cards} before paid search","score":91} suffix {"ignored":true}',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.evidenceQuote).toBe("Use {cards} before paid search");
      expect(result.value.score).toBe(91);
    }
  });

  it("repairs trailing commas outside strings", () => {
    const result = parseJsonObjectFromText<{ signals: Array<{ name: string }> }>(
      '{"signals":[{"name":"event corpus",},],"answer":"ok",}',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(true);
      expect(result.value.signals[0]?.name).toBe("event corpus");
      expect(result.repairNotes).toContain("removed trailing commas");
    }
  });

  it("repairs raw newlines inside strings", () => {
    const result = parseJsonObjectFromText<{ answer: string }>('{"answer":"line one\nline two"}');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(true);
      expect(result.value.answer).toBe("line one\nline two");
      expect(result.repairNotes).toContain("escaped control characters in strings");
    }
  });

  it("repairs adjacent array objects with a missing comma", () => {
    const result = parseJsonObjectFromText<{ signals: Array<{ name: string }> }>(
      '{"signals":[{"name":"event corpus"} {"name":"team memory"}]}',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(true);
      expect(result.value.signals.map((signal) => signal.name)).toEqual(["event corpus", "team memory"]);
      expect(result.repairNotes).toContain("inserted likely missing commas");
    }
  });

  it("does not treat comment markers inside URLs as comments", () => {
    const repaired = repairJsonishObject('{"href":"https://nodebench.workspace/w/ship-demo-day"}');

    expect(repaired.json).toBe('{"href":"https://nodebench.workspace/w/ship-demo-day"}');
    expect(repaired.notes).toEqual([]);
  });
});
