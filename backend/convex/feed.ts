// convex/feed.ts - Central Newsstand for Live Intelligence Feed
// "Write Once, Read Many" - hourly ingest from free public sources
// All users (Free & Pro) can read this shared feed

import { action, mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";

// ============================================================================
// 1. PUBLIC QUERY: The "Feed" your frontend consumes
// ============================================================================
// Feed categories for segmented views
const FEED_TYPES = ["news", "signal", "dossier", "repo", "product"] as const;
const FEED_CATEGORIES = ["tech", "ai_ml", "startups", "products", "opensource", "finance", "research"] as const;

export const get = query({
  args: { 
    limit: v.optional(v.number()),
    type: v.optional(v.union(
      v.literal("news"), 
      v.literal("signal"), 
      v.literal("dossier"),
      v.literal("repo"),
      v.literal("product")
    )),
    category: v.optional(v.union(
      v.literal("tech"),
      v.literal("ai_ml"),
      v.literal("startups"),
      v.literal("products"),
      v.literal("opensource"),
      v.literal("finance"),
      v.literal("research")
    )),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    
    // If category filter specified, use the category index
    if (args.category) {
      return await ctx.db
        .query("feedItems")
        .withIndex("by_category", q => q.eq("category", args.category))
        .order("desc")
        .take(limit);
    }
    
    // If type filter specified, use the type index
    if (args.type) {
      return await ctx.db
        .query("feedItems")
        .withIndex("by_type", q => q.eq("type", args.type))
        .order("desc")
        .take(limit);
    }
    
    // Otherwise get all items ordered by score (hottest first)
    return await ctx.db
      .query("feedItems")
      .withIndex("by_score")
      .order("desc")
      .take(limit);
  },
});

// Get feed items by category for segmented views
export const getByCategory = query({
  args: { 
    category: v.union(
      v.literal("tech"),
      v.literal("ai_ml"),
      v.literal("startups"),
      v.literal("products"),
      v.literal("opensource"),
      v.literal("finance"),
      v.literal("research")
    ),
    limit: v.optional(v.number()) 
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("feedItems")
      .withIndex("by_category", q => q.eq("category", args.category))
      .order("desc")
      .take(args.limit || 20);
  },
});

// Get available categories with counts
export const getCategories = query({
  args: {},
  handler: async (ctx) => {
    // Get counts for each category
    const categories = [
      { id: "all", label: "All", icon: "📰" },
      { id: "ai_ml", label: "AI & ML", icon: "🤖" },
      { id: "startups", label: "Startups", icon: "🚀" },
      { id: "products", label: "Products", icon: "📦" },
      { id: "opensource", label: "Open Source", icon: "💻" },
      { id: "research", label: "Research", icon: "📚" },
      { id: "tech", label: "Tech News", icon: "📱" },
      { id: "finance", label: "Finance", icon: "💰" },
    ];
    return categories;
  },
});

// Get trending items (highest score)
export const getTrending = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("feedItems")
      .withIndex("by_score")
      .order("desc")
      .take(args.limit || 8);
  },
});

// Get recent items ordered by published time (most recent first).
// Useful for "today's news" and time-bounded summaries.
export const getRecent = query({
  args: {
    limit: v.optional(v.number()),
    from: v.optional(v.string()), // ISO string (inclusive)
    to: v.optional(v.string()), // ISO string (inclusive)
    type: v.optional(v.union(
      v.literal("news"),
      v.literal("signal"),
      v.literal("dossier"),
      v.literal("repo"),
      v.literal("product"),
    )),
    category: v.optional(v.union(
      v.literal("tech"),
      v.literal("ai_ml"),
      v.literal("startups"),
      v.literal("products"),
      v.literal("opensource"),
      v.literal("finance"),
      v.literal("research"),
    )),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const from = args.from;
    const to = args.to;

    const qBase =
      from && to
        ? ctx.db
            .query("feedItems")
            .withIndex("by_published", (q) =>
              q.gte("publishedAt", from).lte("publishedAt", to),
            )
        : from
          ? ctx.db
              .query("feedItems")
              .withIndex("by_published", (q) => q.gte("publishedAt", from))
          : to
            ? ctx.db
                .query("feedItems")
                .withIndex("by_published", (q) => q.lte("publishedAt", to))
            : ctx.db.query("feedItems").withIndex("by_published");

    let q = qBase;

    // Optional filters (post-index). This may scan within the bounded range.
    if (args.type) {
      q = q.filter((q) => q.eq(q.field("type"), args.type));
    }
    if (args.category) {
      q = q.filter((q) => q.eq(q.field("category"), args.category));
    }

    return await q.order("desc").take(limit);
  },
});

// ============================================================================
// 2. INTERNAL MUTATION: Save items to DB (with deduplication)
// ============================================================================
export const saveItems = internalMutation({
  args: { 
    items: v.array(v.object({
      sourceId: v.string(),
      type: v.union(
        v.literal("news"), 
        v.literal("signal"), 
        v.literal("dossier"),
        v.literal("repo"),
        v.literal("product")
      ),
      category: v.optional(v.union(
        v.literal("tech"),
        v.literal("ai_ml"),
        v.literal("startups"),
        v.literal("products"),
        v.literal("opensource"),
        v.literal("finance"),
        v.literal("research")
      )),
      title: v.string(),
      summary: v.string(),
      url: v.string(),
      source: v.string(),
      tags: v.array(v.string()),
      metrics: v.optional(v.array(v.object({
        label: v.string(),
        value: v.string(),
        trend: v.optional(v.union(v.literal("up"), v.literal("down")))
      }))),
      publishedAt: v.string(),
      score: v.number(),
    }))
  },
  handler: async (ctx, args) => {
    let insertedCount = 0;
    
    for (const item of args.items) {
      // Deduplicate by sourceId
      const existing = await ctx.db
        .query("feedItems")
        .withIndex("by_source_id", q => q.eq("sourceId", item.sourceId))
        .first() as Doc<"feedItems"> | null;

      if (!existing) {
        await ctx.db.insert("feedItems", {
          ...item,
          createdAt: Date.now(),
        });
        insertedCount++;
      }
    }
    
    return { inserted: insertedCount, total: args.items.length };
  }
});

// ============================================================================
// 2.5. ACTION: Seed audit-critical signals (dev/demo convenience)
// Ensures the 10-persona deep-dive can be exercised even if a source is missing.
// ============================================================================
const AUDIT_SIGNAL_SEEDS = [
  {
    sourceId: "audit-soundcloud-vpn-ban",
    type: "signal" as const,
    category: "tech" as const,
    title: "SoundCloud tightens VPN bans under new licensing pressure",
    summary:
      "SoundCloud is escalating VPN and geo-block enforcement to comply with regional licensing. " +
      "Second-order impact: residential proxy demand spikes as datacenter IPs are blacklisted.",
    url: "https://en.wikipedia.org/wiki/SoundCloud",
    source: "Audit",
    tags: ["VPN", "Geo-block", "Licensing", "Streaming"],
    metrics: [
      { label: "Policy", value: "VPN Ban", trend: "up" as const },
      { label: "Impact", value: "Proxy Demand +" },
    ],
    score: 240,
  },
];

