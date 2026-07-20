import type { Id } from "../../../convex/_generated/dataModel";

// Runtime guard for Convex Id strings. Keeps it intentionally simple:
// - must be a non-empty string. Further shape checks (like prefix) are avoided
//   to remain compatible with Convex id serialization across environments.
export function isValidConvexId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Narrow helper when you know the target table. Example usage after validation:
// const docId = (documentId as unknown) as Id<"documents">;
export type AnyId = Id<any>;
