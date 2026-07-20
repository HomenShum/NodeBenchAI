import { action, internalMutation, query } from "../../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "../../../_generated/api";
import { polar } from "../polar";
import type { Doc } from "../../../_generated/dataModel";

// Plans
type Plan = "free" | "supporter";
const FREE_PLAN: Plan = "free";
const SUPPORTER_PLAN: Plan = "supporter";

export const getSubscription = query({
  args: {},
  returns: v.object({
    plan: v.union(v.literal(FREE_PLAN), v.literal(SUPPORTER_PLAN)),
    status: v.union(v.literal("none"), v.literal("active"), v.literal("canceled")),
    activatedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { plan: FREE_PLAN, status: "none" as const };
    }
    // Prefer Polar subscription state if available
    try {
      const current: any = await polar.getCurrentSubscription(ctx, { userId });
      if (current && current.status === "active") {
        return {
          plan: SUPPORTER_PLAN,
          status: "active" as const,
          activatedAt: typeof current.currentPeriodStart === "number" ? current.currentPeriodStart : undefined,
          updatedAt: typeof current.currentPeriodEnd === "number" ? current.currentPeriodEnd : undefined,
        };
      }
    } catch {
      // Ignore and fall back to local table (dev/Stripe path)
    }

    // Fallback to local dev/Stripe subscription record
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .first() as Doc<"subscriptions"> | null;
    if (!sub) return { plan: FREE_PLAN, status: "none" as const };
    return {
      plan: (sub.plan as Plan) ?? FREE_PLAN,
      status: "active" as const,
      activatedAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  },
});

// Prefer Polar for checkout if configured; otherwise fall back to Stripe/dev
export const createPolarCheckout = action({
  args: { successUrl: v.string() },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { successUrl }): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const env = (((globalThis as any)["process"]?.env) ?? {}) as Record<string, string | undefined>;
    const origin: string | undefined = env.APP_BASE_URL || undefined;
    const POLAR_PRODUCT_ID: string | undefined = env.POLAR_PRODUCT_ID_SUPPORTER;

    if (POLAR_PRODUCT_ID) {
      try {
        const { url } = await ctx.runAction(api.domains.integrations.polar.generateCheckoutLink, {
          productIds: [POLAR_PRODUCT_ID],
          successUrl,
          origin,
        } as any);
        return { url };
      } catch (err) {
        console.warn("Polar checkout failed, falling back to Stripe/dev:", err);
        // fallthrough to Stripe/dev below
      }
    }

    // Fallback: inline Stripe/dev flow (mirror createCheckoutSession)
    const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
    const PRICE_ID = env.STRIPE_PRICE_ID;

    const retOrigin = origin || "";
    const success = retOrigin
      ? `${retOrigin}/api/billing/success?session_id={CHECKOUT_SESSION_ID}`
      : "/api/billing/success?session_id={CHECKOUT_SESSION_ID}";
    const cancel = retOrigin ? `${retOrigin}/?billing=canceled` : "/?billing=canceled";

    if (!STRIPE_SECRET_KEY) {
      const _result: null = await ctx.runMutation(internal.domains.billing.billing.activateSubscription, {
        userId,
        source: "dev",
      });
      const upgradedUrl = retOrigin ? `${retOrigin}/?billing=upgraded` : "/?billing=upgraded";
      return { url: upgradedUrl };
    }

    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.append("payment_method_types[]", "card");
    body.set("success_url", success);
    body.set("cancel_url", cancel);
    body.set("metadata[userId]", String(userId));

    if (PRICE_ID) {
      body.set("line_items[0][price]", PRICE_ID);
      body.set("line_items[0][quantity]", "1");
    } else {
      body.set("line_items[0][price_data][currency]", "usd");
      body.set("line_items[0][price_data][product_data][name]", "Nodebench Supporter Unlock");
      body.set("line_items[0][price_data][unit_amount]", "100");
      body.set("line_items[0][quantity]", "1");
    }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stripe error: ${text}`);
    }
    const session = (await res.json()) as { url?: string };
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },
});

export const createCheckoutSession = action({
  args: { returnUrl: v.optional(v.string()) },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { returnUrl }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Note: We intentionally don't read the DB here (actions can't access db).
    // If the user is already active and still triggers checkout, Stripe/dev route
    // can redirect back with a no-op; this keeps the action simple and safe.

    const env2 = (((globalThis as any)["process"]?.env) ?? {}) as Record<string, string | undefined>;
    const STRIPE_SECRET_KEY = env2.STRIPE_SECRET_KEY;
    const PRICE_ID = env2.STRIPE_PRICE_ID; // optional; can fallback to price_data

    const origin = returnUrl || env2.APP_BASE_URL || "";
    const successUrl = origin ? `${origin}/api/billing/success?session_id={CHECKOUT_SESSION_ID}` : "/api/billing/success?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl = origin ? `${origin}/?billing=canceled` : "/?billing=canceled";

    // Free-tier friendly DEV fallback: no Stripe configured
    if (!STRIPE_SECRET_KEY) {
      // Activate immediately server-side, then send user back to the app.
      const _result: null = await ctx.runMutation(internal.domains.billing.billing.activateSubscription, {
        userId,
        source: "dev",
      });
      const upgradedUrl = origin ? `${origin}/?billing=upgraded` : "/?billing=upgraded";
      return { url: upgradedUrl };
    }

    // Create a Checkout Session via Stripe's REST API
    const body = new URLSearchParams();
    body.set("mode", "payment"); // one-time $1 supporter unlock
    body.append("payment_method_types[]", "card");
    body.set("success_url", successUrl);
    body.set("cancel_url", cancelUrl);
    body.set("metadata[userId]", String(userId));

    if (PRICE_ID) {
      body.set("line_items[0][price]", PRICE_ID);
      body.set("line_items[0][quantity]", "1");
    } else {
      // Fallback: inline $1 USD price
      body.set("line_items[0][price_data][currency]", "usd");
      body.set("line_items[0][price_data][product_data][name]", "Nodebench Supporter Unlock");
      body.set("line_items[0][price_data][unit_amount]", "100"); // $1.00
      body.set("line_items[0][quantity]", "1");
    }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stripe error: ${text}`);
    }
    const session = (await res.json()) as { url?: string };
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },
});

export const activateSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    source: v.string(),
    sessionId: v.optional(v.string()),
    paymentIntentId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, source: _source, sessionId, paymentIntentId }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"subscriptions"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        plan: SUPPORTER_PLAN,
        status: "active",
        updatedAt: now,
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        userId,
        plan: SUPPORTER_PLAN,
        status: "active",
        createdAt: now,
        updatedAt: now,
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
      } as any);
    }

    return null;
  },
});