export const seedAuditSignals = mutation({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;

    for (const seed of AUDIT_SIGNAL_SEEDS) {
      const existing = await ctx.db
        .query("feedItems")
        .withIndex("by_source_id", (q) => q.eq("sourceId", seed.sourceId))
        .first() as Doc<"feedItems"> | null;
      if (existing) {
        if (args.force) {
          await ctx.db.patch(existing._id, {
            ...seed,
            publishedAt: now,
          });
          updated += 1;
        }
        continue;
      }
      await ctx.db.insert("feedItems", {
        ...seed,
        publishedAt: now,
        createdAt: Date.now(),
      });
      inserted += 1;
    }

    return { inserted, updated };
  },
});

// ============================================================================
// 3. ACTION: Fetch from Hacker News (Free Public API)
// ============================================================================
export const ingestHackerNews = action({
  args: {},
  handler: async (ctx) => {
    try {
      // A. Fetch Top Stories IDs
      const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
      const topIds: number[] = (await topStoriesRes.json()).slice(0, 15); // Get top 15

      const feedItems: Array<{
        sourceId: string;
        type: "news" | "signal" | "dossier";
        title: string;
        summary: string;
        url: string;
        source: string;
        tags: string[];
        metrics: Array<{ label: string; value: string; trend?: "up" | "down" }>;
        publishedAt: string;
        score: number;
      }> = [];

      // B. Fetch Details for each story (in parallel for speed)
      const storyPromises = topIds.map(async (id) => {
        const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return storyRes.json();
      });

      const stories = await Promise.all(storyPromises);

      // C. Filter and transform
      for (const story of stories) {
        if (!story || !story.title) continue;

        const title = story.title || "";

        // Relevance filter - tech/AI/funding related
        const isRelevant = /AI|LLM|GPT|Model|Infra|Data|SaaS|Funding|Startup|YC|Launch|API|Agent|Vector|RAG|Cloud/i.test(title);

        if (isRelevant) {
          // Determine type based on content
          const isSignal = /funding|raise|series|valuation|\$\d+/i.test(title);

          feedItems.push({
            sourceId: `hn-${story.id}`,
            type: isSignal ? "signal" : "news",
            title: story.title,
            summary: `Trending on Hacker News with ${story.score || 0} points and ${story.descendants || 0} comments.`,
            url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
            source: "YCombinator",
            tags: isSignal ? ["Trending", "Funding"] : ["Trending", "Tech"],
            metrics: [
              { label: "Points", value: (story.score || 0).toString(), trend: "up" as const },
              { label: "Comments", value: (story.descendants || 0).toString() }
            ],
            publishedAt: new Date((story.time || Date.now() / 1000) * 1000).toISOString(),
            score: story.score || 0
          });
        }
      }

      // D. Save to DB
      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }

      return { status: "success", ingested: feedItems.length, checked: stories.length };
    } catch (error) {
      console.error("Error ingesting Hacker News:", error);
      return { status: "error", message: String(error) };
    }
  }
});

// ============================================================================
// 4. ACTION: Fetch from ArXiv (Free Public API - AI/ML Research)
// https://arxiv.org/help/api/user-manual
// ============================================================================
export const ingestArXiv = action({
  args: {},
  handler: async (ctx) => {
    try {
      // ArXiv API: search for AI/ML papers from last 24 hours
      // Categories: cs.AI (Artificial Intelligence), cs.LG (Machine Learning), cs.CL (Computation and Language)
      const categories = "cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL";
      const maxResults = 25;

      // ArXiv API URL
      const arxivUrl = `http://export.arxiv.org/api/query?search_query=${categories}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

      const response = await fetch(arxivUrl);
      const xmlText = await response.text();

      // Parse XML response (simple regex parsing for Atom feed)
      const feedItems: Array<{
        sourceId: string;
        type: "news" | "signal" | "dossier";
        title: string;
        summary: string;
        url: string;
        source: string;
        tags: string[];
        metrics: Array<{ label: string; value: string; trend?: "up" | "down" }>;
        publishedAt: string;
        score: number;
      }> = [];

      // Extract entries using regex (ArXiv returns Atom XML)
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      const titleRegex = /<title>([\s\S]*?)<\/title>/;
      const summaryRegex = /<summary>([\s\S]*?)<\/summary>/;
      const idRegex = /<id>([\s\S]*?)<\/id>/;
      const publishedRegex = /<published>([\s\S]*?)<\/published>/;
      const categoryRegex = /<category[^>]*term="([^"]+)"/g;
      const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>/g;

      let match;
      let checked = 0;

      while ((match = entryRegex.exec(xmlText)) !== null) {
        checked++;
        const entry = match[1];

        const titleMatch = titleRegex.exec(entry);
        const summaryMatch = summaryRegex.exec(entry);
        const idMatch = idRegex.exec(entry);
        const publishedMatch = publishedRegex.exec(entry);

        if (!titleMatch || !idMatch) continue;

        const title = titleMatch[1].trim().replace(/\s+/g, ' ');
        const summary = summaryMatch ? summaryMatch[1].trim().replace(/\s+/g, ' ').slice(0, 300) + '...' : '';
        const arxivId = idMatch[1].split('/').pop() || '';
        const published = publishedMatch ? publishedMatch[1] : new Date().toISOString();

        // Extract categories
        const tags: string[] = ["Research"];
        let catMatch;
        while ((catMatch = categoryRegex.exec(entry)) !== null) {
          const cat = catMatch[1];
          if (cat === 'cs.AI') tags.push('AI');
          if (cat === 'cs.LG') tags.push('ML');
          if (cat === 'cs.CL') tags.push('NLP');
        }

        // Count authors
        let authorCount = 0;
        while (authorRegex.exec(entry) !== null) {
          authorCount++;
        }

        // Relevance filter - more aggressive for arxiv
        const isRelevant = /LLM|GPT|transformer|agent|RAG|retrieval|language model|reasoning|multimodal|vision|diffusion|embedding/i.test(title + summary);

        if (isRelevant) {
          feedItems.push({
            sourceId: `arxiv-${arxivId}`,
            type: "dossier", // Research papers are dossier-style
            title: title,
            summary: summary,
            url: `https://arxiv.org/abs/${arxivId}`,
            source: "ArXiv",
            tags: tags.slice(0, 4),
            metrics: [
              { label: "Authors", value: authorCount.toString() },
            ],
            publishedAt: published,
            score: 50 + Math.floor(Math.random() * 50) // ArXiv doesn't have votes, use random for variety
          });
        }
      }

      // Save to DB
      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }

      return { status: "success", ingested: feedItems.length, checked };
    } catch (error) {
      console.error("Error ingesting ArXiv:", error);
      return { status: "error", message: String(error) };
    }
  }
});

