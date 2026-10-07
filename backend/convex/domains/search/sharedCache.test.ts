/**
 * Unit tests for the pure-helper surface of sharedCache.
 *
 * Convex mutations/queries are tested via integration; here we lock the
 * privacy primitives: key determinism, URL origin validation, user-content
 * detection, source classification, confidence clamping.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalKey,
  signalKey,
  currentDayBucket,
  isPublicOriginUrl,
  classifySourceClass,
  detectUserContent,
  clampConfidence,
  TTL_BY_SOURCE_CLASS,
  MAX_CSL_BODY_BYTES,
  MAX_ESL_VALUE_BYTES,
} from "./sharedCache";

describe("sharedCache keys", () => {
  it("canonicalKey is deterministic per (url, day)", () => {
    expect(canonicalKey("https://anthropic.com", "2026-04-22")).toBe(
      canonicalKey("https://anthropic.com", "2026-04-22"),
    );
  });

  it("canonicalKey is case-insensitive and trim-insensitive on URL", () => {
    expect(canonicalKey("  HTTPS://ANTHROPIC.COM  ", "2026-04-22")).toBe(
      canonicalKey("https://anthropic.com", "2026-04-22"),
    );
  });

  it("canonicalKey differs when day differs", () => {
    expect(canonicalKey("https://x.com", "2026-04-22")).not.toBe(
      canonicalKey("https://x.com", "2026-04-23"),
    );
  });

  it("signalKey is deterministic per (entity, signal, day)", () => {
    const a = signalKey("anthropic", "funding_round_amount", "2026-04-22");
    const b = signalKey("Anthropic", " FUNDING_ROUND_AMOUNT ", "2026-04-22");
    expect(a).toBe(b);
  });

  it("currentDayBucket is YYYY-MM-DD", () => {
    expect(currentDayBucket(Date.parse("2026-04-22T10:00:00Z"))).toBe("2026-04-22");
  });
});

describe("sharedCache isPublicOriginUrl", () => {
  it("accepts plain https URLs", () => {
    expect(isPublicOriginUrl("https://www.anthropic.com/news").ok).toBe(true);
  });

  it("rejects RFC1918 private hosts", () => {
    for (const host of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.1/x",
      "http://172.16.0.1/x",
      "http://192.168.1.1/x",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/x",
      "http://metadata.google.internal/x",
    ]) {
      const r = isPublicOriginUrl(host);
      expect(r.ok, `expected ${host} to be blocked`).toBe(false);
    }
  });

  it("rejects non-http(s) protocols", () => {
    expect(isPublicOriginUrl("file:///etc/passwd").ok).toBe(false);
    expect(isPublicOriginUrl("ftp://example.com").ok).toBe(false);
    expect(isPublicOriginUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects URLs with basic-auth credentials", () => {
    expect(isPublicOriginUrl("https://user:pass@example.com/x").ok).toBe(false);
  });

  it("rejects URLs with auth-like query parameters", () => {
    const params = [
      "access_token",
      "id_token",
      "refresh_token",
      "api_key",
      "apikey",
      "auth",
      "session",
      "sessionid",
      "sid",
      "signature",
      "sig",
    ];
    for (const p of params) {
      const url = `https://example.com/x?${p}=abc`;
      expect(isPublicOriginUrl(url).ok, `${p} must be rejected`).toBe(false);
    }
  });

  it("rejects malformed URLs", () => {
    expect(isPublicOriginUrl("not-a-url").ok).toBe(false);
    expect(isPublicOriginUrl("").ok).toBe(false);
  });
});

describe("sharedCache classifySourceClass", () => {
  it("detects regulatory sources", () => {
    expect(classifySourceClass("https://www.sec.gov/cgi-bin/browse-edgar")).toBe("regulatory");
  });

  it("detects news sources", () => {
    expect(classifySourceClass("https://techcrunch.com/2026/04/x")).toBe("news");
    expect(classifySourceClass("https://www.reuters.com/technology")).toBe("news");
    expect(classifySourceClass("https://www.bloomberg.com/news")).toBe("news");
  });

  it("detects careers sources", () => {
    expect(classifySourceClass("https://boards.greenhouse.io/company/job/123")).toBe("careers");
    expect(classifySourceClass("https://jobs.ashbyhq.com/company")).toBe("careers");
  });

  it("detects profile sources", () => {
    expect(classifySourceClass("https://www.crunchbase.com/organization/anthropic")).toBe(
      "profile",
    );
    expect(classifySourceClass("https://www.linkedin.com/company/anthropic")).toBe("profile");
  });

  it("falls back to 'other' for unknown hosts", () => {
    expect(classifySourceClass("https://example.com")).toBe("other");
  });

  it("each source class has a defined TTL", () => {
    for (const cls of ["news", "careers", "profile", "regulatory", "other"] as const) {
      expect(TTL_BY_SOURCE_CLASS[cls]).toBeGreaterThan(0);
    }
  });
});

describe("sharedCache detectUserContent", () => {
  it("passes clean public content", () => {
    expect(detectUserContent("Stripe is a payment platform. Founded in 2010.").clean).toBe(true);
  });

  it("flags bearer tokens", () => {
    const r = detectUserContent("Authorization: Bearer abc123xyz.456");
    expect(r.clean).toBe(false);
  });

  it("flags API key shape", () => {
    const r = detectUserContent("key=sk-abcdefghijklmnopqrstuvwxyz0123456789abcd");
    expect(r.clean).toBe(false);
  });

  it("flags userId JSON field", () => {
    expect(detectUserContent('{"userId":"user_abc"}').clean).toBe(false);
  });

  it("flags ownerKey JSON field", () => {
    expect(detectUserContent('{"ownerKey":"abc"}').clean).toBe(false);
  });

  it("flags scratchpad JSON field", () => {
    expect(detectUserContent('{"scratchpad":{"entity":"x"}}').clean).toBe(false);
  });

  it("flags threadId JSON field", () => {
    expect(detectUserContent('{"threadId":"thr_123"}').clean).toBe(false);
  });

  it("flags Cookie header", () => {
    expect(detectUserContent("Cookie: session=abc").clean).toBe(false);
  });

  it("flags privateNote JSON field", () => {
    expect(detectUserContent('{"privateNote":"my secret"}').clean).toBe(false);
  });
});

describe("sharedCache clampConfidence", () => {
  it("clamps above 1 to 1", () => {
    expect(clampConfidence(1.5)).toBe(1);
  });
  it("clamps below 0 to 0", () => {
    expect(clampConfidence(-0.5)).toBe(0);
  });
  it("passes through valid", () => {
    expect(clampConfidence(0.7)).toBe(0.7);
  });
  it("clamps NaN to 0", () => {
    expect(clampConfidence(Number.NaN)).toBe(0);
  });
});

describe("sharedCache bounds exposed", () => {
  it("MAX_CSL_BODY_BYTES is 1 MB", () => {
    expect(MAX_CSL_BODY_BYTES).toBe(1_024 * 1_024);
  });
  it("MAX_ESL_VALUE_BYTES is 4 KB", () => {
    expect(MAX_ESL_VALUE_BYTES).toBe(4_096);
  });
});
