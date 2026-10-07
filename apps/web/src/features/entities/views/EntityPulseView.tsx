/**
 * EntityPulseView — the "what changed since yesterday" page.
 *
 * Routes:
 *   /entity/<slug>/pulse           → today's pulse for this entity
 *   /entity/<slug>/pulse/<dateKey> → historical pulse (scrubable)
 *   /pulse                         → cross-entity digest (see PulseDigestView)
 *
 * V1 render: reads `pulseReports.getPulseForEntity`, shows the
 * summary markdown as plain prose (Tailwind-typography-lite), with
 * a "Refresh" button that calls `generatePulseForEntity`. Force
 * `data-view-mode="read"` on the wrapper so the global CSS strips
 * edit chrome — pulse is a READ surface, not an editing one.
 *
 * V2 (deferred): render via the full notebook substrate so pulse
 * gets AgentAuthorTag, overlays, accept-to-promote into main
 * notebook — same substrate as `/entity/<slug>`.
 */

import { memo, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, RefreshCw, Check } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { buildEntityPath } from "@/features/entities/lib/entityExport";
import { cn } from "@/lib/utils";

function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map((s) => Number(s));
  if (!y || !m || !d) return dateKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Minimal markdown → HTML for V1 summaries. Handles H1/H2, bold, list items. */
function renderMarkdown(md: string): { __html: string } {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/).map(esc);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2 class="mt-6 text-base font-semibold tracking-tight text-content">${line.slice(3)}</h2>`);
    } else if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1 class="mt-2 text-2xl font-semibold tracking-tight text-content">${line.slice(2)}</h1>`);
    } else if (line.startsWith("- ")) {
      if (!inList) { out.push(`<ul class="mt-2 space-y-1 text-sm text-content-muted">`); inList = true; }
      // bold **x**
      const li = line.slice(2).replace(/\*\*([^*]+)\*\*/g, '<strong class="text-content">$1</strong>');
      out.push(`<li class="pl-4 border-l border-white/[0.06]">${li}</li>`);
    } else if (line.startsWith("_") && line.endsWith("_")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p class="mt-3 text-sm italic text-content-muted">${line.slice(1, -1)}</p>`);
    } else if (line.length === 0) {
      if (inList) { out.push("</ul>"); inList = false; }
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      const p = line.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-content">$1</strong>');
      out.push(`<p class="mt-3 text-sm leading-6 text-content-muted">${p}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return { __html: out.join("\n") };
}

export const EntityPulseView = memo(function EntityPulseView() {
  const params = useParams<{ slug?: string; dateKey?: string }>();
  const navigate = useNavigate();
  const api = useConvexApi();
  const slug = params.slug ?? "";
  const anonymousSessionId = getAnonymousProductSessionId();

  const pulse = useQuery(
    api?.domains?.product?.pulseReports?.getPulseForEntity ?? ("skip" as any),
    api?.domains?.product?.pulseReports?.getPulseForEntity && slug
      ? { anonymousSessionId, entitySlug: slug, dateKey: params.dateKey }
      : "skip",
  );

  const history = useQuery(
    api?.domains?.product?.pulseReports?.listPulsesForEntity ?? ("skip" as any),
    api?.domains?.product?.pulseReports?.listPulsesForEntity && slug
      ? { anonymousSessionId, entitySlug: slug, limit: 14 }
      : "skip",
  ) as Array<{ _id: string; dateKey: string; changeCount: number; materialChangeCount: number }> | undefined;

  const generatePulse = useMutation(
    api?.domains?.product?.pulseReports?.generatePulseForEntity ??
      (("skip" as unknown) as never),
  );
  const markRead = useMutation(
    api?.domains?.product?.pulseReports?.markPulseRead ??
      (("skip" as unknown) as never),
  );

  // Auto-mark as read on mount if pulse exists and is unread.
  useEffect(() => {
    if (!api || !pulse || (pulse as any)?.readAt) return;
    const pulseId = (pulse as any)?._id;
    if (pulseId) {
      void Promise.resolve(markRead({ anonymousSessionId, pulseId })).catch(() => {});
    }
  }, [api, pulse, markRead, anonymousSessionId]);

  const handleRefresh = useCallback(async () => {
    if (!api || !slug) return;
    try {
      await generatePulse({ anonymousSessionId, entitySlug: slug });
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error("[pulse] generate failed:", err);
      }
    }
  }, [api, slug, generatePulse, anonymousSessionId]);

  const displayDate = useMemo(() => {
    const dateKey = (pulse as any)?.dateKey ?? params.dateKey;
    return dateKey ? formatDateKey(dateKey) : "Today";
  }, [pulse, params.dateKey]);

  if (!slug) {
    return (
      <div className="mx-auto mt-24 max-w-md p-6 text-center text-content-muted">
        No entity specified.
      </div>
    );
  }

  return (
    <main
      className="mx-auto min-h-screen max-w-[760px] px-6 py-10"
      data-view-mode="read"
      aria-label={`Pulse for ${slug}`}
    >
      {/* Back link + action cluster */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(buildEntityPath(slug))}
          className="inline-flex items-center gap-1.5 text-xs text-content-muted hover:text-content transition"
          aria-label={`Back to ${slug} notebook`}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Back to notebook</span>
        </button>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={!api}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-1 text-xs text-content-muted hover:text-content transition disabled:opacity-50"
          aria-label="Regenerate pulse"
        >
          <RefreshCw className="h-3 w-3" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Pulse header */}
      <header className="mt-6 border-b border-white/[0.06] pb-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-content-muted">
          Pulse · {displayDate}
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-content">
          {slug}
        </h1>
        {pulse ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-content-muted">
            <span>{(pulse as any).changeCount ?? 0} changes</span>
            <span>·</span>
            <span>{(pulse as any).materialChangeCount ?? 0} material</span>
            {(pulse as any).readAt ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Check className="h-3 w-3" /> read
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Pulse body */}
      <section className="mt-6">
        {pulse === undefined ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-2/3 rounded bg-white/[0.04]" />
            <div className="h-4 w-4/5 rounded bg-white/[0.04]" />
            <div className="h-4 w-1/2 rounded bg-white/[0.04]" />
          </div>
        ) : pulse === null ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-content-muted">
              No pulse for this day yet.
            </p>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[color:var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[color:var(--accent-primary-hover)]"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Generate pulse</span>
            </button>
          </div>
        ) : (
          <article
            className="notebook-sheet prose-invert max-w-none"
            dangerouslySetInnerHTML={renderMarkdown((pulse as any).summaryMarkdown ?? "")}
          />
        )}
      </section>

      {/* History strip */}
      {history && history.length > 1 ? (
        <aside className="mt-10 border-t border-white/[0.06] pt-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-content-muted">
            Earlier
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {history.map((h) => (
              <li key={h._id}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/entity/${encodeURIComponent(slug)}/pulse/${h.dateKey}`)
                  }
                  className={cn(
                    "rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[11px] text-content-muted hover:text-content transition",
                    params.dateKey === h.dateKey && "ring-1 ring-[color:var(--accent-primary)] text-content",
                  )}
                >
                  {formatDateKey(h.dateKey)}
                  <span className="ml-1.5 text-content-muted">· {h.changeCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </main>
  );
});

EntityPulseView.displayName = "EntityPulseView";

export default EntityPulseView;