// ============================================================================
// 5. ACTION: Fetch from Reddit (Free JSON API - No Auth Required)
// Subreddits: r/technology, r/MachineLearning, r/startups
// ============================================================================
export const ingestReddit = action({
  args: {},
  handler: async (ctx) => {
    try {
      const subreddits = ['technology', 'MachineLearning', 'startups', 'artificial'];
      const feedItems: Array<{
        sourceId: string;
        type: "news" | "signal" | "dossier";
        title: string;
        summary: string;
        url: string;
        source: string;
        tags: string[];
        metrics: Array<{ label: string; value: string; trend?: "up" | "down" }>;
        publishedAt: string;
        score: number;
      }> = [];

      let totalChecked = 0;

      // Fetch from each subreddit in parallel
      const subredditPromises = subreddits.map(async (subreddit) => {
        try {
          const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=15`;
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'NodeBench/1.0 (Research Feed Aggregator)'
            }
          });

          if (!response.ok) {
            console.warn(`Reddit ${subreddit} returned ${response.status}`);
            return [];
          }

          const data = await response.json();
          return data.data?.children || [];
        } catch (err) {
          console.warn(`Failed to fetch r/${subreddit}:`, err);
          return [];
        }
      });

      const allPosts = await Promise.all(subredditPromises);

      for (const posts of allPosts) {
        for (const post of posts) {
          totalChecked++;
          const p = post.data;

          if (!p || p.stickied || p.over_18) continue; // Skip stickied and NSFW

          const title = p.title || '';
          const selftext = p.selftext || '';

          // Relevance filter
          const isRelevant = /AI|ML|LLM|GPT|startup|funding|tech|data|cloud|API|model|neural|deep learning/i.test(title + selftext);

          if (isRelevant && p.score > 50) { // Only include posts with decent engagement
            // Determine type
            const isSignal = /funding|raise|series|valuation|\$\d+M|\$\d+B/i.test(title);
            const isDiscussion = p.num_comments > 100;

            // Determine subreddit-based tags
            const subredditTags: Record<string, string[]> = {
              'technology': ['Tech', 'News'],
              'MachineLearning': ['ML', 'Research'],
              'startups': ['Startup', 'Business'],
              'artificial': ['AI', 'Discussion']
            };

            const baseTags = subredditTags[p.subreddit] || ['Reddit'];

            feedItems.push({
              sourceId: `reddit-${p.id}`,
              type: isSignal ? "signal" : "news",
              title: title.slice(0, 200),
              summary: selftext ? selftext.slice(0, 250) + '...' : `Discussion on r/${p.subreddit} with ${p.num_comments} comments.`,
              url: p.url?.startsWith('https://www.reddit.com')
                ? p.url
                : `https://www.reddit.com${p.permalink}`,
              source: `r/${p.subreddit}`,
              tags: [...baseTags, ...(isDiscussion ? ['Hot'] : [])].slice(0, 4),
              metrics: [
                { label: "Upvotes", value: p.score.toString(), trend: p.score > 500 ? "up" as const : undefined },
                { label: "Comments", value: p.num_comments.toString() }
              ],
              publishedAt: new Date(p.created_utc * 1000).toISOString(),
              score: p.score
            });
          }
        }
      }

      // Save to DB
      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }

      return { status: "success", ingested: feedItems.length, checked: totalChecked };
    } catch (error) {
      console.error("Error ingesting Reddit:", error);
      return { status: "error", message: String(error) };
    }
  }
});

// ============================================================================
// 6. ACTION: Fetch from RSS Feeds (Generic Parser)
// Supports TechCrunch, VentureBeat, Ars Technica, etc.
// ============================================================================
export const ingestRSS = action({
  args: {
    feedUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Default tech RSS feeds (free, no API key required)
      // Prioritize funding/startup news sources for banker-grade entity enrichment
      const defaultFeeds = [
        // Primary funding sources
        { url: 'https://techcrunch.com/category/venture/feed/', source: 'TechCrunch Venture', tags: ['Funding', 'Startups', 'VC'] },
        { url: 'https://techcrunch.com/category/startups/feed/', source: 'TechCrunch Startups', tags: ['Startups', 'Funding'] },
        { url: 'https://venturebeat.com/category/deals/feed/', source: 'VentureBeat Deals', tags: ['Funding', 'Deals', 'M&A'] },

        // Biotech/pharma funding (for DISCO/Ambros-type entities)
        { url: 'https://www.fiercebiotech.com/rss/xml', source: 'FierceBiotech', tags: ['Biotech', 'Funding', 'Pharma'] },
        { url: 'https://www.biopharmadive.com/feeds/news/', source: 'BioPharma Dive', tags: ['Biotech', 'Pharma', 'Clinical'] },

        // Tech industry news
        { url: 'https://techcrunch.com/feed/', source: 'TechCrunch', tags: ['Tech', 'Startups'] },
        { url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', source: 'Ars Technica', tags: ['Tech', 'Deep Dive'] },
        { url: 'https://www.wired.com/feed/rss', source: 'Wired', tags: ['Tech', 'Culture'] },
      ];

      // Use provided feed or all defaults
      const feedsToProcess = args.feedUrl
        ? [{ url: args.feedUrl, source: new URL(args.feedUrl).hostname, tags: ['RSS'] }]
        : defaultFeeds;

      const feedItems: Array<{
        sourceId: string;
        type: "news" | "signal" | "dossier";
        title: string;
        summary: string;
        url: string;
        source: string;
        tags: string[];
        metrics: Array<{ label: string; value: string; trend?: "up" | "down" }>;
        publishedAt: string;
        score: number;
      }> = [];

      let totalChecked = 0;

      for (const feed of feedsToProcess) {
        try {
          const response = await fetch(feed.url, {
            headers: {
              'User-Agent': 'NodeBench/1.0 (Research Feed Aggregator)',
              'Accept': 'application/rss+xml, application/xml, text/xml'
            }
          });

          if (!response.ok) {
            console.warn(`RSS ${feed.source} returned ${response.status}`);
            continue;
          }

          const xmlText = await response.text();

          // Parse RSS items using regex (handles both RSS 2.0 and Atom)
          const itemRegex = /<item>([\s\S]*?)<\/item>/g;
          const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
          const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;
          const linkRegex = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/;
          const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
          const guidRegex = /<guid[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/guid>/;

          let match;
          let itemCount = 0;

          while ((match = itemRegex.exec(xmlText)) !== null && itemCount < 10) {
            totalChecked++;
            itemCount++;

            const item = match[1];

            const titleMatch = titleRegex.exec(item);
            const descMatch = descRegex.exec(item);
            const linkMatch = linkRegex.exec(item);
            const pubDateMatch = pubDateRegex.exec(item);
            const guidMatch = guidRegex.exec(item);

            if (!titleMatch || !linkMatch) continue;

            const title = titleMatch[1].trim().replace(/<[^>]+>/g, '');
            const description = descMatch ? descMatch[1].trim().replace(/<[^>]+>/g, '').slice(0, 300) : '';
            const link = linkMatch[1].trim();
            const pubDate = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : new Date().toISOString();
            const guid = guidMatch ? guidMatch[1].trim() : link;

            // Create unique sourceId from domain + guid hash
            const domain = new URL(link).hostname.replace('www.', '');
            const sourceId = `rss-${domain}-${guid.split('/').pop()?.slice(0, 20) || Date.now()}`;

            // Relevance filter
            const isRelevant = /AI|ML|startup|funding|tech|data|cloud|API|model|venture|investment|series|raise/i.test(title + description);

            if (isRelevant) {
              const isSignal = /funding|raise|series|valuation|\$\d+/i.test(title);

              feedItems.push({
                sourceId,
                type: isSignal ? "signal" : "news",
                title: title.slice(0, 200),
                summary: description || `Article from ${feed.source}`,
                url: link,
                source: feed.source,
                tags: feed.tags,
                metrics: [],
                publishedAt: pubDate,
                score: 30 + Math.floor(Math.random() * 40) // RSS doesn't have engagement metrics
              });
            }
          }
        } catch (feedError) {
          console.warn(`Failed to process feed ${feed.source}:`, feedError);
        }
      }

      // Save to DB
      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }

      return { status: "success", ingested: feedItems.length, checked: totalChecked };
    } catch (error) {
      console.error("Error ingesting RSS:", error);
      return { status: "error", message: String(error) };
    }
  }
});

