import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";

/**
 * Ingest an Instagram post by URL
 * User: "Ingest this instagram post: https://www.instagram.com/p/..."
 */
export const ingestInstagramPost = createTool({
    description: "Ingest an Instagram post (image, video, or reel) by URL. This tool fetches the post metadata, downloads media, transcribes video content (using Gemini), and extracts claims. Use this when the user asks to analyze, read, or process a specific Instagram link.",
    args: z.object({
        postUrl: z.string().describe("The full URL of the Instagram post or reel"),
    }),
    handler: async (ctx, args): Promise<string> => {
        console.log(`[ingestInstagramPost] Ingesting: ${args.postUrl}`);

        try {
            // Call the public action
            // We use api.domains... because ingestPost is an action, not internalAction
            const result = await ctx.runAction(api.domains.social.instagramIngestion.ingestPost, {
                postUrl: args.postUrl,
            });

            if (!result.success) {
                return `Failed to start ingestion: ${result.error}`;
            }

            return `Successfully started ingestion for Instagram post.\nPost ID: ${result.postId}\n\nThe system is now fetching metadata, transcribing video (if applicable), and extracting claims in the background. You can check the status by asking "Show me my Instagram posts" or "Check status of post ${result.postId}".`;
        } catch (error) {
            console.error("[ingestInstagramPost] Error:", error);
            return `Error triggering ingestion: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
});

/**
 * List ingested Instagram posts
 * User: "Show my instagram posts"
 */
export const listInstagramPosts = createTool({
    description: "List recently ingested Instagram posts and their status. Use this to check if a post has finished processing or to see previously analyzed content.",
    args: z.object({
        limit: z.number().optional().describe("Max number of posts to return (default 10)"),
        status: z.enum(["pending", "transcribing", "analyzing", "completed", "error"]).optional().describe("Filter by status"),
    }),
    handler: async (ctx, args): Promise<string> => {
        const posts = await ctx.runQuery(api.domains.social.instagramIngestion.listPosts, {
            limit: args.limit ?? 10,
            status: args.status,
        });

        if (posts.length === 0) {
            return "No Instagram posts found.";
        }

        let output = `Found ${posts.length} posts:\n\n`;
        for (const post of posts) {
            const title = post.caption ? post.caption.slice(0, 50) + "..." : (post.shortcode || "No Title");
            output += `- [${post.status.toUpperCase()}] ${title}\n`;
            output += `  ID: ${post._id}\n`;
            output += `  URL: ${post.postUrl}\n`;
            if (post.status === "completed" && post.extractedClaims?.length) {
                output += `  Claims: ${post.extractedClaims.length} extracted\n`;
            }
            if (post.errorMessage) {
                output += `  Error: ${post.errorMessage}\n`;
            }
            output += "\n";
        }

        return output;
    },
});
