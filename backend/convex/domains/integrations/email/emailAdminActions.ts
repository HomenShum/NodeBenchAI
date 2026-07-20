/**
 * Email Admin Actions - For CLI testing and debugging
 */
"use node";

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { refreshAccessTokenIfNeeded } from "../gmail";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Sync emails for a specific user by their email address
 * Admin action for testing
 */
export const syncEmailsForUser = action({
  args: {
    email: v.string(),
    maxThreads: v.optional(v.number()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[emailAdmin] Starting email sync for ${args.email}...`);

    // Find the user
    const user = await ctx.runQuery(internal.domains.integrations.email.emailAdmin.findUserByEmail, {
      email: args.email,
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Get their Google account
    const googleAccount = await ctx.runQuery(
      internal.domains.integrations.email.emailAdmin.getGoogleAccountByUserId,
      { userId: user._id }
    );

    if (!googleAccount) {
      return {
        success: false,
        error: "No Google account connected",
        message: "User needs to connect Gmail via OAuth at /settings/integrations",
      };
    }

    // Refresh token if needed
    let accessToken = googleAccount.accessToken;
    if (googleAccount.expiryDate && googleAccount.expiryDate < Date.now() + 60000) {
      console.log("[emailAdmin] Token expired, refreshing...");
      accessToken = await refreshAccessTokenIfNeeded(ctx, googleAccount);
    }

    // Fetch threads from Gmail
    const maxThreads = args.maxThreads || 20;
    const searchQuery = args.query || "is:inbox";

    console.log(`[emailAdmin] Fetching threads with query: "${searchQuery}"`);

    const threadsUrl = new URL(`${GMAIL_API_BASE}/threads`);
    threadsUrl.searchParams.set("maxResults", String(maxThreads));
    threadsUrl.searchParams.set("q", searchQuery);

    const threadsResponse = await fetch(threadsUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!threadsResponse.ok) {
      const errorText = await threadsResponse.text();
      console.error("[emailAdmin] Gmail API error:", errorText);
      return {
        success: false,
        error: `Gmail API error: ${threadsResponse.status}`,
        details: errorText,
      };
    }

    const threadsData = await threadsResponse.json();
    const threads = threadsData.threads || [];

    console.log(`[emailAdmin] Found ${threads.length} threads`);

    // Fetch full thread details for each
    const syncedThreads: any[] = [];
    for (const thread of threads.slice(0, maxThreads)) {
      try {
        const threadUrl = `${GMAIL_API_BASE}/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`;
        const threadResponse = await fetch(threadUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (threadResponse.ok) {
          const threadData = await threadResponse.json();
          const messages = threadData.messages || [];
          const lastMessage = messages[messages.length - 1];
          const headers = lastMessage?.payload?.headers || [];

          const getHeader = (name: string) =>
            headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value;

          syncedThreads.push({
            gmailThreadId: thread.id,
            subject: getHeader("Subject") || "(no subject)",
            from: getHeader("From") || "Unknown",
            messageCount: messages.length,
            snippet: threadData.snippet,
          });
        }
      } catch (e) {
        console.error(`[emailAdmin] Error fetching thread ${thread.id}:`, e);
      }
    }

    console.log(`[emailAdmin] Synced ${syncedThreads.length} threads for ${args.email}`);

    return {
      success: true,
      userId: user._id,
      email: args.email,
      threadsSynced: syncedThreads.length,
      threads: syncedThreads,
    };
  },
});
