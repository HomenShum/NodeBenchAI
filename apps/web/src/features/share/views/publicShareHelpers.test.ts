/**
 * Scenario tests for publicShareHelpers.
 *
 * Personas:
 *   - Investor receiving a clean /share/{token} URL via email
 *   - Investor who mangled the URL (missing token, trailing junk)
 *   - Owner checking the minted URL format matches expected origin
 *   - App running in a rendered SPA frame (origin missing/odd)
 */

import { describe, it, expect } from "vitest";
import {
  parseShareTokenFromPath,
  describeShareStatus,
  buildShareUrl,
} from "./publicShareHelpers";

describe("parseShareTokenFromPath — investor copy-paste scenarios", () => {
  it("clean /share/{token} → token extracted", () => {
    expect(parseShareTokenFromPath("/share/abc123_xyz-DEF")).toBe("abc123_xyz-DEF");
  });

  it("trailing slash tolerated", () => {
    expect(parseShareTokenFromPath("/share/abc123/")).toBe("abc123");
  });

  it("missing token → null", () => {
    expect(parseShareTokenFromPath("/share/")).toBeNull();
    expect(parseShareTokenFromPath("/share")).toBeNull();
  });

  it("wrong prefix → null (does not steal from /shared or /shareholder)", () => {
    expect(parseShareTokenFromPath("/shared/abc")).toBeNull();
    expect(parseShareTokenFromPath("/shareholder/abc")).toBeNull();
    expect(parseShareTokenFromPath("/")).toBeNull();
  });

  it("query string appended → regex stops at whitespace boundary", () => {
    // pathname never includes query string in practice, but test that
    // illegal chars fail gracefully
    expect(parseShareTokenFromPath("/share/abc?x=1")).toBeNull();
    expect(parseShareTokenFromPath("/share/abc#frag")).toBeNull();
  });

  it("adversarial: path traversal chars rejected", () => {
    expect(parseShareTokenFromPath("/share/../../etc/passwd")).toBeNull();
    expect(parseShareTokenFromPath("/share/abc/secondary")).toBeNull();
  });

  it("realistic 43-char base64url token parses cleanly", () => {
    const tok = "Nx7_pK2aQm9vH4wLz1rTbYc6EfGhI0jKlMnOpQrSt3u";
    expect(parseShareTokenFromPath(`/share/${tok}`)).toBe(tok);
  });
});

describe("describeShareStatus — HONEST_STATUS messaging", () => {
  it("every non-active status yields title + body (operator never sees blank)", () => {
    for (const s of ["not_found", "revoked", "expired"] as const) {
      const d = describeShareStatus(s);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(0);
    }
  });

  it("active yields empty descriptor (caller renders content instead)", () => {
    expect(describeShareStatus("active")).toEqual({ title: "", body: "" });
  });

  it("messaging is distinct per status (no generic fallback)", () => {
    const nf = describeShareStatus("not_found");
    const rv = describeShareStatus("revoked");
    const ex = describeShareStatus("expired");
    expect(nf.body).not.toBe(rv.body);
    expect(rv.body).not.toBe(ex.body);
    expect(nf.body).not.toBe(ex.body);
  });
});

describe("buildShareUrl — owner copies link", () => {
  it("normal origin + token", () => {
    expect(buildShareUrl("https://app.nodebenchai.com", "abc")).toBe(
      "https://app.nodebenchai.com/share/abc",
    );
  });

  it("trailing slash on origin is stripped", () => {
    expect(buildShareUrl("https://app.nodebenchai.com/", "abc")).toBe(
      "https://app.nodebenchai.com/share/abc",
    );
  });

  it("empty origin (SSR-safe fallback) yields relative URL", () => {
    expect(buildShareUrl("", "abc")).toBe("/share/abc");
  });

  it("deterministic: same input → same URL", () => {
    const a = buildShareUrl("https://x.com", "t1");
    const b = buildShareUrl("https://x.com", "t1");
    expect(a).toBe(b);
  });
});
