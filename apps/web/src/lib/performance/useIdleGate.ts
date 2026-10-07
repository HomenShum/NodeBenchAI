import { useEffect, useState } from "react";

type IdleGateOptions = {
  timeoutMs?: number;
  disabled?: boolean;
};

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdle = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: (deadline: IdleDeadlineLike) => void,
      options?: { timeout?: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
  };

export function useIdleGate({ timeoutMs = 700, disabled = false }: IdleGateOptions = {}) {
  const [ready, setReady] = useState(disabled);

  useEffect(() => {
    if (disabled) {
      setReady(true);
      return;
    }

    const win = window as WindowWithIdle;
    let timeoutId = 0;
    let idleId = 0;
    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };

    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(markReady, { timeout: timeoutMs });
    } else {
      timeoutId = window.setTimeout(markReady, Math.min(timeoutMs, 300));
    }

    timeoutId = window.setTimeout(markReady, timeoutMs);

    return () => {
      settled = true;
      if (idleId && typeof win.cancelIdleCallback === "function") {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [disabled, timeoutMs]);

  return ready;
}
