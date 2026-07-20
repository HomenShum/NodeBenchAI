/**
 * nativeBootstrap — applies iOS/Android native shell config on boot.
 * Runs a no-op on web (detected via Capacitor.isNativePlatform()).
 *
 * Configures:
 *   - StatusBar: dark content on our brand dark bg, overlays webview
 *   - Keyboard: native resize so the composer keyboard-avoids correctly
 */

import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";

let bootstrapped = false;

export async function bootstrapNativeShell(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    if (!Capacitor.isNativePlatform?.()) return;
  } catch {
    return;
  }

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0c0f14" });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* status bar may not be available on some platforms */
  }

  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    /* keyboard plugin may not be available on all native targets */
  }
}
