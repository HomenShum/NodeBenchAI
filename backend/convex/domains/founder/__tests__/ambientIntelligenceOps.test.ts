import { describe, expect, it } from "vitest";

import {
  enqueueIngestion,
  getAttentionRequired,
  getObjectHistory,
  getPacketReadiness,
  getSessionDelta,
  markPacketGenerated,
  resolveChangeDetection,
} from "../ambientIntelligenceOps";

type TableRecord = Record<string, any>;
type Tables = Record<string, TableRecord[]>;

class MockIndexBuilder {
  constructor(private filters: Array<{ field: string; value: unknown }> = []) {}

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  getFilters() {
    return this.filters;
  }
}

class MockQueryChain {
  private orderDirection: "asc" | "desc" = "asc";

  constructor(
    private readonly rows: TableRecord[],
    private readonly filters: Array<{ field: string; value: unknown }>,
  ) {}

  order(direction: "asc" | "desc") {
    this.orderDirection = direction;
    return this;
  }

  async take(limit: number) {
    return this.getRows().slice(0, limit);
  }

  async first() {
    return this.getRows()[0] ?? null;
  }

  private getRows() {
    const filtered = this.rows.filter((row) =>
      this.filters.every(({ field, value }) => row[field] === value),
    );
    const sorted = [...filtered].sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      return this.orderDirection === "desc" ? right - left : left - right;
    });
    return sorted;
  }
}

class MockDb {
  public inserts: Array<{ table: string; value: TableRecord }> = [];
  public patches: Array<{ id: string; value: TableRecord }> = [];

  constructor(private readonly tables: Tables) {}

  async get(id: string) {
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }

  query(table: string) {
    const rows = this.tables[table] ?? [];
    return {
      withIndex: (_indexName: string, build: (builder: MockIndexBuilder) => MockIndexBuilder) => {
        const builder = build(new MockIndexBuilder());
        return new MockQueryChain(rows, builder.getFilters());
      },
    };
  }

  async insert(table: string, value: TableRecord) {
    const inserted = { _id: `${table}:${this.inserts.length + 1}`, ...value };
    this.inserts.push({ table, value: inserted });
    if (!this.tables[table]) this.tables[table] = [];
    this.tables[table].push(inserted);
    return inserted._id;
  }

  async patch(id: string, value: TableRecord) {
    this.patches.push({ id, value });
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) {
        Object.assign(row, value);
        return;
      }
    }
    throw new Error(`Missing row ${id}`);
  }
}

function sortValue(row: TableRecord) {
  return (
    row.detectedAt ??
    row.updatedAt ??
    row.createdAt ??
    row.extractedAt ??
    row.lastGeneratedAt ??
    0
  );
}

function createCtx(tables: Tables, subject = "user-1") {
  return {
    db: new MockDb(tables),
    auth: {
      getUserIdentity: async () => (subject ? { subject } : null),
    },
  };
}

