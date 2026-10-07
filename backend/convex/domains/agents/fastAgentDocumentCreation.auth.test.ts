/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { assertFastAgentDocumentThreadOwner } from "./fastAgentDocumentCreationOwnership";

const DIR_SEGMENTS = ["domains", "agents"];

function rerootGlobKey(key: string): string {
  const parts = key.replace(/^\.\//, "").split("/");
  const base = [...DIR_SEGMENTS];
  while (parts[0] === "..") {
    parts.shift();
    base.pop();
  }
  return [...base, ...parts].join("/");
}

const convexModules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(([key, loader]) => [
    rerootGlobKey(key),
    loader,
  ]),
);

let convexTest: any;
let convexTestAvailable = false;
try {
  const mod = await import(/* @vite-ignore */ "convex-test");
  convexTest = mod.convexTest;
  convexTestAvailable = typeof convexTest === "function";
} catch {
  convexTestAvailable = false;
}

const documentCreation = (internal as any).domains.agents.fastAgentDocumentCreation;

describe("FastAgent document thread ownership", () => {
  it("accepts only the exact authenticated thread owner", () => {
    expect(() => assertFastAgentDocumentThreadOwner("owner-a", "owner-a")).not.toThrow();
    expect(() => assertFastAgentDocumentThreadOwner("owner-a", "owner-b"))
      .toThrow(/not found|unauthorized/i);
    expect(() => assertFastAgentDocumentThreadOwner("owner-a", null))
      .toThrow(/not found|unauthorized/i);
  });

  it("checks ownership before invoking the Agent or reading thread messages", () => {
    const source = readFileSync(
      resolve(process.cwd(), "backend/convex/domains/agents/fastAgentDocumentCreation.ts"),
      "utf8",
    );
    const actionStart = source.indexOf("export const generateAndCreateDocument");
    const guardedSource = source.slice(actionStart);
    const guardIndex = guardedSource.indexOf("assertFastAgentDocumentThreadOwner(userId, threadUserId)");
    const agentIndex = guardedSource.indexOf("const agent = createDocumentGenerationAgent");
    const streamIndex = guardedSource.indexOf("await agent.streamText");
    const messageReadIndex = guardedSource.indexOf("components.agent.messages.listMessagesByThreadId");

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(agentIndex);
    expect(guardIndex).toBeLessThan(streamIndex);
    expect(guardIndex).toBeLessThan(messageReadIndex);
    expect(guardedSource).toContain("const agent = createDocumentGenerationAgent()");
    expect(guardedSource.slice(streamIndex, messageReadIndex)).toContain("userId");
    expect(guardedSource).not.toContain('threadId: args.threadId || "no-thread"');
  });
});

describe.skipIf(!convexTestAvailable)("FastAgent document creation-key ownership", () => {
  it("isolates identical creation keys by exact document owner", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "document-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "document-b@example.com" });
      const documentA = await ctx.db.insert("documents", {
        title: "Owner A document",
        createdBy: ownerA,
        isPublic: false,
        creationKey: "shared-creation-key",
      });
      const documentB = await ctx.db.insert("documents", {
        title: "Owner B document",
        createdBy: ownerB,
        isPublic: false,
        creationKey: "shared-creation-key",
      });
      return { ownerA, ownerB, documentA, documentB };
    });

    await expect(
      t.query(documentCreation.findByCreationKey, {
        creationKey: "shared-creation-key",
      } as any),
    ).rejects.toThrow();

    expect(await t.query(documentCreation.findByCreationKey, {
      creationKey: "shared-creation-key",
      userId: seeded.ownerA,
    })).toBe(seeded.documentA);
    expect(await t.query(documentCreation.findByCreationKey, {
      creationKey: "shared-creation-key",
      userId: seeded.ownerB,
    })).toBe(seeded.documentB);
  });
});