// ============================================================================
// 7. ACTION: Master Ingestor - Run All Sources
// Call this from a cron job to update the entire feed
// ============================================================================
export const ingestAll = action({
  args: {},
  handler: async (ctx) => {
    const results: Record<string, { status: string; ingested: number; checked: number }> = {
      hackerNews: { status: "pending", ingested: 0, checked: 0 },
      arxiv: { status: "pending", ingested: 0, checked: 0 },
      reddit: { status: "pending", ingested: 0, checked: 0 },
      rss: { status: "pending", ingested: 0, checked: 0 },
      github: { status: "pending", ingested: 0, checked: 0 },
      productHunt: { status: "pending", ingested: 0, checked: 0 },
      devTo: { status: "pending", ingested: 0, checked: 0 },
    };

    // Run all ingestors in parallel for speed
    const [hnResult, arxivResult, redditResult, rssResult, ghResult, phResult, devtoResult] = await Promise.allSettled([
      ctx.runAction(internal.feed.ingestHackerNewsInternal, {}),
      ctx.runAction(internal.feed.ingestArXivInternal, {}),
      ctx.runAction(internal.feed.ingestRedditInternal, {}),
      ctx.runAction(internal.feed.ingestRSSInternal, {}),
      ctx.runAction(internal.feed.ingestGitHubTrendingInternal, {}),
      ctx.runAction(internal.feed.ingestProductHuntInternal, {}),
      ctx.runAction(internal.feed.ingestDevToInternal, {}),
    ]);

    // Process results
    if (hnResult.status === 'fulfilled') results.hackerNews = hnResult.value;
    if (arxivResult.status === 'fulfilled') results.arxiv = arxivResult.value;
    if (redditResult.status === 'fulfilled') results.reddit = redditResult.value;
    if (rssResult.status === 'fulfilled') results.rss = rssResult.value;
    if (ghResult.status === 'fulfilled') results.github = ghResult.value;
    if (phResult.status === 'fulfilled') results.productHunt = phResult.value;
    if (devtoResult.status === 'fulfilled') results.devTo = devtoResult.value;

    const totalIngested = Object.values(results).reduce((sum, r) => sum + (r.ingested || 0), 0);

    return {
      status: "success",
      totalIngested,
      sources: results
    };
  }
});

// Internal versions for parallel execution from ingestAll
import { internalAction } from "./_generated/server";

export const ingestHackerNewsInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    // INCREASED: Fetch top 50 stories (up from 15) for comprehensive coverage
    try {
      const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
      const topIds: number[] = (await topStoriesRes.json()).slice(0, 50); // 50 stories for all personas
      const feedItems: Array<any> = [];
      const storyPromises = topIds.map(async (id) => {
        const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return storyRes.json();
      });
      const stories = await Promise.all(storyPromises);
      for (const story of stories) {
        if (!story || !story.title) continue;
        const title = story.title || "";
        // Expanded relevance filter for all personas (banker, VC, CTO, academic, pharma, quant, journalist)
        const isRelevant = /AI|LLM|GPT|Model|Infra|Data|SaaS|Funding|Startup|YC|Launch|API|Agent|Vector|RAG|Cloud|biotech|pharma|series [A-Z]|valuation|IPO|acquisition|M&A|security|CVE|research|paper|FDA|clinical|market|trading|quant|crypto|blockchain|fintech|enterprise/i.test(title);
        // Ingest all HN stories that meet minimum score threshold for better coverage
        if (isRelevant || (story.score && story.score > 100)) {
          const isSignal = /funding|raise|series|valuation|\$\d+|acquisition|IPO|M&A/i.test(title);
          const isBiotech = /biotech|pharma|clinical|FDA|therapeutics|drug/i.test(title);
          const isResearch = /paper|research|study|arxiv|journal/i.test(title);
          const isFinance = /market|trading|crypto|fintech|banking/i.test(title);
          feedItems.push({
            sourceId: `hn-${story.id}`,
            type: isSignal ? "signal" : "news",
            category: isBiotech ? "research" : isResearch ? "research" : isFinance ? "finance" : "tech",
            title: story.title,
            summary: `Trending on Hacker News with ${story.score || 0} points and ${story.descendants || 0} comments.`,
            url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
            source: "YCombinator",
            tags: isSignal ? ["Trending", "Funding"] : isBiotech ? ["Trending", "Biotech"] : ["Trending", "Tech"],
            metrics: [
              { label: "Points", value: (story.score || 0).toString(), trend: "up" as const },
              { label: "Comments", value: (story.descendants || 0).toString() }
            ],
            publishedAt: new Date((story.time || Date.now() / 1000) * 1000).toISOString(),
            score: story.score || 0
          });
        }
      }
      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }
      return { status: "success", ingested: feedItems.length, checked: stories.length };
    } catch (error) {
      return { status: "error", message: String(error), ingested: 0, checked: 0 };
    }
  }
});

