import { describe, expect, it } from "vitest";

import { getPublishedWikiBySlug } from "../events";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class MockIndexBuilder {
  private filters: Array<{ field: string; value: unknown }> = [];

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
    private readonly rows: Row[],
    private readonly filters: Array<{ field: string; value: unknown }>,
  ) {}

  order(direction: "asc" | "desc") {
    this.orderDirection = direction;
    return this;
  }

  async first() {
    const rows = await this.take(1);
    return rows[0] ?? null;
  }

  async take(limit: number) {
    const filtered = this.rows.filter((row) =>
      this.filters.every((filter) => row[filter.field] === filter.value),
    );
    const sorted = [...filtered].sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      return this.orderDirection === "desc" ? right - left : left - right;
    });
    return sorted.slice(0, limit);
  }
}

function sortValue(row: Row) {
  return row.version ?? row.publishedAt ?? row.createdAt ?? 0;
}

class MockDb {
  constructor(private readonly tables: Tables) {}

  query(table: string) {
    const rows = this.tables[table] ?? [];
    return {
      withIndex: (
        _indexName: string,
        build: (builder: MockIndexBuilder) => MockIndexBuilder,
      ) => {
        const builder = build(new MockIndexBuilder());
        return new MockQueryChain(rows, builder.getFilters());
      },
    };
  }
}

function createCtx(tables: Tables) {
  return { db: new MockDb(tables) };
}

async function getPublicWiki(ctx: ReturnType<typeof createCtx>, slug: string) {
  return await (getPublishedWikiBySlug as any)._handler(ctx, { slug });
}

describe("getPublishedWikiBySlug", () => {
  it("returns the latest published snapshot without exposing draft/private-note data", async () => {
    const ctx = createCtx({
      liveEvents: [
        {
          _id: "liveEvents:public1",
          slug: "demo-day",
          name: "Demo Day",
          roomCode: "ORBITAL",
          status: "ended",
        },
      ],
      liveEventWikiVersions: [
        {
          _id: "liveEventWikiVersions:old",
          eventId: "liveEvents:public1",
          version: 1,
          status: "published",
          title: "Older Wiki",
          bodyHtml: "<p>Older public snapshot.</p>",
          sourceAnswerIds: ["liveEventAnswers:old"],
          sourceIds: ["liveEventSources:old"],
          createdAt: 1770000000000,
          publishedAt: 1770000000001,
        },
        {
          _id: "liveEventWikiVersions:new",
          eventId: "liveEvents:public1",
          version: 2,
          status: "published",
          title: "Demo Day Wiki",
          bodyHtml: "<h1>Demo Day Wiki</h1><p>Public answer only.</p>",
          sourceAnswerIds: ["liveEventAnswers:1", "liveEventAnswers:2"],
          sourceIds: ["liveEventSources:1", "liveEventSources:2"],
          createdAt: 1770000001000,
          publishedAt: 1770000001001,
        },
        {
          _id: "liveEventWikiVersions:draft",
          eventId: "liveEvents:public1",
          version: 3,
          status: "draft",
          title: "Draft Wiki",
          bodyHtml: "<p>PRIVATE LATENCY SECRET</p>",
          sourceAnswerIds: ["liveEventAnswers:private"],
          sourceIds: ["liveEventSources:private"],
          createdAt: 1770000002000,
        },
      ],
      userNotes: [
        {
          _id: "userNotes:private",
          eventId: "liveEvents:public1",
          body: "PRIVATE LATENCY SECRET",
        },
      ],
    });

    const bySlug = await getPublicWiki(ctx, "demo-day");
    const byRoomCode = await getPublicWiki(ctx, " orbital ");

    expect(bySlug?.event.slug).toBe("demo-day");
    expect(bySlug?.wiki.version).toBe(2);
    expect(bySlug?.wiki.sourceAnswerCount).toBe(2);
    expect(bySlug?.wiki.sourceCount).toBe(2);
    expect(bySlug?.wiki.bodyHtml).toContain("Public answer only");
    expect(bySlug?.wiki.bodyHtml).not.toContain("PRIVATE LATENCY SECRET");
    expect(byRoomCode?.wiki.wikiId).toBe("liveEventWikiVersions:new");
  });

  it("returns null when the event is missing or only has draft wiki rows", async () => {
    const ctx = createCtx({
      liveEvents: [
        {
          _id: "liveEvents:draftOnly",
          slug: "draft-only",
          name: "Draft Only",
          roomCode: "DRAFT",
          status: "live",
        },
      ],
      liveEventWikiVersions: [
        {
          _id: "liveEventWikiVersions:draft",
          eventId: "liveEvents:draftOnly",
          version: 1,
          status: "draft",
          title: "Draft Wiki",
          bodyHtml: "<p>not public</p>",
          sourceAnswerIds: [],
          sourceIds: [],
          createdAt: 1770000000000,
        },
      ],
    });

    await expect(getPublicWiki(ctx, "draft-only")).resolves.toBeNull();
    await expect(getPublicWiki(ctx, "missing-room")).resolves.toBeNull();
  });
});
