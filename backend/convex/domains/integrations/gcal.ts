"use node";
import { internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../../_generated/api";
import { refreshAccessTokenIfNeeded } from "./gmail";

type SyncResult = {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  error?: string;
};

export const syncPrimaryCalendar = internalAction({
  args: { maxDaysBack: v.optional(v.number()) },
  returns: v.object({
    success: v.boolean(),
    created: v.number(),
    updated: v.number(),
    skipped: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { maxDaysBack = 60 }): Promise<SyncResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { success: false, created: 0, updated: 0, skipped: 0, error: "Not authenticated" };

    const account = await ctx.runQuery(internal.domains.integrations.gmail.getAccount, {});
    if (!account) return { success: false, created: 0, updated: 0, skipped: 0, error: "No Google account connected" };

    const db = (ctx as any).db;
    const prefs = db
      ? await db.query("userPreferences").withIndex("by_user", (q: any) => q.eq("userId", userId)).first()
      : null;
    if (prefs && prefs.gcalSyncEnabled === false) {
      return { success: true, created: 0, updated: 0, skipped: 0 };
    }

    const accessToken = await refreshAccessTokenIfNeeded(ctx, account);

    const now = new Date();
    const timeMin = new Date(now.getTime() - maxDaysBack * 24 * 60 * 60 * 1000).toISOString();
    const eventsUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    eventsUrl.searchParams.set("singleEvents", "true");
    eventsUrl.searchParams.set("orderBy", "startTime");
    eventsUrl.searchParams.set("maxResults", "250");
    if (account.gcalSyncToken) {
      eventsUrl.searchParams.set("syncToken", account.gcalSyncToken);
    } else {
      eventsUrl.searchParams.set("timeMin", timeMin);
    }

    const res = await fetch(eventsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, created: 0, updated: 0, skipped: 0, error: `Failed to sync calendar: ${text}` };
    }
    const data: any = await res.json();
    const items: any[] = Array.isArray(data.items) ? data.items : [];

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        if (item.status === "cancelled") {
          skipped++;
          continue;
        }
        const title: string = item.summary || "Event";
        const startIso = item.start?.dateTime || item.start?.date;
        const endIso = item.end?.dateTime || item.end?.date;
        if (!startIso) {
          skipped++;
          continue;
        }
        const startTime = new Date(startIso).getTime();
        const endTime = endIso ? new Date(endIso).getTime() : undefined;
        const allDay = Boolean(item.start?.date && !item.start?.dateTime);
        const hash = `${title.toLowerCase().trim()}::${startTime}::${item.organizer?.email ?? ""}`;

        const window = 2 * 60 * 60 * 1000;
        const candidates = db
          ? await db
              .query("events")
              .withIndex("by_user_start", (q: any) =>
                q.eq("userId", userId).gte("startTime", startTime - window).lte("startTime", startTime + window)
              )
              .collect()
          : [];

        const existing = candidates.find((e: any) => (e.meta)?.hash === hash || e.sourceId === item.id);

        const baseEvent = {
          userId,
          title: title.slice(0, 140),
          description: item.description,
          startTime,
          endTime,
          allDay,
          location: item.location,
          status: (item.status) || "confirmed",
          sourceType: "gcal" as const,
          sourceId: item.id as string,
          ingestionConfidence: "high" as const,
          proposed: false,
          rawSummary: item.description?.slice(0, 180),
          meta: { hash, organizer: item.organizer, attendees: item.attendees },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        if (existing && db) {
          await db.patch(existing._id, { ...baseEvent, createdAt: existing.createdAt });
          updated++;
        } else if (db) {
          await db.insert("events", baseEvent);
          created++;
        } else {
          skipped++;
        }
      } catch (err) {
        skipped++;
        console.warn("[gcal.syncPrimaryCalendar] Failed for item", item?.id, err);
      }
    }

    if (data.nextSyncToken) {
      await ctx.runMutation(internal.domains.integrations.gmail.updateTokens, {
        accessToken,
        gcalSyncToken: data.nextSyncToken as string,
      });
    }

    return { success: true, created, updated, skipped };
  },
});
