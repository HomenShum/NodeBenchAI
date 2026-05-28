# ScratchNode Launch Backend Notes

Date: 2026-05-28

## Public launch boundary

Production ScratchNode rooms must be Convex-backed. Do not silently fall back to fixture chat, fixture people, or demo wiki content on `/`, `/e/:slug`, or `/join/:code`.

Demo automation is allowed only on owned demo routes:

```text
/demo_ver1
/demo_ver2
...
```

The launch room path is:

```text
host creates event
-> Convex `events:createEvent`
-> liveEvents row
-> liveEventMembers creator row
-> liveEventHosts owner row with hk1 host token
-> starter liveEventSources row for public `/ask`
-> attendees join by slug or room code
-> messages persist through `events:sendMessage`
```

## Backend invariants

- `joinEvent` resolves exact slug first, then case-insensitive room code.
- `joinEvent` does not create demo rows in production.
- `ensureDemoEvent` is dev/explicit only via `SCRATCHNODE_ALLOW_DEMO_SEED=1` or a `dev:` Convex deployment.
- `sendMessage(kind: "system")` is host-only. Attendees can send public chat/ask rows, not system rows.
- `/ask` on empty non-demo rooms must fail with `no_sources`, not invent a fake answer.
- Public `/ask` uses public sources only. Private notes stay outside public feed, public wiki, public trace, and public cache.
- Host tokens use `hk1:` HMAC format. Parse token fields from the right because Convex ids contain colons.

## Host controls now live

Host Console "Create a new event" is wired to the live mutation. The UI stores the returned owner token in:

```text
localStorage.sn_host_owner_key_v2
```

Source management mutations are available for host-owned rooms:

```text
events:upsertEventSource
events:deleteEventSource
events:updateEvent
events:endEvent
```

## Launch verification

Minimum local gate:

```powershell
npx vitest run convex/__tests__/scratchnode.events.test.ts
npx tsc --noEmit --pretty false
npx tsc -p convex --noEmit --pretty false
npx playwright test tests/e2e/scratchnode-demo-route-gate.spec.ts tests/e2e/scratchnode-live-route-honesty.spec.ts --project=chromium --workers=1 --reporter=list
npm run build
npm run preflight:fast
```

Live smoke after deploy:

```text
1. Open scratchnode.live/e/<room-code> in two incognito windows.
2. Send chat in window A. It must appear in B without refresh.
3. Send chat in window B. It must appear in A without refresh.
4. Open scratchnode.live/e/not-a-room. It must show a missing-room alert, not mock chat.
5. Open scratchnode.live/demo_ver1. Demo may run there only.
6. In Host Console, create a fresh event, then join it by its room code.
```

Known local caveat: `npx convex dev --once --typecheck=enable` can prompt for project configuration in a fresh worktree. Use `npx tsc -p convex --noEmit --pretty false` for non-interactive type checking unless the worktree has Convex project config loaded.
