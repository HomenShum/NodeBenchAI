/**
 * Instagram Ingestion Module
 * 
 * Fetches Instagram posts, transcribes video content using Gemini,
 * and extracts claims for analysis.
 */

import { v } from "convex/values";
import { action, mutation, query, internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface InstagramMetadata {
    shortcode: string;
    mediaType: "image" | "video" | "carousel";
    caption?: string;
    thumbnailUrl?: string;
    authorUsername?: string;
    authorFullName?: string;
    likeCount?: number;
    commentCount?: number;
    postedAt?: number;
    mediaUrls: string[];
}

interface ExtractedClaim {
    claim: string;
    confidence: number;
    sourceTimestamp?: number;
    category?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public Actions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ingest an Instagram post by URL.
 * Fetches metadata, downloads media, transcribes video, and extracts claims.
 */
export const ingestPost = action({
    args: {
        postUrl: v.string(),
    },
    returns: v.object({
        success: v.boolean(),
        postId: v.optional(v.id("instagramPosts")),
        error: v.optional(v.string()),
    }),
    handler: async (ctx, args): Promise<{ success: boolean; postId?: Id<"instagramPosts">; error?: string }> => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            return { success: false, error: "Not authenticated" };
        }

        // Validate URL format
        if (!isValidInstagramUrl(args.postUrl)) {
            return { success: false, error: "Invalid Instagram URL" };
        }

        // Check for existing post
        const existing = await ctx.runQuery(internal.domains.social.instagramIngestion.getPostByUrl, {
            postUrl: args.postUrl,
        });
        if (existing) {
            return { success: true, postId: existing._id };
        }

        // Create pending record
        const postId = await ctx.runMutation(internal.domains.social.instagramIngestion.createPendingPost, {
            userId,
            postUrl: args.postUrl,
        });

        // Fetch metadata (background job)
        await ctx.scheduler.runAfter(0, internal.domains.social.instagramIngestion.processPost, {
            postId,
        });

        return { success: true, postId };
    },
});

/**
 * Get all ingested posts for the current user.
 */
export const listPosts = query({
    args: {
        limit: v.optional(v.number()),
        status: v.optional(v.union(
            v.literal("pending"),
            v.literal("transcribing"),
            v.literal("analyzing"),
            v.literal("completed"),
            v.literal("error")
        )),
    },
    returns: v.array(v.any()),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return [];

        const query = ctx.db
            .query("instagramPosts")
            .withIndex("by_user", (q) => q.eq("userId", userId));

        const posts = await query.collect();

        let filtered = args.status
            ? posts.filter((p) => p.status === args.status)
            : posts;

        if (args.limit) {
            filtered = filtered.slice(0, args.limit);
        }

        return filtered;
    },
});

/**
 * Get a single post with full details.
 */
