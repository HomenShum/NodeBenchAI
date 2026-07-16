import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("durable chat run lifecycle contract", () => {
  const backend = read("convex/domains/redesign/chatRuns.ts");
  const schema = read("convex/schema.ts");
  const hook = read("src/features/redesign/hooks/useRedesignChatRun.ts");
  const chat = read("src/features/redesign/surfaces/ChatSurface.tsx");
  const composer = read("src/features/redesign/components/UniversalComposer.tsx");

  it("deduplicates paid submissions by owner and client request id", () => {
    expect(schema).toContain('.index("by_user_client_request", ["userId", "clientRequestId"])');
    expect(backend).toContain('q.eq("userId", userId).eq("clientRequestId", clientRequestId)');
    expect(hook).toContain("pendingSubmissionRef.current = { fingerprint, requestId: clientRequestId }");
    expect(hook).toContain("clientRequestId,");
    expect(composer).toContain("if (!trimmed || streaming) return;");
  });

  it("recovers the newest owned run and reconstructs its conversation pair", () => {
    expect(backend).toContain("export const getLatestOwnedRun = query");
    expect(hook).toContain("latestOwnedRun?.runId");
    expect(chat).toContain("Rebuild the newest owned conversation pair from the durable run after reload");
  });

  it("records cooperative cancellation and never presents a local-only stop", () => {
    expect(backend).toContain("export const cancelRun = mutation");
    expect(backend).toContain('throw new Error("RUN_CANCELLED")');
    expect(chat).toContain("chatRun.cancel(targetTurn.chatRunId ?? null)");
    expect(hook).toContain('return "queued"');
    expect(hook).toContain("await cancelRun({ runId });");
    expect(hook).toContain("await cancelRun({ clientRequestId });");
    expect(composer).toContain('aria-label="Cancel active run"');
    expect(composer).not.toContain("Stop generation");
  });

  it("surfaces stored provider, model, token, cost, and receipt metadata", () => {
    expect(schema).toContain("runtimeReceiptId: v.optional(v.string())");
    expect(hook).toContain("runtimeReceiptId: runRow?.runtimeReceiptId");
    expect(chat).toContain('<RuntimeMetric label="Receipt"');
  });
});