export const ingestArXivInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      // EXPANDED: More categories for all personas (AI, ML, NLP, quant-fin, bio, economics)
      const categories = "cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:q-fin.TR+OR+cat:q-fin.PM+OR+cat:q-bio.QM+OR+cat:econ.GN";
      // INCREASED: 75 papers (up from 25) for comprehensive research coverage
      const arxivUrl = `http://export.arxiv.org/api/query?search_query=${categories}&sortBy=submittedDate&sortOrder=descending&max_results=75`;
      const response = await fetch(arxivUrl);
      const xmlText = await response.text();
      const feedItems: Array<any> = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      const titleRegex = /<title>([\s\S]*?)<\/title>/;
      const summaryRegex = /<summary>([\s\S]*?)<\/summary>/;
      const idRegex = /<id>([\s\S]*?)<\/id>/;
      const publishedRegex = /<published>([\s\S]*?)<\/published>/;
      let match;
      let checked = 0;
      while ((match = entryRegex.exec(xmlText)) !== null) {
        checked++;
        const entry = match[1];
        const titleMatch = titleRegex.exec(entry);
        const summaryMatch = summaryRegex.exec(entry);
        const idMatch = idRegex.exec(entry);
        const publishedMatch = publishedRegex.exec(entry);
        if (!titleMatch || !idMatch) continue;
        const title = titleMatch[1].trim().replace(/\s+/g, ' ');
        const summary = summaryMatch ? summaryMatch[1].trim().replace(/\s+/g, ' ').slice(0, 400) + '...' : '';
        const arxivId = idMatch[1].split('/').pop() || '';
        const published = publishedMatch ? publishedMatch[1] : new Date().toISOString();
        // Expanded relevance for all personas
        const isAI = /LLM|GPT|transformer|agent|RAG|retrieval|language model|reasoning|multimodal|vision|diffusion|embedding|neural|deep learning/i.test(title + summary);
        const isQuant = /trading|portfolio|risk|market|financial|quantitative|option|derivative|volatility/i.test(title + summary);
        const isBio = /drug|protein|genome|clinical|medical|therapeutic|biomarker/i.test(title + summary);
        // Ingest all papers from expanded categories
        feedItems.push({
          sourceId: `arxiv-${arxivId}`,
          type: "dossier",
          category: isQuant ? "finance" : isBio ? "research" : "research",
          title: title,
          summary: summary,
          url: `https://arxiv.org/abs/${arxivId}`,
          source: "ArXiv",
          tags: isQuant ? ["Research", "Quant", "Finance"] : isBio ? ["Research", "Bio", "Medical"] : ["Research", "AI", "ML"],
          metrics: [],
          publishedAt: published,
          score: 50 + Math.floor(Math.random() * 50)
        });
      }
      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }
      return { status: "success", ingested: feedItems.length, checked };
    } catch (error) {
      return { status: "error", message: String(error), ingested: 0, checked: 0 };
    }
  }
});

export const ingestRedditInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      // EXPANDED: 15 subreddits covering all personas (up from 3)
      // Banker/VC: startups, venturecapital, fintech
      // CTO: programming, devops, netsec
      // Academic: MachineLearning, LocalLLaMA, singularity
      // Pharma: biotech, pharma
      // Quant/Macro: investing, wallstreetbets, economics
      // Journalist: technology, futurology
      const subreddits = [
        // Tech & AI (CTO, Academic)
        'MachineLearning', 'LocalLLaMA', 'singularity', 'artificial',
        // Startups & Funding (Banker, VC, Corp Dev)
        'startups', 'venturecapital', 'fintech', 'Entrepreneur',
        // Finance & Macro (Quant, LP, Macro)
        'investing', 'stocks', 'economics', 'CryptoCurrency',
        // Biotech & Pharma (Pharma BD)
        'biotech', 'pharma',
        // General Tech (Journalist)
        'technology', 'programming', 'netsec'
      ];
      const feedItems: Array<any> = [];
      let totalChecked = 0;

      // Process subreddits with small delay to avoid rate limiting
      for (const subreddit of subreddits) {
        try {
          // Add small delay between requests to avoid rate limiting (500ms)
          await new Promise(resolve => setTimeout(resolve, 500));

          // INCREASED: 25 posts per subreddit (up from 10)
          const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`;
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'NodeBench:v1.0 (by /u/nodebench_research)',
              'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(10000)
          });
          if (!response.ok) {
            console.log(`[Reddit] Subreddit ${subreddit} returned ${response.status}`);
            continue;
          }
          const data = await response.json();
          const posts = data.data?.children || [];
          for (const post of posts) {
            totalChecked++;
            const p = post.data;
            if (!p || p.stickied || p.over_18) continue;
            const title = p.title || '';
            // Lower score threshold for niche subreddits, accept more content
            const minScore = ['biotech', 'pharma', 'venturecapital', 'fintech'].includes(subreddit) ? 10 : 25;
            if (p.score >= minScore) {
              const isSignal = /funding|raise|series|\$\d+|acquisition|IPO|M&A/i.test(title);
              const isBiotech = ['biotech', 'pharma'].includes(subreddit);
              const isFinance = ['investing', 'stocks', 'economics', 'CryptoCurrency'].includes(subreddit);
              const isAI = ['MachineLearning', 'LocalLLaMA', 'singularity', 'artificial'].includes(subreddit);
              feedItems.push({
                sourceId: `reddit-${p.id}`,
                type: isSignal ? "signal" : "news",
                category: isBiotech ? "research" : isFinance ? "finance" : isAI ? "ai_ml" : "tech",
                title: title.slice(0, 200),
                summary: p.selftext ? p.selftext.slice(0, 250) + '...' : `Discussion on r/${p.subreddit} with ${p.num_comments} comments.`,
                url: `https://www.reddit.com${p.permalink}`,
                source: `r/${p.subreddit}`,
                tags: ['Reddit', p.subreddit],
                metrics: [
                  { label: "Upvotes", value: p.score.toString(), trend: p.score > 500 ? "up" as const : undefined },
                  { label: "Comments", value: p.num_comments.toString() }
                ],
                publishedAt: new Date(p.created_utc * 1000).toISOString(),
                score: p.score
              });
            }
          }
        } catch {}
      }
      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }
      return { status: "success", ingested: feedItems.length, checked: totalChecked };
    } catch (error) {
      return { status: "error", message: String(error), ingested: 0, checked: 0 };
    }
  }
});

