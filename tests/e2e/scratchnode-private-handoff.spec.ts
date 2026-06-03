/**
 * E2E honesty spec for the ScratchNode → NodeBench PRIVATE-NOTES handoff
 * (roadmap item #4), home-v5.html side.
 *
 * Own spec file (not folded into scratchnode-live-route-honesty.spec.ts) to
 * avoid merge conflicts on that hot file.
 *
 * Contract under test (the security-critical client behavior):
 *   1. SUCCESS — when a live room session can mint, openNodeBenchPrivateHandoff
 *      calls scratchnodeHandoff:mintEventHandoffToken with { slug, sessionId },
 *      then navigates to the REAL tokenized route
 *      nodebenchai.com/events/<slug>/private?token=<token>. ONLY the opaque
 *      token travels — the sn_session_id NEVER appears in the URL.
 *   2. MINT FAILURE — when minting rejects (not a member / backend down), it
 *      falls back to the honest /scratchnode-events landing (no 404, no
 *      tokenless dead-end, no session id in the URL).
 *   3. NO LIVE CLIENT — with no window._sn_live, it goes straight to the honest
 *      /scratchnode-events fallback.
 *
 * We capture the real cross-origin navigation request and fulfill it with a
 * tiny page, and we install a minimal mock _sn_live client so no real backend is
 * needed.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME_V5_HTML = readFileSync(resolve("public/proto/home-v5.html"), "utf8");

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const SLUG = "ai-infra-summit-2026";

async function loadHomeV5(page: import("@playwright/test").Page) {
  // Serve home-v5.html for the scratchnode.live document request.
  await page.route("https://scratchnode.live/**", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({ status: 200, contentType: "text/html", body: HOME_V5_HTML });
      return;
    }
    await route.fallback();
  });
  // Block the real Convex config + client — this spec exercises the handoff
  // builder/navigation in isolation, with a hand-installed mock client.
  await page.route("https://scratchnode.live/api/scratchnode-config", async (route) => {
    await route.fulfill({ status: 500, body: "config unavailable for this isolated spec" });
  });
}

/**
 * Install a mock _sn_live client, capture the navigation request, then invoke
 * openNodeBenchPrivateHandoff. Returns { target, mintArgs }.
 */
async function runHandoff(
  page: import("@playwright/test").Page,
  opts: { withClient: boolean; mintMode: "ok" | "reject" },
) {
  const navigationPromise = page
    .waitForRequest(
      (request) =>
        request.isNavigationRequest() &&
        request.url().startsWith("https://nodebenchai.com/"),
      { timeout: 5_000 },
    )
    .then((request) => request.url());

  await page.route("https://nodebenchai.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>NodeBench handoff captured</title>",
    });
  });

  const captured = await page.evaluate(
    async ({ sessionId, slug, withClient, mintMode }) => {
      const captured: { mintArgs: any } = { mintArgs: null };

      if (withClient) {
        (window as any)._sn_live = {
          slug,
          sessionId,
          eventId: "liveEvents:1",
          client: {
            mutation: (name: string, args: any) => {
              if (name === "scratchnodeHandoff:mintEventHandoffToken") {
                captured.mintArgs = args;
                if (mintMode === "reject") {
                  const err: any = new Error("not_a_member");
                  err.data = { code: "not_a_member" };
                  return Promise.reject(err);
                }
                return Promise.resolve({
                  token: "OPAQUE_TEST_TOKEN_abcdefghijklmnop",
                  expiresAt: Date.now() + 600000,
                });
              }
              return Promise.resolve({});
            },
          },
        };
      } else {
        delete (window as any)._sn_live;
      }

      // openNodeBenchPrivateHandoff is async on the success path; await it.
      const maybePromise = (window as any).openNodeBenchPrivateHandoff();
      if (maybePromise && typeof maybePromise.then === "function") {
        await maybePromise;
      }
      return captured;
    },
    { sessionId: SESSION_ID, slug: SLUG, withClient: opts.withClient, mintMode: opts.mintMode },
  );
  const target = await navigationPromise;
  return { ...captured, target };
}

