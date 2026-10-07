import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";

/**
 * Post to LinkedIn
 * User: "Post this to LinkedIn: ..."
 * User: "Share on LinkedIn: ..."
 */
export const postToLinkedIn = createTool({
  description: "Create a post on LinkedIn. Can target the user's personal profile or the organization company page. Defaults to personal profile for agent-initiated posts. Use target 'organization' for automated/brand content.",
  args: z.object({
    text: z.string().describe("The text content of the post (max 3000 characters)"),
    imageUrl: z.string().optional().describe("Optional URL of an image to include in the post"),
    altText: z.string().optional().describe("Alt text for the image (for accessibility)"),
    target: z.enum(["personal", "organization"]).optional().describe("Where to post: 'personal' for user's profile (default), 'organization' for the company page"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const target = args.target ?? "personal";
    console.log(`[postToLinkedIn] Creating ${target} post with ${args.text.length} chars`);

    try {
      // Organization page posting - uses env vars, no user auth needed
      if (target === "organization") {
        const result = await ctx.runAction(internal.domains.social.linkedinPosting.createTargetedTextPost, {
          text: args.text,
          target: "organization",
        });

        if (!result.success) {
          return `Failed to create organization LinkedIn post: ${result.error}`;
        }

        let response = `Successfully posted to organization page!`;
        if (result.postUrl) {
          response += `\n\nView the post: ${result.postUrl}`;
        }
        if (result.postUrn) {
          response += `\nPost URN: ${result.postUrn}`;
        }
        return response;
      }

      // Personal profile posting - requires user auth
      const account = await ctx.runQuery(api.domains.social.linkedinAccounts.getLinkedInAccount, {});

      if (!account) {
        return `LinkedIn account not connected.

To post to LinkedIn, you need to connect your account first:
1. Go to Settings > Integrations
2. Click "Connect LinkedIn"
3. Authorize NodeBench AI to post on your behalf

Required OAuth scopes: w_member_social, openid, email

Required environment variables (set in Convex dashboard):
- LINKEDIN_CLIENT_ID
- LINKEDIN_CLIENT_SECRET`;
      }

      if (account.isExpired) {
        return `LinkedIn access token has expired. Please reconnect your LinkedIn account in Settings > Integrations.`;
      }

      // Create the post on personal profile
      let result;
      if (args.imageUrl) {
        result = await ctx.runAction(api.domains.social.linkedinPosting.createImagePost, {
          text: args.text,
          imageUrl: args.imageUrl,
          altText: args.altText,
        });
      } else {
        result = await ctx.runAction(api.domains.social.linkedinPosting.createTextPost, {
          text: args.text,
        });
      }

      if (!result.success) {
        return `Failed to create LinkedIn post: ${result.error}`;
      }

      let response = `Successfully posted to your personal LinkedIn!`;
      if (result.postUrl) {
        response += `\n\nView your post: ${result.postUrl}`;
      }
      if (result.postUrn) {
        response += `\nPost URN: ${result.postUrn}`;
      }

      return response;
    } catch (error) {
      console.error("[postToLinkedIn] Error:", error);
      return `Error creating LinkedIn post: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Check LinkedIn connection status
 * User: "Am I connected to LinkedIn?"
 * User: "Check my LinkedIn connection"
 */
export const checkLinkedInStatus = createTool({
  description: "Check if the user has connected their LinkedIn account and the current status of that connection.",
  args: z.object({}),
  handler: async (ctx): Promise<string> => {
    try {
      const account = await ctx.runQuery(api.domains.social.linkedinAccounts.getLinkedInAccount, {});

      if (!account) {
        return `LinkedIn is not connected.

To connect your LinkedIn account:
1. Go to Settings > Integrations
2. Click "Connect LinkedIn"
3. Authorize NodeBench AI with the following permissions:
   - w_member_social (to post on your behalf)
   - openid, email (for authentication)`;
      }

      let status = `LinkedIn Connected\n`;
      status += `─────────────────\n`;

      if (account.displayName) {
        status += `Name: ${account.displayName}\n`;
      }
      if (account.email) {
        status += `Email: ${account.email}\n`;
      }
      if (account.personUrn) {
        status += `Profile URN: ${account.personUrn}\n`;
      }
      if (account.scope) {
        status += `Permissions: ${account.scope}\n`;
      }

      if (account.isExpired) {
        status += `\n⚠️ Access token EXPIRED - please reconnect in Settings`;
      } else if (account.expiresAt) {
        const expiresDate = new Date(account.expiresAt);
        const daysUntilExpiry = Math.ceil((account.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
        status += `\nExpires: ${expiresDate.toLocaleDateString()} (${daysUntilExpiry} days)`;
      }

      return status;
    } catch (error) {
      console.error("[checkLinkedInStatus] Error:", error);
      return `Error checking LinkedIn status: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Disconnect LinkedIn account
 * User: "Disconnect my LinkedIn"
 * User: "Remove LinkedIn connection"
 */
export const disconnectLinkedIn = createTool({
  description: "Disconnect the user's LinkedIn account from NodeBench AI.",
  args: z.object({}),
  handler: async (ctx): Promise<string> => {
    try {
      const result = await ctx.runMutation(api.domains.social.linkedinAccounts.disconnectLinkedIn, {});

      if (result.success) {
        return `LinkedIn account disconnected successfully. You can reconnect anytime from Settings > Integrations.`;
      }

      return `Failed to disconnect LinkedIn account. Please try again.`;
    } catch (error) {
      console.error("[disconnectLinkedIn] Error:", error);
      return `Error disconnecting LinkedIn: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
