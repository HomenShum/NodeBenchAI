import { Workpool } from "@convex-dev/workpool";
import { components } from "../../../_generated/api";

// Shared workpool for post-OAuth provider sync tasks
export const syncPool = new Workpool(components.workpool, {
  // Limit concurrent provider syncs to avoid rate limits
  maxParallelism: 3,
});