test.describe("ScratchNode → NodeBench private-notes handoff (home-v5)", () => {
  test("SUCCESS: mints a token and navigates to the tokenized /events/<slug>/private route", async ({
    page,
  }) => {
    await loadHomeV5(page);
    await page.addInitScript(
      ([sid, slug]) => {
        try {
          localStorage.setItem("sn_session_id", sid);
        } catch {
          /* ignore */
        }
        // Pin the event slug used by the URL builder.
        (window as any).EVENT_SLUG_OVERRIDE = slug;
      },
      [SESSION_ID, SLUG],
    );
    await page.goto("https://scratchnode.live/e/ai-infra-summit-2026", {
      waitUntil: "domcontentloaded",
    });
    // Ensure the page's EVENT_SLUG matches our expectation for a stable URL.
    await page.evaluate((slug) => {
      (window as any).EVENT_SLUG = slug;
    }, SLUG);

    const captured = await runHandoff(page, { withClient: true, mintMode: "ok" });

    // Mint was called with ONLY { slug, sessionId } — never an owner key field.
    expect(captured.mintArgs).toEqual({ slug: SLUG, sessionId: SESSION_ID });

    // Navigated to the REAL tokenized route on the NodeBench host.
    expect(captured.target).not.toBeNull();
    expect(captured.target).toContain("nodebenchai.com");
    expect(captured.target).toMatch(/\/events\/[^/]+\/private\?/);
    expect(captured.target).toContain("token=OPAQUE_TEST_TOKEN_abcdefghijklmnop");

    // HARD INVARIANT: the session id NEVER appears in the navigation URL.
    expect(captured.target).not.toContain(SESSION_ID);
    // And it is NOT the tokenless dead-end nor the /scratchnode-events fallback.
    expect(captured.target).not.toContain("/scratchnode-events");
  });

  test("MINT FAILURE: falls back to the honest /scratchnode-events landing (no 404, no session id)", async ({
    page,
  }) => {
    await loadHomeV5(page);
    await page.addInitScript((sid) => {
      try {
        localStorage.setItem("sn_session_id", sid);
      } catch {
        /* ignore */
      }
    }, SESSION_ID);
    await page.goto("https://scratchnode.live/e/ai-infra-summit-2026", {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((slug) => {
      (window as any).EVENT_SLUG = slug;
    }, SLUG);

    const captured = await runHandoff(page, { withClient: true, mintMode: "reject" });

    // Mint WAS attempted...
    expect(captured.mintArgs).toEqual({ slug: SLUG, sessionId: SESSION_ID });
    // ...but the navigation honestly fell back to /scratchnode-events.
    expect(captured.target).toContain("nodebenchai.com");
    expect(captured.target).toContain("/scratchnode-events");
    expect(captured.target).toContain("continuation=private-notes");
    // Never a tokenized private route on failure, never a session-id leak.
    expect(captured.target).not.toMatch(/\/events\/[^/]+\/private\?/);
    expect(captured.target).not.toContain(SESSION_ID);
  });

  test("NO LIVE CLIENT: goes straight to the honest /scratchnode-events fallback (never mints)", async ({
    page,
  }) => {
    await loadHomeV5(page);
    await page.addInitScript((sid) => {
      try {
        localStorage.setItem("sn_session_id", sid);
      } catch {
        /* ignore */
      }
    }, SESSION_ID);
    await page.goto("https://scratchnode.live/e/ai-infra-summit-2026", {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((slug) => {
      (window as any).EVENT_SLUG = slug;
    }, SLUG);

    const captured = await runHandoff(page, { withClient: false, mintMode: "ok" });

    expect(captured.mintArgs).toBeNull(); // never minted
    expect(captured.target).toContain("/scratchnode-events");
    expect(captured.target).not.toContain(SESSION_ID);
  });
});
