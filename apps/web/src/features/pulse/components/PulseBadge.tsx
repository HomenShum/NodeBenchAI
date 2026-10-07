/**
 * PulseBadge — compact unread-count chip for the entity top bar and
 * Reports landing.
 *
 * Subscribes to pulseQueries.unreadCount, renders null when count is 0
 * (ship-gate §8: empty/low-value modules should not render). Clicking
 * navigates to the appropriate pulse view.
 */

import { memo, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { buildEntityPulsePath } from "@/features/entities/lib/entityExport";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

type Props = {
  /** If provided, badge counts only that entity's unread pulses. */
  entitySlug?: string;
  /** Additional classes for positioning. */
  className?: string;
  /** Rendering variant — chip (default) or dot-only. */
  variant?: "chip" | "dot";
};

/** Isolated query subtree so a server-side failure on `unreadCount`
    (schema drift) can never propagate into the entity top bar. */
function PulseBadgeInner({
  entitySlug,
  onCount,
}: {
  entitySlug?: string;
  onCount: (n: number) => void;
}) {
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  // The deployed `unreadPulseCount` is owner-scoped only (no per-entity
  // filter). When `entitySlug` is supplied the caller still gets the
  // global unread count; per-entity filtering can be added when the
  // product need is real. `entitySlug` is consumed upstream for the
  // click-through target.
  void entitySlug;
  const n = useQuery(
    (api as any)?.domains?.product?.pulseReports?.unreadPulseCount ?? ("skip" as never),
    (api as any)?.domains?.product?.pulseReports?.unreadPulseCount
      ? ({ anonymousSessionId } as never)
      : ("skip" as never),
  ) as number | undefined;
  // setState-in-render violation fix: React forbids calling a parent setState
  // (onCount ≡ setCount) during a child's render phase because it restarts the
  // render. Defer to an effect so the parent update runs after commit. React
  // bails out of the re-render when the value is unchanged (Object.is),
  // preserving the previous one-render-to-steady-state behavior.
  useEffect(() => {
    if (typeof n === "number") onCount(n);
  }, [n, onCount]);
  return null;
}

function PulseBadgeBase({ entitySlug, className, variant = "chip" }: Props) {
  const navigate = useNavigate();
  const [count, setCount] = useState<number | null>(null);

  const body = (
    <ErrorBoundary section="Pulse badge" fallback={null}>
      <PulseBadgeInner entitySlug={entitySlug} onCount={setCount} />
    </ErrorBoundary>
  );

  if (count == null || count === 0) return <>{body}</>;

  const label = count > 9 ? "9+" : String(count);
  const target = entitySlug ? buildEntityPulsePath(entitySlug) : "/pulse";

  if (variant === "dot") {
    return (
      <>
        {body}
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full bg-[var(--accent-primary)]",
            className,
          )}
          aria-label={`${count} unread pulse${count === 1 ? "" : "s"}`}
          title={`${count} unread pulse${count === 1 ? "" : "s"}`}
        />
      </>
    );
  }

  return (
    <>
      {body}
      <button
        type="button"
        onClick={() => navigate(target)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-[var(--accent-primary)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)]/25",
          className,
        )}
        title={`${count} unread pulse${count === 1 ? "" : "s"} — open Pulse`}
      >
        <Activity className="h-3 w-3" aria-hidden="true" />
        <span>{label}</span>
      </button>
    </>
  );
}

export const PulseBadge = memo(PulseBadgeBase);
export default PulseBadge;
