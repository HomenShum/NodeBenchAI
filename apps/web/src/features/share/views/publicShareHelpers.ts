/**
 * Pure helpers for the public share view — extracted so they can be
 * scenario-tested without a Convex + DOM harness.
 */

/** Parse a token out of /share/{token}. Returns null if no match. */
export function parseShareTokenFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/share\/([A-Za-z0-9_-]+)\/?$/);
  return match ? match[1] : null;
}

/** Map a share context status into a renderable triage descriptor.
 *  HONEST_STATUS: every status maps to a distinct user message. */
export function describeShareStatus(
  status: "not_found" | "revoked" | "expired" | "active",
): { title: string; body: string } {
  switch (status) {
    case "not_found":
      return {
        title: "Link not found",
        body: "This share link doesn't exist. Double-check the URL with whoever sent it to you.",
      };
    case "revoked":
      return {
        title: "Link revoked",
        body: "The owner revoked access to this link. Request a new one from them.",
      };
    case "expired":
      return {
        title: "Link expired",
        body: "This share link has expired. Ask the owner to mint a new one.",
      };
    case "active":
      return {
        title: "",
        body: "",
      };
  }
}

/** Build a /share/{token} URL for the current origin. Token is trusted — the
 *  minting backend already rejects bad input. */
export function buildShareUrl(origin: string, token: string): string {
  if (!origin) return `/share/${token}`;
  return `${origin.replace(/\/$/, "")}/share/${token}`;
}
