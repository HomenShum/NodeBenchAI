import type { CDPSession, Page } from "@playwright/test";

type HeaderOverrides = Readonly<Record<string, string>>;

function mergeHeaders(
  requestHeaders: Readonly<Record<string, string>>,
  overrides: HeaderOverrides,
): Array<{ name: string; value: string }> {
  const overriddenNames = new Set(
    Object.keys(overrides).map((name) => name.toLowerCase()),
  );

  return [
    ...Object.entries(requestHeaders)
      .filter(([name]) => !overriddenNames.has(name.toLowerCase()))
      .map(([name, value]) => ({ name, value })),
    ...Object.entries(overrides).map(([name, value]) => ({ name, value })),
  ];
}

/**
 * CDP Fetch header overrides apply to one request only. Redirect requests are
 * paused again with a new request id, so a hop to another origin receives no
 * override. Playwright Route overrides cannot provide that guarantee.
 */
export async function installOriginScopedCDPHeaders(
  page: Page,
  origin: string,
  headers: HeaderOverrides,
): Promise<CDPSession> {
  const scopedOrigin = new URL(origin).origin;
  const session = await page.context().newCDPSession(page);

  session.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const requestOrigin = new URL(request.url).origin;
    if (requestOrigin !== scopedOrigin) {
      await session.send("Fetch.continueRequest", { requestId });
      return;
    }

    await session.send("Fetch.continueRequest", {
      requestId,
      headers: mergeHeaders(request.headers, headers),
    });
  });

  await session.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });
  return session;
}

export async function installVercelPreviewBypass(
  page: Page,
  baseURL: string,
): Promise<void> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) return;

  const previewURL = new URL(baseURL);
  if (!previewURL.hostname.endsWith(".vercel.app")) return;

  await installOriginScopedCDPHeaders(page, previewURL.origin, {
    "x-vercel-protection-bypass": secret,
    "x-vercel-skip-toolbar": "1",
  });
}
