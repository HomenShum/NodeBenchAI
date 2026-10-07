"use node";

/**
 * Tool for explicit user-driven skill creation.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "custom-skill";
}

function coerceUserId(raw: Id<"users">   | null | undefined): Id<"users"> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const trimmed = raw.includes("|") ? raw.split("|")[0] : raw;
    return trimmed;
  }
  return raw;
}

export const learnUserSkill = createTool({
  description: `Learn a new user-defined skill or procedure for future use.
Use when the user provides step-by-step guidance or a repeatable workflow.`,
  args: z.object({
    name: z.string().describe("Short name for the skill"),
    description: z.string().describe("What the skill does"),
    triggerPhrases: z.array(z.string()).min(1).describe("Phrases that should activate this skill"),
    steps: z.array(z.string()).min(1).describe("Ordered steps to execute"),
    category: z.string().optional().describe("Optional category for conflict resolution"),
  }),
  handler: async (ctx, args) => {
    const userId = coerceUserId(
      (ctx as { evaluationUserId?: Id<"users">   }).evaluationUserId ??
      (await getAuthUserId(ctx as any))
    );
    if (!userId) {
      throw new Error("User not authenticated; cannot learn skill.");
    }

    const content = [
      `${args.name}: ${args.description}`,
      "Steps:",
      ...args.steps.map((s, idx) => `${idx + 1}. ${s}`),
      `Triggers: ${args.triggerPhrases.join("; ")}`,
    ].join("\n");

    await ctx.runAction(internal.tools.teachability.userMemoryTools.storeTeaching, {
      userId,
      type: "skill",
      content,
      category: args.category || slugify(args.name),
      key: args.name,
      source: "explicit",
      steps: args.steps,
      triggerPhrases: args.triggerPhrases,
    });

    return `Learned "${args.name}". I'll remember this workflow for future requests.`;
  },
});
