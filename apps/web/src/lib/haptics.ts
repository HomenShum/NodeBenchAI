/**
 * haptics.ts — Unified haptic feedback: native via Capacitor, web fallback.
 *
 * References:
 *   - Capacitor Haptics: https://capacitorjs.com/docs/apis/haptics
 *   - Apple HIG Haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
 */

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type HapticStyle =
  | "light"
  | "medium"
  | "heavy"
  | "selection"
  | "success"
  | "warning"
  | "error";

const isNative = () => {
  try {
    return typeof Capacitor !== "undefined" && Capacitor.isNativePlatform?.();
  } catch {
    return false;
  }
};

export function haptic(style: HapticStyle = "light") {
  if (isNative()) {
    try {
      switch (style) {
        case "light":
        case "selection":
          void Haptics.impact({ style: ImpactStyle.Light });
          return;
        case "medium":
          void Haptics.impact({ style: ImpactStyle.Medium });
          return;
        case "heavy":
          void Haptics.impact({ style: ImpactStyle.Heavy });
          return;
        case "success":
          void Haptics.notification({ type: NotificationType.Success });
          return;
        case "warning":
          void Haptics.notification({ type: NotificationType.Warning });
          return;
        case "error":
          void Haptics.notification({ type: NotificationType.Error });
          return;
      }
    } catch {
      /* fall through to web */
    }
  }

  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const patterns: Record<HapticStyle, number | number[]> = {
    light: 6,
    selection: 6,
    medium: 10,
    heavy: 16,
    success: [8, 40, 12],
    warning: [12, 60, 12],
    error: [10, 40, 10, 40, 10],
  };
  try {
    navigator.vibrate(patterns[style]);
  } catch {
    /* noop */
  }
}
