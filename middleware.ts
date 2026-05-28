// Edge Middleware for host-based apex routing.
//
// Why this file exists:
//
//   Vercel's static-file matching runs before the rewrites in vercel.json.
//   For the apex path "/", Vercel resolves to dist/index.html (NodeBench AI's
//   Vite-built bundle) and never reaches the rewrites array. That means the
//   rewrite { source: "/", has: [scratchnode.live] } -> /proto/home-v5.html
//   was dead code: it never fired.
//
//   Diagnostic on 2026-05-26 17:30Z confirmed:
//     - scratchnode.live/docs              -> docs.html  (rewrite worked)
//     - scratchnode.live/e/:slug           -> home-v5.html (rewrite worked)
//     - scratchnode.live/random-path-xyz   -> home-v5.html (catch-all worked)
//     - scratchnode.live/                  -> NodeBench (rewrite did not fire)
//     - scratchnode.live/index.html        -> NodeBench (static file won)
//
//   Edge Middleware runs at the edge before rewrites/static matching, which
//   lets us rewrite the path for scratchnode.live hosts only without touching
//   nodebenchai.com behavior.
//
// Cost note: Vercel charges per middleware invocation. The matcher below is
// intentionally limited to the two paths that can be stolen by static-file
// matching before vercel.json rewrites: "/" and "/index.html".
//
// Related rules:
//   - .claude/rules/live_dom_verification.md
//   - .claude/rules/backend_contract_migration.md

import { next, rewrite } from '@vercel/edge';

export const config = {
  // Keep middleware cost bounded: event/docs/random-path routing remains in
  // vercel.json because those rewrites already fire correctly.
  //
  // /demo_ver{N} routes are intentionally not matched here. They are handled
  // by the scratchnode.live catch-all rewrite in vercel.json, which preserves
  // the URL bar so home-v5.html can read location.pathname and run the demo.
  // Keeping this matcher to exact static-steal paths avoids invalid dynamic
  // matcher syntax and prevents middleware from running on every demo path.
  matcher: ['/', '/index.html'],
};

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? '';

  // Only act on the scratchnode apex. www -> apex is handled by the redirect
  // already in vercel.json; nodebenchai.com is unaffected.
  if (host !== 'scratchnode.live') {
    return next();
  }

  // Path-specific routing for scratchnode.live:
  //   /            -> /proto/home-v5.html  (apex landing)
  //   /index.html  -> /proto/home-v5.html  (defensive)
  //   /demo_ver{N} -> handled by vercel.json catch-all; URL bar preserved.
  //
  // Per-file landing-vs-demo split lives inside the home-v5.html page-mode
  // detector block.
  const pathname = url.pathname;
  const isApex = pathname === '/' || pathname === '/index.html';
  if (isApex) {
    const destination = new URL('/proto/home-v5.html', request.url);
    // Preserve search params so stale demo URLs like ?demo=1#demo still reach
    // home-v5.html and are explicitly ignored by the page-side route gate.
    destination.search = url.search;
    return rewrite(destination);
  }

  return next();
}
