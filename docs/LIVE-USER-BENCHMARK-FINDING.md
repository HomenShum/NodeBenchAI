# Live-user benchmark finding — real browser, real session, real P0 bug

> This is exactly what a live-browser end-to-end benchmark is for: this bug is **invisible to the
> Convex-level eval** (`sendMessageInternal` called directly bypasses the UI gate entirely). Only
> driving the real production UI as a real user surfaced it.

## What was tested (real, on prod)

- **Where:** `https://www.nodebenchai.com` (prod, `agile-caribou-964`), driven via Claude-in-Chrome on
  the user's real authenticated Chrome session (a genuine Google-OAuth session, the one fixed earlier
  this session — verified `authedJWT:true, refreshToken:true`).
- **What a real user did:** landed on `/redesign` → typed a real accounting task in the composer
  ("Show me my documents about revenue and reconcile the numbers") → clicked **Chat now**.

## Finding 1 — Live chat blocked even with a valid session (P0)

**Observed:** the chat surface returned *"Live chat is not running. Link an email or Google account
before running live research. Anonymous sessions can browse public memory only."* — despite the
top-right avatar showing a signed-in user.

**Root cause (browser-verified):** there are two separate auth layers:
1. Convex session auth (JWT/refresh token) — **working**.
2. A distinct **"connect account"** flag that `/redesign/me` shows as unmet ("Sign in to sync" +
   "Connect account" button), which the live-chat/research gate additionally requires.

A user can be fully signed in (valid session) and still be told to "link an email or Google account" —
the UI conflates "signed in" and "connected" and blocks the core product action (live research/chat) on
the second, undiscoverable one. **This blocks every accounting/research task in the live UI for any
user in this state** — the exact end-to-end path the accounting benchmarks require.

## Finding 2 — "Connect account" button is dead (P0, confirmed via DOM diff, not screenshot)

With the user's explicit authorization, clicked the **Connect account** button on `/redesign/me`.

- **Before/after DOM (via `read_page` accessibility tree):** byte-identical. No dialog, no modal, no
  overlay, no navigation, no new tab/window.
- **Console:** silent — no click-handler log, no network call, no error, no popup-blocked warning.
- **Side effect:** the next 2 screenshot attempts (`Page.captureScreenshot` via CDP) each timed out
  after 30s, while the page's own DOM/accessibility tree remained fully responsive (`find`/`read_page`
  returned instantly, 32 real interactive elements) — so the page itself is not frozen; something the
  click triggers appears to break the compositor/screenshot pipeline specifically (consistent with an
  attempted `window.open()` popup that the browser/extension is silently swallowing, or a stuck
  paint/canvas frame).

**Conclusion:** the primary CTA for resolving Finding 1 does not work. A real user hits this exact
button, gets no feedback, and cannot proceed to live research/chat — a full dead end in the core
product flow, live on prod.

## Why this matters for the accounting proofloop guarantee

The Live User Contract (per the proofloop rules) requires: fresh browser context, real UI navigation,
agent invocation through the visible UI, streaming/progress visible. **This account-connection wall
sits in front of ALL of that** for any user in this auth state — so no accounting benchmark task can
even begin end-to-end until this is fixed. This is now the top of the real, live-verified punch list:
higher priority than the harness/judge issues in task #12, because it blocks the entrypoint itself.

## Evidence

- Live URL: `https://www.nodebenchai.com/redesign/chat?q=...` (chat blocked) and `/redesign/me`
  (Connect account dead click).
- No screenshot artifact could be captured post-click (the bug itself broke the capture path);
  documented via DOM/console evidence instead — an honest gap, not a fabricated screenshot.
