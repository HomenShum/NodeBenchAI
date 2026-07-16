/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api, components } from "../../_generated/api";
import schema from "../../schema";
import { authorizeFastAgentStreamingRequest } from "./fastAgentPanelStreaming";
import agentComponentSchema from "../../../node_modules/@convex-dev/agent/dist/component/schema.js";

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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(
    ([key, loader]) => [rerootGlobKey(key), loader],
  ),
);
const agentComponentModules = import.meta.glob(
  "../../../node_modules/@convex-dev/agent/dist/component/**/*.js",
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

const streamingApi = (api as any).domains.agents.fastAgentPanelStreaming;
const agentComponentApi = (components as any).agent;
const paginationOpts = { cursor: null, numItems: 20 };

function createTestRuntime() {
  const t = convexTest(schema, convexModules);
  t.registerComponent("agent", agentComponentSchema, agentComponentModules);
  return t;
}

describe.skipIf(!convexTestAvailable)("FastAgent anonymous thread access", () => {
  it("links created documents only to the authenticated owner's agent thread", async () => {
    const t = createTestRuntime();
    const seeded = await t.run(async (ctx: any) => {
      const now = Date.now();
      const ownerA = await ctx.db.insert("users", { email: "stream-doc-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "stream-doc-b@example.com" });
      await ctx.db.insert("chatThreadsStream", {
        userId: ownerA,
        agentThreadId: "agent-thread-owner-a",
        title: "Owner A",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("chatThreadsStream", {
        userId: ownerB,
        agentThreadId: "agent-thread-owner-b",
        title: "Owner B",
        createdAt: now,
        updatedAt: now,
      });
      return { ownerA };
    });
    const ownerA = t.withIdentity({ subject: String(seeded.ownerA) });

    await expect(ownerA.mutation(streamingApi.createDocumentFromAgentContent, {
      title: "Foreign link attempt",
      content: "Must not be written.",
      threadId: "agent-thread-owner-b",
    })).rejects.toThrow(/not found|unauthorized/i);

    await expect(ownerA.mutation(streamingApi.createDocumentFromAgentContent, {
      title: "   ",
      content: "Long enough content",
      threadId: "agent-thread-owner-a",
    })).rejects.toThrow(/title cannot be empty/i);
    await expect(ownerA.mutation(streamingApi.createDocumentFromAgentContent, {
      title: "Too little content",
      content: "short",
      threadId: "agent-thread-owner-a",
    })).rejects.toThrow(/at least 10/i);
    await expect(ownerA.mutation(streamingApi.createDocumentFromAgentContent, {
      title: "x".repeat(501),
      content: "Long enough content",
      threadId: "agent-thread-owner-a",
    })).rejects.toThrow(/maximum length of 500/i);

    const documentId = await ownerA.mutation(streamingApi.createDocumentFromAgentContent, {
      title: "  Owned link  ",
      content: "  Persisted for the owner.  ",
      threadId: "agent-thread-owner-a",
    });
    const stored = await t.run(async (ctx: any) => ctx.db.get(documentId));
    expect(stored).toMatchObject({
      createdBy: seeded.ownerA,
      chatThreadId: "agent-thread-owner-a",
      title: "Owned link",
    });
    expect(stored.content).toContain('"text":"Persisted for the owner."');

    const documents = await t.run(async (ctx: any) => ctx.db.query("documents").collect());
    expect(documents).toHaveLength(1);
  }, 15_000);

  it("lists only threads owned by the supplied anonymous session", async () => {
    const t = createTestRuntime();
    await t.run(async (ctx: any) => {
      const now = Date.now();
      await ctx.db.insert("chatThreadsStream", {
        anonymousSessionId: "anon-a",
        title: "A older",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("chatThreadsStream", {
        anonymousSessionId: "anon-b",
        title: "B private",
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      await ctx.db.insert("chatThreadsStream", {
        anonymousSessionId: "anon-a",
        title: "A latest",
        createdAt: now + 2,
        updatedAt: now + 2,
      });
    });

    expect(await t.query(streamingApi.listThreads, { paginationOpts })).toMatchObject({
      page: [],
      isDone: true,
    });
    const sessionA = await t.query(streamingApi.listThreads, {
      anonymousSessionId: "anon-a",
      paginationOpts,
    });
    const sessionB = await t.query(streamingApi.listThreads, {
      anonymousSessionId: "anon-b",
      paginationOpts,
    });

    expect(sessionA.page.map((thread: any) => thread.title)).toEqual(["A latest", "A older"]);
    expect(sessionA.page.every((thread: any) => thread.anonymousSessionId === "anon-a")).toBe(true);
    expect(sessionB.page.map((thread: any) => thread.title)).toEqual(["B private"]);
  }, 15_000);

  it("allows guest cancellation only for the owning anonymous session", async () => {
    const t = createTestRuntime();
    const threadId = await t.run(async (ctx: any) => {
      const now = Date.now();
      return await ctx.db.insert("chatThreadsStream", {
        anonymousSessionId: "anon-a",
        title: "A active run",
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(t.mutation(streamingApi.requestStreamCancel, { threadId })).rejects.toThrow(/unauthorized/i);
    await expect(t.mutation(streamingApi.requestStreamCancel, {
      threadId,
      anonymousSessionId: "anon-b",
    })).rejects.toThrow(/unauthorized/i);
    expect(await t.mutation(streamingApi.requestStreamCancel, {
      threadId,
      anonymousSessionId: "anon-a",
    })).toEqual({ success: true });

    const stored = await t.run(async (ctx: any) => ctx.db.get(threadId));
    expect(stored.cancelRequested).toBe(true);
    expect(stored.cancelRequestedAt).toEqual(expect.any(Number));
  }, 15_000);

  it("mutates anonymous quota only after session ownership succeeds", async () => {
    const t = createTestRuntime();
    const wrongSessionThreadId = await t.run(async (ctx: any) => {
      const now = Date.now();
      return await ctx.db.insert("chatThreadsStream", {
        agentThreadId: "agent-thread-a",
        anonymousSessionId: "anon-a",
        title: "A private thread",
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(t.mutation(streamingApi.initiateAsyncStreaming, {
      threadId: wrongSessionThreadId,
      prompt: "Do not consume another session's quota",
      anonymousSessionId: "anon-b",
    })).rejects.toThrow(/session mismatch/i);
    expect(await t.query(streamingApi.getAnonymousUsage, { sessionId: "anon-b" })).toMatchObject({
      used: 0,
      remaining: 5,
    });

    const ownedThreadId = await t.run(async (ctx: any) => {
      const now = Date.now();
      return await ctx.db.insert("chatThreadsStream", {
        agentThreadId: "agent-thread-b",
        anonymousSessionId: "anon-b",
        title: "Owned guest thread",
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.run(async (ctx: any) => authorizeFastAgentStreamingRequest(ctx, {
      threadId: ownedThreadId,
      userId: null,
      anonymousSessionId: "anon-b",
    }));
    expect(await t.query(streamingApi.getAnonymousUsage, { sessionId: "anon-b" })).toMatchObject({
      used: 1,
      remaining: 4,
    });
  }, 30_000);

  it("allows guest deletion only for the owning anonymous session", async () => {
    const t = createTestRuntime();
    const agentThread = await t.mutation(agentComponentApi.threads.createThread, {
      title: "Guest disposable canonical thread",
    });
    const threadId = await t.run(async (ctx: any) => {
      const now = Date.now();
      return await ctx.db.insert("chatThreadsStream", {
        agentThreadId: String(agentThread._id),
        anonymousSessionId: "anon-a",
        title: "A disposable thread",
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(t.mutation(streamingApi.deleteThread, { threadId })).rejects.toThrow(/unauthorized/i);
    await expect(t.mutation(streamingApi.deleteThread, {
      threadId,
      anonymousSessionId: "anon-b",
    })).rejects.toThrow(/unauthorized/i);
    expect(await t.run(async (ctx: any) => ctx.db.get(threadId))).not.toBeNull();

    await expect(t.mutation(streamingApi.deleteThread, {
      threadId,
      anonymousSessionId: "anon-a",
    })).resolves.toMatchObject({ agentDeletionComplete: true, success: true });
    expect(await t.run(async (ctx: any) => ctx.db.get(threadId))).toBeNull();
    expect(await t.query(agentComponentApi.threads.getThread, {
      threadId: agentThread._id,
    })).toBeNull();
  }, 15_000);

  it("allows guest message deletion only for the owning anonymous session", async () => {
    const t = createTestRuntime();
    const seeded = await t.run(async (ctx: any) => {
      const now = Date.now();
      const threadId = await ctx.db.insert("chatThreadsStream", {
        agentThreadId: "agent-thread-a",
        anonymousSessionId: "anon-a",
        title: "A private thread",
        createdAt: now,
        updatedAt: now,
      });
      const messageId = await ctx.db.insert("chatMessagesStream", {
        threadId,
        role: "user",
        content: "Private guest prompt",
        status: "complete",
        createdAt: now,
        updatedAt: now,
      });
      return { messageId, threadId };
    });

    await expect(t.mutation(streamingApi.deleteMessage, {
      threadId: seeded.threadId,
      messageId: String(seeded.messageId),
    })).rejects.toThrow(/unauthorized/i);
    await expect(t.mutation(streamingApi.deleteMessage, {
      threadId: seeded.threadId,
      messageId: String(seeded.messageId),
      anonymousSessionId: "anon-b",
    })).rejects.toThrow(/unauthorized/i);
    expect(await t.run(async (ctx: any) => ctx.db.get(seeded.messageId))).not.toBeNull();

    await expect(t.mutation(streamingApi.deleteMessage, {
      threadId: seeded.threadId,
      messageId: String(seeded.messageId),
      anonymousSessionId: "anon-a",
    })).resolves.toBeNull();
    expect(await t.run(async (ctx: any) => ctx.db.get(seeded.messageId))).toBeNull();
  }, 15_000);

  it("deletes linked Agent component messages with their visible stream wrapper", async () => {
    const t = createTestRuntime();
    const agentThread = await t.mutation(agentComponentApi.threads.createThread, {
      title: "Guest message canonical thread",
    });
    const added = await t.mutation(agentComponentApi.messages.addMessages, {
      threadId: agentThread._id,
      messages: [{ message: { role: "user", content: "Delete both copies" } }],
    });
    const agentMessageId = added.messages[0]._id;
    const seeded = await t.run(async (ctx: any) => {
      const now = Date.now();
      const threadId = await ctx.db.insert("chatThreadsStream", {
        agentThreadId: String(agentThread._id),
        anonymousSessionId: "anon-a",
        title: "Linked message thread",
        createdAt: now,
        updatedAt: now,
      });
      const messageId = await ctx.db.insert("chatMessagesStream", {
        agentMessageId: String(agentMessageId),
        threadId,
        role: "user",
        content: "Delete both copies",
        status: "complete",
        createdAt: now,
        updatedAt: now,
      });
      return { messageId, threadId };
    });

    await expect(t.mutation(streamingApi.deleteMessage, {
      threadId: seeded.threadId,
      messageId: String(seeded.messageId),
      anonymousSessionId: "anon-a",
    })).resolves.toBeNull();
    expect(await t.run(async (ctx: any) => ctx.db.get(seeded.messageId))).toBeNull();
    expect(await t.query(agentComponentApi.messages.getMessagesByIds, {
      messageIds: [agentMessageId],
    })).toEqual([null]);
  }, 15_000);

  it("fails visibly and preserves the wrapper when Agent component ownership disagrees", async () => {
    const t = createTestRuntime();
    const ownedAgentThread = await t.mutation(agentComponentApi.threads.createThread, {
      title: "Expected canonical thread",
    });
    const otherAgentThread = await t.mutation(agentComponentApi.threads.createThread, {
      title: "Different canonical thread",
    });
    const added = await t.mutation(agentComponentApi.messages.addMessages, {
      threadId: otherAgentThread._id,
      messages: [{ message: { role: "user", content: "Must not cross threads" } }],
    });
    const agentMessageId = added.messages[0]._id;
    const seeded = await t.run(async (ctx: any) => {
      const now = Date.now();
      const threadId = await ctx.db.insert("chatThreadsStream", {
        agentThreadId: String(ownedAgentThread._id),
        anonymousSessionId: "anon-a",
        title: "Mismatched linked message thread",
        createdAt: now,
        updatedAt: now,
      });
      const messageId = await ctx.db.insert("chatMessagesStream", {
        agentMessageId: String(agentMessageId),
        threadId,
        role: "user",
        content: "Must not cross threads",
        status: "complete",
        createdAt: now,
        updatedAt: now,
      });
      return { messageId, threadId };
    });

    await expect(t.mutation(streamingApi.deleteMessage, {
      threadId: seeded.threadId,
      messageId: String(seeded.messageId),
      anonymousSessionId: "anon-a",
    })).rejects.toThrow(/does not belong to this thread/i);
    expect(await t.run(async (ctx: any) => ctx.db.get(seeded.messageId))).not.toBeNull();
    expect(await t.query(agentComponentApi.messages.getMessagesByIds, {
      messageIds: [agentMessageId],
    })).toEqual([expect.objectContaining({ _id: agentMessageId })]);
  }, 15_000);
});
