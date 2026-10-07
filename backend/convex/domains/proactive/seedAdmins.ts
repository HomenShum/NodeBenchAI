/**
 * Seed Admin Users
 * One-time script to create initial admin users for the feedback dashboard
 *
 * Usage:
 *   npx convex run domains/proactive/seedAdmins:seedInitialAdmins --prod
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Seed initial admin users
 * Creates hshum2018@gmail.com as owner and any test accounts
 */
export const seedInitialAdmins = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Check if owner already exists
    const existingOwner = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", "hshum2018@gmail.com"))
      .first();

    if (existingOwner) {
      console.log("Owner admin user already exists, skipping seed");
      return {
        success: true,
        message: "Owner already exists",
        created: 0
      };
    }

    // Get the user ID for hshum2018@gmail.com
    const ownerUser = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), "hshum2018@gmail.com"))
      .first();

    if (!ownerUser) {
      throw new Error("User hshum2018@gmail.com not found in users table. Please sign up first.");
    }

    // Create owner admin user
    const adminId = await ctx.db.insert("adminUsers", {
      userId: ownerUser._id,
      email: "hshum2018@gmail.com",
      role: "owner",
      permissions: [
        "view_feedback",
        "view_analytics",
        "export_data",
        "manage_admins",
        "view_users",
        "manage_detectors",
      ],
      createdAt: Date.now(),
    });

    console.log(`Created owner admin user: ${adminId}`);

    // Optionally add test accounts (if they exist)
    const testEmails = [
      "test1@nodebench.ai",
      "test2@nodebench.ai",
      "demo@nodebench.ai",
    ];

    let testAdminsCreated = 0;
    for (const email of testEmails) {
      const testUser = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), email))
        .first();

      if (testUser) {
        const existingTestAdmin = await ctx.db
          .query("adminUsers")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first();

        if (!existingTestAdmin) {
          await ctx.db.insert("adminUsers", {
            userId: testUser._id,
            email,
            role: "admin",
            permissions: [
              "view_feedback",
              "view_analytics",
              "export_data",
            ],
            invitedBy: ownerUser._id,
            createdAt: Date.now(),
          });
          testAdminsCreated++;
          console.log(`Created test admin user: ${email}`);
        }
      }
    }

    return {
      success: true,
      message: "Admin users seeded successfully",
      created: 1 + testAdminsCreated,
      owner: "hshum2018@gmail.com",
      testAccounts: testAdminsCreated,
    };
  },
});

/**
 * Add a new admin user
 * Can be called by existing admins to add more admins
 */
export const addAdminUser = internalMutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("viewer")),
    invitedByEmail: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if inviter is an admin
    const inviter = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", args.invitedByEmail))
      .first();

    if (!inviter) {
      throw new Error("Inviter is not an admin");
    }

    // Check if user exists
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), args.email))
      .first();

    if (!user) {
      throw new Error(`User ${args.email} not found. User must sign up first.`);
    }

    // Check if already an admin
    const existingAdmin = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingAdmin) {
      throw new Error(`User ${args.email} is already an admin`);
    }

    // Create admin user
    const permissions = args.role === "admin"
      ? ["view_feedback", "view_analytics", "export_data"]
      : ["view_feedback", "view_analytics"];

    const adminId = await ctx.db.insert("adminUsers", {
      userId: user._id,
      email: args.email,
      role: args.role,
      permissions,
      invitedBy: inviter.userId,
      createdAt: Date.now(),
    });

    console.log(`Added new admin user: ${args.email} (${args.role})`);

    return {
      success: true,
      adminId,
      email: args.email,
      role: args.role,
    };
  },
});

/**
 * Remove an admin user
 * Only owner can remove admins
 */
export const removeAdminUser = internalMutation({
  args: {
    email: v.string(),
    removedByEmail: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if remover is owner
    const remover = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", args.removedByEmail))
      .first();

    if (!remover || remover.role !== "owner") {
      throw new Error("Only owner can remove admin users");
    }

    // Prevent removing owner
    if (args.email === "hshum2018@gmail.com") {
      throw new Error("Cannot remove owner");
    }

    // Find and delete admin user
    const admin = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!admin) {
      throw new Error(`Admin user ${args.email} not found`);
    }

    await ctx.db.delete(admin._id);

    console.log(`Removed admin user: ${args.email}`);

    return {
      success: true,
      removed: args.email,
    };
  },
});
