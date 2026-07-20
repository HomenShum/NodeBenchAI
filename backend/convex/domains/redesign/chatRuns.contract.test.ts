/**
 * Answer-packet state-schema executor — the L3 "verifiable meaning" layer of
 * the UI contract (docs/design/ui-contract/surfaces/decision-workspace.contract.json,
 * `answerPacket` section).
 *
 * The contract declares, per response shape x evidence support, which packet
 * fields MUST be present, which must NEVER leak, and which markers honesty
 * requires. This test drives the declarations through the REAL runtime
 * functions (detectRequestedResponseShape + applyDeterministicResponsePolicy),
 * so the contract cannot silently disagree with the code that ships. Compact
 * shapes render compact precisely because forbidden fields are empty
 * (isCompactResponse in ChatSurface + ReproducibleChatPage) — a forbid
 * violation here is a rendered UX regression, not a data nit.
 *
 * Scenario coverage (per .claude/rules/scenario_testing.md): an analyst
 * issuing every explicit-shape constraint, once against a URL-grounded run
 * (supported) and once against a cached-label-only run (unsupported — the
 * exact degradation the 2026-07-16 production audit exercised).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  applyDeterministicResponsePolicy,
  detectRequestedResponseShape,
  type ParsedMemo,
} from "./chatRuns";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(
  HERE, "..", "..", "..", "..",
  "proof", "ui-contract", "surfaces", "decision-workspace.contract.json",
);

interface FieldExpectations {
  require?: string[];
  forbid?: string[];
  requirePatterns?: Record<string, string[]>;
  forbidPatterns?: Record<string, string[]>;
  maxWords?: { field: string; count: number };
  lineCount?: { field: string; equals: number };
  parsesAs?: { field: string; format: "json" };
  riskRowPattern?: string;
}

interface PacketState {
  shape: string;
  prompt: string;
  rawText?: string;
  supported: FieldExpectations;
  unsupported: FieldExpectations;
}

const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as {
  answerPacket: { states: PacketState[] };
};

// Canonical memo the policy shapes down. Deliberately "rich" so leaks are
// detectable: every memo-only field is non-empty going in.
const RICH_MEMO: ParsedMemo = {
  shortAnswer:
    "Acme closed the round. [1] The filing lists twelve investors across three continents and two follow-on commitments.",
  whyItMatters: "The round resets the competitive baseline for the whole cohort.",
  risks: ["The rollout date may change."],
  nextAction: "Pin the strongest claim into the report.",
};

const SUPPORTED_EVIDENCE = [
  { idx: 1, source: "https://example.com/acme", quote: "Acme closed the round." },
];
// Cached section label with no URL — the audit's degradation case.
const UNSUPPORTED_EVIDENCE = [{ source: "Setup" }];

function fieldText(packet: ParsedMemo, field: string): string {
  const value = packet[field as keyof ParsedMemo];
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function assertExpectations(
  packet: ParsedMemo,
  spec: FieldExpectations,
  label: string,
) {
  for (const field of spec.require ?? []) {
    expect(fieldText(packet, field).trim(), `${label}: ${field} must be non-empty`).not.toBe("");
  }
  for (const field of spec.forbid ?? []) {
    expect(fieldText(packet, field).trim(), `${label}: ${field} must never leak into this shape`).toBe("");
  }
  for (const [field, patterns] of Object.entries(spec.requirePatterns ?? {})) {
    for (const pattern of patterns) {
      expect(fieldText(packet, field), `${label}: ${field} must match /${pattern}/`).toMatch(
        new RegExp(pattern),
      );
    }
  }
  for (const [field, patterns] of Object.entries(spec.forbidPatterns ?? {})) {
    for (const pattern of patterns) {
      expect(fieldText(packet, field), `${label}: ${field} must NOT match /${pattern}/`).not.toMatch(
        new RegExp(pattern),
      );
    }
  }
  if (spec.maxWords) {
    const words = fieldText(packet, spec.maxWords.field).trim().split(/\s+/).filter(Boolean);
    expect(words.length, `${label}: ${spec.maxWords.field} word budget`).toBeLessThanOrEqual(
      spec.maxWords.count,
    );
  }
  if (spec.lineCount) {
    const lines = fieldText(packet, spec.lineCount.field).split("\n").filter(Boolean);
    expect(lines.length, `${label}: ${spec.lineCount.field} line count`).toBe(spec.lineCount.equals);
  }
  if (spec.parsesAs?.format === "json") {
    expect(
      () => JSON.parse(fieldText(packet, spec.parsesAs!.field)),
      `${label}: ${spec.parsesAs.field} must be valid JSON`,
    ).not.toThrow();
  }
  if (spec.riskRowPattern) {
    const pattern = new RegExp(spec.riskRowPattern);
    expect(
      packet.risks.some((risk) => pattern.test(risk)),
      `${label}: a risks row matching /${spec.riskRowPattern}/ must surface the limitation`,
    ).toBe(true);
  }
}

describe("answer-packet state schemas (UI contract, L3)", () => {
  const states = contract.answerPacket.states;

  it("covers every declared response shape exactly once", () => {
    const shapes = states.map((s) => s.shape).sort();
    expect(new Set(shapes).size, "duplicate shape in contract").toBe(shapes.length);
    // The detector's union and the contract must enumerate the same shapes.
    expect(shapes).toEqual(
      ["bullets", "json", "memo", "paragraph", "sentence", "table", "title_only", "word_limit"].sort(),
    );
  });

  for (const state of states) {
    it(`${state.shape}: detector maps the canonical prompt to the declared shape`, () => {
      expect(detectRequestedResponseShape(state.prompt).kind).toBe(state.shape);
    });

    it(`${state.shape}: supported run satisfies the contract`, () => {
      const packet = applyDeterministicResponsePolicy(
        state.prompt, RICH_MEMO, SUPPORTED_EVIDENCE, state.rawText,
      );
      assertExpectations(packet, state.supported, `${state.shape}/supported`);
    });

    it(`${state.shape}: unsupported run degrades honestly per the contract`, () => {
      const packet = applyDeterministicResponsePolicy(
        state.prompt, RICH_MEMO, UNSUPPORTED_EVIDENCE, state.rawText,
      );
      assertExpectations(packet, state.unsupported, `${state.shape}/unsupported`);
    });
  }
});