export const getPost = query({
    args: { postId: v.id("instagramPosts") },
    returns: v.any(),
    handler: async (ctx, args) => {
        return await ctx.db.get(args.postId);
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Internal Actions
// ═══════════════════════════════════════════════════════════════════════════

export const getPostByUrl = query({
    args: { postUrl: v.string() },
    returns: v.any(),
    handler: async (ctx, args) => {
        return await ctx.db
            .query("instagramPosts")
            .withIndex("by_url", (q) => q.eq("postUrl", args.postUrl))
            .first();
    },
});

/**
 * List all posts (internal, for verification system).
 * Returns all posts without authentication check.
 */
export const listAllPosts = query({
    args: {},
    returns: v.array(v.any()),
    handler: async (ctx) => {
        return await ctx.db.query("instagramPosts").collect();
    },
});

export const createPendingPost = internalMutation({
    args: {
        userId: v.id("users"),
        postUrl: v.string(),
    },
    returns: v.id("instagramPosts"),
    handler: async (ctx, args): Promise<Id<"instagramPosts">> => {
        const shortcode = extractShortcode(args.postUrl);

        return await ctx.db.insert("instagramPosts", {
            userId: args.userId,
            postUrl: args.postUrl,
            shortcode,
            mediaType: "image", // Default, will be updated
            fetchedAt: Date.now(),
            status: "pending",
        });
    },
});

export const processPost = internalAction({
    args: { postId: v.id("instagramPosts") },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        // Step 1: Fetch metadata
        const post = await ctx.runQuery(internal.domains.social.instagramIngestion.getPost, {
            postId: args.postId,
        });

        if (!post) {
            console.error(`[InstagramIngestion] Post not found: ${args.postId}`);
            return null;
        }

        try {
            // Step 2: Fetch Instagram metadata (mock for now)
            // In production, use browser automation or Instagram API
            const metadata = await fetchInstagramMetadata(post.postUrl);

            await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostMetadata, {
                postId: args.postId,
                metadata,
            });

            // Step 3: If video, transcribe with Gemini
            if (metadata.mediaType === "video") {
                await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostStatus, {
                    postId: args.postId,
                    status: "transcribing",
                });

                // Call Gemini Video API via wrapper
                const result = await ctx.runAction(
                    internal.domains.agents.orchestrator.geminiVideoWrapper.transcribeVideo,
                    {
                        videoUrl: metadata.mediaUrls[0],
                        extractClaims: true,
                    }
                );

                if (result.success && result.transcript) {
                    await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostTranscript, {
                        postId: args.postId,
                        transcript: result.transcript,
                    });

                    // Update claims if extracted during transcription
                    if (result.claims) {
                        await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostClaims, {
                            postId: args.postId,
                            claims: result.claims,
                        });
                    }
                } else {
                    // Handle Gemini failure - check if it's a configuration issue
                    const errorMsg = result.error || "Video transcription failed";
                    console.error(`[InstagramIngestion] Gemini transcription failed: ${errorMsg}`);

                    // If it's an API key issue, fail fast with clear message
                    if (errorMsg.includes("API key not configured")) {
                        await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostError, {
                            postId: args.postId,
                            errorMessage: "Gemini API key not configured. Please add GEMINI_API_KEY to your environment variables.",
                        });
                        return null;
                    }

                    // For other errors, store the warning but continue (may still extract claims from caption)
                    await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostStatusWithWarning, {
                        postId: args.postId,
                        status: "analyzing",
                        warning: `Video transcription failed: ${errorMsg}`,
                    });
                }
            }

            // Step 4: For image/carousel posts, analyze with Gemini image API
            if (metadata.mediaType !== "video" && metadata.mediaUrls.length > 0) {
                await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostStatus, {
                    postId: args.postId,
                    status: "analyzing",
                });

                // Analyze first image (or iterate through carousel)
                const imageUrl = metadata.mediaUrls[0];
                const imageResult = await ctx.runAction(
                    internal.domains.agents.orchestrator.geminiVideoWrapper.analyzeImage,
                    {
                        imageUrl,
                        extractClaims: true,
                    }
                );

                if (imageResult.success) {
                    // Use image description as transcript equivalent
                    if (imageResult.description) {
                        await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostTranscript, {
                            postId: args.postId,
                            transcript: imageResult.description,
                        });
                    }

                    // Extract claims from image analysis
                    if (imageResult.claims && imageResult.claims.length > 0) {
                        await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostClaims, {
                            postId: args.postId,
                            claims: imageResult.claims.map((c: { claim: string; confidence: number; category?: string }) => ({
                                claim: c.claim,
                                confidence: c.confidence,
                                category: c.category,
                            })),
                        });
                    }
                } else {
                    // Handle Gemini failure for image analysis
                    const errorMsg = imageResult.error || "Image analysis failed";
                    console.warn(`[InstagramIngestion] Image analysis failed: ${errorMsg}`);

                    // If it's an API key issue, fail fast with clear message
                    if (errorMsg.includes("API key not configured")) {
                        await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostError, {
                            postId: args.postId,
                            errorMessage: "Gemini API key not configured. Please add GEMINI_API_KEY to your environment variables.",
                        });
                        return null;
                    }
                    // For other errors, continue but note the warning
                }
            }

            // If we have a caption but no claims extracted yet, analyze the caption
            if (metadata.caption) {
                const currentPost = await ctx.runQuery(internal.domains.social.instagramIngestion.getPost, {
                    postId: args.postId,
                });

                if (!currentPost?.extractedClaims || currentPost.extractedClaims.length === 0) {
                    const captionClaims = await extractClaimsWithLLM(metadata.caption);
                    if (captionClaims.length > 0) {
                        await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostClaims, {
                            postId: args.postId,
                            claims: captionClaims,
                        });
                    }
                }
            }

            // Step 5: Mark complete
            await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostStatus, {
                postId: args.postId,
                status: "completed",
            });

            // Step 6: Schedule fact verification for extracted claims (async)
            const finalPost = await ctx.runQuery(internal.domains.social.instagramIngestion.getPost, {
                postId: args.postId,
            });
            if (finalPost?.extractedClaims && finalPost.extractedClaims.length > 0) {
                console.log(`[InstagramIngestion] Scheduling verification for ${finalPost.extractedClaims.length} claims`);
                await ctx.scheduler.runAfter(0, internal.domains.verification.instagramClaimVerification.verifyInstagramClaims, {
                    postId: args.postId,
                    claims: finalPost.extractedClaims,
                });
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.domains.social.instagramIngestion.updatePostError, {
                postId: args.postId,
                errorMessage,
            });
        }

        return null;
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Internal Mutations for Status Updates
// ═══════════════════════════════════════════════════════════════════════════

