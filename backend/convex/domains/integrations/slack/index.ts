/**
 * Slack Integration - Encounter Capture & Distribution
 *
 * Phone-first distribution system for professional networking encounters.
 * Enables fast capture via Slack messages and /encounter command.
 *
 * Features:
 * - /encounter command for quick logging
 * - Message capture for DM-based notes
 * - Entity extraction and research triggers
 * - Slack Block Kit rich responses
 * - End-of-day digest delivery
 *
 * Setup:
 * 1. Create Slack App at https://api.slack.com/apps
 * 2. Enable OAuth & Permissions with scopes: chat:write, commands, app_mentions:read
 * 3. Create Slash Commands: /encounter, /research, /digest, /help
 * 4. Enable Event Subscriptions with URL: https://<your-convex-site>/slack/events
 * 5. Enable Interactivity with URL: https://<your-convex-site>/slack/interactivity
 * 6. Set SLACK_SIGNING_SECRET in Convex env vars
 *
 * @module integrations/slack
 */

// HTTP Handlers (registered in http.ts)
export {
  slackEventsHandler,
  slackCommandsHandler,
  slackInteractivityHandler,
  verifySlackSignature,
} from "./slackWebhook";

// Agent/Event Handlers
export {
  handleSlackEvent,
  handleSlashCommand,
  handleButtonClick,
  handleModalSubmission,
  handleShortcut,
  sendSlackMessage,
  sendSlackDigest,
  findNodeBenchUser,
  logSlackInteraction,
} from "./slackAgent";

// Block Kit Message Builders
export {
  buildEncounterConfirmation,
  buildDigestBlocks,
  buildHelpBlocks,
  buildErrorBlocks,
  buildResearchStatusBlocks,
} from "./slackBlocks";

// Encounter Parser
export { parseEncounterText } from "./encounterParser";

// Entity Resolver
export {
  resolveEncounterEntities,
  findEntityByName,
  getRecentEntities,
  searchEntitiesByName,
} from "./encounterResolver";

// Encounter Mutations
export {
  createEncounter,
  updateEncounterResearchStatus,
  generateFollowUpTasks,
  createFollowUpTask,
  getRecentEncounters,
  getEncounterBySourceId,
  getEncountersWithPendingFollowUps,
} from "./encounterMutations";

// Research Triggers (actions)
export {
  triggerFastPassResearch,
  triggerDeepDiveResearch,
} from "./encounterResearch";

// Research Queries & Mutations
export {
  getEntityResearchCache,
  createResearchTask,
  updateEntityWithResearch,
} from "./encounterResearchQueries";
