"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";

type StarEvent = { starred_at: string };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function parseRepoFullName(input: string): string | null {
  try {
    if (input.includes("github.com")) {
      const url = new URL(input);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1].replace(/\.git$/, "")}`;
      }
    }
  } catch {
    // fall through
  }

  if (/^[^/]+\/[^/]+$/.test(input)) {
    return input.replace(/\.git$/, "");
  }
  return null;
}

async function fetchGithubJson(url: string, token?: string, accept?: string) {
  const headers: Record<string, string> = {
    "User-Agent": "nodebench-ai",
    Accept: accept || "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

function buildStarHistory(events: StarEvent[], windowDays = 30) {
  const byDate = new Map<string, number>();
  events.forEach((event) => {
    const date = event.starred_at?.slice(0, 10);
    if (!date) return;
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  });

  const days: Array<{ date: string; stars: number; delta?: number }> = [];
  const start = new Date();
  start.setDate(start.getDate() - (windowDays - 1));
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateKey = d.toISOString().slice(0, 10);
    const stars = byDate.get(dateKey) ?? 0;
    days.push({ date: dateKey, stars, delta: stars });
  }
  return days;
}

function buildCommitHistory(commits: Array<{ week: number; total: number }>, windowWeeks = 8) {
  const trimmed = commits.slice(-windowWeeks);
  return trimmed.map((entry) => ({
    weekStart: new Date(entry.week * 1000).toISOString().slice(0, 10),
    commits: entry.total,
  }));
}

function buildFallbackRecord(repoFullName: string, repoUrl?: string) {
  return {
    repoFullName,
    repoUrl: repoUrl ?? `https://github.com/${repoFullName}`,
    description: "",
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    createdAt: "",
    pushedAt: "",
    starHistory: buildStarHistory([], 14),
    commitHistory: [],
    languages: undefined as Array<{ name: string; pct: number }> | undefined,
    fetchedAt: Date.now(),
  };
}

export const refreshRepoStats = action({
  args: {
    repoUrl: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const repoFullName = args.repoFullName || (args.repoUrl ? parseRepoFullName(args.repoUrl) : null);
    if (!repoFullName) {
      throw new Error("Invalid GitHub repo URL or full name.");
    }

    const existing = await ctx.runQuery(api.domains.research.repoStatsQueries.getRepoStats, {
      repoFullName,
      repoUrl: args.repoUrl,
    });

    if (existing && !args.forceRefresh) {
      const age = Date.now() - (existing.fetchedAt ?? 0);
      if (age < CACHE_TTL_MS) {
        return { cached: true, stats: existing };
      }
    }

    const token = process.env.GITHUB_API_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const repoUrl = `https://api.github.com/repos/${repoFullName}`;
    let repoData: any;
    try {
      repoData = await fetchGithubJson(repoUrl, token);
    } catch (err) {
      console.warn("[repoStats] repo fetch failed:", (err as Error).message);
      const fallback = buildFallbackRecord(repoFullName, args.repoUrl);
      if (existing?._id) {
        await ctx.runMutation(internal.domains.research.repoStatsQueries.patchRepoStats, {
          id: existing._id,
          updates: fallback,
        });
        return { cached: false, stats: { ...existing, ...fallback } };
      }
      const id = await ctx.runMutation(internal.domains.research.repoStatsQueries.insertRepoStats, {
        record: fallback,
      });
      return { cached: false, stats: { _id: id, ...fallback } };
    }

    let commitHistory: Array<{ weekStart: string; commits: number }> = [];
    try {
      const commitActivity = await fetchGithubJson(
        `https://api.github.com/repos/${repoFullName}/stats/commit_activity`,
        token,
      );
      if (Array.isArray(commitActivity)) {
        commitHistory = buildCommitHistory(commitActivity);
      }
    } catch (err) {
      console.warn("[repoStats] commit activity unavailable:", (err as Error).message);
    }

    let starHistory: any[] = [];
    try {
      const stars = await fetchGithubJson(
        `https://api.github.com/repos/${repoFullName}/stargazers?per_page=100`,
        token,
        "application/vnd.github.v3.star+json",
      );
      if (Array.isArray(stars)) {
        starHistory = buildStarHistory(stars as StarEvent[]);
      }
    } catch (err) {
      console.warn("[repoStats] stargazer history unavailable:", (err as Error).message);
    }

    let languages: Array<{ name: string; pct: number }> | undefined = undefined;
    try {
      const langData = await fetchGithubJson(
        `https://api.github.com/repos/${repoFullName}/languages`,
        token,
      );
      if (langData && typeof langData === "object") {
        const entries = Object.entries(langData as Record<string, number>);
        const total = entries.reduce((sum, [, val]) => sum + (val || 0), 0) || 1;
        languages = entries
          .map(([name, val]) => ({ name, pct: Math.round(((val || 0) / total) * 100) }))
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 5);
      }
    } catch (err) {
      console.warn("[repoStats] language data unavailable:", (err as Error).message);
    }

    const now = Date.now();
    const record = {
      repoFullName,
      repoUrl: repoData.html_url ?? `https://github.com/${repoFullName}`,
      description: repoData.description ?? "",
      stars: repoData.stargazers_count ?? 0,
      forks: repoData.forks_count ?? 0,
      watchers: repoData.watchers_count ?? 0,
      openIssues: repoData.open_issues_count ?? 0,
      createdAt: repoData.created_at ?? "",
      pushedAt: repoData.pushed_at ?? "",
      starHistory: starHistory.length ? starHistory : buildStarHistory([], 14),
      commitHistory,
      languages,
      fetchedAt: now,
    };

    if (existing?._id) {
      await ctx.runMutation(internal.domains.research.repoStatsQueries.patchRepoStats, {
        id: existing._id,
        updates: record,
      });
      return { cached: false, stats: { ...existing, ...record } };
    }

    const id = await ctx.runMutation(internal.domains.research.repoStatsQueries.insertRepoStats, {
      record,
    });
    return { cached: false, stats: { _id: id, ...record } };
  },
});
