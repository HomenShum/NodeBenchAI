/**
 * Route-level container for a single wiki page. Fetches via Convex live
 * query and delegates rendering to the presentational WikiPageDetail.
 */
import { useQuery } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { WikiPageDetail, type WikiPageDoc, type WikiRevisionDoc } from "./WikiPageDetail";

export function WikiPageDetailContainer({
  ownerKey,
  slug,
}: {
  ownerKey: string;
  slug: string;
}) {
  const api = useConvexApi();
  const result = useQuery(
    api?.domains?.product?.userWikiMaintainer?.getPageBySlug ?? "skip",
    api?.domains?.product?.userWikiMaintainer?.getPageBySlug
      ? { ownerKey, slug }
      : "skip",
  ) as {
    page: WikiPageDoc;
    latestRevision: WikiRevisionDoc | null;
  } | null | undefined;

  if (result === undefined) {
    return (
      <div
        data-testid="wiki-page-detail-loading"
        className="mx-auto flex max-w-3xl flex-col gap-3 p-4 sm:p-6"
        aria-busy="true"
        aria-label="Loading wiki page"
      >
        <div className="h-8 w-2/3 animate-pulse rounded bg-gray-100 motion-reduce:animate-none dark:bg-white/[0.03]" />
        <div className="h-24 animate-pulse rounded bg-gray-100 motion-reduce:animate-none dark:bg-white/[0.03]" />
        <div className="h-24 animate-pulse rounded bg-gray-100 motion-reduce:animate-none dark:bg-white/[0.03]" />
      </div>
    );
  }

  if (result === null) {
    return (
      <div
        data-testid="wiki-page-detail-notfound"
        className="mx-auto max-w-3xl p-4 sm:p-6"
      >
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            Page not found
          </p>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            This wiki page doesn't exist yet. It will appear here after you
            save a report referencing this entity.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WikiPageDetail
      ownerKey={ownerKey}
      page={result.page}
      latestRevision={result.latestRevision}
    />
  );
}
