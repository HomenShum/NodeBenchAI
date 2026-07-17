export function pathToChatHash(pathname: string): string | null {
  const match = pathname.match(/^\/redesign\/chat\/r\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function safeDecodePathSegment(value: string): string {
  // BrowserRouter and tests can call this helper with arbitrary strings. At
  // the public HTTP boundary, Vercel correctly rejects invalid percent escapes
  // with 400 before the SPA runs; valid URL-encoded legacy links land here.
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Preserve useful deep-link context while contracting every old product page
 * into the one conversation surface. Returning null means the URL is already
 * a canonical chat or reproducible-chat entry point. This compatibility layer
 * accepts valid URL-encoded paths; malformed HTTP request targets remain a
 * platform-level 400 and are not advertised as recoverable application URLs.
 */
export function canonicalRedesignChatTarget(pathname: string, search: string): string | null {
  if (pathname === "/redesign/chat" || pathToChatHash(pathname)) return null;

  const params = new URLSearchParams(search);
  const reportMatch = pathname.match(/^\/redesign\/reports\/([^/]+)/);

  if (reportMatch?.[1]) {
    params.set("report", safeDecodePathSegment(reportMatch[1]));
    params.set("intent", "review-report");
  } else if (pathname.startsWith("/redesign/reports")) {
    params.set("intent", "reports");
  } else if (pathname.startsWith("/redesign/inbox")) {
    params.set("intent", "attention");
  } else if (pathname.startsWith("/redesign/me")) {
    params.set("intent", "account");
  } else if (pathname.startsWith("/redesign/workspace")) {
    params.set("intent", "workspace");
    const tab = params.get("tab");
    if (tab) {
      params.set("artifact", tab);
      params.delete("tab");
    }
  } else {
    params.delete("intent");
  }

  params.delete("classic");
  params.delete("edition");
  if (params.get("qa") === "home-v2-implementation") params.delete("qa");

  const query = params.toString();
  return `/redesign/chat${query ? `?${query}` : ""}`;
}
