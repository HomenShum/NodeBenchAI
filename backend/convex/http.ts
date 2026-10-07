import { auth } from "./domains/auth/auth";
import router from "./router";
import { polar } from "./domains/integrations/polar";
import { ossStats } from "./domains/analytics/ossStats";
import { twilioComponent, hasTwilioCreds } from "./domains/integrations/sms";
import { telegramWebhookHandler } from "./domains/integrations/telegramAgent";
import { discordWebhookHandler } from "./domains/integrations/discordAgent";
import { gmailPushHandler } from "./domains/integrations/email/emailWebhook";
import {
  slackEventsHandler,
  slackCommandsHandler,
  slackInteractivityHandler,
} from "./domains/integrations/slack/slackWebhook";
import {
  authorizeHandler as linkedinAuthorizeHandler,
  callbackHandler as linkedinCallbackHandler,
} from "./domains/social/linkedinOAuth";
import { openclawInboundHandler } from "./domains/messaging/inboundPipeline";

const http = router;

auth.addHttpRoutes(http);
polar.registerRoutes(http);

// Register Twilio component routes for incoming messages and status callbacks
// Routes: /twilio/incoming-message, /twilio/message-status
if (hasTwilioCreds && twilioComponent) {
  twilioComponent.registerRoutes(http);
}

// Register Telegram webhook for bot messages (100% FREE)
// Route: /telegram/webhook
// Setup: Call setWebhook action after deployment
http.route({
  path: "/telegram/webhook",
  method: "POST",
  handler: telegramWebhookHandler,
});


// Register Discord interactions webhook for slash commands (FREE)
// Route: /discord/interactions
// Setup: Set Interactions Endpoint URL in Discord Developer Portal
http.route({
  path: "/discord/interactions",
  method: "POST",
  handler: discordWebhookHandler,
});

// ═══════════════════════════════════════════════════════════════════════════
// SLACK INTEGRATION - Encounter Capture & Distribution (FREE)
// ═══════════════════════════════════════════════════════════════════════════

// Slack Events API webhook for messages and app_mention events
// Route: /slack/events
// Setup: Configure Event Subscriptions in Slack App settings
http.route({
  path: "/slack/events",
  method: "POST",
  handler: slackEventsHandler,
});

// Slack Slash Commands webhook
// Route: /slack/commands
// Setup: Create slash commands in Slack App settings pointing to this URL
// Commands: /encounter, /research, /digest, /help
http.route({
  path: "/slack/commands",
  method: "POST",
  handler: slackCommandsHandler,
});

// Slack Interactivity webhook for button clicks and modal submissions
// Route: /slack/interactivity
// Setup: Configure Interactivity & Shortcuts in Slack App settings
http.route({
  path: "/slack/interactivity",
  method: "POST",
  handler: slackInteractivityHandler,
});

// Register Gmail push notification webhook for real-time email triggers
// Route: /api/gmail/push
// Setup: Configure Google Cloud Pub/Sub to push to this endpoint
http.route({
  path: "/api/gmail/push",
  method: "POST",
  handler: gmailPushHandler,
});

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN OAUTH - Token refresh flow
// ═══════════════════════════════════════════════════════════════════════════

// GET /linkedin/oauth/authorize - Redirect to LinkedIn auth page
http.route({
  path: "/linkedin/oauth/authorize",
  method: "GET",
  handler: linkedinAuthorizeHandler,
});

// GET /linkedin/oauth/callback - Exchange auth code for tokens
http.route({
  path: "/linkedin/oauth/callback",
  method: "GET",
  handler: linkedinCallbackHandler,
});

// ═══════════════════════════════════════════════════════════════════════════
// OPENCLAW GATEWAY - Multi-channel messaging (WhatsApp, Signal, iMessage, etc.)
// ═══════════════════════════════════════════════════════════════════════════

// OpenClaw Gateway inbound webhook for all Gateway-connected channels
// Route: /openclaw/inbound
// Setup: Configure OpenClaw hook handler to POST to this endpoint
// Requires: OPENCLAW_WEBHOOK_SECRET env var for HMAC validation (optional in dev)
http.route({
  path: "/openclaw/inbound",
  method: "POST",
  handler: openclawInboundHandler,
});

// Only register GitHub webhook routes if a token/secret is configured.
// This avoids requiring GITHUB_ACCESS_TOKEN at deploy time.
try {
  const hasGithubToken = Boolean(process.env.GITHUB_ACCESS_TOKEN);
  const hasGithubSecret = Boolean(process.env.GITHUB_WEBHOOK_SECRET);
  if (hasGithubToken && hasGithubSecret) {
    ossStats.registerRoutes(http);
  }
} catch {
  // noop: keep HTTP server usable even if env access fails during analysis
}

export default http;
