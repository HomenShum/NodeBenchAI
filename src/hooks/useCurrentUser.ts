/**
 * useCurrentUser / useCurrentUserId — typed hooks for the viewer identity.
 *
 * Wraps the existing `api.domains.auth.auth.loggedInUser` Convex query that
 * was already used ad-hoc across many call sites (calendar, documents,
 * notification panel, sync provenance badge, etc). Centralizing gives us:
 *
 *   - One auth-coupling per surface (drop the badge in any tree without
 *     reinventing the query call)
 *   - HONEST_STATUS — `useCurrentUserId()` returns `null` for guests and
 *     `undefined` while loading. Callers MUST handle both, never pass an
 *     empty string downstream (Convex queries that key on `userId` would
 *     otherwise return data for "no such user" or error).
 *
 * Pattern: Read-through hook — mirrors the `loggedInUser` shape.
 *
 * See: convex/domains/auth/auth.ts (loggedInUser query)
 *      .claude/rules/agentic_reliability.md (HONEST_STATUS)
 */

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/** Full user doc, or `null` (signed out), or `undefined` (loading). */
export function useCurrentUser() {
  return useQuery(api.domains.auth.auth.loggedInUser);
}

/**
 * Just the viewer's Convex `_id`, or `null` (signed out), or `undefined`
 * (loading). Use this when you only need the id (e.g. to scope a child
 * query). Never coerce to an empty string — see HONEST_STATUS in module
 * header.
 */
export function useCurrentUserId(): Id<"users"> | null | undefined {
  const user = useCurrentUser();
  if (user === undefined) return undefined;
  if (user === null) return null;
  return user._id as Id<"users">;
}
