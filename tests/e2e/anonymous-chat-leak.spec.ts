/**
 * Regression test for PR #381 — fix(runtime): gate exact chat history
 * hydration. Commit a38b01d1 added `if (!realChat.state.available) return
 * null` to ExactKit.tsx so that anonymous (unauthenticated) visitors never
 * hydrate another user's persisted cockpitChatTurns into the rendered DOM.
 *
 * Why this test exists
 * ────────────────────
 * Without that one-line guard, the `liveThreadTurns` selector would resolve
 * a query keyed by sessionId, and if any prior user (in this browser
 * profile or via shared cache) had persisted turns, an anonymous visitor
 * could see them on first paint. This is the cross-session leak that PR
 * #381 patched.
 *
 * Per .claude/rules/scenario_testing.md every test names a persona, goal,
 * prior state, action sequence, scale, and duration. This is a
 * scenario-based E2E, not a shallow smoke check.
 */

import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

/**
 * Scenario:    Unauthenticated visitor opens the chat surface — must NOT see
 *              any persisted chat turns from another user.
 * User:        Anonymous browser session (no Convex auth cookie, no localStorage
 *              userId). New incognito context with cleared storage.
 * Goal:        Prevent the cross-session leak fixed in commit a38b01d1.
 * Prior state: Production deploy of nodebenchai.com includes the PR #381
 *              gating fix. Another (authenticated) user may have 5+ turns
 *              persisted in cockpitChatTurns — we cannot manipulate that
 *              against prod, so we test the gate, not the data.
 * Actions:
 *   1. Open new context with no storage / no cookies.
 *   2. Navigate to /?surface=workspace as unauthenticated visitor.
 *   3. Wait for hydration to settle (networkidle + a short post-paint pause).
 * Scale:       1 anonymous user
 * Duration:    Single page-load (≤ 30s)
 * Expected:
 *   - The chat-stream mount renders (visitors should not see a blank page).
 *   - `data-chat-live-eligible === "false"` because anonymous users are not
 *     paid-account-eligible — that is the gate fed into the
 *     `realChat.state.available` boolean the PR #381 guard checks.
 *   - The persisted-turn DOM nodes (`[data-persisted-turn]` or equivalent)
 *     must count 0. We tolerate a fixture/seed turn but the persisted-turn
 *     count must not exceed the documented `available=false` fallback.
 *   - No console errors mentioning "auth", "unauthenticated", or "401".
 * Edge:        If production hydration leaks new persisted turns into the
 *              anonymous DOM, this test must fail loudly with the exact
 *              DOM signal that regressed.
 */
test("anonymous visitor does NOT hydrate persisted chat turns (regression for PR #381)", async ({ browser }) => {
  // Build a clean anonymous context — no cookies, no localStorage, no IndexedDB.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(`${BASE_URL}/?surface=workspace`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  // Allow React to settle past initial hydration + any deferred Convex
  // subscriptions. PR #381 gates BEFORE the query result is consumed, so a
  // short post-paint pause is sufficient.
  await page.waitForTimeout(3_000);

  const probe = await page.evaluate(() => {
    const streamMount = document.querySelector('[data-testid="exact-web-chat-stream"]');
    return {
      streamMounted: !!streamMount,
      liveEligible: streamMount?.getAttribute("data-chat-live-eligible") ?? null,
      liveStatus: streamMount?.getAttribute("data-chat-live-status") ?? null,
      runId: streamMount?.getAttribute("data-chat-run-id") ?? null,
      // Persisted-turn nodes — the PR #381 leak shape. If the gate fails,
      // these would be populated from another user's cockpitChatTurns.
      persistedTurnNodes: document.querySelectorAll("[data-persisted-turn]").length,
      // Any chat turn (user or agent) — fixture seeds are allowed.
      allTurnNodes: document.querySelectorAll(".nb-turn").length,
      userTurnNodes: document.querySelectorAll('.nb-turn[data-role="user"]').length,
      agentTurnNodes: document.querySelectorAll('.nb-turn[data-role="agent"]').length,
      // The "no fixture" copy ExactChatSurface shows in honest live-ready state.
      noFixtureText: !!document.body.textContent?.includes("no fixture answer loaded"),
      bodyTextLength: document.body.textContent?.length ?? 0,
    };
  });

  // eslint-disable-next-line no-console
  console.log("ANONYMOUS CHAT PROBE:", JSON.stringify(probe, null, 2));

  // INVARIANT 1 — the page must render. An anonymous visitor seeing a blank
  // page IS a separate bug (rendering should degrade, not break).
  expect(probe.streamMounted, "ChatStream must render even for anonymous users").toBe(true);
  expect(probe.bodyTextLength, "page must have visible content").toBeGreaterThan(500);

  // INVARIANT 2 — the live-eligibility flag must be "false" for anonymous
  // users. This is what the PR #381 guard reads
  // (realChat.state.available === false → liveThreadTurns = null).
  expect(
    probe.liveEligible,
    "anonymous users must NOT be live-eligible (PR #381 contract)",
  ).toBe("false");

  // INVARIANT 3 — zero persisted-turn nodes from a foreign session.
  expect(
    probe.persistedTurnNodes,
    "anonymous visitor must see ZERO persisted chat turns (cross-session leak guard)",
  ).toBe(0);

  // INVARIANT 4 — no auth-related console errors leaked. The page MUST
  // degrade silently for anonymous visitors.
  const authErrors = consoleErrors.filter((line) =>
    /unauthenticated|401|auth\W*error|missing.*auth/i.test(line),
  );
  expect(
    authErrors,
    `anonymous load must not log auth errors; got: ${JSON.stringify(authErrors)}`,
  ).toEqual([]);

  await context.close();
});

/**
 * Scenario:    Burst — 5 anonymous tabs open the chat surface in parallel.
 *              Each must see the same `available=false` gate. This catches
 *              a race where one tab's hydration polls a global cache that
 *              briefly leaks across tabs.
 * User:        5 distinct anonymous browser contexts
 * Goal:        Confirm the gate is per-context, not global / cached.
 * Prior state: Same as the first scenario — clean storage per context.
 * Actions:     Open 5 contexts in parallel, navigate each to ?surface=workspace.
 * Scale:       5 concurrent anonymous sessions
 * Duration:    ≤ 60s total
 * Expected:    All 5 probes report liveEligible="false" and
 *              persistedTurnNodes=0.
 */
test("5 concurrent anonymous tabs all stay gated (no shared-cache leak)", async ({ browser }) => {
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext({ storageState: undefined })),
  );

  try {
    const probes = await Promise.all(
      contexts.map(async (ctx) => {
        const page = await ctx.newPage();
        await page.goto(`${BASE_URL}/?surface=workspace`, {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        await page.waitForTimeout(2_500);
        const probe = await page.evaluate(() => {
          const mount = document.querySelector('[data-testid="exact-web-chat-stream"]');
          return {
            liveEligible: mount?.getAttribute("data-chat-live-eligible") ?? null,
            persistedTurnNodes: document.querySelectorAll("[data-persisted-turn]").length,
            streamMounted: !!mount,
          };
        });
        return probe;
      }),
    );

    for (const [idx, probe] of probes.entries()) {
      expect(probe.streamMounted, `tab ${idx}: stream must mount`).toBe(true);
      expect(probe.liveEligible, `tab ${idx}: must be live-ineligible`).toBe("false");
      expect(
        probe.persistedTurnNodes,
        `tab ${idx}: must show zero persisted turns`,
      ).toBe(0);
    }
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