export const ingestRSSInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      // MASSIVELY EXPANDED: 25+ feeds covering ALL personas
      // Each feed has priority (1=highest) for scoring
      const feeds = [
        // ═══════════════════════════════════════════════════════════════
        // BANKER / VC / CORP DEV - Funding & Deals (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://techcrunch.com/category/venture/feed/', source: 'TechCrunch Venture', tags: ['Funding', 'VC'], priority: 1, category: 'startups' },
        { url: 'https://techcrunch.com/category/startups/feed/', source: 'TechCrunch Startups', tags: ['Startups', 'Funding'], priority: 1, category: 'startups' },
        { url: 'https://venturebeat.com/category/deals/feed/', source: 'VentureBeat Deals', tags: ['Funding', 'M&A'], priority: 1, category: 'startups' },
        { url: 'https://www.crunchbase.com/v4/data/feed/news', source: 'Crunchbase News', tags: ['Funding', 'Startups'], priority: 1, category: 'startups' },
        { url: 'https://news.crunchbase.com/feed/', source: 'Crunchbase Blog', tags: ['Funding', 'Data'], priority: 2, category: 'startups' },

        // ═══════════════════════════════════════════════════════════════
        // PRESS RELEASE WIRES - Direct Funding Announcements (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://www.businesswire.com/rss/home/?rss=G1QFDERJXkJeEF9cWA==', source: 'BusinessWire Funding', tags: ['Press Release', 'Funding'], priority: 1, category: 'startups' },
        { url: 'https://www.prnewswire.com/rss/business-technology-latest-news.rss', source: 'PR Newswire Tech', tags: ['Press Release', 'Tech'], priority: 1, category: 'startups' },
        { url: 'https://www.globenewswire.com/RssFeed/subjectcode/25-Financing%20Agreements/feedTitle/GlobeNewswire%20-%20Financing%20Agreements', source: 'GlobeNewswire Financing', tags: ['Press Release', 'Financing'], priority: 1, category: 'startups' },

        // ═══════════════════════════════════════════════════════════════
        // PREMIUM BUSINESS NEWS - Deals & M&A (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://fortune.com/feed/fortune-feeds/?id=3230629', source: 'Fortune Venture', tags: ['Fortune', 'VC'], priority: 1, category: 'startups' },
        { url: 'https://www.forbes.com/business/feed/', source: 'Forbes Business', tags: ['Forbes', 'Business'], priority: 1, category: 'finance' },
        { url: 'https://www.forbes.com/entrepreneurs/feed/', source: 'Forbes Entrepreneurs', tags: ['Forbes', 'Startups'], priority: 1, category: 'startups' },
        { url: 'https://www.axios.com/pro/deal-feed.rss', source: 'Axios Pro Deals', tags: ['Axios', 'Deals'], priority: 1, category: 'startups' },
        { url: 'https://siliconangle.com/feed/', source: 'SiliconAngle', tags: ['Enterprise', 'Cloud'], priority: 1, category: 'tech' },
        { url: 'https://www.inc.com/rss/', source: 'Inc.com', tags: ['Startups', 'Growth'], priority: 2, category: 'startups' },
        { url: 'https://seekingalpha.com/feed.xml', source: 'Seeking Alpha', tags: ['Markets', 'Analysis'], priority: 2, category: 'finance' },

        // ═══════════════════════════════════════════════════════════════
        // PHARMA BD - Biotech & Life Sciences (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://www.fiercebiotech.com/rss/xml', source: 'FierceBiotech', tags: ['Biotech', 'Pharma'], priority: 1, category: 'research' },
        { url: 'https://www.biopharmadive.com/feeds/news/', source: 'BioPharma Dive', tags: ['Pharma', 'Clinical'], priority: 1, category: 'research' },
        { url: 'https://www.fiercepharma.com/rss/xml', source: 'FiercePharma', tags: ['Pharma', 'FDA'], priority: 1, category: 'research' },
        { url: 'https://endpts.com/feed/', source: 'Endpoints News', tags: ['Biotech', 'Clinical'], priority: 1, category: 'research' },
        { url: 'https://www.statnews.com/feed/', source: 'STAT News', tags: ['Health', 'Pharma'], priority: 1, category: 'research' },

        // ═══════════════════════════════════════════════════════════════
        // QUANT PM / MACRO STRATEGIST - Finance & Markets (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://feeds.bloomberg.com/markets/news.rss', source: 'Bloomberg Markets', tags: ['Markets', 'Finance'], priority: 1, category: 'finance' },
        { url: 'https://www.ft.com/?format=rss', source: 'Financial Times', tags: ['Finance', 'Macro'], priority: 1, category: 'finance' },
        { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'Reuters Business', tags: ['Business', 'Markets'], priority: 1, category: 'finance' },
        { url: 'https://www.wsj.com/xml/rss/3_7014.xml', source: 'WSJ Markets', tags: ['Markets', 'Finance'], priority: 1, category: 'finance' },
        { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch', tags: ['Markets', 'Trading'], priority: 2, category: 'finance' },

        // ═══════════════════════════════════════════════════════════════
        // CTO / TECH LEAD - Security & DevOps (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://www.bleepingcomputer.com/feed/', source: 'BleepingComputer', tags: ['Security', 'CVE'], priority: 1, category: 'tech' },
        { url: 'https://feeds.feedburner.com/TheHackersNews', source: 'The Hacker News', tags: ['Security', 'Cyber'], priority: 1, category: 'tech' },
        { url: 'https://www.darkreading.com/rss.xml', source: 'Dark Reading', tags: ['Security', 'Enterprise'], priority: 1, category: 'tech' },
        { url: 'https://www.infoworld.com/index.rss', source: 'InfoWorld', tags: ['DevOps', 'Cloud'], priority: 2, category: 'tech' },

        // ═══════════════════════════════════════════════════════════════
        // ACADEMIC R&D - Research & Papers (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://www.nature.com/nature.rss', source: 'Nature', tags: ['Research', 'Science'], priority: 1, category: 'research' },
        { url: 'https://www.sciencemag.org/rss/news_current.xml', source: 'Science Magazine', tags: ['Research', 'Science'], priority: 1, category: 'research' },
        { url: 'https://www.technologyreview.com/feed/', source: 'MIT Tech Review', tags: ['Research', 'AI'], priority: 1, category: 'research' },

        // ═══════════════════════════════════════════════════════════════
        // JOURNALIST - General Tech & AI News (Priority 2)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://techcrunch.com/feed/', source: 'TechCrunch', tags: ['Tech', 'News'], priority: 2, category: 'tech' },
        { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge', tags: ['Tech', 'Products'], priority: 2, category: 'tech' },
        { url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', source: 'Ars Technica', tags: ['Tech', 'Deep Dive'], priority: 2, category: 'tech' },
        { url: 'https://www.wired.com/feed/rss', source: 'Wired', tags: ['Tech', 'Culture'], priority: 2, category: 'tech' },
        { url: 'https://venturebeat.com/category/ai/feed/', source: 'VentureBeat AI', tags: ['AI', 'Enterprise'], priority: 1, category: 'ai_ml' },

        // ═══════════════════════════════════════════════════════════════
        // AI-SPECIFIC - LLMs, Agents, ML (Priority 1)
        // ═══════════════════════════════════════════════════════════════
        { url: 'https://openai.com/blog/rss.xml', source: 'OpenAI Blog', tags: ['AI', 'LLM'], priority: 1, category: 'ai_ml' },
        { url: 'https://www.anthropic.com/rss.xml', source: 'Anthropic', tags: ['AI', 'Safety'], priority: 1, category: 'ai_ml' },
        { url: 'https://blog.google/technology/ai/rss', source: 'Google AI Blog', tags: ['AI', 'Research'], priority: 1, category: 'ai_ml' },
        { url: 'https://huggingface.co/blog/feed.xml', source: 'Hugging Face', tags: ['AI', 'Open Source'], priority: 1, category: 'ai_ml' },
      ];

      const feedItems: Array<any> = [];
      let totalChecked = 0;

      for (const feed of feeds) {
        try {
          const response = await fetch(feed.url, {
            headers: { 'User-Agent': 'NodeBench/1.0 (Research Feed Aggregator)' },
            signal: AbortSignal.timeout(10000) // 10s timeout per feed
          });
          if (!response.ok) continue;
          const xmlText = await response.text();
          const itemRegex = /<item>([\s\S]*?)<\/item>/g;
          const entryRegex = /<entry>([\s\S]*?)<\/entry>/g; // Atom feeds
          const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
          const linkRegex = /<link[^>]*(?:href="([^"]+)"|>([^<]+)<)/;
          const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;
          const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>|<updated>([\s\S]*?)<\/updated>/;

          // Try RSS items first, then Atom entries
          let match;
          let itemCount = 0;
          // INCREASED: 20 items per priority-1 feed, 10 per priority-2
          const maxItems = feed.priority === 1 ? 20 : 10;

          const regex = xmlText.includes('<entry>') ? entryRegex : itemRegex;

          while ((match = regex.exec(xmlText)) !== null && itemCount < maxItems) {
            totalChecked++;
            itemCount++;
            const item = match[1];
            const titleMatch = titleRegex.exec(item);
            const linkMatch = linkRegex.exec(item);
            const descMatch = descRegex.exec(item);
            const pubDateMatch = pubDateRegex.exec(item);

            if (!titleMatch || !linkMatch) continue;

            const title = titleMatch[1].trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            const link = (linkMatch[1] || linkMatch[2] || '').trim();
            const description = descMatch ? descMatch[1].trim().replace(/<[^>]+>/g, '').slice(0, 300) : '';
            const pubDate = pubDateMatch ? (pubDateMatch[1] || pubDateMatch[2]) : new Date().toISOString();

            // Minimal relevance filter - trust the source curation
            const isSignal = /funding|raise|series [A-Z]|seed|\$\d+[MB]|acquisition|IPO|M&A|partnership/i.test(title);

            const sourcePrefix = feed.source.replace(/\s+/g, '-').toLowerCase().slice(0, 20);
            feedItems.push({
              sourceId: `rss-${sourcePrefix}-${Date.now()}-${itemCount}`,
              type: isSignal ? "signal" : "news",
              category: feed.category || "tech",
              title: title.slice(0, 200),
              summary: description || `Article from ${feed.source}`,
              url: link,
              source: feed.source,
              tags: feed.tags,
              metrics: [],
              publishedAt: new Date(pubDate).toISOString() || new Date().toISOString(),
              // Priority-based scoring
              score: feed.priority === 1 ? 60 + Math.floor(Math.random() * 30) : 40 + Math.floor(Math.random() * 30)
            });
          }
        } catch (err) {
          // Silently skip failed feeds
        }
      }

      if (feedItems.length > 0) {
        await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      }
      console.log(`[ingestRSSInternal] Ingested ${feedItems.length} items from ${feeds.length} feeds`);
      return { status: "success", ingested: feedItems.length, checked: totalChecked };
    } catch (error) {
      return { status: "error", message: String(error), ingested: 0, checked: 0 };
    }
  }
});

