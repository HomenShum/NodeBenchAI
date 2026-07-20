import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function matchesWatchlist(event: any, watchlist: any) {
  const entityKeys = watchlist.entityKeys ?? [];
  const countryCodes = watchlist.countryCodes ?? [];
  const themeTags = watchlist.themeTags ?? [];
  const sectorKeys = watchlist.sectorKeys ?? [];

  const entityMatch =
    entityKeys.length === 0 ||
    entityKeys.includes(event.primaryEntityKey) ||
    (event.linkedEntityKeys ?? []).some((key: string) => entityKeys.includes(key));

  const geographyMatch = countryCodes.length === 0 || countryCodes.includes(event.countryCode);
  const themeMatch =
    themeTags.length === 0 || themeTags.some((tag: string) => event.topic?.toLowerCase().includes(tag.toLowerCase()));
  const sectorMatch =
    sectorKeys.length === 0 || sectorKeys.some((tag: string) => event.topic?.toLowerCase().includes(tag.toLowerCase()));

  return entityMatch && geographyMatch && themeMatch && sectorMatch;
}

export const ingestEvent = mutation({
  args: {
    title: v.string(),
    summary: v.string(),
    topic: v.string(),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    status: v.optional(v.union(v.literal("open"), v.literal("watch"), v.literal("resolved"), v.literal("dismissed"))),
    countryCode: v.optional(v.string()),
    region: v.optional(v.string()),
    placeName: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    happenedAt: v.number(),
    detectedAt: v.optional(v.number()),
    sourceRefs: v.array(
      v.object({
        label: v.string(),
        href: v.optional(v.string()),
        note: v.optional(v.string()),
        kind: v.optional(v.string()),
        publishedAtIso: v.optional(v.string()),
      }),
    ),
    primaryEntityKey: v.optional(v.string()),
    linkedEntityKeys: v.optional(v.array(v.string())),
    linkedChainId: v.optional(v.id("causalChains")),
    watchlistKeys: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dedupeHash = stableHash(
      [
        args.title,
        args.topic,
        args.countryCode ?? "",
        String(args.happenedAt),
        JSON.stringify(args.linkedEntityKeys ?? []),
      ].join("|"),
    );
    const eventKey = `evt_${dedupeHash}`;

    const existing = await ctx.db
      .query("worldEvents")
      .withIndex("by_dedupe_hash", (q) => q.eq("dedupeHash", dedupeHash))
      .first();

    const payload = {
      eventKey,
      title: args.title,
      summary: args.summary,
      topic: args.topic,
      severity: args.severity,
      status: args.status ?? "open",
      countryCode: args.countryCode,
      region: args.region,
      placeName: args.placeName,
      latitude: args.latitude,
      longitude: args.longitude,
      happenedAt: args.happenedAt,
      detectedAt: args.detectedAt ?? now,
      sourceRefs: args.sourceRefs,
      primaryEntityKey: args.primaryEntityKey,
      linkedEntityKeys: args.linkedEntityKeys,
      linkedChainId: args.linkedChainId,
      watchlistKeys: args.watchlistKeys,
      dedupeHash,
      metadata: args.metadata,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { eventId: existing._id, eventKey, deduped: true };
    }

    const eventId = await ctx.db.insert("worldEvents", {
      ...payload,
      createdAt: now,
    });
    return { eventId, eventKey, deduped: false };
  },
});

export const getMapSnapshot = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("watch"), v.literal("resolved"), v.literal("dismissed"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const events = args.status
      ? await ctx.db
          .query("worldEvents")
          .withIndex("by_status_detected", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(limit)
      : await ctx.db.query("worldEvents").order("desc").take(limit);

    const byCountry = new Map<string, any>();
    const byTopic = new Map<string, number>();
    const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 } as Record<string, number>;
    const rank = { low: 0, medium: 1, high: 2, critical: 3 };

    for (const event of events) {
      severityCounts[event.severity] = (severityCounts[event.severity] ?? 0) + 1;
      byTopic.set(event.topic, (byTopic.get(event.topic) ?? 0) + 1);
      const key = event.countryCode ?? "GLOBAL";
      const existing = byCountry.get(key) ?? {
        countryCode: key,
        count: 0,
        highestSeverity: "low",
        topics: new Set<string>(),
        coordinates: [],
      };
      existing.count += 1;
      existing.topics.add(event.topic);
      if (rank[event.severity] > rank[existing.highestSeverity]) {
        existing.highestSeverity = event.severity;
      }
      if (event.latitude !== undefined && event.longitude !== undefined) {
        existing.coordinates.push([event.latitude, event.longitude]);
      }
      byCountry.set(key, existing);
    }

    return {
      totalEvents: events.length,
      severityCounts,
      countries: [...byCountry.values()].map((item) => ({
        ...item,
        topics: [...item.topics],
      })),
      topics: [...byTopic.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count),
      events,
    };
  },
});

export const getEventCluster = query({
  args: {
    countryCode: v.optional(v.string()),
    topic: v.optional(v.string()),
    entityKey: v.optional(v.string()),
    severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db.query("worldEvents").order("desc").take(args.limit ?? 50);
    const filtered = events.filter((event) => {
      if (args.countryCode && event.countryCode !== args.countryCode) return false;
      if (args.topic && event.topic !== args.topic) return false;
      if (args.severity && event.severity !== args.severity) return false;
      if (
        args.entityKey &&
        event.primaryEntityKey !== args.entityKey &&
        !(event.linkedEntityKeys ?? []).includes(args.entityKey)
      ) {
        return false;
      }
      return true;
    });

    return {
      filters: args,
      total: filtered.length,
      events: filtered,
    };
  },
});

export const getWatchlistDigest = query({
  args: {
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const watchlists = args.status
      ? await ctx.db
          .query("watchlists")
          .withIndex("by_status_updated", (q) => q.eq("status", args.status!))
          .order("desc")
          .collect()
      : await ctx.db.query("watchlists").order("desc").collect();

    const recentEvents = await ctx.db.query("worldEvents").order("desc").take(150);
    const digest = watchlists.map((watchlist) => {
      const matchingEvents = recentEvents.filter((event) => matchesWatchlist(event, watchlist));
      const alertEvents = matchingEvents.filter((event) =>
        watchlist.alertThreshold === "all"
          ? true
          : watchlist.alertThreshold === "medium"
            ? ["medium", "high", "critical"].includes(event.severity)
            : watchlist.alertThreshold === "high"
              ? ["high", "critical"].includes(event.severity)
              : event.severity === "critical",
      );

      return {
        ...watchlist,
        matchingEventCount: matchingEvents.length,
        alertEventCount: alertEvents.length,
        latestEvent: matchingEvents[0] ?? null,
      };
    });

    return {
      watchlists: digest,
      suggestedWatchlists:
        digest.length > 0
          ? []
          : [
              {
                title: "Semiconductor Supply Chain",
                scopeType: "theme",
                themeTags: ["semiconductor", "supply chain"],
              },
              {
                title: "Global Health Regulatory Watch",
                scopeType: "geography",
                countryCodes: ["US", "EU", "CN"],
              },
            ],
    };
  },
});
