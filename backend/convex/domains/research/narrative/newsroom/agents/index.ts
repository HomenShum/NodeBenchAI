/**
 * Newsroom Agents - Barrel Export
 *
 * Re-exports all agents in the Newsroom pipeline:
 * 1. Scout Agent - News discovery and ingestion
 * 2. Historian Agent - Historical context retrieval
 * 3. Analyst Agent - Narrative shift detection
 * 4. Publisher Agent - Narrative publication with citations
 * 5. Curator Agent - Thread thesis management (Phase 7)
 * 6. Comment Harvester - Pull HN/Reddit/X commentary (Phase 7)
 *
 * @module domains/narrative/newsroom/agents
 */

export {
  runScoutAgent,
  scoutAgentTool,
  type ScoutConfig,
} from "./scoutAgent";

export {
  runHistorianAgent,
  historianAgentTool,
  type HistorianConfig,
} from "./historianAgent";

export {
  runAnalystAgent,
  analystAgentTool,
  type AnalystConfig,
} from "./analystAgent";

export {
  runPublisherAgent,
  publisherAgentTool,
  type PublisherConfig,
} from "./publisherAgent";

export {
  runCuratorAgent,
  curatorAgentTool,
  type CuratorConfig,
} from "./curatorAgent";

export {
  runCommentHarvester,
  commentHarvesterTool,
  type CommentHarvesterConfig,
} from "./commentHarvester";

export {
  runSignalCollectorAgent,
  signalCollectorAgentTool,
  type SignalCollectorConfig,
} from "./signalCollectorAgent";
