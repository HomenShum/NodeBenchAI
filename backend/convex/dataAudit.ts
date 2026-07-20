import { query } from "./_generated/server";

export const auditData = query({
  args: {},
  handler: async (ctx) => {
    // Check various data sources
    const feedItems = await ctx.db.query("feedItems").take(5);
    const blips = await ctx.db.query("blips").take(5);
    const fundingRounds = await ctx.db.query("fundingRounds").take(5);
    const entities = await ctx.db.query("entities").take(5);
    const documents = await ctx.db.query("documents").take(5);
    const agentRuns = await ctx.db.query("agentRuns").take(5);
    const threads = await ctx.db.query("fastAgentThreads").take(5);

    // NEW: Check daily brief and landing page data sources
    const landingPageLog = await ctx.db.query("landingPageLog").order("desc").take(5);
    const dailyBriefMemories = await ctx.db.query("dailyBriefMemories").order("desc").take(3);
    const dailyBriefSnapshots = await ctx.db.query("dailyBriefSnapshots").order("desc").take(3);
    const feedEngagements = await ctx.db.query("feedEngagements").order("desc").take(10);

    return {
      feedItems: feedItems.length,
      blips: blips.length,
      fundingRounds: fundingRounds.length,
      entities: entities.length,
      documents: documents.length,
      agentRuns: agentRuns.length,
      threads: threads.length,
      // Daily brief pipeline data
      landingPageLog: landingPageLog.length,
      dailyBriefMemories: dailyBriefMemories.length,
      dailyBriefSnapshots: dailyBriefSnapshots.length,
      feedEngagements: feedEngagements.length,
      // Samples
      sampleFeedItem: feedItems[0],
      sampleBlip: blips[0],
      sampleEntity: entities[0],
      sampleDocument: documents[0],
      sampleLandingPageLog: landingPageLog[0],
      sampleDailyBriefMemory: dailyBriefMemories[0],
    };
  },
});
