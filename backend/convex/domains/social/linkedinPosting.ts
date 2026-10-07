"use node";

/**
 * LinkedIn Posting Actions (Node.js)
 *
 * Handles actual LinkedIn API calls for posting content.
 * Requires Node.js runtime for HTTP requests.
 *
 * Required Environment:
 *   - LINKEDIN_CLIENT_ID: OAuth client ID (for generating new tokens)
 *   - LINKEDIN_CLIENT_SECRET: OAuth client secret (for token refresh)
 *
 * Required OAuth Scopes (Personal):
 *   - w_member_social: Post on behalf of member
 *   - openid, email: For authentication
 *   NOTE: r_member_social is CLOSED — cannot read personal post comments/reactions via API
 *
 * Required OAuth Scopes (Organization):
 *   - w_organization_social: Post to organization page
 *   - r_organization_social: Read comments/reactions on organization posts
 *
 * See: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const LINKEDIN_API_VERSION = "202601";
const LINKEDIN_API_BASE = "https://api.linkedin.com";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface LinkedInUserInfo {
  sub: string;          // person URN ID
  name?: string;
  email?: string;
  picture?: string;
}

interface LinkedInPostResult {
  success: boolean;
  postUrn?: string;
  postUrl?: string;
  error?: string;
}

interface LinkedInImageUploadResult {
  success: boolean;
  imageUrn?: string;
  error?: string;
}

interface LinkedInDeleteResult {
  success: boolean;
  postUrn: string;
  error?: string;
}

interface LinkedInUpdateResult {
  success: boolean;
  postUrn: string;
  error?: string;
}

interface LinkedInFetchPostResult {
  success: boolean;
  postUrn: string;
  status?: number;
  post?: any;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Actions - LinkedIn API Calls
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch and store user info after account connection
 */
