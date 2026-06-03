# `public/proto/home-v5.html`

Append-only lane for the ScratchNode live-event prototype and production static surface.

## 2026-06-03 — Public `/wiki/<slug>` reader: give the "room remembers everything" a real address
The viral audit found ScratchNode's core promise was a dead end: `publishWiki`
wrote the recap into a DB table with **no public URL**, so the artifact that should
pull new people in *after* an event was unreachable. This ships the reader.

- **A new `wiki` page-mode.** `/wiki/<slug>` (vercel rewrite to the static file +
  a `pageMode='wiki'` branch in the detector) renders a clean, no-account reader —
  the room shell is hidden via the same `:is(landing, wiki)` chrome-hide rule, and
  `data-sn-live` is **never** set (a read-only artifact never claims "live").
- **Real content, honest states.** A bootstrap subscribes to the public
  `events:getPublishedWikiBySlug` and renders the server-built, public-safe
  `bodyHtml` (private notes already excluded at publish). Unpublished →
  "This room hasn't published its wiki yet"; backend down → "Couldn't load this
  wiki." — never a blank screen or a fabricated recap. Loading shows a skeleton.
- **Reverse-viral + the real bridge.** Every state carries a **"Create your own
  room →"** CTA (a reader becomes a host), and the published view carries a real
  **"Continue in NodeBench ↗"** link to `nodebenchai.com/events/<slug>/wiki` with
  `source=scratchnode&publicArtifact=event-wiki` carryover — the actual conversion
  bridge, not the demo-only overlay. A bar **Share** button copies the wiki link.

Covered by `scratchnode-public-wiki.spec.ts` (3 cases: a no-account visitor reads a
published wiki with both CTAs + the room shell hidden + `data-sn-live` unset;
unpublished → honest empty state with no article body; config failure → honest
error). Desktop + mobile (375px) screenshot-verified. The 23-case honesty +
output-contract + demo-gate suites stay green (landing/event/demo unaffected by the
`:is()` chrome-hide change). Backend (`getPublishedWikiBySlug`) shipped first in PR #486.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-03 — Make /ask answers actually shareable (honesty fix + the missing lever)
An audit of the full viral journey found the /ask answer "Share" button was a lie:
`onclick="toast('Shared','Answer link copied.')"` claimed it copied a link while
copying **nothing** (HONEST_STATUS violation) — and worse, the **live** answer
renderer had no Share affordance at all, so real `/ask` answers (the single most
screenshot-worthy unit in the room — "the output is the distribution") couldn't be
shared.

