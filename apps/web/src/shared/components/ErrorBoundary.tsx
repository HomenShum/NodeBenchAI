/**
 * Canonical shared ErrorBoundary implementation.
 *
 * Legacy compatibility imports from `src/components/ErrorBoundary.tsx` re-export
 * this file so active shared and cockpit code can depend on one real source.
 */

import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { reportError } from "@/lib/errorReporting";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  section?: string;
  /**
   * Legacy alias for `section`. Many existing callers (App.tsx, CockpitLayout,
   * ActiveSurfaceHost, etc.) pass `title` to label the failing region in the
   * fallback. Accepting both keeps the ~15 existing call sites type-clean
   * without requiring a rename sweep.
   */
  title?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private static isRecoverableChunkError(error: unknown): boolean {
    const message = String((error as any)?.message ?? error ?? "").toLowerCase();
    return (
      message.includes("failed to fetch dynamically imported module") ||
      message.includes("loading chunk") ||
      message.includes("chunkloaderror") ||
      message.includes("importing a module script failed")
    );
  }

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.section ? `:${this.props.section}` : ""}] Error caught:`, error, errorInfo);
    reportError(error, { section: this.props.section });
    this.props.onError?.(error, errorInfo);

    if (typeof window !== "undefined" && ErrorBoundary.isRecoverableChunkError(error)) {
      const marker = `nb:chunk-reload:${window.location.pathname}`;
      if (sessionStorage.getItem(marker) !== "1") {
        sessionStorage.setItem(marker, "1");
        window.setTimeout(() => window.location.reload(), 120);
      }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          section={this.props.section ?? this.props.title}
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  section?: string;
  error?: Error | null;
  onRetry?: () => void;
  className?: string;
}

export function ErrorFallback({ section, error, onRetry, className = "" }: ErrorFallbackProps) {
  const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;
  const title = section ? `Can't load ${section.toLowerCase()}` : "Something went wrong";

  return (
    <div
      role="alert"
      className={`mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center ${className}`}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/12 text-amber-400">
        <AlertTriangle className="h-7 w-7" strokeWidth={2} />
      </div>
      <h3 className="nb-text-title mt-5 text-gray-50">{title}</h3>
      <p className="nb-text-body mt-2 text-gray-400">
        Something hiccuped while loading this view. This is almost always a
        transient hiccup — a retry usually clears it.
      </p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="nb-pressable mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent-primary,#d97757)] px-5 py-2.5 text-[15px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(217,119,87,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary,#d97757)]/50"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      ) : null}
      {isDev && error?.message ? (
        <details className="mt-6 w-full text-left">
          <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500 hover:text-gray-300">
            Dev details
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-[12px] border border-[var(--nb-border-faint,rgba(255,255,255,0.06))] bg-[var(--nb-surface-raised,#1e1d1c)] p-3 text-[11px] leading-[1.4] text-gray-400">
            {error.message}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function FeedErrorFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorFallback
      section="Feed"
      error={new Error("Failed to load feed items. The news sources may be temporarily unavailable.")}
      onRetry={onRetry}
    />
  );
}

export function DigestErrorFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorFallback
      section="Morning Digest"
      error={new Error("Failed to generate your morning briefing. Please try refreshing.")}
      onRetry={onRetry}
    />
  );
}

export function BriefingErrorFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorFallback
      section="Briefing"
      error={new Error("Failed to load the executive brief. The data may still be generating.")}
      onRetry={onRetry}
    />
  );
}

export default ErrorBoundary;
