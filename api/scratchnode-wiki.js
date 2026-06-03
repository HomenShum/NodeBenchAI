import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

let convexClient = null;

function getConvexClient() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL || "";
  if (!convexUrl) return null;
  if (!convexClient) convexClient = new ConvexHttpClient(convexUrl);
  return convexClient;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wikiUrl(slug) {
  return `https://scratchnode.live/e/${encodeURIComponent(slug)}/wiki`;
}

function renderShell({ title, statusCode, body, description, canonicalUrl }) {
  const safeTitle = escapeHtml(title || "ScratchNode Wiki");
  const safeDescription = escapeHtml(
    description ||
      "A public ScratchNode event wiki generated from host-published public answers and public sources.",
  );
  const safeCanonical = escapeHtml(canonicalUrl || "https://scratchnode.live/");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:site_name" content="ScratchNode">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeCanonical}">
  <meta property="og:image" content="https://scratchnode.live/og-scratchnode.png">
  <meta name="twitter:card" content="summary_large_image">
  <style>
    :root { color-scheme: dark; --bg:#11100f; --paper:#1b1816; --ink:#f5f0eb; --muted:#a79b94; --faint:#756b65; --line:#302a27; --accent:#d97757; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink); font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .page { max-width:980px; margin:0 auto; padding:32px 20px 56px; }
    .top { display:flex; justify-content:space-between; gap:16px; align-items:center; padding-bottom:24px; border-bottom:1px solid var(--line); }
    .brand { color:var(--ink); text-decoration:none; font-weight:800; letter-spacing:-.01em; }
    .brand span { color:var(--accent); }
    .back { color:var(--muted); text-decoration:none; font-size:13px; }
    .hero { padding:42px 0 26px; }
    .eyebrow { color:var(--accent); font:700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.12em; text-transform:uppercase; }
    h1 { margin:10px 0 10px; font-size:clamp(30px,5vw,54px); line-height:1.02; letter-spacing:0; }
    .lead { max-width:680px; color:var(--muted); font-size:16px; line-height:1.6; }
    .meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
    .chip { border:1px solid var(--line); background:rgba(255,255,255,.03); color:var(--muted); border-radius:999px; padding:6px 10px; font-size:12px; }
    .chip strong { color:var(--ink); }
    .wiki { display:grid; grid-template-columns:minmax(0,1fr) 220px; gap:28px; align-items:start; }
    article { min-width:0; padding:28px; background:var(--paper); border:1px solid var(--line); border-radius:8px; }
    article h1 { font-size:30px; line-height:1.15; margin:0 0 8px; }
    article h2 { margin:28px 0 10px; padding-top:18px; border-top:1px solid var(--line); font-size:19px; }
    article h3 { margin:18px 0 6px; font-size:15px; color:var(--ink); }
    article p, article li { color:var(--muted); line-height:1.65; }
    article ul { padding-left:20px; }
    article strong { color:var(--ink); }
    aside { position:sticky; top:20px; padding:16px; border:1px solid var(--line); border-radius:8px; color:var(--muted); font-size:13px; line-height:1.5; }
    aside a { display:block; margin-top:12px; color:var(--accent); text-decoration:none; }
    .empty { padding:48px 28px; background:var(--paper); border:1px solid var(--line); border-radius:8px; }
    .empty p { color:var(--muted); line-height:1.6; }
    @media (max-width: 800px) { .top { align-items:flex-start; flex-direction:column; } .wiki { grid-template-columns:1fr; } aside { position:static; } article { padding:22px 18px; } }
  </style>
</head>
<body data-scratchnode-wiki="${statusCode}">
  <main class="page">${body}</main>
</body>
</html>`;
}

function renderPublished(payload) {
  const event = payload.event;
  const wiki = payload.wiki;
  const title = wiki.title || `${event.name} Wiki`;
  const description = stripHtml(wiki.bodyHtml).slice(0, 180) ||
    "Host-published public wiki from ScratchNode.";
  const canonicalUrl = wikiUrl(event.slug);
  const publishedDate = wiki.publishedAt ? new Date(wiki.publishedAt).toISOString().slice(0, 10) : "published";
  const body = `
    <header class="top">
      <a class="brand" href="https://scratchnode.live/">Scratch<span>Node</span></a>
      <a class="back" href="https://scratchnode.live/e/${encodeURIComponent(event.slug)}">Open live room</a>
    </header>
    <section class="hero">
      <div class="eyebrow">Public event wiki</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="lead">A host-published record built from public room answers and public sources. Private notes are excluded.</p>
      <div class="meta">
        <span class="chip">Room <strong>${escapeHtml(event.roomCode)}</strong></span>
        <span class="chip">Version <strong>${escapeHtml(wiki.version)}</strong></span>
        <span class="chip">${escapeHtml(publishedDate)}</span>
        <span class="chip">${escapeHtml(wiki.sourceAnswerCount)} public answers</span>
        <span class="chip">${escapeHtml(wiki.sourceCount)} sources</span>
      </div>
    </section>
    <section class="wiki">
      <article>${wiki.bodyHtml}</article>
      <aside>
        <strong>Privacy boundary</strong><br>
        This page only serves published wiki snapshots. Private notes and private asks are not in the public artifact.
        <a href="https://scratchnode.live/e/${encodeURIComponent(event.slug)}">Join the room</a>
      </aside>
    </section>`;
  return renderShell({ title, description, canonicalUrl, statusCode: "published", body });
}

function renderUnavailable(slug) {
  const safeSlug = escapeHtml(slug || "room");
  const body = `
    <header class="top">
      <a class="brand" href="https://scratchnode.live/">Scratch<span>Node</span></a>
      <a class="back" href="https://scratchnode.live/e/${encodeURIComponent(slug || "")}">Back to room</a>
    </header>
    <section class="hero">
      <div class="eyebrow">Wiki not published</div>
      <h1>No public wiki yet</h1>
      <p class="lead">The room <strong>${safeSlug}</strong> has no host-published wiki snapshot available at this URL.</p>
    </section>
    <section class="empty">
      <p>Hosts can publish the public event wiki from the ScratchNode room. Until then, this route does not expose room data.</p>
    </section>`;
  return renderShell({
    title: "ScratchNode wiki not published",
    statusCode: "unpublished",
    body,
    description: "This ScratchNode room has no host-published public wiki yet.",
    canonicalUrl: `https://scratchnode.live/e/${encodeURIComponent(slug || "")}/wiki`,
  });
}

