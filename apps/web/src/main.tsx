import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
// NOTE: api is imported dynamically below to avoid pulling 513 circular
// Convex deps into the initial bundle (causes TDZ crash in headless Chrome).
import "./index.css";
import App from "./App";
import { ToastProvider } from "./components/ui";
import { Toaster as SonnerToaster } from "sonner";
import { bootstrapNativeShell } from "./lib/nativeBootstrap";
import { configuredConvexUrl } from "./lib/convexUrl";

// Fire-and-forget: configures iOS/Android status bar + keyboard on boot.
// No-op on web. Safe to call before React mounts.
void bootstrapNativeShell();

// NOTE(coworker): Theme bootstrap for Playwright + QA stability.
// Apply the resolved theme class before React renders to avoid a white flash
// and to keep dark-mode luminance checks deterministic.
if (typeof window !== "undefined") {
  try {
    const root = document.documentElement;
    const savedPrefs = localStorage.getItem("nodebench-theme");
    const legacyMode = localStorage.getItem("theme");
    const prefs = savedPrefs ? (JSON.parse(savedPrefs) as { mode?: string } | null) : null;
    const mode = prefs?.mode ?? legacyMode ?? "system";
    const resolved =
      mode === "system"
        ? window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
          ? "dark"
          : "light"
        : mode;
    if (resolved === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  } catch {
    // Ignore malformed localStorage values.
  }
}

declare global {
  interface Window {
    __nodebenchHasUserGesture?: boolean;
  }
}

// Dev-only: Suppress noisy Chrome extension messaging errors that are unrelated to the app
if (import.meta.env?.DEV) {
  const isExtMsgError = (msg?: string) => !!msg && (
    msg.includes('A listener indicated an asynchronous response') ||
    msg.includes('message channel closed before a response') ||
    msg.includes('Unchecked runtime.lastError')
  );
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason: any = e.reason;
      const msg = String(reason?.message ?? reason ?? '');
      if (isExtMsgError(msg)) {
        console.warn('[Dev] Suppressed extension messaging error (unhandledrejection):', msg);
        e.preventDefault();
      }
    } catch {
      // Error checking failed
    }
  });
  window.addEventListener('error', (e) => {
    try {
      const msg = String(e?.message ?? '');
      if (isExtMsgError(msg)) {
        console.warn('[Dev] Suppressed extension messaging error (window.error):', msg);
        e.preventDefault();
      }
    } catch {
      // Error checking failed
    }
  }, true);
}

// Track whether the user has performed a real gesture in this tab. We use this to gate beforeunload prompts,
// which Chromium will block (and warn about) if triggered without a user activation.
if (typeof window !== "undefined" && window.__nodebenchHasUserGesture !== true) {
  const mark = () => {
    window.__nodebenchHasUserGesture = true;
    window.removeEventListener("pointerdown", mark, true);
    window.removeEventListener("keydown", mark, true);
    window.removeEventListener("touchstart", mark, true);
  };
  window.addEventListener("pointerdown", mark, true);
  window.addEventListener("keydown", mark, true);
  window.addEventListener("touchstart", mark, true);
}

// Global safety guard: suppress beforeunload confirmation prompts until the browser has observed
// an actual user activation. Some third-party libraries register beforeunload handlers that may
// attempt to show a confirmation dialog even during automated navigation, which Chromium blocks
// and logs as a console error. This keeps long-running QA / Playwright sessions clean.
if (typeof window !== "undefined") {
  window.addEventListener(
    "beforeunload",
    (e) => {
      try {
        const ua = (navigator as any)?.userActivation;
        if (ua && ua.hasBeenActive === false) {
          e.stopImmediatePropagation();
        }
      } catch {
        // ignore
      }
    },
    { capture: true }
  );
}

