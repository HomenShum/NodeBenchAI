import { useCallback } from "react";

import { useMutation } from "convex/react";

import { api } from "../../convex/_generated/api";

export type IntentTelemetrySource =
  | "voice"
  | "text"
  | "navigation"
  | "system"
  | "search";

export type IntentTelemetryStatus =
  | "handled"
  | "fallback"
  | "failed";

export interface IntentTelemetryEvent {
  source: IntentTelemetrySource;
  intentKey: string;
  action: string;
  status: IntentTelemetryStatus;
  inputText?: string;
  route?: string;
  targetView?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: number;
}

export function useIntentTelemetry() {
  const trackIntentEvent = useMutation(api.domains.analytics.intentSignals.trackIntentEvent);

  return useCallback(
    (event: IntentTelemetryEvent) => {
      void trackIntentEvent(event).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn("[useIntentTelemetry] Failed to track intent event", error);
        }
      });
    },
    [trackIntentEvent],
  );
}
