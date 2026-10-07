"use node";
// convex/lib/hash.ts - Centralized hashing utilities

import { createHash } from "crypto";

/**
 * Generate SHA-256 hash of input string and return as hex
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Async version for compatibility with browser-style code
 */
export async function sha256HexAsync(input: string): Promise<string> {
  return sha256Hex(input);
}
