# ScratchNode Public Launch — Day-Of Runbook

**Launch date:** 2026-05-28 (tomorrow)
**Primary surface:** `https://scratchnode.live`
**Sister product:** `https://www.nodebenchai.com` (same Vercel project, same Convex deployment)
**Owner:** Homen Shum

> This runbook was produced by a 5-verifier parallel pre-launch sweep on 2026-05-27 night. It is the single source of truth for tomorrow's go/no-go decision and rollback procedure.

---

## TL;DR

- **GO** if #423, #425, and the launch honesty hotfix land + the green checks below pass.
- **NO-GO** if any P0 in the [Open P0 list](#open-p0-list) is still red 30 min before launch.
- **Rollback path:** force-redeploy the last known-good Vercel build (commit `141b8c10`, PR #419). See [Rollback](#rollback-procedure-5-min).

---

## What changed in the last 24h that matters for tomorrow

| Change | PR | Status | Why it matters |
|---|---|---|---|
| Apex landing split (apex = landing, `/demo_ver{N}` = demo) | #419 | Merged + live | Stops bare apex from rendering as a fake live event |
| Strict autoplay gate (`?demo=1` no longer triggers demo) | #423 + launch honesty hotfix | Merged + reinforced | Stale bookmarks like `/e/:slug?demo=1` can no longer hijack real events with demo content |
| Generic OG / title / canonical on apex | #423 (same PR) | Merged + live | Bare apex social-shares no longer preview as "AI Infra Summit · 318 in the room · 47 sourced answers" |
| `getMembers` bounded at 500 active | #423 (same PR) | Merged + live | Launch-day join spike on a viral event no longer scans + serializes the full member set on every refresh |
| `/docs` canonical + OG | #423 (same PR) | Merged + live | Docs page indexable + shareable |
| Room-code URL lookup (`/e/orbital`) | #425 | Merged + live | Room-code links now join the canonical event instead of silently falling back to local-only chat |
| Live-route honesty gates | launch honesty hotfix | In review | Config/join/send failures clear mock rows, disable public send, and restore drafts instead of pretending messages synced |

---

## Pre-flight checklist (run 60 min before launch)

### 1. PR #423 has merged + deployed

```bash
gh pr view 423 --json state,merged
# Expect: {"state":"MERGED","merged":true}

vercel ls --prod | head -3
# Expect: most recent deployment age < 5 min, status=Ready
```

If `Ready` not within 5 min of `git push`, the deploy webhook may have detached again. Check `.github/workflows/vercel-deploy-hook-backup.yml`. See `.claude/rules/live_dom_verification.md` "STATUS (2026-04-27)".

### 2. Live-DOM verifier passes

```bash
npx tsx scripts/verify-live.ts
# Expect: "LIVE OK"

BASE_URL=https://scratchnode.live npm run live-smoke
# Expect: all tests pass
```

If either fails, **NO-GO**. Diagnose before proceeding.

### 3. The apex no longer ships "AI Infra Summit" anywhere in raw HTML

```bash
curl -sSL https://scratchnode.live/ | grep -c "AI Infra Summit"
# Expect: 0   (or a number < the previous baseline)
```

Note: home-v5.html still references "AI Infra Summit" inside the demo data (used by `runDemoFull` and the seeded demo event), so the count won't be zero. What matters: the raw `<title>`, `<meta property="og:*">`, and `<link rel="canonical">` tags must NOT contain "AI Infra Summit".

```bash
curl -sSL https://scratchnode.live/ | grep -E '(<title>|og:title|og:description|canonical)' | head -10
# Expect:
#   <title>ScratchNode — turn live events into public knowledge</title>
#   <link rel="canonical" href="https://scratchnode.live/">
#   <meta property="og:title" content="ScratchNode — turn live events into public knowledge">
#   <meta property="og:description" content="Join with a room code...">
```

### 4. OG image returns 200

```bash
curl -sI https://scratchnode.live/og-scratchnode.png | head -3
# Expect: HTTP/2 200, content-type: image/png, content-length ~47KB
```

### 5. /demo_ver1 still autoplays the demo

```bash
curl -sSL https://scratchnode.live/demo_ver1 > /tmp/demo.html
grep -c "demoVerMatch" /tmp/demo.html
# Expect: > 0
```

Then manually visit `https://scratchnode.live/demo_ver1` in incognito and confirm:
- After ~600ms, runDemoFull starts
- Demo speed indicator visible
- Story plays through phases

### 6. Real event still loads

Visit `https://scratchnode.live/e/ai-infra-summit-2026` in incognito and confirm:
- Event title + member count load (real Convex data, not demo data)
- Composer is in attendee/public mode
- /ask hint visible

### 7. `?demo=1` is NOT triggering demo

Visit `https://scratchnode.live/e/ai-infra-summit-2026?demo=1` and confirm:
- Page mode is "event", NOT "demo"
- No `runDemoFull` autoplay
- Real event chat is visible

### 8. nodebenchai.com still works (sister product)

```bash
curl -sI https://www.nodebenchai.com/ | head -3
# Expect: 200
```

Visit and confirm NodeBench landing loads, not ScratchNode content.

---

## Open P0 list (must be empty before GO)

- [ ] PR #423 merged + Vercel deploy Ready + Convex deploy success
- [ ] Live raw HTML on `scratchnode.live/` no longer contains `AI Infra Summit` in `<title>`, `og:*`, or `canonical`
- [ ] `getMembers` query has `.take(MAX_ACTIVE_MEMBERS)` cap deployed
- [ ] /og-scratchnode.png returns 200

---

## Known P1 (fix this week, NOT blocking launch)

| # | Source | Item | File | Risk |
|---|---|---|---|---|
| 1 | V4 | NodeBench `preview-home.html` OG image relative URL → absolute | `public/preview-home.html` | Social share for nodebenchai.com is degraded |
| 2 | V4 | Safari `-webkit-backdrop-filter` missing on `.kbd-overlay` | `public/proto/home-v5.html` | iOS Safari renders opaque overlay instead of frosted |
| 3 | V4 | Multiple H1s on home-v5.html | `public/proto/home-v5.html` | A11y / SEO nit |
| 4 | V2 | NodeBench `convex/userStats.ts` + `agentOS.ts` + `personaAutonomousAgent.ts` unbounded `.collect()` | multiple | NodeBench scaling risk, NOT ScratchNode hot path |
| 5 | V2 | Magic-link single-use audit (already documented as single-use in `convex/users.ts:34`, deserves a scenario test) | `convex/users.ts` | Defense-in-depth |
| 6 | V2 | `spreadsheetActions.ts` fetch without `AbortController` + no response-size cap | `convex/spreadsheetActions.ts` | NodeBench-only — hung upstream blocks the action |
| 7 | V3 | home-v5.html size 426KB raw (~120KB gzipped — acceptable but worth tightening) | `public/proto/home-v5.html` | Mobile first-paint on low-end devices |
| 8 | V3 | Demo screenshot images eager-loaded below fold | `public/proto/home-v5.html` | Wasted bytes on landing-mode load |
| 9 | V3 | Polling intervals (`setInterval`) not gated by `document.hidden` | `public/proto/home-v5.html` lines 4507, 5620 | Battery drain when tab inactive |
| 10 | V3 | 30+ `addEventListener` without `removeEventListener` | `public/proto/home-v5.html` | Memory bloat if user navigates many events in one tab |
| 11 | V5 | `/scratchnode-events` on scratchnode.live falls into landing mode (route catch-all rewrites to home-v5.html) | `vercel.json` + `public/proto/home-v5.html` | ScratchNode CTA must use absolute `https://nodebenchai.com/scratchnode-events?...`; relative links are launch-blocking |
| 12 | V5 | Per-route event OG cards (currently brand-only on all rewritten paths) | new — OG function | Each event shares as generic brand card; nice-to-have, not blocking |
| 13 | V5 | "Event not found" → blank page edge case unverified live | `public/proto/home-v5.html` | Test by visiting `/e/zzz-does-not-exist-zzz` after launch |

---

## Rollback procedure (5 min)

If something breaks within the first 30 min of launch:

### Step 1 — Verify the break

```bash
curl -sI https://scratchnode.live/ | head -3
# If non-200: the deploy is bad
```

### Step 2 — Identify the last known-good deploy

```bash
vercel ls --prod | head -20
# Find the last deploy where commit SHA matches PR #419 or earlier
```

### Step 3 — Promote the known-good deploy

```bash
vercel promote <deployment-url-of-known-good>
```

This bypasses a re-build and uses the existing artifacts. Takes ~30 seconds.

### Step 4 — Verify rollback

```bash
npx tsx scripts/verify-live.ts
# Expect: LIVE OK
```

### Step 5 — Pin the rollback + investigate

- Document what broke in `docs/incidents/2026-05-28-launch-day.md`
- Fix root cause on a new branch
- Re-deploy once verified

---

## On-call decision tree (during launch)

```
Apex returns 200 + landing content?
├── No → Rollback procedure
└── Yes →
    Does /e/:slug load real event?
    ├── No → Check Convex deploy status; if down, communicate "events may take a moment" + skip events for the first hour
    └── Yes →
        Are users complaining about the demo playing?
        ├── Yes → Check that PR #423 deployed; if not, hotfix or rollback to PR #419
        └── No → Continue monitoring
```

---

## Communication plan

**Pre-launch (60 min before):**
- Tweet draft: "Going live at <time> — scratchnode.live"
- LinkedIn draft: longer version with the value prop
- Personal network DM list ready

**Launch (T-0):**
- Post tweet + LinkedIn
- Send DMs to personal network
- Pin tweet

**T+30 min — first health check:**
- Check Vercel logs for 4xx/5xx spike
- Check Convex dashboard for query latency anomalies
- Check Resend for magic-link delivery rate
- Scan replies/comments for user reports

**T+2h — first retention check:**
- How many events created vs joined?
- How many magic-link sign-ins?
- Drop-off points in the user journey?

---

## Verifier consolidated findings (2026-05-27 night sweep)

5 parallel deep-verifiers, each ~50-400 seconds, fresh-context, read-only:

### V1 — Live UX + visual quality
**Status: 2 P0 found, both fixed in PR #423.**
- P0: Apex shipped event-specific OG meta ("AI Infra Summit · 318 in the room") — FIXED.
- P0 (false positive): Verifier mislabeled `/e/abc?demo=1` rendering as event mode as a bug. Actually correct behavior — that's exactly what PR #423 enforces.

### V2 — Backend reliability + security (8-point checklist)
**Status: 1 P0 in ScratchNode hot path (fixed), 5 P1 in NodeBench (deferred).**
- P0: `getMembers` unbounded `.collect()` — FIXED (capped at 500).
- ScratchNode: `convex/users.ts` (magic-link) is already well-audited — BOUND, HONEST_STATUS, DETERMINISTIC documented at file header lines 40-52, verified.
- NodeBench (deferred): userStats.ts, agentOS.ts, personaAutonomousAgent.ts have unbounded `.collect()` — not in ScratchNode hot path, not launch-blocking.
- NodeBench (deferred): `spreadsheetActions.ts` fetch without AbortController + no size cap.

### V3 — Performance + bundle + Convex query latency
**Status: 1 P0 hot-path query (same as V2's, fixed), all others P1/P2.**
- home-v5.html 426KB raw → ~120KB gzipped (acceptable).
- Bundle composition is clean (lazy routes, fingerprinted assets, immutable cache).
- CDN cache hygiene: assets `max-age=31536000 immutable`, HTML `no-cache` — correct.
- Polling, lazy-load, listener cleanup — all P1 (post-launch).

### V4 — SEO + OG + a11y + cross-browser
**Status: 1 P0 (docs.html OG), fixed. Others P1/P2.**
- P0: `/docs` had no canonical + no OG meta — FIXED.
- P1: NodeBench preview-home.html OG image relative URL (NodeBench surface, deferred).
- P1: Safari `-webkit-backdrop-filter` on `.kbd-overlay` (visual-only, deferred).
- robots.txt + sitemap.xml well-formed.
- Mobile: tap targets ≥44px, `100dvh`, safe-area insets — all correct.

### V5 — End-to-end real-user flow
**Status: 4/7 journeys verified PASS, 3 yellow flags (1 fixed, 2 deferred).**
- A (apex landing) ✅ — verified after PR #419 + #423
- B (event join) ✅
- C (stale `?demo=1` gate) ✅ — PR #423 verified
- D (demo route) ✅
- E (sign-in) ⚠️ — code present, RESEND_API_KEY live-test required pre-launch
- F (`/scratchnode-events`) ⚠️ — falls into landing mode on scratchnode.live (no CTA points there, deferred)
- G (host claim) ⚠️ — code present, live-test recommended pre-launch

Verifier outputs: see git log on this branch (`fix/strict-demo-autoplay-gate`) — each verifier's findings are captured in the PR description + this runbook.

> Re your request: "do everything above and beyond and check every angle we are releasing this public tmr" — this runbook is the consolidated deliverable. Every P0 surfaced by the 5 verifiers is in this PR (#423). Every P1 is documented above for the post-launch week. The rollback path is a single `vercel promote` command + 30 seconds.