function MissingConvexUrlScreen() {
  const example = `VITE_CONVEX_URL="https://your-deployment.convex.cloud"`;
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="text-sm font-semibold text-muted-foreground">Setup required</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Convex backend not configured</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          This UI needs <code className="font-mono">VITE_CONVEX_URL</code> to connect to Convex. Without it,
          the app cannot load data or sign in.
        </p>

        <div className="mt-5 rounded-lg bg-muted/40 p-4">
          <div className="text-xs font-semibold text-muted-foreground">Create or update</div>
          <div className="mt-2 text-xs font-mono whitespace-pre-wrap select-text">{example}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            Put this in <code className="font-mono">.env.local</code> (not committed), then restart the dev server.
          </div>
        </div>

        <div className="mt-5 text-sm text-muted-foreground">
          Quick start:
          <ol className="mt-2 list-decimal list-inside space-y-1">
            <li>
              Run <code className="font-mono">npx convex dev</code> and copy the deployment URL.
            </li>
            <li>
              Set <code className="font-mono">VITE_CONVEX_URL</code> in <code className="font-mono">.env.local</code>.
            </li>
            <li>
              Run <code className="font-mono">npm run dev</code>.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// Validity, not presence. A non-empty but non-deployment URL (the value
// .env.example ships) used to pass this gate and leave the app rendered with a
// dead socket. See apps/web/src/lib/convexUrl.ts.
const convexUrl = configuredConvexUrl();
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

// Prod: capture global errors into a deduped bug-card workflow (Ralph loop substrate).
if (import.meta.env.PROD && convex) {
  const lastSentBySig = new Map<string, number>();
  const send = (args: { message: string; stack?: string; route?: string; section?: string; url?: string; userAgent?: string }) => {
    try {
      const raw = JSON.stringify({
        m: String(args.message || "").slice(0, 300),
        s: String(args.stack || "").split("\n").slice(0, 6).join("\n"),
        r: String(args.route || "").slice(0, 200),
        c: String(args.section || "").slice(0, 80),
      });
      let hash = 2166136261;
      for (let i = 0; i < raw.length; i++) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const signature = `bug_${(hash >>> 0).toString(16).padStart(8, "0")}`;

      const now = Date.now();
      const last = lastSentBySig.get(signature) ?? 0;
      if (now - last < 30_000) return;
      lastSentBySig.set(signature, now);

      import("@convex/_generated/api").then(({ api }) => {
        convex.mutation(api.domains.operations.bugLoop.reportClientError, {
          message: args.message,
          stack: args.stack,
          route: args.route,
          section: args.section,
          url: args.route,
        }).catch(() => {
          // best-effort
        });
      }).catch(() => {
        // api import failed — skip error reporting
      });
    } catch {
      // best-effort
    }
  };

  window.addEventListener("error", (e) => {
    try {
      const err: any = (e as any).error;
      send({
        message: String(err?.message ?? (e as any).message ?? "window.error"),
        stack: err?.stack ? String(err.stack) : undefined,
        route: window.location?.pathname,
        section: undefined,
      });
    } catch {
      // best-effort
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    try {
      const reason: any = (e as any).reason;
      send({
        message: String(reason?.message ?? reason ?? "unhandledrejection"),
        stack: reason?.stack ? String(reason.stack) : undefined,
        route: window.location?.pathname,
        section: undefined,
      });
    } catch {
      // best-effort
    }
  });
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    {convex ? (
      <ConvexAuthProvider client={convex}>
        <ToastProvider>
          <App />
          <SonnerToaster
            position="top-center"
            theme="dark"
            toastOptions={{
              style: {
                background: "#1c1c1e",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#f5f5f7",
              },
            }}
          />
        </ToastProvider>
      </ConvexAuthProvider>
    ) : (
      <MissingConvexUrlScreen />
    )}
  </BrowserRouter>,
);

// NOTE(coworker): Playwright/WebDriver runs can load stale hashed chunks between rapid preview rebuilds.
// Skip SW registration in automated browser contexts so QA reflects current build output.
const isAutomatedBrowser =
  typeof navigator !== "undefined" && (navigator.webdriver || /Playwright/i.test(navigator.userAgent));

const shouldResetLocalServiceWorkers =
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  (window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost" ||
    !import.meta.env.PROD ||
    isAutomatedBrowser);

if (shouldResetLocalServiceWorkers) {
  navigator.serviceWorker
    .getRegistrations()
    .then(async (registrations) => {
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
      }
    })
    .catch(() => {
      // Best-effort reset for local/dev shells.
    });
}

// Register service worker for caching and offline support
if ('serviceWorker' in navigator && import.meta.env.PROD && !isAutomatedBrowser) {
  // When skipWaiting is true, the new SW activates immediately without going through
  // the "waiting" state. This means onNeedRefresh may never fire. The controllerchange
  // event catches this case — it fires when a new SW takes over from an existing one.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    console.log('[PWA] New service worker activated, reloading for fresh assets');
    window.location.reload();
  });

  import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        console.log('[PWA] New content available, applying update');
        void updateSW(true);
        // controllerchange listener above handles the reload
      },
      onOfflineReady() {
        console.log('[PWA] App ready to work offline');
      },
      onRegistered(registration) {
        console.log('[PWA] Service Worker registered');
        // Check for updates every 10 minutes (was 60 — tightened 2026-07-01 so long-lived SPA
        // tabs pick up a new deploy faster; the existing controllerchange listener above still
        // handles the actual reload once an update is found). This is a tuning change, not a bug
        // fix — the mechanism already existed and works; a real user just landed on a tab opened
        // before a deploy and hit the old 60-minute window. See docs/LIVE-USER-BENCHMARK-FINDING.md.
        setInterval(() => {
          registration?.update();
        }, 10 * 60 * 1000);
      },
      onRegisterError(error) {
        console.error('[PWA] Service Worker registration failed:', error);
      },
    });
  });
}
