/**
 * blockProsemirror.test.ts — verifies the ProseMirror <-> BlockChip bridge
 * preserves intent across both directions.
 *
 * Scenario: an agent appends content via the legacy BlockChip API; a user
 * edits the same block in the new Tiptap editor. On snapshot, the server
 * converts the Tiptap doc back to chips (`mirrorNotebookSnapshotIntoBlock`
 * in convex/domains/product/blockProsemirror.ts). If the converter drops
 * data, the Classic view (which reads .content) diverges silently.
 *
 * These tests lock the bridge's contract before the Tiptap editor lands.
 * They exercise the shared modules directly so the bridge can be verified
 * without a Convex runtime.
 */

import { describe, expect, it } from "vitest";
import {
  CHIP_STYLE_BOLD,
  CHIP_STYLE_CODE,
  CHIP_STYLE_ITALIC,
  chipsToProsemirrorDoc,
  prosemirrorDocToChips,
  type NotebookBlockChip,
} from "../../../shared/notebookBlockProsemirror";
import {
  buildProductBlockSyncId,
  parseProductBlockSyncId,
} from "../../../shared/productBlockSync";

function roundTrip(chips: NotebookBlockChip[]): NotebookBlockChip[] {
  const doc = chipsToProsemirrorDoc(chips);
  return prosemirrorDocToChips(doc);
}

describe("shared/notebookBlockProsemirror bridge", () => {
  it("preserves plain text across chip -> PM -> chip", () => {
    const chips: NotebookBlockChip[] = [{ type: "text", value: "hello world" }];
    const out = roundTrip(chips);
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((c) => c.value).join("")).toBe("hello world");
  });

  it("preserves styled text runs (bold + code)", () => {
    const chips: NotebookBlockChip[] = [
      { type: "text", value: "plain " },
      { type: "text", value: "bold", styles: CHIP_STYLE_BOLD },
      { type: "text", value: " ", styles: undefined },
      { type: "text", value: "code", styles: CHIP_STYLE_CODE },
    ];
    const out = roundTrip(chips);
    expect(out.map((c) => c.value).join("")).toBe(
      chips.map((c) => c.value).join(""),
    );
    expect(out.some((c) => (c.styles ?? 0) & CHIP_STYLE_BOLD)).toBe(true);
    expect(out.some((c) => (c.styles ?? 0) & CHIP_STYLE_CODE)).toBe(true);
  });

  it("preserves mentions with trigger + target", () => {
    const chips: NotebookBlockChip[] = [
      { type: "text", value: "see " },
      {
        type: "mention",
        value: "Acme AI",
        mentionTrigger: "@",
        mentionTarget: "acme-ai",
      },
    ];
    const out = roundTrip(chips);
    const mention = out.find((c) => c.type === "mention");
    expect(mention).toBeDefined();
    expect(mention?.value).toBe("Acme AI");
    expect(mention?.mentionTarget).toBe("acme-ai");
    expect(mention?.mentionTrigger).toBe("@");
  });

  it("preserves link url on link chips", () => {
    const chips: NotebookBlockChip[] = [
      { type: "text", value: "check " },
      { type: "link", value: "docs", url: "https://example.com/docs" },
      { type: "text", value: " for more" },
    ];
    const out = roundTrip(chips);
    const link = out.find((c) => c.type === "link");
    expect(link).toBeDefined();
    expect(link?.url).toBe("https://example.com/docs");
    expect(link?.value).toBe("docs");
  });

  it("preserves paragraph breaks via linebreak chips", () => {
    const chips: NotebookBlockChip[] = [
      { type: "text", value: "para one" },
      { type: "linebreak", value: "\n" },
      { type: "text", value: "para two" },
    ];
    const out = roundTrip(chips);
    expect(out.filter((c) => c.type === "text").length).toBe(2);
  });

  it("combines bold + italic into the same mark run", () => {
    const chips: NotebookBlockChip[] = [
      {
        type: "text",
        value: "bold italic",
        styles: CHIP_STYLE_BOLD | CHIP_STYLE_ITALIC,
      },
    ];
    const out = roundTrip(chips);
    const run = out.find((c) => c.type === "text");
    expect(run).toBeDefined();
    expect((run?.styles ?? 0) & CHIP_STYLE_BOLD).toBe(CHIP_STYLE_BOLD);
    expect((run?.styles ?? 0) & CHIP_STYLE_ITALIC).toBe(CHIP_STYLE_ITALIC);
  });

  it("returns a safe fallback for malformed doc (fail-open, never throws)", () => {
    // Shared module returns a single empty-text chip so renderers always
    // have at least one leaf to paint. The invariant we care about is
    // "never throws, never returns undefined".
    const empty = [{ type: "text", value: "" }];
    expect(prosemirrorDocToChips(null)).toEqual(empty);
    expect(prosemirrorDocToChips(undefined)).toEqual(empty);
    expect(prosemirrorDocToChips("not a doc")).toEqual(empty);
    // An empty object is still a valid object — the walker will return
    // whatever it walked (likely empty content, which gets the fallback).
    expect(prosemirrorDocToChips({})).toEqual(empty);
  });

  it("chipsToProsemirrorDoc returns a well-formed doc even for empty input", () => {
    const doc = chipsToProsemirrorDoc([]);
    expect((doc as { type: string }).type).toBe("doc");
    expect(Array.isArray((doc as { content?: unknown[] }).content)).toBe(true);
  });
});

describe("shared/productBlockSync id encoding", () => {
  it("roundtrips anonymous session + block id", () => {
    const encoded = buildProductBlockSyncId({
      blockId: "blk_ABC123" as unknown as string,
      anonymousSessionId: "anon-session-XYZ",
      shareToken: "ews_demo",
    });
    expect(typeof encoded).toBe("string");
    expect(encoded.startsWith("nbb")).toBe(true);

    const parsed = parseProductBlockSyncId(encoded);
    expect(parsed).not.toBeNull();
    expect(parsed?.blockId).toBe("blk_ABC123");
    expect(parsed?.anonymousSessionId).toBe("anon-session-XYZ");
    expect(parsed?.shareToken).toBe("ews_demo");
  });

  it("roundtrips authenticated (null anonymousSessionId) shape", () => {
    const encoded = buildProductBlockSyncId({
      blockId: "blk_456" as unknown as string,
      anonymousSessionId: null,
      shareToken: null,
    });
    const parsed = parseProductBlockSyncId(encoded);
    expect(parsed?.blockId).toBe("blk_456");
    expect(parsed?.anonymousSessionId).toBeNull();
    expect(parsed?.shareToken).toBeNull();
  });

  it("rejects malformed ids without throwing", () => {
    expect(parseProductBlockSyncId("")).toBeNull();
    expect(parseProductBlockSyncId("not-a-valid-sync-id")).toBeNull();
    expect(parseProductBlockSyncId("nbb:garbage")).toBeNull();
  });
});
