# Pre-Release Review Protocol

Mandatory review protocol before any deploy, PR, or demo. Run automatically after completing any implementation sprint.

## When to activate
- User says "deploy", "ship", "PR", "release", "demo ready", "push to production"
- After completing 3+ file changes in a session
- After any sprint completes (all todos marked done)
- Before any `git commit` that touches 5+ files

## 7-Layer Review Stack

### Layer 1: Build Gate (< 1 min)
```bash
npx tsc --noEmit --pretty false    # 0 errors required
npx vite build                      # clean build required
```
If either fails, stop everything and fix.

### Layer 2: Test Gate (< 3 min)
```bash
npm run test:run                    # 0 failures required
```
If tests fail, fix before proceeding. Never skip failing tests.

### Layer 3: Visual Surface Sweep (< 5 min)
Start the dev server. Visit every surface in order:
1. `/?surface=ask` — hero loads, CTA visible, stagger animation plays
2. `/?surface=memo` — Decision Workbench renders, fixture data visible
3. `/?surface=research` — tabs work, daily brief loads, signals render
4. `/?surface=editor` — documents grid or calendar renders
5. `/?surface=telemetry` — hero metric card + tabs render

For each surface check:
- [ ] No console errors
- [ ] No layout shift on load
- [ ] Text is readable (no contrast issues)
- [ ] Cards use glass DNA (`border-white/[0.06] bg-white/[0.02]`)
- [ ] Section headers use `text-[11px] uppercase tracking-[0.2em]`

### Layer 4: Agent Panel Check (< 2 min)
1. Click "Ask NodeBench" CTA in right rail
2. Panel opens without crushing main content
3. Click any suggestion chip — demo conversation plays with thinking animation
4. Close panel — layout restores cleanly
5. No stale chat state between surface switches

### Layer 5: Content Freshness (< 2 min)
Grep for staleness indicators:
- Dates before 2026 in rendered strings (not test fixtures)
- "TODO", "FIXME", "Coming soon", "N/A" in user-facing text
- Tool count mismatches (should be 304)
- "DeepTrace" used as product name (should be "NodeBench" except as investigation feature)
- "The Oracle" used as surface name (should be "System")
- Developer jargon: "spans" (→ actions), "dogfood" (→ quality review), "hydrated", "cockpit" in UI text

### Layer 6: Accessibility Spot-Check (< 2 min)
- Tab through the landing page — every interactive element has visible focus ring
- Check contrast on section headers and muted text
- Verify `prefers-reduced-motion` respected (animations skip)
- Check mobile viewport (375px) — no horizontal overflow

### Layer 7: Bundle Sanity (< 1 min)
After `vite build`, check:
- No new chunks > 500KB raw
- `katex-vendor` CSS not in index.html
- Route chunks are separate (not merged into index)

## Failure Protocol
- Layer 1-2 failures: BLOCK. Fix before any other review.
- Layer 3-4 failures: FIX INLINE. Screenshot before/after.
- Layer 5-7 failures: FIX INLINE unless purely cosmetic P2.

## After All 7 Layers Pass
Report:
```
PRE-RELEASE REVIEW: PASS
- Build: 0 errors
- Tests: N passed, 0 failed
- Surfaces: 5/5 clean
- Agent panel: functional
- Content: fresh
- A11y: spot-checked
- Bundle: within bounds
```

### Layer 8: Live Browser Verification (< 5 min)
Use preview_start or open in Chrome. Actually render every surface and screenshot:
- [ ] Dark mode renders correctly (no white flashes, no invisible text)
- [ ] Light mode renders correctly (toggle via settings)
- [ ] Stagger animations play smoothly (not too fast, not laggy)
- [ ] Hover states work on cards, buttons, nav items
- [ ] Calendar drag-and-drop works (if workspace surface was touched)
- [ ] Agent panel demo conversation: thinking dots animate, text reveals progressively
- [ ] Mobile (375px): no horizontal overflow, CTA wraps, bottom nav visible

### Layer 9: Backend Integration Smoke (< 3 min)
If Convex is deployed:
- [ ] `npx convex dev --once --typecheck=enable` passes
- [ ] Landing page loads live swarm data (not just demo fallback)
- [ ] Agent panel connects to real backend (not just demo conversations)
- [ ] Action receipts page shows real data or graceful empty state
If Convex is NOT deployed:
- [ ] All surfaces render with demo/fallback data — no blank screens
- [ ] No Convex connection errors in console
- [ ] "Sign in" messages appear where expected

### Layer 10: WebSocket Gateway (< 3 min)
If gateway is running (`npx tsx workers/node/index.ts`):
- [ ] `GET /health` returns 200
- [ ] `GET /mcp/health` returns session count
- [ ] WebSocket connects with valid API key
- [ ] `tools/list` returns 304 tools
- [ ] Invalid key returns close code 4001
If gateway is NOT running:
- [ ] API key management page renders with demo data
- [ ] MCP install commands are copy-pasteable on landing page

### Layer 11: Auth Flow (< 2 min)
- [ ] Guest landing page shows demo data, not blank screens
- [ ] "Sign in" CTAs are visible and functional
- [ ] After auth, WorkspaceRail shows Recent Runs / Documents sections
- [ ] Agent panel switches from demo mode to real backend
- [ ] Right rail metrics show live data instead of demo fallback

### Layer 12: Cross-Browser Spot-Check (< 2 min)
Test in at least one non-Chrome browser (Safari, Firefox, or Edge):
- [ ] `backdrop-filter` (glass cards) renders or degrades gracefully
- [ ] `color-mix()` renders or degrades gracefully
- [ ] `@property` (animated counter) works or shows static number
- [ ] `content-visibility: auto` doesn't hide content permanently
- [ ] Fonts load (Manrope, JetBrains Mono)

### Layer 13: Regression Risks (< 2 min)
Check these known fragile areas:
- [ ] Voice server: if `workers/node/index.ts` was modified, verify voice WebSocket still works
- [ ] Schema changes: if `backend/convex/schema.ts` was modified, verify migration compatibility
- [ ] Tool count: grep for hardcoded "289", "297", "304" — must all match current reality
- [ ] Print: if Decision Memo or Postmortem was modified, verify print stylesheet (if exists)
- [ ] OG tags: if `index.html` was modified, verify meta tags are correct

## Failure Protocol
- Layer 1-2 failures: BLOCK. Fix before any other review.
- Layer 3-7 failures: FIX INLINE. Screenshot before/after.
- Layer 8-13 failures: FIX INLINE. Document any that require external setup (Convex deploy, gateway start).

## After All 13 Layers Pass
Report:
```
PRE-RELEASE REVIEW: PASS
- Build: 0 errors
- Tests: N passed, 0 failed
- Surfaces: 5/5 clean
- Agent panel: functional
- Content: fresh
- A11y: spot-checked
- Bundle: within bounds
- Browser: verified in [Chrome/Firefox/Safari]
- Backend: [live/demo fallback] — no errors
- Gateway: [running/not tested]
- Auth: [verified/guest-only]
- Cross-browser: [tested in X]
- Regressions: none found
```

## Related rules
- `qa_dogfood` — detailed surface checklist
- `flywheel_continuous` — continuous improvement loop
- `completion_traceability` — cite original request
- `self_direction` — never wait for permission
