import { defineApp } from "convex/server";
import prosemirrorSync from "@convex-dev/prosemirror-sync/convex.config";
import presence from "@convex-dev/presence/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import rag from "@convex-dev/rag/convex.config";
import twilio from "@convex-dev/twilio/convex.config";
import agent from "@convex-dev/agent/convex.config";
import polar from "@convex-dev/polar/convex.config";
import ossStats from "@erquhart/convex-oss-stats/convex.config";
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/convex.config";

const app = defineApp();
app.use(prosemirrorSync);
app.use(presence);
app.use(agent);
app.use(workpool);
app.use(workflow);
app.use(rag);
app.use(persistentTextStreaming);

// Only register Twilio when credentials are present. In CI / mock builds, skip it.
const hasTwilioCreds = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER,
);
if (hasTwilioCreds) {
  app.use(twilio);
}

app.use(polar);
app.use(ossStats);

export default app;
