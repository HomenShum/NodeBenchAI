import { Polar } from "@convex-dev/polar";
import { action, query } from "../../_generated/server";
import { components } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

// Initialize Polar client with proper typing
export const polar = new Polar(components.polar, {
  // Provide the current user's ID and email (action-safe; no DB access)
  getUserInfo: async (ctx: any) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return {
      userId: identity.subject,
      email: identity.email ?? undefined,
    };
  },
  // Configure your Polar products
  // Get product IDs from your Polar dashboard
  products: {
    // Example: Map your product keys to Polar product IDs
    supporterOneTime: ((globalThis as any)?.process?.env?.POLAR_PRODUCT_ID_SUPPORTER as string | undefined) || "",
    // Add more products as needed:
    // supporterMonthly: "prod_xxxx",
    // supporterYearly: "prod_yyyy",
  },
  // Optional: Override environment variables if needed
  // organizationToken: process.env.POLAR_ORGANIZATION_TOKEN,
  // webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
  // server: "production", // or "sandbox" for testing
});

// Export Polar API functions
export const {
  generateCheckoutLink,
  generateCustomerPortalUrl,
  getConfiguredProducts,
  listAllProducts,
  changeCurrentSubscription,
  cancelCurrentSubscription,
} = polar.api();

// Action to sync existing products from Polar
export const syncProducts = action({
  args: {},
  handler: async (ctx) => {
    await polar.syncProducts(ctx);
  },
});

// Query to get current user's subscription
export const getCurrentUserSubscription = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await polar.getCurrentSubscription(ctx, { userId });
  },
});