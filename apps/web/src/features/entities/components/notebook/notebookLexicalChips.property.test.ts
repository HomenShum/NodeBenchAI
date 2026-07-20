/**
 * notebookLexicalChips.property.test.ts — Property-based roundtrip.
 *
 * The worst failure mode for an editor is SILENT data corruption: a user
 * types, hits save, the bytes persist, and next reload they read back a
 * *different* document with no error thrown. This test protects against that.
 *
 * Contract under test: for any legal BlockChip[], the pipeline
 *
 *   chips → buildNotebookEditorStateJson → parseEditorState → chipsFromLexicalEditorState → chips'
 *
 * must produce chips' structurally equal to the original (after the
 * normalization the writer always applies — adjacent same-style text chips
 * collapse into one, which is the canonical form).
 *
 * Scenario framing (per .claude/rules/scenario_testing.md):
 *   Persona:  any editor user typing a mix of text, mentions, links, breaks
 *   Scale:    100 randomly-shaped chip arrays, up to 20 chips each
 *   Duration: single roundtrip (each chip array is one save cycle)
 *   Failure:  any chip dropped, reordered, restyled, or mutated in value
 */

import { createEditor } from "lexical";
import { LinkNode } from "@lexical/link";
import { describe, expect, it } from "vitest";

import {
  STYLE_BOLD,
  STYLE_CODE,
  STYLE_ITALIC,
  STYLE_STRIKE,
  STYLE_UNDERLINE,
  type BlockChip,
} from "./BlockChipRenderer";
import { NotebookMentionNode } from "./NotebookMentionNode";
import {
  buildNotebookEditorStateJson,
  chipsFromLexicalEditorState,
} from "./notebookLexicalChips";

// Deterministic PRNG (mulberry32) so failures are reproducible.
function mulberry32(seed: number) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLE_BITS = [STYLE_BOLD, STYLE_ITALIC, STYLE_UNDERLINE, STYLE_STRIKE, STYLE_CODE];

const SAMPLE_WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
const SAMPLE_MENTIONS = [
  { value: "Dirk Xu", target: "dirk-xu" },
  { value: "Acme AI", target: "acme-ai" },
  { value: "SoftBank", target: "softbank" },
];
const SAMPLE_URLS = [
  "https://example.com",
  "https://example.com/path?q=1",
  "https://example.com/#hash",
];

function randomStyles(rand: () => number): number | undefined {
  // 40% of text runs have no style. Mixing multiple styles is legal.
  if (rand() < 0.4) return undefined;
  let mask = 0;
  for (const bit of STYLE_BITS) {
    if (rand() < 0.3) mask |= bit;
  }
  return mask || undefined;
}

function randomText(rand: () => number): string {
  const words = 1 + Math.floor(rand() * 4);
  const parts: string[] = [];
  for (let i = 0; i < words; i++) {
    parts.push(SAMPLE_WORDS[Math.floor(rand() * SAMPLE_WORDS.length)]);
  }
  return parts.join(" ");
}

function generateChips(seed: number, maxLen: number): BlockChip[] {
  const rand = mulberry32(seed);
  const len = 1 + Math.floor(rand() * maxLen);
  const chips: BlockChip[] = [];
  for (let i = 0; i < len; i++) {
    const roll = rand();
    if (roll < 0.55) {
      chips.push({ type: "text", value: randomText(rand), styles: randomStyles(rand) });
    } else if (roll < 0.75) {
      const m = SAMPLE_MENTIONS[Math.floor(rand() * SAMPLE_MENTIONS.length)];
      chips.push({
        type: "mention",
        value: m.value,
        mentionTrigger: "@",
        mentionTarget: m.target,
      });
    } else if (roll < 0.9) {
      chips.push({
        type: "link",
        value: randomText(rand),
        url: SAMPLE_URLS[Math.floor(rand() * SAMPLE_URLS.length)],
      });
    } else {
      chips.push({ type: "linebreak", value: "\n" });
    }
  }
  return chips;
}