export const fetchUserInfo = internalAction({
  args: { accountId: v.id("linkedinAccounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.runQuery(internal.domains.social.linkedinAccounts.getAccountById, {
      accountId: args.accountId,
    });

    if (!account) {
      console.error("[LinkedIn] Account not found:", args.accountId);
      return null;
    }

    try {
      const userInfo = await fetchLinkedInUserInfo(account.accessToken);

      if (userInfo) {
        await ctx.runMutation(internal.domains.social.linkedinAccounts.updateAccountInfo, {
          accountId: args.accountId,
          personUrn: `urn:li:person:${userInfo.sub}`,
          displayName: userInfo.name,
          email: userInfo.email,
          profilePictureUrl: userInfo.picture,
        });
      }
    } catch (error) {
      console.error("[LinkedIn] Failed to fetch user info:", error);
    }

    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Post Creation Actions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a text post on LinkedIn
 */
export const createTextPost = action({
  args: {
    text: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    postUrn: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<LinkedInPostResult> => {
    // Try to get user-specific LinkedIn account first
    const userId = await getAuthUserId(ctx);
    let accessToken: string | undefined;
    let personUrn: string | undefined;

    if (userId) {
      const account = await ctx.runQuery(internal.domains.social.linkedinAccounts.getAccountForUser, {
        userId,
      });

      if (account) {
        if (account.expiresAt && account.expiresAt < Date.now()) {
          return {
            success: false,
            error: "LinkedIn access token expired. Please reconnect your LinkedIn account.",
          };
        }
        accessToken = account.accessToken;
        personUrn = account.personUrn;
      }
    }

    // Fallback to system-level access token from environment
    if (!accessToken) {
      accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
      if (!accessToken) {
        return {
          success: false,
          error: "LinkedIn not configured. Set LINKEDIN_ACCESS_TOKEN in Convex environment or connect your account.",
        };
      }
      // Fetch person URN using the token
      const userInfo = await fetchLinkedInUserInfo(accessToken);
      if (userInfo) {
        personUrn = `urn:li:person:${userInfo.sub}`;
      }
    }

    if (!personUrn) {
      return {
        success: false,
        error: "Could not determine LinkedIn profile URN. Please try again.",
      };
    }

    try {
      const result = await postToLinkedIn(
        accessToken,
        personUrn,
        args.text
      );
      return result;
    } catch (error) {
      console.error("[LinkedIn] Post creation error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create post",
      };
    }
  },
});

/**
 * Create a post with an image on LinkedIn
 */
export const createImagePost = action({
  args: {
    text: v.string(),
    imageUrl: v.string(),
    altText: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    postUrn: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<LinkedInPostResult> => {
    // Try to get user-specific LinkedIn account first
    const userId = await getAuthUserId(ctx);
    let accessToken: string | undefined;
    let personUrn: string | undefined;

    if (userId) {
      const account = await ctx.runQuery(internal.domains.social.linkedinAccounts.getAccountForUser, {
        userId,
      });

      if (account) {
        if (account.expiresAt && account.expiresAt < Date.now()) {
          return {
            success: false,
            error: "LinkedIn access token expired. Please reconnect your LinkedIn account.",
          };
        }
        accessToken = account.accessToken;
        personUrn = account.personUrn;
      }
    }

    // Fallback to system-level access token from environment
    if (!accessToken) {
      accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
      if (!accessToken) {
        return {
          success: false,
          error: "LinkedIn not configured. Set LINKEDIN_ACCESS_TOKEN in Convex environment or connect your account.",
        };
      }
      // Fetch person URN using the token
      const userInfo = await fetchLinkedInUserInfo(accessToken);
      if (userInfo) {
        personUrn = `urn:li:person:${userInfo.sub}`;
      }
    }

    if (!personUrn) {
      return {
        success: false,
        error: "Could not determine LinkedIn profile URN. Please try again.",
      };
    }

    try {
      // Step 1: Upload image
      const imageUpload = await uploadImageToLinkedIn(
        accessToken,
        personUrn,
        args.imageUrl
      );

      if (!imageUpload.success || !imageUpload.imageUrn) {
        return {
          success: false,
          error: imageUpload.error || "Failed to upload image to LinkedIn",
        };
      }

      // Step 2: Create post with image
      const result = await postToLinkedIn(
        accessToken,
        personUrn,
        args.text,
        imageUpload.imageUrn,
        args.altText
      );

      return result;
    } catch (error) {
      console.error("[LinkedIn] Image post creation error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create image post",
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LinkedIn API Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function getLinkedInHeaders(accessToken: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${accessToken}`,
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

function cleanLinkedInText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")           // Normalize Windows line endings
    .replace(/\r/g, "\n")             // Normalize old Mac line endings
    .replace(/\|/g, "-")              // Pipe breaks LinkedIn posts
    .replace(/[\u2500-\u257F]/g, "-") // Box drawing characters
    .replace(/[\u2018\u2019\u0060\u00B4\u2032\u2035]/g, "'")  // Quote variants to regular
    .replace(/[\u201C\u201D\u00AB\u00BB\u2033\u2036]/g, '"')  // Double quote variants
    .replace(/[\u2013\u2014\u2015\u2212]/g, "-")  // Dash variants to regular
    .replace(/[\u2026]/g, "...")      // Ellipsis to dots
    .replace(/[\u00A0\u2007\u202F\u2060]/g, " ")  // Special spaces
    .replace(/[\u200B-\u200F\u2028-\u202E\uFEFF]/g, "") // Zero-width and direction chars
    .replace(/[\uFF08\u0028\(]/g, "[")  // Parentheses to brackets
    .replace(/[\uFF09\u0029\)]/g, "]")
    .replace(/[\uFF3B]/g, "[")        // Fullwidth left bracket
    .replace(/[\uFF3D]/g, "]")        // Fullwidth right bracket
    .replace(/[\u2039\u203A]/g, "'")  // Single angle quotes
    .replace(/[\u2329\u232A\u27E8\u27E9]/g, "") // Angle brackets - remove
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "") // Control chars EXCEPT newline (\u000A)
    .replace(/[^\x20-\x7E\n\u00C0-\u024F\u1E00-\u1EFF#@$%&*[\]{}:;.,!?'"\/\\+=<>~^-]/g, " ") // Keep safe chars (no parens)
    .replace(/ +/g, " ")              // Collapse multiple spaces
    .replace(/-{3,}/g, "---")         // Collapse multiple dashes to 3
    .replace(/\n{3,}/g, "\n\n")       // Max 2 consecutive newlines
    .trim()
    .substring(0, 3000);  // LinkedIn max is 3000 chars
}

async function fetchLinkedInUserInfo(accessToken: string): Promise<LinkedInUserInfo | null> {
  const response = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
    headers: getLinkedInHeaders(accessToken),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[LinkedIn] User info fetch failed:", response.status, errorText);
    return null;
  }

  return await response.json();
}

async function postToLinkedIn(
  accessToken: string,
  authorUrn: string,
  text: string,
  imageUrn?: string,
  altText?: string
): Promise<LinkedInPostResult> {
  // Clean text - LinkedIn has restrictions on certain characters
  // Important: Normalize newlines and remove problematic Unicode
  // CRITICAL: Many Unicode characters cause LinkedIn to TRUNCATE posts silently!
  // CRITICAL: Parentheses () cause truncation - replace with brackets []!
  const cleanText = text
    .replace(/\r\n/g, '\n')           // Normalize Windows line endings
    .replace(/\r/g, '\n')             // Normalize old Mac line endings
    .replace(/\|/g, '-')              // CRITICAL: Pipe breaks LinkedIn posts!
    .replace(/[\u2500-\u257F]/g, '-') // Box drawing characters (━, ─, │, etc.)
    .replace(/[\u2018\u2019\u0060\u00B4\u2032\u2035]/g, "'")  // All quote variants to regular
    .replace(/[\u201C\u201D\u00AB\u00BB\u2033\u2036]/g, '"')  // All double quote variants
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-')  // All dash variants to regular
    .replace(/[\u2026]/g, '...')      // Ellipsis to dots
    .replace(/[\u00A0\u2007\u202F\u2060]/g, ' ')  // All special spaces
    .replace(/[\u200B-\u200F\u2028-\u202E\uFEFF]/g, '') // Zero-width and direction chars
    .replace(/[\uFF08\u0028\(]/g, '[')  // CRITICAL: ALL parentheses to brackets!
    .replace(/[\uFF09\u0029\)]/g, ']')  // LinkedIn truncates at parentheses!
    .replace(/[\uFF3B]/g, '[')        // Fullwidth left bracket
    .replace(/[\uFF3D]/g, ']')        // Fullwidth right bracket
    .replace(/[\u2039\u203A]/g, "'")  // Single angle quotes
    .replace(/[\u2329\u232A\u27E8\u27E9]/g, '') // Angle brackets - remove
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '') // Control chars EXCEPT newline (\u000A)
    .replace(/[^\x20-\x7E\n\u00C0-\u024F\u1E00-\u1EFF#@$%&*[\]{}:;.,!?'"\/\\+=<>~^-]/g, ' ') // Keep safe chars (no parens!)
    .replace(/ +/g, ' ')              // Collapse multiple spaces
    .replace(/-{3,}/g, '---')         // Collapse multiple dashes to 3
    .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
    .trim()
    .substring(0, 3000);  // LinkedIn max is 3000 chars

  console.log(`[LinkedIn] Posting text (${cleanText.length} chars):\n${cleanText.substring(0, 200)}...`);

  const postBody: Record<string, unknown> = {
    author: authorUrn,
    commentary: cleanText,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
  };

  // Add image if provided
  if (imageUrn) {
    postBody.content = {
      media: {
        altText: altText || "",
        id: imageUrn,
      },
    };
  }

  const response = await fetch(`${LINKEDIN_API_BASE}/rest/posts`, {
    method: "POST",
    headers: getLinkedInHeaders(accessToken),
    body: JSON.stringify(postBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    console.error("[LinkedIn] Post creation failed:", response.status, errorData);

    // Extract meaningful error message
    const errorMessage = errorData?.message
      || errorData?.serviceErrorCode
      || `LinkedIn API error: ${response.status}`;

    return { success: false, error: errorMessage };
  }

  // LinkedIn returns the post URN in the x-restli-id header
  const postUrn = response.headers.get("x-restli-id") || undefined;

  // Construct the post URL if we have the URN
  let postUrl: string | undefined;
  if (postUrn) {
    postUrl = `https://www.linkedin.com/feed/update/${postUrn}`;
  }

  return {
    success: true,
    postUrn,
    postUrl,
  };
}

async function partialUpdatePostCommentary(accessToken: string, postUrn: string, text: string): Promise<LinkedInUpdateResult> {
  const encoded = encodeURIComponent(postUrn);
  const cleanText = cleanLinkedInText(text);

  const response = await fetch(`${LINKEDIN_API_BASE}/rest/posts/${encoded}`, {
    method: "POST",
    headers: {
      ...getLinkedInHeaders(accessToken),
      "X-RestLi-Method": "PARTIAL_UPDATE",
    },
    body: JSON.stringify({
      patch: {
        $set: {
          commentary: cleanText,
        },
      },
    }),
  });

  if (response.status === 204 || response.status === 200) {
    return { success: true, postUrn };
  }

  const errorText = await response.text().catch(() => response.statusText);
  return { success: false, postUrn, error: `${response.status} ${errorText}` };
}

async function deletePostFromLinkedIn(accessToken: string, postUrn: string): Promise<LinkedInDeleteResult> {
  const encoded = encodeURIComponent(postUrn);
  const response = await fetch(`${LINKEDIN_API_BASE}/rest/posts/${encoded}`, {
    method: "DELETE",
    headers: getLinkedInHeaders(accessToken),
  });

  if (response.status === 204 || response.status === 200) {
    return { success: true, postUrn };
  }

  const errorText = await response.text().catch(() => response.statusText);
  return { success: false, postUrn, error: `${response.status} ${errorText}` };
}

async function fetchPostFromLinkedIn(accessToken: string, postUrn: string): Promise<LinkedInFetchPostResult> {
  const encoded = encodeURIComponent(postUrn);
  const response = await fetch(`${LINKEDIN_API_BASE}/rest/posts/${encoded}`, {
    method: "GET",
    headers: getLinkedInHeaders(accessToken),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    return { success: false, postUrn, status: response.status, error: `${response.status} ${errorText}` };
  }

  const body = await response.json().catch(() => ({}));
  return { success: true, postUrn, status: response.status, post: body };
}

export const deletePosts = internalAction({
  args: {
    postUrns: v.array(v.string()),
    dryRun: v.optional(v.boolean()),
    maxDeletes: v.optional(v.number()),
  },
  returns: v.object({
    attempted: v.number(),
    succeeded: v.number(),
    failed: v.number(),
    results: v.array(v.object({
      success: v.boolean(),
      postUrn: v.string(),
      error: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxDeletes = Math.min(Math.max(args.maxDeletes ?? 250, 1), 1000);

    // Use system-level access token (deletes are dangerous and should be automated only for system posting).
    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!accessToken) {
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        results: [{ success: false, postUrn: "missing_token", error: "LINKEDIN_ACCESS_TOKEN is not set" }],
      };
    }

    const input: string[] = Array.isArray(args.postUrns)
      ? (args.postUrns as unknown[]).map((u) => String(u).trim()).filter((u) => u.length > 0)
      : [];
    const uniq: string[] = [...new Set<string>(input)].slice(0, maxDeletes);

    const results: LinkedInDeleteResult[] = [];
    for (const urn of uniq) {
      if (dryRun) {
        results.push({ success: true, postUrn: urn });
        continue;
      }

      // Small delay to reduce chances of rate-limiting spikes.
      if (results.length > 0) {
        await new Promise((r) => setTimeout(r, 350));
      }

      try {
        results.push(await deletePostFromLinkedIn(accessToken, urn));
      } catch (e: any) {
        results.push({ success: false, postUrn: urn, error: e?.message || String(e) });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    return {
      attempted: results.length,
      succeeded,
      failed,
      results,
    };
  },
});

export const fetchPosts = internalAction({
  args: {
    postUrns: v.array(v.string()),
    maxFetch: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    attempted: v.number(),
    succeeded: v.number(),
    failed: v.number(),
    results: v.array(v.object({
      success: v.boolean(),
      postUrn: v.string(),
      status: v.optional(v.number()),
      post: v.optional(v.any()),
      error: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    const maxFetch = Math.min(Math.max(args.maxFetch ?? 25, 1), 200);
    const delayMs = Math.min(Math.max(args.delayMs ?? 250, 0), 2000);

    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!accessToken) {
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        results: [{ success: false, postUrn: "missing_token", error: "LINKEDIN_ACCESS_TOKEN is not set" }],
      };
    }

    const input: string[] = Array.isArray(args.postUrns)
      ? (args.postUrns as unknown[]).map((u) => String(u).trim()).filter((u) => u.length > 0)
      : [];
    const uniq: string[] = [...new Set<string>(input)].slice(0, maxFetch);

    const results: LinkedInFetchPostResult[] = [];
    for (const urn of uniq) {
      if (results.length > 0 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      try {
        results.push(await fetchPostFromLinkedIn(accessToken, urn));
      } catch (e: any) {
        results.push({ success: false, postUrn: urn, error: e?.message || String(e) });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    return {
      attempted: results.length,
      succeeded,
      failed,
      results: results.map((r) => ({ success: r.success, postUrn: r.postUrn, status: r.status, post: r.post, error: r.error })),
    };
  },
});

export const updatePostText = internalAction({
  args: {
    postUrn: v.string(),
    text: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    postUrn: v.string(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<LinkedInUpdateResult> => {
    const dryRun = args.dryRun ?? true;

    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!accessToken) {
      return { success: false, postUrn: args.postUrn, error: "LINKEDIN_ACCESS_TOKEN is not set" };
    }

    if (dryRun) {
      return { success: true, postUrn: args.postUrn };
    }

    try {
      return await partialUpdatePostCommentary(accessToken, args.postUrn, args.text);
    } catch (e: any) {
      return { success: false, postUrn: args.postUrn, error: e?.message || String(e) };
    }
  },
});

async function uploadImageToLinkedIn(
  accessToken: string,
  ownerUrn: string,
  imageUrl: string
): Promise<LinkedInImageUploadResult> {
  // Step 1: Initialize upload
  const initResponse = await fetch(`${LINKEDIN_API_BASE}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: getLinkedInHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
      },
    }),
  });

  if (!initResponse.ok) {
    const errorData = await initResponse.json().catch(() => ({}));
    console.error("[LinkedIn] Image upload init failed:", errorData);
    return { success: false, error: "Failed to initialize image upload" };
  }

  const initData = await initResponse.json();
  const uploadUrl = initData.value?.uploadUrl;
  const imageUrn = initData.value?.image;

  if (!uploadUrl || !imageUrn) {
    return { success: false, error: "Invalid upload initialization response" };
  }

  // Step 2: Download the image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    return { success: false, error: `Failed to fetch image from URL: ${imageResponse.status}` };
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

  // Step 3: Upload to LinkedIn
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": contentType,
    },
    body: imageBuffer,
  });

  if (!uploadResponse.ok) {
    console.error("[LinkedIn] Image upload failed:", uploadResponse.status);
    return { success: false, error: `Image upload failed: ${uploadResponse.status}` };
  }

  return { success: true, imageUrn };
}

// ═══════════════════════════════════════════════════════════════════════════
// Comment Fetching
// ═══════════════════════════════════════════════════════════════════════════

interface LinkedInComment {
  actor: string;
  message: { text: string };
  created: { time: number };
  id?: string;
  parentComment?: string;
  likeCount?: number;
}

interface LinkedInCommentsResult {
  success: boolean;
  postUrn: string;
  comments: Array<{
    actorUrn: string;
    text: string;
    createdAt: number;
    commentUrn?: string;
    isReply: boolean;
    likeCount: number;
  }>;
  total: number;
  error?: string;
}

async function fetchCommentsFromLinkedIn(
  accessToken: string,
  postUrn: string,
): Promise<LinkedInCommentsResult> {
  const encoded = encodeURIComponent(postUrn);
  // Use /v2/socialActions (not /rest/) — the versioned /rest/ endpoint returns 403 with r_organization_social
  const url = `${LINKEDIN_API_BASE}/v2/socialActions/${encoded}/comments?count=100`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    return { success: false, postUrn, comments: [], total: 0, error: `${response.status} ${errorText}` };
  }

  const body = await response.json().catch(() => ({ elements: [] }));
  const elements: LinkedInComment[] = body.elements || [];

  const comments = elements.map((el) => ({
    actorUrn: el.actor || "unknown",
    text: el.message?.text || "",
    createdAt: el.created?.time || 0,
    commentUrn: el.id,
    isReply: !!el.parentComment,
    likeCount: el.likeCount || 0,
  }));

  return {
    success: true,
    postUrn,
    comments,
    total: comments.length,
  };
}

/**
 * Fetch comments for one or more LinkedIn posts.
 *
 * NOTE: r_member_social is a closed LinkedIn permission (not available for new apps).
 * Personal post comments CANNOT be fetched via API.
 * Only organization posts can be read via r_organization_social scope.
 * Defaults to org token since that's the only viable path.
 */
export const fetchPostComments = internalAction({
  args: {
    postUrns: v.array(v.string()),
    useOrgToken: v.optional(v.boolean()),
  },
  returns: v.object({
    results: v.array(v.object({
      success: v.boolean(),
      postUrn: v.string(),
      comments: v.array(v.object({
        actorUrn: v.string(),
        text: v.string(),
        createdAt: v.number(),
        commentUrn: v.optional(v.string()),
        isReply: v.boolean(),
        likeCount: v.number(),
      })),
      total: v.number(),
      error: v.optional(v.string()),
    })),
    totalComments: v.number(),
    postsWithComments: v.number(),
  }),
  handler: async (_ctx, args) => {
    // Default to org token — r_member_social is closed, personal comments can't be fetched
    const useOrg = args.useOrgToken !== false;
    const accessToken = useOrg
      ? process.env.LINKEDIN_ORG_ACCESS_TOKEN
      : process.env.LINKEDIN_ACCESS_TOKEN;

    if (!accessToken) {
      return {
        results: [],
        totalComments: 0,
        postsWithComments: 0,
      };
    }

    const results: LinkedInCommentsResult[] = [];
    let totalComments = 0;
    let postsWithComments = 0;

    for (const postUrn of args.postUrns) {
      // Rate limit: 350ms between requests
      if (results.length > 0) {
        await new Promise((r) => setTimeout(r, 350));
      }

      const result = await fetchCommentsFromLinkedIn(accessToken, postUrn);
      results.push(result);

      if (result.success && result.total > 0) {
        totalComments += result.total;
        postsWithComments++;
      }
    }

    console.log(`[fetchPostComments] Fetched comments for ${args.postUrns.length} posts: ${totalComments} comments across ${postsWithComments} posts`);

    return { results, totalComments, postsWithComments };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Organization Page Posting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a text post on the LinkedIn Organization Page.
 * Uses LINKEDIN_ORG_ACCESS_TOKEN and LINKEDIN_ORG_ID env vars.
 */
export const createOrgTextPost = internalAction({
  args: {
    text: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    postUrn: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args): Promise<LinkedInPostResult> => {
    const accessToken = process.env.LINKEDIN_ORG_ACCESS_TOKEN;
    const orgId = process.env.LINKEDIN_ORG_ID;

    if (!accessToken || !orgId) {
      return {
        success: false,
        error: "LinkedIn organization not configured. Set LINKEDIN_ORG_ACCESS_TOKEN and LINKEDIN_ORG_ID in Convex environment.",
      };
    }

    const orgUrn = `urn:li:organization:${orgId}`;

    try {
      return await postToLinkedIn(accessToken, orgUrn, args.text);
    } catch (error) {
      console.error("[LinkedIn] Org post creation error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create org post",
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Engagement Quality Gate
// ═══════════════════════════════════════════════════════════════════════════

export interface EngagementGateResult {
  passed: boolean;
  failures: string[];
  softWarnings: string[];
}

const REPORT_HEADER_PATTERNS = [
  /^nodebench ai/i,
  /^daily intelligence brief/i,
  /^vc (deal flow|intelligence) (memo|brief)/i,
  /^fda regulatory update/i,
  /^tech intelligence brief/i,
  /^funding (brief|tracker|intelligence)/i,
  /^research (highlight|intelligence|brief)/i,
  /^clinical trial/i,
  /^m&a (activity|intelligence|brief)/i,
  /^weekly (source|intelligence|research)/i,
];

const GENERIC_HASHTAGS = [
  "#ai", "#techintelligence", "#dailybrief", "#nodebenchai",
  "#technews", "#machinelearning", "#factcheck",
];

export function validatePostEngagement(text: string): EngagementGateResult {
  const failures: string[] = [];
  const softWarnings: string[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const firstTwoLines = lines.slice(0, 2).join(" ").toLowerCase();

  // 1. noReportHeader: First 2 lines must NOT be a title card
  for (const pattern of REPORT_HEADER_PATTERNS) {
    if (pattern.test(firstTwoLines)) {
      failures.push(`noReportHeader: First lines match report header pattern "${pattern.source}". LinkedIn shows ~2 lines before fold - use a hook, not a label.`);
      break;
    }
  }

  // 2. hasHook: First sentence should be a claim/stat/take, not a date or label
  const firstLine = lines[0] || "";
  const isDateLine = /^date:|^\d{4}-\d{2}-\d{2}|^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i.test(firstLine);
  const isLabelLine = /^(curated|powered by|autonomous|daily|weekly|intelligence|summary|overview)/i.test(firstLine);
  if (isDateLine || isLabelLine) {
    failures.push(`hasHook: First line "${firstLine.substring(0, 60)}..." is a date/label, not a hook. Lead with a surprising claim or stat.`);
  }

  // 3. noWallOfText: No more than 3 consecutive structured blocks
  let consecutiveStructured = 0;
  let maxConsecutive = 0;
  for (const line of lines) {
    const isStructured = /^[\d]+[.)]|^[-*>]|^[A-Z]{2,}[:\s]|^={3,}|^#{1,3}\s/.test(line);
    if (isStructured) {
      consecutiveStructured++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveStructured);
    } else {
      consecutiveStructured = 0;
    }
  }
  if (maxConsecutive > 5) {
    failures.push(`noWallOfText: ${maxConsecutive} consecutive structured lines detected. Break with a 1-sentence observation between sections.`);
  }

  // 4. hasQuestion: Post must contain at least one genuine question
  const hasQuestion = /\?/.test(text) && !/^(source|read more|link|url|see|powered|#)/im.test(
    text.split("?")[0].split("\n").pop() || ""
  );
  if (!hasQuestion) {
    failures.push("hasQuestion: No question found. Ask the audience something specific to drive comments.");
  }

  // 5. noGenericHashtags: Check for bot-magnet hashtags used alone
  const hashtags = text.match(/#\w+/g)?.map(h => h.toLowerCase()) || [];
  const genericOnly = hashtags.length > 0 && hashtags.every(h => GENERIC_HASHTAGS.includes(h));
  if (genericOnly && hashtags.length > 0) {
    failures.push(`noGenericHashtags: All hashtags are generic (${hashtags.join(", ")}). Use content-specific tags like #Medtronic, #FDAApproval, #SeriesB.`);
  }

  // 6. underCharLimit: Max 1500 chars for org page posts
  if (text.length > 1500) {
    failures.push(`underCharLimit: Post is ${text.length} chars (max 1500). Shorter posts get higher LinkedIn engagement. Cut the fluff.`);
  }

  // 7. hasOpinion: Must have interpretive language
  const opinionPatterns = [
    /this (signals?|means?|suggests?|implies?|shows?)/i,
    /the real (story|question|issue|takeaway)/i,
    /watch (for|out|this)/i,
    /here'?s (what|why|the)/i,
    /my (take|read|view|bet)/i,
    /i (think|believe|expect|predict)/i,
    /what matters (here|most|is)/i,
    /the (bigger|real|key) (picture|point|insight)/i,
    /don'?t sleep on/i,
    /underrated|overlooked|overhyped/i,
    /bottom line/i,
    /so what\??/i,
  ];
  const hasOpinion = opinionPatterns.some(p => p.test(text));
  if (!hasOpinion) {
    failures.push("hasOpinion: No interpretive statement found. Add a take: 'This signals...', 'The real story here...', 'Watch for...'");
  }

  // Soft checks (logged, not blocking)
  const mentionsPeople = /@\w+/.test(text) || /\b(CEO|CTO|founder|partner)\s+\w+\s+\w+/i.test(text);
  if (!mentionsPeople) {
    softWarnings.push("mentionsPeople: No specific people or companies tagged. Tagging increases reply probability.");
  }

  const lastLine = lines[lines.length - 1] || "";
  const hasCallToAction = /\?$/.test(lastLine) || /what (do you|are you|would you)|anyone (seeing|else)|thoughts\??|agree\??/i.test(lastLine);
  if (!hasCallToAction) {
    softWarnings.push("hasCallToAction: Post doesn't end with a call to action. Try ending with a specific question.");
  }

  return {
    passed: failures.length === 0,
    failures,
    softWarnings,
  };
}

/**
 * Targeted text post router - posts to personal profile or organization page.
 * Reads LINKEDIN_DEFAULT_TARGET env var as fallback when no target specified.
 */
export const createTargetedTextPost = internalAction({
  args: {
    text: v.string(),
    target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
    skipEngagementGate: v.optional(v.boolean()),
    // Callers can pass metadata for held post logging
    postType: v.optional(v.string()),
    persona: v.optional(v.string()),
    dateString: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    postUrn: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    target: v.optional(v.string()),
    held: v.optional(v.boolean()),
    gateFailures: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    const effectiveTarget = args.target
      || (process.env.LINKEDIN_DEFAULT_TARGET as "personal" | "organization")
      || "personal";

    // Run engagement quality gate for org posts (personal posts are exempt)
    if (effectiveTarget === "organization" && !args.skipEngagementGate) {
      const gate = validatePostEngagement(args.text);

      if (gate.softWarnings.length > 0) {
        console.log(`[engagementGate] Soft warnings: ${gate.softWarnings.join("; ")}`);
      }

      if (!gate.passed) {
        console.warn(`[engagementGate] HELD - ${gate.failures.length} failures: ${gate.failures.join("; ")}`);

        // Log held post for review
        await ctx.runMutation(
          internal.workflows.dailyLinkedInPostMutations.logHeldPost,
          {
            dateString: args.dateString || new Date().toISOString().split("T")[0],
            persona: args.persona || "unknown",
            postType: args.postType || "unknown",
            content: args.text,
            target: effectiveTarget,
            failures: gate.failures,
            softWarnings: gate.softWarnings,
          },
        );

        return {
          success: false,
          error: `Engagement gate: ${gate.failures.length} check(s) failed. Post held for rewrite. Failures: ${gate.failures.join(" | ")}`,
          target: "organization",
          held: true,
          gateFailures: gate.failures,
        };
      }
    }

    if (effectiveTarget === "organization") {
      const result = await ctx.runAction(
        internal.domains.social.linkedinPosting.createOrgTextPost,
        { text: args.text },
      );
      return { ...result, target: "organization" };
    }

    // Personal profile fallback
    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!accessToken) {
      return {
        success: false,
        error: "LINKEDIN_ACCESS_TOKEN not set in Convex environment.",
        target: "personal",
      };
    }

    const userInfo = await fetchLinkedInUserInfo(accessToken);
    if (!userInfo) {
      return {
        success: false,
        error: "Could not fetch LinkedIn personal profile info.",
        target: "personal",
      };
    }

    const personUrn = `urn:li:person:${userInfo.sub}`;
    try {
      const result = await postToLinkedIn(accessToken, personUrn, args.text);
      return { ...result, target: "personal" };
    } catch (error) {
      console.error("[LinkedIn] Personal post creation error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create personal post",
        target: "personal",
      };
    }
  },
});

/**
 * Test the engagement quality gate against a post without actually posting.
 * Use: npx convex run domains/social/linkedinPosting:testEngagementGate '{"text":"..."}'
 */
// ═══════════════════════════════════════════════════════════════════════════
// Queue Processor - Posts scheduled items when they're due
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process the next due item from the content queue.
 * Called by cron every hour.
 */
export const processQueuedPost = internalAction({
  args: {},
  handler: async (ctx) => {
    const dueItems = await ctx.runQuery(
      internal.domains.social.linkedinContentQueue.getScheduledDueNow,
      {},
    );

    if (dueItems.length === 0) {
      return { processed: false, posted: false, reason: "no_posts_due" };
    }

    // Pick highest priority item (already sorted by query)
    const item = dueItems[0];

    console.log(`[queueProcessor] Processing ${item._id}: ${item.postType} (priority=${item.priority})`);

    // ── Pre-post verification (freshness, variety, claims, staleness) ──
    try {
      const verification = await ctx.runAction(
        internal.domains.social.linkedinPrePostVerification.verifyBeforePosting,
        {
          queueId: item._id,
          content: item.content,
          postType: item.postType,
          persona: item.persona,
          target: item.target,
          createdAt: item.createdAt ?? item._creationTime,
        },
      );

      if (!verification.passed) {
        console.log(`[queueProcessor] Verification FAILED for ${item._id}: ${verification.reason}`);

        const newStatus = verification.suggestedAction === "regenerate"
          ? "needs_rewrite" as const
          : "failed" as const;

        await ctx.runMutation(
          internal.domains.social.linkedinContentQueue.updateQueueStatus,
          { queueId: item._id, status: newStatus },
        );

        return {
          processed: true,
          posted: false,
          reason: `verification_failed: ${verification.reason}`,
          queueId: item._id,
        };
      }

      console.log(`[queueProcessor] Verification PASSED for ${item._id} (${verification.checks.length} checks)`);
    } catch (verifyError) {
      // Verification errors are non-blocking — log and continue to post
      console.warn(`[queueProcessor] Verification error (non-blocking): ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`);
    }

    try {
      const postResult = await ctx.runAction(
        internal.domains.social.linkedinPosting.createTargetedTextPost,
        {
          text: item.content,
          target: item.target,
          skipEngagementGate: true, // Already passed judge
          postType: item.postType,
          persona: item.persona,
          dateString: new Date().toISOString().split("T")[0],
        },
      );

      if (postResult.success) {
        await ctx.runMutation(
          internal.domains.social.linkedinContentQueue.updateQueueStatus,
          {
            queueId: item._id,
            status: "posted",
            postedPostId: postResult.postUrn,
            postedPostUrl: postResult.postUrl,
          },
        );

        // Log to archive
        await ctx.runMutation(
          internal.workflows.dailyLinkedInPostMutations.logLinkedInPost,
          {
            dateString: new Date().toISOString().split("T")[0],
            persona: item.persona,
            postId: postResult.postUrn ?? "",
            postUrl: postResult.postUrl ?? "",
            content: item.content,
            factCheckCount: 0,
            postType: item.postType,
            target: item.target,
            metadata: {
              queueId: item._id,
              source: item.source,
              ...(item.metadata ?? {}),
            },
          },
        );

        console.log(`[queueProcessor] Posted: ${postResult.postUrl}`);
        return { processed: true, posted: true, queueId: item._id };
      } else {
        await ctx.runMutation(
          internal.domains.social.linkedinContentQueue.updateQueueStatus,
          { queueId: item._id, status: "failed" },
        );
        console.error(`[queueProcessor] Post failed: ${postResult.error}`);
        return { processed: true, posted: false, reason: postResult.error, queueId: item._id };
      }
    } catch (error) {
      await ctx.runMutation(
        internal.domains.social.linkedinContentQueue.updateQueueStatus,
        { queueId: item._id, status: "failed" },
      );
      console.error(`[queueProcessor] Error:`, error);
      return {
        processed: true,
        posted: false,
        reason: error instanceof Error ? error.message : "Unknown error",
        queueId: item._id,
      };
    }
  },
});

export const testEngagementGate = internalAction({
  args: {
    text: v.string(),
  },
  returns: v.object({
    passed: v.boolean(),
    failures: v.array(v.string()),
    softWarnings: v.array(v.string()),
    charCount: v.number(),
  }),
  handler: async (_ctx, args) => {
    const result = validatePostEngagement(args.text);
    console.log(`[testEngagementGate] ${result.passed ? "PASSED" : "FAILED"} (${result.failures.length} failures, ${result.softWarnings.length} warnings, ${args.text.length} chars)`);
    return {
      ...result,
      charCount: args.text.length,
    };
  },
});
