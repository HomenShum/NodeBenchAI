/**
 * useStableQuery - Convex query hook that preserves stale data during re-subscription.
 *
 * Based on the official Convex pattern from:
 * https://stack.convex.dev/help-my-app-is-overreacting
 *
 * When switching views/filters, Convex's useQuery returns `undefined` while
 * re-establishing the subscription. This hook keeps the last known result
 * visible until fresh data arrives, eliminating loading flashes.
 */
import { useRef } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import type { OptionalRestArgsOrSkip } from "convex/react";

export function useStableQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const result = useQuery(query, ...args);
  const stored = useRef(result);

  // Only update stored value when fresh data arrives (not undefined)
  if (result !== undefined) {
    stored.current = result;
  }

  return stored.current;
}