export const updatePostMetadata = internalMutation({
    args: {
        postId: v.id("instagramPosts"),
        metadata: v.object({
            shortcode: v.string(),
            mediaType: v.union(v.literal("image"), v.literal("video"), v.literal("carousel")),
            caption: v.optional(v.string()),
            thumbnailUrl: v.optional(v.string()),
            authorUsername: v.optional(v.string()),
            authorFullName: v.optional(v.string()),
            likeCount: v.optional(v.number()),
            commentCount: v.optional(v.number()),
            postedAt: v.optional(v.number()),
            mediaUrls: v.array(v.string()),
        }),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        await ctx.db.patch(args.postId, {
            shortcode: args.metadata.shortcode,
            mediaType: args.metadata.mediaType,
            caption: args.metadata.caption,
            thumbnailUrl: args.metadata.thumbnailUrl,
            authorUsername: args.metadata.authorUsername,
            authorFullName: args.metadata.authorFullName,
            likeCount: args.metadata.likeCount,
            commentCount: args.metadata.commentCount,
            postedAt: args.metadata.postedAt,
        });
        return null;
    },
});

export const updatePostStatus = internalMutation({
    args: {
        postId: v.id("instagramPosts"),
        status: v.union(
            v.literal("pending"),
            v.literal("transcribing"),
            v.literal("analyzing"),
            v.literal("completed"),
            v.literal("error")
        ),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        await ctx.db.patch(args.postId, { status: args.status });
        return null;
    },
});

export const updatePostStatusWithWarning = internalMutation({
    args: {
        postId: v.id("instagramPosts"),
        status: v.union(
            v.literal("pending"),
            v.literal("transcribing"),
            v.literal("analyzing"),
            v.literal("completed"),
            v.literal("error")
        ),
        warning: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        await ctx.db.patch(args.postId, {
            status: args.status,
            errorMessage: args.warning,
        });
        return null;
    },
});

export const updatePostTranscript = internalMutation({
    args: {
        postId: v.id("instagramPosts"),
        transcript: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        await ctx.db.patch(args.postId, { transcript: args.transcript });
        return null;
    },
});

export const updatePostClaims = internalMutation({
    args: {
        postId: v.id("instagramPosts"),
        claims: v.array(v.object({
            claim: v.string(),
            confidence: v.number(),
            sourceTimestamp: v.optional(v.number()),
            category: v.optional(v.string()),
        })),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        await ctx.db.patch(args.postId, { extractedClaims: args.claims });
        return null;
    },
});

