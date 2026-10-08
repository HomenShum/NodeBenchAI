/** Fixed worker transport bounds; no provider response body enters an error. */
export class PipelineHttpError extends Error {
  constructor(public readonly code: "UPSTREAM_FAILURE" | "INVALID_PROVIDER_RESPONSE", public readonly upstreamStatus?: number) {
    super(code === "UPSTREAM_FAILURE" ? "Research provider request failed" : "Research provider returned an invalid response");
  }
}

export function createPipelineBudget(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Research budget expired", "TimeoutError")), timeoutMs);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); parent?.removeEventListener("abort", abort); },
  };
}

const OWNED_HOSTS = new Set([
  "api.linkup.so", "api.search.brave.com", "google.serper.dev", "api.tavily.com",
  "generativelanguage.googleapis.com", "www.sec.gov", "data.sec.gov",
]);

async function readJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<any> {
  const declared = response.headers.get("content-length");
  const reader = response.body?.getReader();
  if (!reader) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
  let abortRead!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { abortRead = reject; });
  const abort = () => { abortRead(signal.reason); void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let reads = 0;
  let complete = false;
  try {
    signal.throwIfAborted();
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (done) break;
      if (++reads > 4096 || bytes + value.byteLength > maxBytes) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
      bytes += value.byteLength;
      if (value.byteLength) chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let data: unknown;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch { throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
    complete = true;
    return data;
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function fetchPipelineJson(
  target: string, init: RequestInit, maxBytes: number,
  parent: AbortSignal | undefined, timeoutMs: number,
): Promise<any> {
  const url = new URL(target);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !OWNED_HOSTS.has(url.hostname)) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
  const budget = createPipelineBudget(parent, timeoutMs);
  try {
    budget.signal.throwIfAborted();
    const response = await fetch(url.href, { ...init, redirect: "error", signal: budget.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new PipelineHttpError("UPSTREAM_FAILURE", response.status);
    }
    return await readJson(response, maxBytes, budget.signal);
  } finally { budget.dispose(); }
}
