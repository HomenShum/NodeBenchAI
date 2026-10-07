# Route Architecture — Target State

## Current Problems
1. **MainLayout.tsx is a 1100-line god component** — routing, layout, sidebar, panels, auth, state
2. **Manual URL parsing** replaces React Router's actual routing (ternary chain, useState-based)
3. **No compile-time completeness** — add a MainView value, forget registry entry → runtime fail
4. **Route state as component state** — selectedDocumentId, entityName, spreadsheetId should be URL params

## Target Architecture

```
src/
├── lib/
│   └── viewRegistry.ts          ← Single source of truth (DONE)
│
├── routes/
│   ├── index.tsx                 ← createBrowserRouter() from registry
│   ├── AppShell.tsx              ← Layout shell (sidebar + chrome + outlet)
│   ├── ErrorBoundary.tsx         ← Route-level error boundary
│   └── loaders/                  ← Route loaders (optional, for data prefetch)
│
├── components/
│   ├── AppShell/
│   │   ├── Sidebar.tsx           ← Navigation (reads from VIEW_REGISTRY)
│   │   ├── TopChrome.tsx         ← Title bar + context chips + oracle badge
│   │   ├── OracleSessionBanner.tsx
│   │   └── FastAgentOverlay.tsx  ← Agent panel (portal, not in layout tree)
│   └── ...feature components
│
├── features/
│   └── [feature]/
│       └── views/
│           └── [View].tsx        ← Each view is a standalone route component
```

## Migration Path (incremental, no big bang)

### Phase 1: Extract AppShell from MainLayout (LOW RISK)
- Move sidebar, top chrome, oracle banner into `AppShell.tsx`
- AppShell renders `{children}` or `<Outlet />`
- MainLayout becomes AppShell + view switch
- **Result**: AppShell is ~200 lines, view switch is ~300 lines

### Phase 2: Replace ternary chain with router (MEDIUM RISK)
- Use `createBrowserRouter()` with routes generated from VIEW_REGISTRY
- Each registry entry with `component !== null` becomes a `<Route>`
- Custom views (research, documents, spreadsheets, calendar, entity) get explicit `<Route>` elements
- Route params replace useState: `/entity/:name`, `/spreadsheets/:id`
- **Result**: No more URL parsing hook, no more ternary chain

### Phase 3: Route-scoped state (LOW RISK)
- `selectedDocumentId` → URL param `?doc=ID` (already partially done)
- `entityName` → route param `/entity/:name` (already parsed, just not via Router)
- `selectedSpreadsheetId` → route param `/spreadsheets/:id`
- `showResearchDossier` → route `/research/:tab?`
- **Result**: Browser back/forward works, deep links work, no useState for route state

### Phase 4: Compile-time completeness (LOW RISK)
```typescript
// In viewRegistry.ts, add:
type AssertAllViewsRegistered = {
  [K in MainView]: typeof VIEW_MAP extends Record<K, any> ? true : never;
};
// TypeScript will error if any MainView value is missing from the registry
```

## What NOT to do
- Don't adopt file-based routing (Remix/Next.js convention) — adds framework coupling
- Don't add route loaders yet — current Convex reactive queries are fine
- Don't try to make ALL views prop-free — some views genuinely need parent state (document selection)
- Don't migrate all at once — each phase ships independently and keeps the build green

## Priority
Phase 1 (AppShell extraction) is highest impact per effort. It makes MainLayout reviewable.
Phase 2 is the real win but requires more careful testing.
Phase 3 and 4 are polish.
