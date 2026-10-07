import { components } from "../../../_generated/api";
import { action } from "../../../_generated/server";
import { v } from "convex/values";
import { OssStats } from "@erquhart/convex-oss-stats";

// Construct with a safe fallback token to avoid module-load failures in environments
// that haven't set GITHUB_ACCESS_TOKEN yet. Actual sync will provide a real token.
export const ossStats = new OssStats(components.ossStats, {
  githubAccessToken: process.env.GITHUB_ACCESS_TOKEN ?? "x",
  // Get stats for entire owners / orgs
  githubOwners: ["get-convex"],
  npmOrgs: ["convex-dev"],
  // Or individual repos / packages
  githubRepos: ["get-convex/convex-js"],
  npmPackages: ["@convex-dev/convex-js"],
});

export const {
  clearAndSync,
  getGithubOwner,
  getNpmOrg,
  getGithubRepo,
  getGithubRepos,
  getNpmPackage,
  getNpmPackages,
} = ossStats.api();

// Public action: run sync using the server's configured/fallback token.
export const syncDefault = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ossStats.sync(ctx);
    return null;
  },
});

// Prefer a user-provided token for ad-hoc syncs; fall back to env when absent.
export const syncPreferUserToken = action({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, { token }) => {
    const inst = new OssStats(components.ossStats, {
      githubAccessToken: token,
      githubOwners: ["get-convex"],
      githubRepos: ["get-convex/convex-js"],
      npmOrgs: ["convex-dev"],
      npmPackages: ["@convex-dev/convex-js"],
    });
    await inst.sync(ctx);
    return null;
  },
});