// ============================================================================
// 8. ACTION: Fetch GitHub Trending Repos (via GitHub Search API)
// ============================================================================
export const ingestGitHubTrending = action({
  args: {},
  handler: async (ctx) => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const url = `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=20`;
      
      const response = await fetch(url, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'NodeBench/1.0' }
      });

      if (!response.ok) return { status: "error", message: `GitHub API ${response.status}` };

      const data = await response.json();
      const feedItems: Array<any> = [];

      for (const repo of (data.items || [])) {
        if (repo.stargazers_count < 50) continue;
        const isAI = /ai|ml|llm|gpt|model|neural|transformer|agent|rag/i.test(
          `${repo.name} ${repo.description || ''} ${repo.topics?.join(' ') || ''}`
        );
        feedItems.push({
          sourceId: `github-${repo.id}`,
          type: "repo" as const,
          category: isAI ? "ai_ml" as const : "opensource" as const,
          title: repo.full_name,
          summary: repo.description || `A ${repo.language || 'multi-language'} repository trending on GitHub.`,
          url: repo.html_url,
          source: "GitHub",
          tags: ["Trending", repo.language || "Code"].filter(Boolean),
          metrics: [
            { label: "Stars", value: repo.stargazers_count.toLocaleString(), trend: "up" as const },
            { label: "Forks", value: repo.forks_count.toLocaleString() }
          ],
          publishedAt: repo.created_at,
          score: repo.stargazers_count
        });
      }

      if (feedItems.length > 0) await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      return { status: "success", ingested: feedItems.length, checked: data.items?.length || 0 };
    } catch (error) {
      return { status: "error", message: String(error) };
    }
  }
});

