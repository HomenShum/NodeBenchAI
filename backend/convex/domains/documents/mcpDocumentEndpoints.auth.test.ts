/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";

const DIR_SEGMENTS = ["domains", "documents"];

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

const documentEndpoints = (internal as any).domains.documents.mcpDocumentEndpoints;

describe.skipIf(!convexTestAvailable)("MCP document read ownership", () => {
  it("requires the injected owner and denies cross-tenant document reads", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "mcp-doc-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "mcp-doc-b@example.com" });
      const documentId = await ctx.db.insert("documents", {
        title: "Owner A private document",
        isPublic: false,
        createdBy: ownerA,
        content: "owner-a-secret",
      });
      return { ownerA, ownerB, documentId };
    });

    await expect(
      t.query(documentEndpoints.mcpGetDocument, {
        documentId: seeded.documentId,
      } as any),
    ).rejects.toThrow();
    await expect(
      t.query(documentEndpoints.mcpGetDocument, {
        userId: seeded.ownerB,
        documentId: seeded.documentId,
      }),
    ).rejects.toThrow(/not found|unauthorized/i);

    const document = await t.query(documentEndpoints.mcpGetDocument, {
      userId: seeded.ownerA,
      documentId: seeded.documentId,
    });
    expect(document).toMatchObject({
      _id: seeded.documentId,
      createdBy: seeded.ownerA,
      content: "owner-a-secret",
    });
  });

  it("rejects foreign parents and keeps recursive archive state owner-scoped", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "mcp-tree-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "mcp-tree-b@example.com" });
      const rootId = await ctx.db.insert("documents", {
        title: "Owner A root",
        isPublic: false,
        isArchived: false,
        createdBy: ownerA,
      });
      const ownChildId = await ctx.db.insert("documents", {
        title: "Owner A child",
        parentId: rootId,
        isPublic: false,
        isArchived: false,
        createdBy: ownerA,
      });
      const foreignChildId = await ctx.db.insert("documents", {
        title: "Owner B linked child",
        parentId: rootId,
        isPublic: false,
        isArchived: false,
        createdBy: ownerB,
      });
      const foreignParentId = await ctx.db.insert("documents", {
        title: "Owner B parent",
        isPublic: false,
        isArchived: false,
        createdBy: ownerB,
      });
      return { ownerA, rootId, ownChildId, foreignChildId, foreignParentId };
    });

    await expect(
      t.mutation(documentEndpoints.mcpCreateDocument, {
        userId: seeded.ownerA,
        title: "Cross-tenant child",
        parentId: seeded.foreignParentId,
      }),
    ).rejects.toThrow(/not found|unauthorized/i);

    const ownCreatedId = await t.mutation(documentEndpoints.mcpCreateDocument, {
      userId: seeded.ownerA,
      title: "Owned child",
      parentId: seeded.rootId,
    });
    expect(await t.run((ctx: any) => ctx.db.get(ownCreatedId))).toMatchObject({
      createdBy: seeded.ownerA,
      parentId: seeded.rootId,
    });

    await t.mutation(documentEndpoints.mcpArchiveDocument, {
      userId: seeded.ownerA,
      id: seeded.rootId,
    });
    const archived = await t.run(async (ctx: any) => ({
      root: await ctx.db.get(seeded.rootId),
      ownChild: await ctx.db.get(seeded.ownChildId),
      foreignChild: await ctx.db.get(seeded.foreignChildId),
    }));
    expect(archived.root.isArchived).toBe(true);
    expect(archived.ownChild.isArchived).toBe(true);
    expect(archived.foreignChild.isArchived).toBe(false);

    await t.run((ctx: any) => ctx.db.patch(seeded.foreignChildId, { isArchived: true }));
    await t.mutation(documentEndpoints.mcpRestoreDocument, {
      userId: seeded.ownerA,
      id: seeded.rootId,
    });
    const restored = await t.run(async (ctx: any) => ({
      root: await ctx.db.get(seeded.rootId),
      ownChild: await ctx.db.get(seeded.ownChildId),
      foreignChild: await ctx.db.get(seeded.foreignChildId),
    }));
    expect(restored.root.isArchived).toBe(false);
    expect(restored.ownChild.isArchived).toBe(false);
    expect(restored.foreignChild.isArchived).toBe(true);
  });

  it("blocks folder-link laundering and filters legacy foreign links", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "mcp-folder-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "mcp-folder-b@example.com" });
      const folderId = await ctx.db.insert("folders", {
        name: "Owner A folder",
        color: "blue",
        userId: ownerA,
        createdAt: 1,
        updatedAt: 1,
      });
      const ownedDocumentId = await ctx.db.insert("documents", {
        title: "Owner A document",
        isPublic: false,
        isArchived: false,
        createdBy: ownerA,
      });
      const foreignDocumentId = await ctx.db.insert("documents", {
        title: "Owner B document",
        isPublic: false,
        isArchived: false,
        createdBy: ownerB,
      });
      await ctx.db.insert("documentFolders", {
        documentId: ownedDocumentId,
        folderId,
        userId: ownerA,
        addedAt: 1,
      });
      await ctx.db.insert("documentFolders", {
        documentId: foreignDocumentId,
        folderId,
        userId: ownerA,
        addedAt: 2,
      });
      return { ownerA, folderId, ownedDocumentId, foreignDocumentId };
    });

    await expect(
      t.mutation(documentEndpoints.mcpAddDocumentToFolder, {
        userId: seeded.ownerA,
        folderId: seeded.folderId,
        documentId: seeded.foreignDocumentId,
      }),
    ).rejects.toThrow(/not found|unauthorized/i);

    const folder = await t.query(documentEndpoints.mcpGetFolderWithDocuments, {
      userId: seeded.ownerA,
      folderId: seeded.folderId,
    });
    expect(folder.documents.map((document: any) => document._id)).toEqual([
      seeded.ownedDocumentId,
    ]);
  });

  it("denies cross-tenant and ownerless spreadsheet range reads", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "mcp-sheet-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "mcp-sheet-b@example.com" });
      const ownedSheetId = await ctx.db.insert("spreadsheets", {
        name: "Owner A sheet",
        userId: ownerA,
        createdAt: 1,
        updatedAt: 1,
      });
      const ownerlessSheetId = await ctx.db.insert("spreadsheets", {
        name: "Legacy ownerless sheet",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("sheetCells", {
        sheetId: ownedSheetId,
        row: 0,
        col: 0,
        value: "owner-a-secret",
        updatedAt: 1,
      });
      await ctx.db.insert("sheetCells", {
        sheetId: ownerlessSheetId,
        row: 0,
        col: 0,
        value: "ownerless-secret",
        updatedAt: 1,
      });
      return { ownerA, ownerB, ownedSheetId, ownerlessSheetId };
    });

    const range = {
      startRow: 0,
      endRow: 10,
      startCol: 0,
      endCol: 10,
    };
    await expect(
      t.query(documentEndpoints.mcpGetSpreadsheetRange, {
        sheetId: seeded.ownedSheetId,
        ...range,
      } as any),
    ).rejects.toThrow();
    await expect(
      t.query(documentEndpoints.mcpGetSpreadsheetRange, {
        userId: seeded.ownerB,
        sheetId: seeded.ownedSheetId,
        ...range,
      }),
    ).rejects.toThrow(/not found|unauthorized/i);
    await expect(
      t.query(documentEndpoints.mcpGetSpreadsheetRange, {
        userId: seeded.ownerA,
        sheetId: seeded.ownerlessSheetId,
        ...range,
      }),
    ).rejects.toThrow(/not found|unauthorized/i);

    const cells = await t.query(documentEndpoints.mcpGetSpreadsheetRange, {
      userId: seeded.ownerA,
      sheetId: seeded.ownedSheetId,
      ...range,
    });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      sheetId: seeded.ownedSheetId,
      value: "owner-a-secret",
    });
  });

  it("denies ownerless spreadsheet writes and preserves exact-owner writes", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "mcp-write-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "mcp-write-b@example.com" });
      const ownedSheetId = await ctx.db.insert("spreadsheets", {
        name: "Owner A writable sheet",
        userId: ownerA,
        createdAt: 1,
        updatedAt: 1,
      });
      const ownerlessSheetId = await ctx.db.insert("spreadsheets", {
        name: "Legacy ownerless sheet",
        createdAt: 1,
        updatedAt: 1,
      });
      return { ownerA, ownerB, ownedSheetId, ownerlessSheetId };
    });
    const operations = [{ op: "setCell", row: 0, col: 0, value: "owned-write" }];

    await expect(
      t.mutation(documentEndpoints.mcpApplySpreadsheetOperations, {
        userId: seeded.ownerA,
        sheetId: seeded.ownerlessSheetId,
        operations,
      }),
    ).rejects.toThrow(/not found|unauthorized/i);
    await expect(
      t.mutation(documentEndpoints.mcpApplySpreadsheetOperations, {
        userId: seeded.ownerB,
        sheetId: seeded.ownedSheetId,
        operations,
      }),
    ).rejects.toThrow(/not found|unauthorized/i);

    expect(
      await t.mutation(documentEndpoints.mcpApplySpreadsheetOperations, {
        userId: seeded.ownerA,
        sheetId: seeded.ownedSheetId,
        operations,
      }),
    ).toEqual({ applied: 1, errors: 0 });
    const cells = await t.run((ctx: any) =>
      ctx.db
        .query("sheetCells")
        .withIndex("by_sheet_row_col", (q: any) => q.eq("sheetId", seeded.ownedSheetId))
        .collect(),
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ value: "owned-write", updatedBy: seeded.ownerA });
  });
});

describe("MCP document dispatcher ownership guards", () => {
  it("injects the service owner into both direct read routes", () => {
    const source = readFileSync(
      resolve(process.cwd(), "backend/convex/domains/mcp/mcpGatewayDispatcher.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /mcpGetDocument:\s*\{[\s\S]*?mcpGetDocument,[\s\S]*?type:\s*"query",[\s\S]*?injectUserId:\s*true,[\s\S]*?\}/,
    );
    expect(source).toMatch(
      /mcpGetSpreadsheetRange:\s*\{[\s\S]*?mcpGetSpreadsheetRange,[\s\S]*?type:\s*"query",[\s\S]*?injectUserId:\s*true,[\s\S]*?\}/,
    );
  });
});
