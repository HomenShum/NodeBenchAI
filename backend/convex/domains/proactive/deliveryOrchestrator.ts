/**
 * Delivery Orchestrator
 * Coordinates opportunity delivery across all channels
 *
 * Flow:
 * 1. Get pending opportunities
 * 2. Evaluate each through policy gateway
 * 3. Deliver to approved channels (in-app, Slack, email)
 * 4. Track delivery status
 * 5. Handle errors and retries
 */

import { internalMutation, internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

/**
 * Deliver a single opportunity
 */
export const deliverOpportunity = internalAction({
  args: {
    opportunityId: v.id("opportunities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      // Get opportunity details
      const opportunity = await ctx.runQuery(async (ctx) => {
        return await ctx.db.get(args.opportunityId);
      });

      if (!opportunity) {
        throw new Error(`Opportunity ${args.opportunityId} not found`);
      }

      // Evaluate through policy gateway
      const decision = await ctx.runMutation(
        internal.domains.proactive.policyGateway.evaluateOpportunity,
        {
          opportunityId: args.opportunityId,
          userId: args.userId,
        }
      );

      if (!decision.approved) {
        console.log(
          `[DeliveryOrchestrator] Opportunity ${args.opportunityId} not approved: ${decision.reason}`
        );
        return {
          success: false,
          reason: decision.reason,
        };
      }

      console.log(
        `[DeliveryOrchestrator] Delivering opportunity ${args.opportunityId} to channels: ${decision.deliveryChannels.join(", ")}`
      );

      // Auto-generate email draft for follow-up opportunities
      if (opportunity.type === "follow_up" &&
          opportunity.suggestedActions?.[0]?.actionType === "suggest") {
        console.log(
          `[DeliveryOrchestrator] Generating email draft for follow-up opportunity ${args.opportunityId}`
        );
        try {
          await ctx.runAction(
            internal.domains.proactive.actions.emailDraftGenerator.generateEmailDraft,
            {
              opportunityId: args.opportunityId,
              userId: args.userId,
              actionMode: "suggest",
            }
          );
          console.log(
            `[DeliveryOrchestrator] Email draft generated successfully for opportunity ${args.opportunityId}`
          );
        } catch (error: any) {
          console.error(
            `[DeliveryOrchestrator] Failed to generate email draft:`,
            error.message
          );
          // Don't fail the whole delivery if draft generation fails
        }
      }

      const deliveryResults: any = {
        inApp: null,
        slack: null,
        email: null,
      };

      // Deliver to each approved channel
      for (const channel of decision.deliveryChannels) {
        try {
          switch (channel) {
            case "inApp":
              // In-app delivery is just marking the opportunity as approved
              // The proactive feed will query for approved opportunities
              deliveryResults.inApp = { success: true };
              break;

            case "slack":
              const slackResult = await ctx.runAction(
                internal.domains.proactive.delivery.slackDelivery.sendToSlack,
                {
                  opportunityId: args.opportunityId,
                  userId: args.userId,
                }
              );
              deliveryResults.slack = slackResult;
              break;

            case "email":
              // TODO: Implement email delivery
              deliveryResults.email = { success: false, error: "Not implemented" };
              break;
          }
        } catch (error: any) {
          console.error(
            `[DeliveryOrchestrator] Error delivering to ${channel}:`,
            error.message
          );
          deliveryResults[channel] = { success: false, error: error.message };
        }
      }

      // Check if at least one channel succeeded
      const anySuccess = Object.values(deliveryResults).some(
        (r: any) => r?.success
      );

      if (anySuccess) {
        // Update opportunity status
        await ctx.runMutation(async (ctx) => {
          await ctx.db.patch(args.opportunityId, {
            status: decision.requiresApproval ? "evaluating" : "actioned",
            updatedAt: Date.now(),
          });
        });
      }

      return {
        success: anySuccess,
        decision,
        deliveryResults,
      };
    } catch (error: any) {
      console.error(
        `[DeliveryOrchestrator] Error delivering opportunity:`,
        error.message
      );
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Process all pending opportunities
 * Called by cron job every 5 minutes
 */
export const processePendingOpportunities = internalMutation({
  args: {},
  handler: async (ctx) => {
    console.log("[DeliveryOrchestrator] Processing pending opportunities");

    // Find all approved/detected opportunities not yet delivered
    const pendingOpportunities = await ctx.db
      .query("opportunities")
      .filter((q) =>
        q.or(q.eq(q.field("status"), "detected"), q.eq(q.field("status"), "approved"))
      )
      .collect();

    console.log(
      `[DeliveryOrchestrator] Found ${pendingOpportunities.length} pending opportunities`
    );

    let delivered = 0;
    let rejected = 0;
    let errors = 0;

    for (const opportunity of pendingOpportunities) {
      try {
        // Deliver opportunity
        const result = await ctx.scheduler.runAfter(
          0,
          internal.domains.proactive.deliveryOrchestrator.deliverOpportunity,
          {
            opportunityId: opportunity._id,
            userId: opportunity.trigger.userId,
          }
        );

        delivered++;
      } catch (error: any) {
        console.error(
          `[DeliveryOrchestrator] Error processing opportunity ${opportunity._id}:`,
          error.message
        );
        errors++;
      }
    }

    return {
      success: true,
      processed: pendingOpportunities.length,
      delivered,
      rejected,
      errors,
      timestamp: Date.now(),
    };
  },
});

/**
 * Deliver opportunities for a specific user
 * Useful for testing or manual delivery
 */
export const deliverUserOpportunities = internalAction({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    // Get pending opportunities for user
    const opportunities = await ctx.runQuery(async (ctx) => {
      const opps = await ctx.db
        .query("opportunities")
        .filter((q) =>
          q.and(
            q.eq(q.field("trigger.userId"), args.userId),
            q.or(
              q.eq(q.field("status"), "detected"),
              q.eq(q.field("status"), "approved")
            )
          )
        )
        .take(limit);
      return opps;
    });

    console.log(
      `[DeliveryOrchestrator] Delivering ${opportunities.length} opportunities for user ${args.userId}`
    );

    const results: Array<{ opportunityId: any; success: boolean; [key: string]: any }> = [];

    for (const opportunity of opportunities) {
      const result = await deliverOpportunity(ctx, {
        opportunityId: opportunity._id,
        userId: args.userId,
      });
      results.push({ opportunityId: opportunity._id, ...result });
    }

    return {
      success: true,
      total: opportunities.length,
      delivered: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  },
});