// ============================================================================
// 9. ACTION: Fetch Product Hunt Top Products (RSS Feed)
// ============================================================================
export const ingestProductHunt = action({
  args: {},
  handler: async (ctx) => {
    try {
      const response = await fetch('https://www.producthunt.com/feed', {
        headers: { 'User-Agent': 'NodeBench/1.0', 'Accept': 'application/rss+xml, text/xml' }
      });
      if (!response.ok) return { status: "error", message: `HTTP ${response.status}` };

      const xmlText = await response.text();
      const feedItems: Array<any> = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
      const linkRegex = /<link>([\s\S]*?)<\/link>/;
      const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;

      let match, count = 0;
      while ((match = itemRegex.exec(xmlText)) !== null && count < 15) {
        count++;
        const titleMatch = titleRegex.exec(match[1]);
        const linkMatch = linkRegex.exec(match[1]);
        const descMatch = descRegex.exec(match[1]);
        if (!titleMatch || !linkMatch) continue;

        const title = titleMatch[1].trim().replace(/<[^>]+>/g, '');
        const desc = descMatch ? descMatch[1].trim().replace(/<[^>]+>/g, '').slice(0, 250) : '';

        feedItems.push({
          sourceId: `ph-${linkMatch[1].split('/').pop() || Date.now()}-${count}`,
          type: "product" as const,
          category: "products" as const,
          title: title.slice(0, 200),
          summary: desc || `New product featured on Product Hunt.`,
          url: linkMatch[1].trim(),
          source: "ProductHunt",
          tags: ["Product Launch"],
          metrics: [],
          publishedAt: new Date().toISOString(),
          score: 50 + Math.floor(Math.random() * 50)
        });
      }

      if (feedItems.length > 0) await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      return { status: "success", ingested: feedItems.length, checked: count };
    } catch (error) {
      return { status: "error", message: String(error) };
    }
  }
});

// ============================================================================
// 10. ACTION: Fetch Dev.to Top Articles (Free JSON API)
// ============================================================================
export const ingestDevTo = action({
  args: {},
  handler: async (ctx) => {
    try {
      const response = await fetch('https://dev.to/api/articles?per_page=15&top=7', {
        headers: { 'User-Agent': 'NodeBench/1.0', 'Accept': 'application/json' }
      });
      if (!response.ok) return { status: "error", message: `HTTP ${response.status}` };

      const articles = await response.json();
      const feedItems: Array<any> = [];

      for (const article of articles) {
        const isRelevant = /ai|ml|llm|typescript|react|python|rust|devops|cloud|api/i.test(
          `${article.title} ${article.tags || ''}`
        );
        if (!isRelevant) continue;
        const isAI = /ai|ml|llm|gpt|model|neural/i.test(article.title);

        feedItems.push({
          sourceId: `devto-${article.id}`,
          type: "news" as const,
          category: isAI ? "ai_ml" as const : "tech" as const,
          title: article.title,
          summary: article.description || `Article by ${article.user?.name || 'developer'} on Dev.to`,
          url: article.url,
          source: "Dev.to",
          tags: (article.tag_list || []).slice(0, 3),
          metrics: [
            { label: "Reactions", value: (article.public_reactions_count || 0).toString(), trend: "up" as const }
          ],
          publishedAt: article.published_at,
          score: article.public_reactions_count || 0
        });
      }

      if (feedItems.length > 0) await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      return { status: "success", ingested: feedItems.length, checked: articles.length };
    } catch (error) {
      return { status: "error", message: String(error) };
    }
  }
});

// Internal versions for parallel execution from ingestAll
export const ingestGitHubTrendingInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const response = await fetch(
        `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=15`,
        { headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'NodeBench/1.0' } }
      );
      if (!response.ok) return { status: "error", ingested: 0, checked: 0 };
      const data = await response.json();
      const feedItems: Array<any> = [];
      for (const repo of (data.items || []).slice(0, 15)) {
        if (repo.stargazers_count < 100) continue;
        const isAI = /ai|ml|llm|gpt|model|neural/i.test(`${repo.name} ${repo.description || ''}`);
        feedItems.push({
          sourceId: `github-${repo.id}`, type: "repo", category: isAI ? "ai_ml" : "opensource",
          title: repo.full_name, summary: repo.description || `Trending ${repo.language || ''} repo.`,
          url: repo.html_url, source: "GitHub", tags: ["Trending", repo.language].filter(Boolean),
          metrics: [{ label: "Stars", value: repo.stargazers_count.toLocaleString(), trend: "up" as const }],
          publishedAt: repo.created_at, score: repo.stargazers_count
        });
      }
      if (feedItems.length > 0) await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      return { status: "success", ingested: feedItems.length, checked: data.items?.length || 0 };
    } catch { return { status: "error", ingested: 0, checked: 0 }; }
  }
});

export const ingestProductHuntInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const response = await fetch('https://www.producthunt.com/feed', { headers: { 'User-Agent': 'NodeBench/1.0' } });
      if (!response.ok) return { status: "error", ingested: 0, checked: 0 };
      const xmlText = await response.text();
      const feedItems: Array<any> = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
      const linkRegex = /<link>([\s\S]*?)<\/link>/;
      let match, count = 0;
      while ((match = itemRegex.exec(xmlText)) !== null && count < 10) {
        count++;
        const titleMatch = titleRegex.exec(match[1]);
        const linkMatch = linkRegex.exec(match[1]);
        if (!titleMatch || !linkMatch) continue;
        feedItems.push({
          sourceId: `ph-${Date.now()}-${count}`, type: "product", category: "products",
          title: titleMatch[1].trim().replace(/<[^>]+>/g, '').slice(0, 200),
          summary: `New product on Product Hunt.`, url: linkMatch[1].trim(),
          source: "ProductHunt", tags: ["Product Launch"], metrics: [],
          publishedAt: new Date().toISOString(), score: 50 + Math.floor(Math.random() * 50)
        });
      }
      if (feedItems.length > 0) await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      return { status: "success", ingested: feedItems.length, checked: count };
    } catch { return { status: "error", ingested: 0, checked: 0 }; }
  }
});

export const ingestDevToInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const response = await fetch('https://dev.to/api/articles?per_page=10&top=7', { headers: { 'User-Agent': 'NodeBench/1.0' } });
      if (!response.ok) return { status: "error", ingested: 0, checked: 0 };
      const articles = await response.json();
      const feedItems: Array<any> = [];
      for (const article of articles) {
        const isAI = /ai|ml|llm|gpt/i.test(article.title);
        feedItems.push({
          sourceId: `devto-${article.id}`, type: "news", category: isAI ? "ai_ml" : "tech",
          title: article.title, summary: article.description || `Dev.to article`,
          url: article.url, source: "Dev.to", tags: (article.tag_list || []).slice(0, 3),
          metrics: [{ label: "Reactions", value: String(article.public_reactions_count || 0) }],
          publishedAt: article.published_at, score: article.public_reactions_count || 0
        });
      }
      if (feedItems.length > 0) await ctx.runMutation(internal.feed.saveItems, { items: feedItems });
      return { status: "success", ingested: feedItems.length, checked: articles.length };
    } catch { return { status: "error", ingested: 0, checked: 0 }; }
  }
});
