/**
 * WikiLanding — Me > My Wiki list view.
 *
 * Shows the owner's wiki pages grouped by pageType. No agent runtime in
 * this surface — pure Convex live queries + reactive UI.
 *
 * Contract per docs/architecture/ME_PAGE_WIKI_SPEC.md §3.
 */
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { useConvexApi } from "@/lib/convexApi";
import { WikiFreshnessBadge, type FreshnessState } from "./WikiFreshnessBadge";

type WikiPageType =
  | "topic" | "company" | "person" | "product"
  | "event" | "location" | "job" | "contradiction";

type WikiPageRow = {
  _id: string;
  slug: string;
  pageType: WikiPageType;
  title: string;
  summary: string;
  freshnessState: FreshnessState;
  contradictionCount: number;
  revision: number;
  regeneratedAt: number;
  updatedAt: number;
};

const TABS: Array<{ id: "all" | WikiPageType; label: string }> = [
  { id: "all", label: "All" },
  { id: "company", label: "Companies" },
  { id: "person", label: "People" },
  { id: "product", label: "Products" },
  { id: "event", label: "Events" },
  { id: "location", label: "Locations" },
  { id: "job", label: "Jobs" },
  { id: "topic", label: "Topics" },
];

function formatRelative(ts: number): string {
  if (!ts) return "no runs yet";
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function WikiLanding({ ownerKey }: { ownerKey: string }) {
  const api = useConvexApi();
  const [tab, setTab] = useState<"all" | WikiPageType>("all");

  const pages = useQuery(
    api?.domains?.product?.userWikiMaintainer?.listPagesForOwner ?? "skip",
    api?.domains?.product?.userWikiMaintainer?.listPagesForOwner
      ? { ownerKey, pageType: tab === "all" ? undefined : tab, limit: 50 }
      : "skip",
  ) as WikiPageRow[] | undefined;

  const contradicting = useQuery(
    api?.domains?.product?.userWikiMaintainer?.listContradictingPages ?? "skip",
    api?.domains?.product?.userWikiMaintainer?.listContradictingPages
      ? { ownerKey, limit: 10 }
      : "skip",
  ) as WikiPageRow[] | undefined;

  const isLoading = pages === undefined;
  const isEmpty = !isLoading && (pages ?? []).length === 0;

  const contradictionSection = useMemo(() => {
    if (!contradicting || contradicting.length === 0) return null;
    return (
      <section
        data-testid="wiki-contradictions-section"
        className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10"
      >
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-700 dark:text-rose-300">
          Needs review ({contradicting.length})
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {contradicting.map((p) => (
            <li key={p._id}>
              <Link
                to={`/me/wiki/${p.pageType}/${p.slug}`}
                className="font-medium text-rose-700 hover:underline dark:text-rose-200"
              >
                {p.title}
              </Link>{" "}
              <span className="text-xs text-rose-600 dark:text-rose-300">
                {p.contradictionCount} open
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }, [contradicting]);

  return (
    <div
      data-testid="wiki-landing"
      className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-50">My Wiki</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Personal synthesis layer — regenerated from your saved reports. Read-mostly;
          your notes stay yours.
        </p>
      </header>

      {contradictionSection}

      {/* Tabs */}
      <nav
        className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-white/[0.08]"
        aria-label="Wiki page types"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`wiki-tab-${t.id}`}
            className={`rounded-t-md px-3 py-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
              tab === t.id
                ? "border-b-2 border-[var(--accent-primary,#d97757)] text-gray-900 dark:text-gray-50"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {isLoading ? (
        <div
          data-testid="wiki-landing-loading"
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-label="Loading wiki pages"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md bg-gray-100 motion-reduce:animate-none dark:bg-white/[0.03]"
            />
          ))}
        </div>
      ) : isEmpty ? (
        <div
          data-testid="wiki-landing-empty"
          className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm dark:border-white/[0.1] dark:bg-white/[0.01]"
        >
          <p className="font-medium text-gray-900 dark:text-gray-100">No pages yet</p>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Save a report from Chat or Reports, and your first wiki page will
            appear here automatically within a few minutes.
          </p>
        </div>
      ) : (
        <ul
          data-testid="wiki-landing-list"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {(pages ?? []).map((p) => (
            <li key={p._id}>
              <Link
                to={`/me/wiki/${p.pageType}/${p.slug}`}
                data-testid="wiki-page-card"
                data-page-slug={p.slug}
                className="flex h-full flex-col gap-1 rounded-md border border-gray-200 bg-white p-3 transition hover:border-gray-300 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.15]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-50">
                    {p.title}
                  </span>
                  <WikiFreshnessBadge state={p.freshnessState} />
                </div>
                {p.summary ? (
                  <p className="line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
                    {p.summary}
                  </p>
                ) : null}
                <div className="mt-auto flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-[1px] uppercase tracking-wide dark:border-white/[0.06] dark:bg-white/[0.03]">
                    {p.pageType}
                  </span>
                  <span>rev {p.revision}</span>
                  <span>· {formatRelative(p.regeneratedAt || p.updatedAt)}</span>
                  {p.contradictionCount > 0 ? (
                    <span className="ml-auto text-rose-600 dark:text-rose-300">
                      {p.contradictionCount} open
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
