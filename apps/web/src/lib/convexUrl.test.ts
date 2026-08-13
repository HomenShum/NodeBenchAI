import { describe, expect, it } from "vitest";
import { resolveConvexUrl } from "./convexUrl";

/**
 * The case that shipped: `.env.example` line 11 is
 * `VITE_CONVEX_URL=https://your-project.convex.cloud`, and the README says
 * `cp .env.example .env.local`. Before this guard existed, that string passed a
 * truthiness check, the app mounted, and Convex's edge killed the socket with
 * `FatalError: Couldn't parse deployment name your-project`.
 */
const README_DOCUMENTED_PLACEHOLDER = "https://your-project.convex.cloud";

/** The value MissingConvexUrlScreen itself prints as the example to copy. */
const SETUP_CARD_PLACEHOLDER = "https://your-deployment.convex.cloud";

describe("resolveConvexUrl", () => {
  it("rejects the placeholder the README tells a stranger to copy", () => {
    expect(resolveConvexUrl(README_DOCUMENTED_PLACEHOLDER)).toBeNull();
    expect(resolveConvexUrl(SETUP_CARD_PLACEHOLDER)).toBeNull();
  });

  it("rejects absent and blank values", () => {
    expect(resolveConvexUrl(undefined)).toBeNull();
    expect(resolveConvexUrl(null)).toBeNull();
    expect(resolveConvexUrl("")).toBeNull();
    expect(resolveConvexUrl("   ")).toBeNull();
  });

  it("rejects strings that are not http(s) URLs", () => {
    expect(resolveConvexUrl("not a url")).toBeNull();
    expect(resolveConvexUrl("agile-caribou-964.convex.cloud")).toBeNull();
    expect(resolveConvexUrl("ws://agile-caribou-964.convex.cloud")).toBeNull();
  });

  it("accepts a real deployment URL, trailing slash and all", () => {
    expect(resolveConvexUrl("https://agile-caribou-964.convex.cloud")).toBe(
      "https://agile-caribou-964.convex.cloud",
    );
    expect(resolveConvexUrl("https://agile-caribou-964.convex.cloud/")).toBe(
      "https://agile-caribou-964.convex.cloud",
    );
    expect(resolveConvexUrl("  https://small-mouse-123.convex.cloud  ")).toBe(
      "https://small-mouse-123.convex.cloud",
    );
  });

  it("leaves non-convex.cloud hosts alone — that is the self-hosted backend", () => {
    expect(resolveConvexUrl("http://127.0.0.1:3210")).toBe("http://127.0.0.1:3210");
    expect(resolveConvexUrl("https://convex.internal.example.com")).toBe(
      "https://convex.internal.example.com",
    );
  });
});