function canonicalize(chips: BlockChip[]): BlockChip[] {
  // Apply the SAME normalization the writer does so "semantic equality" is
  // well-defined. The writer:
  //  - collapses adjacent text chips that have identical style
  //  - collapses adjacent link chips with identical url
  //  - normalizes styles=0 to styles=undefined
  const out: BlockChip[] = [];
  for (const chip of chips) {
    if (chip.type === "text") {
      const normalized: BlockChip = {
        type: "text",
        value: chip.value,
        styles: chip.styles && chip.styles > 0 ? chip.styles : undefined,
      };
      const prev = out[out.length - 1];
      if (prev?.type === "text" && (prev.styles ?? 0) === (normalized.styles ?? 0)) {
        prev.value += normalized.value;
      } else if (normalized.value.length > 0) {
        out.push(normalized);
      }
    } else if (chip.type === "link") {
      const prev = out[out.length - 1];
      if (prev?.type === "link" && prev.url === chip.url) {
        prev.value += chip.value;
      } else if (chip.value.length > 0) {
        out.push({ type: "link", value: chip.value, url: chip.url });
      }
    } else {
      out.push(chip);
    }
  }
  return out;
}

function roundTrip(chips: BlockChip[]): BlockChip[] {
  const json = buildNotebookEditorStateJson(chips);
  const editor = createEditor({ nodes: [LinkNode, NotebookMentionNode] });
  const editorState = editor.parseEditorState(JSON.stringify(json));
  editor.setEditorState(editorState);
  return chipsFromLexicalEditorState(editor.getEditorState());
}

describe("notebookLexicalChips — property-based roundtrip", () => {
  it("preserves any valid chip sequence across 100 random shapes", () => {
    // Normalize chip objects so property-order differences (e.g. writer emits
    // {value, target, trigger}, canonicalizer emits {trigger, target, value})
    // do not count as mismatches. Lexical's serializer may reorder keys.
    const normalizeChip = (chip: BlockChip) => {
      const obj: Record<string, unknown> = { type: chip.type, value: chip.value };
      if ("styles" in chip && chip.styles) obj.styles = chip.styles;
      if ("url" in chip && chip.url) obj.url = chip.url;
      if ("mentionTrigger" in chip && chip.mentionTrigger) {
        obj.mentionTrigger = chip.mentionTrigger;
      }
      if ("mentionTarget" in chip && chip.mentionTarget) {
        obj.mentionTarget = chip.mentionTarget;
      }
      return obj;
    };
    const normalize = (chips: BlockChip[]) => chips.map(normalizeChip);

    const failures: Array<{ seed: number }> = [];
    for (let seed = 1; seed <= 100; seed++) {
      const input = generateChips(seed, 20);
      const canonicalInput = normalize(canonicalize(input));
      const output = normalize(roundTrip(input));
      try {
        expect(output).toEqual(canonicalInput);
      } catch {
        failures.push({ seed });
      }
    }
    // If this ever fails, the first seed lets us reproduce locally:
    //   generateChips(<seed>, 20) to reconstruct the failing input.
    expect(failures).toEqual([]);
  });

  it("is idempotent: a second roundtrip is a no-op after the first", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const input = generateChips(seed, 15);
      const once = roundTrip(input);
      const twice = roundTrip(once);
      expect(twice).toEqual(once);
    }
  });

  it("never drops a mention chip or replaces it with plain text", () => {
    for (let seed = 200; seed <= 240; seed++) {
      const input = generateChips(seed, 10);
      const mentionsIn = input.filter((c) => c.type === "mention").length;
      const mentionsOut = roundTrip(input).filter((c) => c.type === "mention").length;
      expect(mentionsOut).toBe(mentionsIn);
    }
  });

  it("never drops a link chip or replaces it with plain text", () => {
    for (let seed = 300; seed <= 340; seed++) {
      const input = generateChips(seed, 10);
      const linksIn = input.filter((c) => c.type === "link").length;
      const linksOut = roundTrip(input).filter((c) => c.type === "link").length;
      expect(linksOut).toBeGreaterThanOrEqual(linksIn); // link collapse may merge adjacent same-url; count never drops
    }
  });
});
