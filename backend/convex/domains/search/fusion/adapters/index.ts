/**
 * Search Fusion Adapters
 *
 * Re-exports all search source adapters.
 *
 * FREE-FIRST PRIORITY:
 * 1. brave (2,000/month) - General web, privacy-focused
 * 2. serper (2,500/month) - Google SERP, fastest
 * 3. tavily (1,000/month) - AI-native, semantic
 * 4. exa (2,000 one-time) - Neural search
 * 5. linkup (pay per use) - Fallback
 *
 * @module search/fusion/adapters
 */

// FREE-TIER ADAPTERS (prioritized)
export { BraveAdapter, braveAdapter } from "./braveAdapter";
export { SerperAdapter, serperAdapter } from "./serperAdapter";
export { TavilyAdapter, tavilyAdapter } from "./tavilyAdapter";

// PAID ADAPTER (fallback)
export { LinkupAdapter, linkupAdapter } from "./linkupAdapter";

// SPECIALIZED ADAPTERS
export { SecAdapter, secAdapter } from "./secAdapter";
export { RagAdapter, createRagAdapter } from "./ragAdapter";
export { DocumentAdapter, createDocumentAdapter } from "./documentAdapter";
export { YouTubeAdapter, youtubeAdapter } from "./youtubeAdapter";
export { ArxivAdapter, arxivAdapter } from "./arxivAdapter";
export { NewsAdapter, newsAdapter } from "./newsAdapter";