export const updatePostError = internalMutation({
    args: {
        postId: v.id("instagramPosts"),
        errorMessage: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        await ctx.db.patch(args.postId, {
            status: "error",
            errorMessage: args.errorMessage,
        });
        return null;
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function isValidInstagramUrl(url: string): boolean {
    const patterns = [
        /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+\/?$/,
        /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+\/?$/,
        /^https?:\/\/(www\.)?instagram\.com\/tv\/[\w-]+\/?$/,
    ];
    return patterns.some((pattern) => pattern.test(url));
}

function extractShortcode(url: string): string {
    const match = url.match(/\/(p|reel|tv)\/([\w-]+)/);
    return match ? match[2] : "";
}

/**
 * Fetch Instagram post metadata using Instagram's GraphQL API.
 * Falls back to oEmbed API if GraphQL fails.
 */
async function fetchInstagramMetadata(postUrl: string): Promise<InstagramMetadata> {
    console.log(`[InstagramIngestion] Fetching metadata for: ${postUrl}`);

    const shortcode = extractShortcode(postUrl);

    // Try GraphQL endpoint first (no auth required for public posts)
    try {
        const graphqlUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
        const response = await fetch(graphqlUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
                "X-IG-App-ID": "936619743392459", // Public web app ID
            },
        });

        if (response.ok) {
            const data = await response.json();
            const item = data?.items?.[0] || data?.graphql?.shortcode_media;

            if (item) {
                const mediaType = item.video_url ? "video" :
                    (item.carousel_media || item.edge_sidecar_to_children) ? "carousel" : "image";

                const mediaUrls: string[] = [];

                if (item.video_url) {
                    mediaUrls.push(item.video_url);
                } else if (item.carousel_media) {
                    for (const media of item.carousel_media) {
                        mediaUrls.push(media.video_url || media.image_versions2?.candidates?.[0]?.url || "");
                    }
                } else if (item.edge_sidecar_to_children?.edges) {
                    for (const edge of item.edge_sidecar_to_children.edges) {
                        const node = edge.node;
                        mediaUrls.push(node.video_url || node.display_url || "");
                    }
                } else {
                    const imageUrl = item.image_versions2?.candidates?.[0]?.url || item.display_url;
                    if (imageUrl) mediaUrls.push(imageUrl);
                }

                return {
                    shortcode,
                    mediaType,
                    caption: item.caption?.text || item.edge_media_to_caption?.edges?.[0]?.node?.text,
                    thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || item.display_url,
                    authorUsername: item.user?.username || item.owner?.username,
                    authorFullName: item.user?.full_name || item.owner?.full_name,
                    likeCount: item.like_count || item.edge_media_preview_like?.count,
                    commentCount: item.comment_count || item.edge_media_to_comment?.count,
                    postedAt: item.taken_at ? item.taken_at * 1000 : undefined,
                    mediaUrls: mediaUrls.filter(Boolean),
                };
            }
        }
    } catch (error) {
        console.log(`[InstagramIngestion] GraphQL fetch failed, trying oEmbed: ${error}`);
    }

    // Fallback to oEmbed API (limited data but reliable)
    try {
        const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(postUrl)}`;
        const response = await fetch(oembedUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; NodeBenchBot/1.0)",
            },
        });

        if (response.ok) {
            const data = await response.json();

            return {
                shortcode,
                mediaType: "image", // oEmbed doesn't tell us media type
                caption: data.title || undefined,
                thumbnailUrl: data.thumbnail_url,
                authorUsername: data.author_name,
                authorFullName: data.author_name,
                mediaUrls: data.thumbnail_url ? [data.thumbnail_url] : [],
            };
        }
    } catch (error) {
        console.log(`[InstagramIngestion] oEmbed fetch failed: ${error}`);
    }

    // Final fallback - return minimal data
    console.warn(`[InstagramIngestion] All fetch methods failed for ${postUrl}`);
    return {
        shortcode,
        mediaType: "image",
        caption: undefined,
        thumbnailUrl: undefined,
        authorUsername: undefined,
        mediaUrls: [],
    };
}

/**
 * Extract claims from text using pattern matching and heuristics.
 * For full LLM-based extraction, use the Gemini image/video analysis.
 */
async function extractClaimsWithLLM(text: string): Promise<ExtractedClaim[]> {
    console.log(`[InstagramIngestion] Extracting claims from text (${text.length} chars)`);

    if (!text || text.length < 20) return [];

    const claims: ExtractedClaim[] = [];

    // Pattern-based claim extraction
    const patterns = [
        // Financial claims: numbers with currency or percentages
        /(?:earned?|made?|raised?|worth|valued? at|costs?|priced? at)\s*\$?[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|k|M|B))?/gi,
        // Statistical claims
        /\d+(?:\.\d+)?%\s+(?:of|increase|decrease|growth|drop|rise)/gi,
        // Definitive statements
        /(?:studies? show|research proves?|scientists? found|experts? say|data shows?)/gi,
        // Product/health claims
        /(?:clinically proven|scientifically tested|FDA approved|doctor recommended)/gi,
    ];

    for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
            for (const match of matches.slice(0, 3)) { // Limit to 3 per pattern
                claims.push({
                    claim: match.trim(),
                    confidence: 0.6, // Lower confidence for pattern-based extraction
                    category: categorizeClaimText(match),
                });
            }
        }
    }

    // Look for statements with strong assertions
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    for (const sentence of sentences.slice(0, 5)) {
        const trimmed = sentence.trim();
        if (
            /\b(always|never|guaranteed|proven|100%|definitely|absolutely)\b/i.test(trimmed) ||
            /\b(will make you|can help you|is the best|is the only)\b/i.test(trimmed)
        ) {
            claims.push({
                claim: trimmed.substring(0, 200),
                confidence: 0.5,
                category: categorizeClaimText(trimmed),
            });
        }
    }

    // Deduplicate and return top claims
    const seen = new Set<string>();
    return claims.filter(c => {
        const key = c.claim.toLowerCase().substring(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 5);
}

function categorizeClaimText(text: string): string {
    const lower = text.toLowerCase();
    if (/\$|money|earn|income|invest|profit|revenue/i.test(lower)) return "financial";
    if (/health|medical|doctor|cure|treat|symptom/i.test(lower)) return "health";
    if (/product|buy|sale|price|discount/i.test(lower)) return "product";
    if (/study|research|scientist|data|prove/i.test(lower)) return "scientific";
    if (/vote|election|politic|government|law/i.test(lower)) return "political";
    return "general";
}
