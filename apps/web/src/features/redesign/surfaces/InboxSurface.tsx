import { ExactInboxSurface } from "../../designKit/exact/ExactKit";

/**
 * The redesign shell and compact shell share one owner-scoped Inbox runtime.
 * Keeping a second queue implementation here previously left unreachable
 * controls, local-only mutations, and stale projection copy in the bundle.
 */
export function InboxSurface() {
  return <ExactInboxSurface />;
}
