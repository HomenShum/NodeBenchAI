/**
 * Scenario-based tests for the frontend video-provider detector.
 *
 * Persona axis:
 *   - Editorial reader (happy path): clicking a YouTube footnote.
 *   - Adversarial author: pasting a non-https / non-allowlisted URL.
 *   - Distracted writer: trailing punctuation, query strings, etc.
 *   - Cold-start: ingestion just inserted a video URL with no cache yet.
 *
 * Failure-mode axis:
 *   - Malformed URLs (return null, never throw).
 *   - Unsupported providers (Dailymotion, TikTok) → null.
 *   - http:// (downgrade attempt) → null.
 *   - Suspicious video IDs (../, javascript:) → null.
 *
 * The detector is the FIRST layer of SSRF defense (the second layer is
 * the server-side hostname allowlist in `oembedFetcher.ts`).  These
 * tests pin the contract so a future regex tweak doesn't accidentally
 * widen the surface area.
 */

import { describe, expect, it } from "vitest";
import {
  detectVideoProviderClient,
  isVideoUrl,
} from "./videoProvider";

describe("detectVideoProviderClient — happy paths", () => {
  it("detects YouTube watch URLs", () => {
    const r = detectVideoProviderClient(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(r?.provider).toBe("youtube");
    expect(r?.videoId).toBe("dQw4w9WgXcQ");
  });

  it("detects YouTube watch URLs with extra params", () => {
    const r = detectVideoProviderClient(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLwxYz",
    );
    expect(r?.provider).toBe("youtube");
    expect(r?.videoId).toBe("dQw4w9WgXcQ");
  });

  it("detects youtu.be short URLs", () => {
    const r = detectVideoProviderClient("https://youtu.be/dQw4w9WgXcQ");
    expect(r?.provider).toBe("youtube");
    expect(r?.videoId).toBe("dQw4w9WgXcQ");
  });

  it("detects Vimeo URLs", () => {
    const r = detectVideoProviderClient("https://vimeo.com/76979871");
    expect(r?.provider).toBe("vimeo");
    expect(r?.videoId).toBe("76979871");
  });

  it("detects Twitch clip URLs (clips.twitch.tv shape)", () => {
    const r = detectVideoProviderClient(
      "https://clips.twitch.tv/AwfulBitterSheepKappa-abc123def",
    );
    expect(r?.provider).toBe("twitch");
    expect(r?.videoId).toBe("AwfulBitterSheepKappa-abc123def");
  });

  it("detects Twitch clip URLs (twitch.tv/{user}/clip/{id} shape)", () => {
    const r = detectVideoProviderClient(
      "https://www.twitch.tv/somestreamer/clip/AwfulBitterSheepKappa",
    );
    expect(r?.provider).toBe("twitch");
    expect(r?.videoId).toBe("AwfulBitterSheepKappa");
  });

  it("detects Loom share URLs", () => {
    const r = detectVideoProviderClient(
      "https://www.loom.com/share/abc123def456",
    );
    expect(r?.provider).toBe("loom");
    expect(r?.videoId).toBe("abc123def456");
  });
});

describe("detectVideoProviderClient — adversarial / sad paths", () => {
  it("rejects http:// (downgrade attempt)", () => {
    expect(
      detectVideoProviderClient("http://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
  });

  it("rejects javascript: URLs", () => {
    expect(detectVideoProviderClient("javascript:alert(1)")).toBeNull();
  });

  it("rejects malformed URLs without throwing", () => {
    expect(detectVideoProviderClient("not-a-url")).toBeNull();
    expect(detectVideoProviderClient("")).toBeNull();
    expect(detectVideoProviderClient("//missing-scheme.com")).toBeNull();
  });

  it("rejects unsupported providers (Dailymotion)", () => {
    expect(
      detectVideoProviderClient("https://www.dailymotion.com/video/xabcdef"),
    ).toBeNull();
  });

  it("rejects unsupported providers (TikTok)", () => {
    expect(
      detectVideoProviderClient("https://www.tiktok.com/@user/video/12345"),
    ).toBeNull();
  });

  it("rejects YouTube URLs with no video id", () => {
    expect(
      detectVideoProviderClient("https://www.youtube.com/watch"),
    ).toBeNull();
  });

  it("rejects Vimeo non-numeric ids", () => {
    expect(
      detectVideoProviderClient("https://vimeo.com/abcdef"),
    ).toBeNull();
  });

  it("rejects Loom URLs that aren't share links", () => {
    expect(
      detectVideoProviderClient("https://www.loom.com/dashboard"),
    ).toBeNull();
  });

  it("rejects Twitch URLs missing /clip/ segment", () => {
    expect(
      detectVideoProviderClient("https://www.twitch.tv/somestreamer/videos"),
    ).toBeNull();
  });

  it("rejects subdomain spoofing (youtube.com.evil.example)", () => {
    expect(
      detectVideoProviderClient(
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      ),
    ).toBeNull();
  });
});

describe("isVideoUrl — convenience boolean", () => {
  it("returns true for supported videos", () => {
    expect(isVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isVideoUrl("https://vimeo.com/76979871")).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isVideoUrl(null)).toBe(false);
    expect(isVideoUrl(undefined)).toBe(false);
    expect(isVideoUrl("")).toBe(false);
  });

  it("returns false for non-video URLs", () => {
    expect(isVideoUrl("https://example.com/article")).toBe(false);
    expect(isVideoUrl("https://news.ycombinator.com/item?id=1")).toBe(false);
  });
});
