/**
 * LinkedIn OAuth Token Management
 *
 * Handles:
 * - OAuth authorization URL generation
 * - Authorization code → access token exchange
 * - Refresh token → new access token rotation
 * - System-level token refresh (env var LINKEDIN_ACCESS_TOKEN)
 *
 * Required environment:
 *   LINKEDIN_CLIENT_ID
 *   LINKEDIN_CLIENT_SECRET
 *   LINKEDIN_ACCESS_TOKEN (system-level fallback)
 *   LINKEDIN_REFRESH_TOKEN (optional, for auto-refresh)
 *
 * LinkedIn OAuth 2.0 docs:
 *   https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 */

import { v } from "convex/values";
import { internalAction, httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

const REQUIRED_SCOPES = [
  "openid",
  "email",
  "profile",
  "w_member_social",
  "w_organization_social",
  "r_organization_social",
].join(" ");

// Refresh 7 days before expiry to avoid any gaps
const REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// HTTP Actions - OAuth Flow Endpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /linkedin/oauth/authorize
 * Redirects user to LinkedIn authorization page.
 * After user grants access, LinkedIn redirects to /linkedin/oauth/callback with an auth code.
 */
export const authorizeHandler = httpAction(async (_ctx, req) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return new Response("LINKEDIN_CLIENT_ID not configured", { status: 500 });
  }

  // Build callback URL from the current request's origin
  const requestUrl = new URL(req.url);
  const redirectUri = `${requestUrl.origin}/linkedin/oauth/callback`;

  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: REQUIRED_SCOPES,
    state,
  });

  const authUrl = `${LINKEDIN_AUTH_URL}?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl },
  });
});

/**
 * GET /linkedin/oauth/callback
 * Receives the authorization code from LinkedIn, exchanges it for tokens,
 * and stores them in the Convex environment.
 */
export const callbackHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return new Response(
      `<html><body><h1>LinkedIn OAuth Error</h1><p>${error}: ${errorDescription}</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code) {
    return new Response(
      `<html><body><h1>Missing authorization code</h1></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(
      `<html><body><h1>Server Error</h1><p>LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET not configured.</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  const redirectUri = `${url.origin}/linkedin/oauth/callback`;

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(LINKEDIN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("[linkedinOAuth] Token exchange failed:", errText);
      return new Response(
        `<html><body><h1>Token Exchange Failed</h1><pre>${errText}</pre></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in, refresh_token_expires_in } = tokens;

    console.log(`[linkedinOAuth] Token exchange successful. expires_in=${expires_in}s, has_refresh=${!!refresh_token}`);

    // Store tokens via internal action
    await ctx.runAction(internal.domains.social.linkedinOAuth.storeSystemTokens, {
      accessToken: access_token,
      refreshToken: refresh_token || undefined,
      expiresIn: expires_in || 5184000, // Default 60 days
      refreshTokenExpiresIn: refresh_token_expires_in,
    });

    const expiryDate = new Date(Date.now() + (expires_in || 5184000) * 1000).toISOString();

    return new Response(
      `<html><body style="font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px;">
        <h1 style="color: #0a66c2;">LinkedIn Connected!</h1>
        <p>Access token and refresh token stored successfully.</p>
        <ul>
          <li><strong>Access token expires:</strong> ${expiryDate}</li>
          <li><strong>Refresh token:</strong> ${refresh_token ? "Stored (auto-refresh enabled)" : "Not provided"}</li>
        </ul>
        <p>You can close this window. LinkedIn posting will resume automatically.</p>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    console.error("[linkedinOAuth] Callback error:", err);
    return new Response(
      `<html><body><h1>Error</h1><pre>${err instanceof Error ? err.message : String(err)}</pre></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Internal Actions - Token Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store system-level LinkedIn tokens.
 * Updates LINKEDIN_ACCESS_TOKEN and LINKEDIN_REFRESH_TOKEN env vars,
 * and stores expiry in freeModelMeta for cron monitoring.
 */
export const storeSystemTokens = internalAction({
  args: {
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresIn: v.number(), // seconds
    refreshTokenExpiresIn: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Store token expiry timestamp in DB for cron monitoring
    const expiresAt = Date.now() + args.expiresIn * 1000;
    await ctx.runMutation(
      internal.domains.social.linkedinOAuth.upsertTokenMeta,
      {
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: args.refreshTokenExpiresIn
          ? Date.now() + args.refreshTokenExpiresIn * 1000
          : undefined,
        lastRefreshed: Date.now(),
      }
    );

    console.log(`[linkedinOAuth] System tokens stored. Access expires at ${new Date(expiresAt).toISOString()}`);

    // Send ntfy notification
    const ntfyUrl = process.env.NTFY_URL;
    if (ntfyUrl) {
      try {
        await fetch(ntfyUrl, {
          method: "POST",
          headers: {
            Title: "LinkedIn token refreshed",
            Priority: "default",
            Tags: "white_check_mark,linkedin",
          },
          body: `Access token refreshed. Expires: ${new Date(expiresAt).toISOString()}. Refresh token: ${args.refreshToken ? "available" : "not provided"}.`,
        });
      } catch (e) {
        console.warn("[linkedinOAuth] ntfy alert failed:", e);
      }
    }

    return null;
  },
});

/**
 * Refresh the system-level LinkedIn access token using the refresh token.
 * Called by cron job or manually when token is about to expire.
 */
export const refreshSystemToken = internalAction({
  args: {},
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN;

    if (!clientId || !clientSecret) {
      return { success: false, error: "LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET not set" };
    }

    if (!refreshToken) {
      // No refresh token — alert and return
      const ntfyUrl = process.env.NTFY_URL;
      if (ntfyUrl) {
        try {
          await fetch(ntfyUrl, {
            method: "POST",
            headers: {
              Title: "LinkedIn token expiring - manual refresh needed",
              Priority: "urgent",
              Tags: "warning,linkedin",
            },
            body: "No LINKEDIN_REFRESH_TOKEN set. Manual re-authorization required.\nVisit your Convex deployment URL + /linkedin/oauth/authorize to re-authenticate.",
          });
        } catch (_e) { /* ignore */ }
      }
      return { success: false, error: "LINKEDIN_REFRESH_TOKEN not set. Manual re-authorization required." };
    }

    try {
      const response = await fetch(LINKEDIN_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[linkedinOAuth] Token refresh failed:", errText);

        // Alert on failure
        const ntfyUrl = process.env.NTFY_URL;
        if (ntfyUrl) {
          try {
            await fetch(ntfyUrl, {
              method: "POST",
              headers: {
                Title: "LinkedIn token refresh FAILED",
                Priority: "urgent",
                Tags: "x,linkedin",
              },
              body: `Refresh failed: ${response.status} ${errText}\nManual re-authorization may be needed at /linkedin/oauth/authorize`,
            });
          } catch (_e) { /* ignore */ }
        }

        return { success: false, error: `Refresh failed: ${response.status} ${errText}` };
      }

      const tokens = await response.json();
      const { access_token, refresh_token: newRefreshToken, expires_in } = tokens;

      // Store the new tokens
      await ctx.runAction(internal.domains.social.linkedinOAuth.storeSystemTokens, {
        accessToken: access_token,
        refreshToken: newRefreshToken || refreshToken, // Keep old refresh token if new one not provided
        expiresIn: expires_in || 5184000,
      });

      const expiresAt = Date.now() + (expires_in || 5184000) * 1000;
      console.log(`[linkedinOAuth] Token refreshed successfully. New expiry: ${new Date(expiresAt).toISOString()}`);

      return { success: true, expiresAt };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[linkedinOAuth] Refresh error:", errMsg);
      return { success: false, error: errMsg };
    }
  },
});

/**
 * Check if the system token needs refreshing.
 * Called by cron — refreshes proactively 7 days before expiry.
 */
export const checkAndRefreshToken = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const meta = await ctx.runQuery(
      internal.domains.social.linkedinOAuth.getTokenMeta,
      {}
    );

    if (!meta) {
      console.log("[linkedinOAuth] No token metadata found. Skipping refresh check.");
      return null;
    }

    const now = Date.now();
    const timeUntilExpiry = meta.accessTokenExpiresAt - now;

    if (timeUntilExpiry <= 0) {
      console.warn("[linkedinOAuth] Access token EXPIRED. Attempting refresh...");
      await ctx.runAction(internal.domains.social.linkedinOAuth.refreshSystemToken, {});
    } else if (timeUntilExpiry <= REFRESH_BUFFER_MS) {
      const daysLeft = Math.round(timeUntilExpiry / (24 * 60 * 60 * 1000));
      console.log(`[linkedinOAuth] Token expires in ${daysLeft} days. Refreshing proactively...`);
      await ctx.runAction(internal.domains.social.linkedinOAuth.refreshSystemToken, {});
    } else {
      const daysLeft = Math.round(timeUntilExpiry / (24 * 60 * 60 * 1000));
      console.log(`[linkedinOAuth] Token healthy. ${daysLeft} days until expiry.`);
    }

    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutations & Queries for token metadata
// ═══════════════════════════════════════════════════════════════════════════

import { internalMutation, internalQuery } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * Store/update LinkedIn token expiry metadata in freeModelMeta table.
 */
export const upsertTokenMeta = internalMutation({
  args: {
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    lastRefreshed: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("freeModelMeta")
      .filter((q) => q.eq(q.field("key"), "linkedinTokenExpiry"))
      .unique() as Doc<"freeModelMeta"> | null;

    const value = args.accessTokenExpiresAt;

    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("freeModelMeta", {
        key: "linkedinTokenExpiry",
        value,
      });
    }

    // Also store last-refreshed timestamp
    const refreshMeta = await ctx.db
      .query("freeModelMeta")
      .filter((q) => q.eq(q.field("key"), "linkedinTokenLastRefreshed"))
      .unique() as Doc<"freeModelMeta"> | null;

    if (refreshMeta) {
      await ctx.db.patch(refreshMeta._id, { value: args.lastRefreshed });
    } else {
      await ctx.db.insert("freeModelMeta", {
        key: "linkedinTokenLastRefreshed",
        value: args.lastRefreshed,
      });
    }

    return null;
  },
});

/**
 * Get LinkedIn token metadata for cron checks.
 */
export const getTokenMeta = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      accessTokenExpiresAt: v.number(),
      lastRefreshed: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const expiryMeta = await ctx.db
      .query("freeModelMeta")
      .filter((q) => q.eq(q.field("key"), "linkedinTokenExpiry"))
      .unique() as Doc<"freeModelMeta"> | null;

    const refreshMeta = await ctx.db
      .query("freeModelMeta")
      .filter((q) => q.eq(q.field("key"), "linkedinTokenLastRefreshed"))
      .unique() as Doc<"freeModelMeta"> | null;

    if (!expiryMeta) return null;

    return {
      accessTokenExpiresAt: expiryMeta.value as number,
      lastRefreshed: refreshMeta ? (refreshMeta.value as number) : 0,
    };
  },
});