describe("ambientIntelligenceOps auth boundaries", () => {
  it("blocks packet readiness reads across companies", async () => {
    const ctx = createCtx({
      founderWorkspaces: [{ _id: "workspace-1", ownerUserId: "user-1" }],
      founderCompanies: [{ _id: "company-1", workspaceId: "workspace-1" }],
      ambientPacketReadiness: [{ _id: "packet-1", companyId: "company-1", packetType: "weekly_reset" }],
    });

    await expect((getPacketReadiness as any)._handler(ctx, { companyId: "company-1" })).resolves.toEqual([
      { _id: "packet-1", companyId: "company-1", packetType: "weekly_reset" },
    ]);

    const foreignCtx = createCtx(
      {
        founderWorkspaces: [{ _id: "workspace-1", ownerUserId: "someone-else" }],
        founderCompanies: [{ _id: "company-1", workspaceId: "workspace-1" }],
        ambientPacketReadiness: [{ _id: "packet-1", companyId: "company-1", packetType: "weekly_reset" }],
      },
      "user-1",
    );

    await expect((getPacketReadiness as any)._handler(foreignCtx, { companyId: "company-1" })).rejects.toThrow(
      "Access denied",
    );
  });

  it("blocks session deltas for foreign companies", async () => {
    const ctx = createCtx(
      {
        founderWorkspaces: [{ _id: "workspace-1", ownerUserId: "owner-2" }],
        founderCompanies: [{ _id: "company-1", workspaceId: "workspace-1" }],
        ambientCanonicalObjects: [],
        ambientChangeDetections: [],
        ambientPacketReadiness: [],
        founderEventLedger: [],
      },
      "user-1",
    );

    await expect(
      (getSessionDelta as any)._handler(ctx, { companyId: "company-1", lastSessionEnd: 0 }),
    ).rejects.toThrow("Access denied");
  });

  it("scopes attention-required aggregation to the caller workspace", async () => {
    const ctx = createCtx({
      founderWorkspaces: [
        { _id: "workspace-1", ownerUserId: "user-1" },
        { _id: "workspace-2", ownerUserId: "user-2" },
      ],
      founderCompanies: [
        { _id: "company-1", workspaceId: "workspace-1" },
        { _id: "company-2", workspaceId: "workspace-2" },
      ],
      ambientChangeDetections: [
        { _id: "detection-1", companyId: "company-1", requiresAttention: true, detectedAt: 30 },
        { _id: "detection-2", companyId: "company-2", requiresAttention: true, detectedAt: 40 },
      ],
    });

    await expect((getAttentionRequired as any)._handler(ctx, { limit: 10 })).resolves.toEqual([
      { _id: "detection-1", companyId: "company-1", requiresAttention: true, detectedAt: 30 },
    ]);
  });

  it("blocks object history reads for foreign scoped objects", async () => {
    const ctx = createCtx(
      {
        founderWorkspaces: [{ _id: "workspace-1", ownerUserId: "owner-2" }],
        founderCompanies: [{ _id: "company-1", workspaceId: "workspace-1" }],
        ambientCanonicalObjects: [
          { _id: "object-1", companyId: "company-1", workspaceId: "workspace-1", supersedes: undefined },
        ],
      },
      "user-1",
    );

    await expect((getObjectHistory as any)._handler(ctx, { objectId: "object-1" })).rejects.toThrow("Access denied");
  });

  it("blocks packet reset writes for foreign companies", async () => {
    const ctx = createCtx(
      {
        founderWorkspaces: [{ _id: "workspace-1", ownerUserId: "owner-2" }],
        founderCompanies: [{ _id: "company-1", workspaceId: "workspace-1" }],
        ambientPacketReadiness: [
          {
            _id: "packet-1",
            companyId: "company-1",
            packetType: "weekly_reset",
            readinessScore: 0.9,
          },
        ],
      },
      "user-1",
    );

    await expect(
      (markPacketGenerated as any)._handler(ctx, { companyId: "company-1", packetType: "weekly_reset" }),
    ).rejects.toThrow("Access denied");
  });

  it("requires workspace-company alignment before enqueueing ingestion", async () => {
    const ctx = createCtx({
      founderWorkspaces: [
        { _id: "workspace-1", ownerUserId: "user-1" },
        { _id: "workspace-2", ownerUserId: "user-1" },
      ],
      founderCompanies: [{ _id: "company-1", workspaceId: "workspace-1" }],
      ambientIngestionQueue: [],
    });

    await expect(
      (enqueueIngestion as any)._handler(ctx, {
        sourceType: "chat",
        sourceProvider: "test",
        sourceRef: "session-1",
        rawContent: "hello",
        companyId: "company-1",
        workspaceId: "workspace-2",
      }),
    ).rejects.toThrow("Access denied");
  });

  it("blocks change-resolution writes for foreign detections", async () => {
    const ctx = createCtx(
      {
        founderWorkspaces: [{ _id: "workspace-1", ownerUserId: "owner-2" }],
        founderCompanies: [{ _id: "company-1", workspaceId: "workspace-1" }],
        ambientCanonicalObjects: [{ _id: "object-1", companyId: "company-1", workspaceId: "workspace-1" }],
        ambientChangeDetections: [
          { _id: "detection-1", objectId: "object-1", companyId: "company-1", requiresAttention: true },
        ],
      },
      "user-1",
    );

    await expect((resolveChangeDetection as any)._handler(ctx, { detectionId: "detection-1" })).rejects.toThrow(
      "Access denied",
    );
  });
});