Fix: a real `_snShareAnswer(answerId, explicitQuestion)` helper that copies a
genuine link — the room URL + the answer's question (`"<Q>" — answered live in
<event> on ScratchNode\n<url>`) — via the native share sheet when available, else
a real clipboard write that only toasts "Answer link copied" **after the write
resolves** (and an honest "Couldn't copy" with the raw URL on failure). Wired into:
the live answer renderer (which previously had Suggest/Promote/Pin/View-in-wiki but
no Share), the autoplay demo renderer (parity), and the static demo card (de-lied).
The live renderer now also caches each answer's question (`_sn_answer_q_by_id`) so
the Share link carries the real question text.

Covered by a new honesty case: asserts the lying `toast('Shared'` handler is gone
from the shipped file and that `_snShareAnswer` writes a real room link + the
question to the clipboard (forced clipboard path, captured write). 19→20 chromium
honesty suite green; output-contract demo path green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-03 — Directory viral slice: flyer cards, "● N inside" presence, one-tap request-to-join
Closed the last gap in the viral loop on the *discovery* side. The public-rooms
directory used to render every room as a list row with a single hardcoded
"Request to join" link that just navigated to `/e/<slug>` — it ignored the room's
actual `joinPolicy` and never touched the door-policy backend. Three changes:

- **Flyer feel + live presence.** Each card now leads with a **"● N inside"**
  presence cue — a pulsing green dot + the real `activeSessions` count ("friends
  are inside"), then `· code XXXX`. Rooms with zero presence read "Open for guests".
  Request-policy cards get a subtle terracotta wash so the two policies are
  visually distinct. Reduced-motion disables the dot pulse.
- **Policy-aware action.** **Open** rooms → a `Join now` `<a>` that navigates
  straight in. **Request** rooms → a real `Request to join` `<button>` wired to
  the live `events:requestJoinEvent` mutation.
- **One-tap request, honest waiting.** The button files the request using the
  **same `sn_session_id`** the room will use — so a host approval carries through
  the `joinEvent` door gate when the guest lands in `/e/<slug>`. It then shows an
  honest **"Requested ✓"** state (never a fake entry) and watches
  `events:getMyJoinRequest` reactively: on **approved** it carries the guest into
  the room; on **denied** it says "Request declined". A missing live client falls
  back to a plain navigate (the room's own door handles the gate); any backend
  error resets the button and surfaces a toast.

Covered by an updated directory case (open room → "Join now" + "● 6 inside") and a
new request-policy case in `scratchnode-live-route-honesty.spec.ts` (button files
a real request with a ≥8-char sessionId, shows "Requested ✓" with no navigation,
then a host approval carries the guest into `/e/<slug>`). 18/18 chromium honesty
suite green; desktop + mobile (375px) flyer cards screenshot-verified.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Post-create "viral" share moment
The shortest path from useful product to viral loop: after a host creates a room,
they no longer drop straight into it — they land on a **"Your event is live. Invite
people now."** moment first. It carries a screenshot-worthy **invite card** (brand +
event name + QR + `scratchnode.live/e/<CODE>` + "the room remembers everything"), a big
room link with one-tap **Copy**, **Text** / **Email** deep links, **Copy invite text**,
the native **Share** sheet when available, and an **"Enter your room →"** CTA. The reason
to share is baked into the copy and the invite text: *the room becomes your shared memory
for the night.*

Implementation: `_showShareMoment({slug, roomCode, name})` is called from `_landingCreate`
on success instead of an immediate navigate; QR via the same provider the in-room share
sheet uses (graceful `onerror` hide); clipboard with `execCommand` fallback; Escape carries
the host forward into the room. Glass DNA + terracotta accent, reduced-motion safe, mobile
full-width. The apex stays honestly `data-sn-live=null` until the host enters.

Covered by updated + new cases in `scratchnode-live-route-honesty.spec.ts` (create →
share moment → "Enter your room →" navigates; auto-code variant; copy-link + copy-invite +
Text/Email deep links wired). 17/17 honesty suite green; desktop + mobile verified.
Deferred (overlaps the in-flight door-policy frontend): public-room *flyer* cards, a
"friends are inside" presence cue, and one-tap request-to-join from discovery.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Synthesize the best landing from two parallel agent builds
Codex and Claude independently built the create-room front-door + the live counter.
Instead of picking a winner, cherry-picked the strongest micro-decisions from each:

**From Codex's branches:** index-backed presence counting — added `by_startedAt` +
`by_status_startedAt` (liveEvents) and `by_lastSeen` (liveEventMembers) indexes so
`events:getLandingStats` now reports a real **"active now"** (member sessions within the
5-min presence TTL) alongside rooms created + live rooms, each index-scanned and bounded
(10k events / 5k sessions, "N+" when capped); a 25s poll fallback for Convex browser
clients without `onUpdate`; and the full landing-mode chrome hide (`.h` header, `.f`
footer, menu/sheet/shortcut overlays) — fixes a real leak where room chrome rendered
below the apex landing and you could scroll into it.

**Kept from Claude:** the "The room remembers everything" headline + OG card, honest
hide-on-zero (never a fake "0"), and the synced-easing invariant so displayed-live never
exceeds displayed-total during the count-up — now `animatePair` is superseded by
`animateTrio`, extending the invariant to a 3-number trio (rooms + live + active) eased
on one clock.

The counter now shows a big "rooms created" with `● N active now · N live right now`
chips. 14/14 honesty suite green; tsc clean; chrome-fix + chips verified in preview.

**Hierarchy flip (founder call):** the original complaint was that a visitor couldn't
just land and spin up a room — so **Create room is now the primary CTA** (filled accent,
top of the form stack, "Create room →"), with **Join immediately available but secondary**
(outline accent) below an "or join an existing room" divider. The prod artifact reads as
one coherent landing, not a merge of two designs.

**Commit**: `this commit`. **Author**: Homen Shum + Claude (synthesizing Codex branch work).

## 2026-06-02 — Fix counter count-up flashing "more live than total"
Live-DOM Tier-B check on production caught the live counter momentarily rendering
`6 live · 4 total` during first load — impossible in steady state (live rooms are a
subset of total). Root cause: the **total** animated up from 0 over 750ms while
**liveNow** was set instantly, so mid-count-up the animating total was briefly less
than the instant live count — reading as a broken/fake number on the one stat that has
to be trustworthy. Fix: `animatePair()` eases both numbers from the same prior values
with identical easing, so total ≥ live at every frame (`Math.round` is monotonic, and
`roomsCreated ≥ liveNow` always). Guarded by a new e2e case that samples both numbers
14× across the animation and asserts `live ≤ total` at every frame. 14/14 suite green.
[Superseded same day by `animateTrio` in the synthesis entry above.]

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Rewrite the landing headline for a viral hook
Replaced the feature-describing hero line "A disposable sidecar room for live event
memory" (jargon: "disposable", "sidecar"; no emotional/temporal hook — nobody screenshots
it) with an outcome-first, say-it-out-loud headline: **"The room remembers everything."**
Lineage: Linear ("the issue tracker you'll enjoy using" — emotional outcome), Slido
("audience interaction made easy" — the closest live-event-Q&A comp), Luma ("delightful
events start here"). The features (`/ask`, wiki handoff, no-account) move into the
sub-headline where they belong: "Drop a code, chat live, hit /ask for sourced answers —
and walk away with a wiki of everything that happened. No account, no app." Updated `<title>`,
meta description, and all OG/Twitter card tags to match so shared links carry the new hook.
Also regenerated the OG share card (`public/og-scratchnode.svg` → `og-scratchnode.png`,
1200×630) with the new headline via a new reusable rasterizer `scripts/ui/renderOgImage.mjs`
(Playwright + brand fonts), so Slack/Discord/X/iMessage link previews match the site.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Live "big number" room counter on the landing
Added an animated, reactive hero stat to the apex landing: a large room-count that
**ticks up the instant anyone, anywhere, creates a room** — driven by a new reactive
Convex query `events:getLandingStats` (bounded scan, returns `{ roomsCreated, liveNow,
capped }`), not a client timer. A pulsing "● N live right now" sub-line shows open rooms.

The counter gently floats with a soft accent glow; the number animates up via a cubic
ease when the reactive value changes. Motion-safe: subtle translate + small status-dot
ring (no flashing), all gated under `prefers-reduced-motion`. Mobile scales the digits down.

Honesty (`agentic_reliability` HONEST_SCORES): every figure is a real row count — no
fabricated marketing number. The stat is **hidden entirely** until the backend reports
≥1 room (so an empty or offline backend never flashes a fake "0"), enforced by both the
`render()` guard and a `.landing-pulse[hidden]{display:none}` rule (a class selector
otherwise beats the UA `[hidden]` rule). The landing subscription is read-only and never
sets `data-sn-live`, so the apex stays honestly "not live". Bulletproof: any config/client
failure leaves the stat hidden and never throws to the page.

Covered by 3 new cases in `scratchnode-live-route-honesty.spec.ts` (real value renders
`1,342`, scan-cap renders `5,000+`, zero rooms stays hidden). 13/13 honesty suite green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Add a self-serve "Create a room" front-door to the landing
The apex landing only offered a "Join with a code" form — a first-time visitor had
no way to actually create a room. `events:createEvent` existed in the backend and a
create flow lived in the in-room host console, but the live-backend module bails early
on the apex (`if (!slugMatch) return`), so creation was never wired on the landing.

Added a `.landing-create` form (event name + optional custom room code) beside Join,
plus a self-contained `_landingCreate()` handler that lazily bootstraps a Convex client
(same `/api/scratchnode-config` + esm.sh paths the room module uses), calls
`events:createEvent`, persists the issued host token (`sn_host_owner_key_v2`), and
navigates the new host into `/e/<slug>`. Join stays the single primary accent CTA;
Create is outline-accent (secondary in the hierarchy).

Honesty contract preserved: every failure (config down, client load fail, taken code,
rate limit) surfaces a real inline error and re-enables the button — never a fake
success, and `data-sn-live` stays untouched so the apex reads honestly "not live" until
the host lands in their room. Covered by 4 new cases in
`tests/e2e/scratchnode-live-route-honesty.spec.ts` (happy path, auto-code, short-name
rejection, honest config-failure). 10/10 honesty suite green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Add ScratchNode motion polish
Centralized lightweight motion tokens and added a visual polish pass across the ScratchNode room: ambient backdrop, composer focus/private-mode cues, chat and answer reveals, Live Assist card choreography, and tactile Memory Wall note transitions. The change keeps the existing public/private behavior contract intact while making the demo feel more premium on desktop and mobile.

**Commit**: `this commit`. **Author**: Homen Shum + Augment Agent.

## 2026-06-02 — a11y: explicit type="button" on 3 buttons (loop C002)
Self-improvement loop cycle C002 added `type="button"` to the Memory Wall sticky-delete button and the two onboarding-tour buttons (Next/Skip) — they had onclick handlers but no explicit type (implicit-submit footgun). Validated as not inside a <form>; no behavior change. e2e honesty + output-contract green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
