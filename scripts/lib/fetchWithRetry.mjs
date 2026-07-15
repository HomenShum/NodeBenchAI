const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 8_000]);
const DEFAULT_TIMEOUT_MS = 15_000;

const sleep = (delayMs) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));

export function isRetryableHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function describeFetchError(error) {
  const messages = [];
  const visited = new Set();
  let current = error;

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const message =
      typeof current.message === "string" && current.message.trim()
        ? current.message.trim()
        : (current.constructor?.name ?? "unknown error");
    const code =
      typeof current.code === "string" && !message.includes(current.code)
        ? ` (${current.code})`
        : "";
    messages.push(`${message}${code}`);
    current = current.cause;
  }

  return messages.length > 0 ? messages.join(" -> ") : String(error);
}

export async function fetchWithRetry(
  resource,
  init = {},
  {
    fetchImpl = globalThis.fetch,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleepImpl = sleep,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is unavailable");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive finite number");
  }

  const totalAttempts = retryDelaysMs.length + 1;
  let lastError;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = init.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      const response = await fetchImpl(resource, { ...init, signal });

      if (
        !isRetryableHttpStatus(response.status) ||
        attempt === totalAttempts
      ) {
        return { response, attempts: attempt };
      }

      lastError = new Error(
        `HTTP ${response.status} ${response.statusText}`.trim(),
      );
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === totalAttempts) {
        throw new Error(
          `Request failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${describeFetchError(error)}`,
          { cause: error },
        );
      }
    }

    await sleepImpl(retryDelaysMs[attempt - 1], {
      attempt,
      cause: lastError,
    });
  }

  throw new Error(
    `Request failed after ${totalAttempts} attempts: ${describeFetchError(lastError)}`,
    { cause: lastError },
  );
}
