/**
 * Regenerate button. Honest states: idle / pending / error. aria-busy for
 * screen readers (per reexamine_a11y).
 */
import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { RefreshCw } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";

type WikiPageType =
  | "topic" | "company" | "person" | "product"
  | "event" | "location" | "job" | "contradiction";

export function WikiRegenerateButton({
  ownerKey,
  slug,
  pageType,
  pendingRegenAt,
}: {
  ownerKey: string;
  slug: string;
  pageType: WikiPageType;
  pendingRegenAt?: number;
}) {
  const api = useConvexApi();
  const regenerate = useMutation(
    // Gracefully degrade if the route is unavailable (old Convex bundle).
    api?.domains?.product?.userWikiMaintainer?.requestManualRegenerate ?? "skip",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = busy || (!!pendingRegenAt && pendingRegenAt > Date.now() - 60 * 60 * 1000);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (typeof regenerate !== "function") {
        setError("Regeneration not available in this build");
        return;
      }
      await regenerate({ ownerKey, slug, pageType });
    } catch (err) {
      setError((err as Error).message || "Regeneration failed");
    } finally {
      setBusy(false);
    }
  }, [busy, regenerate, ownerKey, slug, pageType]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        data-testid="wiki-regenerate-button"
        aria-busy={isPending}
        aria-label={isPending ? "Regenerating wiki page…" : "Regenerate wiki page"}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-200 dark:hover:border-white/[0.15] dark:hover:bg-white/[0.04]"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${isPending ? "animate-spin motion-reduce:animate-none" : ""}`}
          aria-hidden="true"
        />
        {isPending ? "Regenerating…" : "Regenerate"}
      </button>
      {error ? (
        <p
          role="alert"
          className="text-[11px] text-rose-600 dark:text-rose-300"
          data-testid="wiki-regenerate-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