export default async function handler(req, res) {
  const url = new URL(req.url || "/", "https://scratchnode.live");
  const slug = String(url.searchParams.get("slug") || "").trim();
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!slug || slug.length > 120) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(404).send(renderUnavailable(slug));
    return;
  }
  const client = getConvexClient();
  if (!client) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(503).send(renderUnavailable(slug));
    return;
  }
  try {
    const payload = await client.query(api.events.getPublishedWikiBySlug, { slug });
    if (url.searchParams.get("format") === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.status(payload ? 200 : 404).json(payload || { ok: false, status: "unpublished" });
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    if (!payload) {
      res.status(404).send(renderUnavailable(slug));
      return;
    }
    res.status(200).send(renderPublished(payload));
  } catch (error) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(renderShell({
      title: "ScratchNode wiki unavailable",
      statusCode: "error",
      description: "ScratchNode could not load this public wiki.",
      canonicalUrl: `https://scratchnode.live/e/${encodeURIComponent(slug)}/wiki`,
      body: `
        <header class="top"><a class="brand" href="https://scratchnode.live/">Scratch<span>Node</span></a></header>
        <section class="hero"><div class="eyebrow">Wiki unavailable</div><h1>Could not load this wiki</h1><p class="lead">${escapeHtml(error?.message || "Unexpected wiki route error.")}</p></section>
      `,
    }));
  }
}
