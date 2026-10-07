/**
 * Route-level wrapper for /me/wiki/:pageType/:slug. Resolves ownerKey
 * and delegates to WikiPageDetailContainer which handles the Convex
 * live query + loading/not-found states.
 */
import { useParams } from "react-router-dom";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { useProductBootstrap } from "@/features/product/lib/useProductBootstrap";
import { WikiPageDetailContainer } from "./WikiPageDetailContainer";

export default function WikiPageDetailRoute() {
  useProductBootstrap();
  const params = useParams<{ pageType?: string; slug?: string }>();
  const ownerKey = getAnonymousProductSessionId();
  const slug = params.slug ?? "";

  if (!slug) {
    return (
      <div
        className="mx-auto max-w-3xl p-4 sm:p-6"
        data-testid="wiki-page-detail-missing-slug"
      >
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            Missing page slug
          </p>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Return to <a href="/me/wiki" className="underline">My Wiki</a> and pick a page.
          </p>
        </div>
      </div>
    );
  }

  return <WikiPageDetailContainer ownerKey={ownerKey} slug={slug} />;
}
