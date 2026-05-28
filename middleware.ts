// Edge Middleware for host-based apex routing.
//
// Why this file exists:
//
//   Vercel's static-file matching runs BEFORE the rewrites in vercel.json.
//   For the apex path "/", Vercel resolves to dist/index.html (NodeBench AI's
//   Vite-built bundle) and never reaches the rewrites array. That means the
//   rewrite { source: "/", has: [scratchnode.live] } → /proto/home-v5.html
//   was dead code: it never fired.
//
//   Diagnostic on 2026-05-26 17:30Z confirmed:
//     - scratchnode.live/docs              → docs.html  (rewrite worked)
//     - scratchnode.live/e/:slug           → home-v5.html (rewrite worked)
//     - scratchnode.live/random-path-xyz   → home-v5.html (catch-all worked)
//     - scratchnode.live/                  → NodeBench (rewrite DID NOT fire)
//     - scratchnode.live/index.html        → NodeBench (static file won)
//
//   Edge Middleware runs at the edge BEFORE any rewrites or static matching,
//   which lets us rewrite the path for scratchnode.live hosts only — without
//   touching nodebenchai.com behavior.
//
// Cost note: Vercel charges per middleware invocation. The matcher below is
// intentionally limited to the two paths that can be stolen by static-file
// matching before vercel.json rewrites: "/" and "/index.html".
//
// Related rules:
//   - .claude/rules/live_dom_verification.md
//   - .claude/rules/backend_contract_migration.md (different problem class,
//     same root vibe: routing assumptions need verification at the live URL)

import { next, rewrite } from '@vercel/edge';

export const config = {
  // Keep middleware cost bounded: event/docs/random-path routing remains in
  // vercel.json because those rewrites already fire correctly.
  //
  // /demo_ver:n* is intentionally included so /demo_ver1, /demo_ver2, etc.
  // all rewrite to /proto/home-v5.html while PRESERVING the URL bar so the
  // page-side detector can read location.pathname.
  matcher: ['/', '/index.html', '/demo_ver:n*'],
};

// /demo_ver{N} where N is one or more digits. Trailing slash optional.
const DEMO_VER_RE = /^\/demo_ver\d+\/?$/;

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? '';

  // Only act on the scratchnode apex. www → apex is handled by the redirect
  // already in vercel.json; nodebenchai.com is unaffected.
  if (host !== 'scratchnode.live') {
    return next();
  }

  // Path-specific routing for scratchnode.live:
  //   /                → /proto/home-v5.html   (apex landing — minimal page)
  //   /index.html      → /proto/home-v5.html   (defensive)
  //   /demo_ver{N}     → /proto/home-v5.html   (URL bar preserved by rewrite;
  //                                            page-side reads location.pathname
  //                                            to set data-page-mode="demo" and
  //                                            auto-run runDemoFull)
  //   /docs            → handled by vercel.json rewrite
  //   /e/:slug*        → handled by vercel.json rewrite
  //   /(any other)     → handled by vercel.json catch-all
  //
  // Per-file landing-vs-demo split inside home-v5.html itself —
  // see public/proto/home-v5.html "page-mode detector" block.
  const pathname = url.pathname;
  const isApex = pathname === '/' || pathname === '/index.html';
  const isDemoVer = DEMO_VER_RE.test(pathname);
  if (isApex || isDemoVer) {
    const destination = new URL('/proto/home-v5.html', request.url);
    // Preserve search params (e.g. ?demoSpeed=fast) so they still reach the
    // page-side runDemoFull options parser.
    destination.search = url.search;
    return rewrite(destination);
  }

  return next();
}
