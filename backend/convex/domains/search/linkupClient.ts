/**
 * Shared Linkup search client with Gemini grounding fallback.
 *
 * Pattern: SSRF-validated, bounded-read search with graceful fallback
 * Prior art:
 *   - OWASP SSRF Prevention Cheat Sheet
 *   - Anthropic agentic reliability checklist (BOUND_READ, SSRF, TIMEOUT)
 */

export const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent";

export const SEARCH_TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB

const SSRF_BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^metadata\.google\.internal$/i,
];

export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return !SSRF_BLOCKED_PATTERNS.some((p) => p.test(parsed.hostname));
  } catch {
    return false;
  }
}

export async function readBoundedResponse(
  resp: Response,
  maxBytes: number = MAX_RESPONSE_BYTES,
): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("");
}

export async function searchWithFallback(
  query: string,
  linkupKey: string | undefined,
  geminiKey: string | undefined,
): Promise<{ snippets: string[]; sources: Array<{ url: string; title: string }> }> {
  const snippets: string[] = [];
  const sources: Array<{ url: string; title: string }> = [];

  if (linkupKey) {
    try {
      const resp = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${linkupKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          depth: "standard",
          outputType: "sourcedAnswer",
          includeInlineCitations: true,
          includeSources: true,
          maxResults: 8,
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (resp.ok) {
        const text = await readBoundedResponse(resp, MAX_RESPONSE_BYTES);
        const data = JSON.parse(text);

        if (data.answer) snippets.push(data.answer);
        const resultList = data.results ?? data.sources ?? [];
        for (const s of resultList.slice(0, 10)) {
          const url = s.url ?? "";
          if (url && isUrlSafe(url)) {
            sources.push({ url, title: s.name ?? s.title ?? url });
            if (s.content) snippets.push(s.content.slice(0, 1000));
            else if (s.snippet) snippets.push(s.snippet);
          }
        }
      }
    } catch {
      /* Linkup failed — fall through to Gemini grounding */
    }
  }

  if (snippets.length === 0 && geminiKey) {
    try {
      const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Provide a factual, well-sourced summary about: ${query}\n\nInclude specific facts, numbers, dates, and names. Cite sources where possible.`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (resp.ok) {
        const text = await readBoundedResponse(resp, MAX_RESPONSE_BYTES);
        const data = JSON.parse(text);
        const answer =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (answer) snippets.push(answer);
      }
    } catch {
      /* Gemini also failed — return empty */
    }
  }

  return { snippets, sources };
}
